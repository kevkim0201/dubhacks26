import assert from "node:assert/strict";
import test from "node:test";

import { addPurchase, deletePurchase, getPurchases } from "../src/lib/purchases.js";

function installChromeStorageMock(initialPurchases = []) {
  const values = { purchases: initialPurchases };
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...values };
        },
        async set(updates) {
          Object.assign(values, updates);
        },
      },
    },
  };
}

test("addPurchase calculates rounded savings, validates and persists canonical dollars", async () => {
  installChromeStorageMock();

  const added = await addPurchase({
    id: "purchase-1",
    title: "Headphones",
    pricePaid: 0.1,
    originalPrice: 0.3,
    purchaseDate: "2026-10-17T10:00:00Z",
    source: "auto",
  });

  assert.equal(added.savings, 0.2);
  assert.equal(added.pricePaid, 0.1);
  assert.equal(added.source, "auto");
  assert.equal("originalPrice" in added, false);
  assert.equal("currency" in added, false);
  assert.equal("status" in added, false);
  assert.deepEqual(await getPurchases(), [added]);
});

test("addPurchase generates missing IDs and rejects duplicates and invalid amounts", async () => {
  installChromeStorageMock();
  const data = {
    title: "Keyboard",
    pricePaid: "10.00",
    savings: "2.50",
    purchaseDate: "2026-10-17T10:00:00Z",
  };

  const generated = await addPurchase(data);
  assert.ok(generated.id);
  assert.equal(generated.savings, 2.5);
  await assert.rejects(addPurchase({ ...data, id: generated.id }), /Duplicate purchase ID/);
  await assert.rejects(addPurchase({ ...data, pricePaid: Infinity }), /pricePaid/);
  await assert.rejects(addPurchase({ ...data, savings: -1 }), /savings/);
  assert.equal((await getPurchases()).length, 1);
});

test("deletePurchase persists and returns the deleted record and remaining purchases", async () => {
  const first = {
    id: "purchase-1",
    title: "Headphones",
    pricePaid: 120,
    savings: 30,
    purchaseDate: "2026-10-17T10:00:00Z",
  };
  const second = {
    id: "purchase-2",
    title: "Keyboard",
    pricePaid: 65,
    savings: 15,
    purchaseDate: "2026-10-17T11:00:00Z",
  };
  installChromeStorageMock([first, second]);

  const result = await deletePurchase(first.id);
  assert.deepEqual(result, { deleted: first, remaining: [second] });
  assert.deepEqual(await getPurchases(), [second]);

  const missing = await deletePurchase("not-found");
  assert.deepEqual(missing, { deleted: null, remaining: [second] });
});

test("a deleted purchase can be re-added for undo without losing its record fields", async () => {
  installChromeStorageMock();
  const original = await addPurchase({
    id: "undo-purchase",
    title: "Returned headphones",
    store: "Example Store",
    url: "https://example.com/order/1",
    pricePaid: 80,
    savings: 20,
    purchaseDate: "2026-10-17T10:00:00Z",
    returnDeadline: "2026-11-17T10:00:00Z",
    returned: true,
    returnedDate: "2026-10-18T10:00:00Z",
    notifiedSoon: true,
    notifiedUrgent: true,
    source: "auto",
  });

  const { deleted } = await deletePurchase(original.id);
  const restored = await addPurchase(deleted);

  assert.deepEqual(restored, original);
  assert.deepEqual(await getPurchases(), [original]);
});
