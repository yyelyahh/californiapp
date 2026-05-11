import { parseISO, differenceInCalendarDays, startOfDay, format, addDays } from "date-fns";
import { Product, Sale, StockEntry, Seller } from "@/types";

export type Period = { start: Date; end: Date };

export function periodFromPreset(preset: "7d" | "30d" | "90d" | "365d"): Period {
  const end = startOfDay(new Date());
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
  return { start: addDays(end, -days + 1), end };
}

export function inPeriod(dateStr: string, p: Period) {
  const d = parseISO(dateStr);
  return d >= p.start && d <= addDays(p.end, 1);
}

function venda(s: Sale) {
  return s.type === "venda";
}

/** Velocidade média de venda em unidades/dia nos últimos N dias */
export function calcularVelocidadeVenda(productId: string, sales: Sale[], days = 30) {
  const start = addDays(startOfDay(new Date()), -days + 1);
  const total = sales
    .filter(s => venda(s) && s.productId === productId && parseISO(s.date) >= start)
    .reduce((sum, s) => sum + s.quantity, 0);
  return { perDay: total / days, perWeek: (total / days) * 7, total };
}

/** Tendência: compara últimos 7 dias com 7 dias anteriores */
export function calcularTendencia(productId: string, sales: Sale[]) {
  const now = startOfDay(new Date());
  const last7Start = addDays(now, -6);
  const prev7Start = addDays(now, -13);
  let last = 0, prev = 0;
  for (const s of sales) {
    if (!venda(s) || s.productId !== productId) continue;
    const d = parseISO(s.date);
    if (d >= last7Start) last += s.quantity;
    else if (d >= prev7Start) prev += s.quantity;
  }
  if (prev === 0 && last === 0) return { delta: 0, dir: "flat" as const };
  if (prev === 0) return { delta: 100, dir: "up" as const };
  const delta = ((last - prev) / prev) * 100;
  return { delta, dir: delta > 10 ? ("up" as const) : delta < -10 ? ("down" as const) : ("flat" as const) };
}

export type ReplenishStatus = "urgente" | "alta_demanda" | "saudavel" | "baixa_saida" | "parado";

export interface ReplenishRow {
  product: Product;
  stock: number;
  perWeek: number;
  perDay: number;
  daysLeft: number;
  suggested: number;
  trend: ReturnType<typeof calcularTendencia>;
  status: ReplenishStatus;
  statusLabel: string;
}

export function preverReposicao(products: Product[], sales: Sale[]): ReplenishRow[] {
  return products.map(p => {
    const v = calcularVelocidadeVenda(p.id, sales, 30);
    const trend = calcularTendencia(p.id, sales);
    const daysLeft = v.perDay > 0 ? p.stock / v.perDay : Infinity;
    const suggested = Math.max(0, Math.ceil(v.perDay * 30 - p.stock));
    let status: ReplenishStatus = "saudavel";
    let statusLabel = "Estoque saudável";
    if (v.total === 0) { status = "parado"; statusLabel = "Produto parado"; }
    else if (daysLeft <= 3 && p.stock >= 0) { status = "urgente"; statusLabel = "Repor urgente"; }
    else if (trend.dir === "up" && trend.delta > 30) { status = "alta_demanda"; statusLabel = "Alta demanda"; }
    else if (v.perWeek < 1) { status = "baixa_saida"; statusLabel = "Baixa saída"; }
    return { product: p, stock: p.stock, perWeek: v.perWeek, perDay: v.perDay, daysLeft, suggested, trend, status, statusLabel };
  });
}

export type GiroClass = "rapido" | "medio" | "lento" | "encalhado";

export interface GiroRow {
  product: Product;
  totalSold: number;
  daysSinceLastSale: number | null;
  lastSaleDate: string | null;
  monthlyTurnover: number;
  saleFrequency: number;
  classification: GiroClass;
  classLabel: string;
}

