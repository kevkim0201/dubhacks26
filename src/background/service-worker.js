import { MSG } from '../lib/messages.js';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../lib/storage.js';
import {
  getPurchases,
  getPending,
  addPurchase,
  updatePurchase,
  deletePurchase,
  markReturned,
  addDetected,
  confirmPending,
  dismissPending,
  getStats,
  daysUntilDeadline,
} from '../lib/purchases.js';
import { xpFromStats, computeLevel } from '../lib/character.js';
import { resolveStoreFromUrl } from '../lib/store-matcher.js';
import { searchCoupons, autoApplyCoupons } from '../lib/coupons.js';

const ALARM_NAME = 'check-returns';

// In-memory tab state repository: tabId -> { tabId, url, store, resolvedAt } (Honey d.get(tabId))
const tabStoreCache = new Map();

export async function getStoreByTabId(tabId) {
  if (tabStoreCache.has(tabId)) {
    return tabStoreCache.get(tabId);
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) {
      return resolveAndCacheTab(tabId, tab.url);
    }
  } catch {
    // Tab may have closed or unavailable
  }
  return null;
}

function resolveAndCacheTab(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')) {
    tabStoreCache.delete(tabId);
    return null;
  }
  const resolved = resolveStoreFromUrl(url);
  const entry = { tabId, url, store: resolved, resolvedAt: Date.now() };
  tabStoreCache.set(tabId, entry);
  return entry;
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 360 }); // every 6h
  await checkReturns();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await checkReturns();
  await updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkReturns();
});

// Honey Lifecycle Step 1: Tab Navigation & Activation Tracking
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url;
  if (url) {
    resolveAndCacheTab(tabId, url);
    if (tab?.active) {
      await updateBadge();
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await getStoreByTabId(activeInfo.tabId);
  await updateBadge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStoreCache.delete(tabId);
});

// Central message router. Returning true keeps the channel open for the
// async reply -- without it the sender's promise resolves to undefined.
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  handleMessage(message).then(respond).catch((err) => {
    console.error('[pocket] handler failed:', err);
    respond({ ok: false, error: String(err) });
  });
  return true;
});

async function handleMessage({ type, payload }) {
  switch (type) {
    case MSG.GET_STATE:
      return { ok: true, ...(await buildState()) };

    case MSG.ADD_PURCHASE:
      await addPurchase({ ...payload, source: 'manual' });
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.UPDATE_PURCHASE:
      await updatePurchase(payload.id, payload.patch);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.DELETE_PURCHASE:
      await deletePurchase(payload.id);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.MARK_RETURNED:
      await markReturned(payload.id, payload.returned ?? true);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.UPDATE_SETTINGS:
      await updateSettings(payload);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.AUTO_DETECTED: {
      const settings = await getSettings();
      if (!settings.autoDetect) return { ok: true, added: false };
      const result = await addDetected(payload);
      if (result.added) {
        await updateBadge();
        notify(
          'Pocket spotted a purchase',
          `${result.pending.title} — open Pocket to confirm it.`,
        );
      }
      return { ok: true, added: result.added };
    }

    case MSG.CONFIRM_PENDING:
      await confirmPending(payload.id, payload.patch);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.DISMISS_PENDING:
      await dismissPending(payload.id);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.RESOLVE_STORE: {
      const { url, tabId } = payload || {};
      const resolved = resolveStoreFromUrl(url);
      if (tabId && resolved) {
        tabStoreCache.set(tabId, { tabId, url, store: resolved, resolvedAt: Date.now() });
      }
      return { ok: true, store: resolved };
    }

    case MSG.GET_TAB_STORE: {
      const entry = await getStoreByTabId(payload?.tabId);
      return { ok: true, entry };
    }

    case MSG.GET_COUPONS_FOR_PAGE: {
      const { url, store } = payload || {};
      const coupons = await searchCoupons({ store, url });
      return { ok: true, coupons };
    }

    case MSG.RUN_AUTO_APPLY: {
      const { store, coupons } = payload || {};
      const result = await autoApplyCoupons({ store, coupons });
      return { ok: true, result };
    }

    default:
      return { ok: false, error: `unknown message type: ${type}` };
  }
}

async function buildState() {
  const [settings, purchases, pending] = await Promise.all([getSettings(), getPurchases(), getPending()]);
  const stats = getStats(purchases, { notifyDaysBefore: settings.notifyDaysBefore });
  const character = computeLevel(xpFromStats(stats));
  return { settings, purchases, pending, stats, character };
}

// Badge priority: pending detections (need a human glance) outrank return
// deadlines, which outrank recognized coupon store indicator, which outrank nothing.
// Pending = blue, missed = red, due soon = amber, recognized store = green.
async function updateBadge() {
  const settings = await getSettings();
  const [purchases, pending] = await Promise.all([getPurchases(), getPending()]);
  const { dueSoon, missedReturns } = getStats(purchases, { notifyDaysBefore: settings.notifyDaysBefore });

  let text = '';
  let color = '#22c55e';
  if (pending.length > 0) {
    text = String(pending.length);
    color = '#3b82f6';
  } else if (missedReturns > 0) {
    text = String(missedReturns);
    color = '#dc2626';
  } else if (dueSoon.length > 0) {
    text = String(dueSoon.length);
    color = '#f59e0b';
  } else {
    // Check if active tab is on a supported/recognized shopping store
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        const tabEntry = await getStoreByTabId(activeTab.id);
        if (tabEntry?.store?.found) {
          text = '✓';
          color = '#10b981';
        }
      }
    } catch {
      // Tab query might fail if window closed or worker unready
    }
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// Notify once when a return crosses into the "due soon" window, and once
// more if it slips past the deadline entirely -- flags on the purchase
// itself prevent re-notifying on every alarm tick.
async function checkReturns() {
  const settings = await getSettings();
  const purchases = await getPurchases();
  let changed = false;

  for (const p of purchases) {
    if (p.returned || !p.returnDeadline) continue;
    const days = daysUntilDeadline(p);

    if (days < 0 && !p.notifiedUrgent) {
      notify(`Return window missed: ${p.title}`, 'The return deadline has passed.');
      p.notifiedUrgent = true;
      changed = true;
    } else if (days >= 0 && days <= settings.notifyDaysBefore && !p.notifiedSoon) {
      const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
      notify(`Return due ${when}: ${p.title}`, p.store ? `From ${p.store}` : 'Return window closing soon.');
      p.notifiedSoon = true;
      changed = true;
    }
  }

  if (changed) await chrome.storage.local.set({ purchases });
  await updateBadge();
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1,
  });
}
