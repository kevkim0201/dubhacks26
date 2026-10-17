// Owned by: Rohit + team.
import { selectFrom, insertInto } from './supabase.js';
import { resolveStoreFromUrl } from './store-matcher.js';

/**
 * @typedef {Object} Coupon
 * @property {string} id
 * @property {string} store            hostname this code applies to, e.g. "target.com"
 * @property {string} code             the actual coupon/promo code
 * @property {string} [description]
 * @property {'percent'|'fixed'|'shipping'|'unknown'} [discountType]
 * @property {number} [discountValue]  e.g. 15 for "15% off" or "$15 off"
 * @property {number} [minCart]        minimum cart subtotal required, in dollars
 * @property {number} [confidence]     0..1, how likely this code still works
 *
 * @typedef {Object} RankedCoupon
 * @augments Coupon
 * @property {boolean} eligible        whether the current cart meets minCart
 * @property {number} savings          dollars this coupon saves on this cart (0 if ineligible)
 * @property {number} estimatedTotal   cartTotal + shipping - savings
 * @property {boolean} best            true on the single highest-savings eligible coupon
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {number} [discountApplied]  dollars actually saved, if known
 * @property {string} [reason]           why it failed, for an invalid result
 */

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
        minCart: r.min_cart || 0,
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
export async function validateCoupon({ code, store, cartTotal } = {}) {
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
        if (typeof window.__pocketCoupon?.applyCouponOnPage === 'function') {
          return window.__pocketCoupon.applyCouponOnPage(couponCode);
        }
        if (typeof window.__applyCouponToPage === 'function') {
          return window.__applyCouponToPage(couponCode);
        }
        return { applied: false, reason: 'Coupon finder hook not found on page' };
      },
      args: [code],
    });

    const result = injectionResults?.[0]?.result || { applied: false, reason: 'Execution failed' };
    const isValid = result.applied ?? result.valid ?? false;

    // 3. Log validation attempt back to Supabase to keep counts honest
    try {
      await insertInto('coupon_validations', {
        code,
        store: store || tab.url,
        valid: isValid,
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      // Supabase table or config may not exist yet
    }

    return { valid: isValid, ...result };
  } catch (err) {
    console.error('[DubHacks26] validateCoupon error:', err);
    return { valid: false, reason: err.message };
  }
}

/** Dollars a single coupon saves against a specific cart. Pure function. */
export function computeCouponSavings(coupon, { cartTotal = 0, shipping = 0 } = {}) {
  switch (coupon.discountType) {
    case 'percent':
      return round2((coupon.discountValue / 100) * cartTotal);
    case 'fixed':
      return round2(Math.min(coupon.discountValue, cartTotal));
    case 'shipping':
      return round2(shipping);
    default:
      return 0;
  }
}

/**
 * Ranks coupons against a specific cart: computes each one's real dollar
 * savings, marks which ones the cart actually qualifies for (`minCart`),
 * and flags the single best eligible option. Pure function -- the popup
 * renders straight off this.
 * @param {Coupon[]} coupons
 * @param {{ cartTotal: number, shipping?: number }} cart
 * @returns {RankedCoupon[]} sorted by savings, highest first
 */
export function rankCoupons(coupons, { cartTotal = 0, shipping = 0 }) {
  const ranked = coupons.map((c) => {
    const eligible = cartTotal >= (c.minCart || 0);
    const savings = eligible ? computeCouponSavings(c, { cartTotal, shipping }) : 0;
    return {
      ...c,
      eligible,
      savings,
      estimatedTotal: round2(cartTotal + shipping - savings),
      best: false,
    };
  });

  ranked.sort((a, b) => b.savings - a.savings);
  const topEligible = ranked.find((c) => c.eligible);
  if (topEligible) topEligible.best = true;
  return ranked;
}

/** "everlane.com" -> "Everlane". Good-enough display name, not a real registry lookup. */
export function humanizeStoreName(hostname) {
  if (!hostname) return 'this store';
  const label = hostname.replace(/^www\./, '').split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Demo data matches the reference design 1:1 (Everlane, $120 cart + $6
// shipping -> POCKET20 saves $24, best; TAKE15 needs a $75 cart; SHIPFREE
// saves the $6 shipping) so the full flow is screenshot-identical on the
// designated test store before real coupons exist.
const MOCK_COUPONS = [
  { id: 'mock-1', store: 'example.com', code: 'POCKET20', description: '20% off · eligible items', discountType: 'percent', discountValue: 20, minCart: 0, confidence: 0.9 },
  { id: 'mock-2', store: 'example.com', code: 'TAKE15', description: '$15 off · $75 minimum', discountType: 'fixed', discountValue: 15, minCart: 75, confidence: 0.75 },
  { id: 'mock-3', store: 'example.com', code: 'SHIPFREE', description: 'Free standard shipping', discountType: 'shipping', minCart: 0, confidence: 0.85 },
  { id: 'mock-4', store: 'nike.com', code: 'SWOOSH20', description: '20% off select footwear', discountType: 'percent', discountValue: 20, minCart: 0, confidence: 0.85 },
  { id: 'mock-5', store: 'nike.com', code: 'JUSTDOIT', description: '$15 off orders over $75', discountType: 'fixed', discountValue: 15, minCart: 75, confidence: 0.7 },
  { id: 'mock-6', store: 'target.com', code: 'CIRCLE10', description: '10% off with Target Circle', discountType: 'percent', discountValue: 10, minCart: 0, confidence: 0.9 },
  { id: 'mock-7', store: 'target.com', code: 'SAVE5', description: '$5 off orders over $40', discountType: 'fixed', discountValue: 5, minCart: 40, confidence: 0.75 },
];
