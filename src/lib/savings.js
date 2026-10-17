// Savings helpers for the canonical purchase shape. Amounts are dollars.
// These pure functions have no chrome.* or DOM dependencies.

const DEBUG = false;
const isNonNegativeAmount = (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0;

/** Calculate realized savings from original and paid dollar amounts. */
export function calculateSavings(originalTotal, paidTotal) {
  if (!isNonNegativeAmount(originalTotal) || !isNonNegativeAmount(paidTotal)) {
    throw new TypeError("Prices must be non-negative dollar amounts");
  }
  return Math.round(Math.max(0, originalTotal - paidTotal) * 100) / 100;
}

function reject(purchase, reason) {
  if (DEBUG) console.warn(`[savings] excluded purchase ${purchase?.id ?? "(no id)"}: ${reason}`);
  return false;
}

/** True when a purchase from the confirmed purchases list has the expected shape. */
export function isValidPurchase(purchase) {
  if (purchase === null || typeof purchase !== "object") return reject(purchase, "not an object");
  if (typeof purchase.id !== "string" || purchase.id.trim() === "") return reject(purchase, "bad id");
  if (typeof purchase.title !== "string" || purchase.title.trim() === "") return reject(purchase, "bad title");
  if (!isNonNegativeAmount(purchase.pricePaid)) return reject(purchase, "bad pricePaid");
  if (!isNonNegativeAmount(purchase.savings)) return reject(purchase, "bad savings");
  if (typeof purchase.purchaseDate !== "string" || Number.isNaN(Date.parse(purchase.purchaseDate)))
    return reject(purchase, "bad purchaseDate");
  return true;
}

/**
 * Valid purchases from the canonical confirmed list. Pending records are held
 * separately, so no status field is required. Returns a new array.
 */
export function getConfirmedPurchases(purchases) {
  if (!Array.isArray(purchases)) return [];
  return purchases.filter(isValidPurchase);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCurrency(dollars) {
  return usd.format(Number.isFinite(dollars) ? dollars : 0);
}