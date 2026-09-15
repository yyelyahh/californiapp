import { useMemo, useState } from "react";
import { ArrowRight, ArrowsLeftRight, Plus } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/context/StoreContext";
import { useBranch } from "@/context/BranchContext";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { NcButton, NcSheetHeader, EYEBROW, BranchReadOnly } from "@/components/nocturne";
import { listItem, transitionBase } from "@/lib/motion";

/** Quantas transferências cabem no card antes de virar "+ N anteriores". */
const MAX_ROWS = 6;

/** Teto da observação. Espelha o `left(..., 200)` da `transfer_branch_stock`. */
const NOTES_MAX = 200;

/**
 * Transferência de estoque entre filiais.
 *
 * Mora na Entrada porque é o mesmo lugar mental: mercadoria chegando. A
 * diferença é de onde ela vem — do fornecedor (compra) ou da outra cidade
 * (aqui). NÃO se confunde com a "Movimentar estoque" da Distribuição, que é
 * consignação: aquela passa unidade para a MÃO de um vendedor e não tira nada
 * da loja.
 *
 * A ORIGEM É SEMPRE A FILIAL ATIVA, e não um campo. Dois motivos, e o segundo
 * não é escolha: é o estoque dela que está na tela, então é o único número que
 * a pessoa pode conferir antes de mandar; e é o único que o `StoreContext`
 * carregou — a lista de produtos vem escopada pela filial. Um seletor de
 * origem mostraria "0 un." para todo sabor da outra cidade. Para mandar no
 * sentido contrário, troca-se de filial, que é a regra de todo o resto do app.
 *
 * Em "Todas as filiais" o botão fica desabilitado: ali o estoque exibido é a
 * SOMA das duas, e não há de onde tirar.
 */
