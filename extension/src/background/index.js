import { supabase } from "../lib/supabase.js";
import { loadProgress } from "../lib/progress.js";
import { clearCheckout, saveCheckout, setPopupIntent } from "../lib/checkout.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Nook installed");
});

supabase.auth.onAuthStateChange((event, session) => {
  console.log("Auth state changed:", event, session?.user?.email ?? null);
});

chrome.tabs.onRemoved.addListener((tabId) => clearCheckout(tabId));

const handlers = {
  async GET_SESSION() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  // Used by the checkout overlay to show acorns / level.
  async GET_STATUS() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    return { signedIn: !!user, progress: user ? await loadProgress(user.id) : null };
  },

  async CHECKOUT_DETECTED(message, sender) {
    if (sender.tab?.id) await saveCheckout(sender.tab.id, message.checkout);
    return { ok: true };
  },

  async CHECKOUT_CLEARED(_message, sender) {
    if (sender.tab?.id) await clearCheckout(sender.tab.id);
    return { ok: true };
  },

  // The overlay can't open the popup itself; the worker can (Chrome 127+).
  async OPEN_POPUP(message, sender) {
    await setPopupIntent(message.screen ?? "talk");
    try {
      await chrome.action.openPopup({ windowId: sender.tab?.windowId });
      return { ok: true };
    } catch (err) {
      console.warn("openPopup failed", err);
      return { ok: false };
    }
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return;
  handler(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error(err);
      sendResponse(null);
    });
  return true; // keep the channel open for the async response
});
