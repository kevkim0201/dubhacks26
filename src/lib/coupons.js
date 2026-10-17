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
// @property {number} [confidence]     0..1, how likely this code still works
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
  // TODO: drive src/content/coupon-finder.js's applyCouponOnPage(code) via
  // chrome.scripting.executeScript on the active tab, compare the page's
  // total before/after, and report back. Then (optionally) log the result
  // via insertInto('coupon_validations', {...}) so success/fail counts in
  // the `coupons` table stay honest over time.
  await new Promise((r) => setTimeout(r, 300));
  return { valid: false, reason: `validateCoupon() not implemented yet (code: ${code})` };
}

const MOCK_COUPONS = [
  { id: 'mock-1', store: 'example.com', code: 'SAVE10', description: '10% off sitewide', discountType: 'percent', discountValue: 10, confidence: 0.6 },
  { id: 'mock-2', store: 'example.com', code: 'FREESHIP', description: 'Free shipping over $35', discountType: 'shipping', confidence: 0.8 },
];
