// Backs up confirmed purchases to Supabase for signed-in users.
// Owned by: Deetya.
//
// Local-first: src/lib/purchases.js stays the source of truth and every
// feature keeps reading chrome.storage.local, so nothing that exists
// today depends on being online or signed in. This module watches that
// list and mirrors it to the `purchases` table, following the rules in
// supabase/schema.sql:
//
//   - The app may only INSERT title, store, url, price_paid, savings,
//     purchase_date, return_deadline, source, coupon_id. The database
//     picks the row's id, so we remember local id -> row id ourselves.
//   - The app may only UPDATE returned / returned_date. Other edits made
//     after upload stay local.
//   - Every new row is followed by validate_purchase(), which sets its
//     status (and any acorns).
//   - A 'validated' row can't be deleted. Deleting it locally keeps the
//     cloud copy, and the sync records why.
//
//   1. Mapping   toInsertRow / toReturnsPatch / fromPurchaseRow
//   2. Queue     startPurchaseSyncWatcher, enqueueSync
//   3. Upload    flushPurchaseSync (with retries), getSyncStatus
//
// The network client is passed in (see purchase-sync-client.js) so this
// file never imports supabase.js -- that keeps it testable, and safe to
// load from the service worker even when supabaseConfig.js is missing.

const PURCHASES_KEY = 'purchases'; // owned by src/lib/purchases.js
const QUEUE_KEY = 'purchaseSyncQueue';
const STATE_KEY = 'purchaseSyncState'; // local id -> { remoteId, userId, status, acornsAwarded }
const META_KEY = 'purchaseSyncMeta';   // { lastSyncedAt, lastError }

// Minutes to wait before retry 1, 2, 3, ... (the last one repeats).
export const RETRY_DELAYS_MIN = [1, 5, 15, 60];

// ======================== 1. Mapping ========================

const roundToCents = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The table's `source` check only allows 'manual' and 'auto'.
function toRowSource(source) {
  return source === 'auto' ? 'auto' : 'manual';
}

/**
 * Local purchase (src/lib/purchases.js shape) -> the columns the app is
 * allowed to insert. id, user_id, status and rewards are set by the
 * database.
 */
export function toInsertRow(purchase) {
  return {
    title: purchase.title,
    store: purchase.store || '',
    url: purchase.url || '',
    price_paid: roundToCents(purchase.pricePaid),
    savings: roundToCents(purchase.savings),
    purchase_date: purchase.purchaseDate,
    return_deadline: purchase.returnDeadline || null,
    source: toRowSource(purchase.source),
  };
}

/** The only columns the app is allowed to update after insert. */
export function toReturnsPatch(purchase) {
  return {
    returned: Boolean(purchase.returned),
    returned_date: purchase.returnedDate || null,
  };
}

/** `purchases` table row -> local purchase. Postgres numerics arrive as strings. */
export function fromPurchaseRow(row) {
  return {
    id: row.id,
    title: row.title,
    store: row.store || '',
    url: row.url || '',
    pricePaid: Number(row.price_paid) || 0,
    savings: Number(row.savings) || 0,
    purchaseDate: row.purchase_date,
    returnDeadline: row.return_deadline || null,
    returned: Boolean(row.returned),
    returnedDate: row.returned_date || null,
    notifiedSoon: false,
    notifiedUrgent: false,
    source: row.source,
    createdAt: row.created_at,
  };
}

// ======================== 2. Queue ========================
// One entry per local purchase id:
//   { id, op: 'upsert' | 'delete', rev, queuedAt, attempts,
//     nextAttemptAt, lastError, failed, maybeInserted }
// 'upsert' means "make the cloud match": insert if it was never
// uploaded, otherwise send the return fields. A newer op for the same id
// replaces the older one, so the queue never outgrows the purchases
// touched. `rev` is unique per entry, so a purchase edited mid-upload
// keeps its newer entry.

/** What needs syncing between two versions of the purchase list. */
export function diffPurchases(before = [], after = []) {
  const oldById = new Map(before.map((p) => [p.id, p]));
  const newIds = new Set(after.map((p) => p.id));
  const ops = [];

  for (const p of after) {
    const old = oldById.get(p.id);
    // Compare only what can be synced, so local-only flags (return
    // reminders) don't trigger uploads.
    if (!old || syncedFields(old) !== syncedFields(p)) ops.push({ id: p.id, op: 'upsert' });
  }
  for (const p of before) {
    if (!newIds.has(p.id)) ops.push({ id: p.id, op: 'delete' });
  }
  return ops;
}

function syncedFields(p) {
  return JSON.stringify([toInsertRow(p), toReturnsPatch(p)]);
}

async function read(key, fallback) {
  const { [key]: value } = await chrome.storage.local.get({ [key]: fallback });
  return value;
}

