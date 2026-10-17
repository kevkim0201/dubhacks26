// Tests for the purchase-record half of savings-storage.js. Kept separate
// from savings.test.js so the two files can change independently.
import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmCurrentDeal,
  getCurrentDealSavings,
  getPurchases,
  onPurchasesChanged,
  saveCurrentDealSavings,
  savePurchase,
} from "./savings-storage.js";
import { getStats } from "../src/lib/purchases.js";

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
          const changes = { [key]: { oldValue, newValue: undefined } };
          for (const listener of listeners) listener(changes, "local");
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

test("purchases start empty and saved purchases come back newest first", async () => {
  installChromeStorageMock();
  assert.deepEqual(await getPurchases(), []);

  const first = await savePurchase({ title: "Headphones", pricePaid: 120, savings: 30 });
  const second = await savePurchase({ title: "Keyboard", pricePaid: 65, savings: 15 });

  const purchases = await getPurchases();
  assert.deepEqual(purchases.map((p) => p.id), [second.id, first.id]);
  assert.equal(purchases[1].title, "Headphones");
  assert.equal(purchases[1].pricePaid, 120);
  assert.equal(purchases[1].savings, 30);
});

test("saved purchases feed the existing stats and character XP", async () => {
  installChromeStorageMock();
  await savePurchase({ title: "Headphones", pricePaid: 120, savings: 30 });
  await savePurchase({ title: "Shoes", pricePaid: 85, savings: 15 });

  assert.equal(getStats(await getPurchases()).totalSaved, 45);
});

test("savePurchase rejects malformed records without writing", async () => {
  installChromeStorageMock();

  await assert.rejects(savePurchase(null), TypeError);
  await assert.rejects(savePurchase({ title: " ", pricePaid: 10 }), TypeError);
  await assert.rejects(savePurchase({ title: "X", pricePaid: -1 }), TypeError);
  await assert.rejects(savePurchase({ title: "X", pricePaid: "10" }), TypeError);
  await assert.rejects(savePurchase({ title: "X", pricePaid: 10, savings: Number.NaN }), TypeError);
  assert.deepEqual(await getPurchases(), []);
});

test("confirming the current deal saves it as a purchase and clears it", async () => {
  installChromeStorageMock();
  assert.equal(await confirmCurrentDeal(), null);

  await saveCurrentDealSavings({
    title: "Sweater",
    store: "Example Shop",
    url: "https://shop.example.com/p/1",
    originalPrice: 120,
    discountedPrice: 96,
    couponSavings: 14.4,
  });

  const purchase = await confirmCurrentDeal();
  assert.equal(purchase.title, "Sweater");
  assert.equal(purchase.pricePaid, 81.6);
  assert.equal(purchase.savings, 38.4);
  assert.equal(purchase.source, "deal");

  assert.equal(await getCurrentDealSavings(), null);
  assert.equal((await getPurchases()).length, 1);
});

test("purchase listener fires only for purchase changes and unsubscribes", async () => {
  installChromeStorageMock();
  let calls = 0;
  const unsubscribe = onPurchasesChanged(() => calls++);

  await saveCurrentDealSavings({ originalPrice: 10, discountedPrice: 8 });
  assert.equal(calls, 0);

  await savePurchase({ title: "Mug", pricePaid: 12 });
  assert.equal(calls, 1);

  unsubscribe();
  await savePurchase({ title: "Plate", pricePaid: 9 });
  assert.equal(calls, 1);
});
