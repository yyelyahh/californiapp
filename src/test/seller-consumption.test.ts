import { describe, it, expect } from "vitest";
import { computeSellerConsumption, PROJECT_START } from "@/lib/commissions";
import type { Sale } from "@/types";

const sale = (
  id: string, date: string, total: number,
  type: Sale["type"] = "retirada_funcionario", sellerId = "s1",
): Sale => ({
  id, productId: "p", quantity: 1, unitPrice: total, totalPrice: total,
  date, installments: 1, paidAmount: type === "venda" ? total : 0, type, sellerId,
});

const debt = (id: string, date: string, amount: number, sellerId = "s1") =>
  ({ id, sellerId, amount, date });

describe("consumo acumulado do vendedor", () => {
  it("soma retiradas e dívidas manuais e desconta os pagamentos", () => {
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("a", "2026-07-10T12:00:00Z", 120),
        sale("b", "2026-08-02T12:00:00Z", 130),
      ],
      sellerManualDebts: [debt("d1", "2026-08-05T12:00:00Z", 50)],
      sellerDebtPayments: [debt("p1", "2026-08-20T12:00:00Z", 100)],
    });

    expect(r.retiradasTotal).toBeCloseTo(250);
    expect(r.manualDebtsTotal).toBeCloseTo(50);
    expect(r.debtPaymentsTotal).toBeCloseTo(100);
    expect(r.consumoTotal).toBeCloseTo(300);
    expect(r.openTotal).toBeCloseTo(200);
  });

  it("ignora vendas normais, outro vendedor e o que é anterior ao início do histórico", () => {
    const antes = new Date(PROJECT_START.getTime() - 86400000).toISOString();
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("venda", "2026-07-10T12:00:00Z", 500, "venda"),
        sale("outro", "2026-07-10T12:00:00Z", 300, "retirada_funcionario", "s2"),
        sale("legado", antes, 400),
        sale("ok", "2026-07-15T12:00:00Z", 120),
      ],
      sellerManualDebts: [
        debt("outro", "2026-07-20T12:00:00Z", 90, "s2"),
        debt("legado", antes, 70),
      ],
      sellerDebtPayments: [debt("outro", "2026-07-25T12:00:00Z", 60, "s2")],
    });

    expect(r.retiradas.map(s => s.id)).toEqual(["ok"]);
    expect(r.retiradasTotal).toBeCloseTo(120);
    expect(r.manualDebtsTotal).toBe(0);
    expect(r.debtPaymentsTotal).toBe(0);
    expect(r.openTotal).toBeCloseTo(120);
  });

  it("lista as retiradas da mais recente para a mais antiga", () => {
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("antiga", "2026-07-01T12:00:00Z", 100),
        sale("recente", "2026-09-01T12:00:00Z", 100),
        sale("meio", "2026-08-01T12:00:00Z", 100),
      ],
      sellerManualDebts: [],
      sellerDebtPayments: [],
    });

    expect(r.retiradas.map(s => s.id)).toEqual(["recente", "meio", "antiga"]);
  });

  it("saldo fica negativo quando o vendedor pagou mais do que consumiu", () => {
    const r = computeSellerConsumption("s1", {
      sales: [sale("a", "2026-07-10T12:00:00Z", 100)],
      sellerManualDebts: [],
      sellerDebtPayments: [debt("p1", "2026-07-20T12:00:00Z", 150)],
    });

    expect(r.openTotal).toBeCloseTo(-50);
  });
});
