import { apiFetch } from "./api.js";
import { getSession } from "./auth.js";

export function getCosmeticsState() {
  return apiFetch("/api/cosmetics");
}

async function cacheState(state) {
  const session = await getSession();
  if (session?.user?.id) {
    await chrome.storage.local.set({ [`cosmetics:${session.user.id}`]: state });
  }
  return state;
}

export async function loadCosmeticsState() {
  return cacheState(await getCosmeticsState());
}

export function purchaseCosmetic(cosmeticId) {
  return apiFetch("/api/cosmetics/purchase", {
    method: "POST",
    body: JSON.stringify({ cosmetic_id: cosmeticId }),
  }).then(cacheState);
}

export function equipCosmetic(cosmeticId) {
  return apiFetch("/api/cosmetics/equip", {
    method: "POST",
    body: JSON.stringify({ cosmetic_id: cosmeticId }),
  }).then(cacheState);
}
