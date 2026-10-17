// savings.js — validation, confirmed-record filtering, currency formatting.
// Money is always integer cents. Pure functions, no chrome.* or DOM access.

export const CONFIRMED_STATUSES = ["self_reported", "verified"]; // agree with Deetya
export const SUPPORTED_CURRENCY = "USD";
export const DEBUG = false; // flip to true in development to see why records are rejected

function reject(purchase, reason) {
  if (DEBUG) console.warn(`[savings] excluded purchase ${purchase?.id ?? "(no id)"}: ${reason}`);
  return false;
}

const isCents = (n) => Number.isSafeInteger(n) && n >= 0;

/** True only if the record is well-formed AND counts as realized savings. */
export function isValidPurchase(purchase) {
  if (purchase === null || typeof purchase !== "object") return reject(purchase, "not an object");
  if (typeof purchase.id !== "string" || purchase.id.trim() === "") return reject(purchase, "bad id");
  if (!isCents(purchase.originalTotalCents)) return reject(purchase, "bad originalTotalCents");
  if (!isCents(purchase.paidTotalCents)) return reject(purchase, "bad paidTotalCents");
  if (!isCents(purchase.savingsCents)) return reject(purchase, "bad savingsCents");
  const expected = Math.max(0, purchase.originalTotalCents - purchase.paidTotalCents);
  if (purchase.savingsCents !== expected) return reject(purchase, `savingsCents ${purchase.savingsCents} != ${expected}`);
  if (purchase.currency !== SUPPORTED_CURRENCY) return reject(purchase, "unsupported currency");
  if (typeof purchase.purchasedAt !== "string" || Number.isNaN(Date.parse(purchase.purchasedAt)))
    return reject(purchase, "bad purchasedAt");
  if (!CONFIRMED_STATUSES.includes(purchase.status)) return reject(purchase, `status "${purchase.status}" not confirmed`);
  return true;
}

/**
 * Valid, confirmed purchases only. Duplicate IDs: the FIRST valid occurrence wins.
 * Returns a new array; never mutates the input.
 */
export function getConfirmedPurchases(purchases) {
  if (!Array.isArray(purchases)) return [];
  const seen = new Set();
  const result = [];
  for (const p of purchases) {
    if (!isValidPurchase(p)) continue;
    if (seen.has(p.id)) {
      if (DEBUG) console.warn(`[savings] duplicate id ignored: ${p.id}`);
      continue;
    }
    seen.add(p.id);
    result.push(p);
  }
  return result;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCurrency(cents) {
  return usd.format((Number.isFinite(cents) ? cents : 0) / 100);
}