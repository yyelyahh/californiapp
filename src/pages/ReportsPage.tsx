import { useMemo, useState, Fragment } from "react";
import { useStore } from "@/context/StoreContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TrendingUp, TrendingDown, AlertTriangle, Lightbulb, Calendar, Tag, Activity, Package, DollarSign, Award,
  ShoppingBag, Flame, Snowflake, Minus
} from "lucide-react";
import {
  Period, periodFromPreset, inPeriod, preverReposicao, calcularGiro, calcularLucratividade,
  gerarHeatmap, gerarInsights, gerarAlertas, bestSellerInPeriod, WEEKDAY_LABELS, ReplenishStatus, GiroClass,
} from "@/lib/analytics";
import { format, parseISO, differenceInCalendarDays, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, BarChart, Bar, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const repColors: Record<ReplenishStatus, string> = {
  urgente: "bg-destructive/20 text-destructive border-destructive/30",
  alta_demanda: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  saudavel: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  baixa_saida: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  parado: "bg-muted text-muted-foreground border-border",
};

const giroColors: Record<GiroClass, string> = {
  rapido: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  medio: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  lento: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  encalhado: "bg-destructive/20 text-destructive border-destructive/30",
};

const insightIcons = {
  "trend-up": TrendingUp,
  "trend-down": TrendingDown,
  "calendar": Calendar,
  "tag": Tag,
  "alert": AlertTriangle,
} as const;

export default function ReportsPage() {
  const store = useStore();
  const [preset, setPreset] = useState<"7d" | "30d" | "90d" | "365d">("30d");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [heatMode, setHeatMode] = useState<"count" | "revenue">("count");

  const period: Period = useMemo(() => periodFromPreset(preset), [preset]);

  const filteredSales = useMemo(() => {
    return store.sales.filter(s => {
      if (s.type !== "venda") return false;
      if (sellerFilter !== "all" && s.sellerId !== sellerFilter) return false;
      if (brandFilter !== "all") {
        const p = store.products.find(x => x.id === s.productId);
        if (!p || p.brand !== brandFilter) return false;
      }
      return true;
    });
  }, [store.sales, store.products, sellerFilter, brandFilter]);

  const filteredProducts = useMemo(() => {
    return brandFilter === "all" ? store.products : store.products.filter(p => p.brand === brandFilter);
  }, [store.products, brandFilter]);

  const brands = useMemo(() => {
    const set = new Set(store.products.map(p => p.brand).filter(Boolean));
    return Array.from(set).sort();
  }, [store.products]);

  const periodSales = useMemo(() => filteredSales.filter(s => inPeriod(s.date, period)), [filteredSales, period]);

  // KPIs
  const revenue = periodSales.reduce((a, s) => a + s.totalPrice, 0);
  const profit = periodSales.reduce((a, s) => {
    const p = store.products.find(x => x.id === s.productId);
    return a + (p ? (s.unitPrice - p.purchasePrice) * s.quantity : 0);
  }, 0);
  const ticket = periodSales.length > 0 ? revenue / periodSales.length : 0;
  const repRows = useMemo(() => preverReposicao(filteredProducts, filteredSales), [filteredProducts, filteredSales]);
  const giroRows = useMemo(() => calcularGiro(filteredProducts, filteredSales, period), [filteredProducts, filteredSales, period]);
  const profitRows = useMemo(() => calcularLucratividade(filteredProducts, filteredSales, period), [filteredProducts, filteredSales, period]);
  const insights = useMemo(() => gerarInsights(filteredProducts, filteredSales, period), [filteredProducts, filteredSales, period]);
  const alerts = useMemo(() => gerarAlertas(filteredProducts, filteredSales), [filteredProducts, filteredSales]);
  const heatmap = useMemo(() => gerarHeatmap(filteredSales, period), [filteredSales, period]);
  const bestSeller = useMemo(() => bestSellerInPeriod(filteredSales, store.sellers, period), [filteredSales, store.sellers, period]);

  const stoppedCount = repRows.filter(r => r.status === "parado" && r.product.stock > 0).length;

  // Tendência (linha) — vendas diárias
  const dailyTrend = useMemo(() => {
    const totalDays = differenceInCalendarDays(period.end, period.start) + 1;
    const map = new Map<string, number>();
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(period.start, i);
      map.set(format(d, "yyyy-MM-dd"), 0);
    }
    for (const s of periodSales) {
      const k = s.date.slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + s.totalPrice);
    }
    return Array.from(map.entries()).map(([date, value]) => ({
      date: format(parseISO(date), totalDays > 60 ? "dd/MM" : "dd/MM"),
      value,
    }));
  }, [periodSales, period]);

  // Comparação com período anterior
  const prevPeriod: Period = useMemo(() => {
    const len = differenceInCalendarDays(period.end, period.start) + 1;
    return { start: addDays(period.start, -len), end: addDays(period.start, -1) };
  }, [period]);
  const prevRevenue = filteredSales.filter(s => inPeriod(s.date, prevPeriod)).reduce((a, s) => a + s.totalPrice, 0);
  const revenueDelta = prevRevenue === 0 ? (revenue > 0 ? 100 : 0) : ((revenue - prevRevenue) / prevRevenue) * 100;

  // Top 5 produtos
  const top5 = useMemo(() => {
    return [...profitRows]
      .filter(r => r.qtySold > 0)
      .sort((a, b) => b.qtySold - a.qtySold)
      .slice(0, 5)
      .map(r => ({ name: `${r.product.model} * ${r.product.flavor}`.slice(0, 28), qty: r.qtySold, rev: r.totalRevenue }));
  }, [profitRows]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Activity size={22} /> Relatórios</h1>
            <p className="text-sm text-muted-foreground">Inteligência de vendas, estoque e lucratividade</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={preset} onValueChange={(v: any) => setPreset(v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="365d">Últimos 12 meses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sellerFilter} onValueChange={setSellerFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Vendedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos vendedores</SelectItem>
                {store.sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Marca" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas marcas</SelectItem>
                {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </header>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
            <TabsTrigger value="replenish">Reposição</TabsTrigger>
            <TabsTrigger value="turnover">Giro</TabsTrigger>
            <TabsTrigger value="profit">Lucratividade</TabsTrigger>
          </TabsList>

          {/* ============ VISÃO GERAL ============ */}
          <TabsContent value="overview" className="space-y-5 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPI label="Faturamento" value={fmtBRL(revenue)} icon={DollarSign} hint="Soma das vendas no período" sub={`${revenueDelta >= 0 ? "+" : ""}${revenueDelta.toFixed(1)}% vs anterior`} subPositive={revenueDelta >= 0} />
              <KPI label="Lucro est." value={fmtBRL(profit)} icon={TrendingUp} hint="Receita − custo de compra dos itens vendidos" />
              <KPI label="Ticket médio" value={fmtBRL(ticket)} icon={ShoppingBag} hint="Faturamento ÷ nº de vendas" />
              <KPI label="Vendas" value={String(periodSales.length)} icon={Activity} hint="Quantidade de vendas no período" />
              <KPI label="Produtos parados" value={String(stoppedCount)} icon={Snowflake} hint="Produtos com estoque e sem vendas em 30 dias" accent={stoppedCount > 0} />
              <KPI label="Alertas" value={String(alerts.length)} icon={AlertTriangle} hint="Eventos que merecem atenção" accent={alerts.length > 0} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="glass-card p-5 lg:col-span-2">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Tendência de vendas</h2>
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={dailyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `R$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} formatter={(v: number) => fmtBRL(v)} />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-4">
                <div className="glass-card p-5">
                  <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><Award size={14} /> Melhor vendedor</h2>
                  {bestSeller ? (
                    <>
                      <p className="text-lg font-semibold">{bestSeller.seller.name}</p>
                      <p className="text-xl mono text-primary">{fmtBRL(bestSeller.revenue)}</p>
                    </>
                  ) : <p className="text-muted-foreground text-sm">Sem vendas no período.</p>}
                </div>

                <div className="glass-card p-5">
                  <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Top 5 produtos</h2>
                  {top5.length === 0 ? <p className="text-muted-foreground text-sm">Sem dados.</p> : (
                    <div className="space-y-2">
                      {top5.map(t => (
                        <div key={t.name} className="flex items-center justify-between text-sm">
                          <span className="truncate mr-2">{t.name}</span>
                          <span className="mono text-primary font-medium">{t.qty} un.</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="glass-card p-5">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><Lightbulb size={14} /> Insights automáticos</h2>
                {insights.length === 0 ? <p className="text-muted-foreground text-sm">Ainda sem insights — registre mais vendas.</p> : (
                  <ul className="space-y-2">
                    {insights.map((i, idx) => {
                      const Icon = insightIcons[i.icon];
                      return (
                        <li key={idx} className="flex gap-2 text-sm border border-border rounded-lg p-3 bg-card/50">
                          <Icon size={16} className="text-primary mt-0.5 shrink-0" />
                          <span>{i.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="glass-card p-5">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><AlertTriangle size={14} /> Alertas</h2>
                {alerts.length === 0 ? <p className="text-muted-foreground text-sm">Tudo em ordem 👌</p> : (
                  <ul className="space-y-2 max-h-72 overflow-auto">
                    {alerts.slice(0, 20).map((a, idx) => (
                      <li key={idx} className={cn(
                        "border rounded-lg p-3 text-sm",
                        a.severity === "danger" && "border-destructive/30 bg-destructive/10",
                        a.severity === "warning" && "border-orange-500/30 bg-orange-500/10",
                        a.severity === "info" && "border-border bg-card/50",
                      )}>
                        <p className="font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.detail}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ============ HEATMAP ============ */}
          <TabsContent value="heatmap" className="mt-4 space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold">Heatmap de vendas</h2>
                  <p className="text-xs text-muted-foreground">Dia da semana × semana — verde = alto, vermelho = baixo</p>
                </div>
                <Select value={heatMode} onValueChange={(v: any) => setHeatMode(v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">Quantidade de vendas</SelectItem>
                    <SelectItem value="revenue">Faturamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Heatmap cells={heatmap} mode={heatMode} />
            </div>

            <WeekdayBars cells={heatmap} mode={heatMode} />
          </TabsContent>

          {/* ============ REPOSIÇÃO ============ */}
          <TabsContent value="replenish" className="mt-4">
            <div className="glass-card p-5 overflow-x-auto">
              <h2 className="text-base font-bold mb-1">Indicadores de reposição</h2>
              <p className="text-xs text-muted-foreground mb-4">Velocidade calculada nos últimos 30 dias.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3">Produto</th>
                    <th className="py-2 pr-3 text-right">Estoque</th>
                    <th className="py-2 pr-3 text-right">Vel/sem</th>
                    <th className="py-2 pr-3 text-right">Dias restantes</th>
                    <th className="py-2 pr-3 text-right">Sugestão</th>
                    <th className="py-2 pr-3">Tendência</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...repRows].sort((a, b) => a.daysLeft - b.daysLeft).map(r => (
                    <tr key={r.product.id} className="border-b border-border/50">
                      <td className="py-2 pr-3">{r.product.model} <span className="text-muted-foreground">* {r.product.flavor}</span></td>
                      <td className="py-2 pr-3 text-right mono">{r.stock}</td>
                      <td className="py-2 pr-3 text-right mono">{r.perWeek.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-right mono">{Number.isFinite(r.daysLeft) ? Math.ceil(r.daysLeft) : "—"}</td>
                      <td className="py-2 pr-3 text-right mono">{r.suggested > 0 ? `+${r.suggested}` : "—"}</td>
                      <td className="py-2 pr-3">
                        {r.trend.dir === "up" && <span className="text-emerald-400 inline-flex items-center gap-1"><TrendingUp size={14} /> +{r.trend.delta.toFixed(0)}%</span>}
                        {r.trend.dir === "down" && <span className="text-destructive inline-flex items-center gap-1"><TrendingDown size={14} /> {r.trend.delta.toFixed(0)}%</span>}
                        {r.trend.dir === "flat" && <span className="text-muted-foreground inline-flex items-center gap-1"><Minus size={14} /></span>}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={cn("border", repColors[r.status])}>{r.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ============ GIRO ============ */}
          <TabsContent value="turnover" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["rapido", "medio", "lento", "encalhado"] as GiroClass[]).map(c => {
                const count = giroRows.filter(g => g.classification === c).length;
                const labels: Record<GiroClass, string> = { rapido: "Giro rápido", medio: "Giro médio", lento: "Giro lento", encalhado: "Encalhados" };
                const Icon = c === "rapido" ? Flame : c === "encalhado" ? Snowflake : Package;
                return (
                  <div key={c} className={cn("p-4 rounded-xl border", giroColors[c])}>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider"><Icon size={14} />{labels[c]}</div>
                    <p className="text-2xl font-bold mt-1 mono">{count}</p>
                  </div>
                );
              })}
            </div>

            <div className="glass-card p-5 overflow-x-auto">
              <h2 className="text-base font-bold mb-4">Giro de estoque</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3">Produto</th>
                    <th className="py-2 pr-3 text-right">Vendido</th>
                    <th className="py-2 pr-3 text-right">Última venda</th>
                    <th className="py-2 pr-3 text-right">Sem mover (d)</th>
                    <th className="py-2 pr-3 text-right">Giro mensal</th>
                    <th className="py-2 pr-3">Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {[...giroRows].sort((a, b) => b.monthlyTurnover - a.monthlyTurnover).map(g => (
                    <tr key={g.product.id} className="border-b border-border/50">
                      <td className="py-2 pr-3">{g.product.model} <span className="text-muted-foreground">* {g.product.flavor}</span></td>
                      <td className="py-2 pr-3 text-right mono">{g.totalSold}</td>
                      <td className="py-2 pr-3 text-right mono">{g.lastSaleDate ? format(parseISO(g.lastSaleDate), "dd/MM/yy") : "—"}</td>
                      <td className="py-2 pr-3 text-right mono">{g.daysSinceLastSale ?? "—"}</td>
                      <td className="py-2 pr-3 text-right mono">{g.monthlyTurnover.toFixed(2)}</td>
                      <td className="py-2 pr-3"><Badge variant="outline" className={cn("border", giroColors[g.classification])}>{g.classLabel}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ============ LUCRATIVIDADE ============ */}
          <TabsContent value="profit" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <RankingCard title="Mais lucrativos" icon={TrendingUp} rows={[...profitRows].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5)} render={r => fmtBRL(r.totalProfit)} positive />
              <RankingCard title="Piores margens" icon={TrendingDown} rows={[...profitRows].filter(r => r.product.salePrice > 0).sort((a, b) => a.marginPct - b.marginPct).slice(0, 5)} render={r => `${r.marginPct.toFixed(1)}%`} />
              <RankingCard title="Ocupam estoque sem retorno" icon={Snowflake} rows={[...profitRows].filter(r => r.product.stock > 0).sort((a, b) => (b.product.stock * b.product.purchasePrice - b.totalProfit) - (a.product.stock * a.product.purchasePrice - a.totalProfit)).slice(0, 5)} render={r => `${r.product.stock} un.`} />
            </div>

            <div className="glass-card p-5 overflow-x-auto">
              <h2 className="text-base font-bold mb-4">Lucratividade por produto</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3">Produto</th>
                    <th className="py-2 pr-3 text-right">Vendido</th>
                    <th className="py-2 pr-3 text-right">Receita</th>
                    <th className="py-2 pr-3 text-right">Margem un.</th>
                    <th className="py-2 pr-3 text-right">Margem %</th>
                    <th className="py-2 pr-3 text-right">Lucro</th>
                    <th className="py-2 pr-3 text-right">ROI estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {[...profitRows].sort((a, b) => b.totalProfit - a.totalProfit).map(r => (
                    <tr key={r.product.id} className="border-b border-border/50">
                      <td className="py-2 pr-3">{r.product.model} <span className="text-muted-foreground">* {r.product.flavor}</span></td>
                      <td className="py-2 pr-3 text-right mono">{r.qtySold}</td>
                      <td className="py-2 pr-3 text-right mono">{fmtBRL(r.totalRevenue)}</td>
                      <td className="py-2 pr-3 text-right mono">{fmtBRL(r.unitMargin)}</td>
                      <td className="py-2 pr-3 text-right mono">{r.marginPct.toFixed(1)}%</td>
                      <td className={cn("py-2 pr-3 text-right mono", r.totalProfit >= 0 ? "text-emerald-400" : "text-destructive")}>{fmtBRL(r.totalProfit)}</td>
                      <td className="py-2 pr-3 text-right mono">{r.roi.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

function KPI({ label, value, icon: Icon, hint, sub, subPositive, accent }: { label: string; value: string; icon: any; hint: string; sub?: string; subPositive?: boolean; accent?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("stat-card", accent && "stat-card-accent")}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
            <Icon size={14} className={accent ? "text-accent" : "text-primary"} />
          </div>
          <p className="text-lg font-bold mono">{value}</p>
          {sub && <p className={cn("text-[10px] mt-0.5", subPositive ? "text-emerald-400" : "text-destructive")}>{sub}</p>}
        </div>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function Heatmap({ cells, mode }: { cells: ReturnType<typeof gerarHeatmap>; mode: "count" | "revenue" }) {
  const values = cells.map(c => mode === "count" ? c.count : c.revenue);
  const max = Math.max(...values, 1);
  const weeks = Math.max(...cells.map(c => c.weekIndex)) + 1;

  function colorFor(v: number) {
    if (v <= 0) return "hsl(var(--muted))";
    const ratio = v / max; // 0 → red, 0.5 → yellow, 1 → green
    const hue = ratio * 120; // 0 = red, 60 = yellow, 120 = green
    const alpha = 0.25 + ratio * 0.55;
    return `hsl(${hue} 70% 45% / ${alpha})`;
  }

  // Build grid: 7 rows (weekdays) × N columns (weeks)
  const grid: (typeof cells[number] | null)[][] = Array.from({ length: 7 }, () => Array(weeks).fill(null));
  for (const c of cells) grid[c.weekday][c.weekIndex] = c;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `auto repeat(${weeks}, minmax(28px, 1fr))` }}>
        <div />
        {Array.from({ length: weeks }).map((_, w) => (
          <div key={w} className="text-[10px] text-muted-foreground text-center">S{w + 1}</div>
        ))}
        {WEEKDAY_LABELS.map((wd, i) => (
          <Fragment key={`row-${i}`}>
            <div className="text-[10px] text-muted-foreground pr-2 flex items-center">{wd}</div>
            {grid[i].map((cell, w) => {
              const v = cell ? (mode === "count" ? cell.count : cell.revenue) : 0;
              return (
                <Tooltip key={`${i}-${w}`}>
                  <TooltipTrigger asChild>
                    <div className="h-7 rounded" style={{ background: colorFor(v) }} />
                  </TooltipTrigger>
                  <TooltipContent>
                    {cell ? (
                      <div className="text-xs">
                        <p className="font-medium">{format(parseISO(cell.date), "EEEE dd/MM/yyyy", { locale: ptBR })}</p>
                        <p>{cell.count} venda(s) · {fmtBRL(cell.revenue)}</p>
                      </div>
                    ) : "—"}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </Fragment>

        ))}
      </div>
    </div>
  );
}

function WeekdayBars({ cells, mode }: { cells: ReturnType<typeof gerarHeatmap>; mode: "count" | "revenue" }) {
  const data = WEEKDAY_LABELS.map((label, i) => {
    const v = cells.filter(c => c.weekday === i).reduce((a, c) => a + (mode === "count" ? c.count : c.revenue), 0);
    return { label, value: v };
  });
  const max = Math.max(...data.map(d => d.value), 1);
  const best = data.reduce((a, b) => b.value > a.value ? b : a);
  const worst = data.reduce((a, b) => b.value < a.value ? b : a);
  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Total por dia da semana</h3>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => mode === "revenue" ? `R$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}` : String(v)} />
            <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} formatter={(v: number) => mode === "revenue" ? fmtBRL(v) : `${v} venda(s)`} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {data.map((d, i) => {
                const ratio = d.value / max;
                const hue = ratio * 120;
                return <Cell key={i} fill={`hsl(${hue} 70% 45%)`} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground mt-3">Melhor dia: <span className="text-emerald-400 font-medium">{best.label}</span> · Pior dia: <span className="text-destructive font-medium">{worst.label}</span></p>
    </div>
  );
}

function RankingCard({ title, icon: Icon, rows, render, positive }: { title: string; icon: any; rows: any[]; render: (r: any) => string; positive?: boolean }) {
  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2"><Icon size={14} /> {title}</h3>
      {rows.length === 0 ? <p className="text-muted-foreground text-sm">Sem dados.</p> : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.product.id} className="flex items-center justify-between text-sm">
              <span className="truncate mr-2"><span className="text-muted-foreground mr-1">{i + 1}.</span>{r.product.model} * {r.product.flavor}</span>
              <span className={cn("mono font-medium", positive ? "text-emerald-400" : "text-foreground")}>{render(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
