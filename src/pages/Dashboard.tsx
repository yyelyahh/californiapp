import { useStore } from "@/context/StoreContext";
import { TrendingUp, TrendingDown, Package, Clock, Wallet, Percent, Boxes, Receipt, Download } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { toast } from "sonner";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const GERAL = "geral";

export default function Dashboard() {
  const store = useStore();
  const totalStock = store.products.reduce((s, p) => s + p.stock, 0);
  const inventoryAtCost = store.getInventoryCostValue();

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

      const salesInMonth = store.sales.filter(s => s.type === "venda" && isWithinInterval(parseISO(s.date), interval));
      const receita = salesInMonth.reduce((sum, s) => sum + s.totalPrice, 0);
      const cogs = salesInMonth.reduce((sum, s) => {
        const p = store.products.find(p => p.id === s.productId);
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
  }, [store.sales, store.expenses, store.products]);

  const avgMargin = useMemo(() => {
    const withRevenue = monthlyData.filter(m => m.receita > 0);
    if (!withRevenue.length) return 0;
    return withRevenue.reduce((s, m) => s + m.margem, 0) / withRevenue.length;
  }, [monthlyData]);

  const filterLabel = monthOptions.find(o => o.value === filter)?.label ?? "";
  const isGeral = filter === GERAL;
  const netPositive = periodStats.netProfit >= 0;
  const grossPositive = periodStats.grossProfit >= 0;

  function handleExport() {
    try {
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
        const p = store.products.find(p => p.id === s.productId);
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
        const p = store.products.find(p => p.id === e.productId);
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
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <PrimaryKPI
          label="Receita"
          value={formatCurrency(periodStats.revenue)}
          hint={`recebido ${formatCurrency(periodStats.received)}`}
          icon={TrendingUp}
          iconTone="text-income"
        />
        <PrimaryKPI
          label="Lucro bruto"
          value={formatCurrency(periodStats.grossProfit)}
          hint={`CPV ${formatCurrency(periodStats.cogs)}`}
          icon={grossPositive ? TrendingUp : TrendingDown}
          iconTone={grossPositive ? "text-income" : "text-destructive"}
          valueTone={grossPositive ? "text-income" : "text-destructive"}
        />
        <PrimaryKPI
          label="Lucro líquido"
          value={formatCurrency(periodStats.netProfit)}
          hint={`margem ${periodStats.netMargin.toFixed(1)}%`}
          icon={netPositive ? TrendingUp : TrendingDown}
          iconTone={netPositive ? "text-income" : "text-destructive"}
          valueTone={netPositive ? "text-income" : "text-destructive"}
        />
        <PrimaryKPI
          label="A receber"
          value={formatCurrency(periodStats.receivable)}
          hint="vendas em aberto"
          icon={Clock}
          iconTone={periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground"}
          valueTone={periodStats.receivable > 0 ? "text-warning" : "text-muted-foreground"}
        />
      </div>

      {/* KPIs secundários — linha 2 */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        <SecondaryStat icon={Percent} label="Margem bruta" value={`${periodStats.grossMargin.toFixed(1)}%`} />
        <SecondaryStat icon={Receipt} label="Despesas" value={formatCurrency(periodStats.expenses)} />
        <SecondaryStat icon={Boxes} label="Reposição de estoque" value={formatCurrency(periodStats.restock)} hint="investimento em ativos" />
        <SecondaryStat icon={Package} label="Estoque atual" value={`${totalStock} un.`} hint={formatCurrency(inventoryAtCost)} />
      </div>


      {/* Gráfico + atividades lado a lado */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight">Desempenho Financeiro</h2>
              <p className="text-[11px] text-muted-foreground">Receita vs Lucro Líquido · últimos 6 meses</p>
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
        <p className="text-[11px] uppercase tracking-wider font-medium">{label}</p>
      </div>
      <p className={cn("mt-0.5 text-base font-semibold mono", toneClass)}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mono mt-0.5">{hint}</p>}
    </div>
  );
}

function PrimaryKPI({ icon: Icon, label, value, hint, iconTone, valueTone }: { icon: any; label: string; value: string; hint?: string; iconTone?: string; valueTone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
        <Icon size={14} className={iconTone ?? "text-muted-foreground"} />
      </div>
      <p className={cn("mt-1 text-xl sm:text-2xl font-semibold mono break-all", valueTone ?? "text-foreground")}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
    </div>
  );
}
