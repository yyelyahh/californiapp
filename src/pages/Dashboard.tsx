import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, Package, Clock, Wallet, Percent, Boxes, Receipt } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const GERAL = "geral";

export default function Dashboard() {
  const store = useStore();
  const totalStock = store.products.reduce((s, p) => s + p.stock, 0);
  const investedCapital = store.getTotalInvested();

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
    const revenue = salesInPeriod.reduce((sum, s) => sum + s.totalPrice, 0);
    const received = salesInPeriod.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
    const receivable = salesInPeriod.reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.paidAmount || 0)), 0);

    // CPV: custo dos produtos efetivamente vendidos
    const cogs = salesInPeriod.reduce((sum, s) => {
      const product = store.products.find(p => p.id === s.productId);
      const cost = product?.purchasePrice ?? 0;
      return sum + cost * s.quantity;
    }, 0);

    const grossProfit = revenue - cogs;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const expenses = store.expenses.filter(e => filterFn(e.date)).reduce((sum, e) => sum + e.amount, 0);
    const netProfit = grossProfit - expenses;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    // Reposição de estoque (investimento — exibido separadamente, NÃO reduz lucro)
    const restock = store.stockEntries.filter(e => filterFn(e.date)).reduce((sum, e) => sum + e.totalCost, 0);

    return { revenue, received, receivable, cogs, grossProfit, grossMargin, expenses, netProfit, netMargin, restock };
  }, [filter, store.sales, store.stockEntries, store.expenses, store.products]);

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
      const monthCost = store.stockEntries.filter(e => isWithinInterval(parseISO(e.date), interval)).reduce((sum, e) => sum + e.totalCost, 0);
      const monthExpenses = store.expenses.filter(e => isWithinInterval(parseISO(e.date), interval)).reduce((sum, e) => sum + e.amount, 0);

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
  const profitPositive = periodStats.profit >= 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {isGeral ? "Visão geral consolidada" : `Visão de ${filterLabel}`}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs principais — 3 destaques */}
      <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Receita recebida</p>
            <TrendingUp size={14} className="text-income" />
          </div>
          <p className="mt-1 text-2xl font-semibold mono text-foreground">{formatCurrency(periodStats.revenue)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{isGeral ? "todo período" : filterLabel}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Lucro líquido</p>
            {profitPositive ? <TrendingUp size={14} className="text-income" /> : <TrendingDown size={14} className="text-destructive" />}
          </div>
          <p className={cn("mt-1 text-2xl font-semibold mono", profitPositive ? "text-income" : "text-destructive")}>
            {formatCurrency(periodStats.profit)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">margem {periodStats.margin.toFixed(1)}%</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">A receber</p>
            <Clock size={14} className={periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground"} />
          </div>
          <p className={cn("mt-1 text-2xl font-semibold mono", periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground")}>
            {formatCurrency(periodStats.receivable)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">vendas em aberto</p>
        </div>
      </div>

      {/* Indicadores secundários */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
        <SecondaryStat icon={DollarSign} label="Custos" value={formatCurrency(periodStats.costs)} />
        <SecondaryStat icon={Wallet} label="Despesas" value={formatCurrency(periodStats.expenses)} />
        <SecondaryStat icon={AlertTriangle} label="Perdas" value={formatCurrency(periodStats.losses)} tone={periodStats.losses > 0 ? "destructive" : undefined} />
        <SecondaryStat icon={Users} label="Pago a sócios" value={formatCurrency(periodStats.partnerPaid)} />
        <SecondaryStat icon={Package} label="Estoque atual" value={`${totalStock} un.`} hint={formatCurrency(investedCapital)} />
      </div>

      {/* Gráfico + atividades lado a lado */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Evolução financeira</h2>
              <p className="text-[11px] text-muted-foreground">Últimos 6 meses · receita vs custos</p>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-income" /> Receita</span>
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-destructive" /> Custos</span>
            </div>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--income))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--income))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCustos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1).replace('.0','')}k` : `${v}`} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "10px", fontSize: 12 }} formatter={(value: number) => formatCurrency(value)} />
                <Area type="monotone" dataKey="receita" stroke="hsl(var(--income))" strokeWidth={2} fill="url(#gradReceita)" name="Receita" />
                <Area type="monotone" dataKey="custos" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#gradCustos)" name="Custos" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight">Últimas vendas</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{store.sales.filter(s => s.type === "venda").length} total</span>
          </div>
          {store.sales.filter(s => s.type === "venda").length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Nenhuma venda registrada.</p>
          ) : (
            <div className="space-y-0">
              {store.sales.filter(s => s.type === "venda").slice(-6).reverse().map(s => {
                const product = store.products.find(p => p.id === s.productId);
                const productLabel = product ? `${product.flavor} · ${product.model}` : store.getProductName(s.productId);
                return (
                  <div key={s.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-xs font-medium truncate">{productLabel}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 mono">{format(parseISO(s.date), "dd/MM")} · {s.quantity} un.</p>
                    </div>
                    <span className="text-xs font-semibold mono text-income shrink-0">{formatCurrency(s.totalPrice)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SecondaryStat({ icon: Icon, label, value, tone, hint }: { icon: any; label: string; value: string; tone?: "destructive" | "warning"; hint?: string }) {
  const toneClass = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={11} />
        <p className="text-[10px] uppercase tracking-wider font-medium">{label}</p>
      </div>
      <p className={cn("mt-0.5 text-base font-semibold mono", toneClass)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mono mt-0.5">{hint}</p>}
    </div>
  );
}
