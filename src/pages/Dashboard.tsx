import { useStore } from "@/context/StoreContext";
import { Package, Percent, Download, ArrowRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, useReducedMotion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import { listItem } from "@/lib/motion";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { computeModelStats, summarizeRestock, urgencyOf, HORIZON_DAYS, STALE_DAYS, type ModelStat } from "@/lib/restock";
// xlsx é carregado sob demanda (dynamic import) para não pesar no bundle inicial.
import { toast } from "sonner";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Sem centavos — usado nos números grandes do painel, como no design. */
function formatCurrencyShort(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function formatPct(value: number, digits = 1) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatDays(days: number) {
  if (!isFinite(days)) return "sem giro";
  return `${Math.round(days)} dias`;
}

/**
 * Cores do gráfico em hex literal, de propósito: o recharts escreve `stroke` e
 * `stop-color` como ATRIBUTO SVG, e atributo não resolve `var(--…)`. Espelham
 * --nc-accent / --nc-profit / --nc-crit em src/index.css — mudou lá, mude aqui.
 */
const CHART_REVENUE = "#85B7EB";
const CHART_PROFIT = "#9184d9";
const CHART_LOSS = "#F09595";
const CHART_GRID = "#3f424d";
const CHART_AXIS = "#75798c";

const GERAL = "geral";
/** Quantos meses aparecem como atalho no seletor de período. */
const QUICK_MONTHS = 3;
/** Linhas mínimas na tabela de reposição, para o card não ficar vazio. */
const MIN_RESTOCK_ROWS = 3;
const MAX_RESTOCK_ROWS = 6;
/** Modelos nomeados na barra empilhada; o resto vira "Outros". */
const TOP_MODELS = 5;

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
    const opts: { value: string; label: string; short: string }[] = [];
    sorted.forEach(ym => {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(y, m - 1, 15);
      opts.push({
        value: ym,
        label: format(d, "MMMM/yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase()),
        short: format(d, "MMM", { locale: ptBR }).replace(/^./, c => c.toUpperCase()).replace(".", ""),
      });
    });
    opts.push({ value: GERAL, label: "Geral (todo período)", short: "Geral" });
    return opts;
  }, [store.sales, store.expenses, store.stockEntries]);

  const [filter, setFilter] = useState<string>(format(new Date(), "yyyy-MM"));

  /**
   * Atalhos do seletor: os meses mais recentes + Geral. Se o mês escolhido for
   * mais antigo que isso, ele entra na lista para não sumir da tela.
   */
  const periodOptions = useMemo(() => {
    const months = monthOptions.filter(o => o.value !== GERAL);
    const quick = months.slice(0, QUICK_MONTHS);
    const selected = months.find(o => o.value === filter);
    const list = selected && !quick.some(o => o.value === filter) ? [...quick, selected] : quick;
    return [...list, monthOptions[monthOptions.length - 1]];
  }, [monthOptions, filter]);

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

  /**
   * Estatísticas por modelo. O giro (vendas/dia) e o "parado há X dias" olham
   * sempre o histórico recente — são números do futuro, não do período filtrado.
   * Já receita e quantidade seguem o filtro.
   */
  const modelStats = useMemo(
    () => computeModelStats({
      products: store.products,
      sales: store.sales,
      periodSales: periodStats.sales,
    }),
    [store.products, store.sales, periodStats.sales],
  );

  const restock = useMemo(() => summarizeRestock(modelStats), [modelStats]);

  /** Urgentes primeiro; completa com os próximos para a tabela não ficar vazia. */
  const restockRows = useMemo(() => {
    const rows = restock.urgent.slice(0, MAX_RESTOCK_ROWS);
    if (rows.length >= MIN_RESTOCK_ROWS) return rows;
    const seen = new Set(rows.map(r => r.key));
    return [...rows, ...modelStats.filter(m => !seen.has(m.key) && m.stock > 0).slice(0, MIN_RESTOCK_ROWS - rows.length)];
  }, [restock.urgent, modelStats]);

  /** Barra empilhada: os N maiores por receita + "Outros". */
  const revenueSplit = useMemo(() => {
    const sold = modelStats.filter(m => m.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const total = sold.reduce((s, m) => s + m.revenue, 0);
    const top = sold.slice(0, TOP_MODELS);
    const rest = sold.slice(TOP_MODELS);
    // `key` vem do modelo (marca|modelo) porque dois modelos de marcas
    // diferentes podem ter o mesmo nome — `label` sozinho não é único.
    const segments = top.map(m => ({ key: m.key, label: m.model, revenue: m.revenue }));
    if (rest.length > 0) {
      segments.push({
        key: "__outros__",
        label: `Outros ${rest.length} modelo${rest.length > 1 ? "s" : ""}`,
        revenue: rest.reduce((s, m) => s + m.revenue, 0),
      });
    }
    return { total, segments: segments.map(s => ({ ...s, pct: total > 0 ? (s.revenue / total) * 100 : 0 })) };
  }, [modelStats]);

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

  const delta = (current: number, previous: number | undefined) => {
    if (prevStats == null || previous === undefined) return undefined;
    if (previous === 0) return undefined;
    return { pct: ((current - previous) / Math.abs(previous)) * 100, label: prevStats.label };
  };

  const recentSales = useMemo(
    () => store.sales.filter(s => s.type === "venda"),
    [store.sales],
  );

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

      // Reposição sugerida (mesma conta do card "Repor agora")
      const wsRepor = XLSX.utils.json_to_sheet(
        restock.urgent.length
          ? restock.urgent.map(m => ({
              Marca: m.brand,
              Modelo: m.model,
              "Estoque (un.)": m.stock,
              "Vende/dia": fmt(m.perDay),
              "Dura (dias)": isFinite(m.daysLeft) ? Math.round(m.daysLeft) : "sem giro",
              "Margem (%)": fmt(m.marginPct),
              "Repor (un.)": m.restockUnits,
              [`Custo p/ ${HORIZON_DAYS}d (R$)`]: fmt(m.restockCost),
            }))
          : [{ Marca: "—" }],
      );
      wsRepor["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsRepor, "Repor agora");

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

  return (
    // `/dashboard` está em `fullBleedRoutes` (AppLayout), então chega aqui sem
    // padding e sem max-width — o painel encosta nas bordas sozinho. O `flex-1`
    // estica o painel até o rodapé da janela, para o trilho da direita e o fundo
    // escuro cobrirem a tela inteira mesmo com pouco conteúdo.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-accent)" }}>
              {isGeral ? "Todo o período" : filterLabel}
            </span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Dashboard</h1>
          </div>

          <div className="flex items-center gap-2">
            <PeriodChips options={periodOptions} value={filter} onChange={setFilter} />
            <button
              type="button"
              onClick={handleExport}
              title="Exportar Excel"
              aria-label="Exportar Excel"
              className="rounded-md p-2 transition-colors hover:bg-white/5"
              style={{ color: "var(--nc-text-3)" }}
            >
              <Download size={15} />
            </button>
          </div>
        </header>

        {/* ---------------- Repor agora ---------------- */}
        <section className="nc-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
            <div className="flex items-center gap-2">
              <Package size={16} style={{ color: "var(--nc-accent)" }} />
              <h2 className="text-[15px]">Repor agora</h2>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] nc-num"
              style={{ color: "var(--nc-accent)", boxShadow: "inset 0 0 0 1px var(--nc-accent)" }}
            >
              {restock.urgent.length} de {restock.totalModels} modelo{restock.totalModels === 1 ? "" : "s"}
            </span>
          </div>

          <div className="px-4 pb-3.5">
            {restockRows.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
                {modelStats.length === 0 ? "Nenhum modelo cadastrado ainda." : "Nenhum modelo com estoque no momento."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr style={{ color: "var(--nc-text-3)" }}>
                      <th className="px-2 py-1.5 text-left font-normal">Modelo</th>
                      <th className="px-2 py-1.5 text-right font-normal">Estoque</th>
                      <th className="px-2 py-1.5 text-right font-normal">Vende/dia</th>
                      <th className="px-2 py-1.5 text-right font-normal">Dura</th>
                      <th className="px-2 py-1.5 text-right font-normal">Margem</th>
                      <th className="px-2 py-1.5 text-right font-normal">Custo p/ {HORIZON_DAYS}d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockRows.map(m => <RestockRow key={m.key} model={m} />)}
                  </tbody>
                </table>
              </div>
            )}

            <div className="nc-rule-top mt-3 flex flex-wrap items-center justify-between gap-3 pt-3">
              <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
                {restock.staleCount > 0 ? (
                  <>
                    {restock.staleCount} modelo{restock.staleCount > 1 ? "s" : ""} parado
                    {restock.staleCount > 1 ? "s" : ""} há mais de {STALE_DAYS} dias travando{" "}
                    <strong className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>
                      {formatCurrencyShort(restock.staleValue)}
                    </strong>{" "}
                    em estoque
                  </>
                ) : (
                  <>Nenhum modelo parado há mais de {STALE_DAYS} dias.</>
                )}
              </span>
              <Link
                to="/stock"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-white/5"
                style={{ color: "var(--nc-accent)", boxShadow: "inset 0 0 0 1px var(--nc-accent)" }}
              >
                Abrir entrada de estoque <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------- Desempenho financeiro ---------------- */}
        <section className="nc-card min-w-0 p-4 flex flex-col xl:flex-1">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-[15px]">Desempenho financeiro</h2>
            <div className="flex flex-wrap items-center gap-3.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5" style={{ background: "var(--nc-accent)" }} /> Receita
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5" style={{ background: "var(--nc-profit)" }} /> Lucro líquido
              </span>
              <span className="pl-3" style={{ borderLeft: "1px solid var(--nc-divider)" }}>
                Margem média{" "}
                <strong className="nc-num font-semibold" style={{ color: "var(--nc-text)" }}>
                  {formatPct(avgMargin)}
                </strong>
              </span>
            </div>
          </div>
          {/* No desktop o gráfico cresce para consumir a sobra vertical da tela,
              nunca ficando menor que a altura original. */}
          <div className="h-[212px] xl:h-auto xl:min-h-[212px] xl:flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_REVENUE} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART_REVENUE} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_PROFIT} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={CHART_PROFIT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 5" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="month" stroke={CHART_AXIS} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke={CHART_AXIS}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={v => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(".0", "")}k` : `${v}`)}
                />
                <Tooltip
                  cursor={{ stroke: CHART_GRID }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d: any = payload[0].payload;
                    return (
                      <div
                        className="rounded-lg px-3 py-2 text-xs"
                        style={{
                          background: "var(--nc-surface)",
                          color: "var(--nc-text)",
                          boxShadow: "0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)",
                        }}
                      >
                        <p className="mb-1.5 font-medium">{d.monthLong}</p>
                        <div className="space-y-0.5">
                          <p className="flex items-center justify-between gap-4">
                            <span style={{ color: "var(--nc-text-2)" }}>Receita</span>
                            <span className="nc-num font-semibold" style={{ color: CHART_REVENUE }}>{formatCurrency(d.receita)}</span>
                          </p>
                          <p className="flex items-center justify-between gap-4">
                            <span style={{ color: "var(--nc-text-2)" }}>Lucro líquido</span>
                            <span className="nc-num font-semibold" style={{ color: d.lucro >= 0 ? CHART_PROFIT : CHART_LOSS }}>
                              {formatCurrency(d.lucro)}
                            </span>
                          </p>
                          <p className="nc-rule-top mt-1 flex items-center justify-between gap-4 pt-1">
                            <span style={{ color: "var(--nc-text-2)" }}>Margem</span>
                            <span className="nc-num font-semibold">{formatPct(d.margem)}</span>
                          </p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="receita" stroke={CHART_REVENUE} strokeWidth={2} fill="url(#gradReceita)" name="Receita" />
                <Area type="monotone" dataKey="lucro" stroke={CHART_PROFIT} strokeWidth={2} fill="url(#gradLucro)" name="Lucro Líquido" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ---------------- Modelos mais vendidos ---------------- */}
        <section className="nc-card px-4 py-3.5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px]">Modelos mais vendidos</h2>
            {revenueSplit.total > 0 && (
              <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                {formatCurrencyShort(revenueSplit.total)} no período · 100%
              </span>
            )}
          </div>
          {revenueSplit.segments.length === 0 ? (
            <p className="py-4 text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma venda no período.</p>
          ) : (
            <>
              <div className="flex h-[26px] gap-px overflow-hidden rounded">
                {revenueSplit.segments.map((s, i) => (
                  <motion.div
                    key={s.key}
                    className="grid place-items-center overflow-hidden text-[10.5px] font-semibold nc-num"
                    initial={{ flexGrow: 0 }}
                    animate={{ flexGrow: Math.max(s.pct, 0.5) }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    style={{ flexBasis: 0, background: segmentTint(i), color: i < 3 ? "#12202e" : "var(--nc-text)" }}
                    title={`${s.label} · ${formatCurrencyShort(s.revenue)}`}
                  >
                    {s.pct >= 14 ? formatPct(s.pct) : ""}
                  </motion.div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {revenueSplit.segments.map((s, i) => (
                  <span key={s.key} className="flex items-baseline gap-1.5 text-xs">
                    <span className="h-2 w-2 flex-none rounded-sm" style={{ background: segmentTint(i) }} />
                    {s.label}{" "}
                    <span className="nc-num" style={{ color: "var(--nc-text-3)" }}>{formatCurrencyShort(s.revenue)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ---------------- Coluna direita: Dinheiro do mês ---------------- */}
      <aside
        className="w-full flex-none p-4 md:p-6 xl:w-[312px] flex flex-col gap-3.5"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>
          Dinheiro do {isGeral ? "período" : "mês"}
        </span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Receita</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <AnimatedNumber
              value={periodStats.revenue}
              format={formatCurrencyShort}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
            <Delta delta={delta(periodStats.revenue, prevStats?.stats.revenue)} />
          </div>
          <div className="mt-2 flex h-[5px] gap-0.5">
            <div style={{ flex: Math.max(periodStats.received, 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
            <div style={{ flex: Math.max(periodStats.receivable, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
          </div>
          <div className="mt-1.5 flex justify-between gap-2 text-[11px] nc-num" style={{ color: "var(--nc-text-2)" }}>
            <span>recebido {formatCurrencyShort(periodStats.received)}</span>
            <span style={{ color: "var(--nc-alert)" }}>a receber {formatCurrencyShort(periodStats.receivable)}</span>
          </div>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− CPV</span>
            <span className="nc-num text-sm">{formatCurrencyShort(periodStats.cogs)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− Despesas</span>
            <span className="nc-num text-sm">
              {formatCurrencyShort(periodStats.expenses)}{" "}
              <Delta delta={delta(periodStats.expenses, prevStats?.stats.expenses)} invert />
            </span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Lucro líquido</span>
            {/* Prejuízo em vermelho; lucro na cor principal do painel. */}
            <span style={{ color: netPositive ? "var(--nc-accent)" : "var(--nc-crit)" }}>
              <AnimatedNumber
                value={periodStats.netProfit}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-xl font-semibold"
              />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[11.5px] nc-num" style={{ color: "var(--nc-text-3)" }}>
            <span>margem líquida</span>
            <span>{formatPct(periodStats.netMargin)} · bruta {formatPct(periodStats.grossMargin)}</span>
          </div>
        </div>

        <Rule />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Ticket médio</span>
            <div className="nc-num text-base font-semibold">
              {formatCurrency(periodStats.ticket)}{" "}
              <Delta delta={delta(periodStats.ticket, prevStats?.stats.ticket)} />
            </div>
          </div>
          <div>
            <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Estoque a custo</span>
            <div className="nc-num text-base font-semibold">{formatCurrencyShort(inventoryAtCost)}</div>
            <span className="text-[11px] nc-num" style={{ color: "var(--nc-text-3)" }}>{totalStock} un.</span>
          </div>
        </div>

        <Rule />

        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
          <Percent size={12} />
          <span>Lucro bruto do período</span>
          <span className="ml-auto nc-num font-semibold" style={{ color: "var(--nc-text)" }}>
            {formatCurrencyShort(periodStats.grossProfit)}
          </span>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>
              Últimas vendas
            </span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>{recentSales.length} total</span>
          </div>
          {recentSales.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma venda registrada.</p>
          ) : (
            <Stagger className="flex flex-col">
              {recentSales.slice(-6).reverse().map(s => {
                const product = productMap.get(s.productId);
                const productLabel = product ? `${product.flavor} · ${product.model}` : store.getProductName(s.productId);
                return (
                  <motion.div key={s.id} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate">{productLabel}</span>
                    <span className="nc-num flex-none">{formatCurrencyShort(s.totalPrice)}</span>
                  </motion.div>
                );
              })}
            </Stagger>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Tom do segmento na barra empilhada: do accent cheio até quase o fundo. */
function segmentTint(index: number) {
  const mix = [100, 82, 64, 48, 33, 19][Math.min(index, 5)];
  return `color-mix(in srgb, var(--nc-accent) ${mix}%, var(--nc-bg))`;
}

/**
 * Chips de período com o realce accent como peça única: em vez de cada chip
 * desenhar a própria moldura, só o ativo renderiza o `motion.span` com
 * `layoutId`, então o motion anima o realce deslizando do chip antigo pro novo.
 * Mesmo padrão do `SegmentedToggle` / `BrandChips` da loja.
 */
function PeriodChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; short: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();

  return (
    <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--nc-track)" }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.label}
            className="relative rounded-md px-2.5 py-1.5 text-xs transition-colors duration-200"
            style={{ color: active ? "var(--nc-accent)" : "var(--nc-text-2)" }}
          >
            {active && (
              <motion.span
                layoutId={reduce ? undefined : pillId}
                className="absolute inset-0 rounded-md"
                style={{
                  boxShadow: "inset 0 0 0 1px var(--nc-accent)",
                  background: "color-mix(in srgb, var(--nc-accent) 10%, transparent)",
                }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className="relative z-10">{o.short}</span>
          </button>
        );
      })}
    </div>
  );
}

function Rule() {
  return <div className="nc-rule-top h-px" />;
}

type DeltaValue = { pct: number; label: string } | undefined;

/** Variação vs. o mês anterior. `invert` = subir é ruim (despesas). */
function Delta({ delta, invert }: { delta: DeltaValue; invert?: boolean }) {
  if (!delta || !isFinite(delta.pct)) return null;
  const good = invert ? delta.pct <= 0 : delta.pct >= 0;
  return (
    <span
      className="nc-num text-[11px] font-normal"
      style={{ color: good ? "var(--nc-accent)" : "var(--nc-alert)" }}
      title={`vs ${delta.label}`}
    >
      {delta.pct >= 0 ? "+" : "−"}
      {Math.abs(delta.pct).toFixed(0)}%
    </span>
  );
}

function RestockRow({ model }: { model: ModelStat }) {
  const urgency = urgencyOf(model.daysLeft);
  const dot = urgency === "critical" ? "var(--nc-crit)" : urgency === "warning" ? "var(--nc-alert)" : "var(--nc-text-3)";
  const daysColor = urgency === "ok" ? undefined : dot;

  return (
    <tr className="nc-row">
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: dot }} />
          <span className="truncate">{model.model}</span>
          <span className="truncate text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>{model.brand}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right nc-num">{model.stock} un.</td>
      <td className="px-2 py-1.5 text-right nc-num">
        {model.perDay.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td className="px-2 py-1.5 text-right nc-num" style={daysColor ? { color: daysColor } : undefined}>
        {formatDays(model.daysLeft)}
      </td>
      <td className="px-2 py-1.5 text-right nc-num">{formatPct(model.marginPct)}</td>
      <td className="px-2 py-1.5 text-right nc-num" style={model.restockCost > 0 ? undefined : { color: "var(--nc-text-3)" }}>
        {model.restockCost > 0 ? formatCurrencyShort(model.restockCost) : "—"}
      </td>
    </tr>
  );
}
