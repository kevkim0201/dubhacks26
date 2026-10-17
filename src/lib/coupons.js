// Savings-maximization: coupon search + validation.
// Owned by: Rohit + team.
import { selectFrom, insertInto } from './supabase.js';
import { resolveStoreFromUrl } from './store-matcher.js';

/**
 * Find candidate coupon codes for the given store/page using Honey store resolution.
 * @param {{ store?: string, url?: string }} params
 * @returns {Promise<Coupon[]>}
 */
export async function searchCoupons({ store, url } = {}) {
  // Use Honey store resolution to canonicalize the store domain and ID
  const resolved = resolveStoreFromUrl(url || store);
  const canonicalStore = resolved?.domain || store?.replace(/^www\./, '') || 'unknown';

  try {
    // Query Supabase seeded table, filtering by canonical store domain and sorting by success count
    const rows = await selectFrom('coupons', {
      filters: { store: canonicalStore },
      order: 'success_count.desc',
      limit: 10,
    });

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        store: r.store,
        code: r.code,
        description: r.description,
        discountType: r.discount_type || 'unknown',
        discountValue: r.discount_value,
        confidence: r.confidence || 0.5,
        resolvedStore: resolved,
      }));
    }
  } catch (err) {
    console.warn('[DubHacks26] Supabase fetch failed, falling back to mock data:', err);
  }

  // Fallback mock data if table isn't seeded or offline
  await new Promise((r) => setTimeout(r, 200));
  return MOCK_COUPONS.filter(
    (c) => c.store === canonicalStore || c.store === store || (resolved?.domain && c.store === resolved.domain),
  ).map((c) => ({ ...c, resolvedStore: resolved }));
}

/**
 * Check whether a specific code actually works for a given store/cart.
 * @param {{ code: string, store: string, cartTotal?: number }} params
 * @returns {Promise<ValidationResult>}
 */
export async function validateCoupon({ code, store }) {
  try {
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { valid: false, reason: 'No active tab found for validation' };
    }

    // 2. Execute coupon-finder.js injection on the active checkout tab
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (couponCode) => {
        // Calls the helper in src/content/coupon-finder.js injected on the page
        if (typeof window.__applyCouponToPage === 'function') {
          return window.__applyCouponToPage(couponCode);
        }
        return { success: false, reason: 'Coupon finder hook not found on page' };
      },
      args: [code]
    });

    const result = injectionResults?.[0]?.result || { valid: false, reason: 'Execution failed' };

    // 3. Log validation attempt back to Supabase to keep counts honest
    try {
      await insertInto('coupon_validations', {
        code,
        store,
        valid: result.valid,
        created_at: new Date().toISOString()
      });
    } catch (logErr) {
      console.warn('[DubHacks26] Failed to log validation to Supabase:', logErr);
    }

    return result;
  } catch (err) {
    console.error('[DubHacks26] validateCoupon error:', err);
    return { valid: false, reason: err.message };
  }
}

const MOCK_COUPONS = [
  { id: 'mock-1', store: 'example.com', code: 'SAVE10', description: '10% off sitewide', discountType: 'percent', discountValue: 10, confidence: 0.9 },
  { id: 'mock-2', store: 'example.com', code: 'FREESHIP', description: 'Free shipping over $35', discountType: 'shipping', confidence: 0.8 },
  { id: 'mock-3', store: 'nike.com', code: 'SWOOSH20', description: '20% off select footwear', discountType: 'percent', discountValue: 20, confidence: 0.85 },
  { id: 'mock-4', store: 'nike.com', code: 'JUSTDOIT', description: '$15 off orders over $75', discountType: 'fixed', discountValue: 15, confidence: 0.7 },
  { id: 'mock-5', store: 'target.com', code: 'CIRCLE10', description: '10% off with Target Circle', discountType: 'percent', discountValue: 10, confidence: 0.9 },
  { id: 'mock-6', store: 'target.com', code: 'SAVE5', description: '$5 off orders over $40', discountType: 'fixed', discountValue: 5, confidence: 0.75 },
];