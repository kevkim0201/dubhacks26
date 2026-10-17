# Demo purchase fixtures

Three static pages for testing/demoing the real purchase-detection flow
(`src/content/content.js`) end-to-end, without needing a real retailer
checkout or a whole fake storefront. `content.js` only ever looks at the
*order-confirmation* page -- nothing before it is inspected -- so a single
page that looks like one is enough to exercise the real detector, the
pending-review card, and the confirm flow.

## Why not a full fake e-commerce site

Browsing/cart/checkout pages add build time without adding test coverage,
since the extension doesn't watch them. These three pages cover the three
things `content.js` actually has to handle differently:

| Fixture | Tests | How |
| --- | --- | --- |
| `order-confirmation.html` | The JSON-LD extraction path (`extractFromJsonLd`) -- the more reliable of the two, used when a storefront has real `Order` structured data | A `<script type="application/ld+json">` block with `@type: "Order"` |
| `receipt.html` | The heuristic fallback (`extractFromHeuristics`) -- used when there's no structured data | No JSON-LD at all; a `total $X.XX` pattern in body text and an `<h1>` for the title |
| `spa-checkout.html` | The SPA case: a checkout that updates via JS instead of a full page load | A "Place order" button that calls `history.pushState()` and swaps in confirmation markup with plain DOM mutation -- no navigation. Exercises `content.js`'s 1.5s `location.href` poll and its `MutationObserver`, not just its on-load check |

Each page also logs on-page text explaining what it's demonstrating, in case you're walking someone through it live.

## Running them

Content scripts only match `http://*/*` and `https://*/*` -- **not**
`file://` -- so these have to be served, not opened directly:

```bash
cd demo-fixtures
python3 -m http.server 8000
```

Then, with the extension loaded (`chrome://extensions` → load unpacked →
repo root) and the dashboard's "Detect purchases automatically" setting
on (it's on by default), visit:

- `http://localhost:8000/order-confirmation.html`
- `http://localhost:8000/receipt.html`
- `http://localhost:8000/spa-checkout.html` (click "Place order" once it loads -- the confirmation state only appears after that)

A toast should appear on the page within a couple seconds ("Pocket
spotted ... — click the toolbar icon to confirm"), and the toolbar badge
turns blue. Open the popup to see the pending-review card with the
scraped title/price/savings, pre-filled and editable before you confirm
or dismiss it.

## Re-testing the same fixture

A confirmed *or dismissed* page is remembered by URL (`origin + pathname`,
query strings and hashes are ignored for this) so revisiting it won't
re-trigger. To test the same fixture again without clearing extension
storage, just change the query string, e.g.:

```
http://localhost:8000/order-confirmation.html?run=2
```

To reset everything instead: `chrome://extensions` → the card's
**Details** → **Clear data**, or run
`chrome.storage.local.clear()` in the service worker's console
(`chrome://extensions` → **service worker** link → Console).

## Expected scrape per fixture

| Fixture | Title | Price paid | Savings |
| --- | --- | --- | --- |
| `order-confirmation.html` | Trailhead Wireless Headphones | $89.99 | $15.00 |
| `receipt.html` | Lantern Camp Stove — Order Confirmed | $124.50 | $24.50 |
| `spa-checkout.html` | Order confirmed | $27.50 | $5.00 |

If a scrape doesn't match this, that's a real regression in
`content.js`, not the fixture -- these pages are deliberately simple so
the detector's own logic is the only variable.
