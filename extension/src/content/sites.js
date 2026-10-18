// Known stores and checkout platforms. A matching `checkout` test is treated as
// a definite checkout. Selectors are optional hints tried before the generic
// extractor; sites change their markup often, so keep them as a fallback-first
// list and verify with `chrome.storage.local.set({ nookDebug: true })`.

export const SITES = [
  {
    id: "amazon",
    store: "Amazon",
    host: /(^|\.)amazon\.(com|ca|co\.uk|de|fr|es|it|co\.jp|com\.au|in)$/,
    checkout: (url) => /^\/(gp\/buy|checkout)\//.test(url.pathname),
    total: [".grand-total-price", "#subtotals-marketplace-table .a-color-price", "[data-testid*='total' i] .a-offscreen"],
  },
  {
    id: "shopify",
    store: null, // the merchant's own name; read from the page
    host: /./,
    checkout: (url, doc) =>
      /\/checkouts?\//.test(url.pathname) &&
      (/(^|\.)(myshopify\.com|shopify\.com|shop\.app)$/.test(url.hostname) ||
        !!doc.querySelector("meta[name='shopify-checkout-api-token'], meta[name='shopify-digital-wallet'], link[href*='cdn.shopify.com']")),
    total: ["[role='rowheader'] + [role='cell'] strong", ".payment-due__price", "[data-checkout-payment-due-target]"],
  },
  {
    id: "walmart",
    store: "Walmart",
    host: /(^|\.)walmart\.(com|ca)$/,
    checkout: (url) => url.pathname.startsWith("/checkout"),
  },
  {
    id: "target",
    store: "Target",
    host: /(^|\.)target\.com$/,
    checkout: (url) => url.pathname.startsWith("/checkout"),
  },
  {
    id: "bestbuy",
    store: "Best Buy",
    host: /(^|\.)bestbuy\.(com|ca)$/,
    checkout: (url) => url.pathname.startsWith("/checkout"),
  },
  {
    id: "ebay",
    store: "eBay",
    host: /(^|\.)ebay\.[a-z.]+$/,
    checkout: (url) => url.hostname.startsWith("pay.") || url.pathname.startsWith("/checkout"),
  },
  {
    id: "etsy",
    store: "Etsy",
    host: /(^|\.)etsy\.com$/,
    checkout: (url) => /^\/(cart\/[^/]+\/)?(checkout|payment|review)/.test(url.pathname),
  },
  {
    id: "stripe",
    store: null,
    host: /^(checkout|buy)\.stripe\.com$/,
    checkout: () => true,
  },
  {
    id: "paypal",
    store: "PayPal",
    host: /(^|\.)paypal\.com$/,
    checkout: (url) => /^\/(checkoutnow|webapps\/hermes|pay)/.test(url.pathname),
  },
  {
    id: "woocommerce",
    store: null,
    host: /./,
    checkout: (_url, doc) => doc.body?.classList.contains("woocommerce-checkout") && !doc.body.classList.contains("woocommerce-order-received"),
    total: [".order-total .woocommerce-Price-amount", ".order-total td"],
  },
  {
    id: "magento",
    store: null,
    host: /./,
    checkout: (_url, doc) => doc.body?.classList.contains("checkout-index-index"),
    total: [".grand.totals .price"],
  },
  {
    id: "bigcommerce",
    store: null,
    host: /./,
    checkout: (url, doc) => url.pathname.startsWith("/checkout") && !!doc.querySelector("#checkout-app, .checkout-step"),
    total: [".cart-priceItem--total .cart-priceItem-value"],
  },
];

export function matchSite(url, doc) {
  return SITES.find((site) => site.host.test(url.hostname) && site.checkout(url, doc)) ?? null;
}
