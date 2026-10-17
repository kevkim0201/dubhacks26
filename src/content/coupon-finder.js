// On-page coupon-field detection + cart-total scraping, injected on demand
// (chrome.scripting.executeScript, not a declarative content script) --
// it only needs to run when the user opens "Coupons & savings" in the
// popup, same pattern as popup.js's inline scanPageForProduct(). Owned
// by: <you> + Rohit.
//
// Not a module (content-script injection rules). Functions are attached
// to window.__pocketCoupon so a *later*, separate executeScript call
// (e.g. to apply a chosen code) can reach them -- the isolated world this
// file runs in persists for the page's lifetime, so that global survives
// between calls. The final line is a bare expression; executeScript's
// result is the completion value of a file's last top-level statement.

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

function storeName() {
  return location.hostname.replace(/^www\./, '');
}

function detectCouponField() {
  for (const selector of COUPON_FIELD_SELECTORS) {
    const field = document.querySelector(selector);
    if (field) return { found: true, selector, store: storeName() };
  }
  return { found: false, store: storeName() };
}

// Heuristic cart-total scrape, same approach as content.js's order-total
// detector: look for "subtotal $X.XX" / "shipping $X.XX" near those words
// in the page's visible text. Returns nulls when nothing matches rather
// than guessing -- the popup shows an honest fallback state for that.
function extractDollarNear(label) {
  const re = new RegExp(`${label}[^$]{0,20}\\$\\s?([\\d,]+\\.\\d{2})`, 'i');
  const match = (document.body?.innerText || '').match(re);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}

function detectCartTotals() {
  const cartTotal = extractDollarNear('subtotal');
  const shipping = extractDollarNear('shipping');
  return { cartTotal, shipping: shipping ?? (cartTotal != null ? 0 : null) };
}

// Fills the detected coupon field with `code` and clicks the most likely
// "Apply" button nearby, then reports what it did. It does NOT try to
// confirm the discount actually landed -- reliably reading a post-apply
// total back across arbitrary storefronts isn't something a generic
// heuristic can promise, which is why the UI frames this as "final
// discount confirmed at checkout" rather than claiming certainty here.
function applyCouponOnPage(code) {
  const field = document.querySelector(COUPON_FIELD_SELECTORS.join(','));
  if (!field) return { applied: false, reason: 'no coupon field found on this page' };

  field.focus();
  field.value = code;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  // Look for submit or apply button near the field
  const form = field.closest('form') || field.parentElement?.parentElement;
  const applyBtn = form?.querySelector('button[type="submit"], button, input[type="submit"]') ||
                   document.querySelector('button[id*="coupon" i], button[id*="promo" i], button[class*="promo" i], button[class*="coupon" i]');

  const button = findApplyButton(field) || applyBtn;
  if (!button) return { applied: false, reason: 'filled the field, but no Apply button was found nearby' };

  button.click();
  return { applied: true, reason: 'filled the field and clicked an Apply-like button' };
}

function findApplyButton(field) {
  const scope = field.closest('form') || field.parentElement?.closest('div') || document.body;
  const candidates = scope.querySelectorAll('button, input[type="submit"], [role="button"]');
  const labelRe = /apply|redeem|submit/i;

  for (const el of candidates) {
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    if (labelRe.test(text)) return el;
  }
  return null;
}

window.__pocketCoupon = { detectCouponField, detectCartTotals, applyCouponOnPage };
window.__applyCouponToPage = applyCouponOnPage;

({ ...detectCouponField(), ...detectCartTotals() });

