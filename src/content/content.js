// Passive order-detection. Not an ES module -- content scripts can't
// `import`, so message-type strings are duplicated here rather than
// pulled from src/lib/messages.js.
(() => {
  const MSG_AUTO_DETECTED = 'auto-detected-purchase';
  const MSG_CHECKOUT_DETECTED = 'checkout-page-detected';
  const CHECK_INTERVAL_MS = 1500;
  const DEBOUNCE_MS = 800;
  const TOAST_ID = 'pocket-toast';

  // Duplicated from src/content/coupon-finder.js's COUPON_FIELD_SELECTORS
  // (content scripts can't import) -- keep the two in sync if either
  // changes. This one's only used to notice "a coupon field exists
  // somewhere on this page" passively; coupon-finder.js still does the
  // real field-filling/cart-total work, injected on demand.
  const COUPON_FIELD_SELECTORS = [
    'input[name*="coupon" i]',
    'input[name*="promo" i]',
    'input[id*="coupon" i]',
    'input[id*="promo" i]',
    'input[placeholder*="coupon" i]',
    'input[placeholder*="promo code" i]',
    'input[placeholder*="discount code" i]',
  ];

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

  // Passive "is there a coupon field on this page" check -- a much
  // cheaper, narrower heuristic than coupon-finder.js's full detection
  // (no cart-total scrape needed here, just "does a field exist"). Fires
  // at most once per page load; the background decides what to do with
  // it (currently: pop the popup's coupons view open directly, see
  // service-worker.js's MSG.CHECKOUT_DETECTED handler).
  function checkCheckout() {
    if (checkoutNotified) return;
    if (!document.querySelector(COUPON_FIELD_SELECTORS.join(','))) return;
    checkoutNotified = true;
    chrome.runtime.sendMessage({ type: MSG_CHECKOUT_DETECTED }).catch(() => {});
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
