import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Search, Trash2, ChevronRight, X, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR, isoDay, currentMonthRange } from "@/lib/date-utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmProvider";
import PurchaseOrdersSection from "@/components/PurchaseOrdersSection";
import { AnimatePresence, motion } from "motion/react";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { NcButton, NcSheetHeader, SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { sortNames } from "@/lib/catalog-order";
import { cn } from "@/lib/utils";

const BRAND_PRESETS: Record<string, number> = {
  Ignite: 68.5,
  Elfbar: 68,
  Nikbar: 0,
};
const DEFAULT_BRANDS = Object.keys(BRAND_PRESETS);

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
function formatCurrencyShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

function parseFlavorLines(text: string) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)\s+(\d+)x?\s*$/i);
      if (match) return { flavor: match[1].trim(), quantity: parseInt(match[2], 10) };
      const match2 = line.match(/^(.+?)\s+(\d+)\s*$/);
      if (match2) return { flavor: match2[1].trim(), quantity: parseInt(match2[2], 10) };
      return { flavor: line, quantity: 1 };
    });
}

type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";

/**
 * Os mesmos chips do Dashboard (`SegmentedChips`), com os períodos que fazem
 * sentido para reposição. "custom" não está aqui de propósito: ele não é um
 * chip, é o que sobra quando a pessoa digita um intervalo à mão — e aí nenhum
 * chip fica aceso.
 */
const PERIOD_OPTIONS: { value: DateRangePreset; label: string; short: string }[] = [
  { value: "all", label: "Todo o período", short: "Tudo" },
  { value: "today", label: "Hoje", short: "Hoje" },
  { value: "7d", label: "Últimos 7 dias", short: "7d" },
  { value: "month", label: "Este mês", short: "Mês" },
  { value: "lastMonth", label: "Mês passado", short: "Mês ant." },
];

/**
 * A tela abre no mês corrente, como a de Vendas. A lista monta uma linha por
 * entrada, sem virtualização, e "Tudo" cresce para sempre — abrir no recorte
 * que se usa todo dia é o paliativo enquanto a correção não vem (roadmap).
 * "Limpar" volta para o mês pelo mesmo motivo: devolver a tela ao estado em que
 * ela abre, e não ao mais pesado que ela tem.
 */
const DEFAULT_PRESET: DateRangePreset = "month";

/** Quantos modelos cabem na lista do trilho antes de virar "+ N outros". */
const MAX_TOP_MODELS = 6;

