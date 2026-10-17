import { MSG } from '../lib/messages.js';
import { startPurchaseSyncWatcher } from '../lib/purchase-sync.js';
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

const ALARM_NAME = 'check-returns';

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
      await addPurchase(payload);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.UPDATE_PURCHASE:
      await updatePurchase(payload.id, payload.patch);
      await updateBadge();
      return { ok: true, ...(await buildState()) };

    case MSG.DELETE_PURCHASE: {
      const { deleted } = await deletePurchase(payload.id);
      await updateBadge();
      return { ok: true, ...(await buildState()), deleted };
    }

    case MSG.GET_PURCHASES:
      return { ok: true, purchases: await getPurchases() };

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
// deadlines, which outrank nothing. Pending = blue, missed = red, due soon
// = amber.
async function updateBadge() {
  const settings = await getSettings();
  const [purchases, pending] = await Promise.all([getPurchases(), getPending()]);
  const { dueSoon, missedReturns } = getStats(purchases, { notifyDaysBefore: settings.notifyDaysBefore });

  let count = 0;
  let color = '#22c55e';
  if (pending.length > 0) {
    count = pending.length;
    color = '#3b82f6';
  } else if (missedReturns > 0) {
    count = missedReturns;
    color = '#dc2626';
  } else if (dueSoon.length > 0) {
    count = dueSoon.length;
    color = '#f59e0b';
  }

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
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
    // Absolute: a relative path resolves against src/background/, where
    // there's no icons folder, and the notification silently fails.
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 1,
  });
}

// Queue purchase changes for the Supabase backup (src/lib/purchase-sync.js).
// Top level, so the listener is in place whenever the worker wakes.
startPurchaseSyncWatcher();
