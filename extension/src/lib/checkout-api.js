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

export async function startCheckoutSession(checkout) {
  const moneySource = checkout?.total ?? checkout?.items?.find((item) => item.price)?.price;
  const items = (checkout?.items ?? [])
    .filter((item) => item.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      price: moneyAmount(item.price),
      quantity: 1,
      ...(item.url ? { url: item.url } : {}),
      // Thumbnails for the dashboard; skip inline data: images, which can be huge.
      ...(/^https?:/.test(item.image ?? "") && item.image.length <= 2048 ? { image: item.image } : {}),
    }));

  return apiFetch("/api/checkout/start", {
    method: "POST",
    body: JSON.stringify({
      store: checkout?.store || "Unknown store",
      cart_total: moneyAmount(checkout?.total),
      currency: currencyCode(moneySource),
      items,
    }),
  });
}

export async function submitCheckoutDecision(sessionId, decision) {
  if (!sessionId) throw new Error("Start a checkout session before submitting a decision.");
  return apiFetch(`/api/checkout/${encodeURIComponent(sessionId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}
