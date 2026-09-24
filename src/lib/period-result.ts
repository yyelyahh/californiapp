import type { Expense, Sale, StockLoss } from "@/types";

/**
 * O resultado de um período — a conta ÚNICA de lucro do sistema.
 *
 * Dashboard, Distribuição e o relatório em Excel calculavam isso cada um do seu
 * jeito, e os três ignoravam duas saídas de dinheiro que o razão
 * (`financial_events`) sempre contou: as PERDAS e o que se gasta com os
 * VENDEDORES. O efeito mais visível era na Distribuição: o "distribuível aos
 * sócios" é o lucro menos o saldo devido aos vendedores, e pagar a comissão
 * zerava o saldo sem tirar nada do lucro — pagar comissão AUMENTAVA o que os
 * sócios podiam retirar.
 *
 * As regras são as do razão, perna por perna:
 * - receita e CPV só de `venda`; o CPV usa o custo CONGELADO na venda
 *   (`costOf`, que lê `sale_costs`), não o custo de hoje do produto — senão
 *   cada lote novo reescreveria o lucro dos meses passados;
 * - perda sai pelo custo gravado nela;
 * - CUSTO DOS VENDEDORES = comissão paga em dinheiro + consumo do vendedor
 *   (retirada) a custo − dívida que ele devolveu em dinheiro. A retirada é
 *   comissão paga em mercadoria: ela entra no saldo do vendedor pelo preço e
 *   custa à empresa o custo da unidade; quando ele paga em dinheiro, o saldo
 *   dele volta a subir e o dinheiro entra aqui como abatimento.
 *
 * O que NÃO entra: juro de empréstimo e pagamento a investidor, que são da
 * sociedade e não da operação de uma filial.
 *
 * Testada em src/test/period-result.test.ts.
 */
export type PeriodResultInput = {
  sales: Sale[];
  expenses: Expense[];
  stockLosses: StockLoss[];
  commissionPayments: { amount: number; date: string }[];
  sellerDebtPayments: { amount: number; date: string }[];
  /** Custo UNITÁRIO da venda, congelado nela (ver `saleUnitCost` no StoreContext). */
  costOf: (sale: Sale) => number;
  inPeriod: (iso: string) => boolean;
};

export type PeriodResult = ReturnType<typeof computePeriodResult>;

export function computePeriodResult(input: PeriodResultInput) {
  const { costOf, inPeriod } = input;
  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

  const sales = input.sales.filter(s => s.type === "venda" && inPeriod(s.date));
  const withdrawals = input.sales.filter(s => s.type === "retirada_funcionario" && inPeriod(s.date));

  const revenue = sum(sales, s => s.totalPrice);
  const received = sum(sales, s => s.paidAmount || 0);
  const receivable = sum(sales, s => Math.max(0, s.totalPrice - (s.paidAmount || 0)));
  const cogs = sum(sales, s => costOf(s) * s.quantity);
  const grossProfit = revenue - cogs;

  const expenses = sum(input.expenses.filter(e => inPeriod(e.date)), e => e.amount);
  const losses = sum(input.stockLosses.filter(l => inPeriod(l.date)), l => l.totalCost);

  const commissionsPaid = sum(input.commissionPayments.filter(p => inPeriod(p.date)), p => p.amount);
  const consumptionCost = sum(withdrawals, s => costOf(s) * s.quantity);
  const debtReceived = sum(input.sellerDebtPayments.filter(p => inPeriod(p.date)), p => p.amount);
  const sellerCost = commissionsPaid + consumptionCost - debtReceived;

  const netProfit = grossProfit - expenses - losses - sellerCost;

  return {
    sales,
    salesCount: sales.length,
    revenue,
    received,
    receivable,
    cogs,
    grossProfit,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    expenses,
    losses,
    commissionsPaid,
    consumptionCost,
    debtReceived,
    sellerCost,
    netProfit,
    netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    /** Faturamento ÷ quantidade de vendas — a mesma conta da tela de Vendas. */
    ticket: sales.length > 0 ? revenue / sales.length : 0,
  };
}
