import { supabase } from "../lib/supabase.js";
import { getCosmeticsState } from "../lib/cosmetics-api.js";
import { progressFromProfile } from "../lib/progress.js";
import { clearCheckout, saveCheckout, setPopupIntent } from "../lib/checkout.js";
import { trackSwapClick } from "../lib/checkout-api.js";

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
    if (!user) return { signedIn: false, progress: null, cosmetics: null };
    const cosmetics = await getCosmeticsState();
    const progress = progressFromProfile(cosmetics.profile);
    return { signedIn: true, userId: user.id, progress, cosmetics };
  },

  async CHECKOUT_DETECTED(message, sender) {
    if (sender.tab?.id) await saveCheckout(sender.tab.id, message.checkout);
    return { ok: true };
  },

  async CHECKOUT_CLEARED(_message, sender) {
    if (sender.tab?.id) await clearCheckout(sender.tab.id);
    return { ok: true };
  },

  async OPEN_DASHBOARD() {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
    return { ok: true };
  },

  async OPEN_AVATAR(_message, sender) {
    if (!sender.tab?.id) throw new Error("Couldn't find the current browser tab.");
    await chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("avatar/index.html") });
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

  async RECORD_SWAP_CLICK(message) {
    const { userId, swapId, details } = message;
    if (swapId) {
      try {
        await trackSwapClick(swapId, details?.searchUrl, details?.title);
      } catch (e) {
        console.warn("Could not log swap click to backend:", e);
      }
    }
    if (userId) {
      const key = `cosmetics:${userId}`;
      const stored = await chrome.storage.local.get(key);
      const state = stored[key];
      if (state?.profile) {
        const updated = {
          ...state,
          profile: {
            ...state.profile,
            acorn_balance: Number(state.profile.acorn_balance ?? 0) + 10,
            total_xp: Number(state.profile.total_xp ?? 0) + 10,
          },
        };
        await chrome.storage.local.set({ [key]: updated });
        return { ok: true, progress: progressFromProfile(updated.profile) };
      }
    }
    return { ok: true };
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
