import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmDetailsFromDeal,
  confirmDetailsFromPending,
  friendlyError,
} from "../src/popup/purchase-confirm-modal.js";
import { purchaseFromDeal } from "../savings-storage/deal-savings-view.js";
import { MOCK_DEAL } from "../savings-storage/mock-deal.js";
import { calculateSavings } from "../src/lib/savings.js";

// ======================== Pending (detected) purchases ========================

test("a detected purchase shows original = paid + saved", () => {
  assert.deepEqual(
    confirmDetailsFromPending({ title: "Keyboard", store: "shop.com", pricePaid: 65, savings: 15 }),
    { title: "Keyboard", store: "shop.com", originalPrice: 80, finalPrice: 65, savings: 15 },
  );
});

test("review-card input strings are read as money and rounded to cents", () => {
  const details = confirmDetailsFromPending({ title: "Mug", pricePaid: "12.499", savings: "0.1" });
  assert.equal(details.finalPrice, 12.5);
  assert.equal(details.savings, 0.1);
  assert.equal(details.originalPrice, 12.6);
});

test("empty savings counts as nothing saved", () => {
  const details = confirmDetailsFromPending({ title: "Mug", pricePaid: "12", savings: "" });
  assert.deepEqual([details.originalPrice, details.finalPrice, details.savings], [12, 12, 0]);
});

// ======================== Current deal ========================

test("the demo deal shows $150 → $96 and $54 saved with its coupon", () => {
  const deal = { ...MOCK_DEAL, potentialSavings: calculateSavings(150, 96) };
  assert.deepEqual(confirmDetailsFromDeal(deal), {
    title: "Demo product",
    store: "Example Shop",
    couponCode: "POCKET20",
    originalPrice: 150,
    finalPrice: 96,
    savings: 54,
  });
});

test("a deal with no coupon pays the sale price", () => {
  const details = confirmDetailsFromDeal({ originalPrice: 50, discountedPrice: 40, potentialSavings: 10 });
  assert.equal(details.finalPrice, 40);
  assert.equal(details.savings, 10);
  assert.equal(details.couponCode, "");
  assert.equal(details.title, "This product");
});

test("float noise in deal math is rounded away", () => {
  const details = confirmDetailsFromDeal({ originalPrice: 120, discountedPrice: 96, couponSavings: 14.4, potentialSavings: 38.4 });
  assert.equal(details.finalPrice, 81.6);
});

test("the saved purchase matches what the modal showed", () => {
  const deal = { ...MOCK_DEAL, url: "http://example.com/", potentialSavings: 54 };
  const shown = confirmDetailsFromDeal(deal);
  const saved = purchaseFromDeal(deal);

  assert.deepEqual(saved, {
    title: "Demo product",
    store: "Example Shop",
    url: "http://example.com/",
    pricePaid: shown.finalPrice,
    savings: shown.savings,
    source: "manual",
  });
});

// ======================== Error messages ========================

test("background errors are shown without the 'Error:' prefix", () => {
  assert.equal(friendlyError("Error: pricePaid must be a non-negative number"), "Price paid must be a non-negative number.");
  assert.equal(friendlyError("Error: savings must be a non-negative number."), "Savings must be a non-negative number.");
});

test("duplicates and missing replies get plain-language messages", () => {
  assert.equal(friendlyError("Error: Duplicate purchase ID: abc"), "This purchase is already saved.");
  assert.equal(friendlyError(undefined), "Couldn't save this purchase. Please try again.");
  assert.equal(friendlyError(""), "Couldn't save this purchase. Please try again.");
});
