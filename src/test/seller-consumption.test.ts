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

describe("consumo do período e imputação FIFO", () => {
  const JUL = { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59, 999) };
  const AGO = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999) };

  it("o card é do período; o em aberto continua acumulado", () => {
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("jul", "2026-07-10T12:00:00Z", 120),
        sale("ago", "2026-08-02T12:00:00Z", 130),
      ],
      sellerManualDebts: [],
      sellerDebtPayments: [],
      ...AGO,
    });

    expect(r.periodTotal).toBeCloseTo(130);
    expect(r.openTotal).toBeCloseTo(250);
    expect(r.otherOpen).toBeCloseTo(120);
  });

  it("o pagamento quita do mais antigo para o mais novo", () => {
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("jul", "2026-07-10T12:00:00Z", 100),
        sale("ago", "2026-08-02T12:00:00Z", 100),
      ],
      sellerManualDebts: [],
      sellerDebtPayments: [debt("p1", "2026-08-20T12:00:00Z", 100)],
      ...AGO,
    });

    const jul = r.entries.find(e => e.id === "jul")!;
    const ago = r.entries.find(e => e.id === "ago")!;
    expect(jul.remaining).toBeCloseTo(0);
    expect(ago.remaining).toBeCloseTo(100);
    expect(r.periodOpen).toBeCloseTo(100);
    expect(r.otherOpen).toBeCloseTo(0);
  });

  it("lançamento quitado de outro mês sai da lista; o em aberto fica", () => {
    const r = computeSellerConsumption("s1", {
      sales: [
        sale("junQuitado", "2026-06-10T12:00:00Z", 100),
        sale("julAberto", "2026-07-05T12:00:00Z", 80),
        sale("ago", "2026-08-02T12:00:00Z", 50),
      ],
      sellerManualDebts: [],
      sellerDebtPayments: [debt("p1", "2026-08-20T12:00:00Z", 100)],
      ...AGO,
    });

    expect(r.visible.map(e => e.id)).toEqual(["ago", "julAberto"]);
  });

  it("sem período informado, tudo é do período (compatível com o acumulado)", () => {
    const r = computeSellerConsumption("s1", {
      sales: [sale("a", "2026-07-10T12:00:00Z", 120)],
      sellerManualDebts: [],
      sellerDebtPayments: [],
    });

    expect(r.periodTotal).toBeCloseTo(r.consumoTotal);
    expect(r.otherOpen).toBeCloseTo(0);
  });

  it("dívida manual entra na mesma fila das retiradas", () => {
    const r = computeSellerConsumption("s1", {
      sales: [sale("retJul", "2026-07-20T12:00:00Z", 60)],
      sellerManualDebts: [debt("divJul", "2026-07-10T12:00:00Z", 40)],
      sellerDebtPayments: [debt("p1", "2026-07-25T12:00:00Z", 40)],
      ...JUL,
    });

    // a dívida é mais velha, então é ela que o pagamento quita
    expect(r.entries.find(e => e.id === "divJul")!.remaining).toBeCloseTo(0);
    expect(r.entries.find(e => e.id === "retJul")!.remaining).toBeCloseTo(60);
    expect(r.periodTotal).toBeCloseTo(100);
    expect(r.openTotal).toBeCloseTo(60);
  });
});
