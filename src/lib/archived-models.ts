import type { ArchivedModel } from "@/types";
import type { ModelStat } from "@/lib/restock";

/**
 * Modelos arquivados: quem some das listas de escolha, e quem devia sumir.
 *
 * Arquivar é por MARCA + MODELO e por FILIAL. Aqui mora só a leitura — o que
 * está escondido agora e o que é candidato a ser — porque é lógica que se testa
 * sem montar tela. A escrita passa pelo StoreContext, e a regra do estoque zero
 * mora no banco.
 */

/** Sem venda há mais que isso (e sem estoque) = candidato a sair de linha. */
export const DISUSE_DAYS = 90;

/**
 * A chave de um modelo. Normalizada do mesmo jeito que o banco normaliza, senão
 * o que a tela esconde e o que o banco guardou seriam conjuntos diferentes.
 */
export const modelArchiveKey = (brand: string, model: string) =>
  `${(brand || "").trim().toLowerCase()}|${(model || "").trim().toLowerCase()}`;

/**
 * Os modelos escondidos na filial de referência.
 *
 * Com uma filial escolhida é o que ela arquivou, e só. Em "Todas as filiais"
 * (`branchId` nulo) a tela mostra a SOMA das cidades, e por isso um modelo só
 * some quando TODAS o arquivaram: escondê-lo por causa de uma cidade apagaria
 * da lista consolidada o estoque que a outra ainda vende.
 */
export function hiddenModelKeys(
  rows: ArchivedModel[],
  branchId: string | null,
  branchIds: string[],
): Set<string> {
  if (branchId) {
    return new Set(rows.filter(r => r.branchId === branchId).map(r => modelArchiveKey(r.brand, r.model)));
  }
  // Sem filial alcançável não há o que esconder — e dividir por esse conjunto
  // vazio esconderia tudo.
  if (branchIds.length === 0) return new Set();

  const reach = new Set(branchIds);
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!reach.has(r.branchId)) continue;
    const key = modelArchiveKey(r.brand, r.model);
    const set = byKey.get(key) ?? new Set<string>();
    set.add(r.branchId);
    byKey.set(key, set);
  }
  const hidden = new Set<string>();
  for (const [key, branches] of byKey) {
    if (branches.size >= reach.size) hidden.add(key);
  }
  return hidden;
}

/**
 * Esconder um produto é a interseção de duas coisas: o modelo está arquivado E
 * não sobrou unidade nenhuma.
 *
 * O estoque entra aqui, e não só no banco, porque as duas pontas se movem em
 * tempos diferentes: o gatilho recusa ARQUIVAR com estoque, mas nada impede uma
 * compra de chegar depois. Unidade que existe tem que ter como sair da tela —
 * ela aparece de volta na lista, com o modelo ainda marcado como arquivado, e a
 * pessoa decide.
 */
export function isProductHidden(
  product: { brand: string; model: string; stock: number },
  hidden: Set<string>,
) {
  return product.stock <= 0 && hidden.has(modelArchiveKey(product.brand, product.model));
}

/**
 * Os candidatos a arquivar: sem estoque e sem venda há muito tempo.
 *
 * Reaproveita o `ModelStat` do "Repor agora" — `stock` e `daysSinceLastSale` já
 * saem de lá, e duas contas de "há quanto tempo esse modelo não sai" seriam
 * duas respostas diferentes para a mesma pergunta. Quem nunca vendeu vem
 * primeiro (`Infinity`), depois o mais antigo.
 */
export function disuseCandidates(
  stats: ModelStat[],
  hidden: Set<string>,
  minDays = DISUSE_DAYS,
): ModelStat[] {
  return stats
    .filter(s =>
      s.stock <= 0 &&
      s.daysSinceLastSale > minDays &&
      !hidden.has(modelArchiveKey(s.brand, s.model)),
    )
    .sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale || a.model.localeCompare(b.model));
}
