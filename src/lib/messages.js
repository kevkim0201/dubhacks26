// Message type constants shared by the popup, options page, content
// script, and service worker. Keeping them in one place means a typo is a
// missing import, not a silent no-op.
export const MSG = {
  GET_STATE: 'get-state',
  ADD_PURCHASE: 'add-purchase',         // manual fallback (in-store, gifts, etc.)
  UPDATE_PURCHASE: 'update-purchase',
  DELETE_PURCHASE: 'delete-purchase',
  MARK_RETURNED: 'mark-returned',
  UPDATE_SETTINGS: 'update-settings',
  AUTO_DETECTED: 'auto-detected-purchase', // content script -> background
  CONFIRM_PENDING: 'confirm-pending',
  DISMISS_PENDING: 'dismiss-pending',
  RESOLVE_STORE: 'resolve-store',
  GET_TAB_STORE: 'get-tab-store',
  GET_COUPONS_FOR_PAGE: 'get-coupons-for-page',
  RUN_AUTO_APPLY: 'run-auto-apply',
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
