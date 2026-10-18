// Checkout carts spotted by the content script, kept per tab in session storage
// (cleared when the browser closes), plus the "what to open" hint for the popup.

const cartKey = (tabId) => `checkout:${tabId}`;
const INTENT_KEY = "popupIntent";

export async function saveCheckout(tabId, checkout) {
  await chrome.storage.session.set({ [cartKey(tabId)]: checkout });
}

export async function clearCheckout(tabId) {
  await chrome.storage.session.remove(cartKey(tabId));
}

export async function getActiveTabCheckout() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const result = await chrome.storage.session.get(cartKey(tab.id));
  return result[cartKey(tab.id)] ?? null;
}

export async function setPopupIntent(screen) {
  await chrome.storage.session.set({ [INTENT_KEY]: { screen, at: Date.now() } });
}

// Returns the screen the overlay asked for (if recent) and clears it.
export async function takePopupIntent() {
  const result = await chrome.storage.session.get(INTENT_KEY);
  await chrome.storage.session.remove(INTENT_KEY);
  const intent = result[INTENT_KEY];
  return intent && Date.now() - intent.at < 15_000 ? intent.screen : null;
}
