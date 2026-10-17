// Sample records use the canonical purchase shape and dollar amounts.

export const mockPurchases = [
  { id: "purchase-001", title: "Headphones", pricePaid: 120, savings: 30, purchaseDate: "2026-10-17T10:00:00Z" },
  { id: "purchase-002", title: "Running Shoes", pricePaid: 85, savings: 15, purchaseDate: "2026-10-17T11:00:00Z" },
  { id: "purchase-003", title: "Keyboard", pricePaid: 65, savings: 15, purchaseDate: "2026-10-17T12:00:00Z" },
];
// Expected: total $60.00, count 3, average $20.00, most recent $15.00 (Keyboard).

// Edge-case fixtures used by the savings tests.
export const edgeCases = {
  negativePrice: { id: "bad-1", title: "Bad", pricePaid: -1, savings: 0, purchaseDate: "2026-10-17T10:00:00Z" },
  negativeSavings: { id: "bad-2", title: "Bad savings", pricePaid: 10, savings: -1, purchaseDate: "2026-10-17T10:00:00Z" },
  missingTitle: { id: "bad-3", pricePaid: 10, savings: 1, purchaseDate: "2026-10-17T10:00:00Z" },
  badDate: { id: "bad-4", title: "Bad date", pricePaid: 10, savings: 1, purchaseDate: "not-a-date" },
  floatA: { id: "float-a", title: "Float A", pricePaid: 1, savings: 0.1, purchaseDate: "2026-10-17T10:00:00Z" },
  floatB: { id: "float-b", title: "Float B", pricePaid: 1, savings: 0.2, purchaseDate: "2026-10-17T11:00:00Z" },
  returned: { id: "returned", title: "Returned item", pricePaid: 1, savings: 0.1, purchaseDate: "2026-10-17T09:00:00Z", returned: true },
};