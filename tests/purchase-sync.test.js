import assert from "node:assert/strict";
import test from "node:test";

import {
  diffPurchases,
  enqueueSync,
  flushPurchaseSync,
  fromPurchaseRow,
  getSyncQueue,
  getSyncStatus,
  isTemporaryError,
  retryFailedSync,
  startPurchaseSyncWatcher,
  toInsertRow,
  toReturnsPatch,
  userIdFromToken,
} from "../src/lib/purchase-sync.js";

function installChromeStorageMock() {
  const values = {};
  const listeners = new Set();

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...values };
        },
        async set(updates) {
          const changes = {};
          for (const [key, newValue] of Object.entries(updates)) {
            changes[key] = { oldValue: values[key], newValue };
            values[key] = newValue;
          }
          for (const listener of listeners) listener(changes, "local");
        },
        async remove(key) {
          const oldValue = values[key];
          delete values[key];
          for (const listener of listeners) listener({ [key]: { oldValue } }, "local");
        },
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        },
      },
    },
  };
}

// Lets queued storage writes (run from onChanged listeners) finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setPurchases = (purchases) => chrome.storage.local.set({ purchases });
const getState = async () => (await chrome.storage.local.get({ purchaseSyncState: {} })).purchaseSyncState;

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const MINUTE = 60_000;

function purchase(overrides = {}) {
  return {
    id: "p-1",
    title: "Headphones",
    store: "Example Shop",
    url: "https://shop.example.com/p/1",
    pricePaid: 120,
    savings: 30,
    purchaseDate: "2026-10-17T10:00:00.000Z",
    returnDeadline: null,
    returned: false,
    returnedDate: null,
    notifiedSoon: false,
    notifiedUrgent: false,
    source: "manual",
    createdAt: "2026-10-17T10:00:00.000Z",
    ...overrides,
  };
}

const httpError = (status) => new Error(`Supabase POST purchases failed (${status}): nope`);

// Records every call. `fail` maps a method name to an error to throw
// (once, unless `failAlways` is set).
function fakeClient({ userId = "user-1", fail = {}, failAlways = false, validateStatus = "validated", existing = null } = {}) {
  const calls = { insert: [], find: [], update: [], delete: [], validate: [] };
  let next = 1;
  const maybeFail = (name) => {
    if (fail[name]) {
      const err = fail[name];
      if (!failAlways) delete fail[name];
      throw err;
    }
  };
  return {
    calls,
    async getUserId() {
      return userId;
    },
    async insertPurchase(row) {
      calls.insert.push(row);
      maybeFail("insert");
      return { id: `row-${next++}` };
    },
    async findPurchase(row) {
      calls.find.push(row);
      return existing;
    },
    async updatePurchase(remoteId, patch) {
      calls.update.push([remoteId, patch]);
      maybeFail("update");
    },
    async deletePurchase(remoteId) {
      calls.delete.push(remoteId);
      maybeFail("delete");
    },
    async validatePurchase(remoteId) {
      calls.validate.push(remoteId);
      maybeFail("validate");
      return { status: validateStatus, acorns_awarded: 0 };
    },
  };
}

// ======================== 1. Mapping ========================

test("insert rows only use the columns the schema lets the app write", () => {
  const row = toInsertRow(purchase({ pricePaid: 81.6000001, source: "deal" }));

  assert.deepEqual(row, {
    title: "Headphones",
    store: "Example Shop",
    url: "https://shop.example.com/p/1",
    price_paid: 81.6,
    savings: 30,
    purchase_date: "2026-10-17T10:00:00.000Z",
    return_deadline: null,
    source: "manual",
  });
  const granted = ["title", "store", "url", "price_paid", "savings", "purchase_date", "return_deadline", "source", "coupon_id"];
  assert.ok(Object.keys(row).every((column) => granted.includes(column)));
});

test("only 'auto' survives as a source; everything else is manual", () => {
  assert.equal(toInsertRow(purchase({ source: "auto" })).source, "auto");
  assert.equal(toInsertRow(purchase({ source: undefined })).source, "manual");
});

test("updates only touch the return fields", () => {
  assert.deepEqual(toReturnsPatch(purchase({ returned: true, returnedDate: "2026-10-20T00:00:00.000Z" })), {
    returned: true,
    returned_date: "2026-10-20T00:00:00.000Z",
  });
});

