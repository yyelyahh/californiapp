import { useStore } from "@/context/StoreContext";
import { Package, Percent, Download, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { sameStretchOfPreviousMonth, isoDay } from "@/lib/date-utils";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import { listItem } from "@/lib/motion";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { SegmentedChips, Rule, RAIL, STICKY_HEAD, EYEBROW } from "@/components/nocturne";
import { cn } from "@/lib/utils";
import { computeModelStats, summarizeRestock, urgencyOf, STALE_DAYS, type ModelStat } from "@/lib/restock";
// xlsx é carregado sob demanda (dynamic import) para não pesar no bundle inicial.
import { buildReport } from "@/lib/report-workbook";
import { computePeriodResult } from "@/lib/period-result";
import { useBranch } from "@/context/BranchContext";
import { toast } from "sonner";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { visibleWidgets, type WidgetId, type WidgetSize } from "@/lib/dashboard-layout";
import DashboardCustomizeSheet from "@/components/DashboardCustomizeSheet";
import { buildSalesLink, type SalesLinkFilter } from "@/lib/sales-link";
import { restockToPurchaseDraft, PURCHASE_DRAFT_KEY } from "@/lib/purchase-draft";
import { computeSellerBalance, currentBalanceContext, summarizeSellerBalances } from "@/lib/commissions";

/**
 * Onde cada bloco é desenhado: `card` é a moldura `.nc-card` (coluna do meio e
 * grade de cards), `rail` é o trilho, sem moldura, separado por `Rule`.
 */
type Frame = "card" | "rail";

/**
 * Colunas da grade por tamanho. A grade tem 4 colunas no xl e 2 no md: o
 * pequeno é 1/4 (um KPI), o médio é metade e o grande a largura inteira. Classe
 * escrita por extenso porque o Tailwind não enxerga classe montada em runtime.
 */
const SPAN: Record<WidgetSize, string> = {
  s: "",
  m: "md:col-span-2",
  l: "md:col-span-2 xl:col-span-4",
};

/**
 * Título do bloco de trilho quando ele vira card. No trilho eles não têm título
 * (o trilho inteiro é "o dinheiro do período"); soltos na grade, "− CPV" sem
 * cabeçalho não diria de onde veio. Receita e Últimas vendas já trazem o seu.
 */
const CARD_TITLE: Partial<Record<WidgetId, string>> = {
  result: "Resultado",
  indicators: "Ticket e estoque",
};

function formatPct(value: number, digits = 1) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
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
/** Quantos pedidos cabem na tabela de reposição. */
const MAX_RESTOCK_ROWS = 6;
/** Modelos nomeados na barra empilhada; o resto vira "Outros". */
const TOP_MODELS = 5;
/** Quantos vendedores a lista do bloco mostra; o resto vira uma linha de rodapé. */
const MAX_SELLER_ROWS = 6;
/** Blocos do trilho que sobem para o topo da coluna abaixo do xl (ver `railEarly`). */
const EARLY_ON_SMALL: WidgetId[] = ["revenue", "result"];

export default function Dashboard() {
  const store = useStore();
  // O relatório diz de QUAL filial ele fala. Sem isso, dois arquivos com os
  // mesmos cabeçalhos e números diferentes não teriam como ser distinguidos.
  const { branchId, branchName } = useBranch();
  const { layout, update: updateLayout, reset: resetLayout } = useDashboardLayout();
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

  /**
   * O período mora no ENDEREÇO (`?mes=2026-06`, `?mes=geral`), não num
   * estado da tela. Os números do Dashboard abrem Vendas já filtrada, e o voltar
   * do navegador tem de cair no mesmo mês que se estava olhando — com estado
   * local, voltar de junho caía no mês corrente, e a pessoa perdia o lugar a
   * cada consulta.
   *
   * `replace`: andar pelos meses não empilha histórico, senão o voltar
   * refaria de trás para frente cada seta apertada. Mês que não está na lista
   * (endereço velho, mês sem lançamento) cai no corrente; o corrente não vai
   * para o endereço, que fica limpo no caso comum.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMonth = format(new Date(), "yyyy-MM");
  const requestedMonth = searchParams.get("mes");
  const filter = requestedMonth && monthOptions.some(o => o.value === requestedMonth) ? requestedMonth : currentMonth;
  const setFilter = useCallback(
    (value: string) => setSearchParams(value === currentMonth ? {} : { mes: value }, { replace: true }),
    [setSearchParams, currentMonth],
  );
  /**
   * O relatório monta ~24 abas sobre o histórico inteiro e carrega o `xlsx` na
   * hora: em máquina lenta dá para clicar duas vezes antes de o arquivo sair, e
   * o segundo clique baixaria um arquivo idêntico enquanto o primeiro ainda
   * roda. O botão desliga enquanto isso.
   */
  const [exporting, setExporting] = useState(false);

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

  /**
   * As setas ‹ › andam por TODOS os meses com lançamento. Sem elas, o que
   * passava dos atalhos não tinha como ser aberto: a lista acima só acrescenta
   * o mês escolhido, e nada escolhia um mês mais antigo — junho sumia da tela e
   * do relatório em Excel, que segue o mesmo filtro. A lista vem do mais novo
   * para o mais antigo, então "anterior" é o índice seguinte. Em "Geral" as
   * duas ficam desligadas (e montadas, para a linha não mudar de largura).
   */
  const monthSteps = useMemo(() => {
    const months = monthOptions.filter(o => o.value !== GERAL);
    const i = months.findIndex(o => o.value === filter);
    return {
      older: i >= 0 ? months[i + 1] : undefined,
      newer: i > 0 ? months[i - 1] : undefined,
    };
  }, [monthOptions, filter]);

  /**
   * ← e → andam pelos meses, as mesmas setas do cabeçalho. Quem fecha o mês
   * no notebook vai e volta entre dois meses várias vezes, e mirar num botão
   * de 15px a cada ida é o atrito que o atalho tira.
   *
   * Só age quando a tecla não tem outro dono: foco no corpo da página ou num
   * botão/link comum (é onde o foco fica depois de clicar na própria seta).
   * Campo de texto, o gráfico (o recharts anda pelos pontos com as setas),
   * lista, menu, abas e qualquer painel aberto ficam com a tecla — trocar o
   * mês por baixo do painel de personalizar mudaria a tela que a pessoa nem
   * está vendo. Com modificador também não: Alt+← é o voltar do navegador.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) {
        if (!el.matches("button, a")) return;
        if (el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="tablist"], [role="radiogroup"]')) return;
      }
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const step = e.key === "ArrowLeft" ? monthSteps.older : monthSteps.newer;
      if (!step) return;
      e.preventDefault();
      setFilter(step.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [monthSteps, setFilter]);

  const computeStats = useMemo(() => {
    /**
     * O resultado sai de `computePeriodResult` (src/lib/period-result.ts), a
     * MESMA conta da Distribuição e do relatório. Aqui o lucro líquido não
     * descontava perdas nem o custo dos vendedores (comissão paga, consumo a
     * custo) — o razão desconta os dois, e o Dashboard mostrava um lucro maior
     * que o real. O CPV usa o custo congelado de cada venda (`saleUnitCost`).
     *
     * Ticket médio = FATURAMENTO ÷ contagem de vendas, a conta da tela de
     * Vendas (`totals.ticket`); era recebido ÷ vendas, que caía justamente no
     * mês que vendeu bem e recebeu devagar.
     */
    return (filterFn: (dateISO: string) => boolean) => {
      const result = computePeriodResult({
        sales: store.sales,
        expenses: store.expenses,
        stockLosses: store.stockLosses,
        commissionPayments: store.commissionPayments,
        sellerDebtPayments: store.sellerDebtPayments,
        costOf: store.saleUnitCost,
        inPeriod: filterFn,
      });
      // Reposição de estoque (investimento — exibido separadamente, NÃO reduz lucro)
      const restock = store.stockEntries.filter(e => filterFn(e.date)).reduce((sum, e) => sum + e.totalCost, 0);
      return { ...result, restock };
    };
  }, [store.sales, store.expenses, store.stockEntries, store.stockLosses, store.commissionPayments, store.sellerDebtPayments, store.saleUnitCost]);

  const isGeral = filter === GERAL;

  /**
   * O período escolhido como JANELA e como TESTE, num lugar só.
   *
   * O `inPeriod` é o mesmo que os cartões da tela usam e o mesmo que o
   * relatório recebe — duas definições do que é "este mês" acabariam
   * divergindo num canto, e a planilha discordaria da tela por uma venda.
   *
   * Em "Geral" a janela vai do lançamento mais antigo até hoje: `inPeriod`
   * aceita tudo de qualquer jeito, mas as datas são o que o relatório imprime
   * no cabeçalho e o que decide quais MESES a comissão fecha.
   */
  const period = useMemo(() => {
    if (!isGeral) {
      const [y, m] = filter.split("-").map(Number);
      const ref = new Date(y, m - 1, 15);
      const start = startOfMonth(ref);
      const end = endOfMonth(ref);
      return { start, end, inPeriod: (d: string) => isWithinInterval(parseISO(d), { start, end }) };
    }
    // `Math.min(...array)` estoura a pilha com histórico grande — daí o laço.
    let oldest = Infinity;
    const scan = (rows: { date: string }[]) => rows.forEach(r => {
      const t = Date.parse(r.date);
      if (!isNaN(t) && t < oldest) oldest = t;
    });
    scan(store.sales); scan(store.expenses); scan(store.stockEntries);
    return {
      start: Number.isFinite(oldest) ? new Date(oldest) : new Date(),
      end: new Date(),
      inPeriod: () => true,
    };
  }, [filter, isGeral, store.sales, store.expenses, store.stockEntries]);

  const periodStats = useMemo(() => computeStats(period.inPeriod), [period, computeStats]);

  const prevStats = useMemo(() => {
    if (isGeral) return null;
    const [y, m] = filter.split("-").map(Number);
    const prev = subMonths(new Date(y, m - 1, 15), 1);
    const prevLabel = format(prev, "MMM", { locale: ptBR });
    // Mês EM CURSO compara com o MESMO TRECHO do mês anterior (até o mesmo
    // dia), não com o mês fechado — a mesma régua do "Ritmo do mês" das
    // Despesas. Dia 5 contra um mês inteiro dava "−80%" em todo começo de mês,
    // e a seta vermelha deixava de querer dizer alguma coisa. Mês já fechado
    // compara com o mês anterior inteiro, que é trecho igual de fato.
    const now = new Date();
    const running = y === now.getFullYear() && m - 1 === now.getMonth();
    if (running) {
      const stretch = sameStretchOfPreviousMonth(y, m - 1, now.getDate());
      const interval = { start: stretch.start, end: stretch.end };
      return {
        stats: computeStats((d) => isWithinInterval(parseISO(d), interval)),
        label: `${prevLabel} até o dia ${stretch.day}`,
      };
    }
    const interval = { start: startOfMonth(prev), end: endOfMonth(prev) };
    return { stats: computeStats((d) => isWithinInterval(parseISO(d), interval)), label: prevLabel };
  }, [filter, isGeral, computeStats]);

  /**
   * Estatísticas por modelo. O giro (vendas/dia) e o "parado há X dias" olham
   * sempre o histórico recente — são números do futuro, não do período filtrado.
   * Já receita e quantidade seguem o filtro.
   */
  const modelStats = useMemo(
    () => computeModelStats({
      // `activeProducts`: modelo fora de linha não é candidato a reposição.
      // Zerado e sem giro ele já não entraria, mas o que acabou de ser
      // arquivado ainda tem venda na janela — e apareceria no topo pedindo
      // reposição de algo que a pessoa decidiu não repor mais.
      products: store.activeProducts,
      sales: store.sales,
      periodSales: periodStats.sales,
      purchaseOrders: store.purchaseOrders,
    }),
    [store.activeProducts, store.sales, store.purchaseOrders, periodStats.sales],
  );

  const restock = useMemo(() => summarizeRestock(modelStats), [modelStats]);

  /**
   * A compra que o botão do card monta: TODOS os modelos que precisam de
   * pedido, não só os seis da tabela (ver src/lib/purchase-draft.ts). Vai no
   * estado do link e o painel "Nova compra" da Entrada abre preenchido.
   */
  const purchaseDraft = useMemo(() => restockToPurchaseDraft(restock.urgent), [restock.urgent]);

  /**
   * Os maiores pedidos. NÃO completa a tabela com modelo que não precisa de
   * nada: linha de enchimento era ruído ocupando o lugar de decisão.
   */
  const restockRows = useMemo(() => restock.urgent.slice(0, MAX_RESTOCK_ROWS), [restock.urgent]);

  /**
   * O que a tabela não mostra. Modelo já comprado sai da lista para ela caber
   * numa olhada, mas continua contado aqui — some da tabela, não do card.
   *
   * O balde de "venda isolada" saiu junto com a conta antiga: ele existia para
   * barrar uma PROJEÇÃO de giro feita em cima de uma venda só. O mínimo não
   * projeta nada, é a decisão do dono sobre o que quer ter na prateleira.
   */
  const restockAsides = useMemo(() => {
    const parts: string[] = [];
    const hidden = restock.urgent.length - restockRows.length;
    if (hidden > 0) parts.push(`+${hidden} pedido${hidden > 1 ? "s" : ""} menor${hidden > 1 ? "es" : ""}`);
    if (restock.orderedCount > 0) {
      parts.push(`${restock.orderedCount} já pedido${restock.orderedCount > 1 ? "s" : ""}, ${restock.orderedUnits} un. a caminho`);
    }
    if (restock.staleCount > 0) {
      parts.push(
        `${restock.staleCount} parado${restock.staleCount > 1 ? "s" : ""} há mais de ${STALE_DAYS} dias travando ${formatCurrencyShort(restock.staleValue)}`,
      );
    }
    return parts;
  }, [restock, restockRows.length]);

  /**
   * Ranking de modelos por receita no período.
   *
   * Era uma barra empilhada com a porcentagem escrita DENTRO de cada faixa (e
   * só quando passava de 14%, senão não cabia) mais uma legenda de pares
   * "quadradinho + nome + valor" embrulhando embaixo. Dois problemas: números
   * amontoados numa faixa só, onde comparar o terceiro com o quarto exigia
   * medir com o olho; e uma faixa "Outros 4 modelos" que ocupava espaço sem
   * dizer nada — não dá para agir sobre ela, e ela não diz quais são.
   *
   * Agora é lista ordenada, uma linha por modelo, e a cauda vira uma LINHA DE
   * RODAPÉ em texto terciário: continua contando quanto ficou de fora (nada
   * some em silêncio, a mesma regra do rodapé do "Repor agora"), sem competir
   * por atenção com o que se pode ler.
   *
   * `max` é a receita do LÍDER, e é contra ela que as barras são escaladas —
   * não contra o total. Comparar contra o total deixaria o primeiro com um
   * terço da largura e os últimos com fiapos indistinguíveis; contra o líder, a
   * barra responde "quanto este vende perto do que mais vende", que é a
   * pergunta do ranking. A porcentagem ao lado continua sendo a fatia do TOTAL:
   * são dois fatos diferentes, cada um na forma que lhe cabe.
   *
   * `key` vem do modelo (marca|modelo) porque dois modelos de marcas diferentes
   * podem ter o mesmo nome — o nome sozinho não é único, e é por isso que a
   * linha mostra os dois.
   */
  const topModels = useMemo(() => {
    const sold = modelStats.filter(m => m.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const total = sold.reduce((s, m) => s + m.revenue, 0);
    const rows = sold.slice(0, TOP_MODELS).map(m => ({
      key: m.key,
      brand: m.brand,
      model: m.model,
      revenue: m.revenue,
      qty: m.qty,
      pct: total > 0 ? (m.revenue / total) * 100 : 0,
    }));
    const rest = sold.slice(TOP_MODELS);
    const restRevenue = rest.reduce((s, m) => s + m.revenue, 0);
    return {
      total,
      rows,
      max: rows[0]?.revenue ?? 0,
      restCount: rest.length,
      restRevenue,
      restPct: total > 0 ? (restRevenue / total) * 100 : 0,
    };
  }, [modelStats]);

  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);
      const interval = { start, end };

      // A MESMA conta do cartão do período (`computeStats`), mês a mês — o
      // gráfico e o número do trilho não podem contar lucro de dois jeitos.
      const r = computeStats(d => isWithinInterval(parseISO(d), interval));

      // O último ponto é o mês EM CURSO: tem só os dias que já passaram, e
      // desenhado como mês fechado ele caía em todo começo de mês — uma queda
      // que não existe. O rótulo leva o dia, e é o mesmo texto que o tooltip
      // mostra e que a aba "Evolução 6 meses" do Excel imprime.
      const partial = i === 0;
      const longLabel = format(date, "MMMM/yyyy", { locale: ptBR }).replace(/^./, c => c.toUpperCase());

      months.push({
        month: format(date, "MMM", { locale: ptBR }),
        monthLong: partial ? `${longLabel} · até o dia ${date.getDate()}` : longLabel,
        partial,
        receita: r.revenue,
        lucro: r.netProfit,
        margem: r.netMargin,
        // O gráfico não desenha as de baixo; o relatório imprime. Ficam aqui
        // porque é a MESMA passada pelos mesmos meses — recalcular por fora é
        // como as duas leituras do mínimo já divergiram uma vez.
        cogs: r.cogs,
        despesas: r.expenses,
        perdas: r.losses,
        vendedores: r.sellerCost,
        vendas: r.salesCount,
        unidades: r.sales.reduce((sum, s) => sum + s.quantity, 0),
      });
    }
    return months;
  }, [computeStats]);

  /**
   * A série do gráfico partida em duas: os meses fechados em linha cheia e o
   * trecho que chega ao mês em curso tracejado — o jeito de um gráfico dizer
   * "isto ainda não acabou". O ponto do último mês fechado entra nas duas,
   * senão a linha teria um buraco entre eles. Fica fora do `monthlyData`
   * porque é desenho: o relatório recebe o `monthlyData` e não usaria isto.
   */
  const chartData = useMemo(() => {
    const cut = monthlyData.findIndex(m => m.partial);
    return monthlyData.map((m, i) => {
      const solid = cut === -1 || i < cut;
      const dashed = cut !== -1 && i >= cut - 1;
      return {
        ...m,
        receitaCheia: solid ? m.receita : null,
        lucroCheio: solid ? m.lucro : null,
        receitaParcial: dashed ? m.receita : null,
        lucroParcial: dashed ? m.lucro : null,
      };
    });
  }, [monthlyData]);
  const partialMonth = monthlyData.find(m => m.partial);

  const avgMargin = useMemo(() => {
    const withRevenue = monthlyData.filter(m => m.receita > 0);
    if (!withRevenue.length) return 0;
    return withRevenue.reduce((s, m) => s + m.margem, 0) / withRevenue.length;
  }, [monthlyData]);

  const filterLabel = monthOptions.find(o => o.value === filter)?.label ?? "";

  /**
   * O período da tela no vocabulário do endereço de Vendas. Todo link que sai
   * daqui leva ESTE recorte, e só filtros que reproduzem lá o número clicado
   * aqui (ver src/lib/sales-link.ts) — é por isso que o "recebido" não é link.
   */
  const salesPeriod: SalesLinkFilter = isGeral
    ? { all: true }
    : { from: isoDay(period.start), to: isoDay(period.end) };

  /**
   * Saldo de HOJE com cada vendedor — a mesma conta que decide o arquivamento
   * na Distribuição (`currentBalanceContext`), e não a do período da tela: o
   * que se deve a alguém não muda porque se está olhando junho.
   */
  const sellerBalances = useMemo(() => {
    const ctx = currentBalanceContext({
      sales: store.sales,
      commissionPayments: store.commissionPayments,
      sellerDebtPayments: store.sellerDebtPayments,
      sellerManualDebts: store.sellerManualDebts,
    });
    return summarizeSellerBalances(store.sellers, seller => computeSellerBalance(seller, ctx).balance);
  }, [store.sales, store.commissionPayments, store.sellerDebtPayments, store.sellerManualDebts, store.sellers]);
  const netPositive = periodStats.netProfit >= 0;

  const delta = (current: number, previous: number | undefined) => {
    if (prevStats == null || previous === undefined) return undefined;
    if (previous === 0) return undefined;
    return { pct: ((current - previous) / Math.abs(previous)) * 100, label: prevStats.label };
  };

  /**
   * Segue o período, como todo o resto do trilho. Era o histórico inteiro com
   * "673 total" embaixo de "Dinheiro do mês", e num mês fechado a lista
   * mostrava vendas de hoje — número de fora do recorte sem dizer que era.
   */
  const recentSales = useMemo(
    () => store.sales.filter(s => s.type === "venda" && period.inPeriod(s.date)),
    [store.sales, period],
  );

  /**
   * O relatório em Excel.
   *
   * A MONTAGEM mora em `src/lib/report-workbook.ts` (função pura, testada em
   * `src/test/report-workbook.test.ts`); aqui fica só o que precisa do
   * navegador: carregar a biblioteca sob demanda, virar planilha e baixar.
   *
   * Tudo o que a tela já calculou entra por parâmetro — `modelStats`,
   * `monthlyData`, o `inPeriod` do filtro e os seletores do razão. O relatório
   * não refaz conta nenhuma: número que aparece em duas telas é a MESMA conta
   * nas duas, e a planilha é só mais uma tela.
   */
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");

      const sheets = buildReport({
        generatedAt: new Date(),
        periodLabel: isGeral ? "Geral (todo período)" : filterLabel,
        branchLabel: branchId ? branchName(branchId) : "Todas as filiais",
        start: period.start,
        end: period.end,
        inPeriod: period.inPeriod,

        products: store.products,
        hiddenModels: store.hiddenModels,
        sales: store.sales,
        expenses: store.expenses,
        stockEntries: store.stockEntries,
        stockLosses: store.stockLosses,
        stockTransfers: store.stockTransfers,
        purchaseOrders: store.purchaseOrders,
        productAssignments: store.productAssignments,
        sellers: store.sellers,
        commissionPayments: store.commissionPayments,
        sellerDebtPayments: store.sellerDebtPayments,
        sellerManualDebts: store.sellerManualDebts,
        partners: store.partners,
        proLaborePayments: store.proLaborePayments,
        partnerContributions: store.partnerContributions,
        loans: store.loans,
        loanPayments: store.loanPayments,
        investors: store.investors,
        dividends: store.dividends,
        // O razão linha a linha não mora na memória (as posições já vêm
        // somadas pelo banco): é lido aqui, na hora de montar o arquivo.
        financialEvents: await store.loadFinancialEvents(),

        modelStats,
        monthly: monthlyData,
        position: {
          cash: store.getCash(),
          inventory: store.getInventoryCostValue(),
          receivables: store.getReceivables(),
          partnerCapital: store.getPartnerCapital(),
          loansOutstanding: store.getLoansOutstanding(),
          accumulatedProfit: store.getAccumulatedProfit(),
          distributedProfit: store.getDistributedProfit(),
          retainedEarnings: store.getRetainedEarnings(),
        },
        branchName,
        costOf: store.saleUnitCost,
      });

      const wb = XLSX.utils.book_new();
      sheets.forEach(sheet => {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
        ws["!cols"] = sheet.widths.map(wch => ({ wch }));
        // As setinhas de ordenar e filtrar na linha do cabeçalho. É o que
        // transforma uma aba de mil vendas em algo que se consulta.
        if (sheet.autofilter && ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
        XLSX.utils.book_append_sheet(wb, ws, sheet.name);
      });

      const slug = (s: string) =>
        s.normalize("NFD").replace(/[̀-ͯ]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const place = branchId ? `-${slug(branchName(branchId))}` : "";
      XLSX.writeFile(wb, `california${place}-${isGeral ? "geral" : filter}.xlsx`);
      toast.success(`Relatório com ${sheets.length} abas`);
    } catch (err) {
      console.error(err);
      toast.error("Falha ao exportar");
    } finally {
      // Sem o `finally` um erro deixaria o botão desabilitado para sempre — a
      // mesma regra de toda tela que troca de estado depois de um `await`.
      setExporting(false);
    }
  }

  /* ================================================================
   * Os blocos. Cada um é desenhado a partir do layout de quem usa (ver
   * src/lib/dashboard-layout.ts): a mesma conta, em qualquer lugar da tela.
   * ================================================================ */

  const restockWidget = (
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
            {modelStats.length === 0 ? "Nenhum modelo cadastrado ainda." : "Nenhum modelo em giro precisa de pedido."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* Nem toda coluna cabe num telefone, e alargar não resolve: o
                `min-w` de 560px virava arrasto lateral. O card responde UMA
                pergunta — quanto pedir hoje —, e ela se lê com o estoque, o
                mínimo e o quanto pedir; o resto é o PORQUÊ do número, e o
                porquê cabe na tela grande. Foi assim que saíram "Vende/dia" e
                "Margem", e é por isso que "Vendeu" sai abaixo do `sm`. A
                ordem ("Pedir" por último, e a lista ordenada por unidades a
                pedir) não muda: é ela que decide quem entra aqui. */}
            <table className="w-full min-w-0 text-[13px] sm:min-w-[560px]">
              {/* A conta fecha na horizontal: o estoque de hoje contra o
                  mínimo, o que saiu no período (só no `sm` para cima), e o
                  que pedir. "Dura tantos dias", "Vende/dia" e "Margem" saíram —
                  eram a leitura da conta ANTIGA, que projetava giro; a de
                  agora é uma subtração contra o mínimo, e mostrar a projeção
                  ao lado dela seria oferecer duas réguas para o mesmo
                  número. O que está a caminho aparece embaixo do "Pedir",
                  porque é o que explica um pedido menor que a falta. */}
              <thead>
                <tr style={{ color: "var(--nc-text-3)" }}>
                  <th className="px-2 py-1.5 text-left font-normal">Modelo</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-right font-normal">Estoque / mín.</th>
                  {/* Com as quatro colunas em 390px não sobrava largura para
                      os números ficarem numa linha: "16 un." quebrava em duas,
                      a régua "12 / 20" quebrava junto, e cada modelo ficava
                      com uma altura diferente — tabela que não alinha deixa de
                      ser tabela. O `whitespace-nowrap` das colunas de número é
                      o par disto: sem uma delas, ou volta a quebra, ou volta o
                      arrasto lateral. */}
                  <th className="hidden whitespace-nowrap px-2 py-1.5 text-right font-normal sm:table-cell">Vendeu</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-right font-normal">Pedir</th>
                </tr>
              </thead>
              <tbody>
                {restockRows.map(m => <RestockRow key={m.key} model={m} />)}
              </tbody>
            </table>
          </div>
        )}

        <div className="nc-rule-top mt-3 flex flex-wrap items-center justify-between gap-3 pt-3">
          {/* O total do pedido em cima; embaixo, em tom terciário, o que
              NÃO está na tabela — nada sai da lista em silêncio.

              12,5px e não 11,5 na linha de cima: quantas unidades e quanto
              custa voltar ao mínimo são a CONCLUSÃO do card, e estavam no
              mesmo corpo do rodapé de ressalvas logo abaixo. O que se lê antes
              de decidir não pode ser do tamanho do que se lê depois. */}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
              {restock.horizonUnits > 0 ? (
                <>
                  <strong className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>
                    {restock.horizonUnits} un.
                  </strong>{" "}
                  para voltar ao mínimo ·{" "}
                  <strong className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>
                    {formatCurrencyShort(restock.horizonCost)}
                  </strong>{" "}
                  a custo
                </>
              ) : (
                <>Nenhum modelo abaixo do mínimo.</>
              )}
            </span>
            {restockAsides.length > 0 && (
              <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                {restockAsides.join(" · ")}
              </span>
            )}
          </div>
          {/* Com pedido a fazer, o botão LEVA a lista: o painel "Nova compra"
              abre preenchido na Entrada, para conferir quantidade e custo e
              registrar. Sem pedido, continua sendo só o caminho da Entrada.
              É `.nc-btn` (e não um link desenhado à mão) para ganhar os 40px
              de alvo no toque, como todo botão do sistema. */}
          <Link
            to="/stock"
            state={purchaseDraft.length > 0 ? { [PURCHASE_DRAFT_KEY]: purchaseDraft } : undefined}
            className="nc-btn nc-btn--outline flex-none"
          >
            {purchaseDraft.length > 0
              ? <>Montar compra · {purchaseDraft.length} modelo{purchaseDraft.length === 1 ? "" : "s"}</>
              : <>Abrir entrada de estoque</>}
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );

  /**
   * `grow`: só na coluna do modo vertical o gráfico cresce para consumir a
   * sobra da tela. Na grade ele teria de esticar a linha inteira dos vizinhos,
   * e no trilho não há sobra nenhuma.
   */
  const performanceWidget = (frame: Frame, grow: boolean) => (
    <section className={cn("min-w-0 flex flex-col", frame === "card" && "nc-card p-4", grow && "xl:flex-1")}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-[15px]">Desempenho financeiro</h2>
        <div className="flex flex-wrap items-center gap-3.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ background: "var(--nc-accent)" }} /> Receita
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ background: "var(--nc-profit)" }} /> Lucro líquido
          </span>
          {/* O tracejado explicado na legenda, e não só no tooltip: quem não
              passa o mouse no último ponto também precisa saber que ele é
              parcial. */}
          {partialMonth && (
            <span className="flex items-center gap-1.5">
              <span className="w-3.5 border-t border-dashed" style={{ borderColor: "var(--nc-text-2)" }} />
              {partialMonth.month} até o dia {new Date().getDate()}
            </span>
          )}
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
      <div className={cn(frame === "rail" ? "h-[180px]" : "h-[212px]", grow && "xl:h-auto xl:min-h-[212px] xl:flex-1")}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              width={frame === "rail" ? 40 : 50}
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
            <Area type="monotone" dataKey="receitaCheia" stroke={CHART_REVENUE} strokeWidth={2} fill="url(#gradReceita)" name="Receita" />
            <Area type="monotone" dataKey="lucroCheio" stroke={CHART_PROFIT} strokeWidth={2} fill="url(#gradLucro)" name="Lucro Líquido" />
            {/* O trecho do mês em curso: mesma cor, traço interrompido e
                preenchimento pela metade. */}
            <Area type="monotone" dataKey="receitaParcial" stroke={CHART_REVENUE} strokeWidth={2} strokeDasharray="4 4" fill="url(#gradReceita)" fillOpacity={0.5} name="Receita (parcial)" />
            <Area type="monotone" dataKey="lucroParcial" stroke={CHART_PROFIT} strokeWidth={2} strokeDasharray="4 4" fill="url(#gradLucro)" fillOpacity={0.5} name="Lucro Líquido (parcial)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );

  const topModelsWidget = (frame: Frame) => {
    // No trilho não há moldura, então as linhas encostam na borda do trilho em
    // vez de ganhar o recuo do card.
    const pad = frame === "card" ? "px-4" : "";
    return (
      <section className={cn(frame === "card" && "nc-card overflow-hidden")}>
        <div className={cn("flex flex-wrap items-baseline justify-between gap-2 pb-3", pad, frame === "card" && "pt-3.5")}>
          <h2 className="text-[15px]">Modelos mais vendidos</h2>
          {topModels.total > 0 && (
            <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              {formatCurrencyShort(topModels.total)} no período
            </span>
          )}
        </div>

        {topModels.rows.length === 0 ? (
          <p className={cn("pb-4 text-xs", pad)} style={{ color: "var(--nc-text-3)" }}>Nenhuma venda no período.</p>
        ) : (
          <>
            {/* Cada linha abre Vendas com o modelo e o período — por MARCA +
                modelo, porque o nome sozinho junta dois produtos. O chevron é
                o aviso de que a linha é tocável, e não um efeito de hover: no
                toque não existe hover para anunciar nada. */}
            {topModels.rows.map((m, i) => (
              <Link
                key={m.key}
                to={buildSalesLink({ ...salesPeriod, model: { brand: m.brand, model: m.model } })}
                aria-label={`Ver as vendas de ${m.model} · ${m.brand}`}
                className={cn("nc-row nc-hover nc-drill block py-2.5", pad)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[13px]">
                    {m.model}
                    <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                  </p>
                  <span className="nc-num flex flex-none items-center gap-1 text-[13px]">
                    {formatCurrencyShort(m.revenue)}
                    <ChevronRight size={13} className="nc-drill-cue" />
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2.5">
                  {/* A barra é escalada pelo LÍDER, a porcentagem é do TOTAL.
                      Ver o comentário do `topModels`. */}
                  <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--nc-track)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${topModels.max > 0 ? Math.max((m.revenue / topModels.max) * 100, 2) : 0}%` }}
                      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      style={{ background: segmentTint(i) }}
                    />
                  </div>
                  <span className="nc-num flex-none text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                    {m.qty} un. · {formatPct(m.pct, 0)}
                  </span>
                </div>
              </Link>
            ))}

            {/* A cauda como LINHA, não como faixa na barra: continua dizendo
                quanto ficou de fora — número que encolhe sem explicação faz
                duvidar do número — sem ocupar o lugar do que se pode ler. */}
            {topModels.restCount > 0 && (
              <p className={cn("py-2.5 text-[11px]", pad)} style={{ color: "var(--nc-text-3)" }}>
                + {topModels.restCount} modelo{topModels.restCount > 1 ? "s" : ""} somam{" "}
                <span className="nc-num">{formatCurrencyShort(topModels.restRevenue)}</span>
                {" "}({formatPct(topModels.restPct, 0)} do período)
              </p>
            )}
          </>
        )}
      </section>
    );
  };

  const revenueDelta = delta(periodStats.revenue, prevStats?.stats.revenue);

  const revenueWidget = (
    <div className="flex flex-col gap-3.5">
      <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>
        Dinheiro do {isGeral ? "período" : "mês"}
      </span>
      <div>
        {/* A base da comparação ESCRITA, não num `title`: "+41%" sem dizer
            contra o quê é número que não se explica, e no toque o `title`
            nunca aparece. A mesma base vale para as outras variações da tela. */}
        {/* O rótulo e o número abrem as vendas do período: em Vendas o trilho
            mostra a MESMA receita, e o mesmo par recebido/a receber. */}
        <Link to={buildSalesLink(salesPeriod)} className="nc-drill block" aria-label="Ver as vendas do período">
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-0.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
              Receita <ChevronRight size={12} className="nc-drill-cue" />
            </span>
            {revenueDelta && (
              <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                vs {revenueDelta.label}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <AnimatedNumber
              value={periodStats.revenue}
              format={formatCurrencyShort}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
            <Delta delta={revenueDelta} />
          </div>
        </Link>
        {/* Divisão REAL do total: cada real vendido está de um lado ou do
            outro. O recebido é --nc-ok e NÃO --nc-accent — o verde é dinheiro
            que já está na mão, e o accent é o dinheiro todo (a receita logo
            acima). Com o accent aqui, a metade recebida tinha a mesma cor do
            total que ela divide, e o par com o --nc-alert só se lia depois de
            ler os dois números. É a mesma barra de Vendas e do Financeiro, que
            já usavam o verde: este era o único lugar fora do vocabulário. */}
        <div className="mt-2 flex h-[5px] gap-0.5">
          <div style={{ flex: Math.max(periodStats.received, 0.001), background: "var(--nc-ok)", borderRadius: 2 }} />
          <div style={{ flex: Math.max(periodStats.receivable, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
        </div>
        {/* "A receber" abre as vendas com saldo do período — em Vendas, o "a
            receber" do trilho é este mesmo número. O "recebido" NÃO é link: ele
            soma a parte paga das vendas parciais, e nenhuma lista de vendas
            fecha nesse valor. Sublinhado pontilhado e não chevron: é texto
            corrido de 11px, e o chevron ali disputaria com o número. */}
        <div className="mt-1.5 flex justify-between gap-2 text-[11px] nc-num">
          <span style={{ color: "var(--nc-ok)" }}>recebido {formatCurrencyShort(periodStats.received)}</span>
          {periodStats.receivable > 0.01 ? (
            <Link
              to={buildSalesLink({ ...salesPeriod, status: "due" })}
              className="nc-drill underline decoration-dotted underline-offset-[3px]"
              style={{ color: "var(--nc-alert)" }}
            >
              a receber {formatCurrencyShort(periodStats.receivable)}
            </Link>
          ) : (
            <span style={{ color: "var(--nc-alert)" }}>a receber {formatCurrencyShort(periodStats.receivable)}</span>
          )}
        </div>
      </div>
    </div>
  );

  const resultWidget = (
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
      {/* As duas saídas que o lucro daqui não contava e o razão sempre contou.
          Sem elas na tela, o "Lucro líquido" embaixo não fecharia com as
          linhas de cima. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− Perdas</span>
        <span className="nc-num text-sm">{formatCurrencyShort(periodStats.losses)}</span>
      </div>
      {/* A composição fica escrita embaixo: era um `title`, e "Vendedores" é
          a única linha da conta que não se explica pelo nome. */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− Vendedores</span>
          <span className="nc-num text-sm">{formatCurrencyShort(periodStats.sellerCost)}</span>
        </div>
        <span className="block text-[11px]" style={{ color: "var(--nc-text-3)" }}>
          comissão paga + consumo a custo − dívida devolvida
        </span>
      </div>
      <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
        <span className="text-[12.5px]">Lucro líquido</span>
        {/* Lucro em --nc-profit, a MESMA cor da série "Lucro líquido" do
            gráfico e da legenda dele — o mesmo número em duas peças da mesma
            tela não pode ter duas cores. Estava em --nc-accent, que é a cor da
            RECEITA (a série de cima no gráfico, a barra do recebido): as duas
            pontas da conta saíam iguais justamente onde a tela existe para
            separá-las. Prejuízo continua em --nc-crit, que é o mesmo #F09595
            do CHART_LOSS. */}
        <span style={{ color: netPositive ? "var(--nc-profit)" : "var(--nc-crit)" }}>
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
  );

  const indicatorsWidget = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Ticket médio</span>
        <div className="nc-num text-base font-semibold">
          {formatCurrency(periodStats.ticket)}{" "}
          <Delta delta={delta(periodStats.ticket, prevStats?.stats.ticket)} />
        </div>
      </div>
      <div>
        {/* Posição de HOJE, não do mês: ao lado do ticket (que segue o
            período) ela precisa dizer isso na própria linha. */}
        <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Estoque a custo</span>
        <div className="nc-num text-base font-semibold">{formatCurrencyShort(inventoryAtCost)}</div>
        <span className="text-[11px] nc-num" style={{ color: "var(--nc-text-3)" }}>{totalStock} un. hoje</span>
      </div>
    </div>
  );

  const grossProfitWidget = (
    <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
      <Percent size={12} />
      <span>Lucro bruto do período</span>
      <span className="ml-auto nc-num font-semibold" style={{ color: "var(--nc-text)" }}>
        {formatCurrencyShort(periodStats.grossProfit)}
      </span>
    </div>
  );

  const recentSalesWidget = (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>
          Últimas vendas
        </span>
        <Link
          to={buildSalesLink(salesPeriod)}
          className="nc-drill nc-num inline-flex items-center gap-0.5 text-[11px]"
          style={{ color: "var(--nc-text-3)" }}
        >
          {recentSales.length} no {isGeral ? "período" : "mês"}
          <ChevronRight size={12} className="nc-drill-cue" />
        </Link>
      </div>
      {recentSales.length === 0 ? (
        <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma venda no período.</p>
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
  );

  /**
   * O saldo com os vendedores, HOJE. As duas pontas separadas (ver
   * `summarizeSellerBalances`): o que se deve a eles e o que eles devem são
   * dois acertos com pessoas diferentes, e um líquido esconderia os dois.
   * "Devem" em --nc-alert porque é dinheiro a receber; "a pagar" fica neutro —
   * verde é dinheiro que ENTROU, e isto é o contrário.
   */
  const sellersWidget = (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>
            Vendedores
          </span>
          <Link
            to="/commissions"
            className="nc-drill inline-flex items-center gap-0.5 text-[11px]"
            style={{ color: "var(--nc-text-3)" }}
          >
            Distribuição <ChevronRight size={12} className="nc-drill-cue" />
          </Link>
        </div>
        <span className="mt-0.5 block text-[11px]" style={{ color: "var(--nc-text-3)" }}>
          Não segue o período: é o saldo de hoje
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>A pagar</span>
          <div className="nc-num text-base font-semibold">{formatCurrencyShort(sellerBalances.payable)}</div>
        </div>
        <div>
          <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Devem</span>
          <div
            className="nc-num text-base font-semibold"
            style={sellerBalances.owed > 0.01 ? { color: "var(--nc-alert)" } : undefined}
          >
            {formatCurrencyShort(sellerBalances.owed)}
          </div>
        </div>
      </div>
      {sellerBalances.rows.length === 0 ? (
        <p className="py-2 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhum saldo em aberto.</p>
      ) : (
        <div className="flex flex-col">
          {sellerBalances.rows.slice(0, MAX_SELLER_ROWS).map(({ seller, balance }) => (
            <div key={seller.id} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {seller.name}
                {seller.archivedAt && <span style={{ color: "var(--nc-text-3)" }}> · arquivado</span>}
              </span>
              <span className="nc-num flex-none" style={balance < 0 ? { color: "var(--nc-alert)" } : undefined}>
                {balance > 0 ? "a pagar " : "deve "}
                {formatCurrencyShort(Math.abs(balance))}
              </span>
            </div>
          ))}
          {sellerBalances.rows.length > MAX_SELLER_ROWS && (
            <p className="pt-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              + {sellerBalances.rows.length - MAX_SELLER_ROWS} com saldo, na Distribuição
            </p>
          )}
        </div>
      )}
    </div>
  );

  /** Bloco nascido no trilho, levado para a coluna ou para a grade: ganha a moldura. */
  const inCard = (id: WidgetId, body: ReactNode) => (
    <section className="nc-card flex flex-col gap-3 p-4">
      {CARD_TITLE[id] && <h2 className="text-[15px]">{CARD_TITLE[id]}</h2>}
      {body}
    </section>
  );

  const renderWidget = (id: WidgetId, frame: Frame, grow = false): ReactNode => {
    switch (id) {
      case "restock": return restockWidget;
      case "performance": return performanceWidget(frame, grow);
      case "topModels": return topModelsWidget(frame);
      default: {
        const body = {
          revenue: revenueWidget,
          result: resultWidget,
          indicators: indicatorsWidget,
          grossProfit: grossProfitWidget,
          recentSales: recentSalesWidget,
          sellers: sellersWidget,
        }[id];
        return frame === "card" ? inCard(id, body) : body;
      }
    }
  };

  const shown = visibleWidgets(layout);
  const isCards = layout.mode === "cards";
  // Trilho vazio não é desenhado: a coluna ocupa a largura inteira em vez de
  // deixar uma faixa escura sem nada dentro.
  const hasRail = !isCards && shown.rail.length > 0;
  /**
   * Abaixo do xl o trilho cai para o FIM da página (`RAIL`, não `RAIL_FIRST`:
   * a coluna do Dashboard é gráfico e tabela, e o trilho inteiro em cima
   * empurraria o "Repor agora" para a terceira tela). Mas ali o dinheiro do
   * mês só aparecia depois de ~1.200px de rolagem, e o celular é metade do
   * uso. Então Receita e Resultado — os dois blocos que respondem "como foi o
   * mês" — sobem para o topo da coluna abaixo do xl e somem do trilho nesse
   * tamanho: o mesmo bloco, desenhado em um lugar por vez. O resto do trilho
   * continua embaixo. Vale só no modo vertical; nos cards a ordem já é a que
   * a pessoa escolheu.
   */
  const railEarly = hasRail ? shown.rail.filter(w => EARLY_ON_SMALL.includes(w.id)) : [];
  const railRest = shown.rail.filter(w => !EARLY_ON_SMALL.includes(w.id));

  return (
    // `/dashboard` está em `fullBleedRoutes` (AppLayout), então chega aqui sem
    // padding e sem max-width — o painel encosta nas bordas sozinho. O `flex-1`
    // estica o painel até o rodapé da janela, para o trilho da direita e o fundo
    // escuro cobrirem a tela inteira mesmo com pouco conteúdo.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className={cn(STICKY_HEAD, "flex flex-wrap items-end justify-between gap-4")}>
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>
              {isGeral ? "Todo o período" : filterLabel}
            </span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Dashboard</h1>
          </div>

          {/* `flex-wrap`: são até cinco chips de período mais o exportar, o que
              passa da largura de um telefone — sem quebra a faixa saía do
              cabeçalho.

              O exportar era um <button> cru com `p-2`, ou seja, 31px de alvo, e
              por não ser `.nc-btn` ficava de fora do `pointer: coarse` que dá
              44px a todos os outros. Agora é a peça do sistema, com o mesmo
              fantasma de ícone da sidebar. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => monthSteps.older && setFilter(monthSteps.older.value)}
                disabled={!monthSteps.older}
                title={monthSteps.older ? `Abrir ${monthSteps.older.label} (←)` : "Não há mês anterior com lançamento"}
                aria-label="Mês anterior"
                aria-keyshortcuts="ArrowLeft"
                className="nc-btn nc-btn--ghost nc-btn--icon disabled:opacity-40"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => monthSteps.newer && setFilter(monthSteps.newer.value)}
                disabled={!monthSteps.newer}
                title={monthSteps.newer ? `Abrir ${monthSteps.newer.label} (→)` : "Este é o mês mais recente"}
                aria-label="Mês seguinte"
                aria-keyshortcuts="ArrowRight"
                className="nc-btn nc-btn--ghost nc-btn--icon disabled:opacity-40"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <SegmentedChips options={periodOptions} value={filter} onChange={setFilter} />
            <DashboardCustomizeSheet layout={layout} onChange={updateLayout} onReset={resetLayout} />
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              title={exporting ? "Montando o relatório…" : "Baixar relatório em Excel"}
              aria-label={exporting ? "Montando o relatório" : "Baixar relatório em Excel"}
              className="nc-btn nc-btn--ghost nc-btn--icon"
            >
              <Download size={15} />
            </button>
          </div>
        </header>

        {shown.all.length === 0 ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            Todos os blocos estão escondidos. Use o botão de personalizar, no alto, para trazer algum de volta.
          </p>
        ) : isCards ? (
          // A grade: 1 coluna no celular, 2 no md, 4 no xl. Os cards de uma
          // mesma linha ficam da mesma altura (`h-full`), senão a grade vira
          // escada.
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {shown.all.map(w => (
              <div key={w.id} className={cn("min-w-0 [&>section]:h-full", SPAN[w.size])}>
                {renderWidget(w.id, "card")}
              </div>
            ))}
          </div>
        ) : (
          <>
            {railEarly.length > 0 && (
              <section className="nc-card flex flex-col gap-3.5 p-4 xl:hidden">
                {railEarly[0].id !== "revenue" && <h2 className="text-[15px]">{CARD_TITLE.result}</h2>}
                {railEarly.map((w, i) => (
                  <Fragment key={w.id}>
                    {i > 0 && <Rule />}
                    {renderWidget(w.id, "rail")}
                  </Fragment>
                ))}
              </section>
            )}
            {shown.main.map(w => (
              <div key={w.id} className={cn("min-w-0", w.id === "performance" && "flex flex-col xl:flex-1")}>
                {renderWidget(w.id, "card", true)}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---------------- Trilho da direita ---------------- */}
      {hasRail && (
        <aside
          // Só com os blocos que subiram, o trilho ficaria vazio embaixo.
          className={cn(RAIL, railRest.length === 0 && "max-xl:hidden")}
          style={{ background: "var(--nc-rail)" }}
        >
          {shown.rail.map((w, i) => {
            const early = railEarly.includes(w);
            // Abaixo do xl a régua só separa dos blocos que FICARAM: a do
            // primeiro deles seria uma linha solta no topo do trilho.
            const firstThatStays = !early && railRest[0] === w;
            return (
              <div key={w.id} className={cn("contents", early && "max-xl:hidden")}>
                {i > 0 && <Rule className={cn(firstThatStays && "max-xl:hidden")} />}
                {renderWidget(w.id, "rail")}
              </div>
            );
          })}
        </aside>
      )}
    </div>
  );
}

/**
 * Tom da barra por posição no ranking: do accent cheio até quase o fundo.
 *
 * A cor é REDUNDANTE com a ordem, de propósito — ela não carrega informação que
 * a posição na lista já não dê. Serve para o olho perceber a escada sem ler
 * número nenhum, e é por isso que ela esmaece para baixo em vez de trocar de
 * matiz: matizes diferentes sugeririam categorias diferentes, e são todos a
 * mesma coisa.
 */
function segmentTint(index: number) {
  const mix = [100, 82, 64, 48, 33, 19][Math.min(index, 5)];
  return `color-mix(in srgb, var(--nc-accent) ${mix}%, var(--nc-bg))`;
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
  // A bolinha mede a falta contra o MÍNIMO, não mais os dias de estoque: tudo
  // aqui já está abaixo do mínimo, e o que ela separa é "faltou um pouco" de
  // "está acabando" (metade do mínimo ou menos).
  const urgency = urgencyOf(model.stock, model.minUnits);
  const dot = urgency === "critical" ? "var(--nc-crit)" : urgency === "warning" ? "var(--nc-alert)" : "var(--nc-text-3)";

  return (
    <tr className="nc-row">
      <td className="px-2 py-1.5">
        {/* `min-w-0` no flex e no nome: sem ele o `truncate` não tem contra o
            que cortar, a célula reserva a linha inteira do texto e a tabela sai
            da tela — o que se via como arrasto lateral no celular. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: dot }} />
          <span className="min-w-0 truncate">{model.model}</span>
          <span className="min-w-0 truncate text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>{model.brand}</span>
        </div>
      </td>
      {/* Estoque de hoje contra o mínimo, lado a lado: é a subtração que
          produz o "Pedir", e vê-la inteira é o que deixa conferir a linha sem
          abrir outra tela. O estoque herda a cor da bolinha; o mínimo fica em
          terciário, porque ele é a régua e não o número que se persegue. */}
      <td className="nc-num whitespace-nowrap px-2 py-1.5 text-right">
        <span style={urgency === "ok" ? undefined : { color: dot }}>{model.stock}</span>
        <span style={{ color: "var(--nc-text-3)" }}> / {model.minUnits}</span>
      </td>
      {/* Escondida no celular junto com o próprio cabeçalho — ver o `thead`. */}
      <td className="nc-num hidden whitespace-nowrap px-2 py-1.5 text-right sm:table-cell" style={{ color: "var(--nc-text-2)" }}>
        {model.qty} un.
      </td>
      {/* Quanto pedir, já descontado o que está a caminho — e o abatimento
          aparece embaixo, senão o número menor não teria explicação. */}
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <span className="nc-num">{model.restockUnits} un.</span>
        {model.incoming > 0 && (
          <span className="block text-[11px] nc-num" style={{ color: "var(--nc-text-3)" }}>
            {model.incoming} a caminho
          </span>
        )}
      </td>
    </tr>
  );
}
