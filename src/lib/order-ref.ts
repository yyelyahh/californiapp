/**
 * A referência curta do pedido do catálogo.
 *
 * O `confirm_order` grava a nota da venda como "Pedido via catálogo #<uuid>",
 * com o id inteiro. Ninguém lê um uuid em voz alta: o que a loja manda na
 * mensagem de WhatsApp e o que o vendedor vê no card são os oito primeiros
 * caracteres dele — prefixo do que já está gravado, então os dois lados
 * continuam falando do mesmo pedido sem inventar um segundo número.
 *
 * Mora aqui, e não em cada tela, porque aparece em três: a loja
 * (SellerStorePage), o card do vendedor (SellerSalesPage) e a lista do admin
 * (SalesPage). Referência que se escreve diferente em cada lugar deixa de
 * servir para casar uma coisa com a outra.
 */
export function orderRef(orderId: string | null | undefined) {
  const clean = (orderId ?? "").replace(/-/g, "");
  return clean ? `#${clean.slice(0, 8).toUpperCase()}` : "";
}
