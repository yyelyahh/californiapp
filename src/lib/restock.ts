import type { Product, Sale } from "@/types";

/**
 * Estatísticas por MODELO (marca + modelo) para o card "Repor agora" do Dashboard.
 *
 * Tudo aqui sai de dado que já existe: products.stock / purchasePrice / salePrice
 * e o histórico de sales. Nenhuma coluna nova no banco.
 *
 * Lembrete do domínio: products tem uma linha por SABOR. O que o dono repõe é o
 * modelo inteiro, então as contas agregam os sabores de um mesmo brand+model.
 */

/** Abaixo disso o estoque é crítico (vermelho). */
export const CRITICAL_DAYS = 10;
/** Abaixo disso o estoque é alerta (laranja). */
export const WARNING_DAYS = 21;
/** Horizonte de reposição: quantos dias o pedido deve cobrir. */
export const HORIZON_DAYS = 30;
/** Sem vender há mais que isso (com estoque parado) = capital travado. */
export const STALE_DAYS = 60;
/** Janela usada para medir o giro (vendas/dia). */
export const VELOCITY_WINDOW_DAYS = 30;

export interface ModelStat {
  /** `brand|model`, único e estável. */
  key: string;
  brand: string;
  model: string;
  stock: number;
  /** Custo unitário médio, ponderado pelo estoque de cada sabor. */
  unitCost: number;
  /** Quanto o estoque atual vale a custo. */
  stockValue: number;
  /** Unidades vendidas por dia na janela recente. */
  perDay: number;
  /** Quantos dias o estoque atual ainda dura. `Infinity` quando não há giro. */
  daysLeft: number;
  /** Margem bruta da tabela de preços, em %. */
  marginPct: number;
  /** Unidades que faltam para cobrir o horizonte. */
  restockUnits: number;
  /** Custo estimado dessas unidades. */
  restockCost: number;
  /** Dias desde a última venda. `Infinity` se nunca vendeu. */
  daysSinceLastSale: number;
  /** Receita do modelo no período do filtro. */
  revenue: number;
  /** Unidades vendidas no período do filtro. */
  qty: number;
}

export type Urgency = "critical" | "warning" | "ok";

export function urgencyOf(daysLeft: number): Urgency {
  if (daysLeft < CRITICAL_DAYS) return "critical";
  if (daysLeft < WARNING_DAYS) return "warning";
  return "ok";
}

const modelKey = (p: { brand: string; model: string }) => `${p.brand}|${p.model}`;

const daysBetween = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86_400_000;

function parse(dateISO: string): Date | null {
  const d = new Date(dateISO);
  return isNaN(d.getTime()) ? null : d;
}

export interface ComputeModelStatsInput {
  products: Product[];
  /** Histórico completo — usado para giro e para "parado há X dias". */
  sales: Sale[];
  /** Vendas do período selecionado no filtro — usado para receita/quantidade. */
  periodSales: Sale[];
  now?: Date;
  velocityWindowDays?: number;
  horizonDays?: number;
}

/**
 * Agrega produtos e vendas por modelo. Retorna ordenado por urgência
 * (menos dias de estoque primeiro); modelos sem giro vão para o fim.
 */
