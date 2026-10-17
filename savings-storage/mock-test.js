// Mock purchases and edge-case fixtures for savings.test.js.
const base = { currency: "USD", status: "self_reported" };

export const mockPurchases = [
  { ...base, id: "purchase-001", productName: "Headphones",    originalTotalCents: 15000, paidTotalCents: 12000, savingsCents: 3000, purchasedAt: "2026-10-17T10:00:00Z" },
  { ...base, id: "purchase-002", productName: "Running Shoes", originalTotalCents: 10000, paidTotalCents: 8500,  savingsCents: 1500, purchasedAt: "2026-10-17T11:00:00Z" },
  { ...base, id: "purchase-003", productName: "Keyboard",      originalTotalCents: 8000,  paidTotalCents: 6500,  savingsCents: 1500, purchasedAt: "2026-10-17T12:00:00Z" },
];
// Expected: total $60.00, count 3, average $20.00, most recent $15.00 (Keyboard).

// Edge-case fixtures used by savings.test.js.
export const edgeCases = {
  duplicate: { ...mockPurchases[0], savingsCents: 3000 },
  negativePrice: { ...base, id: "bad-1", productName: "Bad", originalTotalCents: -100, paidTotalCents: 50, savingsCents: 0, purchasedAt: "2026-10-17T10:00:00Z" },
  wrongSavings: { ...base, id: "bad-2", productName: "Mismatch", originalTotalCents: 1000, paidTotalCents: 500, savingsCents: 999, purchasedAt: "2026-10-17T10:00:00Z" },
  pending: { ...base, id: "pending-1", productName: "Pending deal", status: "pending", originalTotalCents: 5000, paidTotalCents: 4000, savingsCents: 1000, purchasedAt: "2026-10-17T10:00:00Z" },
  zeroSavings: { ...base, id: "zero-1", productName: "Full price", originalTotalCents: 2000, paidTotalCents: 2000, savingsCents: 0, purchasedAt: "2026-10-17T13:00:00Z" },
  paidMoreThanOriginal: { ...base, id: "zero-2", productName: "Overpaid", originalTotalCents: 2000, paidTotalCents: 2500, savingsCents: 0, purchasedAt: "2026-10-17T09:00:00Z" },
  eur: { ...base, id: "eur-1", productName: "Euro", currency: "EUR", originalTotalCents: 2000, paidTotalCents: 1500, savingsCents: 500, purchasedAt: "2026-10-17T09:00:00Z" },
};