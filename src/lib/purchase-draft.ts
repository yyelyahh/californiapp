/**
 * A compra montada a partir do "Repor agora".
 *
 * O card do Dashboard diz o que pedir; antes dele, pedir era redigitar a
 * tabela no "Nova compra" da Entrada, modelo por modelo. Agora o botão do card
 * leva a lista junto, e o painel abre preenchido — para CONFERIR, não para
 * gravar sozinho: quantidade e custo são sugestão, e quem manda é quem fala com
 * o fornecedor.
 *
 * Vai pelo estado do router (e não pelo endereço) porque é uma lista de até
 * dezenas de linhas que só faz sentido uma vez: o painel consome e apaga, senão
 * voltar para a Entrada pelo histórico abriria a mesma compra de novo.
 */

export interface PurchaseDraftItem {
  brand: string;
  model: string;
  quantity: number;
  /** Custo unitário sugerido. Ausente quando o modelo não tem custo conhecido. */
  unitPrice?: number;
}

/** A chave no `location.state`. */
export const PURCHASE_DRAFT_KEY = "purchaseDraft";

/**
 * Teto do que se aceita do estado. É o mesmo número do lote da transferência:
 * compra de reposição passando disso é sinal de estado estranho, não de pedido.
 */
export const PURCHASE_DRAFT_MAX = 60;

/**
 * Da reposição para a compra. O que entra é o que o card manda PEDIR
 * (`restockUnits`, já descontado o que está a caminho), com o custo médio do
 * modelo — o mesmo `unitCost` que dá o "a custo" do rodapé do card, então a
 * compra montada fecha com o número que a pessoa acabou de ler (a menos de
 * centavos, porque o custo vai arredondado ao centavo, que é o que o campo
 * aceita).
 *
 * Todos os modelos que precisam de pedido, não só os seis da tabela: o card
 * mostra os maiores e conta o resto no rodapé; a compra é a lista inteira.
 */
export function restockToPurchaseDraft(
  models: { brand: string; model: string; restockUnits: number; unitCost: number }[],
): PurchaseDraftItem[] {
  return models
    .filter(m => m.restockUnits > 0)
    .map(m => ({
      brand: m.brand,
      model: m.model,
      quantity: Math.ceil(m.restockUnits),
      unitPrice: m.unitCost > 0 ? Math.round(m.unitCost * 100) / 100 : undefined,
    }));
}

/**
 * Lê o rascunho do `location.state`, que pode ser qualquer coisa (o histórico
 * do navegador guarda o estado de outras versões do app). Linha malformada sai;
 * se não sobrar nada, não há rascunho.
 */
export function readPurchaseDraft(state: unknown): PurchaseDraftItem[] | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>)[PURCHASE_DRAFT_KEY];
  if (!Array.isArray(raw)) return null;
  const items = raw
    .slice(0, PURCHASE_DRAFT_MAX)
    .filter((it): it is PurchaseDraftItem => {
      if (!it || typeof it !== "object") return false;
      const o = it as Record<string, unknown>;
      return typeof o.brand === "string" && o.brand.trim() !== ""
        && typeof o.model === "string" && o.model.trim() !== ""
        && typeof o.quantity === "number" && Number.isFinite(o.quantity) && o.quantity > 0
        && (o.unitPrice === undefined || (typeof o.unitPrice === "number" && Number.isFinite(o.unitPrice) && o.unitPrice >= 0));
    });
  return items.length > 0 ? items : null;
}
