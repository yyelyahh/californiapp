/**
 * O relatório em Excel do Dashboard.
 *
 * Aqui mora a MONTAGEM das abas — só dados, nenhuma dependência de `xlsx`. O
 * Dashboard carrega a biblioteca sob demanda e transforma cada `ReportSheet`
 * numa planilha; esta parte se testa sem montar tela e sem empacotar 400KB de
 * biblioteca no bundle do teste.
 *
 * Duas regras carregam o desenho:
 *
 * 1. NENHUMA CONTA NOVA. Todo número daqui é o mesmo que alguma tela já mostra,
 *    e vem da mesma função: `computeSellerBalance` para a comissão,
 *    `computeModelStats`/`summarizeRestock` para a reposição, os seletores do
 *    razão (`getCash` e companhia) para a posição. Relatório que recalcula à mão
 *    é relatório que um dia discorda da tela, e quem lê não tem como saber qual
 *    dos dois está certo.
 *
 * 2. CADA ABA É UMA TABELA LIMPA: uma linha de cabeçalho e o resto são dados.
 *    Sem título nem frase de contexto no topo, porque isso empurra as colunas
 *    para baixo e quebra filtro, ordenação e tabela dinâmica — as três coisas
 *    que alguém faz com um Excel. O que a aba cobre (e se ela segue o período
 *    escolhido) é dito no ÍNDICE, que é a primeira aba.
 *
 * O que NÃO segue o período está marcado como "Posição" no índice: estoque,
 * sócios, empréstimos e investidores são fotografia de hoje. Somá-los com o
 * recorte do mês seria responder outra pergunta.
 */
import type {
  CommissionPayment, Dividend, Expense, Investor, Loan, LoanPayment,
  Partner, PartnerContribution, Product, ProductAssignment, ProLaborePayment,
  PurchaseOrder, Sale, Seller, SellerDebtPayment, SellerManualDebt,
  StockEntry, StockLoss, StockTransfer, FinancialEvent, FinancialEventKind,
} from "@/types";
import type { ModelStat } from "@/lib/restock";
import { urgencyOf } from "@/lib/restock";
import { computeSellerBalance, isCommissionSeller, PROJECT_START } from "@/lib/commissions";
import { compareCatalog } from "@/lib/catalog-order";
import { computePeriodResult } from "@/lib/period-result";
import { modelArchiveKey } from "@/lib/archived-models";

export type Cell = string | number | null;

/** Onde a aba busca seus números — é o que o índice imprime na coluna "Recorte". */
export type Scope =
  /** Só o que caiu no período escolhido no Dashboard. */
  | "periodo"
  /** Fotografia de hoje: não muda com o período. */
  | "posicao"
  /** Janela própria, dita na descrição (evolução de 6 meses, por exemplo). */
  | "proprio";

export interface ReportSheet {
  /** Nome da aba. Até 31 caracteres e sem `: \ / ? * [ ]` — limite do Excel. */
  name: string;
  /** Uma frase no índice dizendo o que está aqui dentro. */
  about: string;
  scope: Scope;
  /** Primeira linha é o cabeçalho; o resto são dados. */
  rows: Cell[][];
  /** Largura de cada coluna, em caracteres. */
  widths: number[];
  /**
   * Liga o filtro do Excel na linha de cabeçalho — as setinhas que ordenam e
   * filtram. Desligado no Resumo e no Índice, que não são tabela de dados.
   *
   * Congelar o cabeçalho seria melhor ainda, mas o `xlsx` desta versão lê
   * `freezepanes` e não ESCREVE: a propriedade existiria no objeto e sumiria
   * no arquivo, que é pior do que não ter.
   */
  autofilter?: boolean;
}

/** Um mês da evolução — vem pronto do Dashboard, que é quem desenha o gráfico. */
export interface MonthlyRow {
  monthLong: string;
  receita: number;
  cogs: number;
  despesas: number;
  perdas: number;
  /** Comissão paga + consumo a custo − dívida devolvida (ver period-result). */
  vendedores: number;
  lucro: number;
  margem: number;
  vendas: number;
  unidades: number;
}

/** A posição do razão, lida pelos seletores do StoreContext. */
export interface LedgerPosition {
  cash: number;
  inventory: number;
  receivables: number;
  partnerCapital: number;
  loansOutstanding: number;
  accumulatedProfit: number;
  distributedProfit: number;
  retainedEarnings: number;
}

export interface ReportInput {
  generatedAt: Date;
  /** "Setembro/2026" ou "Geral (todo período)". */
  periodLabel: string;
  /** "Todas as filiais" ou o nome da cidade. */
  branchLabel: string;
  /** Início e fim da janela consultada. Em "Geral", o histórico inteiro. */
  start: Date;
  end: Date;
  inPeriod: (dateISO: string) => boolean;

