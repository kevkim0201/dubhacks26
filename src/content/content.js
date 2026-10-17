// Passive order-detection & checkout coupon auto-test prompt.
// Not an ES module -- content scripts can't `import`, so message-type
// strings are duplicated here rather than pulled from src/lib/messages.js.
(() => {
  const MSG_AUTO_DETECTED = 'auto-detected-purchase';
  const MSG_GET_COUPONS = 'get-coupons-for-page';
  const MSG_RUN_AUTO_APPLY = 'run-auto-apply';
  const CHECK_INTERVAL_MS = 1500;
  const DEBOUNCE_MS = 800;
  const TOAST_ID = 'pocket-toast';
  const CHECKOUT_PROMPT_ID = 'pocket-checkout-prompt';

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

  const CHECKOUT_PATTERNS = [
    /checkout|cart|basket|co-cart|order-review|bag\b/i,
  ];

  let lastHref = location.href;
  let lastCheckedHref = null;
  let checkoutPromptChecked = false;

  chrome.storage.sync.get({ autoDetect: true }).then(({ autoDetect }) => {
    if (!autoDetect) return;
    check();
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        checkoutPromptChecked = false;
        check();
      }
    }, CHECK_INTERVAL_MS);

    const observer = new MutationObserver(debounce(check, DEBOUNCE_MS));
    observer.observe(document.body, { childList: true, subtree: true });
  });

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function check() {
    // 1. Check for completed order confirmation
    if (looksLikeConfirmation()) {
      document.getElementById(CHECKOUT_PROMPT_ID)?.remove();
      if (location.href === lastCheckedHref) return;
      lastCheckedHref = location.href;

      const data = extractOrderData();
      if (!data) return;

      chrome.runtime
        .sendMessage({ type: MSG_AUTO_DETECTED, payload: { ...data, url: location.href } })
        .then((res) => {
          if (res?.ok && res.added) showToast(`Pocket spotted "${data.title}" — click the toolbar icon to confirm.`);
        })
        .catch(() => {});
      return;
    }

    // 2. Check for active checkout / cart page to offer auto-testing
    checkCheckoutCoupons();
  }

  function checkCheckoutCoupons() {
    if (checkoutPromptChecked) return;
    const isCheckoutUrl = CHECKOUT_PATTERNS.some((re) => re.test(location.href));
    const hasPromoField = !!document.querySelector(
      'input[name*="coupon" i], input[name*="promo" i], input[placeholder*="promo" i], input[id*="coupon" i], input[id*="promo" i]'
    );

    if (!isCheckoutUrl && !hasPromoField) return;

    checkoutPromptChecked = true;
    const store = location.hostname.replace(/^www\./, '');

    chrome.runtime
      .sendMessage({ type: MSG_GET_COUPONS, payload: { url: location.href, store } })
      .then((res) => {
        if (res?.ok && Array.isArray(res.coupons) && res.coupons.length > 0) {
          showCheckoutPrompt(res.coupons, store);
        }
      })
      .catch(() => {});
  }

  function showCheckoutPrompt(coupons, store) {
    if (document.getElementById(CHECKOUT_PROMPT_ID)) return;
    const prompt = document.createElement('div');
    prompt.id = CHECKOUT_PROMPT_ID;
    prompt.innerHTML = `
      <div class="prompt-brand">
        <svg viewBox="0 0 32 32" width="18" height="18" fill="none">
          <rect x="2" y="2" width="28" height="28" rx="8" fill="#2f6b4f" />
          <path d="M9 14 Q16 22 23 14" stroke="#fdfaf4" stroke-width="3" stroke-linecap="round" />
        </svg>
        <span>Pocket</span>
      </div>
      <div class="prompt-info">
        <strong>${coupons.length} coupon${coupons.length === 1 ? '' : 's'} available</strong>
        <span>Auto-test against this checkout</span>
      </div>
      <button class="prompt-btn" id="pocket-prompt-run">⚡ Auto-Test All</button>
      <button class="prompt-close" id="pocket-prompt-close">&times;</button>
    `;

    document.documentElement.appendChild(prompt);

    prompt.querySelector('#pocket-prompt-close').addEventListener('click', () => prompt.remove());
    prompt.querySelector('#pocket-prompt-run').addEventListener('click', () => {
      prompt.remove();
      chrome.runtime.sendMessage({
        type: MSG_RUN_AUTO_APPLY,
        payload: { store, coupons },
      }).catch(() => {});
    });
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