export function getSyncQueue() {
  return read(QUEUE_KEY, []);
}

// Queue/state updates run one at a time: two changes landing together
// would otherwise both read the old value and one write would be lost.
// The service worker (queueing) and the dashboard (uploading) are
// separate contexts, so this uses the browser's cross-context Web Locks
// when they exist, and a plain promise chain otherwise (tests).
let chain = Promise.resolve();
function withLock(name, fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request(name, fn);
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}
const locked = (fn) => withLock('pocket-purchase-sync-storage', fn);

function updateQueue(update) {
  return locked(async () => {
    const next = await update(await getSyncQueue());
    await chrome.storage.local.set({ [QUEUE_KEY]: next });
    return next;
  });
}

function updateState(update) {
  return locked(async () => {
    const next = await update(await read(STATE_KEY, {}));
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
  });
}

function newEntry(id, op) {
  return {
    id,
    op,
    rev: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    failed: false,
    maybeInserted: false,
  };
}

/** Add work to the queue. A newer op for the same id replaces the old one. */
export function enqueueSync(ops) {
  if (!ops.length) return Promise.resolve();
  return updateQueue((queue) => {
    const byId = new Map(queue.map((entry) => [entry.id, entry]));
    for (const { id, op } of ops) {
      const old = byId.get(id);
      // An unknown-outcome insert must keep its flag, or a retry could
      // create a second row.
      byId.set(id, { ...newEntry(id, op), maybeInserted: Boolean(old?.maybeInserted) });
    }
    return [...byId.values()];
  });
}

/**
 * Queue every change made to the local purchase list from now on.
 * Call once at the top level of the background service worker (it
 * doesn't need Supabase configured). Returns an unsubscribe function.
 */
