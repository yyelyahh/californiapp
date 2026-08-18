import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval, differenceInCalendarDays, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Trophy,
  Coins,
  Repeat,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
} from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import { listItem } from "@/lib/motion";

type Period = "month" | "lastMonth" | "custom";
type OpenCard = null | "lowStock" | "topSold" | "topProfit" | "turnover";
type ProfitSort = "abs" | "margin";

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;
const fmtRatio = (v: number) => v.toFixed(2).replace(".", ",");

export default function InsightsPage() {
  const { products, sales, stockEntries, stockLosses } = useStore();
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [openCard, setOpenCard] = useState<OpenCard>(null);
  const [profitSort, setProfitSort] = useState<ProfitSort>("abs");

  const { start, end, prevStart, prevEnd, label } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date, l: string;
    if (period === "month") {
      s = startOfMonth(now); e = endOfMonth(now);
      l = format(now, "MMMM/yyyy", { locale: ptBR });
    } else if (period === "lastMonth") {
      const prev = subMonths(now, 1);
      s = startOfMonth(prev); e = endOfMonth(prev);
      l = format(prev, "MMMM/yyyy", { locale: ptBR });
    } else {
      try { s = parseISO(customStart); } catch { s = startOfMonth(now); }
      try { e = parseISO(customEnd); } catch { e = endOfMonth(now); }
      if (e < s) e = s;
      l = `${format(s, "dd/MM/yyyy")} – ${format(e, "dd/MM/yyyy")}`;
    }
    const days = differenceInCalendarDays(e, s) + 1;
    const pe = addDays(s, -1);
    const ps = addDays(pe, -(days - 1));
    return { start: s, end: e, prevStart: ps, prevEnd: pe, label: l };
  }, [period, customStart, customEnd]);

  const inRange = (iso: string, s: Date, e: Date) => {
    try { return isWithinInterval(parseISO(iso), { start: s, end: e }); } catch { return false; }
  };
  const inPeriod = (iso: string) => inRange(iso, start, end);
  const inPrev = (iso: string) => inRange(iso, prevStart, prevEnd);
  const afterEnd = (iso: string) => {
    try { return parseISO(iso) > end; } catch { return false; }
  };

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const modelKey = (brand: string, model: string) => `${brand} ${model}`.trim();

  // ---- Card 1: Estoque Baixo (por modelo) ----
  const lowStockModels = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; stock: number; minStock: number; items: number }>();
    for (const p of products) {
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? { key, brand: p.brand, model: p.model, stock: 0, minStock: 0, items: 0 };
      entry.stock += p.stock;
      entry.minStock = Math.max(entry.minStock, p.minStock || 0);
      entry.items += 1;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .filter(m => m.minStock > 0 && m.stock < m.minStock)
      .map(m => ({ ...m, deficit: m.minStock - m.stock }))
      .sort((a, b) => b.deficit - a.deficit);
  }, [products]);

  // ---- Sales helpers ----
  const periodSales = useMemo(
    () => sales.filter(s => s.type === "venda" && inPeriod(s.date)),
    [sales, start, end]
  );
  const prevPeriodSales = useMemo(
    () => sales.filter(s => s.type === "venda" && inPrev(s.date)),
    [sales, prevStart, prevEnd]
  );

  const buildModelStats = (list: typeof sales) => {
    const map = new Map<string, {
      key: string; brand: string; model: string;
      units: number; revenue: number; cost: number; profit: number;
    }>();
    for (const s of list) {
      const p = productMap[s.productId];
      if (!p) continue;
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? {
        key, brand: p.brand, model: p.model,
        units: 0, revenue: 0, cost: 0, profit: 0,
      };
      entry.units += s.quantity;
      entry.revenue += s.totalPrice;
      entry.cost += p.purchasePrice * s.quantity;
      entry.profit += (s.unitPrice - p.purchasePrice) * s.quantity;
      map.set(key, entry);
    }
    return Array.from(map.values());
  };

  const modelStats = useMemo(() => buildModelStats(periodSales), [periodSales, productMap]);
  const prevModelStats = useMemo(() => buildModelStats(prevPeriodSales), [prevPeriodSales, productMap]);

  const totalUnits = modelStats.reduce((s, m) => s + m.units, 0);
  const totalRevenue = modelStats.reduce((s, m) => s + m.revenue, 0);
  const totalProfit = modelStats.reduce((s, m) => s + m.profit, 0);
  const prevTotalProfit = prevModelStats.reduce((s, m) => s + m.profit, 0);
  const prevTotalUnits = prevModelStats.reduce((s, m) => s + m.units, 0);

  const topSold = useMemo(() => [...modelStats].sort((a, b) => b.units - a.units), [modelStats]);

  const topProfit = useMemo(() => {
    const withMargin = modelStats.map(m => ({
      ...m,
      margin: m.revenue > 0 ? m.profit / m.revenue : 0,
    }));
    return withMargin.sort((a, b) => profitSort === "abs" ? b.profit - a.profit : b.margin - a.margin);
  }, [modelStats, profitSort]);

  // ---- Card 4: Estoque inicial/final e giro ----
  const turnover = useMemo(() => {
    // Aggregate current stock, period entries/sales/losses, and post-period movements by model
    const map = new Map<string, {
      key: string; brand: string; model: string;
      currentStock: number;
      entered: number;
      sold: number;
      lost: number;
      enteredAfter: number;
      soldAfter: number;
      lostAfter: number;
    }>();
    const ensure = (brand: string, model: string) => {
      const key = modelKey(brand, model);
      let entry = map.get(key);
      if (!entry) {
        entry = { key, brand, model, currentStock: 0, entered: 0, sold: 0, lost: 0, enteredAfter: 0, soldAfter: 0, lostAfter: 0 };
        map.set(key, entry);
      }
      return entry;
    };
    for (const p of products) ensure(p.brand, p.model).currentStock += p.stock;
    for (const e of stockEntries) {
      const p = productMap[e.productId]; if (!p) continue;
      if (inPeriod(e.date)) ensure(p.brand, p.model).entered += e.quantity;
      else if (afterEnd(e.date)) ensure(p.brand, p.model).enteredAfter += e.quantity;
    }
    for (const s of sales) {
      if (s.type !== "venda") continue;
      const p = productMap[s.productId]; if (!p) continue;
      if (inPeriod(s.date)) ensure(p.brand, p.model).sold += s.quantity;
      else if (afterEnd(s.date)) ensure(p.brand, p.model).soldAfter += s.quantity;
    }
    for (const l of stockLosses) {
      const p = productMap[l.productId]; if (!p) continue;
      if (inPeriod(l.date)) ensure(p.brand, p.model).lost += l.quantity;
      else if (afterEnd(l.date)) ensure(p.brand, p.model).lostAfter += l.quantity;
    }
    return Array.from(map.values())
      .map(t => {
        // Stock at end of period = current - (movements strictly after end)
        const finalStock = t.currentStock - t.enteredAfter + t.soldAfter + t.lostAfter;
        // Stock at start of period = final - period_movements
        const initialStock = finalStock - t.entered + t.sold + t.lost;
        const avg = (initialStock + finalStock) / 2;
        const ratio = avg > 0 ? t.sold / avg : (t.sold > 0 ? Infinity : 0);
        return { ...t, initialStock, finalStock, avg, ratio };
      })
      .filter(t => t.entered > 0 || t.sold > 0 || t.lost > 0 || t.initialStock > 0 || t.finalStock > 0)
      .sort((a, b) => {
        const ra = a.ratio === Infinity ? 999 : a.ratio;
        const rb = b.ratio === Infinity ? 999 : b.ratio;
        return rb - ra;
      });
  }, [products, stockEntries, sales, stockLosses, productMap, start, end]);

  const bestSeller = topSold[0];
  const bestSellerPct = bestSeller && totalUnits > 0 ? bestSeller.units / totalUnits : 0;
  const bestProfit = topProfit[0];
  const bestTurn = turnover.find(t => t.avg > 0 && t.sold > 0);

  // Trends
  const prevBestSeller = useMemo(() => [...prevModelStats].sort((a, b) => b.units - a.units)[0], [prevModelStats]);
  const bestSellerPrevUnits = useMemo(() => {
    if (!bestSeller) return 0;
    const match = prevModelStats.find(m => m.key === bestSeller.key);
    return match?.units ?? 0;
  }, [bestSeller, prevModelStats]);
  const bestSellerChange = bestSellerPrevUnits > 0 && bestSeller
    ? (bestSeller.units - bestSellerPrevUnits) / bestSellerPrevUnits
    : null;
  const profitChange = prevTotalProfit !== 0
    ? (totalProfit - prevTotalProfit) / Math.abs(prevTotalProfit)
    : null;
  const unitsChange = prevTotalUnits > 0
    ? (totalUnits - prevTotalUnits) / prevTotalUnits
    : null;

  // Participation chart data
  const participation = useMemo(() => {
    if (totalUnits === 0) return [];
    return topSold.slice(0, 10).map(m => ({
      key: m.key,
      label: m.model || m.brand,
      brand: m.brand,
      units: m.units,
      pct: m.units / totalUnits,
    }));
  }, [topSold, totalUnits]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
          <p className="text-xs text-muted-foreground">Indicadores do negócio · {label}</p>
        </div>
      </header>

      {/* Filtro de período */}
      <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5 flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Mês atual</SelectItem>
            <SelectItem value="lastMonth">Mês anterior</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        {period === "custom" && (
          <>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-xs w-[150px]" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-xs w-[150px]" />
          </>
        )}
      </div>

      {/* Cards */}
      <Stagger className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <InsightCard
          icon={<AlertTriangle size={16} />}
          tone={lowStockModels.length > 0 ? "destructive" : "muted"}
          label="Estoque Baixo"
          value={String(lowStockModels.length)}
          hint={lowStockModels.length === 0 ? "Todos os modelos ok" : "modelo(s) abaixo do mínimo"}
          onClick={() => setOpenCard("lowStock")}
        />
        <InsightCard
          icon={<Trophy size={16} />}
          tone="income"
          label="Modelo mais vendido"
          value={bestSeller ? bestSeller.model || bestSeller.brand : "—"}
          hint={bestSeller ? `${bestSeller.units} un · ${fmtPct(bestSellerPct)} das vendas` : "Sem vendas no período"}
          onClick={() => setOpenCard("topSold")}
        />
        <InsightCard
          icon={<Coins size={16} />}
          tone="primary"
          label="Mais lucrativo"
          value={bestProfit ? bestProfit.model || bestProfit.brand : "—"}
          hint={bestProfit ? `${fmtCurrency(bestProfit.profit)} · ${fmtPct(bestProfit.margin)}` : "Sem vendas no período"}
          onClick={() => setOpenCard("topProfit")}
        />
        <InsightCard
          icon={<Repeat size={16} />}
          tone="warning"
          label="Melhor giro"
          value={bestTurn ? bestTurn.model || bestTurn.brand : "—"}
          hint={bestTurn ? `giro ${fmtRatio(bestTurn.ratio)} · ${bestTurn.sold} un vendidas` : "Sem giro no período"}
          onClick={() => setOpenCard("turnover")}
        />
      </Stagger>

      {/* Tendências */}
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Tendências vs. período anterior</h2>
          <span className="text-[11px] text-muted-foreground">
            ({format(prevStart, "dd/MM")} – {format(prevEnd, "dd/MM")})
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TrendItem
            label="Modelo campeão"
            main={bestSeller ? (bestSeller.model || bestSeller.brand) : "—"}
            sub={bestSeller
              ? (bestSellerPrevUnits > 0
                ? `${bestSeller.units} un vs ${bestSellerPrevUnits} un anteriores`
                : `${bestSeller.units} un · sem histórico anterior`)
              : "sem vendas"}
            change={bestSellerChange}
            hint={prevBestSeller && bestSeller && prevBestSeller.key !== bestSeller.key
              ? `Antes: ${prevBestSeller.model || prevBestSeller.brand}` : null}
          />
          <TrendItem
            label="Lucro do período"
            main={fmtCurrency(totalProfit)}
            sub={`Anterior: ${fmtCurrency(prevTotalProfit)}`}
            change={profitChange}
          />
          <TrendItem
            label="Unidades vendidas"
            main={`${totalUnits} un`}
            sub={`Anterior: ${prevTotalUnits} un`}
            change={unitsChange}
          />
        </div>
      </div>

      {/* Participação nas vendas */}
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Participação nas vendas</h2>
          <span className="text-[11px] text-muted-foreground">por modelo · top 10</span>
        </div>
        {participation.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
        ) : (
          <div className="space-y-2">
            {participation.map(m => (
              <div key={m.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="truncate pr-2">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted-foreground"> · {m.brand}</span>
                  </span>
                  <span className="mono text-muted-foreground shrink-0">
                    {m.units} un · <span className="text-foreground font-semibold">{fmtPct(m.pct)}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${m.pct * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawer: Low stock */}
      <Sheet open={openCard === "lowStock"} onOpenChange={v => !v && setOpenCard(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Modelos abaixo do mínimo</SheetTitle>
            <SheetDescription>Estoque total do modelo (somando todos os sabores) menor que o mínimo configurado.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {lowStockModels.length === 0 && <p className="text-sm text-muted-foreground">Nenhum modelo abaixo do mínimo.</p>}
            {lowStockModels.map(m => (
              <div key={m.key} className="rounded-lg border border-border bg-card/40 px-3 py-2 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.model || m.brand}</p>
                  <p className="text-[11px] text-muted-foreground">{m.brand} · {m.items} sabor(es)</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-semibold mono text-destructive">{m.stock}</p>
                  <p className="text-[11px] text-muted-foreground">mín. {m.minStock}</p>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Drawer: Top sold */}
      <Sheet open={openCard === "topSold"} onOpenChange={v => !v && setOpenCard(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Modelos mais vendidos</SheetTitle>
            <SheetDescription>{label} · Total: {totalUnits} unidades</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {topSold.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
            {topSold.map((m, i) => {
              const pct = totalUnits > 0 ? m.units / totalUnits : 0;
              return (
                <div key={m.key} className="rounded-lg border border-border bg-card/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{i === 0 && "🥇 "}{m.model || m.brand}</p>
                    <p className="text-sm font-semibold mono">{m.units} un</p>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full bg-income" style={{ width: `${pct * 100}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{fmtPct(pct)} das vendas · {m.brand}</p>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Drawer: Top profit */}
      <Sheet open={openCard === "topProfit"} onOpenChange={v => !v && setOpenCard(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Modelos mais lucrativos</SheetTitle>
            <SheetDescription>{label} · (Preço venda − custo) × unidades</SheetDescription>
          </SheetHeader>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setProfitSort("abs")}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium border transition-colors",
                profitSort === "abs" ? "bg-primary/15 text-primary border-primary/40" : "border-border text-muted-foreground"
              )}
            >Maior lucro</button>
            <button
              onClick={() => setProfitSort("margin")}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium border transition-colors",
                profitSort === "margin" ? "bg-primary/15 text-primary border-primary/40" : "border-border text-muted-foreground"
              )}
            >Maior margem</button>
          </div>
          <div className="mt-3 space-y-2">
            {topProfit.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
            {topProfit.map(m => (
              <div key={m.key} className="rounded-lg border border-border bg-card/40 px-3 py-2 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.model || m.brand}</p>
                  <p className="text-[11px] text-muted-foreground">{m.brand} · {m.units} un · receita {fmtCurrency(m.revenue)}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className={cn("text-sm font-semibold mono", m.profit >= 0 ? "text-income" : "text-destructive")}>
                    {fmtCurrency(m.profit)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">margem {fmtPct(m.margin)}</p>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Drawer: Turnover */}
      <Sheet open={openCard === "turnover"} onOpenChange={v => !v && setOpenCard(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Giro de estoque</SheetTitle>
            <SheetDescription>{label} · Vendidos ÷ estoque médio ((inicial + final) / 2)</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {turnover.length === 0 && <p className="text-sm text-muted-foreground">Sem movimentação no período.</p>}
            {turnover.map(t => (
              <div key={t.key} className="rounded-lg border border-border bg-card/40 px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium truncate">{t.model || t.brand}</p>
                  {t.avg > 0 && t.sold > 0 ? (
                    <p className={cn(
                      "text-sm font-semibold mono",
                      t.ratio >= 1 ? "text-income" : t.ratio >= 0.5 ? "text-warning" : "text-muted-foreground"
                    )}>giro {fmtRatio(t.ratio)}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">sem giro</p>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-2 text-[11px]">
                  <MovCell label="Inicial" value={t.initialStock} />
                  <MovCell label="Entradas" value={`+${t.entered}`} tone="income" />
                  <MovCell label="Vendas" value={`-${t.sold}`} tone="destructive" />
                  <MovCell label="Final" value={t.finalStock} strong />
                </div>
                {t.lost > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">Perdas no período: -{t.lost} un</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Estoque médio: {fmtRatio(t.avg)} un · {t.brand}
                </p>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MovCell({ label, value, tone, strong }: { label: string; value: number | string; tone?: "income" | "destructive"; strong?: boolean }) {
  const toneClass = tone === "income" ? "text-income" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mono", strong ? "font-semibold" : "font-medium", toneClass)}>{value}</p>
    </div>
  );
}

function TrendItem({
  label, main, sub, change, hint,
}: {
  label: string; main: string; sub: string;
  change: number | null; hint?: string | null;
}) {
  const dir = change === null ? "flat" : change > 0.001 ? "up" : change < -0.001 ? "down" : "flat";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const toneClass = dir === "up" ? "text-income" : dir === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold tracking-tight truncate mt-0.5">{main}</p>
      <div className="flex items-center gap-1 mt-1">
        <Icon size={12} className={toneClass} />
        <span className={cn("text-xs font-semibold mono", toneClass)}>
          {change === null ? "s/ base" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`}
        </span>
        <span className="text-[11px] text-muted-foreground truncate">· {sub}</span>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function InsightCard({
  icon, label, value, hint, tone = "muted", onClick,
}: {
  icon: React.ReactNode; label: string; value: string; hint: string;
  tone?: "muted" | "income" | "primary" | "warning" | "destructive";
  onClick: () => void;
}) {
  const toneClass = {
    muted: "text-muted-foreground",
    income: "text-income",
    primary: "text-primary",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];
  return (
    <motion.button
      variants={listItem}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card hover:border-border/80 transition-colors group"
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <span className={toneClass}>{icon}</span>
      </div>
      <p className={cn("mt-2 text-xl font-bold tracking-tight truncate", toneClass)}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{hint}</p>
    </motion.button>
  );
}
