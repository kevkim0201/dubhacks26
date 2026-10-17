import {
  addPurchase,
  getPurchases as getStoredPurchases,
} from "../src/lib/purchases.js";

const DEAL_KEY = "currentDealSavings";
// Confirmed purchases are owned by src/lib/purchases.js (William's format,
// in dollars). This module reads and writes them through that file so the
// popup stats, dashboard and character XP all share one list.
const PURCHASES_KEY = "purchases";

/**
 * Load the currently displayed product's savings calculation.
 * Returns null if no deal has been saved yet.
 */
export async function getCurrentDealSavings() {
  const result = await chrome.storage.local.get({
    [DEAL_KEY]: null,
  });

  return result[DEAL_KEY];
}

/**
 * Save or replace the current product's savings calculation.
 */
export async function saveCurrentDealSavings(deal) {
  if (!deal || typeof deal !== "object") {
    throw new TypeError("A deal object is required.");
  }

  const {
    originalPrice,
    discountedPrice,
    couponSavings = 0,
  } = deal;

  for (const [name, value] of Object.entries({
    originalPrice,
    discountedPrice,
    couponSavings,
  })) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new TypeError(`${name} must be a non-negative number.`);
    }
  }

  if (discountedPrice > originalPrice) {
    throw new RangeError(
      "Discounted price cannot exceed original price."
    );
  }

  if (couponSavings > discountedPrice) {
    throw new RangeError(
      "Coupon savings cannot exceed discounted price."
    );
  }

  const potentialSavings = Math.max(
    0,
    originalPrice - discountedPrice + couponSavings
  );

  const savedDeal = {
    ...deal,
    couponSavings,
    potentialSavings: Number(potentialSavings.toFixed(2)),
    updatedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [DEAL_KEY]: savedDeal,
  });

  return savedDeal;
}

/**
 * Subscribe to changes made by this extension's other views.
 * Returns an unsubscribe function.
 */
export function onCurrentDealSavingsChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== "local" || !changes[DEAL_KEY]) {
      return;
    }

    callback(changes[DEAL_KEY].newValue ?? null);
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Clear the current deal when the product changes or is no longer relevant.
 */
export async function clearCurrentDealSavings() {
  await chrome.storage.local.remove(DEAL_KEY);
}

// ======================== Confirmed purchases ========================

/**
 * Load every confirmed purchase, newest first.
 * Shape: { id, title, store, url, pricePaid, savings, purchaseDate, ... }
 * Pending (auto-detected, unconfirmed) purchases are stored separately and
 * are never included.
 */
export async function getPurchases() {
  return getStoredPurchases();
}

/**
 * Save a confirmed purchase. `pricePaid` and `savings` are in dollars.
 * Returns the stored record (with its generated id).
 */
export async function savePurchase(purchase) {
  if (!purchase || typeof purchase !== "object") {
    throw new TypeError("A purchase object is required.");
  }

  const { title, pricePaid, savings = 0 } = purchase;

  if (typeof title !== "string" || title.trim() === "") {
    throw new TypeError("title must be a non-empty string.");
  }

  for (const [name, value] of Object.entries({ pricePaid, savings })) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new TypeError(`${name} must be a non-negative number.`);
    }
  }

  return addPurchase({ ...purchase, savings });
}

/**
 * Turn the current deal into a confirmed purchase (e.g. after checkout),
 * then clear it so potential savings are never counted twice.
 * Returns the stored purchase, or null if there was no current deal.
 */
export async function confirmCurrentDeal({ title, purchaseDate } = {}) {
  const deal = await getCurrentDealSavings();
  if (!deal) return null;

  const pricePaid = Number(
    (deal.discountedPrice - deal.couponSavings).toFixed(2)
  );

  const purchase = await savePurchase({
    title: title || deal.title || "Purchase",
    store: deal.store,
    url: deal.url,
    pricePaid,
    savings: deal.potentialSavings,
    purchaseDate,
    source: "deal",
  });

  await clearCurrentDealSavings();
  return purchase;
}

/**
 * Subscribe to changes in the confirmed purchase list. The callback gets
 * no arguments -- re-read through getPurchases() so storage stays the
 * single source of truth. Returns an unsubscribe function.
 */
export function onPurchasesChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== "local" || !changes[PURCHASES_KEY]) {
      return;
    }

    callback();
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
