
const DEAL_KEY = "currentDealSavings";

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
