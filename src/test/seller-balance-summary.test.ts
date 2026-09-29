import { describe, it, expect } from "vitest";
import { summarizeSellerBalances, currentBalanceContext, PROJECT_START } from "@/lib/commissions";
import type { Seller } from "@/types";

const seller = (id: string, name: string, archivedAt?: string): Seller =>
  ({ id, name, debtPercentage: 0, createdAt: "2026-06-01T12:00:00Z", archivedAt } as Seller);

describe("resumo dos saldos com os vendedores", () => {
  it("separa o que se deve a eles do que eles devem, sem compensar um no outro", () => {
    const balances: Record<string, number> = { a: 300, b: -300, c: 40 };
    const got = summarizeSellerBalances(
      [seller("a", "Ana"), seller("b", "Bia"), seller("c", "Caio")],
      s => balances[s.id],
    );
    expect(got.payable).toBe(340);
    expect(got.owed).toBe(300);
    expect(got.rows.map(r => r.seller.id)).toEqual(["a", "b", "c"]);
  });

  it("fica de fora quem não recebe comissão e quem está zerado", () => {
    const got = summarizeSellerBalances(
      [seller("g", "Gab"), seller("a", "Ana"), seller("z", "Zeca")],
      s => (s.id === "z" ? 0.004 : 100),
    );
    expect(got.rows.map(r => r.seller.id)).toEqual(["a"]);
  });

  it("arquivado com saldo entra: dinheiro devido não some porque a pessoa saiu", () => {
    const got = summarizeSellerBalances([seller("a", "Ana", "2026-08-01T12:00:00Z")], () => 55);
    expect(got.rows).toHaveLength(1);
    expect(got.payable).toBe(55);
  });

  it("empate em módulo desempata pelo nome", () => {
    const got = summarizeSellerBalances([seller("b", "Bia"), seller("a", "Ana")], s => (s.id === "a" ? 50 : -50));
    expect(got.rows.map(r => r.seller.name)).toEqual(["Ana", "Bia"]);
  });
});

describe("contexto do saldo de hoje", () => {
  const ctx = currentBalanceContext(
    { sales: [], commissionPayments: [], sellerDebtPayments: [], sellerManualDebts: [] },
    new Date(2026, 8, 28, 15),
  );

  it("o período é o mês corrente inteiro", () => {
    expect(ctx.start).toEqual(new Date(2026, 8, 1));
    expect(ctx.closedStart).toEqual(new Date(2026, 8, 1));
    expect(ctx.end.getDate()).toBe(30);
    expect(ctx.inClosedPeriod("2026-09-30T23:00:00")).toBe(true);
    expect(ctx.inClosedPeriod("2026-08-31T12:00:00")).toBe(false);
  });

  it("data sem hora é meia-noite local, como na Distribuição", () => {
    expect(ctx.inClosedPeriod("2026-09-01")).toBe(true);
    expect(ctx.isLegacy("2026-06-01")).toBe(false);
    expect(ctx.isLegacy("2026-05-31")).toBe(true);
    expect(ctx.PROJECT_START).toBe(PROJECT_START);
  });

  it("data inválida não é do período nem legado", () => {
    expect(ctx.inClosedPeriod("lixo")).toBe(false);
    expect(ctx.isLegacy("lixo")).toBe(false);
  });
});
