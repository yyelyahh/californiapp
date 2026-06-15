import type { Sale } from "@/types";

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