  products: Product[];
  /** Chaves `marca|modelo` fora de linha na filial de referência. */
  hiddenModels: Set<string>;
  sales: Sale[];
  expenses: Expense[];
  stockEntries: StockEntry[];
  stockLosses: StockLoss[];
  stockTransfers: StockTransfer[];
  purchaseOrders: PurchaseOrder[];
  productAssignments: ProductAssignment[];
  sellers: Seller[];
  commissionPayments: CommissionPayment[];
  sellerDebtPayments: SellerDebtPayment[];
  sellerManualDebts: SellerManualDebt[];
  partners: Partner[];
  proLaborePayments: ProLaborePayment[];
  partnerContributions: PartnerContribution[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  investors: Investor[];
  dividends: Dividend[];
  financialEvents: FinancialEvent[];

  modelStats: ModelStat[];
  monthly: MonthlyRow[];
  position: LedgerPosition;

  branchName: (id: string | null | undefined) => string;
  /**
   * Custo unitário CONGELADO da venda (`saleUnitCost` do StoreContext). O
   * relatório lia o custo de hoje do produto, e cada lote novo reescrevia o
   * CPV de toda venda antiga na planilha.
   */
  costOf: (sale: Sale) => number;
}

/* ------------------------------------------------------------------ *
 * Formatação
 * ------------------------------------------------------------------ */

/**
 * Dinheiro vai como NÚMERO, não como texto formatado: quem abre o arquivo
 * precisa somar a coluna. Duas casas porque é o que o real tem — sem isso o
 * ponto flutuante vaza `1234.5600000000002` para dentro da célula.
 */
const money = (n: number) => Number((n || 0).toFixed(2));
const pct = (n: number) => Number((n || 0).toFixed(1));

/** `dd/MM/yyyy` sem depender do fuso de quem abre a planilha. */
export function dayBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function dateTimeBR(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dayBR(d.toISOString())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const byDateDesc = (a: { date: string }, b: { date: string }) =>
  new Date(b.date).getTime() - new Date(a.date).getTime();

/**
 * O mesmo vocabulário fechado da tela de Vendas (`paymentBadge` na SalesPage).
 * Valor fora da lista aparece cru em vez de virar vazio: coluna em branco num
 * relatório é indistinguível de "não preenchido".
 */
const PAYMENT_LABEL: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  pix_pendente: "Falta receber Pix",
  dinheiro_pendente: "Falta receber Dinheiro",
  dinheiro_com_vendedor: "Dinheiro com o vendedor",
  pendente: "Falta receber (a definir)",
};

/** Como o razão chama cada perna. Mesmos nomes da tela do Financeiro. */
const EVENT_LABEL: Record<FinancialEventKind, string> = {
  partner_contribution: "Aporte de sócio",
  loan_received: "Empréstimo recebido",
  loan_payment: "Pagamento de empréstimo",
  stock_purchase: "Compra de estoque",
  sale: "Venda",
  sale_cogs: "CPV da venda",
  expense: "Despesa",
  withdrawal: "Retirada de sócio",
  commission_paid: "Comissão paga",
  stock_loss: "Perda de estoque",
};

const URGENCY_LABEL = { critical: "Crítico", warning: "Atenção", ok: "Ok" } as const;

/** Situação do recebimento de uma venda — o mesmo par do trilho da tela. */
function saleStatus(s: Sale): string {
  const paid = s.paidAmount || 0;
  if (paid >= s.totalPrice - 0.01) return "Pago";
  if (paid > 0.01) return "Parcial";
  return "Aberto";
}

/* ------------------------------------------------------------------ *
 * Montagem
 * ------------------------------------------------------------------ */

export function buildReport(input: ReportInput): ReportSheet[] {
  const {
    generatedAt, periodLabel, branchLabel, start, end, inPeriod,
    products, hiddenModels, sales, expenses, stockEntries, stockLosses,
    stockTransfers, purchaseOrders, productAssignments, sellers,
    commissionPayments, sellerDebtPayments, sellerManualDebts,
    partners, proLaborePayments, partnerContributions,
    loans, loanPayments, investors, dividends, financialEvents,
    modelStats, monthly, position, branchName, costOf,
  } = input;

  const productById = new Map(products.map(p => [p.id, p]));
  const sellerById = new Map(sellers.map(s => [s.id, s]));
  const partnerById = new Map(partners.map(p => [p.id, p]));
  const investorById = new Map(investors.map(i => [i.id, i]));
  const loanById = new Map(loans.map(l => [l.id, l]));

  const productLabel = (id: string) => {
    const p = productById.get(id);
    return p ? `${p.flavor} · ${p.model}` : "Produto excluído";
  };
  const sellerLabel = (id: string | null | undefined) =>
    id ? (sellerById.get(id)?.name ?? "Vendedor excluído") : "Casa";
  /**
   * A filial de UMA linha. Não é o `branchName` cru: ele devolve "Todas as
   * filiais" para id vazio, que é a resposta certa para o seletor da tela e a
   * errada para uma célula — linha sem filial carimbada (as anteriores às
   * filiais) apareceria dizendo que vale para as duas cidades.
   */
  const branchCell = (id: string | null | undefined) => (id ? branchName(id) : "—");
  /** Custo TOTAL de uma venda, pelo custo congelado nela. */
  const saleCost = (s: Sale) => costOf(s) * s.quantity;

  /* ---------------- Recortes do período ---------------- */
  const periodSales = sales.filter(s => s.type === "venda" && inPeriod(s.date));
  const periodWithdrawals = sales.filter(s => s.type === "retirada_funcionario" && inPeriod(s.date));
  const periodExpenses = expenses.filter(e => inPeriod(e.date));
  const periodEntries = stockEntries.filter(e => inPeriod(e.date));
  const periodLosses = stockLosses.filter(l => inPeriod(l.date));
  const periodTransfers = stockTransfers.filter(t => inPeriod(t.date));
  const periodOrders = purchaseOrders.filter(o => inPeriod(o.date));
  const periodCommissionPayments = commissionPayments.filter(p => inPeriod(p.date));
  const periodDebtPayments = sellerDebtPayments.filter(p => inPeriod(p.date));
  const periodManualDebts = sellerManualDebts.filter(d => inPeriod(d.date));
  const periodProLabore = proLaborePayments.filter(p => inPeriod(p.date));
  const periodContributions = partnerContributions.filter(c => inPeriod(c.date));
  const periodLoanPayments = loanPayments.filter(p => inPeriod(p.date));
  const periodDividends = dividends.filter(d => inPeriod(d.date));
  const periodEvents = financialEvents.filter(e => inPeriod(e.date));

  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

  // A MESMA conta de resultado do Dashboard e da Distribuição
  // (src/lib/period-result.ts). O relatório fazia a sua, sem perdas nem
  // custo dos vendedores, e o "Lucro líquido" da planilha discordava do razão.
  const result = computePeriodResult({
    sales, expenses, stockLosses, commissionPayments, sellerDebtPayments, costOf, inPeriod,
  });
  const { revenue, received, receivable, cogs, grossProfit, netProfit } = result;
  const expensesTotal = result.expenses;

  /* ---------------- Comissão, pela mesma função da tela ---------------- */
  /**
   * A comissão fecha por MÊS, e é isso que `closedStart`/`closedEnd` dizem: um
   * período que começa no dia 10 ainda apura o mês inteiro, porque a faixa
   * acumula do dia 1 ao último dia. Mesmo contexto que a CommissionsPage monta.
   */
  const closedStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const closedEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59, 999);
  const isLegacy = (iso: string) => {
    const d = new Date(iso);
    return !isNaN(d.getTime()) && d < PROJECT_START;
  };
  const inClosedPeriod = (iso: string) => {
    const d = new Date(iso);
    return !isNaN(d.getTime()) && d >= closedStart && d <= closedEnd;
  };
  const sellerBalanceCtx = {
    sales, commissionPayments, sellerDebtPayments, sellerManualDebts,
    start, end, closedStart, PROJECT_START, isLegacy, inClosedPeriod,
  };
  const balances = sellers
    .filter(isCommissionSeller)
    .map(seller => computeSellerBalance(seller, sellerBalanceCtx))
    .sort((a, b) => b.balance - a.balance);

