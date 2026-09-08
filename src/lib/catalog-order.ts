/**
 * Ordem de leitura do catálogo: 1º marca, 2º modelo, 3º sabor.
 *
 * O banco devolve produto em ordem de `created_at`, que é a ordem em que
 * alguém cadastrou — para quem está com o celular na mão registrando venda ou
 * atribuindo estoque, isso é ordem nenhuma. Toda caixa de seleção, lista e
 * agrupamento que não é cronológico passa por aqui.
 *
 * `sensitivity: "base"` porque marca e modelo são digitados à mão e vêm com
 * maiúscula e acento trocados — sem isso o `.sort()` cru joga "elfbar" depois
 * de "Zomo" (ordena por código do caractere) e "Ígnite" para o fim da lista.
 *
 * `numeric: true` porque modelo termina em número: sem ele "V150" vem antes de
 * "V90", que não é a ordem em que a pessoa procura na caixa.
 */
export const catalogCollator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export const compareText = (a?: string | null, b?: string | null) =>
  catalogCollator.compare(a ?? "", b ?? "");

/** O mínimo que este módulo precisa de um produto — serve para `Product` e para os enriquecidos. */
export type CatalogLike = {
  brand?: string | null;
  model?: string | null;
  flavor?: string | null;
};

export function compareCatalog(a: CatalogLike, b: CatalogLike) {
  return (
    compareText(a.brand, b.brand) ||
    compareText(a.model, b.model) ||
    compareText(a.flavor, b.flavor)
  );
}

/** Cópia ordenada — nunca ordena no lugar: a lista costuma vir do estado do React. */
export const sortCatalog = <T extends CatalogLike>(list: readonly T[]): T[] =>
  [...list].sort(compareCatalog);

/** Lista de marcas ou de modelos (strings soltas, vindas de um Set). */
export const sortNames = (list: readonly string[]): string[] => [...list].sort(compareText);

/** Qualquer coisa com nome próprio: vendedor, cliente, parceiro. */
export const sortByName = <T extends { name?: string | null }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => compareText(a.name, b.name));
