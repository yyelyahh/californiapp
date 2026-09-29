import { describe, it, expect } from "vitest";
import { restockToPurchaseDraft, readPurchaseDraft, PURCHASE_DRAFT_KEY, PURCHASE_DRAFT_MAX } from "@/lib/purchase-draft";

const m = (brand: string, model: string, restockUnits: number, unitCost: number) => ({ brand, model, restockUnits, unitCost });

describe("compra montada a partir do Repor agora", () => {
  it("leva o que falta pedir com o custo médio, na ordem do card", () => {
    const got = restockToPurchaseDraft([m("Elfbar", "10K", 24, 18.456), m("Ignite", "V50", 6, 30)]);
    expect(got).toEqual([
      { brand: "Elfbar", model: "10K", quantity: 24, unitPrice: 18.46 },
      { brand: "Ignite", model: "V50", quantity: 6, unitPrice: 30 },
    ]);
  });

  it("fecha com o 'a custo' do card a menos de centavos", () => {
    const models = [m("A", "1", 7, 12.333), m("B", "2", 13, 9.995)];
    const card = models.reduce((s, x) => s + x.restockUnits * x.unitCost, 0);
    const draft = restockToPurchaseDraft(models).reduce((s, x) => s + x.quantity * (x.unitPrice ?? 0), 0);
    expect(Math.abs(draft - card)).toBeLessThan(0.1);
  });

  it("modelo sem custo conhecido vai sem custo, e o que não precisa de pedido não vai", () => {
    expect(restockToPurchaseDraft([m("A", "1", 5, 0), m("B", "2", 0, 10)])).toEqual([
      { brand: "A", model: "1", quantity: 5, unitPrice: undefined },
    ]);
  });

  it("lê o estado do router e descarta o que não tem forma de item", () => {
    const state = {
      [PURCHASE_DRAFT_KEY]: [
        { brand: "A", model: "1", quantity: 3, unitPrice: 10 },
        { brand: "", model: "2", quantity: 3 },
        { brand: "B", model: "2", quantity: -1 },
        { brand: "C", model: "3", quantity: 2, unitPrice: "10" },
        "lixo",
        { brand: "D", model: "4", quantity: 1 },
      ],
    };
    expect(readPurchaseDraft(state)).toEqual([
      { brand: "A", model: "1", quantity: 3, unitPrice: 10 },
      { brand: "D", model: "4", quantity: 1 },
    ]);
  });

  it("estado estranho não é rascunho", () => {
    expect(readPurchaseDraft(null)).toBeNull();
    expect(readPurchaseDraft({ outra: 1 })).toBeNull();
    expect(readPurchaseDraft({ [PURCHASE_DRAFT_KEY]: [] })).toBeNull();
    expect(readPurchaseDraft({ [PURCHASE_DRAFT_KEY]: "x" })).toBeNull();
  });

  it("não aceita mais que o teto", () => {
    const many = Array.from({ length: PURCHASE_DRAFT_MAX + 5 }, (_, i) => ({ brand: "A", model: String(i), quantity: 1 }));
    expect(readPurchaseDraft({ [PURCHASE_DRAFT_KEY]: many })).toHaveLength(PURCHASE_DRAFT_MAX);
  });
});
