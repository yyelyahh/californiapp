import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, DollarSign, Package, ShoppingCart, Receipt } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default function Dashboard() {
  const store = useStore();
  const revenue = store.getTotalRevenue();
  const costs = store.getTotalCosts();
  const expenses = store.getTotalExpenses();
  const invested = store.getTotalInvested();
  const profit = store.getNetProfit();
  const totalStock = store.products.reduce((s, p) => s + p.stock, 0);

  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);
      const interval = { start, end };

      const monthRevenue = store.sales
        .filter(s => s.type === "venda" && isWithinInterval(parseISO(s.date), interval))
        .reduce((sum, s) => sum + s.totalPrice, 0);
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

  const stats = [
    { label: "Receita Total", value: formatCurrency(revenue), icon: TrendingUp, accent: false },
    { label: "Custos (Compra)", value: formatCurrency(costs), icon: DollarSign, accent: true },
    { label: "Despesas", value: formatCurrency(expenses), icon: Receipt, accent: true },
    { label: "Lucro Líquido", value: formatCurrency(profit), icon: profit >= 0 ? TrendingUp : TrendingDown, accent: false },
    { label: "Estoque Total", value: `${totalStock} un.`, icon: Package, accent: false },
    { label: "Capital Investido", value: formatCurrency(invested), icon: DollarSign, accent: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Visão geral do seu negócio de pods</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`stat-card ${s.accent ? "stat-card-accent" : ""}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <s.icon size={16} className={s.accent ? "text-accent" : "text-primary"} />
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
            <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
              <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `R$${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} />
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
                    const productLabel = product ? `${product.model} * ${product.flavor}` : store.getProductName(s.productId);

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
