/**
 * Real brasileiro, um lugar só.
 *
 * Este par estava copiado byte a byte em treze arquivos: as nove telas do ERP
 * (Dashboard, Vendas, Entrada, Perdas, Despesas, Produtos, Distribuição,
 * Financeiro, Insights), o Extrato do vendedor, as duas telas storefront e dois
 * formulários. Trocar a moeda ou o locale exigia acertar treze arquivos, e
 * bastava esquecer um para duas telas passarem a escrever o mesmo número de
 * jeitos diferentes — o mesmo motivo que trouxe `currentMonthRange` para o
 * date-utils.
 *
 * Os `Intl.NumberFormat` são criados UMA vez, no módulo. Construir o formatador
 * é a parte cara; formatar é barata. Como as telas chamam isto uma vez por
 * linha de lista (e a lista de Vendas monta uma linha por venda, sem
 * virtualização), a versão anterior construía um formatador por célula.
 */
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const BRL_SHORT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/** `|| 0` porque NaN e undefined chegam de conta com divisor zero, e "R$ NaN" na tela não diz nada. */
export function formatCurrency(v: number): string {
  return BRL.format(v || 0);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
export function formatCurrencyShort(v: number): string {
  return BRL_SHORT.format(v || 0);
}
