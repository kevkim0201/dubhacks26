import assert from "node:assert/strict";
import test from "node:test";

import { edgeCases, mockPurchases } from "./mock-test.js";
import {
  clearCurrentDealSavings,
  getCurrentDealSavings,
  onCurrentDealSavingsChanged,
  saveCurrentDealSavings,
} from "./savings-storage.js";
import {
  formatCurrency,
  getConfirmedPurchases,
  isValidPurchase,
} from "./savings.js";
import {
  getAverageSavings,
  getPurchaseCount,
  getRecentSavings,
  getSavingsSummary,
  getTotalSavings,
} from "./savings-summary.js";

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

test("only valid, confirmed purchases count and the first duplicate wins", () => {
  const purchases = [
    ...mockPurchases,
    edgeCases.duplicate,
    edgeCases.negativePrice,
    edgeCases.wrongSavings,
    edgeCases.pending,
    edgeCases.eur,
  ];
  const original = [...purchases];

  const confirmed = getConfirmedPurchases(purchases);

  assert.deepEqual(confirmed, mockPurchases);
  assert.deepEqual(purchases, original);
  assert.equal(isValidPurchase(edgeCases.zeroSavings), true);
  assert.equal(isValidPurchase(edgeCases.paidMoreThanOriginal), true);
  assert.equal(isValidPurchase(null), false);
  assert.deepEqual(getConfirmedPurchases(null), []);
});

test("savings summary uses confirmed purchases and integer cents", () => {
  const summary = getSavingsSummary([
    ...mockPurchases,
    edgeCases.pending,
    edgeCases.negativePrice,
  ]);

  assert.deepEqual(summary, {
    totalSavedCents: 6000,
    purchaseCount: 3,
    averageSavedCents: 2000,
    mostRecentSavedCents: 1500,
    recentPurchases: [mockPurchases[2], mockPurchases[1], mockPurchases[0]],
  });
  assert.equal(getTotalSavings(mockPurchases), 6000);
  assert.equal(getPurchaseCount(mockPurchases), 3);
  assert.equal(getAverageSavings(mockPurchases), 2000);
  assert.deepEqual(getRecentSavings(mockPurchases, 2), [mockPurchases[2], mockPurchases[1]]);
  assert.deepEqual(getRecentSavings(mockPurchases, 0), []);
});

test("empty summary and currency formatting have stable defaults", () => {
  assert.deepEqual(getSavingsSummary([]), {
    totalSavedCents: 0,
    purchaseCount: 0,
    averageSavedCents: 0,
    mostRecentSavedCents: 0,
    recentPurchases: [],
  });
  assert.equal(formatCurrency(6075), "$60.75");
  assert.equal(formatCurrency(Number.NaN), "$0.00");
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
