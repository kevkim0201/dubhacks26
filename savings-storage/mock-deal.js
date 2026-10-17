// Phase 1 demo data for the current-product savings card. Nothing reads
// real product prices yet, so example.com (the same test store the coupon
// view uses -- see MOCK_COUPONS in src/lib/coupons.js) gets a mock deal.
// Remove once a real price scraper calls saveCurrentDealSavings().
import { saveCurrentDealSavings } from "./savings-storage.js";

export const DEMO_HOST = "example.com";

// Matches the coupon view's demo: a $120 cart where POCKET20 saves $24.
export const MOCK_DEAL = {
  title: "Demo product",
  store: "Example Shop",
  originalPrice: 150,
  discountedPrice: 120,
  couponSavings: 24,
  couponCode: "POCKET20",
};

// Remembers that the demo deal was already handed out, so confirming or
// clearing it doesn't bring it back the next time the popup opens.
const SEEDED_KEY = "mockDealSeeded";

/**
 * Save MOCK_DEAL for `tabUrl` the first time the popup opens on the demo
 * store. After that it's never re-seeded, so a confirmed demo deal can't be
 * counted twice. Any other page is left alone.
 */
export async function seedMockDealIfDemo(tabUrl) {
  if (!tabUrl || hostOf(tabUrl) !== DEMO_HOST) return null;

  const { [SEEDED_KEY]: seeded } = await chrome.storage.local.get({
    [SEEDED_KEY]: false,
  });
  if (seeded) return null;

  const deal = await saveCurrentDealSavings({ ...MOCK_DEAL, url: tabUrl });
  await chrome.storage.local.set({ [SEEDED_KEY]: true });
  return deal;
}

/**
 * Let the demo deal be seeded again (e.g. before a fresh demo). Run from
 * the popup's DevTools console:
 *   (await import("../../savings-storage/mock-deal.js")).resetMockDeal()
 */
export async function resetMockDeal() {
  await chrome.storage.local.remove(SEEDED_KEY);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
