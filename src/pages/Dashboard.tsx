import { useStore } from "@/context/StoreContext";
import { Package, Download, ArrowRight, ChevronLeft, ChevronRight, Loader2, SlidersHorizontal } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { Fragment, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { sameStretchOfPreviousMonth, isoDay, formatDateBR } from "@/lib/date-utils";
import { ptBR } from "date-fns/locale";
import { motion, useReducedMotion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import { listItem, transitionBase } from "@/lib/motion";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { NcButton, Rule, RAIL, STICKY_HEAD, EYEBROW } from "@/components/nocturne";
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
 * O recorte de tempo de um bloco, sempre no mesmo lugar: ao lado do título.
 *
 * A tela mistura três recortes — o mês escolhido, HOJE (estoque, saldo dos
 * vendedores) e os últimos seis meses do gráfico — e cada bloco dizia o seu de
 * um jeito: uma ressalva de 11px embaixo ("Não segue o período: …"), um "un.
 * hoje" no rodapé, ou nada (o Repor agora). Agora é um selo só, com a mesma
 * forma em todo bloco, e o olho aprende onde procurar.
 */
function ScopeTag({ children }: { children: string }) {
  // Maiúscula só na primeira letra ("Setembro", "Hoje", "Últimos 6 meses").
  // Feita no texto e não com `::first-letter`, que não vale em `inline-flex`.
  // `self-start`: dentro de coluna flex o selo esticava na largura inteira.
  return <span className="nc-pill nc-pill--mute nc-num self-start">{children.charAt(0).toUpperCase() + children.slice(1)}</span>;
}

function formatPct(value: number, digits = 1) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/**
 * Rótulo do eixo do gráfico: "1,5k", "−2k", "800". Era `v >= 1000`, que deixava
 * o prejuízo de mil para cima sem abreviar ("-1500") e escrevia o decimal com
 * ponto ("1.5k") no meio de uma tela em pt-BR.
 */
function axisMoney(v: number) {
  const abs = Math.abs(v);
  const text = abs >= 1000
    ? `${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
    : abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return v < 0 ? `−${text}` : text;
}

/**
 * Cores do gráfico em hex literal, de propósito: o recharts escreve `stroke` e
 * `stop-color` como ATRIBUTO SVG, e atributo não resolve `var(--…)`. Espelham
 * --nc-accent / --nc-profit / --nc-crit em src/index.css — mudou lá, mude aqui.
 */
const CHART_REVENUE = "#85B7EB";
const CHART_PROFIT = "#A3D977";
const CHART_LOSS = "#F09595";
const CHART_GRID = "#3f424d";
const CHART_AXIS = "#75798c";

const GERAL = "geral";
/** Quantos pedidos cabem na tabela de reposição. */
const MAX_RESTOCK_ROWS = 6;
/** Modelos nomeados na barra empilhada; o resto vira "Outros". */
const TOP_MODELS = 5;
/** Quantos vendedores a lista do bloco mostra; o resto vira uma linha de rodapé. */
const MAX_SELLER_ROWS = 6;

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
    opts.push({ value: GERAL, label: "Geral (todo o período)", short: "Geral" });
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
   * O mês que o "Geral" devolve. O período mora no endereço, e ao ir para
   * Geral o mês sai dele; sem isto, voltar do Geral caía sempre no mês
   * corrente, e quem estava em junho perdia o lugar.
   */
  const [lastMonth, setLastMonth] = useState(filter === GERAL ? currentMonth : filter);
  useEffect(() => {
    if (filter !== GERAL) setLastMonth(filter);
  }, [filter]);

  /**
   * As setas ‹ › andam por TODOS os meses com lançamento, e são o único
   * seletor de mês. Havia também uma fileira de chips com os três meses mais
   * recentes: duas ferramentas para a mesma escolha, nove controles numa faixa
   * que quebrava linha no celular, e os chips só poupavam um toque para pular
   * dois meses. A lista vem do mais novo para o mais antigo, então "anterior" é
   * o índice seguinte. Em "Geral" as duas ficam desligadas (e montadas, para a
   * linha não mudar de largura).
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
     * MESMA conta da Distribuição e do relatório: recebido − CPV − despesas
     * (sem perdas nem vendedores; a comissão sai na Distribuição). O CPV usa
     * o custo congelado de cada venda (`saleUnitCost`).
     *
     * Ticket médio = FATURAMENTO ÷ contagem de vendas, a conta da tela de
     * Vendas (`totals.ticket`); era recebido ÷ vendas, que caía justamente no
     * mês que vendeu bem e recebeu devagar.
     */
    return (filterFn: (dateISO: string) => boolean) => {
      const result = computePeriodResult({
        sales: store.sales,
        expenses: store.expenses,
        costOf: store.saleUnitCost,
        inPeriod: filterFn,
      });
      // Reposição de estoque (investimento — exibido separadamente, NÃO reduz lucro)
      const restock = store.stockEntries.filter(e => filterFn(e.date)).reduce((sum, e) => sum + e.totalCost, 0);
      return { ...result, restock };
    };
  }, [store.sales, store.expenses, store.stockEntries, store.saleUnitCost]);

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
    // "Pedido", no app, é o pedido que chega da loja; o que se faz ao
    // fornecedor é COMPRA ("Nova compra", "Montar compra"). O rodapé dizia
    // "pedidos menores" e "já pedidos", e o sujeito (modelo) ficava implícito.
    const parts: string[] = [];
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    const hidden = restock.urgent.length - restockRows.length;
    if (hidden > 0) parts.push(`+${hidden} ${plural(hidden, "modelo", "modelos")} com menos a repor`);
    if (restock.orderedCount > 0) {
      parts.push(
        `${restock.orderedCount} ${plural(restock.orderedCount, "modelo já comprado", "modelos já comprados")}, ${restock.orderedUnits} un. a caminho`,
      );
    }
    if (restock.staleCount > 0) {
      parts.push(
        `${restock.staleCount} ${plural(restock.staleCount, "modelo parado", "modelos parados")} há mais de ${STALE_DAYS} dias (${formatCurrencyShort(restock.staleValue)} a custo)`,
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
        // A base da margem: o lucro é do recebido (`computePeriodResult`).
        recebido: r.received,
        // O GRÁFICO desenha o lucro BRUTO (recebido − CPV), decisão do dono;
        // o líquido segue aqui para a aba "Evolução 6 meses" do Excel.
        lucroBruto: r.grossProfit,
        margemBruta: r.grossMargin,
        lucro: r.netProfit,
        margem: r.netMargin,
        // O gráfico não desenha as de baixo; o relatório imprime. Ficam aqui
        // porque é a MESMA passada pelos mesmos meses — recalcular por fora é
        // como as duas leituras do mínimo já divergiram uma vez.
        cogs: r.cogs,
        despesas: r.expenses,
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
        lucroCheio: solid ? m.lucroBruto : null,
        receitaParcial: dashed ? m.receita : null,
        lucroParcial: dashed ? m.lucroBruto : null,
      };
    });
  }, [monthlyData]);
  const partialMonth = monthlyData.find(m => m.partial);

  /**
   * Margem dos seis meses do gráfico = lucro BRUTO somado ÷ RECEBIDO somado,
   * a mesma conta da margem de cada mês no tooltip. Era a média
   * simples das margens de cada mês: um mês fraco, de R$ 300 e margem −80%,
   * pesava tanto quanto um de R$ 30 mil.
   */
  const sixMonthMargin = useMemo(() => {
    const received = monthlyData.reduce((s, m) => s + m.recebido, 0);
    const profit = monthlyData.reduce((s, m) => s + m.lucroBruto, 0);
    return received > 0 ? (profit / received) * 100 : 0;
  }, [monthlyData]);

  /**
   * O mês escolhido marcado no gráfico, quando ele está entre os seis. O
   * gráfico não segue o período, e sem a marca quem abre junho não sabe onde
   * junho está na curva. O mês em curso não ganha marca: ele já é o trecho
   * tracejado no fim.
   */
  const chartMark = useMemo(() => {
    // Casa por ano-mês, os mesmos seis meses do `monthlyData`: a sigla sozinha
    // ("jun") casaria junho do ano passado com o deste ano.
    for (let i = 1; i <= 5; i++) {
      const date = subMonths(new Date(), i);
      if (format(date, "yyyy-MM") === filter) return format(date, "MMM", { locale: ptBR });
    }
    return undefined;
  }, [filter]);

  const filterLabel = monthOptions.find(o => o.value === filter)?.label ?? "";
  const exportScope = isGeral ? "todo o período" : filterLabel;
  /** O recorte no selo dos blocos que seguem o período: "setembro", "todo o período". */
  const periodTag = isGeral
    ? "todo o período"
    : format(period.start, filter.slice(0, 4) === currentMonth.slice(0, 4) ? "MMMM" : "MMMM/yy", { locale: ptBR });

  /**
   * O mês entre as setas: a sigla, e o ano só quando não é o corrente
   * ("Set/25"). O nome inteiro já está no sobretítulo, logo à esquerda.
   */
  const lastMonthOption = monthOptions.find(o => o.value === lastMonth);
  const lastMonthLabel = lastMonthOption?.label ?? "";
  const lastMonthShort = lastMonthOption
    ? lastMonth.slice(0, 4) === currentMonth.slice(0, 4)
      ? lastMonthOption.short
      : `${lastMonthOption.short}/${lastMonth.slice(2, 4)}`
    : "";

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
   * As seis mais recentes pela DATA DA VENDA. `store.sales` vem na ordem de
   * lançamento (created_at), e uma venda lançada hoje com data de dia 3
   * aparecia no topo, como se fosse a última. O `reverse` antes do `sort`
   * (estável) deixa o lançamento mais novo na frente entre as do mesmo dia.
   */
  const latestSales = useMemo(
    () => [...recentSales].reverse().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6),
    [recentSales],
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
        periodLabel: isGeral ? "Geral (todo o período)" : filterLabel,
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
      toast.success(`Relatório baixado (${sheets.length} abas)`);
    } catch (err) {
      console.error(err);
      // Quase sempre é a leitura do razão que falhou (rede): dizer o que fazer.
      toast.error("Erro ao gerar o relatório. Tente de novo.");
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
      {/* Sem o selo "N de M modelos": o N é o do botão "Montar compra" no
          rodapé, e o "de M" (todos os modelos cadastrados) não decide nada. */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <Package size={16} style={{ color: "var(--nc-accent)" }} />
        <h2 className="text-[15px]">Repor agora</h2>
        <ScopeTag>hoje</ScopeTag>
      </div>

      <div className="px-4 pb-3.5">
        {restockRows.length === 0 ? (
          // O vazio diz POR QUE está vazio. "Nada abaixo do mínimo" era dito
          // também quando havia modelo abaixo dele já comprado, e quando
          // nenhum modelo tinha mínimo — modelo sem mínimo não entra nesta
          // conta, e sem dizer isso o card vazio parecia estoque em ordem.
          <p className="py-6 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
            {modelStats.length === 0
              ? "Nenhum modelo cadastrado ainda."
              : restock.orderedCount > 0
                ? "O que está abaixo do mínimo já foi pedido."
                : modelStats.some(m => m.minUnits > 0)
                  ? "Todos os modelos estão no mínimo ou acima."
                  : "Nenhum modelo tem estoque mínimo. Defina em Produtos."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* O card responde UMA pergunta — quanto pedir hoje — e tudo nele
                é de HOJE: o estoque contra o mínimo, e o que pedir. A coluna
                "Vendeu" saiu: era do MÊS ESCOLHIDO, e punha na mesma linha o
                estoque de hoje ao lado das vendas de junho, dois recortes que
                a linha não dizia. "Dura tantos dias", "Vende/dia" e "Margem"
                já tinham saído por serem a leitura da conta antiga, que
                projetava giro. O que está a caminho aparece embaixo do
                "Pedir", porque é o que explica um pedido menor que a falta.
                O `whitespace-nowrap` das colunas de número segura cada linha
                numa altura só em 390px. */}
            <table className="w-full min-w-0 text-[13px]">
              <thead>
                <tr style={{ color: "var(--nc-text-3)" }}>
                  <th scope="col" className="px-2 py-1.5 text-left font-normal">Modelo</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-normal">Estoque / mín.</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-normal">Pedir</th>
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
          {/* Sem pedido, a linha de cima não é desenhada: o vazio da tabela já
              diz o porquê, e repetir aqui dava duas frases para o mesmo fato. */}
          <div className="flex min-w-0 flex-col gap-1">
            {restock.horizonUnits > 0 && (
              <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
                <strong className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>
                  {restock.horizonUnits} un.
                </strong>{" "}
                para voltar ao mínimo ·{" "}
                <strong className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>
                  {formatCurrencyShort(restock.horizonCost)}
                </strong>{" "}
                a custo
              </span>
            )}
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
        {/* O gráfico é sempre os últimos seis meses, com qualquer período
            escolhido: o selo diz isso no mesmo lugar em que os outros blocos
            dizem o deles. */}
        <div className="flex items-center gap-2">
          <h2 className="text-[15px]">Desempenho financeiro</h2>
          <ScopeTag>últimos 6 meses</ScopeTag>
        </div>
        <div className="flex flex-wrap items-center gap-3.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ background: "var(--nc-accent)" }} /> Receita
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ background: "var(--nc-profit)" }} /> Lucro bruto
          </span>
          {/* O tracejado explicado na legenda, e não só no tooltip: quem não
              passa o mouse no último ponto também precisa saber que ele é
              parcial. */}
          {partialMonth && (
            <span className="flex items-center gap-1.5">
              <span className="w-3.5 border-t border-dashed" style={{ borderColor: "var(--nc-text-2)" }} />
              {partialMonth.month.replace(/^./, c => c.toUpperCase())} até o dia {new Date().getDate()}
            </span>
          )}
          <span className="pl-3" style={{ borderLeft: "1px solid var(--nc-divider)" }}>
            Margem bruta em 6 meses{" "}
            <strong className="nc-num font-semibold" style={{ color: "var(--nc-text)" }}>
              {formatPct(sixMonthMargin)}
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
              tickFormatter={axisMoney}
            />
            {chartMark && (
              <ReferenceLine
                x={chartMark}
                stroke={CHART_AXIS}
                strokeOpacity={0.7}
                label={{ value: "período", position: "insideTopRight", fill: CHART_AXIS, fontSize: 10 }}
              />
            )}
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
                      {/* O recebido não tem curva, mas é a base do lucro e da
                          margem logo abaixo: sem ele aqui, a margem não se
                          confere contra nenhum número do tooltip. */}
                      <p className="flex items-center justify-between gap-4">
                        <span style={{ color: "var(--nc-text-2)" }}>Recebido</span>
                        <span className="nc-num font-semibold" style={{ color: "var(--nc-ok)" }}>{formatCurrency(d.recebido)}</span>
                      </p>
                      {/* Recebido − CPV = lucro bruto, na ordem da conta: a
                          curva verde se confere linha a linha aqui. */}
                      <p className="flex items-center justify-between gap-4">
                        <span style={{ color: "var(--nc-text-2)" }}>− CPV</span>
                        <span className="nc-num font-semibold">{formatCurrency(d.cogs)}</span>
                      </p>
                      <p className="flex items-center justify-between gap-4">
                        <span style={{ color: "var(--nc-text-2)" }}>Lucro bruto</span>
                        <span className="nc-num font-semibold" style={{ color: d.lucroBruto >= 0 ? CHART_PROFIT : CHART_LOSS }}>
                          {formatCurrency(d.lucroBruto)}
                        </span>
                      </p>
                      <p className="nc-rule-top mt-1 flex items-center justify-between gap-4 pt-1">
                        <span style={{ color: "var(--nc-text-2)" }}>Margem bruta</span>
                        <span className="nc-num font-semibold">{formatPct(d.margemBruta)}</span>
                      </p>
                    </div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="receitaCheia" stroke={CHART_REVENUE} strokeWidth={2} fill="url(#gradReceita)" name="Receita" />
            <Area type="monotone" dataKey="lucroCheio" stroke={CHART_PROFIT} strokeWidth={2} fill="url(#gradLucro)" name="Lucro bruto" />
            {/* O trecho do mês em curso: mesma cor, traço interrompido e
                preenchimento pela metade. */}
            <Area type="monotone" dataKey="receitaParcial" stroke={CHART_REVENUE} strokeWidth={2} strokeDasharray="4 4" fill="url(#gradReceita)" fillOpacity={0.5} name="Receita (parcial)" />
            <Area type="monotone" dataKey="lucroParcial" stroke={CHART_PROFIT} strokeWidth={2} strokeDasharray="4 4" fill="url(#gradLucro)" fillOpacity={0.5} name="Lucro bruto (parcial)" />
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
        {/* Sem total no cabeçalho: ele repetia a Receita, mas sem os modelos
            arquivados, e dois números quase iguais que não batem fazem duvidar
            dos dois. */}
        <div className={cn("flex items-center gap-2 pb-3", pad, frame === "card" && "pt-3.5")}>
          <h2 className="text-[15px]">Modelos mais vendidos</h2>
          <ScopeTag>{periodTag}</ScopeTag>
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
              // Na mesma forma das linhas de cima ("R$ · %"). Dizia "do
              // período", mas a fatia é do total dos modelos listados, que
              // deixa os arquivados de fora — não da receita do período.
              <p className={cn("nc-num py-2.5 text-[11px]", pad)} style={{ color: "var(--nc-text-3)" }}>
                + {topModels.restCount} {topModels.restCount === 1 ? "outro modelo" : "outros modelos"}:{" "}
                {formatCurrencyShort(topModels.restRevenue)} · {formatPct(topModels.restPct, 0)}
              </p>
            )}
          </>
        )}
      </section>
    );
  };

  const revenueDelta = delta(periodStats.revenue, prevStats?.stats.revenue);

  const profitDelta = delta(periodStats.netProfit, prevStats?.stats.netProfit);
  const criticalCount = restock.urgent.filter(m => urgencyOf(m.stock, m.minUnits) === "critical").length;

  /**
   * O veredito: a faixa que responde "como foi o mês e o que fazer agora",
   * no topo da coluna em todos os tamanhos.
   *
   * Antes o maior número da tela era a RECEITA (30px, no trilho), e o lucro
   * líquido — o que o fechamento procura — saía em 20px no pé do trilho; no
   * celular o dinheiro do mês só aparecia depois de ~1.200px de rolagem. Aqui
   * o lucro é o herói, a receita (com recebido e a receber) é o segundo
   * número, e os dois acertos de HOJE que pedem ação — vendedores e reposição
   * — ficam ao lado, cada metade com o seu recorte escrito no alto.
   *
   * Absorveu o antigo bloco "Receita": mesmo número, mesmos links, mesma
   * barra. O detalhe continua nos blocos de baixo (Resultado, Vendedores,
   * Repor agora).
   *
   * Os números entram sem contar desde zero (sem `animateOnMount`): quem abre
   * a tela veio ler o valor, e 0,7 s mostrando um número errado atrapalha.
   * Mudança de período continua animando.
   */
  const verdictWidget = (
    <section aria-label="Resumo" className="nc-card grid grid-cols-1 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
        <ScopeTag>{periodTag}</ScopeTag>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Lucro líquido</span>
            {/* --nc-profit, a cor da série de lucro no gráfico; prejuízo em --nc-crit. */}
            <span style={{ color: netPositive ? "var(--nc-profit)" : "var(--nc-crit)" }}>
              <AnimatedNumber
                value={periodStats.netProfit}
                format={formatCurrencyShort}
                duration={0.5}
                className="nc-num text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[46px]"
              />
            </span>
            {/* A base da comparação ESCRITA, não num `title`: "+12%" sem dizer
                contra o quê é número que não se explica. */}
            <span className="nc-num text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
              margem {formatPct(periodStats.netMargin)} do recebido
              {profitDelta && <> · <Delta delta={profitDelta} /> vs {profitDelta.label}</>}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {/* O rótulo e o número abrem as vendas do período: em Vendas o
                trilho mostra a MESMA receita e o mesmo par recebido/a receber.
                Sem `aria-label`: ele trocava o nome do link e o leitor de tela
                ouvia "Ver as vendas do período", nunca o valor. */}
            <Link to={buildSalesLink(salesPeriod)} className="nc-drill block">
              <span className="inline-flex items-center gap-0.5 text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
                Receita <ChevronRight size={12} className="nc-drill-cue" />
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <AnimatedNumber
                  value={periodStats.revenue}
                  format={formatCurrencyShort}
                  duration={0.5}
                  className="nc-num text-[26px] font-semibold tracking-[-0.02em]"
                />
                {revenueDelta && (
                  <span className="nc-num text-[12px]" style={{ color: "var(--nc-text-3)" }}>
                    <Delta delta={revenueDelta} /> vs {revenueDelta.label}
                  </span>
                )}
              </span>
            </Link>
        {/* Divisão REAL do total: cada real vendido está de um lado ou do
            outro. O recebido é --nc-ok e NÃO --nc-accent — o verde é dinheiro
            que já está na mão, e o accent é o dinheiro todo (a receita logo
            acima). Com o accent aqui, a metade recebida tinha a mesma cor do
            total que ela divide, e o par com o --nc-alert só se lia depois de
            ler os dois números. É a mesma barra de Vendas e do Financeiro, que
            já usavam o verde: este era o único lugar fora do vocabulário. */}
        {/* Sem receita não há o que dividir: os dois `flex` mínimos davam
            metade verde e metade âmbar num mês sem venda. Aí fica só o trilho. */}
        {periodStats.revenue > 0 ? (
          <div className="mt-2 flex h-[5px] gap-0.5">
            <div style={{ flex: Math.max(periodStats.received, 0.001), background: "var(--nc-ok)", borderRadius: 2 }} />
            <div style={{ flex: Math.max(periodStats.receivable, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
          </div>
        ) : (
          <div className="mt-2 h-[5px]" style={{ background: "var(--nc-track)", borderRadius: 2 }} />
        )}
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
      </div>

      {/* HOJE: os dois acertos que pedem ação, com o recorte escrito no alto
          — eles não mudam com o mês escolhido. */}
      <div
        className="flex min-w-0 flex-col gap-3 border-t p-4 md:p-5 lg:border-l lg:border-t-0"
        style={{ borderColor: "var(--nc-divider)" }}
      >
        <ScopeTag>hoje</ScopeTag>
        <div className="grid grid-cols-2 gap-4">
          <Link to="/commissions" className="nc-drill flex min-w-0 flex-col gap-1">
            <span className="inline-flex items-center gap-0.5 text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
              Vendedores <ChevronRight size={12} className="nc-drill-cue" />
            </span>
            <span className="nc-num text-[20px] font-semibold">{formatCurrencyShort(sellerBalances.payable)}</span>
            <span className="text-[12px]" style={{ color: "var(--nc-text-3)" }}>a pagar</span>
            {sellerBalances.owed > 0.01 && (
              <span className="nc-num text-[12px]" style={{ color: "var(--nc-alert)" }}>
                devem {formatCurrencyShort(sellerBalances.owed)}
              </span>
            )}
          </Link>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Repor</span>
            {restock.urgent.length > 0 ? (
              <>
                <span className="nc-num text-[20px] font-semibold">
                  {restock.urgent.length} modelo{restock.urgent.length === 1 ? "" : "s"}
                </span>
                <span className="nc-num text-[12px]" style={{ color: "var(--nc-text-3)" }}>
                  {restock.horizonUnits} un. · {formatCurrencyShort(restock.horizonCost)} a custo
                </span>
                {criticalCount > 0 && (
                  <span className="text-[12px]" style={{ color: "var(--nc-crit)" }}>
                    {criticalCount} crítico{criticalCount === 1 ? "" : "s"}
                  </span>
                )}
              </>
            ) : (
              // Mesma leitura do vazio do Repor agora: "nada abaixo do mínimo"
              // era dito também quando havia modelo abaixo dele já comprado.
              <>
                <span className="text-[20px] font-semibold">Nada a pedir</span>
                <span className="text-[12px]" style={{ color: "var(--nc-text-3)" }}>
                  {restock.orderedCount > 0
                    ? `${restock.orderedCount} já comprado${restock.orderedCount === 1 ? "" : "s"}, a caminho`
                    : "tudo no mínimo ou acima"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const resultWidget = (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(EYEBROW, "font-normal font-normal")} style={{ color: "var(--nc-text-3)" }}>Resultado</h2>
        <ScopeTag>{periodTag}</ScopeTag>
      </div>
      {/* A conta começa no RECEBIDO: o lucro é do que já entrou
          (`computePeriodResult`). A receita cheia mora no Resumo; abrir aqui
          com ela faria "receita − CPV" não fechar com o lucro bruto. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Recebido</span>
        <span className="nc-num text-sm">{formatCurrencyShort(periodStats.received)}</span>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− CPV</span>
          <span className="nc-num text-sm">{formatCurrencyShort(periodStats.cogs)}</span>
        </div>
        <span className="block text-[11px]" style={{ color: "var(--nc-text-3)" }}>
          custo da parte paga das vendas
        </span>
      </div>
      {/* Subtotal da conta: recebido − CPV. Era um bloco à parte, com ícone,
          para um número que se lê aqui, no meio da mesma subtração, e cuja
          margem já estava no rodapé deste bloco. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px]">
          Lucro bruto{" "}
          <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
            {formatPct(periodStats.grossMargin)}
          </span>
        </span>
        <span className="nc-num text-sm">{formatCurrencyShort(periodStats.grossProfit)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>− Despesas</span>
        <span className="nc-num text-sm">
          {formatCurrencyShort(periodStats.expenses)}{" "}
          <Delta delta={delta(periodStats.expenses, prevStats?.stats.expenses)} invert />
        </span>
      </div>
      {/* Sem "− Perdas" e sem "− Vendedores": o lucro não desconta nenhum dos
          dois (decisão do dono; a comissão sai na Distribuição, pela apurada
          do período). Linha subtraída aqui que não sai do lucro faria a conta
          não fechar. */}
      <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
        <span className="text-[12.5px]">Lucro líquido</span>
        {/* Lucro em --nc-profit, a cor de lucro da tela (a série de lucro
            bruto do gráfico usa a mesma). Estava em --nc-accent, que é a cor da
            RECEITA (a série de cima no gráfico, a barra do recebido): as duas
            pontas da conta saíam iguais justamente onde a tela existe para
            separá-las. Prejuízo continua em --nc-crit, que é o mesmo #F09595
            do CHART_LOSS. */}
        <span style={{ color: netPositive ? "var(--nc-profit)" : "var(--nc-crit)" }}>
          <AnimatedNumber
            value={periodStats.netProfit}
            format={formatCurrencyShort}
            duration={0.5}
            className="nc-num text-xl font-semibold"
          />
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px] nc-num" style={{ color: "var(--nc-text-3)" }}>
        <span>margem líquida do recebido</span>
        <span>{formatPct(periodStats.netMargin)}</span>
      </div>
    </div>
  );

  /**
   * Dois recortes lado a lado — o ticket segue o período, o estoque é de
   * HOJE —, então cada metade leva o seu selo em vez de um título comum.
   */
  const indicatorsWidget = (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col items-start gap-1">
        <ScopeTag>{periodTag}</ScopeTag>
        <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Ticket médio</span>
        <div className="nc-num text-base font-semibold">
          {formatCurrency(periodStats.ticket)}{" "}
          <Delta delta={delta(periodStats.ticket, prevStats?.stats.ticket)} />
        </div>
      </div>
      <div className="flex flex-col items-start gap-1">
        <ScopeTag>hoje</ScopeTag>
        <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Estoque a custo</span>
        <div className="nc-num text-base font-semibold">{formatCurrencyShort(inventoryAtCost)}</div>
        <span className="text-[11px] nc-num" style={{ color: "var(--nc-text-3)" }}>{totalStock} un.</span>
      </div>
    </div>
  );

  const recentSalesWidget = (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className={cn(EYEBROW, "font-normal font-normal")} style={{ color: "var(--nc-text-3)" }}>
          Últimas vendas
        </h2>
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
          {latestSales.map(s => {
            const product = productMap.get(s.productId);
            const productLabel = product ? `${product.flavor} · ${product.model}` : store.getProductName(s.productId);
            return (
              <motion.div key={s.id} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="nc-num flex-none text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  {formatDateBR(s.date).slice(0, 5)}
                </span>
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
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <h2 className={cn(EYEBROW, "font-normal font-normal")} style={{ color: "var(--nc-text-3)" }}>Vendedores</h2>
            <ScopeTag>hoje</ScopeTag>
          </span>
          <Link
            to="/commissions"
            className="nc-drill inline-flex items-center gap-0.5 text-[11px]"
            style={{ color: "var(--nc-text-3)" }}
          >
            Distribuição <ChevronRight size={12} className="nc-drill-cue" />
          </Link>
        </div>
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
  const inCard = (body: ReactNode) => <section className="nc-card flex flex-col gap-3 p-4">{body}</section>;

  const renderWidget = (id: WidgetId, frame: Frame, grow = false): ReactNode => {
    switch (id) {
      case "verdict": return verdictWidget;
      case "restock": return restockWidget;
      case "performance": return performanceWidget(frame, grow);
      case "topModels": return topModelsWidget(frame);
      default: {
        const body = {
          result: resultWidget,
          indicators: indicatorsWidget,
          recentSales: recentSalesWidget,
          sellers: sellersWidget,
        }[id];
        return frame === "card" ? inCard(body) : body;
      }
    }
  };

  const shown = visibleWidgets(layout);
  const isCards = layout.mode === "cards";
  // Trilho vazio não é desenhado: a coluna ocupa a largura inteira em vez de
  // deixar uma faixa escura sem nada dentro.
  const hasRail = !isCards && shown.rail.length > 0;

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

          {/* `flex-wrap` por garantia no telefone estreito. O exportar é
              `.nc-btn` (e não um <button> cru) para ganhar os 44px do
              `pointer: coarse`, com o mesmo fantasma de ícone da sidebar. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PeriodPicker
              label={lastMonthShort}
              title={lastMonthLabel}
              isGeral={isGeral}
              older={monthSteps.older}
              newer={monthSteps.newer}
              onPick={setFilter}
              onMonth={() => setFilter(lastMonth)}
              onGeral={() => setFilter(GERAL)}
            />
            <DashboardCustomizeSheet layout={layout} onChange={updateLayout} onReset={resetLayout} />
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              // O relatório segue o período da tela, e o ícone sozinho não diz
              // isso: o nome do botão leva o recorte que vai para o arquivo.
              title={exporting ? "Gerando o relatório…" : `Baixar o relatório de ${exportScope} em Excel`}
              aria-label={exporting ? "Gerando o relatório" : `Baixar o relatório de ${exportScope} em Excel`}
              aria-busy={exporting}
              className="nc-btn nc-btn--ghost nc-btn--icon"
            >
              {/* O relatório leva alguns segundos em máquina lenta; desligado e
                  com o mesmo ícone, o botão parecia não ter ouvido o clique. */}
              {exporting
                ? <Loader2 size={15} className="motion-safe:animate-spin" />
                : <Download size={15} />}
            </button>
          </div>
        </header>

        {shown.all.length === 0 ? (
          // A saída mais curta fica aqui mesmo. Antes o texto mandava procurar
          // "o botão de personalizar", que é só um ícone — agora o ícone
          // aparece na frase, para ser reconhecido lá em cima.
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[13px]" style={{ color: "var(--nc-text-2)" }}>Todos os blocos estão escondidos.</p>
            <NcButton size="md" onClick={resetLayout}>Restaurar padrão</NcButton>
            <p className="text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
              Ou escolha quais mostrar em{" "}
              <span role="img" aria-label="Personalizar">
                <SlidersHorizontal size={12} aria-hidden className="inline align-[-1px]" />
              </span>, no alto.
            </p>
          </div>
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
          shown.main.map(w => (
            <div key={w.id} className={cn("min-w-0", w.id === "performance" && "flex flex-col xl:flex-1")}>
              {renderWidget(w.id, "card", true)}
            </div>
          ))
        )}
      </div>

      {/* ---------------- Trilho da direita ----------------
          Abaixo do xl ele cai para o fim da página. Receita e Resultado
          subiam para o topo nesse tamanho, para o dinheiro do mês não ficar
          ~1.200px abaixo; quem responde isso agora é a faixa do veredito, no
          topo em todos os tamanhos, e o trilho é só o detalhe. */}
      {hasRail && (
        <aside aria-label="Detalhes" className={RAIL} style={{ background: "var(--nc-rail)" }}>
          {shown.rail.map((w, i) => (
            <Fragment key={w.id}>
              {i > 0 && <Rule />}
              {renderWidget(w.id, "rail")}
            </Fragment>
          ))}
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

type MonthStep = { value: string; label: string } | undefined;

/**
 * O seletor de período: ‹ mês › e "Geral", na mesma cápsula e com o mesmo
 * realce deslizante do `SegmentedChips` — o realce cobre o trio do mês quando
 * se olha um mês e passa para o "Geral" quando não.
 *
 * No Geral as setas desligam e a sigla continua mostrando o último mês visto:
 * tocar nela volta para ele.
 */
function PeriodPicker({
  label,
  title,
  isGeral,
  older,
  newer,
  onPick,
  onMonth,
  onGeral,
}: {
  label: string;
  title: string;
  isGeral: boolean;
  older: MonthStep;
  newer: MonthStep;
  onPick: (value: string) => void;
  onMonth: () => void;
  onGeral: () => void;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();
  const highlight = (
    <motion.span
      layoutId={reduce ? undefined : pillId}
      className="absolute inset-0 rounded-md"
      style={{
        boxShadow: "inset 0 0 0 1px var(--nc-accent)",
        background: "color-mix(in srgb, var(--nc-accent) 10%, transparent)",
      }}
      transition={transitionBase}
    />
  );
  const tone = (active: boolean) => ({ color: active ? "var(--nc-accent)" : "var(--nc-text-2)" });
  const arrow = "nc-chip relative z-10 inline-flex min-w-9 items-center justify-center rounded-md py-1.5 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div role="group" aria-label="Período" className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--nc-track)" }}>
      <div className="relative flex items-center">
        {!isGeral && highlight}
        <button
          type="button"
          onClick={() => older && onPick(older.value)}
          disabled={!older}
          title={older ? `Abrir ${older.label} (←)` : "Não há mês anterior com lançamento"}
          aria-label="Mês anterior"
          aria-keyshortcuts="ArrowLeft"
          className={arrow}
          style={tone(!isGeral)}
        >
          <ChevronLeft size={15} />
        </button>
        {/* Largura mínima para "Set/25" e "Set" ocuparem o mesmo lugar: a seta
            da direita não anda quando a sigla ganha o ano. */}
        <button
          type="button"
          onClick={onMonth}
          aria-pressed={!isGeral}
          aria-label={title}
          title={isGeral ? `Voltar para ${title}` : title}
          className="nc-chip nc-num relative z-10 inline-flex min-w-[3.25rem] items-center justify-center py-1.5 text-xs transition-colors duration-200"
          style={tone(!isGeral)}
        >
          {label}
        </button>
        <button
          type="button"
          onClick={() => newer && onPick(newer.value)}
          disabled={!newer}
          title={newer ? `Abrir ${newer.label} (→)` : "Este é o mês mais recente"}
          aria-label="Mês seguinte"
          aria-keyshortcuts="ArrowRight"
          className={arrow}
          style={tone(!isGeral)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <button
        type="button"
        onClick={onGeral}
        aria-pressed={isGeral}
        title="Todo o período"
        className="nc-chip relative inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs transition-colors duration-200"
        style={tone(isGeral)}
      >
        {isGeral && highlight}
        <span className="relative z-10">Geral</span>
      </button>
    </div>
  );
}

type DeltaValue = { pct: number; label: string } | undefined;

/**
 * Variação vs. o mês anterior. `invert` = subir é ruim (despesas).
 *
 * O sinal e a cor saem do número JÁ ARREDONDADO, o que se lê. Com o valor cru,
 * −0,3% virava "−0%" e ganhava cor de bom ou de ruim, uma mudança que não
 * aparece no próprio número. Zero fica neutro e sem sinal.
 */
function Delta({ delta, invert }: { delta: DeltaValue; invert?: boolean }) {
  if (!delta || !isFinite(delta.pct)) return null;
  const pct = Math.round(delta.pct);
  const good = invert ? pct < 0 : pct > 0;
  const color = pct === 0 ? "var(--nc-text-3)" : good ? "var(--nc-accent)" : "var(--nc-alert)";
  return (
    <span className="nc-num text-[11px] font-normal" style={{ color }} title={`vs ${delta.label}`}>
      {pct > 0 ? "+" : pct < 0 ? "−" : ""}
      {Math.abs(pct)}%
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
          {/* Crítico é bolinha CHEIA, abaixo do mínimo é ANEL: a forma separa
              os dois sem depender da cor. O texto oculto é o que o leitor de
              tela ouve no lugar dela. */}
          <span
            aria-hidden
            className="h-2 w-2 flex-none rounded-full"
            style={urgency === "critical" ? { background: dot } : { boxShadow: `inset 0 0 0 1.5px ${dot}` }}
          />
          <span className="sr-only">{urgency === "critical" ? "Crítico:" : "Abaixo do mínimo:"}</span>
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
      {/* Quanto pedir, já descontado o que está a caminho — e o abatimento
          aparece embaixo, senão o número menor não teria explicação. É a
          resposta do card, então pesa mais que a régua ao lado. */}
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <span className="nc-num font-semibold">{model.restockUnits} un.</span>
        {model.incoming > 0 && (
          <span className="block text-[11px] nc-num" style={{ color: "var(--nc-text-3)" }}>
            {model.incoming} a caminho
          </span>
        )}
      </td>
    </tr>
  );
}
