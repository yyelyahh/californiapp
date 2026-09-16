import type { Product, ProductAssignment } from "@/types";

/**
 * De quem é o estoque que a tela de Produtos está mostrando.
 *
 * O modelo é de SUBCONJUNTO, e é isso que dá sentido à lente:
 * `product_branch.stock` é tudo o que a cidade tem, INCLUSIVE o que já está na
 * mão dos vendedores, e `product_assignments` é a parte de cada um. Somar as
 * duas coisas contaria a mesma unidade duas vezes — por isso a casa é uma
 * SUBTRAÇÃO, não uma coluna própria no banco.
 *
 * A tela mostrava só o total, e o total não responde "o que ainda está aqui?"
 * nem "o que está com o Fulano?", que são as duas perguntas de quem vai
 * separar mercadoria.
 */
export const LENS_GERAL = "geral";
export const LENS_CASA = "casa";

/** `geral`, `casa`, ou o id de um vendedor. */
export type StockLens = string;

/**
 * A mesma lista de produtos, com `stock` trocado pelo que a lente enxerga.
 *
 * Troca o campo em vez de devolver um mapa à parte porque TUDO na tela pende
 * dele — a linha do sabor, o total do modelo, o valor a custo, a contagem de
 * zerados, o filtro "mostrar zerados". Um mapa paralelo obrigaria a lembrar de
 * cada um desses lugares, e o esquecido mostraria o número da cidade no meio
 * dos números do vendedor.
 *
 * ATENÇÃO: o que sai daqui é para LER. Escrever a partir desta cópia gravaria
 * a conta do vendedor no estoque da filial — quem edita ou exclui resolve o
 * produto de verdade pelo id.
 *
 * A casa pode sair NEGATIVA se a soma das atribuições passar do estoque. Não é
 * arredondado para zero de propósito: hoje o gatilho
 * `validate_assignment_fits_stock` impede que isso cresça, mas linha antiga
 * pode estar furada, e um número negativo na tela é como isso aparece para
 * alguém — esconder seria deixar a conta errada sem sintoma.
 */
export function lensStock(
  lens: StockLens,
  products: Product[],
  assignments: ProductAssignment[],
): Product[] {
  if (lens === LENS_GERAL) return products;

  const assigned = new Map<string, number>();
  for (const a of assignments) {
    // A UNIQUE (seller_id, product_id) garante uma linha por par, mas somar é
    // o que faz a casa continuar certa se um dia houver duas.
    if (lens === LENS_CASA || a.sellerId === lens) {
      assigned.set(a.productId, (assigned.get(a.productId) ?? 0) + a.quantity);
    }
  }

  return products.map(p => {
    const held = assigned.get(p.id) ?? 0;
    return { ...p, stock: lens === LENS_CASA ? p.stock - held : held };
  });
}
