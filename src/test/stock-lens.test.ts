import { describe, it, expect } from "vitest";
import { lensStock, LENS_GERAL, LENS_CASA } from "@/lib/stock-lens";
import type { Product, ProductAssignment } from "@/types";

/**
 * A atribuição é SUBCONJUNTO do estoque da filial: o que está com o vendedor já
 * está contado no total. Por isso a casa é uma subtração, e geral + casa +
 * vendedor não é uma soma que feche — as três são recortes do mesmo número.
 */

const product = (id: string, stock: number): Product => ({
  id, name: `Sabor ${id}`, brand: "Elfbar", model: "BC10000", flavor: id,
  purchasePrice: 100, salePrice: 200, stock, minStock: 0,
  createdAt: "2026-06-01T00:00:00Z",
});

const assign = (sellerId: string, productId: string, quantity: number): ProductAssignment => ({
  id: `${sellerId}-${productId}`, sellerId, productId, quantity,
  createdAt: "2026-09-01T00:00:00Z",
});

const products = [product("p1", 10), product("p2", 4)];
const assignments = [
  assign("s1", "p1", 3),
  assign("s2", "p1", 2),
  assign("s1", "p2", 4),
];

const stockOf = (list: Product[], id: string) => list.find(p => p.id === id)!.stock;

describe("lensStock", () => {
  it("em geral devolve a MESMA lista, sem cópia", () => {
    // A tela inteira pende deste array; copiar sem precisar refaria todos os
    // memos a cada render.
    expect(lensStock(LENS_GERAL, products, assignments)).toBe(products);
  });

  it("a casa é o estoque menos tudo o que está distribuído", () => {
    const casa = lensStock(LENS_CASA, products, assignments);

    expect(stockOf(casa, "p1")).toBe(5); // 10 − 3 − 2
    expect(stockOf(casa, "p2")).toBe(0); // 4 − 4: tudo na rua
  });

  it("no vendedor mostra a caixa DELE, não o que a cidade tem", () => {
    const s1 = lensStock("s1", products, assignments);
    const s2 = lensStock("s2", products, assignments);

    expect(stockOf(s1, "p1")).toBe(3);
    expect(stockOf(s1, "p2")).toBe(4);
    expect(stockOf(s2, "p1")).toBe(2);
    expect(stockOf(s2, "p2")).toBe(0); // não tem esse sabor
  });

  it("não soma as pontas: geral não é casa mais vendedores somados de novo", () => {
    // Guarda contra a leitura errada do modelo. A unidade que está com o
    // vendedor JÁ está no total da filial.
    const geral = stockOf(lensStock(LENS_GERAL, products, assignments), "p1");
    const casa = stockOf(lensStock(LENS_CASA, products, assignments), "p1");
    const vendedores = stockOf(lensStock("s1", products, assignments), "p1")
      + stockOf(lensStock("s2", products, assignments), "p1");

    expect(casa + vendedores).toBe(geral);
  });

  it("não mexe no resto do produto", () => {
    const [p] = lensStock("s1", products, assignments);
    expect(p).toMatchObject({ id: "p1", purchasePrice: 100, salePrice: 200, flavor: "p1" });
  });

  it("deixa a casa negativa aparecer em vez de esconder", () => {
    // Linha antiga, anterior ao gatilho que trava a atribuição no estoque.
    const casa = lensStock(LENS_CASA, [product("p3", 2)], [assign("s1", "p3", 5)]);
    expect(stockOf(casa, "p3")).toBe(-3);
  });
});
