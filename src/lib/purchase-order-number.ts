import type { PurchaseOrder } from "@/types";

/**
 * A compra sai do banco SEM número: ele é a posição dela na fila, calculado a
 * cada leitura. Tipar assim é o que impede alguém de voltar a ler
 * `purchase_orders.number` por engano.
 */
export type UnnumberedOrder = Omit<PurchaseOrder, "number">;

/** Ordem em que as compras foram FEITAS: data, com created_at desempatando. */
export const byPurchaseAge = (a: UnnumberedOrder, b: UnnumberedOrder) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * "Compra #N" é POSIÇÃO, não identidade. `purchase_orders.number` é uma
 * identity do Postgres: só cresce e nunca reaproveita — apagar a #1 deixava a
 * #2 se chamando #2 para sempre, e um lançamento feito hoje com data da semana
 * passada aparecia com o número mais alto da lista. Aqui o número nasce da
 * ordem em que as compras foram feitas e é refeito a cada leitura: excluir
 * renumera o resto sozinho, sem uma escrita sequer.
 *
 * Renumerar no banco foi descartado de propósito: `purchase_orders` é auditada
 * (migration 20260914181553), então cada exclusão viraria N linhas de "alterou
 * uma compra" no log — e o número continuaria tão instável quanto este.
 *
 * Devolve na ordem da TELA (mais recente primeiro), para o número descer junto
 * com a lista em vez de pular.
 */
export const numberPurchaseOrders = (rows: UnnumberedOrder[]): PurchaseOrder[] =>
  [...rows]
    .sort(byPurchaseAge)
    .map((o, i) => ({ ...o, number: i + 1 }))
    .reverse();
