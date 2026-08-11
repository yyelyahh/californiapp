import { describe, it, expect } from "vitest";
import { computePriorCommissionBalance } from "@/lib/commissions";
import type { Sale } from "@/types";

const sale = (id: string, date: string, qty: number, total: number, type: Sale["type"] = "venda"): Sale => ({
  id, productId: "p", quantity: qty, unitPrice: total / qty, totalPrice: total,
  date, installments: 1, paidAmount: total, type, sellerId: "s1",
});

const H = new Date(2026, 5, 1);

describe("saldo acumulado de comissão", () => {
  it("acumula comissão, consumo e pagamentos do histórico", () => {
    // 5000 em jun com faixa 10% (10 un) => 500
    const sales = [sale("a", "2026-06-10T12:00:00Z", 10, 5000)];
    const prior = computePriorCommissionBalance({
      sellerId: "s1", sales, commissionPayments: [], debtPayments: [], manualDebts: [],
      historyStart: H, periodStart: new Date(2026, 6, 1),
    });
    expect(prior).toBeCloseTo(500);
  });

  it("desconta consumo e comissão paga sem contar duas vezes", () => {
    const sales = [
      sale("a", "2026-06-10T12:00:00Z", 10, 5000),
      sale("b", "2026-07-10T12:00:00Z", 10, 5000),
      sale("c", "2026-07-15T12:00:00Z", 1, 250, "retirada_funcionario"),
    ];
    const base = { sellerId: "s1", sales, commissionPayments: [], debtPayments: [], manualDebts: [], historyStart: H };
    // saldo anterior a agosto = 500 + 500 - 250 = 750
    expect(computePriorCommissionBalance({ ...base, periodStart: new Date(2026, 7, 1) })).toBeCloseTo(750);
    // com pagamento de 400 em julho => 350
    expect(computePriorCommissionBalance({
      ...base, commissionPayments: [{ sellerId: "s1", amount: 400, date: "2026-07-20T12:00:00Z" }],
      periodStart: new Date(2026, 7, 1),
    })).toBeCloseTo(350);
    // consultar julho não pode recontar julho
    expect(computePriorCommissionBalance({ ...base, periodStart: new Date(2026, 6, 1) })).toBeCloseTo(500);
  });

  it("exemplo: 100 anterior + 500 gerada - 250 consumo = 350", () => {
    const sales = [
      sale("z", "2026-06-01T12:00:00Z", 1, 1000), // 100 em junho
      sale("a", "2026-07-10T12:00:00Z", 10, 5000), // 500 em julho
      sale("c", "2026-07-15T12:00:00Z", 1, 250, "retirada_funcionario"),
    ];
    expect(computePriorCommissionBalance({
      sellerId: "s1", sales, commissionPayments: [], debtPayments: [], manualDebts: [],
      historyStart: H, periodStart: new Date(2026, 7, 1),
    })).toBeCloseTo(350);
  });
});
