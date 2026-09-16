import { describe, it, expect } from "vitest";
import { groupTransfers, transferTotals } from "@/lib/transfer-groups";
import type { StockTransfer } from "@/types";

/**
 * O histórico de transferências lê uma linha POR SABOR e mostra uma linha POR
 * VIAGEM. Quem junta é o `batch_id` — e linha antiga não tem nenhum, então o
 * agrupamento não pode depender dele existir: antes do lote cada linha JÁ era
 * uma operação de um item só.
 */

const row = (t: Partial<StockTransfer> & { id: string }): StockTransfer => ({
  productId: "p1",
  fromBranchId: "A",
  toBranchId: "B",
  quantity: 1,
  unitCost: 10,
  date: "2026-09-16T00:00:00Z",
  createdAt: "2026-09-16T00:00:00Z",
  ...t,
});

describe("groupTransfers", () => {
  it("junta as linhas do mesmo lote numa operação só", () => {
    const days = groupTransfers(
      [
        row({ id: "1", batchId: "lote", quantity: 4, productId: "p1" }),
        row({ id: "2", batchId: "lote", quantity: 6, productId: "p2" }),
      ],
      "A",
    );
    expect(days).toHaveLength(1);
    expect(days[0].operations).toHaveLength(1);
    expect(days[0].operations[0].units).toBe(10);
    expect(days[0].operations[0].items).toHaveLength(2);
  });

  it("linha sem lote é uma operação de um item", () => {
    // As transferências anteriores à migration do lote. Se elas caíssem todas
    // num grupo "sem lote", viagens de dias e destinos diferentes apareceriam
    // como uma só.
    const days = groupTransfers(
      [row({ id: "1", quantity: 2 }), row({ id: "2", quantity: 3 })],
      "A",
    );
    expect(days[0].operations).toHaveLength(2);
  });

  it("guarda as origens da operação: a casa e cada vendedor", () => {
    const days = groupTransfers(
      [
        row({ id: "1", batchId: "lote" }),
        row({ id: "2", batchId: "lote", fromSellerId: "s1" }),
        row({ id: "3", batchId: "lote", fromSellerId: "s1" }),
      ],
      "A",
    );
    const op = days[0].operations[0];
    expect(op.fromHouse).toBe(true);
    expect(op.fromSellerIds).toEqual(["s1"]);
  });

  it("saiu e chegou dependem da filial de referência", () => {
    const rows = [
      row({ id: "1", quantity: 5, fromBranchId: "A", toBranchId: "B" }),
      row({ id: "2", quantity: 2, fromBranchId: "B", toBranchId: "A" }),
    ];
    expect(groupTransfers(rows, "A")[0]).toMatchObject({ out: 5, in: 2 });
    expect(groupTransfers(rows, "B")[0]).toMatchObject({ out: 2, in: 5 });
  });

  it("em Todas as filiais não soma nenhuma ponta", () => {
    // A mesma caixa é saída de um lado e entrada do outro: somar as duas
    // contaria a viagem duas vezes.
    const days = groupTransfers([row({ id: "1", quantity: 5 })], null);
    expect(days[0]).toMatchObject({ out: 0, in: 0 });
  });

  it("os dias descem do mais recente para o mais antigo", () => {
    const days = groupTransfers(
      [
        row({ id: "1", date: "2026-09-10T00:00:00Z" }),
        row({ id: "2", date: "2026-09-16T00:00:00Z" }),
      ],
      "A",
    );
    expect(days.map(d => d.dateKey)).toEqual(["2026-09-16", "2026-09-10"]);
  });
});

describe("transferTotals", () => {
  it("conta operações, não linhas", () => {
    const t = transferTotals(
      [
        row({ id: "1", batchId: "lote", quantity: 4 }),
        row({ id: "2", batchId: "lote", quantity: 6 }),
        row({ id: "3", quantity: 1 }),
      ],
      "A",
    );
    expect(t).toEqual({ out: 11, in: 0, operations: 2 });
  });
});
