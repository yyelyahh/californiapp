import { describe, it, expect } from "vitest";
import { computePeriodResult, type PeriodResultInput } from "@/lib/period-result";
import type { Sale } from "@/types";

const sale = (id: string, over: Partial<Sale> = {}): Sale => ({
  id, productId: "p1", quantity: 1, unitPrice: 150, totalPrice: 150,
  date: "2026-09-10T12:00:00", installments: 1, paidAmount: 150, type: "venda",
  ...over,
});

const base = (over: Partial<PeriodResultInput> = {}): PeriodResultInput => ({
  sales: [], expenses: [],
  costOf: () => 68,
  inPeriod: (iso) => iso.startsWith("2026-09"),
  ...over,
});

describe("computePeriodResult", () => {
  it("lucro = recebido − CPV − despesas", () => {
    const r = computePeriodResult(base({
      sales: [sale("v1"), sale("v2")],
      expenses: [{ id: "e1", description: "frete", category: "Frete", amount: 20, date: "2026-09-02T12:00:00" }],
    }));
    expect(r.revenue).toBe(300);
    expect(r.cogs).toBe(136);
    expect(r.netProfit).toBe(300 - 136 - 20);
  });

  it("lucro e margem são do RECEBIDO: venda em aberto não dá lucro nem custo", () => {
    const r = computePeriodResult(base({
      sales: [
        sale("paga"),
        sale("aberta", { paidAmount: 0 }),
        sale("metade", { paidAmount: 75 }),
      ],
    }));
    expect(r.revenue).toBe(450);
    expect(r.received).toBe(225);
    // 68 inteiro da paga + 34 da metade; a aberta não entra.
    expect(r.cogs).toBe(102);
    expect(r.grossProfit).toBe(123);
    expect(r.netMargin).toBeCloseTo((123 / 225) * 100);
  });

  it("venda de valor zero conta o custo inteiro", () => {
    const r = computePeriodResult(base({ sales: [sale("brinde", { totalPrice: 0, unitPrice: 0, paidAmount: 0 })] }));
    expect(r.cogs).toBe(68);
    expect(r.netMargin).toBe(0);
  });

  it("o CPV usa o custo da VENDA (congelado), não um custo único do produto", () => {
    const r = computePeriodResult(base({
      sales: [sale("antiga"), sale("nova")],
      costOf: s => (s.id === "antiga" ? 60 : 75),
    }));
    expect(r.cogs).toBe(135);
  });

  it("retirada de vendedor não mexe no lucro: ela sai como comissão, na Distribuição", () => {
    const r = computePeriodResult(base({
      sales: [sale("r1", { type: "retirada_funcionario", paidAmount: 0 })],
    }));
    expect(r.revenue).toBe(0);
    expect(r.cogs).toBe(0);
    expect(r.netProfit).toBe(0);
  });

  it("fora do período não entra", () => {
    const r = computePeriodResult(base({
      sales: [sale("ago", { date: "2026-08-31T12:00:00" })],
      expenses: [{ id: "e1", description: "frete", category: "Frete", amount: 20, date: "2026-08-31T12:00:00" }],
    }));
    expect(r.revenue).toBe(0);
    expect(r.expenses).toBe(0);
  });
});
