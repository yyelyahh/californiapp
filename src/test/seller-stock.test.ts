import { describe, it, expect } from "vitest";
import { buildSellerStock, type PendingOrderLike } from "@/lib/seller-stock";
import type { Product, ProductAssignment } from "@/types";

const product = (id: string, brand: string, model: string, flavor: string): Product => ({
  id, name: `${brand} ${flavor}`, brand, model, flavor,
  purchasePrice: 0, salePrice: 30, stock: 0, minStock: 0, createdAt: "2026-06-01",
});

const assign = (id: string, productId: string, quantity: number, sellerId = "s1"): ProductAssignment =>
  ({ id, sellerId, productId, quantity, createdAt: "2026-06-01" });

const order = (sellerId: string, items: [string, number][]): PendingOrderLike => ({
  seller_id: sellerId,
  order_items: items.map(([product_id, quantity]) => ({ product_id, quantity })),
});

const products = [
  product("a", "Ignite", "V150", "Menta"),
  product("b", "Ignite", "V150", "Uva"),
  product("c", "Elfbar", "BC10000", "Morango"),
];
const productName = (id: string) => `produto ${id}`;

describe("estoque do vendedor", () => {
  it("agrupa por marca e modelo e soma as unidades", () => {
    const r = buildSellerStock("s1", {
      productAssignments: [assign("1", "a", 5), assign("2", "b", 3), assign("3", "c", 2)],
      products, pendingOrders: [], productName,
    });

    expect(r.groups.map(g => g.key)).toEqual(["Elfbar|BC10000", "Ignite|V150"]);
    expect(r.groups[1].lines.map(l => l.flavor)).toEqual(["Menta", "Uva"]);
    expect(r.groups[1].units).toBe(8);
    expect(r.units).toBe(10);
    expect(r.flavors).toBe(3);
  });

  it("ignora atribuição de outro vendedor e o que zerou", () => {
    const r = buildSellerStock("s1", {
      productAssignments: [assign("1", "a", 5), assign("2", "b", 0), assign("3", "c", 4, "s2")],
      products, pendingOrders: [], productName,
    });

    expect(r.units).toBe(5);
    expect(r.flavors).toBe(1);
  });

  it("pedido pendente não sai do estoque, só marca a reserva", () => {
    const r = buildSellerStock("s1", {
      productAssignments: [assign("1", "a", 5)],
      products,
      pendingOrders: [order("s1", [["a", 2]]), order("s1", [["a", 1]])],
      productName,
    });

    expect(r.groups[0].lines[0].quantity).toBe(5);
    expect(r.groups[0].lines[0].reserved).toBe(3);
    expect(r.units).toBe(5);
    expect(r.reserved).toBe(3);
  });

  it("não conta reserva de pedido de outro vendedor", () => {
    const r = buildSellerStock("s1", {
      productAssignments: [assign("1", "a", 5)],
      products, pendingOrders: [order("s2", [["a", 2]])], productName,
    });

    expect(r.reserved).toBe(0);
  });

  it("produto que sumiu do catálogo ainda aparece, pelo nome do sistema", () => {
    const r = buildSellerStock("s1", {
      productAssignments: [assign("1", "sumiu", 2)],
      products, pendingOrders: [], productName,
    });

    expect(r.groups[0].brand).toBe("Sem marca");
    expect(r.groups[0].lines[0].flavor).toBe("produto sumiu");
    expect(r.units).toBe(2);
  });

  it("sem vendedor, não devolve estoque nenhum", () => {
    const r = buildSellerStock(null, {
      productAssignments: [assign("1", "a", 5)],
      products, pendingOrders: [], productName,
    });

    expect(r.groups).toEqual([]);
    expect(r.units).toBe(0);
  });
});