export default function StockEntryPage() {
  const { products, stockEntries, purchaseOrders, addStockEntry, deleteStockEntry, getProductName } = useStore();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [modelSelect, setModelSelect] = useState("");
  const [model, setModel] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [flavorsText, setFlavorsText] = useState("");
  const [search, setSearch] = useState("");
  const [fPreset, setFPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const [dateFrom, setDateFrom] = useState(() => currentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => currentMonthRange().to);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const parsedLines = useMemo(() => parseFlavorLines(flavorsText), [flavorsText]);

  const entries = useMemo(() => {
    if (!brand || !model.trim()) return [];
    return parsedLines.map(({ flavor, quantity }) => {
      const fullName = `${model.trim()} · ${flavor}`;
      const product = products.find(p => p.brand.toLowerCase() === brand.toLowerCase() && p.model.toLowerCase() === model.trim().toLowerCase() && p.flavor.toLowerCase() === flavor.toLowerCase());
      return { flavor, quantity, fullName, product };
    });
  }, [brand, model, parsedLines, products]);

  const validEntries = entries.filter(e => e.product);
  const missingEntries = entries.filter(e => !e.product);
  const totalUnits = validEntries.reduce((s, e) => s + e.quantity, 0);
  const totalInvestment = (Number(unitCost) || 0) * totalUnits;

  const existingModels = useMemo(() => {
    if (!brand) return [];
    const set = new Set<string>();
    products.filter(p => p.brand === brand).forEach(p => p.model && set.add(p.model));
    return sortNames(Array.from(set));
  }, [products, brand]);

  const allBrands = useMemo(() => {
    const set = new Set<string>(DEFAULT_BRANDS);
    products.forEach(p => p.brand && set.add(p.brand));
    return sortNames(Array.from(set));
  }, [products]);

  const handleBrandChange = (value: string) => {
    setBrand(value);
    setModelSelect("");
    setModel("");
    const preset = BRAND_PRESETS[value];
    if (preset) setUnitCost(String(preset));
    else setUnitCost("");
  };

  const handleModelSelectChange = (value: string) => {
    setModelSelect(value);
    if (value !== "__new__") setModel(value);
    else setModel("");
  };

  const handleSubmit = async () => {
    if (validEntries.length === 0) {
      toast.error("Nenhum produto encontrado para registrar.");
      return;
    }
    setSubmitting(true);
    const cost = Number(unitCost) || 0;
    let created = 0;
    for (const entry of validEntries) {
      try {
        await addStockEntry({
          productId: entry.product!.id,
          quantity: entry.quantity,
          unitCost: cost,
          date: localDateToISO(date),
          notes: notes || undefined,
        });
        created++;
      } catch {
        toast.error(`Erro ao registrar: ${entry.fullName}`);
      }
    }
    if (created > 0) toast.success(`${created} entrada${created > 1 ? "s" : ""} registrada${created > 1 ? "s" : ""}!`);
    handleReset();
    setOpen(false);
    setSubmitting(false);
  };

  const handleReset = () => {
    setBrand("");
    setModelSelect("");
    setModel("");
    setUnitCost("");
    setDate(todayDateString());
    setNotes("");
    setFlavorsText("");
  };

  const applyPreset = (p: DateRangePreset) => {
    setFPreset(p);
    const now = new Date();
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    if (p === "today") { const t = isoDay(now); setDateFrom(t); setDateTo(t); return; }
    if (p === "7d") { const past = new Date(now); past.setDate(past.getDate() - 6); setDateFrom(isoDay(past)); setDateTo(isoDay(now)); return; }
    if (p === "month") { const m = currentMonthRange(); setDateFrom(m.from); setDateTo(m.to); return; }
    if (p === "lastMonth") { setDateFrom(isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(isoDay(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
  };

  const clearFilters = () => { setSearch(""); applyPreset(DEFAULT_PRESET); };

  // O período só conta como filtro quando NÃO é o padrão da tela: senão o
  // "Limpar" nasceria aceso, oferecendo limpar o estado em que a tela abriu.
  const hasActiveFilters = search !== "" || fPreset !== DEFAULT_PRESET;

  /** Sobretítulo do cabeçalho: o período que está mandando na tela, como no Dashboard. */
  const periodLabel = PERIOD_OPTIONS.find(o => o.value === fPreset)?.label ?? "Período personalizado";

  const filtered = useMemo(() => {
    let items = [...stockEntries].reverse();
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => getProductName(e.productId).toLowerCase().includes(q));
    }
    if (dateFrom) items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    return items;
  }, [stockEntries, search, dateFrom, dateTo, getProductName]);

  const totals = useMemo(() => ({
    entries: filtered.length,
    units: filtered.reduce((s, e) => s + e.quantity, 0),
    cost: filtered.reduce((s, e) => s + e.totalCost, 0),
  }), [filtered]);

  const avgUnitCost = totals.units > 0 ? totals.cost / totals.units : 0;

  /**
   * Compras já pedidas que ainda não viraram estoque. NÃO passa pelo filtro de
   * período de propósito: uma compra em aberto continua em aberto independente
   * do mês que a pessoa está olhando — o que ela responde é "quanto ainda está
   * por chegar", não "quanto entrou".
   */
  const incoming = useMemo(() => {
    const pending = purchaseOrders.filter(o => o.status === "pending");
    return {
      orders: pending.length,
      units: pending.reduce((s, o) => s + o.items.reduce((si, it) => si + it.expectedQuantity, 0), 0),
      value: pending.reduce(
        (s, o) => s + o.freightCost + o.items.reduce((si, it) => si + it.unitPrice * it.expectedQuantity, 0),
        0,
      ),
    };
  }, [purchaseOrders]);

  /** Onde as unidades do período entraram, do maior para o menor. */
  const topModels = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; units: number }>();
    filtered.forEach(e => {
      const p = productMap.get(e.productId);
      const brandName = (p?.brand || "").trim() || "Sem marca";
      const modelName = (p?.model || "").trim() || "Sem modelo";
      const key = `${brandName}|${modelName}`;
      const cur = map.get(key);
      if (cur) {
        cur.units += e.quantity;
      } else {
        map.set(key, { key, brand: brandName, model: modelName, units: e.quantity });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.units - a.units);
  }, [filtered, productMap]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    filtered.forEach(e => {
      const dateKey = e.date.slice(0, 10);
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(e);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, items]) => ({
        dateKey,
        dateLabel: formatDateBR(items[0].date),
        entries: items,
        totalQty: items.reduce((s, e) => s + e.quantity, 0),
        totalCost: items.reduce((s, e) => s + e.totalCost, 0),
      }));
  }, [filtered]);

  const toggleDate = (dateKey: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

  return (
    // `/stock` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento. Mesmo esqueleto do
    // Dashboard e do Produtos — coluna principal + trilho.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{periodLabel}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Entrada de estoque</h1>
          </div>

          <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
            <SheetTrigger asChild>
              <NcButton variant="solid" size="md"><Plus size={14} />Nova entrada</NcButton>
            </SheetTrigger>
            {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja:
                o Radix porta o painel para o <body> e os tokens não chegam por
                herança. */}
            <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
              <NcSheetHeader
                eyebrow="Reposição"
                title="Nova entrada"
                description="Lance vários sabores de um mesmo modelo de uma só vez."
              />

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* Identificação */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Identificação</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Marca</Label>
                      <Select value={brand} onValueChange={handleBrandChange}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent className="nocturne">
                          {allBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Modelo / Puffs</Label>
                      <Select value={modelSelect} onValueChange={handleModelSelectChange} disabled={!brand}>
                        <SelectTrigger><SelectValue placeholder={brand ? "Selecione" : "Marca primeiro"} /></SelectTrigger>
                        <SelectContent className="nocturne">
                          {existingModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          <SelectItem value="__new__">+ Novo modelo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {modelSelect === "__new__" && (
                    <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Ex: V155, TE 30K" autoFocus />
                  )}
                </section>

                {/* Custo e data */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Custo e data</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Custo unitário (R$)</Label>
                      <Input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0,00" className="nc-num" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Observações</Label>
                    <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" />
                  </div>
                </section>

                {/* Sabores */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Sabores · quantidade (um por linha)</p>
                  <textarea
                    value={flavorsText}
                    onChange={e => setFlavorsText(e.target.value)}
                    placeholder={"Blueberry Ice 2x\nStrawberry Ice 3x\nWatermelon Ice 1x"}
                    rows={6}
                    className="nc-input flex w-full px-3 py-2 text-sm"
                  />

                  {/* Pré-visualização: mesma peça do "Cadastro rápido" de
                      produtos — cabeçalho com a contagem e a lista riscando o
                      que não existe no catálogo. */}
                  {entries.length > 0 && (
                    <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                      <div className="flex items-center justify-between px-3 py-2 text-[11px]" style={{ background: "var(--nc-bg)" }}>
                        <span>
                          <span className="font-medium" style={{ color: "var(--nc-accent)" }}>{validEntries.length} ok</span>
                          {missingEntries.length > 0 && (
                            <> · <span style={{ color: "var(--nc-alert)" }}>{missingEntries.length} sem cadastro</span></>
                          )}
                        </span>
                        <span className="nc-num" style={{ color: "var(--nc-text-3)" }}>{totalUnits} un.</span>
                      </div>
                      <ul className="max-h-44 overflow-auto">
                        {entries.map((e, i) => (
                          <li key={i} className="nc-row flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                            <span
                              className={e.product ? "truncate" : "truncate line-through"}
                              style={e.product ? undefined : { color: "var(--nc-text-3)" }}
                            >
                              {e.fullName}
                            </span>
                            <span className="flex flex-none items-center gap-2">
                              <span className="nc-num">{e.quantity}x</span>
                              {!e.product && <span className="text-[10px]" style={{ color: "var(--nc-alert)" }}>sem cadastro</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </div>

              <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                    {totalUnits > 0
                      ? <>Investimento <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{formatCurrency(totalInvestment)}</span> · {totalUnits} un.</>
                      : "Preencha os campos para visualizar"}
                  </p>
                  <NcButton variant="solid" size="md" onClick={handleSubmit} disabled={validEntries.length === 0 || submitting}>
                    {submitting ? "Registrando…" : `Registrar ${validEntries.length || ""}`.trim()}
                  </NcButton>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </header>

        <PurchaseOrdersSection />

        {/* ---------------- Busca e período ---------------- */}
        <div className="nc-card flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--nc-text-3)" }} />
            <input
              type="text"
              placeholder="Buscar produto…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Buscar entrada por produto"
              className="nc-input h-8 w-full pl-8 pr-2.5 text-[12.5px]"
            />
          </div>
          <SegmentedChips options={PERIOD_OPTIONS} value={fPreset} onChange={v => applyPreset(v as DateRangePreset)} />
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setFPreset("custom"); }}
              aria-label="Data inicial"
              className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
            />
            <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setFPreset("custom"); }}
              aria-label="Data final"
              className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
            />
          </div>
          {/* O "Limpar" fica SEMPRE na linha e só some da vista quando não há
              filtro. Montar e desmontar ele mudava a largura de todo mundo a
              cada clique num chip: a busca é `flex-1` e engolia (ou devolvia)
              os ~72px do botão. `invisible` guarda o lugar; `disabled` tira do
              teclado e do leitor de tela enquanto ele não serve para nada. */}
          <NcButton
            variant="ghost"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className={cn("flex-none", !hasActiveFilters && "invisible")}
          >
            <X size={13} />Limpar
          </NcButton>
        </div>

        {/* ---------------- Entradas por dia ---------------- */}
        {dateGroups.length === 0 ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            {stockEntries.length === 0
              ? "Nenhuma entrada registrada ainda."
              : search.trim()
                ? `Nenhuma entrada encontrada para “${search.trim()}”.`
                : "Nenhuma entrada no período."}
          </div>
        ) : (
          <Stagger className="flex flex-col gap-3">
            {dateGroups.map(group => {
              const isCollapsed = collapsedDates.has(group.dateKey);
              return (
                <StaggerItem key={group.dateKey} className="nc-card overflow-hidden">
                  <button
                    onClick={() => toggleDate(group.dateKey)}
                    aria-expanded={!isCollapsed}
                    className="nc-hover flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <motion.span
                        animate={{ rotate: isCollapsed ? 0 : 90 }}
                        transition={transitionBase}
                        className="inline-flex flex-none"
                        style={{ color: "var(--nc-text-3)" }}
                      >
                        <ChevronRight size={14} />
                      </motion.span>
                      <div className="min-w-0">
                        <h2 className="truncate text-[15px]">{group.dateLabel}</h2>
                        <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                          {group.entries.length} entrada{group.entries.length !== 1 ? "s" : ""} · {group.totalQty} un.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-4 text-[11px]">
                      <div className="hidden text-right sm:block">
                        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Unidades</p>
                        <p className="nc-num">{group.totalQty}</p>
                      </div>
                      <div className="text-right">
                        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Investido</p>
                        <p className="nc-num">{formatCurrency(group.totalCost)}</p>
                      </div>
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={transitionBase}
                        className="overflow-hidden"
                        style={{ borderTop: "1px solid var(--nc-track)" }}
                      >
                        {/* Mesma tabela do Produtos: cabeçalho em texto terciário
                            e peso normal, sem faixa de fundo e sem caixa alta. */}
                        <div className="overflow-x-auto px-3 pb-2 pt-1">
                          <table className="w-full min-w-[440px] text-[13px]">
                            <thead>
                              <tr style={{ color: "var(--nc-text-3)" }}>
                                <th className="px-2 py-1.5 text-left font-normal">Produto</th>
                                <th className="px-2 py-1.5 text-right font-normal">Qtd</th>
                                <th className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">Custo un.</th>
                                <th className="px-2 py-1.5 text-right font-normal">Total</th>
                                <th className="w-[40px] px-2 py-1.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {group.entries.map(e => {
                                const prod = productMap.get(e.productId);
                                const flavor = prod?.flavor?.trim();
                                const modelName = prod?.model?.trim() || prod?.name;
                                const label = flavor || modelName || getProductName(e.productId);
                                const hasSubline = Boolean((flavor && modelName) || e.notes);
                                return (
                                  <tr key={e.id} className="nc-row nc-hover group">
                                    <td className="px-2 py-1.5">
                                      <div className="truncate">{label}</div>
                                      {hasSubline && (
                                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                                          {flavor && modelName && <span>{modelName}</span>}
                                          {flavor && modelName && e.notes && <span>·</span>}
                                          {e.notes && <span className="max-w-[200px] truncate" title={e.notes}>{e.notes}</span>}
                                        </div>
                                      )}
                                    </td>
                                    <td className="nc-num px-2 py-1.5 text-right font-medium">{e.quantity}</td>
                                    <td className="nc-num hidden px-2 py-1.5 text-right sm:table-cell" style={{ color: "var(--nc-text-2)" }}>
                                      {formatCurrency(e.unitCost)}
                                    </td>
                                    <td className="nc-num px-2 py-1.5 text-right">{formatCurrency(e.totalCost)}</td>
                                    <td className="px-2 py-1">
                                      {/* No desktop a ação só aparece no hover da
                                          linha; no toque não há hover, então fica
                                          sempre visível abaixo de sm. */}
                                      <div className="flex justify-end transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                        <NcButton
                                          variant="danger"
                                          size="icon"
                                          aria-label={`Excluir entrada de ${label}`}
                                          onClick={async (ev) => {
                                            ev.stopPropagation();
                                            if (await confirm({ title: "Excluir entrada", description: "Excluir esta entrada de estoque? O estoque do produto será ajustado." })) {
                                              deleteStockEntry(e.id);
                                            }
                                          }}
                                        >
                                          <Trash2 size={13} />
                                        </NcButton>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </div>

      {/* ---------------- Coluna direita: o que entrou ----------------
          No celular ela vem ANTES da lista (`order-first`), como no Produtos: a
          lista de entradas rola por telas e um resumo embaixo dela não seria
          lido. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Investido em reposição</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Custo das entradas</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <AnimatedNumber
              value={totals.cost}
              format={formatCurrencyShort}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            {totals.entries} entrada{totals.entries === 1 ? "" : "s"} · {totals.units} un.
          </p>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Unidades que entraram</span>
            <span className="nc-num text-sm">{totals.units}</span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Custo médio por unidade</span>
            <AnimatedNumber
              value={avgUnitCost}
              format={formatCurrency}
              duration={0.7}
              animateOnMount
              className="nc-num text-xl font-semibold"
            />
          </div>
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>modelos no período</span>
            <span>{topModels.length}</span>
          </div>
        </div>

        <Rule />

        {/* A caminho: dinheiro que já foi pedido e ainda não virou estoque. Sai
            no alerta, o mesmo tom do "a receber" do Dashboard — é a coluna do
            que está pendente, não do que já aconteceu. */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Truck size={12} style={{ color: "var(--nc-alert)" }} />
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>A caminho</span>
          </div>
          {incoming.orders === 0 ? (
            <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma compra aguardando recebimento.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
                  {incoming.orders} compra{incoming.orders === 1 ? "" : "s"} · {incoming.units} un.
                </span>
                <span className="nc-num text-base font-semibold" style={{ color: "var(--nc-alert)" }}>
                  {formatCurrencyShort(incoming.value)}
                </span>
              </div>
              <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                Não entra nos números acima: ainda não virou estoque.
              </p>
            </div>
          )}
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Modelos que mais entraram</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {topModels.length} no período
            </span>
          </div>
          {topModels.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhuma entrada no período.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {topModels.slice(0, MAX_TOP_MODELS).map(m => (
                <motion.div key={m.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {m.model}
                    <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                  </span>
                  <span className="nc-num flex-none">{m.units} un.</span>
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
