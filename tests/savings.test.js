import assert from "node:assert/strict";
import test from "node:test";

import { edgeCases, mockPurchases } from "./mock-purchases.js";
import {
  clearCurrentDealSavings,
  getCurrentDealSavings,
  onCurrentDealSavingsChanged,
  saveCurrentDealSavings,
} from "../savings-storage/savings-storage.js";
import {
  calculateSavings,
  formatCurrency,
  getConfirmedPurchases,
  isValidPurchase,
} from "../src/lib/savings.js";
import {
  getAverageSavings,
  getPurchaseCount,
  getRecentSavings,
  getSavingsSummary,
  getTotalSavings,
} from "../src/lib/savings-summary.js";

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

test("validates the canonical purchase shape without requiring a status field", () => {
  const purchases = [
    ...mockPurchases,
    edgeCases.negativePrice,
    edgeCases.negativeSavings,
    edgeCases.missingTitle,
    edgeCases.badDate,
  ];
  const original = [...purchases];

  const confirmed = getConfirmedPurchases(purchases);

  assert.deepEqual(confirmed, mockPurchases);
  assert.deepEqual(purchases, original);
  assert.equal(isValidPurchase(mockPurchases[0]), true);
  assert.equal(isValidPurchase(null), false);
  assert.deepEqual(getConfirmedPurchases(null), []);
});

test("summary and canonical stats agree in dollars and include returned purchases", () => {
  const purchases = [...mockPurchases, edgeCases.returned];
  const summary = getSavingsSummary(purchases);

  assert.deepEqual(summary, {
    totalSaved: 60.1,
    purchaseCount: 4,
    averageSaved: 15.03,
    mostRecentSaved: 15,
    recentPurchases: [mockPurchases[2], mockPurchases[1], mockPurchases[0], edgeCases.returned],
  });
  assert.equal(getTotalSavings(purchases), 60.1);
  assert.equal(getPurchaseCount(purchases), 4);
  assert.equal(getAverageSavings(purchases), 15.03);
  assert.deepEqual(getRecentSavings(purchases, 2), [mockPurchases[2], mockPurchases[1]]);
  assert.deepEqual(getRecentSavings(mockPurchases, 0), []);
});

test("dollar arithmetic rounds through cents and formatting accepts dollars", () => {
  const floatSummary = getSavingsSummary([edgeCases.floatA, edgeCases.floatB]);
  assert.equal(calculateSavings(100, 79.9), 20.1);
  assert.equal(calculateSavings(0.3, 0.1), 0.2);
  assert.equal(calculateSavings(10, 12), 0);
  assert.throws(() => calculateSavings(-1, 0), TypeError);
  assert.equal(floatSummary.totalSaved, 0.3);
  assert.equal(formatCurrency(floatSummary.totalSaved), "$0.30");
  assert.equal(getTotalSavings(mockPurchases), 60);
  assert.equal(formatCurrency(60.75), "$60.75");
  assert.equal(formatCurrency(Number.NaN), "$0.00");
});

test("empty summary has stable defaults", () => {
  assert.deepEqual(getSavingsSummary([]), {
    totalSaved: 0,
    purchaseCount: 0,
    averageSaved: 0,
    mostRecentSaved: 0,
    recentPurchases: [],
  });
});

test("savings storage reads, validates, saves, and clears the current deal", async () => {
  installChromeStorageMock();

  assert.equal(await getCurrentDealSavings(), null);

  const saved = await saveCurrentDealSavings({
    originalPrice: 100,
    discountedPrice: 80,
    couponSavings: 5,
  });
  assert.equal(saved.potentialSavings, 25);
  assert.equal(await getCurrentDealSavings(), saved);
  assert.equal(Number.isNaN(Date.parse(saved.updatedAt)), false);

  await clearCurrentDealSavings();
  assert.equal(await getCurrentDealSavings(), null);
});

test("savings storage rejects invalid prices and savings", async () => {
  installChromeStorageMock();

  await assert.rejects(saveCurrentDealSavings(null), TypeError);
  await assert.rejects(
    saveCurrentDealSavings({ originalPrice: -1, discountedPrice: 0 }),
    TypeError,
  );
  await assert.rejects(
    saveCurrentDealSavings({ originalPrice: 10, discountedPrice: 11 }),
    RangeError,
  );
  await assert.rejects(
    saveCurrentDealSavings({
      originalPrice: 10,
      discountedPrice: 5,
      couponSavings: 6,
    }),
    RangeError,
  );
  assert.equal(await getCurrentDealSavings(), null);
});

test("storage change subscription forwards local updates and unsubscribes", async () => {
  installChromeStorageMock();
  const updates = [];
  const unsubscribe = onCurrentDealSavingsChanged((deal) => updates.push(deal));

  await saveCurrentDealSavings({
    originalPrice: 10,
    discountedPrice: 8,
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].potentialSavings, 2);

  unsubscribe();
  await clearCurrentDealSavings();
  assert.equal(updates.length, 1);
});