  const commissionAccrued = sum(balances, b => b.accrued);
  const commissionPayable = sum(balances, b => Math.max(0, b.balance));

  /** Dívida de vendedor em aberto HOJE: tudo o que foi lançado menos o que foi pago. */
  const sellerDebtOpen =
    sum(sales.filter(s => s.type === "retirada_funcionario"), s => s.totalPrice)
    + sum(sellerManualDebts, d => d.amount)
    - sum(sellerDebtPayments, p => p.amount);

  /* ---------------- Estoque: casa x vendedores ---------------- */
  const assignedByProduct = new Map<string, number>();
  productAssignments.forEach(a => {
    assignedByProduct.set(a.productId, (assignedByProduct.get(a.productId) || 0) + a.quantity);
  });

  const catalog = [...products].sort(compareCatalog);
  const totalStock = sum(products, p => p.stock);
  const stockAtCost = sum(products, p => (p.purchasePrice || 0) * p.stock);
  const stockAtSale = sum(products, p => (p.salePrice || 0) * p.stock);

  /* ---------------- Empréstimos ---------------- */
  const loanRows = loans.map(l => {
    const mine = loanPayments.filter(p => p.loanId === l.id);
    const principalPaid = sum(mine, p => p.principalAmount);
    const interestPaid = sum(mine, p => p.interestAmount);
    const principalRemaining = Math.max(0, l.principal - principalPaid);
    const interestRemaining = Math.max(0, l.interestAmount - interestPaid);
    return {
      loan: l, principalPaid, interestPaid, principalRemaining, interestRemaining,
      remaining: principalRemaining + interestRemaining,
      payments: mine.length,
    };
  }).sort((a, b) => Number(a.remaining <= 0.01) - Number(b.remaining <= 0.01) || b.remaining - a.remaining);
  const interestRemainingTotal = sum(loanRows, l => l.interestRemaining);

  /* ---------------- Sócios ---------------- */
  const totalPartnerPct = sum(partners, p => p.percentage || 0);
  // Igual à Distribuição: lucro − pagamentos a investidor − saldo devido aos
  // vendedores. O relatório não descontava o investidor e dava um alvo maior
  // que o da tela.
  const distributable = Math.max(0, netProfit - sum(periodDividends, d => d.amount) - commissionPayable);
  const partnerRows = partners.map(partner => {
    const mine = proLaborePayments.filter(w => w.partnerId === partner.id);
    const periodAmt = sum(mine.filter(w => inPeriod(w.date)), w => w.amount);
    const allTime = sum(mine, w => w.amount);
    const contributions = sum(
      partnerContributions.filter(c => c.partnerId === partner.id),
      c => c.amount,
    );
    const target = totalPartnerPct > 0 ? distributable * ((partner.percentage || 0) / totalPartnerPct) : 0;
    const last = [...mine].sort(byDateDesc)[0];
    return { partner, periodAmt, allTime, contributions, target, last };
  }).sort((a, b) => (b.partner.percentage || 0) - (a.partner.percentage || 0));

  /* ================================================================== *
   * Abas
   * ================================================================== */
  const sheets: ReportSheet[] = [];
  const add = (s: ReportSheet) => { sheets.push(s); return s; };

