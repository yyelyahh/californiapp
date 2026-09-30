import { describe, it, expect } from "vitest";
import {
  firstName, groupOpenSales, mergeSaleLines, parseOrderNote, tagOrderLines, tierLadder, tierUpgradeGain, whatsappLink,
} from "@/lib/seller-orders";
import { COMMISSION_TIERS } from "@/lib/commissions";
import type { Sale } from "@/types";

const ORDER_A = "3f9a1c22-0b1e-4c1a-9d7e-5a2b6c8d0e11";
const ORDER_B = "8b27d4e0-6c3f-4a55-b1d2-9e0f7a6b5c44";

const sale = (id: string, over: Partial<Sale>): Sale => ({
  id, productId: "p1", quantity: 1, unitPrice: 90, totalPrice: 90, date: "2026-09-10T12:00:00Z",
  installments: 1, paidAmount: 0, sellerId: "s1", type: "venda", ...over,
});

describe("nota do pedido", () => {
  it("separa a observação da referência", () => {
    expect(parseOrderNote(`dia 20 · Pedido via catálogo #${ORDER_A}`)).toEqual({ orderId: ORDER_A, note: "dia 20" });
    expect(parseOrderNote(`Pedido via catálogo #${ORDER_A}`)).toEqual({ orderId: ORDER_A, note: null });
  });

  it("venda sem pedido guarda a nota inteira", () => {
    expect(parseOrderNote("acerto na mão")).toEqual({ orderId: null, note: "acerto na mão" });
    expect(parseOrderNote(undefined)).toEqual({ orderId: null, note: null });
  });
});

describe("a receber, por pedido", () => {
  const since = new Date("2026-06-01T00:00:00");

  it("junta os sabores do mesmo pedido numa linha e soma o que falta", () => {
    const groups = groupOpenSales([
      sale("1", { notes: `Pedido via catálogo #${ORDER_A}`, quantity: 2, totalPrice: 180 }),
      sale("2", { notes: `Pedido via catálogo #${ORDER_A}`, totalPrice: 110, paidAmount: 10 }),
      sale("3", { notes: `Pedido via catálogo #${ORDER_B}`, date: "2026-08-02T12:00:00Z" }),
    ], "s1", since);
    expect(groups.map(g => g.key)).toEqual([ORDER_B, ORDER_A]); // mais antigo primeiro
    expect(groups[1].open).toBe(280);
    expect(groups[1].units).toBe(3);
  });

  it("deixa de fora o quitado, a retirada, outro vendedor e o legado", () => {
    const groups = groupOpenSales([
      sale("pago", { paidAmount: 90 }),
      sale("retirada", { type: "retirada_funcionario" }),
      sale("outro", { sellerId: "s2" }),
      sale("velho", { date: "2026-05-20T12:00:00Z" }),
      sale("solta", {}),
    ], "s1", since);
    expect(groups.map(g => g.key)).toEqual(["sale:solta"]);
  });
});

describe("de onde vem o desconto da linha", () => {
  const item = (id: string, product_id: string, unit_price: number, quantity = 1, model = "V80") => ({
    id, product_id, quantity, unit_price, products: { brand: "Ignite", model },
  });
  const base = (id: string) => ({ a: 110, b: 110, c: 140, d: 85 } as Record<string, number>)[id];

  it("a mais barata das linhas repetidas é o prêmio", () => {
    const tags = tagOrderLines([item("1", "d", 85, 2, "G8000"), item("2", "d", 43, 1, "G8000")], base);
    expect(tags.get("1")).toBeNull();
    expect(tags.get("2")).toBe("premio");
  });

  it("2+ unidades do modelo abaixo do preço é combo", () => {
    const tags = tagOrderLines([item("1", "a", 103), item("2", "b", 103), item("3", "c", 140, 1, "V150")], base);
    expect(tags.get("1")).toBe("combo");
    expect(tags.get("2")).toBe("combo");
    expect(tags.get("3")).toBeNull();
  });

  it("linha única pela metade é prêmio; sem motivo visível é só desconto", () => {
    expect(tagOrderLines([item("1", "a", 55)], base).get("1")).toBe("premio");
    expect(tagOrderLines([item("1", "a", 100)], base).get("1")).toBe("desconto");
  });

  it("sem preço de base só a regra da linha repetida vale", () => {
    expect(tagOrderLines([item("1", "x", 10)], () => undefined).get("1")).toBeNull();
  });
});

describe("link do WhatsApp", () => {
  it("põe o 55 em número brasileiro e tira a máscara", () => {
    expect(whatsappLink("(51) 99812-4410")).toBe("https://wa.me/5551998124410");
    expect(whatsappLink("5551998124410")).toBe("https://wa.me/5551998124410");
  });
  it("sem dígito suficiente não vira link", () => {
    expect(whatsappLink("9981")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
  });
  it("leva a mensagem pronta, codificada", () => {
    expect(whatsappLink("(51) 99812-4410", "Oi, Lucas! R$ 90")).toBe(
      "https://wa.me/5551998124410?text=Oi%2C%20Lucas!%20R%24%2090",
    );
  });
  it("primeiro nome para a mensagem", () => {
    expect(firstName("  Maria Eduarda Fagundes ")).toBe("Maria");
    expect(firstName(null)).toBe("");
  });
});

describe("linhas do grupo", () => {
  it("soma o prêmio ao mesmo produto, na ordem da primeira aparição", () => {
    expect(mergeSaleLines([
      { productId: "p7", quantity: 2 },
      { productId: "p1", quantity: 1 },
      { productId: "p7", quantity: 1 },
    ])).toEqual([{ productId: "p7", quantity: 3 }, { productId: "p1", quantity: 1 }]);
  });
});

describe("quanto vale a próxima faixa", () => {
  const [t10, t125, t15] = COMMISSION_TIERS;
  it("reprecifica toda a receita paga do mês", () => {
    expect(tierUpgradeGain(1030, t10, t125)).toBe(25.75);
    expect(tierUpgradeGain(2000, t125, t15)).toBe(50);
  });
  it("na faixa mais alta ou sem receita, zero", () => {
    expect(tierUpgradeGain(1030, t15, null)).toBe(0);
    expect(tierUpgradeGain(0, t10, t125)).toBe(0);
  });
});

describe("escada de faixas", () => {
  it("sai das próprias faixas da comissão", () => {
    expect(tierLadder(COMMISSION_TIERS)).toBe("10% até 10 un. · 12,5% de 11 a 15 · 15% a partir de 16");
  });
});
