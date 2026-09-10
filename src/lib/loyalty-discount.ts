/**
 * A prévia do desconto da fidelidade — a mesma conta que o banco faz.
 *
 * Quem decide de verdade é `create_pending_order`: ela refaz este cálculo com
 * o histórico e o preço lidos de dentro, e é o preço dela que fica gravado em
 * `order_items.unit_price`. Isto aqui existe porque o desconto precisa aparecer
 * ANTES de a pessoa confirmar — um prêmio que só se revela no comprovante não
 * fecha carrinho nenhum.
 *
 * Para as duas contas darem o mesmo resultado, três regras são iguais dos dois
 * lados, e é por isso que elas moram aqui, num lugar só, com teste em volta:
 *
 *   1. A POSIÇÃO. As unidades do carrinho ocupam as posições
 *      `historyUnits + 1` até `historyUnits + n` na vida do cliente, e ganha
 *      desconto toda posição múltipla do ciclo (hoje 6, número que vem do
 *      banco em `get_customer_loyalty.cycle_units` — o front não o conhece).
 *   2. A ORDEM. O prêmio cai na unidade MAIS BARATA do pedido; `product_id`
 *      desempata, porque o Postgres também desempata por `p.id` e sem isso
 *      dois produtos de preço igual poderiam receber respostas diferentes.
 *   3. O PRÊMIO QUE NÃO DESCONTA. Em produto de margem curta o preço premiado
 *      encosta no preço cheio (o preço premiado sai sempre em reais inteiros,
 *      arredondado para cima, e travado no preço de venda). Ali o prêmio NÃO é
 *      gasto: ele passa para o próximo item, em vez de sumir sem entregar nada.
 */

export interface DiscountableItem {
  product_id: string;
  sale_price: number;
  /** Quanto esta unidade custa quando é a premiada. Vem de `get_seller_catalog`. */
  loyalty_price: number;
  quantity: number;
}

export interface LoyaltyPosition {
  /** Unidades que o cliente já comprou de verdade (vendas confirmadas). */
  historyUnits: number;
  /** Tamanho do ciclo, vindo do banco. */
  cycleUnits: number;
}

export interface DiscountPreview {
  /** O que o cliente paga. */
  total: number;
  /** O que pagaria sem fidelidade — o número riscado ao lado. */
  fullTotal: number;
  discountTotal: number;
  discountUnits: number;
}

export function previewLoyaltyDiscount(
  items: DiscountableItem[],
  position: LoyaltyPosition | null,
): DiscountPreview {
  const fullTotal = items.reduce((acc, i) => acc + i.sale_price * i.quantity, 0);
  const units = items.reduce((acc, i) => acc + i.quantity, 0);
  const nada = { total: fullTotal, fullTotal, discountTotal: 0, discountUnits: 0 };

  if (!position || position.cycleUnits <= 0 || units <= 0) return nada;

  const { historyUnits, cycleUnits } = position;
  let restam =
    Math.floor((historyUnits + units) / cycleUnits) - Math.floor(historyUnits / cycleUnits);
  if (restam <= 0) return nada;

  let discountTotal = 0;
  let discountUnits = 0;

  const ordenado = [...items].sort(
    (a, b) =>
      a.sale_price - b.sale_price ||
      (a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0),
  );

  for (const item of ordenado) {
    if (restam <= 0) break;
    // Comparação explícita em vez de `>=` negado: preço premiado ausente
    // (NaN, undefined vindo de um catálogo antigo em cache) cai no "não
    // desconta" em vez de virar um desconto de valor indefinido.
    if (!(item.loyalty_price < item.sale_price)) continue;
    const n = Math.min(restam, item.quantity);
    discountTotal += (item.sale_price - item.loyalty_price) * n;
    discountUnits += n;
    restam -= n;
  }

  return { total: fullTotal - discountTotal, fullTotal, discountTotal, discountUnits };
}
