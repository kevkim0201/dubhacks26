import { apiFetch } from "./api.js";

function moneyAmount(value) {
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "").replace(/,/g, "");
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : "0.00";
}

function currencyCode(value) {
  const text = String(value ?? "");
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  if (text.includes("¥")) return "JPY";
  return "USD";
}

// The cart as the backend stores it; used when the session starts and again with the decision.
function cartPayload(checkout) {
  const moneySource = checkout?.total ?? checkout?.items?.find((item) => item.price)?.price;
  const items = (checkout?.items ?? [])
    .filter((item) => item.name?.trim())
    .map((item) => ({
      name: item.name.trim().slice(0, 200),
      price: moneyAmount(item.price),
      quantity: Math.min(100, Math.max(1, Number(item.quantity) || 1)),
      ...(item.url ? { url: item.url.slice(0, 2048) } : {}),
      // Thumbnails for the dashboard; skip inline data: images, which can be huge.
      ...(/^https?:/.test(item.image ?? "") && item.image.length <= 2048 ? { image: item.image } : {}),
    }));
  return {
    store: checkout?.store || "Unknown store",
    cart_total: moneyAmount(checkout?.total),
    currency: currencyCode(moneySource),
    items,
    ...(checkout?.url ? { page_url: checkout.url.slice(0, 2048) } : {}),
  };
}

export async function startCheckoutSession(checkout) {
  return apiFetch("/api/checkout/start", {
    method: "POST",
    body: JSON.stringify(cartPayload(checkout)),
  });
}

// Sends the decision with the current cart so the backend can fill anything the
// session snapshot missed (store, total, items, page URL) before awarding.
export async function submitCheckoutDecision(sessionId, decision, checkout = null) {
  if (!sessionId) throw new Error("Start a checkout session before submitting a decision.");
  return apiFetch(`/api/checkout/${encodeURIComponent(sessionId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, ...(checkout ? cartPayload(checkout) : {}) }),
  });
}

export async function fetchRecommendations(checkout) {
  const payload = cartPayload(checkout);
  const rawTotal = parseFloat(payload.cart_total) || 0;
  return apiFetch("/api/checkout/recommendations", {
    method: "POST",
    body: JSON.stringify({
      items: payload.items.map((item) => ({
        name: item.name,
        price: parseFloat(item.price) || 0,
        quantity: item.quantity,
      })),
      total_cost: rawTotal,
      store_domain: payload.store,
    }),
  });
}

export async function trackSwapClick(recommendationId, searchUrl, title = null) {
  try {
    return await apiFetch("/api/checkout/recommendations/click", {
      method: "POST",
      body: JSON.stringify({
        recommendation_id: recommendationId,
        search_url: searchUrl,
        title,
      }),
    });
  } catch (err) {
    console.warn("trackSwapClick failed:", err);
    return null;
  }
}