  /* ---------------- Resumo ---------------- */
  const section = (title: string): Cell[] => [title];
  const resumo: Cell[][] = [
    ["Filial", branchLabel, ""],
    ["Período", periodLabel, ""],
    ["Janela", `${dayBR(start.toISOString())} a ${dayBR(end.toISOString())}`, ""],
    ["Gerado em", dateTimeBR(generatedAt), ""],
    [],
    ["Indicador", "Valor", "Como se lê"],
    [],
    section("RESULTADO DO PERÍODO"),
    ["Receita", money(revenue), "Vendas do período pelo valor cheio"],
    ["Recebido", money(received), "A parte da receita que já entrou"],
    ["A receber", money(receivable), "O que falta entrar dessas vendas"],
    ["CPV (custo dos produtos vendidos)", money(cogs), ""],
    ["Lucro bruto", money(grossProfit), "Receita − CPV"],
    ["Margem bruta (%)", pct(revenue > 0 ? (grossProfit / revenue) * 100 : 0), ""],
    ["Despesas", money(expensesTotal), ""],
    ["Perdas", money(result.losses), "Pelo custo gravado na perda"],
    ["Custo dos vendedores", money(result.sellerCost), "Comissão paga + consumo a custo − dívida devolvida"],
    ["Lucro líquido", money(netProfit), "Lucro bruto − despesas − perdas − vendedores"],
    ["Margem líquida (%)", pct(revenue > 0 ? (netProfit / revenue) * 100 : 0), ""],
    ["Ticket médio", money(periodSales.length > 0 ? revenue / periodSales.length : 0), "Receita ÷ nº de vendas"],
    ["Vendas (qtd.)", periodSales.length, ""],
    ["Unidades vendidas", sum(periodSales, s => s.quantity), ""],
    ["Retiradas de funcionário", money(sum(periodWithdrawals, s => s.totalPrice)), "Consumo da equipe, não é venda"],
    ["Perdas (a custo)", money(sum(periodLosses, l => l.totalCost)), ""],
    ["Reposição de estoque", money(sum(periodEntries, e => e.totalCost)), "Investimento — não reduz o lucro"],
    ["Compras pedidas ao fornecedor", money(sum(periodOrders, o =>
      sum(o.items, i => i.expectedQuantity * i.unitPrice) + (o.freightCost || 0))), "Só vira estoque no recebimento"],
    [],
    section("VENDEDORES NO PERÍODO"),
    ["Comissão apurada", money(commissionAccrued), "Meses fechados tocados pelo período"],
    ["Comissão paga", money(sum(periodCommissionPayments, p => p.amount)), ""],
    ["Consumo lançado (retiradas + dívidas)", money(
      sum(periodWithdrawals, s => s.totalPrice) + sum(periodManualDebts, d => d.amount),
    ), ""],
    ["Dívida recebida de vendedor", money(sum(periodDebtPayments, p => p.amount)), ""],
    ["Saldo a pagar aos vendedores", money(commissionPayable), "Soma dos saldos positivos"],
    [],
    section("SÓCIOS E CAPITAL NO PERÍODO"),
    ["Distribuível", money(distributable), "Lucro líquido − saldo dos vendedores"],
    ["Pró-labore e retiradas pagas", money(sum(periodProLabore, p => p.amount)), ""],
    ["Aportes recebidos", money(sum(periodContributions, c => c.amount)), ""],
    ["Empréstimos pagos (principal)", money(sum(periodLoanPayments, p => p.principalAmount)), ""],
    ["Empréstimos pagos (juros)", money(sum(periodLoanPayments, p => p.interestAmount)), ""],
    ["Dividendos a investidores", money(sum(periodDividends, d => d.amount)), ""],
    [],
    section("POSIÇÃO DE HOJE — não segue o período"),
    ["Caixa", money(position.cash), "Do razão (financial_events)"],
    ["Estoque a custo", money(position.inventory), ""],
    ["A receber (total)", money(position.receivables), "De todas as vendas em aberto"],
    ["Capital de sócios", money(position.partnerCapital), ""],
    ["Empréstimos — principal em aberto", money(position.loansOutstanding), ""],
    ["Empréstimos — juros a pagar", money(interestRemainingTotal), "Fora do razão, que só carrega o principal"],
    ["Ainda a devolver", money(position.loansOutstanding + interestRemainingTotal), ""],
    ["Lucro acumulado", money(position.accumulatedProfit), ""],
    ["Lucro distribuído", money(position.distributedProfit), ""],
    ["Lucro retido", money(position.retainedEarnings), ""],
    ["Dívida de vendedores em aberto", money(sellerDebtOpen), "Consumo lançado − pagamentos"],
    [],
    section("ESTOQUE DE HOJE — não segue o período"),
    ["Unidades em estoque", totalStock, ""],
    ["Na casa", totalStock - sum(productAssignments, a => a.quantity), "Estoque − distribuído"],
    ["Com vendedores", sum(productAssignments, a => a.quantity), "Consignação (é parte do estoque)"],
    ["Valor a custo", money(stockAtCost), ""],
    ["Valor a preço de venda", money(stockAtSale), ""],
    ["Sabores cadastrados", products.length, ""],
    ["Sabores zerados", products.filter(p => p.stock <= 0).length, ""],
    ["Sabores abaixo do mínimo", products.filter(p => p.minStock > 0 && p.stock < p.minStock).length, ""],
    ["Modelos fora de linha", hiddenModels.size, "Arquivados nesta filial"],
    ["Unidades a caminho", sum(modelStats, m => m.incoming), "Compras pedidas e não recebidas"],
    ["Vendedores ativos", sellers.length, ""],
  ];
  add({
    name: "Resumo",
    about: "Os números do período e a posição de hoje, num lugar só",
    scope: "periodo",
    rows: resumo,
    widths: [40, 18, 44],
  });

