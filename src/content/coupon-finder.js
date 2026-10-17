// On-page coupon-field detection, injected on demand (chrome.scripting
// .executeScript with `files: ['src/content/coupon-finder.js']`) rather
// than declared as an always-on content script -- it only needs to run
// when the user clicks "Find coupons" in the popup, same pattern as
// popup.js's inline scanPageForProduct(). Owned by: <you> + Rohit.
//
// Not a module (content-script injection rules), and deliberately not
// wrapped in an IIFE: chrome.scripting.executeScript's result is the
// completion value of the file's last top-level statement, so the final
// line below is a bare call whose return value becomes that result.

// Common selectors across storefronts for a promo/coupon code field.
const COUPON_FIELD_SELECTORS = [
  'input[name*="coupon" i]',
  'input[name*="promo" i]',
  'input[id*="coupon" i]',
  'input[id*="promo" i]',
  'input[placeholder*="coupon" i]',
  'input[placeholder*="promo code" i]',
  'input[placeholder*="discount code" i]',
];

function detectCouponField() {
  for (const selector of COUPON_FIELD_SELECTORS) {
    const field = document.querySelector(selector);
    if (field) {
      return {
        found: true,
        selector,
        store: location.hostname.replace(/^www\./, ''),
      };
    }
  }
  return { found: false, store: location.hostname.replace(/^www\./, '') };
}

// TODO: fill the detected field with `code`, trigger its "Apply" button
// (look for a nearby <button>/submit near the field), and report back
// whether the page's visible total changed. Left unimplemented -- this is
// the core of the "validating coupons" half of the feature.
function applyCouponOnPage(code) {
  const field = document.querySelector(COUPON_FIELD_SELECTORS.join(','));
  if (!field) return { applied: false, reason: 'no coupon field found on this page' };

  field.focus();
  field.value = code;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));

  return { applied: false, reason: 'field filled, but submit + result-reading is not implemented yet' };
}

detectCouponField();
