# Demo purchase fixtures

Four static pages for testing/demoing the real purchase-detection and
coupon flows end-to-end, without needing a real retailer checkout or a
whole fake storefront. The extension only ever looks at two kinds of
page -- a checkout with a coupon field (`src/content/coupon-finder.js`)
and an order-confirmation page (`src/content/content.js`) -- so pages
that look like exactly those two things are enough to exercise the real
detector/scraper, the pending-review card, and the confirm flow.

## Why not a full fake e-commerce site

Browsing pages and the rest of a storefront add build time without
adding test coverage, since nothing in the extension watches them. These
four pages cover the things the content scripts actually have to handle
differently:

| Fixture | Tests | How |
| --- | --- | --- |
| `order-confirmation.html` | The JSON-LD extraction path (`extractFromJsonLd`) -- the more reliable of the two, used when a storefront has real `Order` structured data | A `<script type="application/ld+json">` block with `@type: "Order"` |
| `receipt.html` | The heuristic fallback (`extractFromHeuristics`) -- used when there's no structured data | No JSON-LD at all; a `total $X.XX` pattern in body text and an `<h1>` for the title |
| `spa-checkout.html` | The SPA case: a checkout that updates via JS instead of a full page load | A "Place order" button that calls `history.pushState()` and swaps in confirmation markup with plain DOM mutation -- no navigation. Exercises `content.js`'s 1.5s `location.href` poll and its `MutationObserver`, not just its on-load check |
| `coupon-checkout.html` | The coupon stage upstream of all that: `detectCouponField`/`detectCartTotals`/`applyCouponOnPage` (`coupon-finder.js`), then transitions (same pushState trick) into an order-confirmation reflecting whichever code was applied | A real coupon field + "subtotal"/"shipping" text + an Apply button that *actually* recalculates the total, so you can see whether `applyCouponOnPage()` really worked, not just whether it clicked something |

Each page also logs on-page text explaining what it's demonstrating, in case you're walking someone through it live.

## The coupon fixture specifically

`coupon-checkout.html`'s cart ($120 + $6 shipping) and its three codes
(`POCKET20`/`TAKE15`/`SHIPFREE`) match `src/lib/coupons.js`'s
`MOCK_COUPONS` exactly, so Pocket's own "Coupons & savings" popup view
finds and ranks real offers against this page -- not just a page that
merely looks like a checkout. That required adding a `store: 'localhost'`
copy of those three mock entries in `coupons.js` (flagged in a comment
there), since the existing mock data was hardcoded to `example.com` only.

This is also the one place to see the gap behind supabase/schema.sql's
rule that a purchase only earns XP *or* acorns if it went through
Pocket's own coupon flow: today, `applyCouponOnPage()` only confirms it
filled a field and clicked a button -- not that a discount landed (see
its own comment in `coupon-finder.js`) -- and nothing yet *records* that
Pocket applied a code at all, so there's no signal yet for a later
purchase to point back to and prove "this one went through our coupon
flow." Typing the same code in by hand produces an identical
confirmation page to Pocket having clicked it for you, which is exactly
why that write (not just this fixture) is the real next step -- see
supabase/README.md's "Practical implication" note.

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
- `http://localhost:8000/coupon-checkout.html` -- with "Pop open coupons when you reach a checkout" on (dashboard settings, on by default), a small popup-styled window should open on its own within a couple seconds, already showing this page's offers -- that's `content.js`'s `checkCheckout()` passively noticing the coupon field and the background opening it via `chrome.windows.create()` (see README.md's "Things that will bite you" for why it's a separate window, not the real toolbar popup). Otherwise, open the toolbar popup's **Coupons & savings** view manually. Either way: pick/apply a code through Pocket's UI (or type one into the page yourself: `POCKET20`, `TAKE15`, `SHIPFREE`), then click **Complete purchase**

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
| `coupon-checkout.html`, no code | Order confirmed | $126.00 | $0 |
| `coupon-checkout.html`, `POCKET20` | Order confirmed | $102.00 | $24.00 |
| `coupon-checkout.html`, `TAKE15` | Order confirmed | $111.00 | $15.00 |
| `coupon-checkout.html`, `SHIPFREE` | Order confirmed | $120.00 | $6.00 |

If a scrape doesn't match this, that's a real regression in
`content.js`, not the fixture -- these pages are deliberately simple so
the detector's own logic is the only variable.