export default function BranchTransferSection() {
  const { products, stockTransfers, transferBranchStock, getProductName } = useStore();
  const { branches, branchId, branchName } = useBranch();

  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [toBranch, setToBranch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Uma filial só: não há para onde transferir, e a seção inteira não tem o
  // que dizer. Some — ao contrário do botão desabilitado de "Todas", aqui não
  // é um estado temporário, é a forma do negócio.
  const single = branches.length < 2;

  const destinations = useMemo(() => branches.filter(b => b.id !== branchId), [branches, branchId]);

  /** Só sabor COM estoque nesta filial: não se transfere o que não se tem. */
  const available = useMemo(() => products.filter(p => p.stock > 0), [products]);

  const selected = products.find(p => p.id === productId);
  const qty = Number(quantity) || 0;
  const tooMany = !!selected && qty > selected.stock;
  const canSubmit = !!productId && !!toBranch && qty > 0 && !tooMany && !saving;

  const reset = () => {
    setProductId("");
    setToBranch(destinations.length === 1 ? destinations[0].id : "");
    setQuantity("1");
    setDate(todayDateString());
    setNotes("");
  };

  const openPanel = () => {
    reset();
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const ok = await transferBranchStock({
      productId,
      toBranchId: toBranch,
      quantity: qty,
      date: localDateToISO(date),
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (ok) setOpen(false);
  };

  if (single) return null;

  const shown = expanded ? stockTransfers : stockTransfers.slice(0, MAX_ROWS);

  return (
    <>
      {/* Mesmo cabeçalho do "Compras a caminho": ícone no accent, título de
          15px e as ações à direita. */}
      <section className="nc-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2">
            <ArrowsLeftRight size={16} style={{ color: "var(--nc-accent)" }} />
            <h2 className="text-[15px]">Entre filiais</h2>
            {branchId && (
              <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>
                {branchName(branchId)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!branchId && <BranchReadOnly />}
            <NcButton onClick={openPanel} disabled={!branchId}>
              <Plus size={13} />Transferir
            </NcButton>
          </div>
        </div>

        {stockTransfers.length === 0 ? (
          <p className="px-4 pb-5 pt-1 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
            Nenhuma transferência registrada.
          </p>
        ) : (
          <div style={{ borderTop: "1px solid var(--nc-track)" }}>
            <AnimatePresence initial={false}>
              {shown.map(t => {
                const saiu = t.fromBranchId === branchId;
                return (
                  <motion.div
                    key={t.id}
                    variants={listItem}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={transitionBase}
                    className="nc-row flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {/* A direção sai em cor: o que saiu é dinheiro que deixou
                          esta cidade (--nc-alert, o mesmo "falta receber"), o
                          que chegou é neutro. */}
                      <span
                        className="nc-num flex-none text-[13px]"
                        style={{ color: saiu ? "var(--nc-alert)" : "var(--nc-accent)" }}
                      >
                        {saiu ? "−" : "+"}{t.quantity}
                      </span>
                      <span className="truncate text-[13px]">{getProductName(t.productId)}</span>
                    </div>
                    <div className="flex flex-none items-center gap-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      <span>{branchName(t.fromBranchId)}</span>
                      <ArrowRight size={11} />
                      <span>{branchName(t.toBranchId)}</span>
                      <span className="nc-num ml-1.5">{formatDateBR(t.date)}</span>
                    </div>
                    {t.notes && (
                      <p className="w-full text-[11px]" style={{ color: "var(--nc-text-3)" }}>{t.notes}</p>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {stockTransfers.length > MAX_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="nc-hover w-full px-4 py-2 text-[11.5px]"
                style={{ color: "var(--nc-text-3)", borderTop: "1px solid var(--nc-track)" }}
              >
                {expanded ? "Mostrar menos" : `+ ${stockTransfers.length - MAX_ROWS} anteriores`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* `nocturne` repetido: o Radix porta o painel para o <body> e os tokens
          não chegam por herança. */}
      <Sheet open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Entre filiais"
            title="Transferir estoque"
            description={`As unidades saem de ${branchName(branchId)} e entram na filial escolhida. O custo viaja junto; o preço de venda é decisão de quem recebe.`}
          />

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que sai daqui</p>

              <div className="space-y-1.5">
                <Label className="text-xs">Produto</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                  <SelectContent className="nocturne">
                    {available.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs" style={{ color: "var(--nc-text-3)" }}>
                        Nenhum produto com estoque nesta filial.
                      </div>
                    ) : available.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.flavor} · {p.brand} {p.model} ({p.stock} un.)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantidade</Label>
                  <Input
                    type="number"
                    min={1}
                    max={selected?.stock ?? undefined}
                    className="nc-num"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                  />
                  {tooMany && (
                    <p className="text-[11px]" style={{ color: "var(--nc-crit)" }}>
                      Disponível apenas {selected!.stock} un.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Para onde vai</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Filial de destino</Label>
                <Select value={toBranch} onValueChange={setToBranch}>
                  <SelectTrigger><SelectValue placeholder="Selecione a filial" /></SelectTrigger>
                  <SelectContent className="nocturne">
                    {destinations.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observação</Label>
                <Input
                  value={notes}
                  maxLength={NOTES_MAX}
                  placeholder="Opcional — quem levou, qual caixa…"
                  onChange={e => setNotes(e.target.value)}
                />
              </div>

              {/* Transferência errada se conserta com uma de volta, não
                  apagando: o histórico conta o que aconteceu com a caixa, e
                  estornar seria impossível se o destino já tivesse vendido. */}
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--nc-text-3)" }}>
                Não há exclusão de transferência. Se errar, registre uma no sentido contrário — o
                histórico fica contando o que de fato aconteceu com a mercadoria.
              </p>
            </section>
          </div>

          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {canSubmit && selected ? (
                  <>
                    <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{qty}</span> un. de{" "}
                    {selected.flavor} → {branchName(toBranch)}
                  </>
                ) : (
                  "Preencha os campos para transferir"
                )}
              </p>
              <NcButton variant="solid" size="md" onClick={handleSubmit} disabled={!canSubmit}>
                {saving ? "Transferindo…" : "Transferir"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
