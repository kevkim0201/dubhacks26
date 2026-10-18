// Decides whether a page is a checkout and reads what's in the cart.
//
// Detection is a score: each signal adds points and a page counts as a checkout
// at THRESHOLD. Known stores/platforms (sites.js) match outright. Everything
// takes `doc` and `url` so it can be tested against HTML fixtures.

import { matchSite } from "./sites.js";

export const THRESHOLD = 5;

const CURRENCY = "[$€£¥₹₩]|US\\$|C\\$|A\\$|USD|CAD|EUR|GBP|AUD";
const AMOUNT = "\\d{1,3}(?:[,.\\s]\\d{3})*(?:[.,]\\d{2})?";
const MONEY_RE = new RegExp(`(?:(?:${CURRENCY})\\s?${AMOUNT}|${AMOUNT}\\s?(?:€|EUR|zł|kr))`, "g");

const PATH_STRONG_RE = /\/(check-?out|checkouts|payment|billing|place-?order|purchase)(\/|$|\?|-|_|\.)/i;
const PATH_CART_RE = /\/(cart|basket|bag|trolley)(\/|$|\?|\.)/i;
const HEADING_RE = /^\s*(secure\s+)?(checkout|check out|payment|review (your )?order|place (your )?order)\b/i;
// Only buttons that exist inside a checkout flow; "Buy now" / "Pay with PayPal"
// also appear on product and cart pages, so they don't count.
const PURCHASE_BUTTON_RE =
  /^\s*(place (your |my )?order|complete (my |your )?(order|purchase)|submit (your )?order|confirm (and|&) pay|pay now|pay securely|pay\s*(?:[$€£¥₹₩]|us\$|usd)\s?\d|continue to (payment|shipping|review)|review (your )?order)\b/i;
// Iframes that collect card numbers. Wallet buttons (PayPal, Shop Pay, Apple Pay)
// and Stripe's controller frame also load on product pages, so they're excluded.
const CARD_FRAME_RE =
  /js\.stripe\.com\/v3\/elements-inner-(card|payment)|braintreegateway\.com\/web\/[^"]*hosted-fields|checkoutshopper[^"]*securedfields|pci-connect\.squareupsandbox\.com|web\.squarecdn\.com|authorize\.net\/[^"]*(accept|payment)|flex\.cybersource\.com|checkout\.com\/[^"]*frames|recurly\.com\/[^"]*field/i;
const TOTAL_LABEL_RE = /^\s*(order\s+|grand\s+|estimated\s+|your\s+)?total(\s+due|\s+to pay)?(\s*\([^)]*\))?\s*:?\s*$/i;
const TOTAL_INLINE_RE = /^\s*(order\s+|grand\s+|estimated\s+)?total(\s+due)?\s*:?\s*/i;
const NOT_PRODUCT_IMG_RE = /logo|visa|mastercard|amex|american express|discover|paypal|apple ?pay|google ?pay|klarna|afterpay|affirm|badge|icon|secure|trust|norton|mcafee/i;

const lastMoney = (text) => text?.match(MONEY_RE)?.at(-1)?.replace(/\s+/g, " ").trim() ?? null;

function visibleText(el) {
  return (el.innerText ?? el.textContent ?? "").trim();
}

// ---------- detection ----------

export function scoreCheckout(doc = document, url = new URL(location.href)) {
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(`${points > 0 ? "+" : ""}${points} ${reason}`);
  };

  const site = matchSite(url, doc);
  if (site) add(10, `known checkout (${site.id})`);

  if (PATH_STRONG_RE.test(url.pathname) || /^(checkout|pay|secure)\./.test(url.hostname)) add(3, "checkout URL");
  else if (PATH_CART_RE.test(url.pathname)) add(1, "cart URL");

  if (doc.querySelector('input[autocomplete^="cc-"], input[autocomplete*=" cc-"]')) add(3, "card fields");
  else if (doc.querySelector('input[name*="cardnumber" i], input[name*="card_number" i], input[id*="cardnumber" i], input[name*="cvv" i], input[name*="cvc" i]'))
    add(2, "card-like fields");

  if ([...doc.querySelectorAll("iframe[src]")].some((f) => CARD_FRAME_RE.test(f.getAttribute("src"))))
    add(3, "card-entry iframe");

  if (doc.querySelector('[autocomplete*="shipping"], [autocomplete="address-line1"], [autocomplete="postal-code"]'))
    add(1, "address fields");

  const buttons = [...doc.querySelectorAll('button, input[type="submit"], [role="button"]')];
  if (buttons.some((b) => PURCHASE_BUTTON_RE.test((b.value || visibleText(b)).slice(0, 60)))) add(3, "place-order button");

  if ([...doc.querySelectorAll("h1, h2")].some((h) => HEADING_RE.test(visibleText(h)))) add(2, "checkout heading");

  // Only worth the text scan once something else points at a checkout.
  if (score >= 2 && findTotal(doc, site).amount) add(1, "order total");

  // Articles and help pages that merely talk about checkout.
  const ogType = doc.querySelector('meta[property="og:type"]')?.content;
  if (!site && (ogType === "article" || doc.querySelector("article")?.textContent.length > 3000)) add(-4, "looks like an article");

  return { isCheckout: score >= THRESHOLD, score, reasons, site };
}

