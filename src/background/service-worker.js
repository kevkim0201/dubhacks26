import { MSG, sendToTab } from '../lib/messages.js';
import { DEFAULT_SETTINGS, getSettings } from '../lib/storage.js';

// Seed defaults the first time the extension is installed.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  console.log('[dubhacks26] installed:', reason);
});

// Central message router. Returning true keeps the channel open for the
// async reply -- without it the sender's promise resolves to undefined.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handleMessage(message, sender).then(respond).catch((err) => {
    console.error('[dubhacks26] handler failed:', err);
    respond({ ok: false, error: String(err) });
  });
  return true;
});

async function handleMessage({ type, payload }, sender) {
  switch (type) {
    case MSG.PING:
      return { ok: true, pong: Date.now() };

    case MSG.GET_PAGE_INFO: {
      const tab = sender.tab ?? (await getActiveTab());
      if (!tab) return { ok: false, error: 'no active tab' };
      return { ok: true, tab: { id: tab.id, title: tab.title, url: tab.url } };
    }

    default:
      return { ok: false, error: `unknown message type: ${type}` };
  }
}

// Keyboard shortcut (Alt+Shift+D) -> tell the current page to toggle its panel.
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== MSG.TOGGLE_PANEL) return;
  const tab = await getActiveTab();
  if (tab?.id) await sendToTab(tab.id, MSG.TOGGLE_PANEL);
});

// Keep content scripts in sync when settings change in the options page.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.filter((t) => t.id).map((t) => sendToTab(t.id, MSG.SETTINGS_CHANGED, settings)),
  );
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
