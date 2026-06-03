import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, DollarSign, Package, Clock, AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const GERAL = "geral";

export default function Dashboard() {
  const store = useStore();
  const totalStock = store.products.reduce((s, p) => s + p.stock, 0);
  const investedCapital = store.getTotalInvested();

  // Opções de filtro: últimos 12 meses + Geral
  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: GERAL, label: "Geral (todo período)" }];
    for (let i = 0; i < 12; i++) {
      const d = subMonths(new Date(), i);
      opts.push({
        value: format(d, "yyyy-MM"),
        label: format(d, "MMMM/yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase()),
      });
    }
    return opts;
  }, []);

  const [filter, setFilter] = useState<string>(format(new Date(), "yyyy-MM"));

  // Calcula métricas de acordo com o filtro
  const periodStats = useMemo(() => {
    let filterFn: (dateISO: string) => boolean;
    if (filter === GERAL) {
      filterFn = () => true;
    } else {
      const [y, m] = filter.split("-").map(Number);
      const ref = new Date(y, m - 1, 15);
      const start = startOfMonth(ref);
      const end = endOfMonth(ref);
      filterFn = (dateISO: string) => isWithinInterval(parseISO(dateISO), { start, end });
    }

    const salesInPeriod = store.sales.filter(s => s.type === "venda" && filterFn(s.date));
    const revenue = salesInPeriod.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
    const receivable = salesInPeriod.reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.paidAmount || 0)), 0);
    const costs = store.stockEntries
      .filter(e => filterFn(e.date))
      .reduce((sum, e) => sum + e.totalCost, 0);
    const expenses = store.expenses
      .filter(e => filterFn(e.date))
      .reduce((sum, e) => sum + e.amount, 0);
    const losses = store.stockLosses
      .filter(l => filterFn(l.date))
      .reduce((sum, l) => sum + l.totalCost, 0);
    const profit = revenue - costs - expenses - losses;

    return { revenue, costs, expenses, profit, receivable, losses };
  }, [filter, store.sales, store.stockEntries, store.expenses, store.stockLosses]);

  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);
      const interval = { start, end };

      const monthRevenue = store.sales
        .filter(s => s.type === "venda" && isWithinInterval(parseISO(s.date), interval))
        .reduce((sum, s) => sum + (s.paidAmount || 0), 0);
      const monthCost = store.stockEntries
        .filter(e => isWithinInterval(parseISO(e.date), interval))
        .reduce((sum, e) => sum + e.totalCost, 0);
      const monthExpenses = store.expenses
        .filter(e => isWithinInterval(parseISO(e.date), interval))
        .reduce((sum, e) => sum + e.amount, 0);

      months.push({
        month: format(date, "MMM", { locale: ptBR }),
        receita: monthRevenue,
        custos: monthCost + monthExpenses,
      });
    }
    return months;
  }, [store.sales, store.stockEntries, store.expenses]);

  const filterLabel = monthOptions.find(o => o.value === filter)?.label ?? "";
  const isGeral = filter === GERAL;

  const stats = [
    { label: `Receita${isGeral ? " Total" : ""}`, value: formatCurrency(periodStats.revenue), icon: TrendingUp, accent: false },
    { label: "Custos (Compra)", value: formatCurrency(periodStats.costs), icon: DollarSign, accent: true },
    { label: "A Receber", value: formatCurrency(periodStats.receivable), icon: Clock, accent: true },
    { label: "Perdas", value: formatCurrency(periodStats.losses), icon: AlertTriangle, accent: true },
    { label: "Lucro Líquido", value: formatCurrency(periodStats.profit), icon: periodStats.profit >= 0 ? TrendingUp : TrendingDown, accent: false },
    // Estoque e capital investido são sempre "snapshot atual" - não dependem do mês
    { label: "Estoque Atual", value: `${totalStock} un.`, icon: Package, accent: false },
    { label: "Capital Investido", value: formatCurrency(investedCapital), icon: DollarSign, accent: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            {isGeral ? "Visão geral consolidada" : `Visão de ${filterLabel}`}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`stat-card ${s.accent ? "stat-card-accent" : ""}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <s.icon size={16} className={s.accent ? "text-income" : "text-primary"} />
            </div>
            <p className="text-xl font-bold mono">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-display font-bold">Evolução (6 meses)</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Receitas vs gastos totais</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--income))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(var(--income))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCustos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--expense))" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(var(--expense))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--foreground))" strokeOpacity={0.35} vertical={false} />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--foreground))" fontSize={13} tickLine={false} axisLine={false} width={68} ticks={[500, 1000, 1500, 2000, 3000, 4000]} domain={[0, (dataMax: number) => Math.max(4000, Math.ceil(dataMax / 1000) * 1000)]} tick={{ fill: "hsl(var(--foreground))", fontWeight: 600 }} tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(1).replace('.0','')}k` : `R$${v}`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "12px", color: "hsl(var(--foreground))", boxShadow: "var(--shadow-elevated)" }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Area type="monotone" dataKey="receita" stroke="hsl(var(--income))" strokeWidth={2.5} fill="url(#gradReceita)" name="Receita" />
              <Area type="monotone" dataKey="custos" stroke="hsl(var(--expense))" strokeWidth={2.5} fill="url(#gradCustos)" name="Custos" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {store.sales.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Últimas Vendas</h2>
          <div className="space-y-2">
            {store.sales.filter(s => s.type === "venda").slice(-5).reverse().map(s => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  {(() => {
                    const product = store.products.find(product => product.id === s.productId);
                    const productLabel = product ? `${product.flavor} · ${product.model}` : store.getProductName(s.productId);

                    return (
                      <>
                        <p className="text-sm font-medium">{productLabel}</p>
                        <p className="text-xs text-muted-foreground">{format(parseISO(s.date), "dd/MM/yyyy")} · {s.quantity} un.</p>
                      </>
                    );
                  })()}
                </div>
                <span className="text-sm font-semibold mono text-primary">{formatCurrency(s.totalPrice)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