export function calcularGiro(products: Product[], sales: Sale[], period: Period): GiroRow[] {
  const days = Math.max(1, differenceInCalendarDays(period.end, period.start) + 1);
  return products.map(p => {
    const ps = sales.filter(s => venda(s) && s.productId === p.id);
    const inP = ps.filter(s => inPeriod(s.date, period));
    const totalSold = inP.reduce((sum, s) => sum + s.quantity, 0);
    const lastSale = ps.reduce<Sale | null>((acc, s) => (!acc || parseISO(s.date) > parseISO(acc.date) ? s : acc), null);
    const daysSinceLastSale = lastSale ? differenceInCalendarDays(new Date(), parseISO(lastSale.date)) : null;
    const avgStock = Math.max(p.stock, 1);
    const monthlyTurnover = (totalSold / days) * 30 / avgStock;
    const uniqueDays = new Set(inP.map(s => s.date.slice(0, 10))).size;
    const saleFrequency = uniqueDays / days;
    let classification: GiroClass = "medio";
    let classLabel = "Giro médio";
    if (daysSinceLastSale !== null && daysSinceLastSale > 60) { classification = "encalhado"; classLabel = "Encalhado"; }
    else if (monthlyTurnover >= 1.5) { classification = "rapido"; classLabel = "Giro rápido"; }
    else if (monthlyTurnover < 0.5) { classification = "lento"; classLabel = "Giro lento"; }
    return { product: p, totalSold, daysSinceLastSale, lastSaleDate: lastSale?.date ?? null, monthlyTurnover, saleFrequency, classification, classLabel };
  });
}

export interface ProfitRow {
  product: Product;
  unitMargin: number;
  marginPct: number;
  totalProfit: number;
  totalRevenue: number;
  qtySold: number;
  roi: number;
}

export function calcularLucratividade(products: Product[], sales: Sale[], period: Period): ProfitRow[] {
  return products.map(p => {
    const ps = sales.filter(s => venda(s) && s.productId === p.id && inPeriod(s.date, period));
    const qtySold = ps.reduce((sum, s) => sum + s.quantity, 0);
    const totalRevenue = ps.reduce((sum, s) => sum + s.totalPrice, 0);
    const unitMargin = p.salePrice - p.purchasePrice;
    const marginPct = p.salePrice > 0 ? (unitMargin / p.salePrice) * 100 : 0;
    const totalProfit = ps.reduce((sum, s) => sum + (s.unitPrice - p.purchasePrice) * s.quantity, 0);
    const stockValue = p.purchasePrice * Math.max(p.stock, 1);
    const roi = stockValue > 0 ? (totalProfit / stockValue) * 100 : 0;
    return { product: p, unitMargin, marginPct, totalProfit, totalRevenue, qtySold, roi };
  });
}

export function detectarProdutosParados(products: Product[], sales: Sale[], thresholdDays = 30) {
  return calcularGiro(products, sales, periodFromPreset("90d")).filter(
    g => g.daysSinceLastSale === null || g.daysSinceLastSale >= thresholdDays
  );
}

/** Heatmap: dia da semana × semana */
export interface HeatmapCell {
  weekIndex: number;
  weekday: number; // 0 = Dom
  date: string;
  count: number;
  revenue: number;
}

export function gerarHeatmap(sales: Sale[], period: Period): HeatmapCell[] {
  const map = new Map<string, HeatmapCell>();
  const totalDays = differenceInCalendarDays(period.end, period.start) + 1;
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(period.start, i);
    const key = format(d, "yyyy-MM-dd");
    map.set(key, {
      weekIndex: Math.floor(i / 7),
      weekday: d.getDay(),
      date: key,
      count: 0,
      revenue: 0,
    });
  }
  for (const s of sales) {
    if (!venda(s)) continue;
    const key = s.date.slice(0, 10);
    const cell = map.get(key);
    if (cell) {
      cell.count += s.quantity;
      cell.revenue += s.totalPrice;
    }
  }
  return Array.from(map.values());
}

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface Insight { icon: "trend-up" | "trend-down" | "calendar" | "tag" | "alert"; text: string; }

