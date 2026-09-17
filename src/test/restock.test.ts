import { describe, it, expect } from "vitest";
import { computeModelStats, summarizeRestock, urgencyOf } from "@/lib/restock";
import type { Product, PurchaseOrder, Sale } from "@/types";

const NOW = new Date(2026, 8, 3); // 03/09/2026, mesma data-base dos exemplos

/**
 * `minStock` é por SABOR no banco; o modelo lê o MAIOR deles. O diálogo
 * "Mínimo por modelo" grava o mesmo número em todos, então nos exemplos com um
 * sabor só os dois valores coincidem.
 */
const product = (
  id: string, brand: string, model: string, flavor: string,
  stock: number, purchasePrice: number, salePrice: number, minStock = 0,
): Product => ({
  id, name: `${flavor} ${model}`, brand, model, flavor,
  purchasePrice, salePrice, stock, minStock, createdAt: "2026-06-01T00:00:00Z",
});

/** Venda `daysAgo` dias antes de NOW. */
const sale = (id: string, productId: string, quantity: number, daysAgo: number, unitPrice = 170): Sale => {
  const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return {
    id, productId, quantity, unitPrice, totalPrice: unitPrice * quantity,
    date: d.toISOString(), installments: 1, paidAmount: unitPrice * quantity, type: "venda",
  };
};

