import { describe, it, expect } from "vitest";
import { numberPurchaseOrders, type UnnumberedOrder } from "@/lib/purchase-order-number";

/**
 * "Compra #N" é posição na fila, não identidade. O que se testa aqui é o que a
 * identity do Postgres não entregava: o número acompanha a ORDEM em que as
 * compras foram feitas, e some junto com a compra excluída em vez de deixar um
 * buraco na contagem.
 */

const order = (id: string, date: string, createdAt = `${date}T12:00:00.000Z`): UnnumberedOrder => ({
  id,
  status: "pending",
  date,
  paidAmount: 0,
  freightCost: 0,
  createdAt,
  items: [],
});

/** O que a tela lê: a lista já vem na ordem de exibição, com o número junto. */
const shown = (rows: UnnumberedOrder[]) => numberPurchaseOrders(rows).map(o => [o.id, o.number]);

describe("numberPurchaseOrders", () => {
  it("numera pela ordem em que as compras foram feitas, não pela de chegada", () => {
    // A "c" foi lançada por último, mas com a data mais antiga: ela é a #1.
    expect(shown([order("b", "2026-08-20"), order("a", "2026-08-25"), order("c", "2026-08-10")]))
      .toEqual([["a", 3], ["b", 2], ["c", 1]]);
  });

  it("devolve na ordem da tela: mais recente primeiro, número descendo", () => {
    const nums = numberPurchaseOrders([
      order("a", "2026-08-10"),
      order("b", "2026-08-20"),
      order("c", "2026-08-30"),
    ]).map(o => o.number);
    expect(nums).toEqual([3, 2, 1]);
  });

  it("renumera quando a primeira é excluída — a #2 vira #1", () => {
    const rows = [order("a", "2026-08-10"), order("b", "2026-08-20"), order("c", "2026-08-30")];
    expect(shown(rows)).toEqual([["c", 3], ["b", 2], ["a", 1]]);

    const semA = rows.filter(o => o.id !== "a");
    expect(shown(semA)).toEqual([["c", 2], ["b", 1]]);
  });

  it("não deixa buraco ao excluir do meio", () => {
    const rows = [order("a", "2026-08-10"), order("b", "2026-08-20"), order("c", "2026-08-30")];
    expect(shown(rows.filter(o => o.id !== "b"))).toEqual([["c", 2], ["a", 1]]);
  });

  it("no mesmo dia, quem foi registrado antes leva o número menor", () => {
    expect(shown([
      order("tarde", "2026-08-10", "2026-08-10T18:00:00.000Z"),
      order("manha", "2026-08-10", "2026-08-10T09:00:00.000Z"),
    ])).toEqual([["tarde", 2], ["manha", 1]]);
  });

  it("empate total ainda é estável: o id desempata, e não a ordem de chegada do array", () => {
    const mesmoInstante = [
      order("z", "2026-08-10", "2026-08-10T09:00:00.000Z"),
      order("a", "2026-08-10", "2026-08-10T09:00:00.000Z"),
    ];
    expect(shown(mesmoInstante)).toEqual([["z", 2], ["a", 1]]);
    expect(shown([...mesmoInstante].reverse())).toEqual([["z", 2], ["a", 1]]);
  });

  it("não mexe no array recebido", () => {
    const rows = [order("b", "2026-08-30"), order("a", "2026-08-10")];
    numberPurchaseOrders(rows);
    expect(rows.map(o => o.id)).toEqual(["b", "a"]);
  });

  it("lista vazia não é caso especial", () => {
    expect(numberPurchaseOrders([])).toEqual([]);
  });
});
