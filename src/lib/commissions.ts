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
  /**
   * Projeção: trata TODA venda como quitada, não só as que já foram pagas.
   * A comissão é apurada por mês fechado, então a venda em aberto entra no
   * fechamento do mês em que foi FEITA — é o mesmo que assumir o pagamento no
   * dia da venda. Sem isso, receber uma venda velha não mexeria em faixa
   * nenhuma e o saldo projetado sairia menor do que vai ser de verdade.
   */
  assumePaid?: boolean;
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
  const { sellerId, sales, commissionPayments, debtPayments, manualDebts, historyStart, periodStart, assumePaid } = input;
  const priorEnd = new Date(periodStart.getTime() - 1);
  if (priorEnd <= historyStart) return 0;

  const sellerSales = sales.filter(s => s.sellerId === sellerId);

  const paidSales = sellerSales.filter(
    s => s.type === "venda" && (assumePaid || isPaidSale(s)) && new Date(s.date) >= historyStart,
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
 * Consumo do vendedor (retiradas + dívidas manuais − pagamentos)
 * ------------------------------------------------------------------ *
 * Dois recortes convivem aqui de propósito:
 *
 * - `periodTotal` é o consumo LANÇADO no período consultado — é o número
 *   que o vendedor vê no card, porque "consumi tanto este mês" é a
 *   pergunta que ele faz.
 * - `openTotal` é ACUMULADO desde o início do histórico: é a dívida que
 *   ele ainda tem, e ela não zera na virada do mês.
 *
 * Os pagamentos de dívida (`sellerDebtPayments`) são lançamentos soltos,
 * sem vínculo com um item específico, então a quitação é imputada em
 * FIFO — do lançamento mais antigo para o mais novo. É isso que decide
 * quais itens de meses anteriores continuam aparecendo na lista: item
 * que ainda tem saldo não sai dali até ser pago.
 */
export type ConsumptionEntry = {
  id: string;
  kind: "retirada" | "divida";
  date: string;
  /** Valor lançado. */
  amount: number;
  /** Quanto ainda falta pagar deste item, depois da imputação FIFO. */
  remaining: number;
  /** Caiu dentro do período consultado. */
  inPeriod: boolean;
  /** A retirada original, quando `kind === "retirada"`. */
  sale?: Sale;
  /** A dívida original, quando `kind === "divida"`. */
  debt?: SellerManualDebt;
};

export type SellerConsumption = {
  /** Retiradas do vendedor, mais recentes primeiro. */
  retiradas: Sale[];
  retiradasTotal: number;
  manualDebts: SellerManualDebt[];
  manualDebtsTotal: number;
  debtPaymentsTotal: number;
  /** Retiradas + dívidas manuais, acumulado. */
  consumoTotal: number;
  /** consumoTotal − pagamentos de dívida já feitos. */
  openTotal: number;
  /** Todo o consumo como lançamentos, mais recentes primeiro. */
  entries: ConsumptionEntry[];
  /** O que aparece na lista: o do período + o que ficou em aberto fora dele. */
  visible: ConsumptionEntry[];
  /** Consumo lançado dentro do período. */
  periodTotal: number;
  /** Quanto do consumo do período ainda falta pagar. */
  periodOpen: number;
  /** O que falta dos outros meses (openTotal − periodOpen). */
  otherOpen: number;
};

export function computeSellerConsumption(
  sellerId: string,
  input: {
    sales: Sale[];
    sellerManualDebts: SellerManualDebt[];
    sellerDebtPayments: SellerDebtPayment[];
    /** Início válido do histórico. Padrão: PROJECT_START. */
    since?: Date;
    /** Recorte do card. Sem ele, período = histórico inteiro. */
    start?: Date;
    end?: Date;
  },
): SellerConsumption {
  const { sales, sellerManualDebts, sellerDebtPayments, since = PROJECT_START, start, end } = input;
  const afterStart = (iso: string) => {
    if (!iso) return false;
    const d = new Date(iso);
    return !isNaN(d.getTime()) && d >= since;
  };
  const inPeriod = (iso: string) => {
    if (!start || !end) return true;
    const d = new Date(iso);
    return !isNaN(d.getTime()) && d >= start && d <= end;
  };

  const retiradas = sales
    .filter(s => s.sellerId === sellerId && s.type === "retirada_funcionario" && afterStart(s.date))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const retiradasTotal = retiradas.reduce((a, s) => a + s.totalPrice, 0);

  const manualDebts = sellerManualDebts
    .filter(d => d.sellerId === sellerId && afterStart(d.date))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const manualDebtsTotal = manualDebts.reduce((a, d) => a + d.amount, 0);

  const debtPaymentsTotal = sellerDebtPayments
    .filter(p => p.sellerId === sellerId && afterStart(p.date))
    .reduce((a, p) => a + p.amount, 0);

  const consumoTotal = retiradasTotal + manualDebtsTotal;
  const openTotal = consumoTotal - debtPaymentsTotal;

  // Imputação FIFO: o pagamento mais velho quita o lançamento mais velho.
  let pool = Math.max(0, debtPaymentsTotal);
  const entries: ConsumptionEntry[] = [
    ...retiradas.map<ConsumptionEntry>(s => ({
      id: s.id, kind: "retirada", date: s.date, amount: s.totalPrice,
      remaining: s.totalPrice, inPeriod: inPeriod(s.date), sale: s,
    })),
    ...manualDebts.map<ConsumptionEntry>(d => ({
      id: d.id, kind: "divida", date: d.date, amount: d.amount,
      remaining: d.amount, inPeriod: inPeriod(d.date), debt: d,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const e of entries) {
    const applied = Math.min(pool, e.amount);
    pool -= applied;
    e.remaining = e.amount - applied;
  }
  entries.reverse(); // volta para "mais recente primeiro"

  const periodTotal = entries.filter(e => e.inPeriod).reduce((a, e) => a + e.amount, 0);
  const periodOpen = entries.filter(e => e.inPeriod).reduce((a, e) => a + e.remaining, 0);

  return {
    retiradas, retiradasTotal,
    manualDebts, manualDebtsTotal,
    debtPaymentsTotal, consumoTotal,
    openTotal,
    entries,
    visible: entries.filter(e => e.inPeriod || e.remaining > 0.01),
    periodTotal, periodOpen,
    otherOpen: openTotal - periodOpen,
  };
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

  // Projeção: o saldo que este vendedor tem DEPOIS de receber tudo o que está
  // em aberto — de qualquer mês, não só do período. A comissão só é apurada
  // sobre venda quitada, então a venda em aberto hoje não conta nem no valor
  // nem nas unidades que definem a faixa; é justamente ela que pode empurrar o
  // vendedor para a faixa de cima. Aqui as mesmas vendas entram pelo valor de
  // venda normal (`totalPrice`, não o que já foi recebido) e no fechamento do
  // mês em que foram FEITAS — o mesmo que assumir o pagamento no dia da venda.
  const vendasTodas = sales.filter(s =>
    s.sellerId === seller.id && s.type === "venda" && !isLegacy(s.date)
  );
  const projected = computeClosedCommission(vendasTodas, start, end);
  const projectedAccrued = projected.accrued;
  const projectedUnits = projected.units;
  const projectedTier = projected.tier;
  // Tudo o que ainda falta entrar no bolso (soma dos saldos, não do valor cheio).
  const pendingToReceive = vendasTodas
    .filter(s => (s.paidAmount || 0) < s.totalPrice - 0.01)
    .reduce((a, s) => a + (s.totalPrice - (s.paidAmount || 0)), 0);

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

  // O mesmo saldo, mas com todo mundo pago. `assumePaid` recalcula o histórico
  // anterior ao período pela mesma regra, senão receber uma venda de julho não
  // apareceria em lugar nenhum na tela de agosto.
  const projectedPeriodBalance = projectedAccrued - saldoConsumo + debtPaymentsTotal - commPaid;
  const projectedPriorBalance = computePriorCommissionBalance({
    sellerId: seller.id,
    sales,
    commissionPayments,
    debtPayments: sellerDebtPayments,
    manualDebts: sellerManualDebts,
    historyStart: PROJECT_START,
    periodStart: closedStart,
    assumePaid: true,
  });
  const projectedBalance = projectedPriorBalance + projectedPeriodBalance;

  return {
    seller, units, vendasTotal, commPaid,
    accrued, baseAccrued, adjustmentsTotal,
    tier: c.tier, balance, accrualItems,
    projectedAccrued, projectedUnits, projectedTier, pendingToReceive,
    projectedBalance, projectedPriorBalance, projectedPeriodBalance,
    consumoTotal, debtPaymentsTotal, legacyCredit, saldoConsumo,
    retiradasTotal, manualDebtsTotal, retiradasCount,
    periodBalance, priorBalance,
  };
}
