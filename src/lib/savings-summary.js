// Savings summary derived from the canonical purchase list.
import { getConfirmedPurchases } from "./savings.js";
import { getStats } from "./purchases.js";

export function getTotalSavings(purchases) {
  return getSavingsSummary(purchases).totalSaved;
}

export function getPurchaseCount(purchases) {
  return getSavingsSummary(purchases).purchaseCount;
}

/** Average savings in dollars, rounded to cents. */
export function getAverageSavings(purchases) {
  const { totalSaved, purchaseCount } = getSavingsSummary(purchases);
  return purchaseCount ? Math.round(totalSaved * 100 / purchaseCount) / 100 : 0;
}

/** Newest first by purchase date. Sorts a copy; ties keep original order. */
export function getRecentSavings(purchases, limit = 5) {
  return getConfirmedPurchases(purchases)
    .sort((a, b) => Date.parse(b.purchaseDate) - Date.parse(a.purchaseDate))
    .slice(0, Math.max(0, limit));
}

export function getSavingsSummary(purchases) {
  const validPurchases = getConfirmedPurchases(purchases);
  const { totalSaved, totalItems } = getStats(validPurchases);
  const recentPurchases = getRecentSavings(validPurchases, 5);
  return {
    totalSaved,
    purchaseCount: totalItems,
    averageSaved: totalItems ? Math.round(totalSaved * 100 / totalItems) / 100 : 0,
    mostRecentSaved: recentPurchases[0]?.savings ?? 0,
    recentPurchases,
  };
}