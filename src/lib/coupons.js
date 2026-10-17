// Savings-maximization: coupon search + validation.
// Owned by: <you> + Rohit. This file is the contract the rest of the
// extension (popup.js) codes against -- fill in the TODOs without needing
// to change how it's called from the UI.
//
// @typedef {Object} Coupon
// @property {string} id
// @property {string} store            hostname this code applies to, e.g. "target.com"
// @property {string} code             the actual coupon/promo code
// @property {string} [description]
// @property {'percent'|'fixed'|'shipping'|'unknown'} [discountType]
// @property {number} [discountValue]  e.g. 15 for "15% off" or "$15 off"
// @property {number} [minCart]        minimum cart subtotal required, in dollars
// @property {number} [confidence]     0..1, how likely this code still works
//
// @typedef {Object} RankedCoupon
// @augments Coupon
// @property {boolean} eligible        whether the current cart meets minCart
// @property {number} savings          dollars this coupon saves on this cart (0 if ineligible)
// @property {number} estimatedTotal   cartTotal + shipping - savings
// @property {boolean} best            true on the single highest-savings eligible coupon
//
// @typedef {Object} ValidationResult
// @property {boolean} valid
// @property {number} [discountApplied]  dollars actually saved, if known
// @property {string} [reason]           why it failed, for an invalid result

/**
 * Find candidate coupon codes for the given store/page.
 * @param {{ store: string, url?: string }} params
 * @returns {Promise<Coupon[]>}
 */
export async function searchCoupons({ store }) {
  // TODO (backend is ready in src/lib/supabase.js once Kevin/Deetya have
  // seeded the `coupons` table -- see supabase/schema.sql):
  //
  //   import { selectFrom } from './supabase.js';
  //   return selectFrom('coupons', {
  //     filters: { store },
  //     order: 'success_count.desc',
  //     limit: 10,
  //   });
  //
  // Until then, this returns deterministic mock data so the popup's
  // "Find coupons" flow has something real to render and build against.
  await new Promise((r) => setTimeout(r, 300)); // simulate network latency
  return MOCK_COUPONS.filter((c) => c.store === store);
}

/**
 * Check whether a specific code actually works for a given store/cart.
 * In its real form this likely drives a content-script that fills the
 * promo field (see src/content/coupon-finder.js) and reads back whether
 * the page's total changed -- there's no reliable way to validate a
 * coupon without a live checkout page, so this intentionally isn't a pure
 * function.
 * @param {{ code: string, store: string, cartTotal?: number }} params
 * @returns {Promise<ValidationResult>}
 */
export async function validateCoupon({ code }) {
  // TODO: once applyCouponOnPage() (src/content/coupon-finder.js) can read
  // the page's total back reliably across more storefronts, call it here,
  // diff the before/after total, and (optionally) log the outcome via
  // insertInto('coupon_validations', {...}) so success/fail counts in the
  // `coupons` table stay honest over time.
  await new Promise((r) => setTimeout(r, 300));
  return { valid: false, reason: `validateCoupon() not implemented yet (code: ${code})` };
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
];
