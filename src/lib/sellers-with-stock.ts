/**
 * Quem pode aparecer no seletor de vendedor de um formulário de venda.
 *
 * A venda registrada pelo admin sai SEMPRE da caixa de um vendedor: o seletor
 * de produto, nos dois formulários (o único e o em lote), lê
 * `product_assignments` e não o estoque da filial. Vendedor sem atribuição
 * portanto não tem o que vender, e escolhê-lo levava a um seletor de produto
 * vazio dizendo "Nenhum produto atribuído a este vendedor" — um beco que a
 * lista anterior podia ter evitado.
 *
 * A conta é o modelo de SUBCONJUNTO de sempre, lido do lado do vendedor:
 * `product_branch.stock` é tudo o que a cidade tem, INCLUSIVE o que está com os
 * vendedores, e `product_assignments` é a parte de cada um. Quem tem parte
 * maior que zero em algum sabor tem o que vender.
 *
 * Mora aqui, e não dentro de uma das duas telas, porque as duas fazem a MESMA
 * pergunta: se a regra morasse na SalesPage, o formulário em lote continuaria
 * oferecendo vendedor de caixa vazia, e os dois caminhos de registro de venda
 * divergiriam — o mesmo motivo pelo qual confirmar e recusar pedido moram num
 * hook só.
 */

/** O bastante de uma atribuição para esta conta. */
export interface AssignmentLike {
  sellerId: string;
  quantity: number;
}

/**
 * Filtra a lista de vendedores, preservando a ordem e o tipo de quem chama.
 *
 * `keepSellerId` é o vendedor JÁ ESCOLHIDO, e ele entra na lista mesmo de caixa
 * vazia. Sem isso, abrir a edição de uma venda antiga de alguém que zerou a
 * caixa mostraria o campo em branco, como se ninguém tivesse vendido: o
 * formulário precisa saber dizer o que está GRAVADO, não só o que ainda é
 * escolhível. Vale também para quem acabou de vender a última unidade e ainda
 * está com o formulário aberto — a lista não pode puxar o tapete no meio do
 * preenchimento.
 *
 * Quantidade negativa não entra: ela existe (linha anterior ao gatilho
 * `validate_assignment_fits_stock`) e não é estoque que se possa vender.
 */
export function sellersWithAssignedStock<T extends { id: string }>(
  sellers: T[],
  assignments: AssignmentLike[],
  keepSellerId?: string | null,
): T[] {
  const stocked = new Set<string>();
  for (const a of assignments) {
    if (a.quantity > 0) stocked.add(a.sellerId);
  }
  return sellers.filter(s => stocked.has(s.id) || (!!keepSellerId && s.id === keepSellerId));
}