// ---------- extraction ----------

function storeName(doc, url, site) {
  if (site?.store) return site.store;
  const meta =
    doc.querySelector('meta[property="og:site_name"]')?.content ||
    doc.querySelector('meta[name="application-name"]')?.content;
  if (meta?.trim()) return meta.trim();
  const parts = doc.title
    .split(/\s[|·\-–—:]\s/)
    .map((p) => p.trim())
    .filter((p) => p && !/check-?out|cart|basket|payment|secure|shipping|information|review/i.test(p));
  if (parts[0]) return parts[0];
  const host = url.hostname.replace(/^(www|shop|store|checkout|secure|pay)\./, "");
  return host.charAt(0).toUpperCase() + host.slice(1);
}

function rank(labelText) {
  if (/grand|order|due|to pay/i.test(labelText)) return 3;
  if (/^\s*total/i.test(labelText)) return 2;
  return 1; // estimated total
}

// Finds the grand total: the best-ranked short "Total" label, then the last
// price in its row (or in the label itself, for "Total: $12.00").
export function findTotal(doc = document, site = null) {
  for (const selector of site?.total ?? []) {
    const amount = lastMoney(doc.querySelector(selector)?.textContent);
    if (amount) return { amount, label: doc.querySelector(selector) };
  }

  const candidates = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/total/i.test(n.nodeValue) && n.nodeValue.length < 60 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest("script, style, noscript, nook-overlay")) continue;
    const text = el.textContent.trim();

    if (TOTAL_LABEL_RE.test(text)) {
      let row = el.parentElement;
      for (let i = 0; i < 3 && row; i++, row = row.parentElement) {
        const amount = lastMoney(row.textContent);
        if (amount) {
          candidates.push({ amount, label: el, rank: rank(text) });
          break;
        }
      }
    } else if (TOTAL_INLINE_RE.test(text) && lastMoney(text) && text.length < 40) {
      candidates.push({ amount: lastMoney(text), label: el, rank: rank(text) });
    }
  }

  // Highest rank wins; within a rank, the last one on the page (summaries end with the total).
  const best = candidates.reduce((a, c) => (!a || c.rank >= a.rank ? c : a), null);
  return best ? { amount: best.amount, label: best.label } : { amount: null, label: null };
}

function isProductImage(img) {
  const r = img.getBoundingClientRect();
  if (r.width < 24 || r.height < 24 || r.width > 400) return false;
  return !NOT_PRODUCT_IMG_RE.test(`${img.alt} ${img.src} ${img.className}`);
}

// Walks up from the total to the order-summary container and reads product images.
function findItems(totalLabel) {
  let container = totalLabel?.parentElement;
  for (let i = 0; i < 10 && container; i++, container = container.parentElement) {
    const imgs = [...container.querySelectorAll("img")].filter(isProductImage);
    if (!imgs.length) continue;

    const items = imgs.slice(0, 8).map((img) => {
      const row = img.closest("li, tr, [class*='item' i], [class*='product' i], [class*='line' i]") ?? img.parentElement;
      const name =
        img.alt?.trim() ||
        row.querySelector("h2, h3, h4, a, strong, [class*='name' i], [class*='title' i]")?.textContent.trim() ||
        null;
      return { name: name?.slice(0, 120) ?? null, image: img.currentSrc || img.src, price: lastMoney(row.textContent) };
    });
    // "Order summary (3 items)" beats counting images when it's there.
    const stated = container.textContent.match(/\b(\d{1,3})\s+items?\b/i);
    return { items, count: stated ? Number(stated[1]) : items.length };
  }
  return { items: [], count: null };
}

export function readCheckout(doc = document, url = new URL(location.href), site = matchSite(url, doc)) {
  const { amount, label } = findTotal(doc, site);
  const { items, count } = findItems(label);
  return {
    url: url.href,
    store: storeName(doc, url, site),
    total: amount,
    items,
    itemCount: count || null,
  };
}