export function gerarInsights(products: Product[], sales: Sale[], period: Period): Insight[] {
  const insights: Insight[] = [];

  // Crescimento por produto: período atual vs período anterior do mesmo tamanho
  const periodDays = differenceInCalendarDays(period.end, period.start) + 1;
  const prev: Period = { start: addDays(period.start, -periodDays), end: addDays(period.start, -1) };
  const growth = products.map(p => {
    const cur = sales.filter(s => venda(s) && s.productId === p.id && inPeriod(s.date, period)).reduce((a, s) => a + s.quantity, 0);
    const before = sales.filter(s => venda(s) && s.productId === p.id && inPeriod(s.date, prev)).reduce((a, s) => a + s.quantity, 0);
    const delta = before === 0 ? (cur > 0 ? 100 : 0) : ((cur - before) / before) * 100;
    return { product: p, cur, before, delta };
  }).filter(g => g.cur + g.before > 0);

  const top = [...growth].sort((a, b) => b.delta - a.delta)[0];
  if (top && top.delta > 0) {
    insights.push({ icon: "trend-up", text: `${top.product.model} * ${top.product.flavor} teve aumento de ${top.delta.toFixed(0)}% nas vendas vs período anterior.` });
  }
  const worst = [...growth].sort((a, b) => a.delta - b.delta)[0];
  if (worst && worst.delta < -10) {
    insights.push({ icon: "trend-down", text: `${worst.product.model} * ${worst.product.flavor} caiu ${Math.abs(worst.delta).toFixed(0)}% nas vendas.` });
  }

  // Melhor dia da semana por faturamento
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sales) {
    if (!venda(s) || !inPeriod(s.date, period)) continue;
    byWeekday[parseISO(s.date).getDay()] += s.totalPrice;
  }
  const maxWd = byWeekday.indexOf(Math.max(...byWeekday));
  if (byWeekday[maxWd] > 0) {
    insights.push({ icon: "calendar", text: `${WEEKDAY_LABELS[maxWd]} é o melhor dia para vendas no período.` });
  }

  // Marca com melhor margem média
  const byBrand = new Map<string, { sum: number; n: number }>();
  for (const p of products) {
    if (!p.brand) continue;
    const m = p.salePrice > 0 ? ((p.salePrice - p.purchasePrice) / p.salePrice) * 100 : 0;
    const cur = byBrand.get(p.brand) ?? { sum: 0, n: 0 };
    cur.sum += m; cur.n += 1;
    byBrand.set(p.brand, cur);
  }
  let bestBrand: { brand: string; avg: number } | null = null;
  byBrand.forEach((v, brand) => {
    const avg = v.sum / v.n;
    if (!bestBrand || avg > bestBrand.avg) bestBrand = { brand, avg };
  });
  if (bestBrand) {
    insights.push({ icon: "tag", text: `Marca ${bestBrand.brand} possui a melhor margem média (${bestBrand.avg.toFixed(0)}%).` });
  }

  // Produto urgente
  const urg = preverReposicao(products, sales).filter(r => r.status === "urgente").sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (urg) {
    insights.push({ icon: "alert", text: `${urg.product.model} * ${urg.product.flavor} acaba em ${Math.ceil(urg.daysLeft)} dias no ritmo atual.` });
  }

  return insights;
}

export type AlertSeverity = "info" | "warning" | "danger";
export interface AlertItem { severity: AlertSeverity; title: string; detail: string; }

export function gerarAlertas(products: Product[], sales: Sale[]): AlertItem[] {
  const alerts: AlertItem[] = [];
  const rep = preverReposicao(products, sales);
  for (const r of rep) {
    if (r.status === "urgente") {
      alerts.push({ severity: "danger", title: `Repor urgente: ${r.product.model} * ${r.product.flavor}`, detail: `Acaba em ~${Math.ceil(r.daysLeft)} dias. Sugestão: comprar ${r.suggested} un.` });
    } else if (r.status === "alta_demanda") {
      alerts.push({ severity: "warning", title: `Alta demanda: ${r.product.model} * ${r.product.flavor}`, detail: `Vendas subiram ${r.trend.delta.toFixed(0)}% na última semana.` });
    } else if (r.status === "parado" && r.product.stock > 0) {
      alerts.push({ severity: "info", title: `Sem saída: ${r.product.model} * ${r.product.flavor}`, detail: `Sem vendas nos últimos 30 dias (${r.product.stock} un. em estoque).` });
    }
  }
  // Margem ruim
  for (const p of products) {
    if (p.salePrice > 0 && p.stock > 0) {
      const m = (p.salePrice - p.purchasePrice) / p.salePrice;
      if (m < 0.1) alerts.push({ severity: "warning", title: `Margem baixa: ${p.model} * ${p.flavor}`, detail: `Margem de apenas ${(m * 100).toFixed(0)}%.` });
    }
  }
  return alerts;
}

export function bestSellerInPeriod(sales: Sale[], sellers: Seller[], period: Period) {
  const totals = new Map<string, number>();
  for (const s of sales) {
    if (!venda(s) || !s.sellerId || !inPeriod(s.date, period)) continue;
    totals.set(s.sellerId, (totals.get(s.sellerId) ?? 0) + s.totalPrice);
  }
  let best: { seller: Seller; revenue: number } | null = null;
  totals.forEach((revenue, id) => {
    const seller = sellers.find(x => x.id === id);
    if (seller && (!best || revenue > best.revenue)) best = { seller, revenue };
  });
  return best;
}
