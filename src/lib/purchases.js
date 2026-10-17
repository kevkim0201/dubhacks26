// Two lists live in chrome.storage.local (not .sync -- a growing purchase
// history can exceed sync's per-item quota, and it doesn't need to roam
// between machines):
//
//   purchases         confirmed purchases -- these count toward XP/stats
//   pendingPurchases   auto-detected candidates awaiting a one-tap confirm
//
// A third list, ignoredOrderUrls, remembers pages the user dismissed so a
// re-visit (or the content script's periodic re-check) doesn't nag again.
const KEY = 'purchases';
const PENDING_KEY = 'pendingPurchases';
const IGNORED_KEY = 'ignoredOrderUrls';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IGNORED = 500;

function dedupKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

export async function getPurchases() {
  const { [KEY]: purchases } = await chrome.storage.local.get({ [KEY]: [] });
  return purchases;
}

async function savePurchases(purchases) {
  await chrome.storage.local.set({ [KEY]: purchases });
  return purchases;
}

export async function getPending() {
  const { [PENDING_KEY]: pending } = await chrome.storage.local.get({ [PENDING_KEY]: [] });
  return pending;
}

async function savePending(pending) {
  await chrome.storage.local.set({ [PENDING_KEY]: pending });
  return pending;
}

async function getIgnoredUrls() {
  const { [IGNORED_KEY]: ignored } = await chrome.storage.local.get({ [IGNORED_KEY]: [] });
  return ignored;
}

// `data`: { title, store?, url?, pricePaid, savings?, purchaseDate?, returnDeadline? }
export async function addPurchase(data) {
  const purchases = await getPurchases();
  const now = new Date().toISOString();
  const purchase = {
    id: crypto.randomUUID(),
    title: data.title.trim(),
    store: data.store?.trim() || '',
    url: data.url || '',
    pricePaid: Number(data.pricePaid) || 0,
    savings: Number(data.savings) || 0,
    purchaseDate: data.purchaseDate || now,
    returnDeadline: data.returnDeadline || null,
    returned: false,
    returnedDate: null,
    notifiedSoon: false,
    notifiedUrgent: false,
    source: data.source || 'manual',
    createdAt: now,
  };
  purchases.unshift(purchase);
  await savePurchases(purchases);
  return purchase;
}

export async function updatePurchase(id, patch) {
  const purchases = await getPurchases();
  const next = purchases.map((p) => (p.id === id ? { ...p, ...patch } : p));
  await savePurchases(next);
  return next.find((p) => p.id === id) ?? null;
}

export async function deletePurchase(id) {
  const purchases = await getPurchases();
  await savePurchases(purchases.filter((p) => p.id !== id));
}

export async function markReturned(id, returned = true) {
  return updatePurchase(id, {
    returned,
    returnedDate: returned ? new Date().toISOString() : null,
  });
}

// Called by the background worker when the content script reports a
// likely order-confirmation page. Skips anything already confirmed,
// already pending, or previously dismissed for that same page.
export async function addDetected(candidate) {
  const key = dedupKey(candidate.url);
  const [purchases, pending, ignored] = await Promise.all([getPurchases(), getPending(), getIgnoredUrls()]);

  const alreadyKnown =
    purchases.some((p) => p.url && dedupKey(p.url) === key) ||
    pending.some((p) => dedupKey(p.url) === key) ||
    ignored.includes(key);

  if (alreadyKnown) return { added: false };

  const entry = {
    id: crypto.randomUUID(),
    title: (candidate.title || 'Purchase').slice(0, 140),
    store: candidate.store || '',
    url: candidate.url,
    pricePaid: Number(candidate.pricePaid) || 0,
    savings: Number(candidate.savings) || 0,
    detectedAt: new Date().toISOString(),
  };

  pending.unshift(entry);
  await savePending(pending);
  return { added: true, pending: entry };
}

// Moves a pending entry into confirmed purchases, applying any edits the
// user made in the review card (title/price/savings/return date).
export async function confirmPending(id, patch = {}) {
  const pending = await getPending();
  const entry = pending.find((p) => p.id === id);
  if (!entry) return null;

  const purchase = await addPurchase({
    title: patch.title ?? entry.title,
    store: patch.store ?? entry.store,
    url: entry.url,
    pricePaid: patch.pricePaid ?? entry.pricePaid,
    savings: patch.savings ?? entry.savings,
    returnDeadline: patch.returnDeadline ?? null,
    source: 'auto',
  });

  await savePending(pending.filter((p) => p.id !== id));
  return purchase;
}

export async function dismissPending(id) {
  const pending = await getPending();
  const entry = pending.find((p) => p.id === id);
  if (!entry) return false;

  await savePending(pending.filter((p) => p.id !== id));

  if (entry.url) {
    const ignored = await getIgnoredUrls();
    const key = dedupKey(entry.url);
    const next = [key, ...ignored.filter((u) => u !== key)].slice(0, MAX_IGNORED);
    await chrome.storage.local.set({ [IGNORED_KEY]: next });
  }
  return true;
}

// Days remaining until the return deadline (negative = overdue).
// Returns null when the purchase has no return window.
export function daysUntilDeadline(purchase, now = new Date()) {
  if (!purchase.returnDeadline) return null;
  const diff = new Date(purchase.returnDeadline).getTime() - now.getTime();
  return Math.ceil(diff / DAY_MS);
}

export function purchaseStatus(purchase, now = new Date()) {
  if (purchase.returned) return 'returned';
  const days = daysUntilDeadline(purchase, now);
  if (days === null) return 'tracked';
  if (days < 0) return 'missed';
  return 'tracked';
}

// Aggregate stats used by both the popup and the dashboard. Keeping this in
// one place means the character's XP and the UI's numbers can never drift.
export function getStats(purchases, { notifyDaysBefore = 3, now = new Date() } = {}) {
  let totalSaved = 0;
  let savedThisMonth = 0;
  let completedReturns = 0;
  let missedReturns = 0;
  const dueSoon = [];
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;

  for (const p of purchases) {
    totalSaved += p.savings || 0;

    const purchaseDate = p.purchaseDate ? new Date(p.purchaseDate) : null;
    if (purchaseDate && `${purchaseDate.getFullYear()}-${purchaseDate.getMonth()}` === monthKey) {
      savedThisMonth += p.savings || 0;
    }

    if (p.returned) {
      completedReturns += 1;
      continue;
    }
    const days = daysUntilDeadline(p, now);
    if (days === null) continue;
    if (days < 0) missedReturns += 1;
    else if (days <= notifyDaysBefore) dueSoon.push({ ...p, daysLeft: days });
  }

  dueSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    totalItems: purchases.length,
    totalSaved,
    savedThisMonth,
    completedReturns,
    missedReturns,
    dueSoon,
  };
}