test("a table row maps back to a local purchase", () => {
  const local = fromPurchaseRow({
    ...toInsertRow(purchase()),
    id: "p-1",
    price_paid: "120.00",
    savings: "30.00",
    returned: false,
    returned_date: null,
    created_at: "2026-10-17T10:00:00.000Z",
  });
  assert.deepEqual(local, purchase());
});

// ======================== 2. Queue ========================

test("diff finds added, changed and removed purchases", () => {
  const a = purchase({ id: "a" });
  const b = purchase({ id: "b" });
  const c = purchase({ id: "c" });

  assert.deepEqual(diffPurchases([a, b], [{ ...a, returned: true }, c]), [
    { id: "a", op: "upsert" },
    { id: "c", op: "upsert" },
    { id: "b", op: "delete" },
  ]);
});

test("local-only changes (return reminders) are not queued", () => {
  const a = purchase();
  assert.deepEqual(diffPurchases([a], [{ ...a, notifiedSoon: true }]), []);
});

test("watcher queues purchase changes, one entry per purchase", async () => {
  installChromeStorageMock();
  const stop = startPurchaseSyncWatcher();

  await setPurchases([purchase({ id: "a" })]);
  await setPurchases([purchase({ id: "a", returned: true }), purchase({ id: "b" })]);
  await setPurchases([purchase({ id: "b" })]);
  await chrome.storage.local.set({ pendingPurchases: [purchase({ id: "x" })] });
  await settle();

  assert.deepEqual(
    (await getSyncQueue()).map(({ id, op }) => ({ id, op })),
    [
      { id: "a", op: "delete" },
      { id: "b", op: "upsert" },
    ],
  );

  stop();
  await setPurchases([]);
  await settle();
  assert.equal((await getSyncQueue()).length, 2);
});

// ======================== 3. Upload ========================

test("signed out: nothing is sent and the work stays queued", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  await enqueueSync([{ id: "p-1", op: "upsert" }]);

  const client = fakeClient({ userId: null });
  assert.equal((await flushPurchaseSync(client, { now: NOW })).status, "signed-out");
  assert.equal(client.calls.insert.length, 0);
  assert.equal((await getSyncQueue()).length, 1);
});

test("a new purchase is inserted, validated and remembered", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]); // never queued: predates the watcher

  const client = fakeClient();
  const result = await flushPurchaseSync(client, { now: NOW });

  assert.deepEqual(result, { status: "synced", synced: 1, failed: 0 });
  assert.deepEqual(client.calls.insert, [toInsertRow(purchase())]);
  assert.deepEqual(client.calls.validate, ["row-1"]);
  assert.deepEqual((await getState())["p-1"], {
    remoteId: "row-1",
    userId: "user-1",
    status: "validated",
    acornsAwarded: 0,
  });
  assert.deepEqual(await getSyncQueue(), []);

  // Nothing left to do: no second insert.
  assert.equal((await flushPurchaseSync(client, { now: NOW })).status, "idle");
  assert.equal(client.calls.insert.length, 1);
});

test("a returned purchase is inserted, then its return fields are set", async () => {
  installChromeStorageMock();
  const returned = purchase({ returned: true, returnedDate: "2026-10-18T00:00:00.000Z" });
  await setPurchases([returned]);

  const client = fakeClient();
  await flushPurchaseSync(client, { now: NOW });
  assert.deepEqual(client.calls.update, [["row-1", toReturnsPatch(returned)]]);
});

test("after upload, edits only send the return fields", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient();
  await flushPurchaseSync(client, { now: NOW });

  const returned = purchase({ returned: true, returnedDate: "2026-10-18T00:00:00.000Z" });
  await setPurchases([returned]);
  await enqueueSync([{ id: "p-1", op: "upsert" }]);
  await flushPurchaseSync(client, { now: NOW });

  assert.equal(client.calls.insert.length, 1);
  assert.deepEqual(client.calls.update, [["row-1", toReturnsPatch(returned)]]);
});

