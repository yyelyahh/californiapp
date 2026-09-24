import { describe, it, expect } from "vitest";
import { computePeriodResult, type PeriodResultInput } from "@/lib/period-result";
import type { Sale } from "@/types";

const sale = (id: string, over: Partial<Sale> = {}): Sale => ({
  id, productId: "p1", quantity: 1, unitPrice: 150, totalPrice: 150,
  date: "2026-09-10T12:00:00", installments: 1, paidAmount: 150, type: "venda",
  ...over,
});

const base = (over: Partial<PeriodResultInput> = {}): PeriodResultInput => ({
  sales: [], expenses: [], stockLosses: [], commissionPayments: [], sellerDebtPayments: [],
  costOf: () => 68,
  inPeriod: (iso) => iso.startsWith("2026-09"),
  ...over,
});

describe("computePeriodResult", () => {
  it("lucro = receita − CPV − despesas − perdas − custo dos vendedores", () => {
    const r = computePeriodResult(base({
      sales: [sale("v1"), sale("v2")],
      expenses: [{ id: "e1", description: "frete", category: "Frete", amount: 20, date: "2026-09-02T12:00:00" }],
      stockLosses: [{ id: "l1", productId: "p1", quantity: 1, unitCost: 68, totalCost: 68, date: "2026-09-03T12:00:00" }],
      commissionPayments: [{ amount: 30, date: "2026-09-20T12:00:00" }],
    }));
    expect(r.revenue).toBe(300);
    expect(r.cogs).toBe(136);
    expect(r.netProfit).toBe(300 - 136 - 20 - 68 - 30);
  });

  it("o CPV usa o custo da VENDA (congelado), não um custo único do produto", () => {
    const r = computePeriodResult(base({
      sales: [sale("antiga"), sale("nova")],
      costOf: s => (s.id === "antiga" ? 60 : 75),
    }));
    expect(r.cogs).toBe(135);
  });

  it("retirada é comissão paga em mercadoria: custa o custo da unidade, não entra na receita", () => {
    const r = computePeriodResult(base({
      sales: [sale("r1", { type: "retirada_funcionario", paidAmount: 0 })],
    }));
    expect(r.revenue).toBe(0);
    expect(r.consumptionCost).toBe(68);
    expect(r.netProfit).toBe(-68);
  });

  it("dívida de vendedor recebida em dinheiro abate o custo dos vendedores", () => {
    const r = computePeriodResult(base({
      sales: [sale("r1", { type: "retirada_funcionario", paidAmount: 0 })],
      sellerDebtPayments: [{ amount: 150, date: "2026-09-15T12:00:00" }],
    }));
    // Vendeu ao vendedor por 150 o que custou 68.
    expect(r.netProfit).toBe(82);
  });

  it("fora do período não entra", () => {
    const r = computePeriodResult(base({
      sales: [sale("ago", { date: "2026-08-31T12:00:00" })],
      commissionPayments: [{ amount: 30, date: "2026-08-31T12:00:00" }],
    }));
    expect(r.revenue).toBe(0);
    expect(r.sellerCost).toBe(0);
  });
});
