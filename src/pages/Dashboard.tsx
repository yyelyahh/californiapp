import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, DollarSign, Package, ShoppingCart, Receipt } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
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
        .filter(s => isWithinInterval(parseISO(s.date), interval))
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
        <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Receita vs Custos (6 meses)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 18%)" />
              <XAxis dataKey="month" stroke="hsl(215 15% 55%)" fontSize={12} />
              <YAxis stroke="hsl(215 15% 55%)" fontSize={12} tickFormatter={v => `R$${v}`} />
              <Tooltip
                contentStyle={{ background: "hsl(220 18% 12%)", border: "1px solid hsl(220 14% 18%)", borderRadius: "8px", color: "hsl(210 20% 92%)" }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Bar dataKey="receita" fill="hsl(160 60% 45%)" radius={[4, 4, 0, 0]} name="Receita" />
              <Bar dataKey="custos" fill="hsl(38 90% 55%)" radius={[4, 4, 0, 0]} name="Custos" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {store.sales.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Últimas Vendas</h2>
          <div className="space-y-2">
            {store.sales.slice(-5).reverse().map(s => (
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
