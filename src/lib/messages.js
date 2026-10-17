// Message type constants shared by the popup, content script, and service worker.
// Keeping them in one place means a typo is a missing import, not a silent no-op.
export const MSG = {
  PING: 'ping',
  GET_PAGE_INFO: 'get-page-info',
  TOGGLE_PANEL: 'toggle-panel',
  SETTINGS_CHANGED: 'settings-changed',
};

// Send a message to the service worker. Resolves to the response, or null if
// nothing was listening (Chrome rejects the promise in that case).
export async function sendToBackground(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, payload });
  } catch {
    return null;
  }
}

// Send a message to a specific tab's content script.
export async function sendToTab(tabId, type, payload = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, payload });
  } catch {
    // The content script isn't injected on chrome:// pages, the Web Store, etc.
    return null;
  }
}