  /* ---------------- Evolução ---------------- */
  add({
    name: "Evolução 6 meses",
    about: "Receita, custo, despesa e lucro mês a mês — a série do gráfico do Dashboard",
    scope: "proprio",
    autofilter: true,
    rows: [
      ["Mês", "Receita", "CPV", "Lucro bruto", "Despesas", "Perdas", "Vendedores", "Lucro líquido", "Margem (%)", "Vendas", "Unidades"],
      ...monthly.map(m => [
        m.monthLong, money(m.receita), money(m.cogs), money(m.receita - m.cogs),
        money(m.despesas), money(m.perdas), money(m.vendedores), money(m.lucro), pct(m.margem), m.vendas, m.unidades,
      ]),
    ],
    widths: [16, 14, 14, 14, 14, 12, 12, 14, 12, 10, 10],
  });

  /* ---------------- Vendas ---------------- */
  add({
    name: "Vendas",
    about: "Uma linha por venda, com custo, lucro e situação do recebimento",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Produto", "Marca", "Modelo", "Sabor", "Qtd.", "Unitário", "Total",
       "Pago", "A receber", "CPV", "Lucro bruto", "Vendedor", "Forma de pagamento",
       "Situação", "Recebido em", "Observações"],
      ...[...periodSales].sort(byDateDesc).map(s => {
        const p = productById.get(s.productId);
        const c = saleCost(s);
        return [
          dayBR(s.date), productLabel(s.productId), p?.brand ?? "", p?.model ?? "", p?.flavor ?? "",
          s.quantity, money(s.unitPrice), money(s.totalPrice),
          money(s.paidAmount || 0), money(Math.max(0, s.totalPrice - (s.paidAmount || 0))),
          money(c), money(s.totalPrice - c),
          s.sellerId ? sellerLabel(s.sellerId) : "—",
          s.paymentMethod ? (PAYMENT_LABEL[s.paymentMethod] ?? s.paymentMethod) : "—",
          saleStatus(s), dayBR(s.paidAt), s.notes ?? "",
        ];
      }),
    ],
    widths: [11, 28, 14, 14, 18, 7, 11, 11, 11, 11, 11, 12, 16, 22, 10, 12, 34],
  });

  /* ---------------- Retiradas de funcionário ---------------- */
  add({
    name: "Retiradas funcionário",
    about: "Produto que saiu para consumo da equipe — vira dívida do vendedor, não venda",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Vendedor", "Produto", "Qtd.", "Valor", "Custo", "Observações"],
      ...[...periodWithdrawals].sort(byDateDesc).map(s => [
        dayBR(s.date), sellerLabel(s.sellerId), productLabel(s.productId),
        s.quantity, money(s.totalPrice), money(saleCost(s)), s.notes ?? "",
      ]),
    ],
    widths: [11, 18, 28, 7, 12, 12, 34],
  });

  /* ---------------- Despesas ---------------- */
  add({
    name: "Despesas",
    about: "Gastos lançados no período, com a categoria de cada um",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Categoria", "Descrição", "Valor"],
      ...[...periodExpenses].sort(byDateDesc).map(e => [
        dayBR(e.date), e.category ?? "", e.description ?? "", money(e.amount),
      ]),
    ],
    widths: [11, 20, 44, 14],
  });

  /* ---------------- Entradas de estoque ---------------- */
  add({
    name: "Entradas de estoque",
    about: "Mercadoria que entrou na filial, pelo custo com que entrou",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Produto", "Marca", "Modelo", "Sabor", "Qtd.", "Custo unit.", "Custo total", "Filial", "Observações"],
      ...[...periodEntries].sort(byDateDesc).map(e => {
        const p = productById.get(e.productId);
        return [
          dayBR(e.date), productLabel(e.productId), p?.brand ?? "", p?.model ?? "", p?.flavor ?? "",
          e.quantity, money(e.unitCost), money(e.totalCost),
          branchCell(e.branchId), e.notes ?? "",
        ];
      }),
    ],
    widths: [11, 28, 14, 14, 18, 7, 12, 13, 14, 34],
  });

  /* ---------------- Compras ao fornecedor ---------------- *
   * Duas abas porque o frete é da COMPRA e o custo é do ITEM: repetir o frete
   * em cada item faria a coluna somar várias vezes o mesmo dinheiro.          */
  const ordered = [...periodOrders].sort(byDateDesc);
  const receivedUnits = (o: PurchaseOrder) =>
    sum(o.items, i => sum(i.receivedFlavors ?? [], f => f.quantity));
  add({
    name: "Compras",
    about: "Pedidos ao fornecedor. O número é POSICIONAL (o mesmo da tela) e muda se um pedido for excluído",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Compra", "Data", "Situação", "Itens", "Previsto (un.)", "Recebido (un.)",
       "Custo dos itens", "Frete", "Total", "Pago", "Falta pagar", "Recebida em", "Observações"],
      ...ordered.map(o => {
        const items = sum(o.items, i => i.expectedQuantity * i.unitPrice);
        const total = items + (o.freightCost || 0);
        return [
          `#${o.number}`, dayBR(o.date),
          o.status === "received" ? "Recebida" : "Aguardando",
          o.items.length, sum(o.items, i => i.expectedQuantity), receivedUnits(o),
          money(items), money(o.freightCost || 0), money(total),
          money(o.paidAmount || 0), money(Math.max(0, total - (o.paidAmount || 0))),
          dayBR(o.receivedAt), o.notes ?? "",
        ];
      }),
    ],
    widths: [10, 11, 12, 8, 14, 15, 16, 12, 13, 12, 13, 13, 34],
  });

  add({
    name: "Itens de compra",
    about: "Cada modelo dentro de uma compra, com os sabores que vieram na caixa",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Compra", "Data", "Marca", "Modelo", "Previsto (un.)", "Recebido (un.)",
       "Custo unit.", "Total do item", "Sabores recebidos"],
      ...ordered.flatMap(o => o.items.map(i => [
        `#${o.number}`, dayBR(o.date), i.brand, i.model,
        i.expectedQuantity, sum(i.receivedFlavors ?? [], f => f.quantity),
        money(i.unitPrice), money(i.expectedQuantity * i.unitPrice),
        (i.receivedFlavors ?? [])
          .map(f => `${f.flavor}: ${f.quantity}${f.branchId ? ` (${branchName(f.branchId)})` : ""}`)
          .join(" · "),
      ])),
    ],
    widths: [10, 11, 16, 18, 14, 15, 12, 14, 50],
  });

  /* ---------------- Perdas ---------------- */
  add({
    name: "Perdas",
    about: "Unidade que sumiu, quebrou ou venceu — sai do estoque e do razão pelo custo",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Produto", "Marca", "Modelo", "Sabor", "Qtd.", "Custo unit.", "Custo total", "Saiu de", "Filial", "Motivo"],
      ...[...periodLosses].sort(byDateDesc).map(l => {
        const p = productById.get(l.productId);
        return [
          dayBR(l.date), productLabel(l.productId), p?.brand ?? "", p?.model ?? "", p?.flavor ?? "",
          l.quantity, money(l.unitCost), money(l.totalCost),
          sellerLabel(l.sellerId), branchCell(l.branchId), l.reason ?? "",
        ];
      }),
    ],
    widths: [11, 28, 14, 14, 18, 7, 12, 13, 16, 14, 34],
  });

  /* ---------------- Transferências ---------------- */
  add({
    name: "Transferências",
    about: "Unidade que mudou de cidade. Não passa pelo razão: não gasta caixa nem cria estoque",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Produto", "Marca", "Modelo", "Sabor", "Qtd.", "Custo unit.", "Custo total",
       "De (filial)", "Para (filial)", "Saiu de", "Operação", "Observações"],
      ...[...periodTransfers].sort(byDateDesc).map(t => {
        const p = productById.get(t.productId);
        return [
          dayBR(t.date), productLabel(t.productId), p?.brand ?? "", p?.model ?? "", p?.flavor ?? "",
          t.quantity, money(t.unitCost), money(t.unitCost * t.quantity),
          branchCell(t.fromBranchId), branchCell(t.toBranchId),
          sellerLabel(t.fromSellerId),
          t.batchId ? t.batchId.slice(0, 8) : "—", t.notes ?? "",
        ];
      }),
    ],
    widths: [11, 28, 14, 14, 18, 7, 12, 13, 16, 16, 16, 12, 30],
  });

  /* ---------------- Estoque ---------------- */
  add({
    name: "Estoque",
    about: "Um sabor por linha: o que existe hoje, onde está e quanto vale",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Marca", "Modelo", "Sabor", "Estoque", "Na casa", "Com vendedores", "Mínimo",
       "Custo unit.", "Preço de venda", "Valor a custo", "Valor a venda",
       "Margem (%)", "Situação", "Fora de linha"],
      ...catalog.map(p => {
        const assigned = assignedByProduct.get(p.id) || 0;
        const margin = p.salePrice > 0 ? ((p.salePrice - (p.purchasePrice || 0)) / p.salePrice) * 100 : 0;
        const status = p.stock <= 0
          ? "Zerado"
          : p.minStock > 0 && p.stock < p.minStock ? "Abaixo do mínimo" : "Ok";
        return [
          p.brand, p.model, p.flavor, p.stock, p.stock - assigned, assigned, p.minStock,
          money(p.purchasePrice || 0), money(p.salePrice || 0),
          money((p.purchasePrice || 0) * p.stock), money((p.salePrice || 0) * p.stock),
          pct(margin), status,
          hiddenModels.has(modelArchiveKey(p.brand, p.model)) ? "Sim" : "—",
        ];
      }),
    ],
    widths: [16, 16, 22, 10, 10, 15, 9, 12, 15, 14, 14, 11, 17, 13],
  });

  /* ---------------- Distribuição ---------------- */
  add({
    name: "Distribuição",
    about: "O que está na mão de cada vendedor — é parte do estoque, não soma a ele",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Vendedor", "Filial", "Marca", "Modelo", "Sabor", "Unidades", "Valor a custo", "Valor a venda", "Desde"],
      ...[...productAssignments]
        .filter(a => a.quantity > 0)
        .sort((a, b) => {
          const byName = sellerLabel(a.sellerId).localeCompare(sellerLabel(b.sellerId), "pt-BR");
          if (byName !== 0) return byName;
          const pa = productById.get(a.productId);
          const pb = productById.get(b.productId);
          return pa && pb ? compareCatalog(pa, pb) : 0;
        })
        .map(a => {
          const p = productById.get(a.productId);
          const seller = sellerById.get(a.sellerId);
          return [
            sellerLabel(a.sellerId), branchCell(seller?.branchId),
            p?.brand ?? "", p?.model ?? "", p?.flavor ?? "", a.quantity,
            money((p?.purchasePrice ?? 0) * a.quantity),
            money((p?.salePrice ?? 0) * a.quantity),
            dayBR(a.createdAt),
          ];
        }),
    ],
    widths: [18, 14, 16, 16, 22, 10, 14, 14, 12],
  });

  /* ---------------- Repor agora ---------------- */
  const restockRows = modelStats
    .filter(m => m.restockUnits > 0)
    .sort((a, b) => b.restockUnits - a.restockUnits);
  add({
    name: "Repor agora",
    about: "O que falta para o estoque alcançar o mínimo, já descontado o que está a caminho",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Marca", "Modelo", "Estoque", "Mínimo", "Falta", "A caminho", "Pedir",
       "Custo do pedido", "Urgência", "Vendeu no período (un.)", "Receita no período",
       "Dias sem vender"],
      ...restockRows.map(m => [
        m.brand, m.model, m.stock, m.minUnits, m.needUnits, m.incoming, m.restockUnits,
        money(m.restockCost), URGENCY_LABEL[urgencyOf(m.stock, m.minUnits)],
        m.qty, money(m.revenue),
        Number.isFinite(m.daysSinceLastSale) ? Math.round(m.daysSinceLastSale) : "Nunca vendeu",
      ]),
    ],
    widths: [16, 18, 10, 10, 9, 12, 9, 16, 12, 22, 18, 16],
  });

  /* ---------------- Comissões ---------------- */
  add({
    name: "Comissões",
    about: "Saldo de cada vendedor: comissão apurada, consumo, pagamentos e o que sobra a pagar",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Vendedor", "Filial", "Unidades", "Faixa", "Comissão apurada", "Ajuste de faixa",
       "Comissão paga", "Retiradas", "Dívidas lançadas", "Consumo total",
       "Dívida recebida", "Saldo anterior", "Saldo do período", "Saldo a pagar",
       "Vendas no período", "A receber de vendas", "Saldo projetado"],
      ...balances.map(b => [
        b.seller.name, branchCell(b.seller.branchId), b.units, b.tier.label,
        money(b.accrued), money(b.adjustmentsTotal), money(b.commPaid),
        money(b.retiradasTotal), money(b.manualDebtsTotal), money(b.consumoTotal),
        money(b.debtPaymentsTotal), money(b.priorBalance), money(b.periodBalance),
        money(b.balance), money(b.vendasTotal), money(b.pendingToReceive),
        money(b.projectedBalance),
      ]),
    ],
    widths: [18, 14, 10, 8, 16, 14, 13, 12, 15, 13, 14, 14, 15, 13, 16, 17, 15],
  });

  /* ---------------- Comissões pagas ---------------- */
  add({
    name: "Comissões pagas",
    about: "Cada pagamento de comissão feito no período",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Vendedor", "Valor", "Observações"],
      ...[...periodCommissionPayments].sort(byDateDesc).map(p => [
        dayBR(p.date), sellerLabel(p.sellerId), money(p.amount), p.notes ?? "",
      ]),
    ],
    widths: [11, 20, 14, 40],
  });

  /* ---------------- Dívidas de vendedor ---------------- *
   * Lançamento e pagamento na MESMA aba, em colunas separadas: são os dois
   * lados de um saldo só, e duas abas obrigariam a subtrair uma da outra para
   * responder "quanto o Fulano deve".                                        */
  const debtRows: Cell[][] = [
    ...periodManualDebts.map(d => ({
      date: d.date, seller: sellerLabel(d.sellerId), kind: "Dívida lançada",
      charged: d.amount, paid: 0, notes: d.notes ?? "",
    })),
    ...periodDebtPayments.map(p => ({
      date: p.date, seller: sellerLabel(p.sellerId), kind: "Pagamento",
      charged: 0, paid: p.amount, notes: p.notes ?? "",
    })),
  ]
    .sort(byDateDesc)
    .map(r => [dayBR(r.date), r.seller, r.kind, money(r.charged), money(r.paid), r.notes]);
  add({
    name: "Dívidas de vendedor",
    about: "Dívidas lançadas à mão e pagamentos recebidos (a retirada de produto está na aba própria)",
    scope: "periodo",
    autofilter: true,
    rows: [["Data", "Vendedor", "Tipo", "Lançado", "Pago", "Observações"], ...debtRows],
    widths: [11, 20, 16, 13, 13, 40],
  });

  /* ---------------- Sócios ---------------- */
  add({
    name: "Sócios",
    about: "Participação, aportes e retiradas de cada sócio; o alvo segue o distribuível do período",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Sócio", "Participação (%)", "Pró-labore mensal", "Aportes (total)",
       "Retiradas no período", "Retiradas (total)", "Alvo do período",
       "Falta retirar", "Retirou além do alvo", "Última retirada"],
      ...partnerRows.map(r => [
        r.partner.name, pct(r.partner.percentage || 0), money(r.partner.monthlyProLabore || 0),
        money(r.contributions), money(r.periodAmt), money(r.allTime), money(r.target),
        money(Math.max(0, r.target - r.periodAmt)), money(Math.max(0, r.periodAmt - r.target)),
        r.last ? dayBR(r.last.date) : "—",
      ]),
    ],
    widths: [20, 16, 18, 16, 19, 17, 16, 14, 20, 15],
  });

  /* ---------------- Pró-labore / retiradas ---------------- */
  add({
    name: "Pró-labore e retiradas",
    about: "Cada retirada de sócio paga no período",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Sócio", "Valor", "Observações"],
      ...[...periodProLabore].sort(byDateDesc).map(p => [
        dayBR(p.date), partnerById.get(p.partnerId)?.name ?? "Sócio excluído",
        money(p.amount), p.notes ?? "",
      ]),
    ],
    widths: [11, 20, 14, 40],
  });

  /* ---------------- Aportes ---------------- */
  add({
    name: "Aportes de sócios",
    about: "Dinheiro que o sócio colocou no negócio",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Sócio", "Valor", "Observações"],
      ...[...periodContributions].sort(byDateDesc).map(c => [
        dayBR(c.date), partnerById.get(c.partnerId)?.name ?? "Sócio excluído",
        money(c.amount), c.notes ?? "",
      ]),
    ],
    widths: [11, 20, 14, 40],
  });

  /* ---------------- Empréstimos ---------------- */
  add({
    name: "Empréstimos",
    about: "Todo empréstimo tomado, com principal e juro separados — é assim que o razão os trata",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Credor", "Recebido em", "Principal", "Juros combinados", "Total",
       "Principal pago", "Juros pagos", "Principal a devolver", "Juros a devolver",
       "Ainda a devolver", "Situação", "Pagamentos", "Observações"],
      ...loanRows.map(l => [
        l.loan.lenderName, dayBR(l.loan.receivedDate), money(l.loan.principal),
        money(l.loan.interestAmount), money(l.loan.principal + l.loan.interestAmount),
        money(l.principalPaid), money(l.interestPaid),
        money(l.principalRemaining), money(l.interestRemaining), money(l.remaining),
        l.remaining <= 0.01 ? "Quitado" : "Em aberto", l.payments, l.loan.notes ?? "",
      ]),
    ],
    widths: [22, 13, 13, 17, 13, 15, 13, 19, 17, 16, 11, 12, 34],
  });

  add({
    name: "Pagamentos empréstimo",
    about: "Cada parcela paga no período, com principal e juro em colunas próprias",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Credor", "Principal", "Juros", "Total", "Observações"],
      ...[...periodLoanPayments].sort(byDateDesc).map(p => [
        dayBR(p.date), loanById.get(p.loanId)?.lenderName ?? "Empréstimo excluído",
        money(p.principalAmount), money(p.interestAmount),
        money(p.principalAmount + p.interestAmount), p.notes ?? "",
      ]),
    ],
    widths: [11, 22, 14, 13, 13, 40],
  });

  /* ---------------- Investidores ---------------- */
  add({
    name: "Investidores",
    about: "Quanto cada investidor pôs, quanto tem a receber e quanto já saiu",
    scope: "posicao",
    autofilter: true,
    rows: [
      ["Investidor", "Investido", "Retorno (%)", "Retorno total", "Pago", "Falta pagar", "Desde"],
      ...investors.map(i => {
        const paid = sum(dividends.filter(d => d.investorId === i.id), d => d.amount);
        return [
          i.name, money(i.investedAmount), pct(i.returnPercentage),
          money(i.totalReturn), money(paid), money(Math.max(0, i.totalReturn - paid)),
          dayBR(i.createdAt),
        ];
      }),
    ],
    widths: [22, 14, 13, 15, 13, 14, 12],
  });

  add({
    name: "Dividendos",
    about: "Pagamentos feitos a investidores no período",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Investidor", "Valor", "Observações"],
      ...[...periodDividends].sort(byDateDesc).map(d => [
        dayBR(d.date), investorById.get(d.investorId)?.name ?? "Investidor excluído",
        money(d.amount), d.notes ?? "",
      ]),
    ],
    widths: [11, 22, 14, 40],
  });

  /* ---------------- Razão ---------------- */
  add({
    name: "Razão",
    about: "Todo movimento que mexe em caixa, estoque, dívida ou capital — a base de tudo acima",
    scope: "periodo",
    autofilter: true,
    rows: [
      ["Data", "Tipo", "Descrição", "Valor", "Caixa", "Estoque", "A receber",
       "Empréstimo", "Capital de sócios", "Lucro acumulado", "Lucro distribuído", "Observações"],
      ...[...periodEvents].sort(byDateDesc).map(e => [
        dayBR(e.date), EVENT_LABEL[e.kind] ?? e.kind, e.description ?? "",
        money(e.amount), money(e.cashDelta), money(e.inventoryDelta),
        money(e.receivableDelta), money(e.loanDelta), money(e.partnerCapitalDelta),
        money(e.accumulatedProfitDelta), money(e.distributedProfitDelta), e.notes ?? "",
      ]),
    ],
    widths: [11, 22, 40, 13, 13, 13, 13, 13, 17, 16, 17, 30],
  });

  /* ---------------- Índice ---------------- *
   * Montado no fim, com as abas já prontas, e enfiado na FRENTE: ele precisa
   * contar as linhas de cada uma, e é a primeira coisa que alguém vê.
   *
   * A contagem de linhas é o que faz aba vazia ser um FATO ("0 linhas") em vez
   * de uma ausência — as abas sempre aparecem, todas, para o arquivo ter a
   * mesma forma todo mês.                                                     */
  const SCOPE_LABEL: Record<Scope, string> = {
    periodo: "Segue o período",
    posicao: "Posição de hoje",
    proprio: "Janela própria",
  };
  sheets.unshift({
    name: "Índice",
    about: "",
    scope: "proprio",
    // Sem filtro do Excel: é a capa, não uma tabela de dados — as três linhas
    // de cabeçalho do relatório ficam ACIMA da linha de títulos de coluna.
    rows: [
      ["Aba", "O que tem dentro", "Recorte", "Linhas"],
      ["Relatório", `California — ${branchLabel}`, periodLabel, ""],
      ["Gerado em", dateTimeBR(generatedAt), `${dayBR(start.toISOString())} a ${dayBR(end.toISOString())}`, ""],
      [],
      ...sheets.map(s => [
        s.name,
        s.name === "Resumo" ? "Os números do período e a posição de hoje, num lugar só" : s.about,
        SCOPE_LABEL[s.scope],
        s.name === "Resumo" ? "" : Math.max(0, s.rows.length - 1),
      ]),
    ],
    widths: [24, 82, 18, 9],
  });

  return sheets;
}
