import { describe, it, expect } from "vitest";
import { computeModelStats, summarizeRestock, urgencyOf } from "@/lib/restock";
import type { Product, Sale } from "@/types";

const NOW = new Date(2026, 8, 3); // 03/09/2026, mesma data-base dos exemplos

const product = (
  id: string, brand: string, model: string, flavor: string,
  stock: number, purchasePrice: number, salePrice: number,
): Product => ({
  id, name: `${flavor} ${model}`, brand, model, flavor,
  purchasePrice, salePrice, stock, minStock: 0, createdAt: "2026-06-01T00:00:00Z",
});

/** Venda `daysAgo` dias antes de NOW. */
const sale = (id: string, productId: string, quantity: number, daysAgo: number, unitPrice = 170): Sale => {
  const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return {
    id, productId, quantity, unitPrice, totalPrice: unitPrice * quantity,
    date: d.toISOString(), installments: 1, paidAmount: unitPrice * quantity, type: "venda",
  };
};

describe("computeModelStats", () => {
  it("agrupa os sabores de um mesmo modelo e pondera custo e margem pelo estoque", () => {
    const products = [
      product("p1", "Elfbar", "BC10000", "Cherry Cola", 6, 100, 200),
      product("p2", "Elfbar", "BC10000", "Grape", 2, 120, 200),
    ];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.key).toBe("Elfbar|BC10000");
    expect(m.stock).toBe(8);
    // (100*6 + 120*2) / 8 = 105
    expect(m.unitCost).toBeCloseTo(105);
    expect(m.stockValue).toBeCloseTo(840);
    // margens 50% e 40%, ponderadas: (50*6 + 40*2)/8 = 47,5
    expect(m.marginPct).toBeCloseTo(47.5);
  });

  it("mede o giro na janela de 30 dias e projeta quanto o estoque ainda dura", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 12, 92, 170)];
    const sales = [
      sale("s1", "p1", 10, 5),
      sale("s2", "p1", 5, 20),
      sale("s3", "p1", 99, 200), // fora da janela: não conta para o giro
    ];
    const [m] = computeModelStats({ products, sales, periodSales: [], now: NOW });

    expect(m.perDay).toBeCloseTo(15 / 30); // 0,5 un./dia
    expect(m.daysLeft).toBeCloseTo(24);
    // cobrir 30 dias = 15 un.; já tem 12, faltam 3
    expect(m.restockUnits).toBe(3);
    expect(m.restockCost).toBeCloseTo(276);
  });

  it("trata modelo sem giro como estoque infinito e sem reposição", () => {
    const products = [product("p1", "Nikbar", "15k", "Ice", 100, 79, 140)];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.perDay).toBe(0);
    expect(m.daysLeft).toBe(Infinity);
    expect(m.restockUnits).toBe(0);
    expect(m.restockCost).toBe(0);
    expect(m.daysSinceLastSale).toBe(Infinity);
  });

  it("ignora retiradas de funcionário e vendas com data futura no cálculo do giro", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 10, 92, 170)];
    const retirada: Sale = { ...sale("s1", "p1", 30, 2), type: "retirada_funcionario" };
    const futura = sale("s2", "p1", 30, -5); // 5 dias no futuro
    const [m] = computeModelStats({ products, sales: [retirada, futura], periodSales: [], now: NOW });

    expect(m.perDay).toBe(0);
    expect(m.daysSinceLastSale).toBe(Infinity);
  });

  it("separa receita do período (filtro) do giro (histórico recente)", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 10, 92, 170)];
    const recente = sale("s1", "p1", 3, 4);
    const antiga = sale("s2", "p1", 2, 120, 150);
    const [m] = computeModelStats({
      products,
      sales: [recente, antiga],
      periodSales: [antiga], // filtro apontando para um mês antigo
      now: NOW,
    });

    expect(m.qty).toBe(2);
    expect(m.revenue).toBeCloseTo(300);
    expect(m.perDay).toBeCloseTo(3 / 30); // só a recente entra no giro
  });

  it("ordena por urgência: menos dias de estoque primeiro, sem giro por último", () => {
    const products = [
      product("a", "Nikbar", "15k", "Ice", 50, 79, 140),      // sem giro
      product("b", "Elfbar", "BC10000", "Cola", 3, 100, 200), // acaba rápido
      product("c", "Ignite", "V80", "Mint", 30, 92, 170),
    ];
    const sales = [sale("s1", "b", 15, 2), sale("s2", "c", 15, 2)];
    const stats = computeModelStats({ products, sales, periodSales: [], now: NOW });

    expect(stats.map(s => s.model)).toEqual(["BC10000", "V80", "15k"]);
  });
});

describe("summarizeRestock", () => {
  it("conta os urgentes, soma o custo do pedido e mede o capital parado", () => {
    const products = [
      product("a", "Elfbar", "BC10000", "Cola", 3, 100, 200),
      product("b", "Nikbar", "15k", "Ice", 50, 80, 140),
      product("c", "Ignite", "V80", "Mint", 300, 92, 170),
    ];
    const sales = [
      sale("s1", "a", 15, 2),  // gira: 0,5/dia → dura 6 dias
      sale("s2", "b", 1, 90),  // parado há 90 dias, 50 un. × R$ 80 = R$ 4.000
      sale("s3", "c", 15, 2),  // gira, mas tem estoque para 600 dias
    ];
    const stats = computeModelStats({ products, sales, periodSales: [], now: NOW });
    const r = summarizeRestock(stats);

    expect(r.totalModels).toBe(3);
    expect(r.urgent.map(s => s.model)).toEqual(["BC10000"]);
    // cobrir 30 dias = 15 un.; tem 3, faltam 12 × R$ 100
    expect(r.horizonCost).toBeCloseTo(1200);
    expect(r.staleCount).toBe(1);
    expect(r.staleValue).toBeCloseTo(4000);
  });

  it("não conta como parado o modelo sem estoque", () => {
    const products = [product("a", "Nikbar", "15k", "Ice", 0, 80, 140)];
    const stats = computeModelStats({ products, sales: [sale("s1", "a", 1, 200)], periodSales: [], now: NOW });

    expect(summarizeRestock(stats).staleCount).toBe(0);
  });
});

describe("urgencyOf", () => {
  it("marca crítico abaixo de 10 dias, alerta abaixo de 21 e ok acima", () => {
    expect(urgencyOf(9)).toBe("critical");
    expect(urgencyOf(12)).toBe("warning");
    expect(urgencyOf(66)).toBe("ok");
    expect(urgencyOf(Infinity)).toBe("ok");
  });
});