test("deleting an uploaded, unvalidated purchase deletes its row", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient({ validateStatus: "rejected" });
  await flushPurchaseSync(client, { now: NOW });

  await setPurchases([]);
  await enqueueSync([{ id: "p-1", op: "delete" }]);
  await flushPurchaseSync(client, { now: NOW });

  assert.deepEqual(client.calls.delete, ["row-1"]);
  assert.deepEqual(await getState(), {});
  assert.deepEqual(await getSyncQueue(), []);
});

test("deleting a purchase that was never uploaded sends nothing", async () => {
  installChromeStorageMock();
  await enqueueSync([{ id: "never-sent", op: "delete" }]);
  const client = fakeClient();
  assert.equal((await flushPurchaseSync(client, { now: NOW })).status, "synced");
  assert.deepEqual(client.calls.delete, []);
});

test("a validated purchase isn't deleted from the cloud, and says why", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient(); // validates
  await flushPurchaseSync(client, { now: NOW });

  await setPurchases([]);
  await enqueueSync([{ id: "p-1", op: "delete" }]);
  await flushPurchaseSync(client, { now: NOW });

  assert.deepEqual(client.calls.delete, []);
  const status = await getSyncStatus();
  assert.equal(status.failed, 1);
  assert.match((await getSyncQueue())[0].lastError, /validated/);
});

test("temporary failures retry later with growing gaps", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient({ fail: { validate: httpError(503) } });

  const first = await flushPurchaseSync(client, { now: NOW });
  assert.equal(first.status, "failed");
  let [entry] = await getSyncQueue();
  assert.equal(entry.attempts, 1);
  assert.equal(entry.failed, false);
  assert.equal(Date.parse(entry.nextAttemptAt), NOW + 1 * MINUTE);

  // Not due yet.
  assert.equal((await flushPurchaseSync(client, { now: NOW + 30_000 })).status, "idle");

  // Due: validates the row it already inserted -- no second insert.
  assert.equal((await flushPurchaseSync(client, { now: NOW + MINUTE })).status, "synced");
  assert.equal(client.calls.insert.length, 1);
  assert.deepEqual(client.calls.validate, ["row-1", "row-1"]);
});

test("permanent failures are parked until retried by hand", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient({ fail: { insert: httpError(400) } });

  await flushPurchaseSync(client, { now: NOW });
  let status = await getSyncStatus();
  assert.deepEqual([status.pending, status.failed], [0, 1]);
  assert.match(status.lastError, /400/);

  // Still parked much later.
  assert.equal((await flushPurchaseSync(client, { now: NOW + 999 * MINUTE })).status, "idle");

  await retryFailedSync();
  assert.equal((await flushPurchaseSync(client, { now: NOW })).status, "synced");
  status = await getSyncStatus();
  assert.deepEqual([status.pending, status.failed, status.lastError], [0, 0, null]);
});

test("an insert with no response is looked up before inserting again", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient({ fail: { insert: new TypeError("Failed to fetch") }, existing: "row-99" });

  await flushPurchaseSync(client, { now: NOW });
  assert.equal((await getSyncQueue())[0].maybeInserted, true);

  await flushPurchaseSync(client, { now: NOW + MINUTE });
  assert.equal(client.calls.find.length, 1);
  assert.equal(client.calls.insert.length, 1); // only the first, failed one
  assert.equal((await getState())["p-1"].remoteId, "row-99");
});

test("a purchase changed during upload stays queued", async () => {
  installChromeStorageMock();
  await setPurchases([purchase()]);
  const client = fakeClient();
  const validate = client.validatePurchase;
  client.validatePurchase = async (remoteId) => {
    await enqueueSync([{ id: "p-1", op: "upsert" }]); // edited mid-upload
    return validate(remoteId);
  };

  await flushPurchaseSync(client, { now: NOW });
  assert.equal((await getSyncQueue()).length, 1);
});

test("errors are sorted into temporary and permanent", () => {
  assert.equal(isTemporaryError(new TypeError("Failed to fetch")), true);
  for (const code of [401, 408, 429, 500, 503]) assert.equal(isTemporaryError(httpError(code)), true, code);
  for (const code of [400, 403, 404, 409]) assert.equal(isTemporaryError(httpError(code)), false, code);
});

test("user id is read from the access token", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
  assert.equal(userIdFromToken(`header.${payload}.sig`), "user-1");
  assert.equal(userIdFromToken(null), null);
  assert.equal(userIdFromToken("not-a-jwt"), null);
});
