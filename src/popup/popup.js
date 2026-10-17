import { MSG, sendToBackground, sendToTab } from '../lib/messages.js';
import { getSettings, setSettings } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

const els = {
  enabled: $('enabled'),
  tabTitle: $('tab-title'),
  tabUrl: $('tab-url'),
  togglePanel: $('toggle-panel'),
  openOptions: $('open-options'),
  status: $('status'),
};

init();

async function init() {
  const [settings, info] = await Promise.all([
    getSettings(),
    sendToBackground(MSG.GET_PAGE_INFO),
  ]);

  els.enabled.checked = settings.enabled;

  if (info?.ok) {
    els.tabTitle.textContent = info.tab.title || '(untitled)';
    els.tabUrl.textContent = info.tab.url || '';
  } else {
    els.tabTitle.textContent = 'Unavailable';
  }

  els.enabled.addEventListener('change', async () => {
    await setSettings({ enabled: els.enabled.checked });
    setStatus(els.enabled.checked ? 'Enabled.' : 'Disabled.');
  });

  els.togglePanel.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = tab?.id ? await sendToTab(tab.id, MSG.TOGGLE_PANEL) : null;
    setStatus(res?.ok ? 'Panel toggled.' : "Can't run on this page.");
  });

  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

let statusTimer;
function setStatus(text) {
  els.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { els.status.textContent = ''; }, 2000);
}
