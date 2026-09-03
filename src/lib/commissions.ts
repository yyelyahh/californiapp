import type { Sale, Seller, CommissionPayment, SellerDebtPayment, SellerManualDebt } from "@/types";

// Cutoff legado: tudo antes de 01/06/2026 é tratado como legado (10% de comissão, só abate consumo).
// Mesma data usada em CommissionsPage.tsx (LEGACY_CUTOFF / PROJECT_START).
export const PROJECT_START = new Date(2026, 5, 1);

export type CommissionTier = {
  label: string;
  rate: number; // decimal (0.10, 0.125, 0.15)
  min: number; // minimum unidades to be in this tier
  max: number | null; // null = no upper bound
};

export const COMMISSION_TIERS: CommissionTier[] = [
  { label: "10%", rate: 0.10, min: 0, max: 10 },
  { label: "12,5%", rate: 0.125, min: 11, max: 15 },
  { label: "15%", rate: 0.15, min: 16, max: null },
];

export function getTierForUnits(units: number): CommissionTier {
  for (const t of COMMISSION_TIERS) {
    if (units >= t.min && (t.max === null || units <= t.max)) return t;
  }
  return COMMISSION_TIERS[0];
}

export function getNextTier(currentTier: CommissionTier): CommissionTier | null {
  const idx = COMMISSION_TIERS.findIndex(t => t.rate === currentTier.rate);
  if (idx === -1 || idx === COMMISSION_TIERS.length - 1) return null;
  return COMMISSION_TIERS[idx + 1];
}

export function unitsUntilNextTier(units: number): number | null {
  const current = getTierForUnits(units);
  const next = getNextTier(current);
  if (!next) return null;
  return Math.max(0, next.min - units);
}

export function progressToNextTier(units: number): number {
  const current = getTierForUnits(units);
  const next = getNextTier(current);
  if (!next) return 100;
  const span = next.min - current.min;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, ((units - current.min) / span) * 100));
}

export function computeSellerCommission(salesInPeriod: Sale[]) {
  const units = salesInPeriod.reduce((s, x) => s + x.quantity, 0);
  const revenue = salesInPeriod.reduce((s, x) => s + x.totalPrice, 0);
  const tier = getTierForUnits(units);
  const accrued = revenue * tier.rate;
  return { units, revenue, tier, accrued };
}

/**
 * Fechamento mensal da comissão.
 * A faixa (tier) é apurada por MÊS FECHADO: as unidades acumulam do dia 1 ao
 * último dia do mês. Quando um período personalizado é selecionado, o valor
 * retornado é o valor FECHADO dos meses tocados pelo período — e não apenas o
 * das vendas que caem dentro do recorte de dias escolhido.
 */
