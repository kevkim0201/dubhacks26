// Passive order-detection. Not an ES module -- content scripts can't
// `import`, so message-type strings are duplicated here rather than
// pulled from src/lib/messages.js.
(() => {
  const MSG_AUTO_DETECTED = 'auto-detected-purchase';
  const MSG_CHECKOUT_DETECTED = 'checkout-page-detected';
  const CHECK_INTERVAL_MS = 1500;
  const DEBOUNCE_MS = 800;
  const TOAST_ID = 'pocket-toast';
  const CARD_ID = 'pocket-coupon-card';

  // Duplicated from src/content/coupon-finder.js (content scripts can't
  // import, and that file is only ever injected on demand when the user
  // opens the popup's "Coupons & savings" view -- this passive path runs
  // unprompted on every page, so it needs its own copy). Keep these in
  // sync if either file's detection logic changes.
  const COUPON_FIELD_SELECTORS = [
    'input[name*="coupon" i]',
    'input[name*="promo" i]',
    'input[id*="coupon" i]',
    'input[id*="promo" i]',
    'input[placeholder*="coupon" i]',
    'input[placeholder*="promo code" i]',
    'input[placeholder*="discount code" i]',
  ];

  function extractDollarNear(label) {
    const re = new RegExp(`${label}[^$]{0,20}\\$\\s?([\\d,]+\\.\\d{2})`, 'i');
    const match = (document.body?.innerText || '').match(re);
    return match ? parseFloat(match[1].replace(/,/g, '')) : null;
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

  function applyCouponOnPage(code) {
    const field = document.querySelector(COUPON_FIELD_SELECTORS.join(','));
    if (!field) return { applied: false, reason: 'no coupon field found on this page' };
    field.focus();
    field.value = code;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const button = findApplyButton(field);
    if (!button) return { applied: false, reason: 'filled the field, but no Apply button was found nearby' };
    button.click();
    return { applied: true };
  }

  // Two independent signals -- a confirmation-looking URL, or
  // confirmation-looking text on the page. Either alone is enough; this
  // keeps the matcher broad without needing a per-retailer list.
  const URL_PATTERNS = [
    /order.{0,15}(confirm|complete|success|placed)/i,
    /checkout.{0,15}(success|complete|confirmation)/i,
    /thank.?you.{0,20}order/i,
    /\breceipt\b/i,
  ];
  const TEXT_PATTERNS = [
    /thank you for your (order|purchase)/i,
    /order (is |has been )?confirmed/i,
    /your order has been placed/i,
    /order (number|#)\s*[:#]?\s*\w/i,
    /confirmation (number|code)\s*[:#]?\s*\w/i,
  ];

  let lastHref = location.href;
  let lastCheckedHref = null;
  let checkoutNotified = false; // per page-load only -- not persisted, unlike ignoredOrderUrls

  chrome.storage.sync.get({ autoDetect: true, autoOpenCoupons: true }).then(({ autoDetect, autoOpenCoupons }) => {
    if (!autoDetect && !autoOpenCoupons) return;

    const runChecks = () => {
      if (autoDetect) check();
      if (autoOpenCoupons) checkCheckout();
    };

    runChecks();
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        runChecks();
      }
    }, CHECK_INTERVAL_MS);

    const observer = new MutationObserver(debounce(runChecks, DEBOUNCE_MS));
    observer.observe(document.body, { childList: true, subtree: true });
  });

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Passive "is there a coupon field on this page" check. Fires at most
  // once per page load -- the background looks up/ranks real coupons for
  // this store+cart (src/lib/coupons.js) and replies with the list;
  // nothing opens anywhere else, it's rendered right here as an in-page
  // card (showCouponCard below), the same way the order-detected toast
  // already works. No chrome.action.openPopup()/chrome.windows.create()
  // involved at all -- seeing why that matters is in README.md's
  // "Things that will bite you".
  function checkCheckout() {
    if (checkoutNotified) return;
    const field = document.querySelector(COUPON_FIELD_SELECTORS.join(','));
    if (!field) return;
    checkoutNotified = true;

    const store = location.hostname.replace(/^www\./, '');
    const cartTotal = extractDollarNear('subtotal');
    const shipping = extractDollarNear('shipping');

    chrome.runtime
      .sendMessage({ type: MSG_CHECKOUT_DETECTED, payload: { store, cartTotal, shipping } })
      .then((res) => {
        if (res?.ok && res.coupons?.length) showCouponCard(res.coupons, store);
      })
      .catch(() => {});
  }

  // store/code/description are built via textContent, not interpolated
  // into innerHTML -- searchCoupons() only returns hardcoded mock data
  // today, but coupons.js's own TODO plans to source `coupons` from
  // Supabase, where any signed-in user can insert a row (see
  // schema.sql's insert policy on that table). Treating those fields as
  // untrusted now avoids a stored-XSS trap landing the day that's wired
  // up, since this renders directly into whatever page the user is on.
  function showCouponCard(coupons, store) {
    const best = coupons.find((c) => c.best) || coupons[0];
    const more = coupons.length - 1;

    document.getElementById(CARD_ID)?.remove();
    const card = document.createElement('div');
    card.id = CARD_ID;
    card.innerHTML = `
      <p class="pocket-card__head"></p>
      <p class="pocket-card__code"><span class="pocket-card__code-text"></span><span class="pocket-card__desc"></span></p>
      <p class="pocket-card__savings" hidden></p>
      <div class="pocket-card__row">
        <button type="button" class="pocket-card__apply">Apply</button>
        <button type="button" class="pocket-card__dismiss" aria-label="Dismiss">&times;</button>
      </div>
      <p class="pocket-card__more" hidden></p>
    `;

    card.querySelector('.pocket-card__head').textContent = `Pocket found a coupon for ${store}`;
    card.querySelector('.pocket-card__code-text').textContent = best.code;
    card.querySelector('.pocket-card__desc').textContent = best.description || '';
    if (best.savings) {
      const savingsEl = card.querySelector('.pocket-card__savings');
      savingsEl.textContent = `Saves ${formatMoney(best.savings)}`;
      savingsEl.hidden = false;
    }
    if (more > 0) {
      const moreEl = card.querySelector('.pocket-card__more');
      moreEl.textContent = `+${more} more offer${more === 1 ? '' : 's'} -- open Pocket to compare`;
      moreEl.hidden = false;
    }

    document.documentElement.appendChild(card);

    card.querySelector('.pocket-card__dismiss').addEventListener('click', () => card.remove());
    card.querySelector('.pocket-card__apply').addEventListener('click', () => {
      const result = applyCouponOnPage(best.code);
      const status = document.createElement('p');
      status.className = 'pocket-card__status';
      status.textContent = result.applied
        ? 'Applied -- check the page to confirm it took.'
        : result.reason || "Couldn't apply this automatically -- try pasting it at checkout.";
      card.querySelector('.pocket-card__row').after(status);
      card.querySelector('.pocket-card__apply').disabled = true;
    });
  }

  function formatMoney(n) {
    const fixed = Number(n).toFixed(2);
    return `$${fixed.replace(/\.00$/, '')}`;
  }

  function check() {
    if (location.href === lastCheckedHref) return;
    if (!looksLikeConfirmation()) return;
    lastCheckedHref = location.href;

    const data = extractOrderData();
    if (!data) return;

    chrome.runtime
      .sendMessage({ type: MSG_AUTO_DETECTED, payload: { ...data, url: location.href } })
      .then((res) => {
        if (res?.ok && res.added) showToast(`Pocket spotted "${data.title}" — click the toolbar icon to confirm.`);
      })
      .catch(() => {});
  }

  function looksLikeConfirmation() {
    if (URL_PATTERNS.some((re) => re.test(location.href))) return true;
    const heading = (document.querySelector('h1, h2')?.innerText || '').slice(0, 200);
    if (TEXT_PATTERNS.some((re) => re.test(heading))) return true;
    const snippet = (document.body?.innerText || '').slice(0, 3000);
    return TEXT_PATTERNS.some((re) => re.test(snippet));
  }

  function extractOrderData() {
    return extractFromJsonLd() || extractFromHeuristics();
  }

  // Most storefronts that implement SEO structured data expose an Order or
  // Product/Offer block -- far more reliable than scraping rendered text.
  function extractFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const found = readJsonLdItem(item);
        if (found) return found;
      }
    }
    return null;
  }

  function readJsonLdItem(item) {
    if (!item || typeof item !== 'object') return null;
    const type = item['@type'];
    const types = Array.isArray(type) ? type : [type];

    if (types.includes('Order')) {
      const total =
        item.priceSpecification?.price ??
        item.partOfInvoice?.totalPaymentDue?.price ??
        item.acceptedOffer?.price;
      const orderedItem = Array.isArray(item.orderedItem) ? item.orderedItem[0] : item.orderedItem;
      const title = orderedItem?.name || orderedItem?.itemOffered?.name || document.title;
      if (total != null && !Number.isNaN(parseFloat(total))) {
        return {
          title: String(title).slice(0, 140),
          store: location.hostname.replace(/^www\./, ''),
          pricePaid: parseFloat(total),
          savings: extractSavings(),
        };
      }
    }
    return null;
  }

  function extractFromHeuristics() {
    const price = extractTotalPrice();
    if (price == null) return null;

    const title = document.querySelector('h1')?.innerText?.trim() || document.title;
    return {
      title: title.slice(0, 140),
      store: location.hostname.replace(/^www\./, ''),
      pricePaid: price,
      savings: extractSavings(),
    };
  }

  function extractTotalPrice() {
    const totalRe = /\btotal\b[^$]{0,20}\$\s?([\d,]+\.\d{2})/i;
    const bodyText = document.body?.innerText || '';
    const match = bodyText.match(totalRe);
    if (match) return parseFloat(match[1].replace(/,/g, ''));

    const meta = document.querySelector(
      'meta[property="product:price:amount"], meta[property="og:price:amount"]',
    )?.content;
    return meta ? parseFloat(meta) : null;
  }

  function extractSavings() {
    const bodyText = document.body?.innerText || '';
    const match = bodyText.match(/you saved\s*\$\s?([\d,]+\.\d{2})/i) || bodyText.match(/saved\s*\$\s?([\d,]+\.\d{2})/i);
    return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
  }

  function showToast(message) {
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
    toast.addEventListener('click', () => toast.remove());
  }
})();
