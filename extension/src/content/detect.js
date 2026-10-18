// Heuristics for spotting a checkout page and reading what's in the cart.
// They're deliberately simple; add site-specific extractors as needed.

const MONEY_RE = /[$€£]\s?\d[\d,]*(?:\.\d{2})?/g;
const CHECKOUT_PATH_RE = /check-?out|payment/i;
const CHECKOUT_HEADING_RE = /^\s*(secure\s+)?(checkout|payment)\b/i;

export function looksLikeCheckout() {
  if (CHECKOUT_PATH_RE.test(location.pathname)) return true;
  if (document.querySelector('input[autocomplete^="cc-"]')) return true;
  return [...document.querySelectorAll("h1, h2")].some((h) => CHECKOUT_HEADING_RE.test(h.textContent));
}

function storeName() {
  const og = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
  if (og) return og;
  const parts = document.title
    .split(/\s[|·\-–—:]\s/)
    .map((p) => p.trim())
    .filter((p) => p && !/check-?out|cart|payment|secure/i.test(p));
  return parts[0] || location.hostname.replace(/^www\./, "");
}

const lastMoney = (text) => text.match(MONEY_RE)?.at(-1)?.replace(/\s/g, "") ?? null;

// Finds the grand total: the last leaf element labelled "Total" / "Order total",
// then the last price in its row.
function findTotal() {
  const labels = [...document.body.querySelectorAll("*")].filter(
    (el) =>
      el.children.length === 0 &&
      el.textContent.length < 40 &&
      /^\s*(order\s+|grand\s+)?total\b/i.test(el.textContent)
  );
  for (const label of labels.reverse()) {
    let row = label.parentElement;
    for (let i = 0; i < 3 && row; i++, row = row.parentElement) {
      const amount = lastMoney(row.textContent);
      if (amount) return { amount, label };
    }
  }
  return { amount: null, label: null };
}

const isVisibleImage = (img) => {
  const r = img.getBoundingClientRect();
  return r.width >= 24 && r.height >= 24;
};

// Walks up from the total to the order-summary container and reads product images.
function findItems(totalLabel) {
  let container = totalLabel?.parentElement;
  for (let i = 0; i < 8 && container; i++, container = container.parentElement) {
    const imgs = [...container.querySelectorAll("img")].filter(isVisibleImage);
    if (imgs.length) {
      return imgs.slice(0, 5).map((img) => {
        const row = img.closest("li, tr, [class*='item' i], [class*='product' i]") ?? img.parentElement;
        const name =
          img.alt?.trim() ||
          row.querySelector("h3, h4, strong, [class*='name' i], [class*='title' i]")?.textContent.trim() ||
          null;
        return { name, image: img.currentSrc || img.src, price: lastMoney(row.textContent) };
      });
    }
  }
  return [];
}

export function readCheckout() {
  const { amount, label } = findTotal();
  const items = findItems(label);
  return {
    url: location.href,
    store: storeName(),
    total: amount,
    items,
    itemCount: items.length || null,
  };
}
