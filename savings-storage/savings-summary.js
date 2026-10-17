// savings-summary.js — pure statistics derived from the canonical purchase list.
// Nothing here is stored; totals are always recomputed so undo/delete just works.
import { getConfirmedPurchases } from "./savings.js";

export function getTotalSavings(purchases) {
  return getConfirmedPurchases(purchases).reduce((sum, p) => sum + p.savingsCents, 0);
}

export function getPurchaseCount(purchases) {
  return getConfirmedPurchases(purchases).length;
}

/** Average in whole cents (rounded). 0 when there are no purchases. */
export function getAverageSavings(purchases) {
  const confirmed = getConfirmedPurchases(purchases);
  if (confirmed.length === 0) return 0;
  return Math.round(confirmed.reduce((s, p) => s + p.savingsCents, 0) / confirmed.length);
}

/** Newest first. Sorts a copy; ties keep original order. */
export function getRecentSavings(purchases, limit = 5) {
  return getConfirmedPurchases(purchases)
    .sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt))
    .slice(0, Math.max(0, limit));
}

export function getSavingsSummary(purchases) {
  const confirmed = getConfirmedPurchases(purchases);
  const recentPurchases = getRecentSavings(confirmed, 5);
  const totalSavedCents = confirmed.reduce((s, p) => s + p.savingsCents, 0);
  return {
    totalSavedCents,
    purchaseCount: confirmed.length,
    averageSavedCents: confirmed.length ? Math.round(totalSavedCents / confirmed.length) : 0,
    mostRecentSavedCents: recentPurchases[0]?.savingsCents ?? 0,
    recentPurchases,
  };
}