import type { Expense, Sale } from "@/types";

/**
 * O resultado de um período — a conta ÚNICA de lucro do sistema, usada pelo
 * Dashboard, pela Distribuição e pelo relatório em Excel.
 *
 * LUCRO LÍQUIDO = RECEBIDO − CPV da parte paga − DESPESAS. Decisões do dono:
 *
 * - O LUCRO É DO RECEBIDO: venda em aberto ainda não deu lucro. A conta parte
 *   do que já foi pago das vendas do período, e o CPV é só o da parte paga de
 *   cada venda (custo × pago ÷ total; venda de valor zero conta o custo
 *   inteiro). A margem é sempre sobre o recebido. A receita (vendido pelo
 *   valor cheio) continua aqui para o faturamento, o ticket e a barra
 *   recebido/a receber, mas não entra no lucro. O pagamento entra na data da
 *   VENDA (não há data de pagamento), então quitar em setembro uma venda de
 *   agosto sobe o lucro de agosto.
 * - PERDAS não descontam.
 * - VENDEDORES não descontam aqui: a comissão sai na Distribuição, pela
 *   comissão APURADA do período (`computeSellerBalance().accrued`), uma vez
 *   só. Antes o lucro descontava a comissão PAGA e a Distribuição o saldo a
 *   pagar: a comissão de agosto paga em setembro pesava em agosto (saldo) e
 *   de novo em setembro (pagamento). A retirada do vendedor é comissão paga em
 *   mercadoria, então já está dentro da apurada.
 * - Juro de empréstimo e pagamento a investidor são da sociedade, não da
 *   operação de uma filial.
 *
 * O CPV usa o custo CONGELADO na venda (`costOf`, que lê `sale_costs`), não o
 * custo de hoje do produto — senão cada lote novo reescreveria o lucro dos
 * meses passados.
 *
 * O razão (`financial_events`) segue outra base (venda inteira, perdas e
 * vendedores descontados): o lucro acumulado de lá não fecha com este.
 *
 * Testada em src/test/period-result.test.ts.
 */
export type PeriodResultInput = {
  sales: Sale[];
  expenses: Expense[];
  /** Custo UNITÁRIO da venda, congelado nela (ver `saleUnitCost` no StoreContext). */
  costOf: (sale: Sale) => number;
  inPeriod: (iso: string) => boolean;
};

export type PeriodResult = ReturnType<typeof computePeriodResult>;

export function computePeriodResult(input: PeriodResultInput) {
  const { costOf, inPeriod } = input;
  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

  const sales = input.sales.filter(s => s.type === "venda" && inPeriod(s.date));

  const revenue = sum(sales, s => s.totalPrice);
  const received = sum(sales, s => s.paidAmount || 0);
  const receivable = sum(sales, s => Math.max(0, s.totalPrice - (s.paidAmount || 0)));
  /** A fração já paga da venda, entre 0 e 1. */
  const paidShare = (s: Sale) =>
    s.totalPrice > 0 ? Math.min(1, Math.max(0, (s.paidAmount || 0) / s.totalPrice)) : 1;
  /** CPV da parte PAGA — o custo do que já virou recebido. */
  const cogs = sum(sales, s => costOf(s) * s.quantity * paidShare(s));
  const grossProfit = received - cogs;

  const expenses = sum(input.expenses.filter(e => inPeriod(e.date)), e => e.amount);

  const netProfit = grossProfit - expenses;

  return {
    sales,
    salesCount: sales.length,
    revenue,
    received,
    receivable,
    cogs,
    grossProfit,
    /** Margens sobre o RECEBIDO, a mesma base do lucro. */
    grossMargin: received > 0 ? (grossProfit / received) * 100 : 0,
    expenses,
    netProfit,
    netMargin: received > 0 ? (netProfit / received) * 100 : 0,
    /** Faturamento ÷ quantidade de vendas — a mesma conta da tela de Vendas. */
    ticket: sales.length > 0 ? revenue / sales.length : 0,
  };
}