export function computeModelStats({
  products,
  sales,
  periodSales,
  now = new Date(),
  velocityWindowDays = VELOCITY_WINDOW_DAYS,
  horizonDays = HORIZON_DAYS,
}: ComputeModelStatsInput): ModelStat[] {
  const productModel = new Map<string, string>();
  const groups = new Map<string, {
    brand: string; model: string;
    stock: number; costWeighted: number; marginWeighted: number;
    costSum: number; marginSum: number; priced: number;
    windowQty: number; lastSale: number | null;
    revenue: number; qty: number;
  }>();

  for (const p of products) {
    const key = modelKey(p);
    productModel.set(p.id, key);
    const g = groups.get(key) ?? {
      brand: p.brand, model: p.model,
      stock: 0, costWeighted: 0, marginWeighted: 0,
      costSum: 0, marginSum: 0, priced: 0,
      windowQty: 0, lastSale: null,
      revenue: 0, qty: 0,
    };
    const cost = p.purchasePrice || 0;
    const margin = p.salePrice > 0 ? ((p.salePrice - cost) / p.salePrice) * 100 : 0;
    g.stock += p.stock;
    g.costWeighted += cost * p.stock;
    g.marginWeighted += margin * p.stock;
    // Fallback para quando o modelo inteiro está zerado: média simples dos sabores.
    g.costSum += cost;
    if (p.salePrice > 0) { g.marginSum += margin; g.priced += 1; }
    groups.set(key, g);
  }

  const windowStart = now.getTime() - velocityWindowDays * 86_400_000;

  for (const s of sales) {
    if (s.type !== "venda") continue;
    const key = productModel.get(s.productId);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) continue;
    const d = parse(s.date);
    if (!d) continue;
    const t = d.getTime();
    if (t > now.getTime()) continue; // venda com data futura não conta como giro
    if (t >= windowStart) g.windowQty += s.quantity;
    if (g.lastSale === null || t > g.lastSale) g.lastSale = t;
  }

  for (const s of periodSales) {
    if (s.type !== "venda") continue;
    const key = productModel.get(s.productId);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) continue;
    g.revenue += s.totalPrice;
    g.qty += s.quantity;
  }

  const flavorCount = new Map<string, number>();
  for (const p of products) flavorCount.set(modelKey(p), (flavorCount.get(modelKey(p)) || 0) + 1);

  const stats: ModelStat[] = [];
  for (const [key, g] of groups) {
    const flavors = flavorCount.get(key) || 1;
    const unitCost = g.stock > 0 ? g.costWeighted / g.stock : g.costSum / flavors;
    const marginPct = g.stock > 0
      ? g.marginWeighted / g.stock
      : (g.priced > 0 ? g.marginSum / g.priced : 0);
    const perDay = g.windowQty / velocityWindowDays;
    const daysLeft = perDay > 0 ? g.stock / perDay : Infinity;
    const restockUnits = perDay > 0 ? Math.max(0, Math.ceil(perDay * horizonDays - g.stock)) : 0;

    stats.push({
      key,
      brand: g.brand,
      model: g.model,
      stock: g.stock,
      unitCost,
      stockValue: g.stock * unitCost,
      perDay,
      daysLeft,
      marginPct,
      restockUnits,
      restockCost: restockUnits * unitCost,
      daysSinceLastSale: g.lastSale === null ? Infinity : Math.max(0, daysBetween(now, new Date(g.lastSale))),
      revenue: g.revenue,
      qty: g.qty,
    });
  }

  return stats.sort((a, b) => a.daysLeft - b.daysLeft || b.revenue - a.revenue);
}

export interface RestockSummary {
  /** Modelos que não cobrem o horizonte — os que precisam de pedido. */
  urgent: ModelStat[];
  /** Total de modelos cadastrados (o "de N" do rótulo). */
  totalModels: number;
  /** Custo estimado para cobrir o horizonte de todos os urgentes. */
  horizonCost: number;
  /** Modelos com estoque parado há mais de `staleDays`. */
  staleCount: number;
  /** Quanto esse estoque parado vale a custo. */
  staleValue: number;
}

export function summarizeRestock(
  stats: ModelStat[],
  { horizonDays = HORIZON_DAYS, staleDays = STALE_DAYS } = {},
): RestockSummary {
  const urgent = stats.filter(s => s.daysLeft <= horizonDays);
  const stale = stats.filter(s => s.stock > 0 && s.daysSinceLastSale > staleDays);
  return {
    urgent,
    totalModels: stats.length,
    horizonCost: urgent.reduce((sum, s) => sum + s.restockCost, 0),
    staleCount: stale.length,
    staleValue: stale.reduce((sum, s) => sum + s.stockValue, 0),
  };
}
