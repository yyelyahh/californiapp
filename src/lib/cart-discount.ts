/**
 * A prévia dos descontos do carrinho — a mesma conta que o banco faz.
 *
 * Quem decide de verdade é `create_pending_order`: ela refaz este cálculo com
 * o histórico e os preços lidos de dentro, e é o preço dela que fica gravado
 * em `order_items.unit_price`. Isto aqui existe porque o desconto precisa
 * aparecer ANTES de a pessoa confirmar — um desconto que só se revela no
 * comprovante não fecha carrinho nenhum.
 *
 * São DOIS descontos, e eles se encontram numa ordem que importa:
 *
 *   1. COMBO DE MODELO. Somadas as unidades de um mesmo modelo no carrinho
 *      (misturando sabores), a partir de `comboMinUnits` todas saem pelo
 *      `combo_price` do catálogo. Não depende de quem está comprando: vale
 *      antes de o telefone ser digitado.
 *   2. FIDELIDADE. A cada `cycleUnits` unidades na vida do cliente, UMA sai
 *      pelo `loyalty_price`. Precisa do cadastro, então só entra depois que
 *      o WhatsApp encontra alguém.
 *
 * E as regras que precisam ser idênticas dos dois lados, por isso moram aqui,
 * num lugar só, com teste em volta:
 *
 *   · A POSIÇÃO. As unidades do carrinho ocupam as posições `historyUnits + 1`
 *     até `historyUnits + n` na vida do cliente, e ganha prêmio toda posição
 *     múltipla do ciclo (hoje 6, número que vem do banco — o front não o
 *     conhece).
 *   · A ORDEM. O prêmio cai na unidade mais barata do pedido, e "mais barata"
 *     é o PREÇO BASE, já com o combo aplicado — é o que a pessoa vai pagar.
 *     `product_id` desempata, porque o Postgres também desempata por `pid` e
 *     sem isso dois produtos de preço igual poderiam receber respostas
 *     diferentes.
 *   · NÃO ACUMULA. Na unidade premiada vale o melhor dos dois preços, nunca os
 *     dois juntos: o prêmio só entra se for menor que o preço base. Quando não
 *     é, a unidade fica com o combo e o prêmio NÃO é gasto — passa para o
 *     próximo item, em vez de sumir sem entregar nada.
 *   · O DESCONTO QUE NÃO DESCONTA. Em produto de margem curta o preço premiado
 *     (e o de combo) encosta no preço cheio, porque os dois são travados pelo
 *     custo. Ali não há desconto nenhum e nada é consumido.
 */

export interface DiscountableItem {
  product_id: string;
  brand?: string | null;
  model?: string | null;
  sale_price: number;
  /** Quanto esta unidade custa quando é a premiada. Vem de `get_seller_catalog`. */
  loyalty_price: number;
  /** Quanto esta unidade custa dentro de um combo do modelo. Idem. */
  combo_price?: number;
  quantity: number;
}

export interface DiscountRules {
  /** Unidades do mesmo modelo que ligam o combo. 0 ou ausente ⇒ sem combo. */
  comboMinUnits?: number;
  /** Posição do cliente no ciclo. `null` enquanto o WhatsApp não achou cadastro. */
  loyalty?: { historyUnits: number; cycleUnits: number } | null;
}

export interface DiscountPreview {
  /** O que o cliente paga. */
  total: number;
  /** O que pagaria sem desconto nenhum — o número riscado ao lado. */
  fullTotal: number;
  /** Combo + fidelidade. */
  discountTotal: number;
  discountUnits: number;
  comboTotal: number;
  comboUnits: number;
  loyaltyTotal: number;
  loyaltyUnits: number;
}

/**
 * A chave do modelo — a MESMA normalização do banco
 * (`public.product_model_key`) e do catálogo. Produto sem marca e sem modelo
 * vira um modelo só dele: senão todos os "sem modelo" da loja fariam combo
 * entre si, que é o oposto da regra.
 */
export function modelKey(item: Pick<DiscountableItem, "product_id" | "brand" | "model">) {
  const brand = (item.brand ?? "").trim().toLowerCase();
  const model = (item.model ?? "").trim().toLowerCase();
  if (brand === "" && model === "") return `sem-modelo:${item.product_id}`;
  return `${brand}|||${model}`;
}

const zero = (fullTotal: number): DiscountPreview => ({
  total: fullTotal,
  fullTotal,
  discountTotal: 0,
  discountUnits: 0,
  comboTotal: 0,
  comboUnits: 0,
  loyaltyTotal: 0,
  loyaltyUnits: 0,
});

export function previewCartDiscount(
  items: DiscountableItem[],
  rules: DiscountRules,
): DiscountPreview {
  const fullTotal = items.reduce((acc, i) => acc + i.sale_price * i.quantity, 0);
  const units = items.reduce((acc, i) => acc + i.quantity, 0);
  if (units <= 0) return zero(fullTotal);

  // ---- 1) Preço base: combo ou preço cheio ----
  const minCombo = rules.comboMinUnits ?? 0;
  const porModelo = new Map<string, number>();
  if (minCombo > 0) {
    items.forEach(i => {
      const k = modelKey(i);
      porModelo.set(k, (porModelo.get(k) ?? 0) + i.quantity);
    });
  }

  const base = items.map(item => {
    const noModelo = minCombo > 0 ? porModelo.get(modelKey(item)) ?? 0 : 0;
    // Comparação explícita em vez de `>=` negado: preço ausente (undefined de
    // um catálogo antigo em cache, NaN) cai no "não desconta" em vez de virar
    // um desconto de valor indefinido.
    const temCombo =
      minCombo > 0 &&
      noModelo >= minCombo &&
      typeof item.combo_price === "number" &&
      item.combo_price < item.sale_price;
    return { item, basePrice: temCombo ? (item.combo_price as number) : item.sale_price };
  });

  // ---- 2) Fidelidade, na unidade mais barata do que se vai pagar ----
  const position = rules.loyalty ?? null;
  let restam = 0;
  if (position && position.cycleUnits > 0) {
    restam =
      Math.floor((position.historyUnits + units) / position.cycleUnits) -
      Math.floor(position.historyUnits / position.cycleUnits);
  }

  const ordenado = [...base].sort(
    (a, b) =>
      a.basePrice - b.basePrice ||
      (a.item.product_id < b.item.product_id ? -1 : a.item.product_id > b.item.product_id ? 1 : 0),
  );

  let comboTotal = 0;
  let comboUnits = 0;
  let loyaltyTotal = 0;
  let loyaltyUnits = 0;

  for (const { item, basePrice } of ordenado) {
    let premiadas = 0;
    if (restam > 0 && item.loyalty_price < basePrice) {
      premiadas = Math.min(restam, item.quantity);
      restam -= premiadas;
      loyaltyTotal += (item.sale_price - item.loyalty_price) * premiadas;
      loyaltyUnits += premiadas;
    }
    const noBase = item.quantity - premiadas;
    if (noBase > 0 && basePrice < item.sale_price) {
      comboTotal += (item.sale_price - basePrice) * noBase;
      comboUnits += noBase;
    }
  }

  const discountTotal = comboTotal + loyaltyTotal;
  return {
    total: fullTotal - discountTotal,
    fullTotal,
    discountTotal,
    discountUnits: comboUnits + loyaltyUnits,
    comboTotal,
    comboUnits,
    loyaltyTotal,
    loyaltyUnits,
  };
}
