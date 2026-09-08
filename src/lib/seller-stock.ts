import { catalogCollator, compareText } from "@/lib/catalog-order";
import type { Product, ProductAssignment } from "@/types";

export type StockLine = {
  productId: string;
  flavor: string;
  quantity: number;
  /** Unidades prometidas em pedido pendente — ainda estão com o vendedor. */
  reserved: number;
};

export type StockGroup = {
  key: string;
  brand: string;
  model: string;
  lines: StockLine[];
  units: number;
};

export type SellerStock = {
  groups: StockGroup[];
  units: number;
  flavors: number;
  reserved: number;
};

/**
 * Só o que este cálculo precisa de um pedido pendente. Tipado por estrutura de
 * propósito: `lib/` não importa de `hooks/`, e assim o teste monta um pedido
 * sem arrastar o hook inteiro junto.
 */
export type PendingOrderLike = {
  seller_id: string;
  order_items?: { product_id: string; quantity: number }[] | null;
};

/**
 * O que o sistema diz que está NA MÃO do vendedor, para ele conferir contra a
 * caixa. A fonte é `product_assignments.quantity`, que o `create_sale` já
 * debita quando a venda dele é confirmada — então este número é o estoque
 * físico esperado, e não o que foi atribuído um dia.
 *
 * Pedido pendente NÃO sai daqui: a reserva do catálogo é virtual (o
 * `create_pending_order` só desconta no cálculo do que está à venda, sem mexer
 * na atribuição), e na conferência a peça continua na caixa. Ela aparece como
 * aviso na linha, para o vendedor não prometer a mesma unidade duas vezes.
 *
 * Agrupado por marca+modelo porque é assim que o produto senta na caixa —
 * conferir sabor por sabor numa lista corrida faz perder a linha.
 */
export function buildSellerStock(
  sellerId: string | null | undefined,
  input: {
    productAssignments: ProductAssignment[];
    products: Product[];
    pendingOrders: PendingOrderLike[];
    productName: (productId: string) => string;
  },
): SellerStock {
  const { productAssignments, products, pendingOrders, productName } = input;
  if (!sellerId) return { groups: [], units: 0, flavors: 0, reserved: 0 };

  const reservedByProduct = new Map<string, number>();
  for (const order of pendingOrders) {
    if (order.seller_id !== sellerId) continue;
    for (const item of order.order_items ?? []) {
      reservedByProduct.set(item.product_id, (reservedByProduct.get(item.product_id) ?? 0) + item.quantity);
    }
  }

  const byGroup = new Map<string, StockGroup>();
  for (const a of productAssignments) {
    if (a.sellerId !== sellerId || a.quantity <= 0) continue;
    const product = products.find(p => p.id === a.productId);
    const brand = product?.brand || "Sem marca";
    const model = product?.model || "";
    const key = `${brand}|${model}`;
    const group = byGroup.get(key) ?? { key, brand, model, lines: [], units: 0 };
    group.lines.push({
      productId: a.productId,
      flavor: product?.flavor || productName(a.productId),
      quantity: a.quantity,
      reserved: reservedByProduct.get(a.productId) ?? 0,
    });
    group.units += a.quantity;
    byGroup.set(key, group);
  }

  // Mesma ordem do resto do sistema: marca, depois modelo, depois sabor.
  const groups = Array.from(byGroup.values()).sort(
    (a, b) => compareText(a.brand, b.brand) || compareText(a.model, b.model),
  );
  for (const g of groups) g.lines.sort((a, b) => catalogCollator.compare(a.flavor, b.flavor));

  return {
    groups,
    units: groups.reduce((a, g) => a + g.units, 0),
    flavors: groups.reduce((a, g) => a + g.lines.length, 0),
    reserved: groups.reduce((a, g) => a + g.lines.reduce((x, l) => x + l.reserved, 0), 0),
  };
}
