import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, Package, Clock, Percent, Boxes, Receipt, Download, AlertTriangle, Sparkles, Trophy, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, subDays, startOfDay, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import { listItem, hoverLift } from "@/lib/motion";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
// xlsx é carregado sob demanda (dynamic import) para não pesar no bundle inicial.
import { toast } from "sonner";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const GERAL = "geral";
const LOW_STOCK_FALLBACK = 5;

export default function Dashboard() {
  const store = useStore();
  const totalStock = store.products.reduce((s, p) => s + p.stock, 0);
  // Valor do estoque a custo: soma do custo unitário × quantidade de cada produto.
  const inventoryAtCost = useMemo(
    () => store.products.reduce((s, p) => s + (p.purchasePrice || 0) * p.stock, 0),
    [store.products],
  );

  // Índice de produtos: evita varreduras O(n*m) dentro dos loops de vendas/entradas.
  const productMap = useMemo(
    () => new Map(store.products.map(p => [p.id, p])),
    [store.products],
  );

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(format(new Date(), "yyyy-MM"));
    store.sales.forEach(s => { try { set.add(format(parseISO(s.date), "yyyy-MM")); } catch {} });
    store.expenses.forEach(e => { try { set.add(format(parseISO(e.date), "yyyy-MM")); } catch {} });
    store.stockEntries.forEach(e => { try { set.add(format(parseISO(e.date), "yyyy-MM")); } catch {} });
    const sorted = Array.from(set).sort((a, b) => b.localeCompare(a));
    const opts: { value: string; label: string }[] = [{ value: GERAL, label: "Geral (todo período)" }];
    sorted.forEach(ym => {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(y, m - 1, 15);
      opts.push({
        value: ym,
        label: format(d, "MMMM/yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase()),
      });
    });
    return opts;
  }, [store.sales, store.expenses, store.stockEntries]);

  const [filter, setFilter] = useState<string>(format(new Date(), "yyyy-MM"));

  const computeStats = useMemo(() => {
    return (filterFn: (dateISO: string) => boolean) => {
      const salesInPeriod = store.sales.filter(s => s.type === "venda" && filterFn(s.date));
      const revenue = salesInPeriod.reduce((sum, s) => sum + s.totalPrice, 0);
      const received = salesInPeriod.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
      const receivable = salesInPeriod.reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.paidAmount || 0)), 0);

      // CPV: custo dos produtos efetivamente vendidos
      const cogs = salesInPeriod.reduce((sum, s) => {
        const product = productMap.get(s.productId);
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

      const ticket = salesInPeriod.length > 0 ? received / salesInPeriod.length : 0;

      return { revenue, received, receivable, cogs, grossProfit, grossMargin, expenses, netProfit, netMargin, restock, ticket, salesCount: salesInPeriod.length, sales: salesInPeriod };
    };
  }, [store.sales, store.expenses, store.stockEntries, productMap]);

  const intervalFor = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    const ref = new Date(y, m - 1, 15);
    return { start: startOfMonth(ref), end: endOfMonth(ref) };
  };

  const isGeral = filter === GERAL;

  const periodStats = useMemo(() => {
    if (isGeral) return computeStats(() => true);
    const interval = intervalFor(filter);
    return computeStats((d) => isWithinInterval(parseISO(d), interval));
  }, [filter, isGeral, computeStats]);

  const prevStats = useMemo(() => {
    if (isGeral) return null;
    const [y, m] = filter.split("-").map(Number);
    const prev = subMonths(new Date(y, m - 1, 15), 1);
    const interval = { start: startOfMonth(prev), end: endOfMonth(prev) };
    return { stats: computeStats((d) => isWithinInterval(parseISO(d), interval)), label: format(prev, "MMM", { locale: ptBR }) };
  }, [filter, isGeral, computeStats]);

  // Série diária dos últimos 14 dias (sparklines)
  const dailySeries = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => startOfDay(subDays(new Date(), 13 - i)));
    return days.map(day => {
      const daySales = store.sales.filter(s => s.type === "venda" && isSameDay(parseISO(s.date), day));
      const revenue = daySales.reduce((sum, s) => sum + s.totalPrice, 0);
      const received = daySales.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
      const cogs = daySales.reduce((sum, s) => sum + (productMap.get(s.productId)?.purchasePrice ?? 0) * s.quantity, 0);
      const expenses = store.expenses.filter(e => isSameDay(parseISO(e.date), day)).reduce((sum, e) => sum + e.amount, 0);
      return {
        day,
        revenue,
        netProfit: revenue - cogs - expenses,
        ticket: daySales.length ? received / daySales.length : 0,
      };
    });
  }, [store.sales, store.expenses, productMap]);

  // Modelos mais vendidos do período (agrupado por modelo, top 3)
  const topModels = useMemo(() => {
    const map = new Map<string, { label: string; total: number; qty: number }>();
    periodStats.sales.forEach(s => {
      const p = productMap.get(s.productId);
      const label = p?.model || store.getProductName(s.productId);
      const cur = map.get(label) ?? { label, total: 0, qty: 0 };
      cur.total += s.totalPrice;
      cur.qty += s.quantity;
      map.set(label, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 3);
  }, [periodStats, productMap, store]);


  // Insights automáticos
  const insights = useMemo(() => {
    const out: { icon: any; tone: string; text: string }[] = [];

    // Estoque baixo é por MODELO: soma o estoque de todos os sabores do modelo
    // e conta quantos modelos distintos estão abaixo do limite.
    const stockByModel = new Map<string, number>();
    store.products.forEach(p => {
      stockByModel.set(p.model, (stockByModel.get(p.model) || 0) + p.stock);
    });
    const lowStockModels = Array.from(stockByModel.values()).filter(total => total < LOW_STOCK_FALLBACK);
    const lowStockCount = lowStockModels.length;
    if (lowStockCount > 0) {
      out.push({ icon: AlertTriangle, tone: "text-warning", text: `${lowStockCount} produto${lowStockCount > 1 ? "s" : ""} com estoque baixo` });
    }

    const last7 = dailySeries.slice(7);
    const prev7 = dailySeries.slice(0, 7);
    const avg = (arr: typeof dailySeries) => {
      const withSales = arr.filter(d => d.ticket > 0);
      return withSales.length ? withSales.reduce((s, d) => s + d.ticket, 0) / withSales.length : 0;
    };
    const t1 = avg(last7);
    const t0 = avg(prev7);
    if (t0 > 0 && t1 > 0 && t1 < t0) {
      const drop = ((t0 - t1) / t0) * 100;
      if (drop >= 1) out.push({ icon: TrendingDown, tone: "text-destructive", text: `Ticket médio caiu ${drop.toFixed(0)}% na última semana` });
    }

    if (periodStats.sales.length > 0) {
      const byWeekday = new Array(7).fill(0);
      periodStats.sales.forEach(s => { byWeekday[parseISO(s.date).getDay()] += s.totalPrice; });
      const best = byWeekday.indexOf(Math.max(...byWeekday));
      if (byWeekday[best] > 0) {
        const name = format(new Date(2024, 0, 7 + best), "EEEE", { locale: ptBR });
        out.push({ icon: Trophy, tone: "text-income", text: `${name.replace(/^./, c => c.toUpperCase())} é o dia com mais vendas do período` });
      }
    }

    return out;
  }, [store.products, dailySeries, periodStats]);

  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);
      const interval = { start, end };

      const salesInMonth = store.sales.filter(s => s.type === "venda" && isWithinInterval(parseISO(s.date), interval));
      const receita = salesInMonth.reduce((sum, s) => sum + s.totalPrice, 0);
      const cogs = salesInMonth.reduce((sum, s) => {
        const p = productMap.get(s.productId);
        return sum + (p?.purchasePrice ?? 0) * s.quantity;
      }, 0);
      const desp = store.expenses.filter(e => isWithinInterval(parseISO(e.date), interval)).reduce((sum, e) => sum + e.amount, 0);
      const lucro = receita - cogs - desp;
      const margem = receita > 0 ? (lucro / receita) * 100 : 0;

      months.push({
        month: format(date, "MMM", { locale: ptBR }),
        monthLong: format(date, "MMMM/yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase()),
        receita,
        lucro,
        margem,
      });
    }
    return months;
  }, [store.sales, store.expenses, productMap]);

  const avgMargin = useMemo(() => {
    const withRevenue = monthlyData.filter(m => m.receita > 0);
    if (!withRevenue.length) return 0;
    return withRevenue.reduce((s, m) => s + m.margem, 0) / withRevenue.length;
  }, [monthlyData]);

  const filterLabel = monthOptions.find(o => o.value === filter)?.label ?? "";
  const netPositive = periodStats.netProfit >= 0;
  const grossPositive = periodStats.grossProfit >= 0;

  const delta = (current: number, previous: number | undefined) => {
    if (prevStats == null || previous === undefined) return undefined;
    if (previous === 0) return undefined;
    return { pct: ((current - previous) / Math.abs(previous)) * 100, label: prevStats.label };
  };

  async function handleExport() {
    try {
      const XLSX = await import("xlsx");
      let filterFn: (dateISO: string) => boolean;
      if (isGeral) filterFn = () => true;
      else {
        const [y, m] = filter.split("-").map(Number);
        const start = startOfMonth(new Date(y, m - 1, 15));
        const end = endOfMonth(new Date(y, m - 1, 15));
        filterFn = (d: string) => isWithinInterval(parseISO(d), { start, end });
      }

      const fmt = (n: number) => Number(n.toFixed(2));
      const wb = XLSX.utils.book_new();


      // Resumo
      const resumo = [
        ["California Contabilidade — Dashboard"],
        ["Período", isGeral ? "Geral (todo período)" : filterLabel],
        ["Gerado em", format(new Date(), "dd/MM/yyyy HH:mm")],
        [],
        ["Indicador", "Valor (R$)"],
        ["Receita", fmt(periodStats.revenue)],
        ["Recebido", fmt(periodStats.received)],
        ["A receber", fmt(periodStats.receivable)],
        ["CPV (Custo dos Produtos Vendidos)", fmt(periodStats.cogs)],
        ["Lucro bruto", fmt(periodStats.grossProfit)],
        ["Margem bruta (%)", fmt(periodStats.grossMargin)],
        ["Despesas", fmt(periodStats.expenses)],
        ["Lucro líquido", fmt(periodStats.netProfit)],
        ["Margem líquida (%)", fmt(periodStats.netMargin)],
        ["Ticket médio", fmt(periodStats.ticket)],
        ["Reposição de estoque (investimento)", fmt(periodStats.restock)],
        ["Estoque atual (unidades)", totalStock],
        ["Estoque a custo (razão)", fmt(inventoryAtCost)],
      ];
      const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
      wsResumo["!cols"] = [{ wch: 40 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

      // Evolução 6 meses
      const wsEvol = XLSX.utils.json_to_sheet(monthlyData.map(m => ({
        Mês: m.monthLong, "Receita (R$)": fmt(m.receita), "Lucro Líquido (R$)": fmt(m.lucro), "Margem (%)": fmt(m.margem),
      })));
      wsEvol["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsEvol, "Evolução 6 meses");

      // Vendas do período
      const vendas = store.sales.filter(s => s.type === "venda" && filterFn(s.date)).map(s => {
        const p = productMap.get(s.productId);
        const label = p ? `${p.flavor} · ${p.model}` : store.getProductName(s.productId);
        const cost = (p?.purchasePrice ?? 0) * s.quantity;
        return {
          Data: format(parseISO(s.date), "dd/MM/yyyy"),
          Produto: label,
          Quantidade: s.quantity,
          "Valor (R$)": fmt(s.totalPrice),
          "Pago (R$)": fmt(s.paidAmount || 0),
          "A receber (R$)": fmt(Math.max(0, s.totalPrice - (s.paidAmount || 0))),
          "CPV (R$)": fmt(cost),
          "Lucro bruto (R$)": fmt(s.totalPrice - cost),
        };
      });
      const wsVendas = XLSX.utils.json_to_sheet(vendas.length ? vendas : [{ Data: "—" }]);
      wsVendas["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsVendas, "Vendas");

      // Despesas
      const despesas = store.expenses.filter(e => filterFn(e.date)).map(e => ({
        Data: format(parseISO(e.date), "dd/MM/yyyy"),
        Descrição: (e as any).description ?? (e as any).name ?? "",
        "Valor (R$)": fmt(e.amount),
      }));
      const wsDesp = XLSX.utils.json_to_sheet(despesas.length ? despesas : [{ Data: "—" }]);
      wsDesp["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsDesp, "Despesas");

      // Reposição de estoque
      const entradas = store.stockEntries.filter(e => filterFn(e.date)).map(e => {
        const p = productMap.get(e.productId);
        const label = p ? `${p.flavor} · ${p.model}` : store.getProductName(e.productId);
        return {
          Data: format(parseISO(e.date), "dd/MM/yyyy"),
          Produto: label,
          Quantidade: e.quantity,
          "Custo total (R$)": fmt(e.totalCost),
        };
      });
      const wsEnt = XLSX.utils.json_to_sheet(entradas.length ? entradas : [{ Data: "—" }]);
      wsEnt["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 10 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsEnt, "Reposição estoque");

      const suffix = isGeral ? "geral" : filter;
      XLSX.writeFile(wb, `dashboard-${suffix}.xlsx`);
      toast.success("Exportação concluída");
    } catch (err) {
      console.error(err);
      toast.error("Falha ao exportar");
    }
  }

  const maxTop = topProducts.length ? topProducts[0].total : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-1.5 text-xs">
            <Download size={13} /> Exportar Excel
          </Button>
          <div className="flex-1 sm:w-56">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* KPIs principais — linha 1 */}
      <Stagger className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <PrimaryKPI
          label="Receita"
          value={periodStats.revenue}
          format={formatCurrency}
          hint={`recebido ${formatCurrency(periodStats.received)}`}
          icon={TrendingUp}
          iconTone="text-income"
          delta={delta(periodStats.revenue, prevStats?.stats.revenue)}
          spark={dailySeries.map(d => d.revenue)}
        />
        <PrimaryKPI
          label="Lucro bruto"
          value={periodStats.grossProfit}
          format={formatCurrency}
          hint={`CPV ${formatCurrency(periodStats.cogs)}`}
          icon={grossPositive ? TrendingUp : TrendingDown}
          iconTone={grossPositive ? "text-income" : "text-destructive"}
          valueTone={grossPositive ? "text-income" : "text-destructive"}
          delta={delta(periodStats.grossProfit, prevStats?.stats.grossProfit)}
        />
        <PrimaryKPI
          label="Lucro líquido"
          value={periodStats.netProfit}
          format={formatCurrency}
          hint={`margem ${periodStats.netMargin.toFixed(1)}%`}
          icon={netPositive ? TrendingUp : TrendingDown}
          iconTone={netPositive ? "text-income" : "text-destructive"}
          valueTone={netPositive ? "text-income" : "text-destructive"}
          delta={delta(periodStats.netProfit, prevStats?.stats.netProfit)}
          spark={dailySeries.map(d => d.netProfit)}
        />
        <PrimaryKPI
          label="A receber"
          value={periodStats.receivable}
          format={formatCurrency}
          hint="vendas em aberto"
          icon={Clock}
          iconTone={periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground"}
          valueTone={periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground"}
        />
      </Stagger>

      {/* KPIs secundários — linha 2 */}
      <Stagger className="grid gap-2 grid-cols-2 md:grid-cols-4">
        <SecondaryStat
          icon={Percent}
          label="Margem bruta"
          value={periodStats.grossMargin}
          format={(v) => `${v.toFixed(1)}%`}
          delta={delta(periodStats.grossMargin, prevStats?.stats.grossMargin)}
        />
        <SecondaryStat
          icon={Receipt}
          label="Despesas"
          value={periodStats.expenses}
          format={formatCurrency}
          delta={delta(periodStats.expenses, prevStats?.stats.expenses)}
          invertDelta
        />
        <SecondaryStat icon={Boxes} label="Reposição de estoque" value={periodStats.restock} format={formatCurrency} hint="investimento em ativos" />
        <SecondaryStat icon={Package} label="Estoque atual" value={totalStock} format={(v) => `${Math.round(v)} un.`} hint={formatCurrency(inventoryAtCost)} />
      </Stagger>

      {/* Ticket médio */}
      <Stagger className="grid gap-2 grid-cols-1 md:grid-cols-4">
        <PrimaryKPI
          label="Ticket médio"
          value={periodStats.ticket}
          format={formatCurrency}
          hint={`${periodStats.salesCount} venda${periodStats.salesCount === 1 ? "" : "s"} no período`}
          icon={Sparkles}
          iconTone="text-primary"
          delta={delta(periodStats.ticket, prevStats?.stats.ticket)}
          spark={dailySeries.map(d => d.ticket)}
        />
      </Stagger>

      {/* Insights automáticos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-tight mb-3">Insights automáticos</h2>
        {insights.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum alerta no momento.</p>
        ) : (
          <Stagger className="space-y-0">
            {insights.map((i, idx) => (
              <motion.div key={idx} variants={listItem} className="flex items-center gap-2.5 py-2 border-b border-border/40 last:border-0">
                <i.icon size={15} className={i.tone} />
                <p className="text-xs">{i.text}</p>
              </motion.div>
            ))}
          </Stagger>
        )}
      </div>

      {/* Top produtos do período */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-tight mb-3">Top produtos do mês</h2>
        {topProducts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma venda no período.</p>
        ) : (
          <Stagger className="space-y-3">
            {topProducts.map((p, idx) => (
              <motion.div key={idx} variants={listItem}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium truncate">{p.label}</p>
                  <span className="text-xs font-semibold mono shrink-0">{formatCurrency(p.total)}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${maxTop > 0 ? (p.total / maxTop) * 100 : 0}%` }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </motion.div>
            ))}
          </Stagger>
        )}
      </div>

      {/* Gráfico + atividades lado a lado */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight">Desempenho Financeiro</h2>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-income" /> Receita</span>
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Lucro Líquido</span>
              <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground border-l border-border pl-3">
                Margem média <span className="mono font-semibold text-foreground">{avgMargin.toFixed(1)}%</span>
              </span>
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
                  <linearGradient id="gradLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1).replace('.0','')}k` : `${v}`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "10px", fontSize: 12, padding: "8px 10px" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d: any = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                        <p className="font-semibold mb-1.5">{d.monthLong}</p>
                        <div className="space-y-0.5">
                          <p className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Receita</span><span className="mono text-income font-semibold">{formatCurrency(d.receita)}</span></p>
                          <p className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Lucro Líquido</span><span className={cn("mono font-semibold", d.lucro >= 0 ? "text-primary" : "text-destructive")}>{formatCurrency(d.lucro)}</span></p>
                          <p className="flex items-center justify-between gap-4 border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Margem</span><span className="mono font-semibold">{d.margem.toFixed(1)}%</span></p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="receita" stroke="hsl(var(--income))" strokeWidth={2} fill="url(#gradReceita)" name="Receita" />
                <Area type="monotone" dataKey="lucro" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gradLucro)" name="Lucro Líquido" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="sm:hidden mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Margem média</span>
            <span className="mono font-semibold">{avgMargin.toFixed(1)}%</span>
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
            <Stagger className="space-y-0">
              {store.sales.filter(s => s.type === "venda").slice(-6).reverse().map(s => {
                const product = productMap.get(s.productId);
                const productLabel = product ? `${product.flavor} · ${product.model}` : store.getProductName(s.productId);
                return (
                  <motion.div key={s.id} variants={listItem} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-xs font-medium truncate">{productLabel}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 mono">{format(parseISO(s.date), "dd/MM")} · {s.quantity} un.</p>
                    </div>
                    <span className="text-xs font-semibold mono text-income shrink-0">{formatCurrency(s.totalPrice)}</span>
                  </motion.div>
                );
              })}
            </Stagger>
          )}
        </div>
      </div>
    </div>
  );
}

type Delta = { pct: number; label: string } | undefined;

function DeltaBadge({ delta, invert }: { delta: Delta; invert?: boolean }) {
  if (!delta || !isFinite(delta.pct)) return null;
  const raw = delta.pct;
  const good = invert ? raw <= 0 : raw >= 0;
  const Icon = raw >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium mono",
        good ? "bg-income/10 text-income" : "bg-destructive/10 text-destructive",
      )}
    >
      <Icon size={10} />
      {raw >= 0 ? "+" : ""}{raw.toFixed(0)}% vs {delta.label}
    </span>
  );
}

/** Minigráfico de linha, sem eixos nem labels. */
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length) return null;
  const w = 60, h = 24, pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke={positive ? "hsl(var(--income))" : "hsl(var(--destructive))"}
      />
    </svg>
  );
}

function SecondaryStat({ icon: Icon, label, value, format, tone, hint, delta, invertDelta }: { icon: any; label: string; value: number; format: (v: number) => string; tone?: "destructive" | "warning"; hint?: string; delta?: Delta; invertDelta?: boolean }) {
  const toneClass = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <motion.div variants={listItem} className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={11} />
        <p className="text-[11px] uppercase tracking-wider font-medium">{label}</p>
      </div>
      <AnimatedNumber value={value} format={format} duration={0.7} animateOnMount className={cn("mt-0.5 block text-base font-semibold mono", toneClass)} />
      {hint && <p className="text-xs text-muted-foreground mono mt-0.5">{hint}</p>}
      <DeltaBadge delta={delta} invert={invertDelta} />
    </motion.div>
  );
}

function PrimaryKPI({ icon: Icon, label, value, format, hint, iconTone, valueTone, delta, spark }: { icon: any; label: string; value: number; format: (v: number) => string; hint?: string; iconTone?: string; valueTone?: string; delta?: Delta; spark?: number[] }) {
  return (
    <motion.div variants={listItem} {...hoverLift} className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
        <Icon size={14} className={iconTone ?? "text-muted-foreground"} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <AnimatedNumber value={value} format={format} duration={0.7} animateOnMount className={cn("mt-1 text-xl sm:text-2xl font-semibold mono break-all", valueTone ?? "text-foreground")} />
        {spark && <Sparkline data={spark} positive={value >= 0} />}
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
      <DeltaBadge delta={delta} />
    </motion.div>
  );
}