export type CommissionMonthGroup = {
  key: string; // YYYY-MM
  start: Date;
  end: Date;
  sales: Sale[];
  units: number;
  revenue: number;
  tier: CommissionTier;
  accrued: number;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function computeClosedCommission(
  paidSales: Sale[],
  start: Date,
  end: Date,
  getDate: (s: Sale) => string = (s) => s.date,
) {
  const wanted = new Set<string>();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    wanted.add(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const byMonth = new Map<string, Sale[]>();
  for (const s of paidSales) {
    const raw = getDate(s);
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const k = monthKey(d);
    if (!wanted.has(k)) continue;
    const arr = byMonth.get(k) || [];
    arr.push(s);
    byMonth.set(k, arr);
  }

  const groups: CommissionMonthGroup[] = Array.from(wanted)
    .sort()
    .map((k) => {
      const [y, m] = k.split("-").map(Number);
      const sales = (byMonth.get(k) || []).sort(
        (a, b) => new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime(),
      );
      const units = sales.reduce((a, s) => a + s.quantity, 0);
      const revenue = sales.reduce((a, s) => a + s.totalPrice, 0);
      const tier = getTierForUnits(units);
      return {
        key: k,
        start: new Date(y, m - 1, 1),
        end: new Date(y, m, 0, 23, 59, 59, 999),
        sales,
        units,
        revenue,
        tier,
        accrued: revenue * tier.rate,
      };
    })
    .filter((g) => g.sales.length > 0);

  const units = groups.reduce((a, g) => a + g.units, 0);
  const revenue = groups.reduce((a, g) => a + g.revenue, 0);
  const accrued = groups.reduce((a, g) => a + g.accrued, 0);
  const sales = groups.flatMap((g) => g.sales);
  const tier = groups.length ? groups[groups.length - 1].tier : getTierForUnits(0);

  return { units, revenue, accrued, tier, groups, sales };
}

/* ------------------------------------------------------------------ *
 * Saldo acumulado de comissão do vendedor
 * ------------------------------------------------------------------ *
 * O saldo de um período nunca "zera": o que sobrou (ou faltou) dos
 * meses anteriores é recalculado a partir do histórico real das
 * movimentações (comissão gerada, consumo, comissão paga e pagamentos
 * de dívida) desde o início válido do histórico até o instante
 * imediatamente anterior ao início do período consultado.
 * Como o recorte anterior termina onde o período começa, nenhuma
 * movimentação é contada duas vezes.
 */
export type LedgerEntry = { sellerId?: string; amount: number; date: string };

export type SellerLedgerInput = {
  sellerId: string;
  sales: Sale[];
  commissionPayments: LedgerEntry[];
  debtPayments: LedgerEntry[];
  manualDebts: LedgerEntry[];
  /** Início válido do histórico (ex.: 01/06/2026). */
  historyStart: Date;
  /** Início do período consultado (dia 1 do mês inicial). */
  periodStart: Date;
};

function inRange(iso: string, from: Date, to: Date) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d >= from && d <= to;
}

function isPaidSale(s: Sale) {
  return (s.paidAmount || 0) >= s.totalPrice - 0.01;
}

/** Saldo de comissão acumulado ANTES do início do período consultado. */
export function computePriorCommissionBalance(input: SellerLedgerInput): number {
  const { sellerId, sales, commissionPayments, debtPayments, manualDebts, historyStart, periodStart } = input;
  const priorEnd = new Date(periodStart.getTime() - 1);
  if (priorEnd <= historyStart) return 0;

  const sellerSales = sales.filter(s => s.sellerId === sellerId);

  const paidSales = sellerSales.filter(
    s => s.type === "venda" && isPaidSale(s) && new Date(s.date) >= historyStart,
  );
  const accrued = computeClosedCommission(paidSales, historyStart, priorEnd).accrued;

  const consumo =
    sellerSales
      .filter(s => s.type === "retirada_funcionario" && inRange(s.date, historyStart, priorEnd))
      .reduce((a, s) => a + s.totalPrice, 0) +
    manualDebts
      .filter(d => (!d.sellerId || d.sellerId === sellerId) && inRange(d.date, historyStart, priorEnd))
      .reduce((a, d) => a + d.amount, 0);

  const commPaid = commissionPayments
    .filter(p => (!p.sellerId || p.sellerId === sellerId) && inRange(p.date, historyStart, priorEnd))
    .reduce((a, p) => a + p.amount, 0);

  const debtPaid = debtPayments
    .filter(p => (!p.sellerId || p.sellerId === sellerId) && inRange(p.date, historyStart, priorEnd))
    .reduce((a, p) => a + p.amount, 0);

  return accrued - consumo + debtPaid - commPaid;
}

export function computeAccrualHistory(sales: Sale[]) {
  const sorted = [...sales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const items: {
    id: string; when: string; label: string; amount: number;
    kind: "accrual" | "adjustment"; meta?: string;
  }[] = [];
  let cumUnits = 0;
  let cumRevenue = 0;
  let currentRate = COMMISSION_TIERS[0].rate;
  for (const s of sorted) {
    const priorRevenue = cumRevenue;
    cumUnits += s.quantity;
    cumRevenue += s.totalPrice;
    const tierAfter = getTierForUnits(cumUnits);
    if (tierAfter.rate > currentRate) {
      const adjustment = priorRevenue * (tierAfter.rate - currentRate);
      if (adjustment > 0.001) {
        items.push({
          id: `adj-${s.id}`,
          when: s.date,
          label: `Ajuste de Faixa → ${tierAfter.label}`,
          amount: adjustment,
          kind: "adjustment",
          meta: "Recálculo retroativo à nova taxa",
        });
      }
      currentRate = tierAfter.rate;
    }
    items.push({
      id: `acc-${s.id}`,
      when: s.date,
      label: `Comissão da venda (${s.quantity} un.)`,
      amount: s.totalPrice * currentRate,
      kind: "accrual",
      meta: `Taxa: ${(currentRate * 100).toFixed(currentRate === 0.125 ? 1 : 0)}%`,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Saldo do vendedor num período (unidades, comissão, dívidas, saldo)
 * ------------------------------------------------------------------ */
export type SellerBalanceContext = {
  sales: Sale[];
  commissionPayments: CommissionPayment[];
  sellerDebtPayments: SellerDebtPayment[];
  sellerManualDebts: SellerManualDebt[];
  start: Date;
  end: Date;
  closedStart: Date;
  PROJECT_START: Date;
  isLegacy: (iso: string) => boolean;
  inClosedPeriod: (iso: string) => boolean;
};

export function computeSellerBalance(seller: Seller, ctx: SellerBalanceContext) {
  const {
    sales, commissionPayments, sellerDebtPayments, sellerManualDebts,
    start, end, closedStart, PROJECT_START, isLegacy, inClosedPeriod,
  } = ctx;

  const salesPeriod = sales.filter(s => inClosedPeriod(s.date) && !isLegacy(s.date));
  const sellerSales = salesPeriod.filter(s => s.sellerId === seller.id);
  const vendas = sellerSales.filter(s => s.type === "venda");
  // Comissão fecha no último dia do mês: a faixa acumula do dia 1 ao dia 30/31.
  // Num período personalizado, mostramos o valor FECHADO dos meses tocados.
  const vendasPagasTodas = sales.filter(s =>
    s.sellerId === seller.id &&
    s.type === "venda" &&
    (s.paidAmount || 0) >= s.totalPrice - 0.01 &&
    !isLegacy(s.date)
  );
  const closed = computeClosedCommission(vendasPagasTodas, start, end);
  const vendasPagas = closed.sales;
  const vendasTotal = vendas.reduce((a, s) => a + s.totalPrice, 0);
  const commPaid = commissionPayments.filter(p => p.sellerId === seller.id && inClosedPeriod(p.date) && !isLegacy(p.date)).reduce((a, p) => a + p.amount, 0);

  const c = { tier: closed.tier };
  const accrued = closed.accrued;
  const units = closed.units;

  const accrualItems = closed.groups.flatMap(g => computeAccrualHistory(g.sales));
  const adjustmentsTotal = accrualItems.filter(i => i.kind === "adjustment").reduce((a, x) => a + x.amount, 0);
  const baseAccrued = accrued - adjustmentsTotal;

  const retiradas = sellerSales.filter(s => s.type === "retirada_funcionario");
  const retiradasTotal = retiradas.reduce((a, s) => a + s.totalPrice, 0);
  const manualDebts = sellerManualDebts.filter(d => d.sellerId === seller.id && inClosedPeriod(d.date) && !isLegacy(d.date));
  const manualDebtsTotal = manualDebts.reduce((a, d) => a + d.amount, 0);
  const consumoTotal = retiradasTotal + manualDebtsTotal;
  const debtPaymentsTotal = sellerDebtPayments.filter(p => p.sellerId === seller.id && inClosedPeriod(p.date) && !isLegacy(p.date)).reduce((a, p) => a + p.amount, 0);

  const legacyCredit = 0;
  const saldoConsumo = consumoTotal;
  const retiradasCount = retiradas.length + manualDebts.length;

  const periodBalance = accrued - saldoConsumo + debtPaymentsTotal - commPaid;
  // Saldo trazido dos meses anteriores (recalculado do histórico real).
  const priorBalance = computePriorCommissionBalance({
    sellerId: seller.id,
    sales,
    commissionPayments,
    debtPayments: sellerDebtPayments,
    manualDebts: sellerManualDebts,
    historyStart: PROJECT_START,
    periodStart: closedStart,
  });
  const balance = priorBalance + periodBalance;

  return {
    seller, units, vendasTotal, commPaid,
    accrued, baseAccrued, adjustmentsTotal,
    tier: c.tier, balance, accrualItems,
    consumoTotal, debtPaymentsTotal, legacyCredit, saldoConsumo,
    retiradasTotal, manualDebtsTotal, retiradasCount,
    periodBalance, priorBalance,
  };
}
