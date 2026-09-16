import { useMemo, useState } from "react";
// Ícone de tela vem do lucide (o phosphor é só do app-shell do AppLayout), o
// mesmo conjunto do resto da Entrada.
import { ArrowLeftRight, ArrowRight, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/context/StoreContext";
import { useBranch } from "@/context/BranchContext";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { NcButton, NcSheetHeader, NcTabsList, EYEBROW } from "@/components/nocturne";
import { groupTransfers, transferTotals } from "@/lib/transfer-groups";
import { listItem, transitionBase } from "@/lib/motion";

/** Teto da observação. Espelha o `left(..., 200)` da `transfer_branch_stock`. */
const NOTES_MAX = 200;

/** Valor do "estoque da casa" no Select — o Radix não aceita string vazia. */
const CASA = "casa";

/** Espelha o `itens_demais` da `transfer_branch_stock_batch`. */
const MAX_LINES = 60;

/** Uma linha do lote: um sabor, saindo de uma origem, em quantidade. */
type Line = { originId: string; productId: string; quantity: number };

const lineKey = (l: Pick<Line, "originId" | "productId">) => `${l.originId}|${l.productId}`;

/**
 * Transferência de estoque entre filiais.
 *
 * Mora na Entrada porque é o mesmo lugar mental: mercadoria chegando. A
 * diferença é de onde ela vem — do fornecedor (compra) ou da outra cidade
 * (aqui). NÃO se confunde com a "Movimentar estoque" da Distribuição, que é
 * consignação: aquela passa unidade para a MÃO de um vendedor e não tira nada
 * da loja.
 *
 * É um BOTÃO no cabeçalho da Entrada, e não uma seção na coluna: o histórico
 * ocupava a tela inteira com uma linha por sabor transferido, no meio do
 * caminho entre as compras a caminho e a lista de entradas — e transferência
 * não é o assunto daquela tela, é uma operação ocasional. Aqui tudo acontece
 * dentro do painel, em duas abas: o que se faz (Transferir) e o que já foi
 * feito (Histórico).
 *
 * A VIAGEM É UMA OPERAÇÃO SÓ. Um sabor por vez era ruído em dois lugares: no
 * lançamento, que virava dez idas ao painel, e no histórico, que virava dez
 * linhas sem nada dizendo que foram juntas. O lote resolve os dois, e no banco
 * ele também é o que garante o tudo-ou-nada: a caixa física fecha uma vez.
 *
 * São DUAS origens, e elas respondem perguntas diferentes:
 *
 *   * a FILIAL de origem é sempre a ativa, e não um campo. É o estoque dela
 *     que está na tela — o único número que a pessoa pode conferir antes de
 *     mandar — e o único que o `StoreContext` carregou. Um seletor mostraria
 *     "0 un." para todo sabor da outra cidade. Para mandar no sentido
 *     contrário, troca-se de filial.
 *   * DE QUEM a unidade sai É um campo, e é POR ITEM: do estoque da casa, ou
 *     da caixa de um vendedor. Isso não se deduz — com dois vendedores
 *     segurando o mesmo sabor, qualquer regra automática acerta o total e erra
 *     a pessoa. E é por item porque juntar o que sobrou com dois vendedores
 *     continua sendo uma viagem só.
 *
 * E esse campo vem ANTES do produto: a lista de sabores sai da origem
 * escolhida, com a quantidade que ELA tem. Escolher o produto primeiro é
 * descobrir no fim que aquele vendedor não tem nenhum. Mesma ordem do
 * "Movimentar estoque" da Distribuição.
 *
 * O teto da quantidade é o disponível daquele item na origem: o LIVRE da casa
 * (estoque da filial menos o que está distribuído) ou o que aquele vendedor
 * tem. A conta é refeita no banco — aqui ela existe para a pessoa não
 * descobrir o limite só no erro.
 *
 * Em "Todas as filiais" o painel abre no Histórico e a aba de transferir diz
 * por que não dá: ali o estoque exibido é a SOMA das duas, e não há de onde
 * tirar. Ler continua valendo — a carga que chegou é assunto das duas pontas.
 */
export default function BranchTransferSheet() {
  const {
    products, stockTransfers, transferBranchStock,
    getProductName, getSellerName, sellers, productAssignments,
  } = useStore();
  const { branches, branchId, branchName } = useBranch();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("transferir");
  const [origin, setOrigin] = useState(CASA);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<Line[]>([]);
  const [toBranch, setToBranch] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [openOps, setOpenOps] = useState<Set<string>>(new Set());

  // Uma filial só: não há para onde transferir, e o botão não tem o que
  // dizer. Some — ao contrário do desabilitado de "Todas", aqui não é um
  // estado temporário, é a forma do negócio.
  const single = branches.length < 2;

  const destinations = useMemo(() => branches.filter(b => b.id !== branchId), [branches, branchId]);

  /**
   * Quanto de cada sabor está distribuído entre os vendedores DESTA filial.
   * `productAssignments` já chega escopado pela filial ativa do
   * `StoreContext`, então não há o que filtrar aqui.
   */
  const assignedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of productAssignments) {
      map.set(a.productId, (map.get(a.productId) ?? 0) + a.quantity);
    }
    return map;
  }, [productAssignments]);

  /** Quanto cada vendedor tem no total — o que o seletor de origem mostra. */
  const heldTotalBySeller = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of productAssignments) {
      map.set(a.sellerId, (map.get(a.sellerId) ?? 0) + a.quantity);
    }
    return map;
  }, [productAssignments]);

  /** Total livre da casa: o que existe na filial e não está com ninguém. */
  const freeTotal = useMemo(
    () => products.reduce((s, p) => s + Math.max(0, p.stock - (assignedByProduct.get(p.id) ?? 0)), 0),
    [products, assignedByProduct],
  );

  /**
   * Quanto aquela origem tem daquele sabor. Da casa é o LIVRE (estoque da
   * filial menos o distribuído) — a mesma conta que a function refaz no banco.
   */
  const availableOf = useMemo(
    () => (originId: string, pid: string) => {
      if (originId === CASA) {
        const p = products.find(x => x.id === pid);
        return p ? Math.max(0, p.stock - (assignedByProduct.get(p.id) ?? 0)) : 0;
      }
      const a = productAssignments.find(x => x.sellerId === originId && x.productId === pid);
      return a?.quantity ?? 0;
    },
    [products, productAssignments, assignedByProduct],
  );

  /** O que já está no lote para aquele par origem+sabor. */
  const inLines = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(lineKey(l), l.quantity);
    return map;
  }, [lines]);

  /**
   * O QUE A ORIGEM ESCOLHIDA AINDA TEM — e é por isso que a origem vem antes
   * do produto. O que já entrou no lote sai do disponível: senão a pessoa
   * adicionaria duas vezes o mesmo sabor e o banco recusaria o lote inteiro no
   * fim, quando a caixa já está fechada.
   */
  const originItems = useMemo(() => {
    const base = origin === CASA
      ? products.map(p => ({ product: p, available: availableOf(CASA, p.id) }))
      : productAssignments
          .filter(a => a.sellerId === origin && a.quantity > 0)
          .map(a => ({ product: products.find(p => p.id === a.productId)!, available: a.quantity }))
          .filter(i => !!i.product);
    return base
      .map(i => ({ ...i, remaining: i.available - (inLines.get(`${origin}|${i.product.id}`) ?? 0) }))
      .filter(i => i.remaining > 0);
  }, [origin, products, productAssignments, availableOf, inLines]);

  const picked = originItems.find(i => i.product.id === productId);
  const qty = Number(quantity) || 0;
  const canAdd = !!picked && qty > 0 && qty <= picked.remaining && lines.length < MAX_LINES;

  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const linesFit = lines.every(l => l.quantity > 0 && l.quantity <= availableOf(l.originId, l.productId));
  const canSubmit = lines.length > 0 && !!toBranch && linesFit && !saving && !!branchId;

  const originLabel = (originId: string) =>
    originId === CASA ? "estoque da casa" : getSellerName(originId);

  const addLine = () => {
    if (!canAdd) return;
    setLines(prev => {
      const key = `${origin}|${productId}`;
      const found = prev.find(l => lineKey(l) === key);
      if (found) {
        return prev.map(l => (lineKey(l) === key ? { ...l, quantity: l.quantity + qty } : l));
      }
      return [...prev, { originId: origin, productId, quantity: qty }];
    });
    setProductId("");
    setQuantity("1");
  };

  const setLineQty = (key: string, value: number) =>
    setLines(prev => prev.map(l => (lineKey(l) === key ? { ...l, quantity: value } : l)));

  const removeLine = (key: string) => setLines(prev => prev.filter(l => lineKey(l) !== key));

  const reset = () => {
    setOrigin(CASA);
    setProductId("");
    setQuantity("1");
    setLines([]);
    setToBranch(destinations.length === 1 ? destinations[0].id : "");
    setDate(todayDateString());
    setNotes("");
  };

  const openPanel = () => {
    reset();
    setOpenOps(new Set());
    // Em "Todas" não há de onde tirar: o painel abre no que ali ainda se pode
    // fazer, que é ler.
    setTab(branchId ? "transferir" : "historico");
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const ok = await transferBranchStock({
      toBranchId: toBranch,
      date: localDateToISO(date),
      notes: notes.trim() || undefined,
      items: lines.map(l => ({
        productId: l.productId,
        quantity: l.quantity,
        fromSellerId: l.originId === CASA ? undefined : l.originId,
      })),
    });
    setSaving(false);
    if (ok) setOpen(false);
  };

  const days = useMemo(() => groupTransfers(stockTransfers, branchId), [stockTransfers, branchId]);
  const totals = useMemo(() => transferTotals(stockTransfers, branchId), [stockTransfers, branchId]);

  const toggleOp = (key: string) =>
    setOpenOps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  if (single) return null;

  return (
    <>
      <NcButton size="md" onClick={openPanel}>
        <ArrowLeftRight size={14} />Entre filiais
      </NcButton>

      {/* `nocturne` repetido: o Radix porta o painel para o <body> e os tokens
          não chegam por herança. */}
      <Sheet open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
        <SheetContent className="nocturne flex w-full flex-col p-0 sm:max-w-xl">
          <NcSheetHeader
            eyebrow="Entre filiais"
            title="Transferir estoque"
            description={
              branchId
                ? `As unidades saem de ${branchName(branchId)} e entram no estoque da casa da filial escolhida. O custo viaja junto; o preço de venda é decisão de quem recebe.`
                : "Em Todas as filiais o painel só mostra o que já foi transferido."
            }
          />

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none px-5 pt-3">
              <NcTabsList
                value={tab}
                tabs={[
                  { value: "transferir", label: "Transferir", count: lines.length || undefined },
                  { value: "historico", label: "Histórico", count: totals.operations },
                ]}
              />
            </div>

            {/* ---------------- Transferir ---------------- */}
            <TabsContent value="transferir" className="mt-0 min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {!branchId ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                  Escolha uma filial para lançar. Em “Todas as filiais” o estoque da tela é a soma
                  das duas, e não há de onde tirar.
                </p>
              ) : (
                <>
                  <section className="space-y-3">
                    <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que sai daqui</p>

                    {/* A ORIGEM VEM PRIMEIRO, e o produto sai dela. Escolher o
                        sabor antes é descobrir no fim que aquele vendedor não
                        tem nenhum. E de quem sai NÃO se deduz: com dois
                        vendedores segurando o mesmo sabor, escolher por regra
                        automática acerta o total e erra a pessoa. Ela fica de
                        pé entre um item e outro: a viagem costuma sair toda da
                        mesma caixa. */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">De onde sai</Label>
                      <Select
                        value={origin}
                        onValueChange={v => { setOrigin(v); setProductId(""); setQuantity("1"); }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent className="nocturne">
                          <SelectItem value={CASA} disabled={freeTotal <= 0}>
                            Estoque da casa ({freeTotal} un. livres)
                          </SelectItem>
                          {sellers.map(s => {
                            const held = heldTotalBySeller.get(s.id) ?? 0;
                            return (
                              <SelectItem key={s.id} value={s.id} disabled={held <= 0}>
                                {s.name} ({held} un.)
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Produto + quantidade + adicionar numa linha só: o gesto
                        se repete, e cada sabor é uma ida curta ao mesmo lugar
                        em vez de uma reabertura do painel. */}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[180px] flex-1 space-y-1.5">
                        <Label className="text-xs">Produto</Label>
                        <Select value={productId} onValueChange={setProductId}>
                          <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                          <SelectContent className="nocturne">
                            {originItems.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs" style={{ color: "var(--nc-text-3)" }}>
                                {origin === CASA
                                  ? "Nada livre na casa — está tudo com os vendedores."
                                  : "Esse vendedor não tem mais o que mandar."}
                              </div>
                            ) : originItems.map(({ product: p, remaining }) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.flavor} · {p.brand} {p.model} ({remaining} un.)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-[92px] space-y-1.5">
                        <Label className="text-xs">Qtd</Label>
                        <Input
                          type="number"
                          min={1}
                          max={picked?.remaining || undefined}
                          className="nc-num"
                          value={quantity}
                          onChange={e => setQuantity(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                        />
                      </div>
                      <NcButton variant="outline" size="md" onClick={addLine} disabled={!canAdd}>
                        <Plus size={13} />Adicionar
                      </NcButton>
                    </div>

                    {/* Da casa, "livre" e "na filial" são números diferentes, e
                        a diferença é o que está na rua. Dizer os dois evita a
                        pergunta "mas o estoque não era maior?". */}
                    {origin === CASA && picked && (assignedByProduct.get(picked.product.id) ?? 0) > 0 && (
                      <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {picked.product.stock} un. na filial, {assignedByProduct.get(picked.product.id)} com vendedores.
                      </p>
                    )}
                    {picked && qty > picked.remaining && (
                      <p className="text-[11px]" style={{ color: "var(--nc-crit)" }}>
                        {origin === CASA
                          ? `Livres na casa: ${picked.remaining} un.`
                          : `Esse vendedor tem ${picked.remaining} un.`}
                        {(inLines.get(`${origin}|${picked.product.id}`) ?? 0) > 0 && " (já descontado o que está no lote)"}
                      </p>
                    )}
                  </section>

                  {/* ---- O lote em pé ---- */}
                  <section className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Nesta viagem</p>
                      <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {lines.length} {lines.length === 1 ? "sabor" : "sabores"} · {totalUnits} un.
                      </span>
                    </div>

                    {lines.length === 0 ? (
                      <p
                        className="rounded-lg px-3 py-6 text-center text-xs"
                        style={{ color: "var(--nc-text-3)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}
                      >
                        Nenhum sabor ainda. Escolha a origem, o produto e adicione — quantos quiser,
                        tudo vai numa operação só.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                        <AnimatePresence initial={false}>
                          {lines.map(l => {
                            const key = lineKey(l);
                            const p = products.find(x => x.id === l.productId);
                            const max = availableOf(l.originId, l.productId);
                            return (
                              <motion.div
                                key={key}
                                variants={listItem}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={transitionBase}
                                className="nc-row flex items-center gap-2 px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px]">{p?.flavor || getProductName(l.productId)}</p>
                                  <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                                    {p ? `${p.brand} ${p.model} · ` : ""}{originLabel(l.originId)}
                                  </p>
                                </div>
                                <Input
                                  type="number"
                                  min={1}
                                  max={max || undefined}
                                  aria-label={`Quantidade de ${p?.flavor ?? "produto"}`}
                                  className="nc-num h-8 w-[74px] text-right"
                                  value={l.quantity}
                                  onChange={e => setLineQty(key, Number(e.target.value) || 0)}
                                />
                                <NcButton
                                  variant="danger"
                                  size="icon"
                                  aria-label={`Tirar ${p?.flavor ?? "produto"} da viagem`}
                                  onClick={() => removeLine(key)}
                                >
                                  <Trash2 size={13} />
                                </NcButton>
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                    )}

                    {!linesFit && (
                      <p className="text-[11px]" style={{ color: "var(--nc-crit)" }}>
                        Alguma linha passa do que a origem tem. Ajuste a quantidade antes de transferir.
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Para onde vai</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Filial de destino</Label>
                        <Select value={toBranch} onValueChange={setToBranch}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent className="nocturne">
                            {destinations.map(b => (
                              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Data</Label>
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Observação</Label>
                      <Input
                        value={notes}
                        maxLength={NOTES_MAX}
                        placeholder="Opcional — quem levou, qual caixa…"
                        onChange={e => setNotes(e.target.value)}
                      />
                      <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        Vale para a viagem inteira: é uma operação só.
                      </p>
                    </div>

                    {/* Transferência errada se conserta com uma de volta, não
                        apagando: o histórico conta o que aconteceu com a
                        caixa, e estornar seria impossível se o destino já
                        tivesse vendido. */}
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--nc-text-3)" }}>
                      Não há exclusão de transferência. Se errar, registre uma no sentido contrário — o
                      histórico fica contando o que de fato aconteceu com a mercadoria.
                    </p>
                  </section>
                </>
              )}
            </TabsContent>

            {/* ---------------- Histórico ---------------- */}
            <TabsContent value="historico" className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {days.length === 0 ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                  Nenhuma transferência registrada.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {days.map(day => (
                    <section key={day.dateKey}>
                      {/* O dia é o cabeçalho, e o saldo dele fica ao lado: o
                          que saiu daqui sai no alerta (é mercadoria que deixou
                          a cidade), o que chegou sai no accent. */}
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-[13px]">{formatDateBR(day.operations[0].date)}</span>
                        <span className="nc-num flex items-baseline gap-2 text-[11px]">
                          {day.out > 0 && <span style={{ color: "var(--nc-alert)" }}>−{day.out} un.</span>}
                          {day.in > 0 && <span style={{ color: "var(--nc-accent)" }}>+{day.in} un.</span>}
                          <span style={{ color: "var(--nc-text-3)" }}>
                            {day.operations.length} {day.operations.length === 1 ? "operação" : "operações"}
                          </span>
                        </span>
                      </div>

                      <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                        {day.operations.map(op => {
                          const saiu = op.fromBranchId === branchId;
                          const isOpen = openOps.has(op.key);
                          const origens = [
                            ...(op.fromHouse ? ["casa"] : []),
                            ...op.fromSellerIds.map(getSellerName),
                          ].join(", ");
                          return (
                            <div key={op.key}>
                              <button
                                type="button"
                                onClick={() => toggleOp(op.key)}
                                aria-expanded={isOpen}
                                className="nc-row nc-hover flex w-full items-center gap-2 px-3 py-2.5 text-left"
                              >
                                <motion.span
                                  animate={{ rotate: isOpen ? 90 : 0 }}
                                  transition={transitionBase}
                                  className="inline-flex flex-none"
                                  style={{ color: "var(--nc-text-3)" }}
                                >
                                  <ChevronRight size={12} />
                                </motion.span>
                                <span
                                  className="nc-num flex-none text-[13px]"
                                  style={{ color: saiu ? "var(--nc-alert)" : "var(--nc-accent)" }}
                                >
                                  {saiu ? "−" : "+"}{op.units}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
                                  {op.items.length} {op.items.length === 1 ? "sabor" : "sabores"}
                                  {origens && <span style={{ color: "var(--nc-text-3)" }}> · {origens}</span>}
                                </span>
                                <span className="flex flex-none items-center gap-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                                  <span className="hidden sm:inline">{branchName(op.fromBranchId)}</span>
                                  <ArrowRight size={11} />
                                  <span>{branchName(op.toBranchId)}</span>
                                </span>
                              </button>

                              <AnimatePresence initial={false}>
                                {isOpen && (
                                  <motion.div
                                    key="body"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={transitionBase}
                                    className="overflow-hidden"
                                    style={{ background: "var(--nc-bg)" }}
                                  >
                                    <div className="px-3 py-2">
                                      {op.items.map(it => (
                                        <div key={it.id} className="flex items-baseline justify-between gap-2 py-1 text-[12px]">
                                          <span className="min-w-0 truncate">{getProductName(it.productId)}</span>
                                          <span className="nc-num flex-none" style={{ color: "var(--nc-text-2)" }}>
                                            {it.quantity} un.
                                            {it.fromSellerId && (
                                              <span style={{ color: "var(--nc-text-3)" }}> · {getSellerName(it.fromSellerId)}</span>
                                            )}
                                          </span>
                                        </div>
                                      ))}
                                      {op.notes && (
                                        <p className="mt-1 text-[11px]" style={{ color: "var(--nc-text-3)" }}>{op.notes}</p>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {tab === "transferir" && branchId && (
            <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
              <div className="flex w-full items-center justify-between gap-3">
                <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                  {lines.length > 0 ? (
                    <>
                      <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{totalUnits}</span> un. em{" "}
                      {lines.length} {lines.length === 1 ? "sabor" : "sabores"}
                      {toBranch ? <> → {branchName(toBranch)}</> : " · escolha a filial de destino"}
                    </>
                  ) : (
                    "Adicione os sabores desta viagem"
                  )}
                </p>
                <NcButton variant="solid" size="md" onClick={handleSubmit} disabled={!canSubmit}>
                  {saving ? "Transferindo…" : "Transferir"}
                </NcButton>
              </div>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
