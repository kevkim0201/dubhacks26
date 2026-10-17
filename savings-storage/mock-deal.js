// Phase 1 demo data for the current-product savings card. Nothing reads
// real product prices yet, so example.com (the same test store the coupon
// view uses -- see MOCK_COUPONS in src/lib/coupons.js) gets a mock deal.
// Remove once a real price scraper calls saveCurrentDealSavings().
import {
  getCurrentDealSavings,
  saveCurrentDealSavings,
} from "./savings-storage.js";

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

/**
 * Save MOCK_DEAL for `tabUrl` when it's on the demo store and the page
 * doesn't already have a deal. Any other page is left alone.
 */
export async function seedMockDealIfDemo(tabUrl) {
  if (!tabUrl || hostOf(tabUrl) !== DEMO_HOST) return null;

  const existing = await getCurrentDealSavings();
  if (existing?.url === tabUrl) return existing;

  return saveCurrentDealSavings({ ...MOCK_DEAL, url: tabUrl });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
