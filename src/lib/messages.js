// src/lib/messages.js

// Message type constants shared by the popup, options page, content
// script, and service worker. Keeping them in one place means a typo is a
// missing import, not a silent no-op.
export const MSG = {
  GET_STATE: 'get-state',
  GET_PURCHASES: 'get-purchases',       // direct purchase history query
  ADD_PURCHASE: 'add-purchase',         // manual fallback (in-store, gifts, etc.)
  UPDATE_PURCHASE: 'update-purchase',
  DELETE_PURCHASE: 'delete-purchase',
  MARK_RETURNED: 'mark-returned',
  UPDATE_SETTINGS: 'update-settings',
  AUTO_DETECTED: 'auto-detected-purchase', // content script -> background
  CONFIRM_PENDING: 'confirm-pending',
  DISMISS_PENDING: 'dismiss-pending',
};

// Send a message to the service worker and return its response.
// Returns null if nothing was listening (e.g. worker still spinning up).
export async function sendToBackground(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, payload });
    return res ?? null;
  } catch {
    return null;
  }
}