/** Compra de `quantity` un. de um modelo, aguardando recebimento por padrão. */
const order = (
  id: string, brand: string, model: string, quantity: number,
  status: PurchaseOrder["status"] = "pending",
): PurchaseOrder => ({
  id, number: 1, status, date: NOW.toISOString(), paidAmount: 0, freightCost: 0,
  createdAt: NOW.toISOString(),
  items: [{
    id: `${id}-i1`, purchaseOrderId: id, brand, model,
    expectedQuantity: quantity, unitPrice: 90, receivedFlavors: [],
  }],
});

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

  it("mede o giro na janela de 30 dias — leitura, não entra no pedido", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 12, 92, 170)];
    const sales = [
      sale("s1", "p1", 10, 5),
      sale("s2", "p1", 5, 20),
      sale("s3", "p1", 99, 200), // fora da janela: não conta para o giro
    ];
    const [m] = computeModelStats({ products, sales, periodSales: [], now: NOW });

    expect(m.perDay).toBeCloseTo(15 / 30); // 0,5 un./dia
    expect(m.daysLeft).toBeCloseTo(24);
    // Sem mínimo definido não há pedido, por mais que o modelo gire.
    expect(m.restockUnits).toBe(0);
  });

  it("pede a diferença entre o mínimo do modelo e o estoque de hoje", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 4, 92, 170, 15)];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.minUnits).toBe(15);
    expect(m.needUnits).toBe(11);
    expect(m.restockUnits).toBe(11);
    expect(m.restockCost).toBeCloseTo(11 * 92);
  });

  it("lê o MAIOR mínimo entre os sabores, não a soma", () => {
    // O diálogo em lote grava o mesmo número em todos os sabores; somar
    // multiplicaria o pedido pelo número de sabores do modelo.
    const products = [
      product("p1", "Elfbar", "BC10000", "Cola", 2, 100, 200, 10),
      product("p2", "Elfbar", "BC10000", "Grape", 1, 100, 200, 10),
      product("p3", "Elfbar", "BC10000", "Mint", 0, 100, 200, 12),
    ];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.stock).toBe(3);
    expect(m.minUnits).toBe(12);
    expect(m.needUnits).toBe(9);
  });

  it("não pede nada quando o estoque já está no mínimo ou acima", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 20, 92, 170, 15)];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.needUnits).toBe(0);
    expect(m.restockUnits).toBe(0);
    expect(m.restockCost).toBe(0);
  });

  it("modelo sem mínimo definido não gera pedido, mesmo zerado", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 0, 92, 170)];
    const sales = [sale("s1", "p1", 30, 2), sale("s2", "p1", 30, 5)];
    const [m] = computeModelStats({ products, sales, periodSales: [], now: NOW });

    expect(m.minUnits).toBe(0);
    expect(m.needUnits).toBe(0);
    expect(m.restockUnits).toBe(0);
  });

  it("trata modelo sem giro como estoque infinito e sem reposição", () => {
    const products = [product("p1", "Nikbar", "15k", "Ice", 100, 79, 140, 20)];
    const [m] = computeModelStats({ products, sales: [], periodSales: [], now: NOW });

    expect(m.perDay).toBe(0);
    expect(m.daysLeft).toBe(Infinity);
    expect(m.restockUnits).toBe(0);
    expect(m.restockCost).toBe(0);
    expect(m.daysSinceLastSale).toBe(Infinity);
  });

  it("conta dias DISTINTOS com venda: duas vendas no mesmo dia são um dia só", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 12, 92, 170)];
    const sales = [
      sale("s1", "p1", 3, 5),
      sale("s2", "p1", 4, 5),  // mesmo dia da anterior
      sale("s3", "p1", 2, 9),
      sale("s4", "p1", 9, 90), // fora da janela: nem giro nem dia
    ];
    const [m] = computeModelStats({ products, sales, periodSales: [], now: NOW });

    expect(m.saleDays).toBe(2);
  });

  it("desconta do pedido o que já está a caminho", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 3, 92, 170, 15)];
    const sales = [sale("s1", "p1", 15, 2)];
    const [m] = computeModelStats({
      products, sales, periodSales: [], now: NOW,
      purchaseOrders: [order("o1", "Ignite", "V80", 5)],
    });

    expect(m.needUnits).toBe(12);
    expect(m.incoming).toBe(5);
    expect(m.restockUnits).toBe(7);
    expect(m.restockCost).toBeCloseTo(7 * 92);
  });

  it("zera o pedido quando a compra em aberto cobre tudo, sem ficar negativo", () => {
    const products = [product("p1", "Ignite", "V80", "Mint", 3, 92, 170, 15)];
    const sales = [sale("s1", "p1", 15, 2)];
    const [m] = computeModelStats({
      products, sales, periodSales: [], now: NOW,
      purchaseOrders: [order("o1", "Ignite", "V80", 40)],
    });

    expect(m.needUnits).toBe(12);
    expect(m.restockUnits).toBe(0);
    expect(m.restockCost).toBe(0);
  });

  it("compra já recebida não conta como a caminho", () => {
    // Ela já virou estoque no recebimento — abater de novo contaria duas vezes.
    const products = [product("p1", "Ignite", "V80", "Mint", 3, 92, 170, 15)];
    const sales = [sale("s1", "p1", 15, 2)];
    const [m] = computeModelStats({
      products, sales, periodSales: [], now: NOW,
      purchaseOrders: [order("o1", "Ignite", "V80", 40, "received")],
    });

    expect(m.incoming).toBe(0);
    expect(m.restockUnits).toBe(12);
  });

  it("casa a compra com o modelo ignorando caixa e espaço", () => {
    // Marca e modelo do item de compra são texto digitado em outra tela.
    const products = [product("p1", "Ignite", "V80", "Mint", 3, 92, 170, 15)];
    const sales = [sale("s1", "p1", 15, 2)];
    const [m] = computeModelStats({
      products, sales, periodSales: [], now: NOW,
      purchaseOrders: [order("o1", " ignite ", "v80", 5)],
    });

    expect(m.incoming).toBe(5);
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
      product("a", "Elfbar", "BC10000", "Cola", 3, 100, 200, 15), // abaixo do mínimo
      product("b", "Nikbar", "15k", "Ice", 50, 80, 140, 20),      // acima, mas parado
      product("c", "Ignite", "V80", "Mint", 300, 92, 170, 20),    // acima do mínimo
    ];
    const sales = [
      sale("s1", "a", 10, 2),
      sale("s2", "a", 5, 4),
      sale("s3", "b", 1, 90),  // parado há 90 dias, 50 un. × R$ 80 = R$ 4.000
      sale("s4", "c", 15, 2),
    ];
    const stats = computeModelStats({ products, sales, periodSales: [], now: NOW });
    const r = summarizeRestock(stats);

    expect(r.totalModels).toBe(3);
    expect(r.urgent.map(s => s.model)).toEqual(["BC10000"]);
    // mínimo 15, tem 3, faltam 12 × R$ 100
    expect(r.horizonUnits).toBe(12);
    expect(r.horizonCost).toBeCloseTo(1200);
    expect(r.staleCount).toBe(1);
    expect(r.staleValue).toBeCloseTo(4000);
  });

  it("ordena pelo tamanho do pedido, e a receita desempata", () => {
    // Pelo tamanho do PEDIDO, não por dias de estoque: `daysLeft` é uma razão,
    // e razão ignora tamanho — o que zerou vendendo 1 un. encabeçava a lista.
    const products = [
      product("a", "Ignite", "V80", "Mint", 0, 92, 170, 60),      // pede 60 un.
      product("b", "Elfbar", "BC10000", "Cola", 10, 100, 200, 15), // pede 5 un.
      product("c", "Nikbar", "15k", "Ice", 20, 80, 140, 25),       // pede 5 un.
    ];
    const periodSales = [sale("s1", "b", 8, 2, 200)]; // receita desempata b > c
    const r = summarizeRestock(computeModelStats({ products, sales: [], periodSales, now: NOW }));

    expect(r.urgent.map(s => s.model)).toEqual(["V80", "BC10000", "15k"]);
    expect(r.urgent.map(s => s.restockUnits)).toEqual([60, 5, 5]);
  });

  it("modelo sem mínimo definido fica de fora da lista", () => {
    // Consequência assumida: um modelo que vende bem e nunca teve mínimo
    // configurado é invisível para este card. Sem mínimo não há o que calcular.
    const products = [
      product("a", "Ignite", "V80", "Mint", 0, 92, 170, 20),  // tem mínimo
      product("b", "Elfbar", "BC10000", "Cola", 0, 100, 200), // sem mínimo
    ];
    const sales = [
      sale("s1", "a", 10, 2), sale("s2", "a", 10, 5),
      sale("s3", "b", 30, 3), sale("s4", "b", 30, 6),
    ];
    const r = summarizeRestock(computeModelStats({ products, sales, periodSales: [], now: NOW }));

    expect(r.urgent.map(s => s.model)).toEqual(["V80"]);
    expect(r.horizonUnits).toBe(20);
  });

  it("não usa o padrão de venda como filtro: o mínimo é a decisão do dono", () => {
    // A conta antiga projetava giro, e uma venda isolada virava projeção de 30
    // dias — daí o filtro de demanda recorrente. O mínimo não projeta nada.
    const products = [product("a", "Nikbar", "15k", "Ice", 2, 80, 140, 10)];
    const sales = [sale("s1", "a", 2, 3)]; // um dia só com venda
    const r = summarizeRestock(computeModelStats({ products, sales, periodSales: [], now: NOW }));

    expect(r.urgent.map(s => s.model)).toEqual(["15k"]);
    expect(r.urgent[0].restockUnits).toBe(8);
  });

  it("some da lista o modelo cuja compra em aberto já cobre o pedido", () => {
    const products = [product("a", "Ignite", "V80", "Mint", 0, 92, 170, 40)];
    const sales = [sale("s1", "a", 10, 2), sale("s2", "a", 5, 5)];
    const r = summarizeRestock(computeModelStats({
      products, sales, periodSales: [], now: NOW,
      purchaseOrders: [order("o1", "Ignite", "V80", 50)],
    }));

    expect(r.urgent).toHaveLength(0);
    expect(r.orderedCount).toBe(1);
    expect(r.orderedUnits).toBe(50);
    expect(r.horizonUnits).toBe(0);
  });

  it("não conta como parado o modelo sem estoque", () => {
    const products = [product("a", "Nikbar", "15k", "Ice", 0, 80, 140, 10)];
    const stats = computeModelStats({ products, sales: [sale("s1", "a", 1, 200)], periodSales: [], now: NOW });

    expect(summarizeRestock(stats).staleCount).toBe(0);
  });
});

describe("urgencyOf", () => {
  it("mede a falta contra o mínimo: metade ou menos é crítico", () => {
    expect(urgencyOf(0, 10)).toBe("critical");
    expect(urgencyOf(5, 10)).toBe("critical");  // exatamente metade
    expect(urgencyOf(6, 10)).toBe("warning");
    expect(urgencyOf(9, 10)).toBe("warning");
  });

  it("no mínimo ou acima dele não há falta", () => {
    expect(urgencyOf(10, 10)).toBe("ok");
    expect(urgencyOf(40, 10)).toBe("ok");
  });

  it("sem mínimo definido não há gravidade a medir", () => {
    expect(urgencyOf(0, 0)).toBe("ok");
  });
});
