import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Trophy,
  Coins,
  Repeat,
  ArrowRight,
} from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Period = "month" | "lastMonth" | "custom";
type OpenCard = null | "lowStock" | "topSold" | "topProfit" | "turnover";
type ProfitSort = "abs" | "margin";

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;

export default function InsightsPage() {
  const { products, sales, stockEntries } = useStore();
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [openCard, setOpenCard] = useState<OpenCard>(null);
  const [profitSort, setProfitSort] = useState<ProfitSort>("abs");

  const { start, end, label } = useMemo(() => {
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
    return { start: s, end: e, label: l };
  }, [period, customStart, customEnd]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const modelKey = (brand: string, model: string) => `${brand} ${model}`.trim();

  // ---- Card 1: Estoque Baixo (não depende de período) ----
  const lowStock = useMemo(() => {
    return products
      .filter(p => p.minStock > 0 && p.stock < p.minStock)
      .map(p => ({ ...p, deficit: p.minStock - p.stock }))
      .sort((a, b) => b.deficit - a.deficit);
  }, [products]);

  // ---- Vendas do período (type = venda) ----
  const periodSales = useMemo(
    () => sales.filter(s => s.type === "venda" && inPeriod(s.date)),
    [sales, start, end]
  );

  // ---- Card 2 & 3: agrupamento por modelo ----
  const modelStats = useMemo(() => {
    const map = new Map<string, {
      key: string; brand: string; model: string;
      units: number; revenue: number; cost: number; profit: number;
    }>();
    for (const s of periodSales) {
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
  }, [periodSales, productMap]);

  const totalUnits = modelStats.reduce((s, m) => s + m.units, 0);

  const topSold = useMemo(() => {
    return [...modelStats].sort((a, b) => b.units - a.units);
  }, [modelStats]);

  const topProfit = useMemo(() => {
    const withMargin = modelStats.map(m => ({
      ...m,
      margin: m.revenue > 0 ? m.profit / m.revenue : 0,
    }));
    return withMargin.sort((a, b) => profitSort === "abs" ? b.profit - a.profit : b.margin - a.margin);
  }, [modelStats, profitSort]);

  // ---- Card 4: Giro de estoque ----
  const turnover = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; entered: number; sold: number }>();
    for (const e of stockEntries) {
      if (!inPeriod(e.date)) continue;
      const p = productMap[e.productId]; if (!p) continue;
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? { key, brand: p.brand, model: p.model, entered: 0, sold: 0 };
      entry.entered += e.quantity;
      map.set(key, entry);
    }
    for (const s of periodSales) {
      const p = productMap[s.productId]; if (!p) continue;
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? { key, brand: p.brand, model: p.model, entered: 0, sold: 0 };
      entry.sold += s.quantity;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .map(t => ({ ...t, ratio: t.entered > 0 ? t.sold / t.entered : (t.sold > 0 ? Infinity : 0) }))
      .sort((a, b) => (b.ratio === Infinity ? 999 : b.ratio) - (a.ratio === Infinity ? 999 : a.ratio));
  }, [stockEntries, periodSales, productMap, start, end]);

  const bestSeller = topSold[0];
  const bestSellerPct = bestSeller && totalUnits > 0 ? bestSeller.units / totalUnits : 0;
  const bestProfit = topProfit[0];
  const bestTurn = turnover.find(t => t.entered > 0);

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
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <InsightCard
          icon={<AlertTriangle size={16} />}
          tone={lowStock.length > 0 ? "destructive" : "muted"}
          label="Estoque Baixo"
          value={String(lowStock.length)}
          hint={lowStock.length === 0 ? "Tudo dentro do mínimo" : "produto(s) abaixo do mínimo"}
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
          hint={bestTurn ? `${bestTurn.sold}/${bestTurn.entered} · ${fmtPct(bestTurn.sold / bestTurn.entered)}` : "Sem reposição no período"}
          onClick={() => setOpenCard("turnover")}
        />
      </div>

      {/* Drawer: Low stock */}
      <Sheet open={openCard === "lowStock"} onOpenChange={v => !v && setOpenCard(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Estoque abaixo do mínimo</SheetTitle>
            <SheetDescription>Produtos com quantidade atual menor que o estoque mínimo configurado.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {lowStock.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto abaixo do mínimo.</p>}
            {lowStock.map(p => (
              <div key={p.id} className="rounded-lg border border-border bg-card/40 px-3 py-2 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.flavor} · {p.model}</p>
                  <p className="text-[11px] text-muted-foreground">{p.brand}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-semibold mono text-destructive">{p.stock}</p>
                  <p className="text-[11px] text-muted-foreground">mín. {p.minStock}</p>
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
            <SheetDescription>{label} · Vendido ÷ Entrado no período</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {turnover.length === 0 && <p className="text-sm text-muted-foreground">Sem movimentação no período.</p>}
            {turnover.map(t => {
              const pct = t.entered > 0 ? t.sold / t.entered : null;
              return (
                <div key={t.key} className="rounded-lg border border-border bg-card/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{t.model || t.brand}</p>
                    {pct !== null ? (
                      <p className={cn(
                        "text-sm font-semibold mono",
                        pct >= 0.7 ? "text-income" : pct >= 0.3 ? "text-warning" : "text-muted-foreground"
                      )}>{fmtPct(pct)}</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">sem reposição</p>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>Entraram {t.entered}</span>
                    <ArrowRight size={11} />
                    <span>Vendidos {t.sold}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
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
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card hover:border-border/80 transition-colors group"
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <span className={toneClass}>{icon}</span>
      </div>
      <p className={cn("mt-2 text-xl font-bold tracking-tight truncate", toneClass)}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{hint}</p>
    </button>
  );
}
