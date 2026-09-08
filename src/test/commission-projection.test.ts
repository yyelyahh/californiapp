import { describe, it, expect } from "vitest";
import { computeSellerBalance, PROJECT_START } from "@/lib/commissions";
import type { Sale, Seller } from "@/types";

const seller: Seller = { id: "s1", name: "Vendedora", debtPercentage: 0, createdAt: "2026-06-01" };

const sale = (id: string, date: string, qty: number, total: number, paid: number): Sale => ({
  id, productId: "p", quantity: qty, unitPrice: total / qty, totalPrice: total,
  date, installments: 1, paidAmount: paid, type: "venda", sellerId: "s1",
});

const AGO_START = new Date(2026, 7, 1);
const AGO_END = new Date(2026, 7, 31, 23, 59, 59, 999);

const ctxFor = (sales: Sale[]) => ({
  sales,
  commissionPayments: [],
  sellerDebtPayments: [],
  sellerManualDebts: [],
  start: AGO_START,
  end: AGO_END,
  closedStart: AGO_START,
  PROJECT_START,
  isLegacy: (iso: string) => new Date(iso) < PROJECT_START,
  inClosedPeriod: (iso: string) => {
    const d = new Date(iso);
    return d >= AGO_START && d <= AGO_END;
  },
});

describe("projeção de comissão do vendedor", () => {
  it("conta a venda em aberto pelo valor de venda e reapura a faixa", () => {
    // 8 un. quitadas (2400) + 4 un. em aberto (1200) = 12 un. => faixa 12,5%
    const sales = [
      sale("paga", "2026-08-05T12:00:00Z", 8, 2400, 2400),
      sale("aberta", "2026-08-18T12:00:00Z", 4, 1200, 0),
    ];
    const r = computeSellerBalance(seller, ctxFor(sales));

    // apurado hoje: só a quitada, 8 un. => 10%
    expect(r.units).toBe(8);
    expect(r.tier.label).toBe("10%");
    expect(r.accrued).toBeCloseTo(240);

    // projetado: 12 un. => 12,5% sobre 3600
    expect(r.projectedUnits).toBe(12);
    expect(r.projectedTier.label).toBe("12,5%");
    expect(r.projectedAccrued).toBeCloseTo(450);
    expect(r.pendingToReceive).toBeCloseTo(1200);
  });

  it("venda parcialmente paga entra inteira na projeção, mas só o saldo é o que falta receber", () => {
    const sales = [sale("meia", "2026-08-05T12:00:00Z", 2, 600, 200)];
    const r = computeSellerBalance(seller, ctxFor(sales));

    expect(r.accrued).toBeCloseTo(0);
    expect(r.projectedAccrued).toBeCloseTo(60); // 600 × 10%
    expect(r.pendingToReceive).toBeCloseTo(400);
  });

  it("sem nada em aberto, a projeção é igual ao apurado", () => {
    const sales = [sale("paga", "2026-08-05T12:00:00Z", 5, 1500, 1500)];
    const r = computeSellerBalance(seller, ctxFor(sales));

    expect(r.pendingToReceive).toBeCloseTo(0);
    expect(r.projectedAccrued).toBeCloseTo(r.accrued);
    expect(r.projectedTier.label).toBe(r.tier.label);
    expect(r.projectedBalance).toBeCloseTo(r.balance);
  });

  it("soma o que está em aberto em qualquer mês, não só no período", () => {
    const sales = [
      sale("ago", "2026-08-05T12:00:00Z", 2, 600, 600),
      sale("julAberta", "2026-07-05T12:00:00Z", 3, 900, 0),
    ];
    const r = computeSellerBalance(seller, ctxFor(sales));

    // a faixa do PERÍODO continua sendo só de agosto
    expect(r.projectedUnits).toBe(2);
    // mas o que falta receber é tudo
    expect(r.pendingToReceive).toBeCloseTo(900);
  });

  it("a venda em aberto de outro mês fecha no mês dela e entra no saldo projetado", () => {
    // julho: 20 un. em aberto (6000) => se recebidas, faixa 15% => 900
    // agosto: 2 un. quitadas (600) => 10% => 60
    const sales = [
      sale("ago", "2026-08-05T12:00:00Z", 2, 600, 600),
      sale("julAberta", "2026-07-05T12:00:00Z", 20, 6000, 0),
    ];
    const r = computeSellerBalance(seller, ctxFor(sales));

    expect(r.balance).toBeCloseTo(60); // hoje: julho não gerou nada
    expect(r.projectedBalance).toBeCloseTo(960); // 900 de julho + 60 de agosto
    expect(r.projectedBalance - r.balance).toBeCloseTo(900);
  });

  it("o consumo e a comissão já paga não são contados de novo na projeção", () => {
    const sales = [
      sale("ago", "2026-08-05T12:00:00Z", 4, 1200, 0),
      { ...sale("ret", "2026-08-10T12:00:00Z", 1, 200, 0), type: "retirada_funcionario" as const },
    ];
    const r = computeSellerBalance(seller, ctxFor(sales));

    // projetado = 1200 × 10% − 200 de consumo
    expect(r.projectedBalance).toBeCloseTo(-80);
    expect(r.balance).toBeCloseTo(-200);
  });
});