export function startPurchaseSyncWatcher() {
  const listener = (changes, areaName) => {
    if (areaName !== 'local' || !changes[PURCHASES_KEY]) return;
    const { oldValue, newValue } = changes[PURCHASES_KEY];
    enqueueSync(diffPurchases(oldValue || [], newValue || []));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ======================== 3. Upload ========================

/**
 * Temporary failures (offline, server trouble, expired login, rate
 * limit) are retried; anything else the server rejected will fail the
 * same way every time, so it's parked until retryFailedSync().
 */
export function isTemporaryError(err) {
  const status = Number(/\((\d{3})\)/.exec(String(err?.message))?.[1]);
  if (!status) return true; // no HTTP status: network failure
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

export function retryDelayMs(attempts) {
  const minutes = RETRY_DELAYS_MIN[Math.min(attempts, RETRY_DELAYS_MIN.length) - 1];
  return minutes * 60_000;
}

/**
 * Send everything due in the queue to Supabase.
 *
 * `client`: { getUserId, insertPurchase(row) -> { id }, findPurchase(row)
 * -> id | null, updatePurchase(remoteId, patch), deletePurchase(remoteId),
 * validatePurchase(remoteId) -> { status, acorns_awarded } } -- see
 * purchase-sync-client.js.
 *
 * Signed out: nothing is sent and everything stays queued. Purchases
 * that predate the queue are picked up here too.
 *
 * @returns {Promise<{ status: 'idle' | 'signed-out' | 'synced' | 'partial' | 'failed', synced: number, failed: number }>}
 */
export function flushPurchaseSync(client, options) {
  // One upload at a time across every open page, or two could both
  // insert the same purchase.
  if (globalThis.navigator?.locks) {
    return navigator.locks.request('pocket-purchase-sync-flush', () => flush(client, options));
  }
  return flush(client, options);
}

async function flush(client, { now = Date.now() } = {}) {
  let userId;
  try {
    userId = await client.getUserId();
  } catch {
    return { status: 'failed', synced: 0, failed: 0 };
  }
  if (!userId) return { status: 'signed-out', synced: 0, failed: 0 };

  const purchases = await read(PURCHASES_KEY, []);
  const byId = new Map(purchases.map((p) => [p.id, p]));
  await queueNeverUploaded(purchases, userId);

  const due = (await getSyncQueue()).filter(
    (e) => !e.failed && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now),
  );
  if (!due.length) return { status: 'idle', synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  let lastError = null;

  for (const entry of due) {
    try {
      const note = await syncOne(client, entry, byId.get(entry.id), userId);
      await finish(entry, note);
      synced += 1;
    } catch (err) {
      failed += 1;
      lastError = errorMessage(err);
      await retryLater(entry, err, now);
    }
  }

  await locked(async () => {
    const meta = await read(META_KEY, {});
    await chrome.storage.local.set({
      [META_KEY]: {
        lastSyncedAt: synced ? new Date(now).toISOString() : meta.lastSyncedAt || null,
        lastError: lastError ?? (failed ? meta.lastError : null),
      },
    });
  });

  return { status: !failed ? 'synced' : synced ? 'partial' : 'failed', synced, failed };
}

async function queueNeverUploaded(purchases, userId) {
  const [state, queue] = await Promise.all([read(STATE_KEY, {}), getSyncQueue()]);
  const queued = new Set(queue.map((e) => e.id));
  const missing = purchases.filter((p) => state[p.id]?.userId !== userId && !queued.has(p.id));
  await enqueueSync(missing.map((p) => ({ id: p.id, op: 'upsert' })));
}

// Returns a note to keep on the entry when the work was skipped on
// purpose (e.g. a validated purchase that can't be deleted), else null.
async function syncOne(client, entry, purchase, userId) {
  const synced = (await read(STATE_KEY, {}))[entry.id];
  const remote = synced?.userId === userId ? synced : null;

  if (entry.op === 'delete' || !purchase) {
    if (!remote) return null; // never uploaded: nothing to delete
    if (remote.status === 'validated') {
      await forget(entry.id);
      return 'Kept in the cloud: validated purchases can\'t be deleted.';
    }
    await client.deletePurchase(remote.remoteId);
    await forget(entry.id);
    return null;
  }

  if (!remote) {
    const row = toInsertRow(purchase);
    // The last insert may have reached the server even though we never
    // heard back -- look for it before inserting a duplicate.
    let remoteId = entry.maybeInserted ? await client.findPurchase(row) : null;
    if (!remoteId) {
      try {
        remoteId = (await client.insertPurchase(row)).id;
      } catch (err) {
        if (isTemporaryError(err)) err.maybeInserted = true;
        throw err;
      }
    }
    await remember(entry.id, { remoteId, userId, status: 'pending_validation', acornsAwarded: 0 });
    if (purchase.returned) await client.updatePurchase(remoteId, toReturnsPatch(purchase));
    await validate(client, entry.id, remoteId);
    return null;
  }

  if (remote.status === 'pending_validation') await validate(client, entry.id, remote.remoteId);
  await client.updatePurchase(remote.remoteId, toReturnsPatch(purchase));
  return null;
}

async function validate(client, localId, remoteId) {
  const result = await client.validatePurchase(remoteId);
  await remember(localId, { status: result?.status, acornsAwarded: result?.acorns_awarded ?? 0 });
}

function remember(localId, fields) {
  return updateState((state) => ({ ...state, [localId]: { ...state[localId], ...fields } }));
}

function forget(localId) {
  return updateState((state) => {
    const { [localId]: _, ...rest } = state;
    return rest;
  });
}

// Drop the finished entry -- unless the purchase changed again
// mid-upload, in which case its newer entry stays. A skip note parks the
// entry instead, so getSyncStatus() can report it.
function finish(entry, note) {
  return updateQueue((queue) =>
    queue
      .filter((e) => e.rev !== entry.rev || note)
      .map((e) => (e.rev === entry.rev ? { ...e, failed: true, lastError: note } : e)),
  );
}

function retryLater(entry, err, now) {
  const temporary = isTemporaryError(err);
  return updateQueue((queue) =>
    queue.map((e) => {
      if (e.rev !== entry.rev) return e;
      const attempts = e.attempts + 1;
      return {
        ...e,
        attempts,
        lastError: errorMessage(err),
        failed: !temporary,
        nextAttemptAt: temporary ? new Date(now + retryDelayMs(attempts)).toISOString() : null,
        maybeInserted: e.maybeInserted || Boolean(err?.maybeInserted),
      };
    }),
  );
}

/** Give parked (permanently failed) entries another go, e.g. after a schema fix. */
export function retryFailedSync() {
  return updateQueue((queue) =>
    queue.map((e) => (e.failed ? { ...e, failed: false, attempts: 0, nextAttemptAt: null } : e)),
  );
}

/**
 * For the UI: { pending, failed, lastSyncedAt, lastError }.
 * `pending` will still be retried; `failed` needs attention.
 */
export async function getSyncStatus() {
  const [queue, meta] = await Promise.all([getSyncQueue(), read(META_KEY, {})]);
  return {
    pending: queue.filter((e) => !e.failed).length,
    failed: queue.filter((e) => e.failed).length,
    lastSyncedAt: meta.lastSyncedAt || null,
    lastError: meta.lastError || null,
  };
}

function errorMessage(err) {
  return String(err?.message || err).slice(0, 300);
}

// Supabase access tokens are JWTs whose `sub` claim is the user's id.
// Reading it locally avoids a /auth/v1/user request on every sync; an
// expired token is fine here, since supabase.js refreshes it before the
// actual upload.
export function userIdFromToken(token) {
  if (!token) return null;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).sub || null;
  } catch {
    return null;
  }
}
