import { useStore } from "@/context/StoreContext";
import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { AnimatePresence, motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { NcButton, NcSheetHeader, Rule, EYEBROW } from "@/components/nocturne";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
function formatCurrencyShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

/** Quantos modelos cabem na lista do trilho antes de virar "+ N outros". */
const MAX_TOP_MODELS = 6;

/** Acima disso a linha entra sem cascata — lista longa não precisa animar item a item. */
const MAX_STAGGERED_ROWS = 20;

export default function LossesPage() {
  const { products, stockLosses, stockEntries, addStockLoss, deleteStockLoss, getProductName, getTotalLossValue, sellers, productAssignments } = useStore();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [sellerId, setSellerId] = useState("estoque");
  const [submitting, setSubmitting] = useState(false);

  const selectedProduct = products.find(p => p.id === productId);
  const totalLoss = getTotalLossValue();

  /** Quanto sai do estoque com o que está preenchido no painel. */
  const lossValue = (selectedProduct?.purchasePrice ?? 0) * (Number(quantity) || 0);

  /**
   * Só sabor COM estoque entra na lista. Antes todos apareciam e os zerados
   * vinham desabilitados — o que enchia o menu de linha que não dá para
   * escolher: não se perde o que não se tem.
   *
   * A ordem é a do resto do sistema (marca, modelo, sabor), que já vem pronta
   * do StoreContext; antes esta tela reordenava por sabor e espalhava a mesma
   * marca pela lista inteira.
   */
  const availableProducts = useMemo(() => products.filter(p => p.stock > 0), [products]);

  const sortedLosses = useMemo(() => [...stockLosses].sort((a, b) => b.date.localeCompare(a.date)), [stockLosses]);

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const sellerMap = useMemo(() => new Map(sellers.map(s => [s.id, s.name])), [sellers]);

  const totalUnits = useMemo(() => stockLosses.reduce((s, l) => s + l.quantity, 0), [stockLosses]);

  /** Perda do mês corrente — o número que diz se a coisa está piorando agora. */
  const monthLoss = useMemo(() => {
    const prefix = todayDateString().slice(0, 7);
    return stockLosses.filter(l => l.date.slice(0, 7) === prefix).reduce((s, l) => s + l.totalCost, 0);
  }, [stockLosses]);

  /**
   * Quanto do dinheiro que entrou em estoque virou perda. É a leitura que dá
   * escala ao número de cima: R$ 800 perdidos é muito ou pouco depende do
   * tamanho da operação.
   */
  const entriesCost = useMemo(() => stockEntries.reduce((s, e) => s + e.totalCost, 0), [stockEntries]);
  const lossPct = entriesCost > 0 ? (totalLoss / entriesCost) * 100 : 0;

  /**
   * De onde a unidade saiu: do estoque da casa ou da mão de um vendedor. É a
   * divisão que decide o que fazer com o número — problema de armazenamento ou
   * de consignação.
   */
  const origin = useMemo(() => {
    let internal = 0;
    let withSellers = 0;
    stockLosses.forEach(l => {
      if (l.sellerId) withSellers += l.totalCost;
      else internal += l.totalCost;
    });
    return { internal, withSellers };
  }, [stockLosses]);

  /** Modelos que mais somam perda, do maior para o menor. */
  const topModels = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; units: number; cost: number }>();
    stockLosses.forEach(l => {
      const p = productMap.get(l.productId);
      const brand = (p?.brand || "").trim() || "Sem marca";
      const model = (p?.model || "").trim() || "Sem modelo";
      const key = `${brand}|${model}`;
      const cur = map.get(key);
      if (cur) {
        cur.units += l.quantity;
        cur.cost += l.totalCost;
      } else {
        map.set(key, { key, brand, model, units: l.quantity, cost: l.totalCost });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [stockLosses, productMap]);

  const reset = () => {
    setProductId(""); setQuantity("1"); setReason(""); setDate(todayDateString()); setSellerId("estoque");
  };

  const handleSubmit = async () => {
    if (!productId || !Number(quantity)) return;
    setSubmitting(true);
    await addStockLoss({
      productId,
      quantity: Number(quantity),
      reason: reason || undefined,
      sellerId: sellerId === "estoque" ? undefined : sellerId,
      date: localDateToISO(date),
    });
    setSubmitting(false);
    reset();
    setOpen(false);
  };

  return (
    // `/losses` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento. Mesmo esqueleto do
    // Dashboard, do Produtos e da Entrada — coluna principal + trilho.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>Baixas de estoque</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Perdas</h1>
          </div>

          {/* Painel lateral deslizando da direita, como as outras entradas de
              dado do painel (nova entrada, nova compra, cadastro rápido). Era
              um diálogo no meio da tela — a única porta de registro do ERP que
              ainda abria assim. */}
          <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <SheetTrigger asChild>
              <NcButton variant="solid" size="md"><Plus size={14} />Nova perda</NcButton>
            </SheetTrigger>
            {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja:
                o Radix porta o painel para o <body> e os tokens não chegam por
                herança. */}
            <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
              <NcSheetHeader
                eyebrow="Perdas"
                title="Registrar perda"
                description="A quantidade sai do estoque de onde a perda aconteceu — da casa ou do vendedor."
              />

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* O que se perdeu */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que se perdeu</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Produto</Label>
                    <Select value={productId} onValueChange={setProductId}>
                      <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                      <SelectContent className="nocturne">
                        {availableProducts.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs" style={{ color: "var(--nc-text-3)" }}>
                            Nenhum produto com estoque.
                          </div>
                        ) : availableProducts.map(p => (
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
                      <Input type="number" min="1" max={selectedProduct?.stock || undefined} value={quantity} onChange={e => setQuantity(e.target.value)} className="nc-num" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                  </div>
                </section>

                {/* De onde saiu */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>De onde saiu</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Origem da perda</Label>
                    <Select value={sellerId} onValueChange={setSellerId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="nocturne">
                        <SelectItem value="estoque">Estoque interno</SelectItem>
                        {sellers.map(s => {
                          const held = productAssignments
                            .filter(a => a.sellerId === s.id && a.productId === productId)
                            .reduce((sum, a) => sum + a.quantity, 0);
                          return (
                            <SelectItem key={s.id} value={s.id} disabled={!!productId && held <= 0}>
                              {s.name}{productId ? ` (${held} un.)` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Motivo</Label>
                    <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex: quebrado, vencido, extraviado" />
                  </div>
                </section>

                {selectedProduct && Number(quantity) > 0 && (
                  <div className="space-y-1 rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--nc-text-2)" }}>Custo unitário</span>
                      <span className="nc-num">{formatCurrency(selectedProduct.purchasePrice)}</span>
                    </div>
                    <div className="nc-rule-top flex justify-between pt-1.5 font-medium">
                      <span>Valor da perda</span>
                      <span className="nc-num" style={{ color: "var(--nc-crit)" }}>
                        {formatCurrency(lossValue)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                    {lossValue > 0
                      ? <>Sai do estoque <span className="nc-num font-medium" style={{ color: "var(--nc-crit)" }}>{formatCurrency(lossValue)}</span></>
                      : "Escolha o produto e a quantidade"}
                  </p>
                  <NcButton
                    variant="solid"
                    size="md"
                    onClick={handleSubmit}
                    disabled={!productId || !Number(quantity) || submitting}
                  >
                    {submitting ? "Registrando…" : "Registrar perda"}
                  </NcButton>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </header>

        {/* ---------------- Lista ----------------
            Lista de linhas, e não tabela, para a saída animada continuar
            existindo: a perda some da tela na hora em que é excluída, e um <tr>
            não anima altura direito. */}
        {sortedLosses.length === 0 ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            Nenhuma perda registrada.
          </div>
        ) : (
          <Stagger className="nc-card overflow-hidden">
            <AnimatePresence initial={false}>
              {sortedLosses.map((l, i) => {
                const label = getProductName(l.productId);
                const originLabel = l.sellerId ? (sellerMap.get(l.sellerId) ?? "Vendedor") : "Estoque interno";
                return (
                  <motion.div
                    key={l.id}
                    layout
                    variants={i < MAX_STAGGERED_ROWS ? listItem : undefined}
                    exit={{ opacity: 0, height: 0 }}
                    transition={transitionBase}
                    className="nc-row nc-hover group flex items-center justify-between gap-3 overflow-hidden px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{label}</p>
                      <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {formatDateBR(l.date)} · {originLabel}{l.reason ? ` · ${l.reason}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-4 text-[11px]">
                      <div className="text-right">
                        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Qtd</p>
                        <p className="nc-num">{l.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Valor</p>
                        <p className="nc-num" style={{ color: "var(--nc-crit)" }}>{formatCurrency(l.totalCost)}</p>
                      </div>
                      {/* No desktop a ação só aparece no hover da linha; no toque
                          não há hover, então fica sempre visível abaixo de sm. */}
                      <div className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <NcButton
                          variant="danger"
                          size="icon"
                          aria-label={`Excluir perda de ${label}`}
                          onClick={async () => {
                            if (await confirm({ title: "Excluir perda", description: "Excluir este registro de perda? O estoque será restaurado." })) {
                              deleteStockLoss(l.id);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </NcButton>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Stagger>
        )}
      </div>

      {/* ---------------- Coluna direita: o tamanho do estrago ----------------
          No celular ela vem ANTES da lista (`order-first`), como nas outras
          telas migradas: a lista rola por telas e um resumo embaixo dela não
          seria lido. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Estoque perdido</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Prejuízo acumulado</span>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* O número principal desta tela é uma perda, então ele nasce em
                --nc-crit — o mesmo tom do lucro negativo no Dashboard. */}
            <span style={{ color: "var(--nc-crit)" }}>
              <AnimatedNumber
                value={totalLoss}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
              />
            </span>
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            {stockLosses.length} registro{stockLosses.length === 1 ? "" : "s"} · {totalUnits} un.
          </p>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Unidades perdidas</span>
            <span className="nc-num text-sm">{totalUnits}</span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Perda deste mês</span>
            <span style={{ color: monthLoss > 0 ? "var(--nc-crit)" : undefined }}>
              <AnimatedNumber
                value={monthLoss}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-xl font-semibold"
              />
            </span>
          </div>
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>sobre o que entrou em estoque</span>
            <span>{lossPct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
          </div>
        </div>

        <Rule />

        {/* De onde saiu: mesma barra do "recebido / a receber" do Dashboard —
            a divisão de um total em duas partes, não uma escala. Aqui ela
            separa o que é problema de armazenamento do que é de consignação. */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <AlertTriangle size={12} style={{ color: "var(--nc-crit)" }} />
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>De onde saiu</span>
          </div>
          {totalLoss === 0 ? (
            <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma perda registrada.</p>
          ) : (
            <>
              <div className="flex h-[5px] gap-0.5">
                <div style={{ flex: Math.max(origin.internal, 0.001), background: "var(--nc-crit)", borderRadius: 2 }} />
                <div style={{ flex: Math.max(origin.withSellers, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
              </div>
              <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                <span>casa {formatCurrencyShort(origin.internal)}</span>
                <span style={{ color: "var(--nc-alert)" }}>vendedores {formatCurrencyShort(origin.withSellers)}</span>
              </div>
            </>
          )}
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Modelos que mais se perdem</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {topModels.length} no total
            </span>
          </div>
          {topModels.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhuma perda registrada.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {topModels.slice(0, MAX_TOP_MODELS).map(m => (
                <motion.div key={m.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {m.model}
                    <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                  </span>
                  <span className="nc-num flex-none">
                    {formatCurrencyShort(m.cost)}
                    <span style={{ color: "var(--nc-text-3)" }}> · {m.units} un.</span>
                  </span>
                </motion.div>
              ))}
              {topModels.length > MAX_TOP_MODELS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {topModels.length - MAX_TOP_MODELS} outros modelos
                </p>
              )}
            </Stagger>
          )}
        </div>
      </aside>
    </div>
  );
}
