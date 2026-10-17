# Pocket — Chrome Extension

Your savings companion. Manifest V3, no build step: the files you edit are the files Chrome loads, so iterating is edit → reload.

**Core idea:** purchases are detected automatically as you check out (via structured page data + heuristics), staged as a one-tap confirmation, and feed a character — **Pip** — that grows through tiers as you save money. Return deadlines are tracked and alerted on separately.

## Team / workstreams

Three areas, no shared files to collide on:

| Who | Owns | Files |
| --- | --- | --- |
| **Rohit** | Coupon searching + validation: finding candidate codes and confirming they actually work | [`src/lib/coupons.js`](src/lib/coupons.js) (`searchCoupons`, `validateCoupon`, `computeCouponSavings`/`rankCoupons`), [`src/content/coupon-finder.js`](src/content/coupon-finder.js) (field detection, cart-total scraping, `applyCouponOnPage`) |
| **\<you\>** | The "Coupons & savings" popup view -- wiring Rohit's functions to the UI (selection, highlight card, apply flow) | The coupons-related markup/styles/logic in [`src/popup/popup.html`](src/popup/popup.html), [`popup.css`](src/popup/popup.css), [`popup.js`](src/popup/popup.js) |
| **Kevin + Deetya** | Backend / database | [`supabase/`](supabase/) (schema + setup docs), [`src/lib/supabase.js`](src/lib/supabase.js) |

**The integration seam between Rohit and the backend pair:** `searchCoupons()` in `coupons.js` has a `TODO` showing exactly where to call `selectFrom('coupons', ...)` from `supabase.js` once real data exists — see that file's comments. Until then it returns mock data matching a fixed demo cart ($120 + $6 shipping on `example.com`), so the popup view is clickable/demoable today without a live checkout page or backend.

**The seam between Rohit and the popup view:** popup.js only calls `searchCoupons()`, `rankCoupons()`, `computeCouponSavings()`, `humanizeStoreName()` (all exported from `coupons.js`) and the content script's `detectCouponField()` / `detectCartTotals()` / `applyCouponOnPage()` (exposed on `window.__pocketCoupon`, called via `chrome.scripting.executeScript`). Changing what's *inside* those functions (smarter search, real validation, better cart scraping, a smarter apply heuristic) never requires touching the popup files -- the shapes those functions return are the whole contract.

**Testing the coupon view:** open a tab to `http://example.com`, open the popup, click **Coupons & savings**. Real cart-total detection (`src/content/coupon-finder.js`'s `detectCartTotals()`) only kicks in on pages with "subtotal"/"shipping" text near a dollar amount; anywhere else it falls back to the honest "couldn't find your cart" state rather than the demo numbers.

Neither workstream touches the existing detection/character code (`src/content/content.js`, `src/lib/character.js`, `src/lib/purchases.js`) — ask before changing those, since the whole popup/dashboard depends on their current shape.

## Load it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Pin the extension from the puzzle-piece menu

## Iterate

| You changed | What to do |
| --- | --- |
| Popup / options HTML, CSS, JS | Just reopen the popup |
| Content script or its CSS | Reload the **web page** |
| `service-worker.js` or `manifest.json` | Hit **Reload** on the card in `chrome://extensions` |

Debug: right-click the popup → Inspect. For the service worker, click the **service worker** link on the extension card. Content script logs (and the detection toast) show up in the page's own console.

## How detection works

`src/content/content.js` runs on every page and passively watches for order-confirmation signals:

1. **URL/text heuristics** — patterns like `order-confirmation`, "thank you for your order", "order number" in the URL or page heading/body.
2. **Structured data first** — if the page has `<script type="application/ld+json">` with an `Order` block (common on well-built storefronts), that's used directly: far more reliable than scraping rendered text.
3. **Fallback scraping** — otherwise it looks for a "total $X.XX" pattern near the word "total", an `<h1>` for the item title, and "you saved $X" phrasing for savings.
4. A `MutationObserver` + a `location.href` poll handle SPA checkouts that update content without a full page load.

Because this is heuristic, a detected purchase is never silently added — it's staged as **pending** (`chrome.storage.local`), the toolbar badge turns blue, an on-page toast appears, and the popup shows an editable review card with **Confirm** / **Not a purchase**. A dismissed page is remembered (`ignoredOrderUrls`) so it won't resurface. A manual "+ Add a purchase manually" fallback exists in the popup/dashboard for anything the detector can't see (in-store, phone orders, gifts).

Turn detection off entirely via the dashboard's "Detect purchases automatically" setting.

## How Pip grows

`src/lib/character.js` is the whole system:

- **XP is literal**: `$1 saved = 10 XP` (shown to the user as-is — no hidden multipliers, no credit for money *spent*).
- Six tiers, each with a dollar threshold: Seed ($0) → Sprout ($25) → Bloom ($250) → Grove ($750) → Orchard ($2,000) → Evergreen ($5,000).
- Pip is **procedurally drawn SVG**, not an image asset — `renderCharacterSVG(stageKey, { skinColor, leafColor, flowerColor, size })` returns a self-contained `<svg>` string. Six stages share one geometry function; only scale/limb/leaf/flower-count parameters change per tier, so there's no per-stage artwork to maintain.
- Colors are user-themeable (dashboard settings) and rendered via a tiny hex-shading helper (`src/lib/color.js`) — no CSS color-mixing dependency.

## Layout

```
manifest.json              permissions, entry points
src/
  background/
    service-worker.js      message router, detection intake, return-deadline alarm, badge
  content/
    content.js             passive order-confirmation detector (JSON-LD + heuristics)
    content.css             on-page toast when a purchase is detected
    coupon-finder.js         [Rohit] on-demand coupon-field + cart-total detector, applyCouponOnPage (injected, not declarative)
  popup/
    popup.html/.css/.js    pending review, character, stats, due-soon returns, coupons, manual-add fallback
  options/
    options.html/.css/.js  full dashboard: same pieces + settings + purchases table
  lib/
    messages.js            message type constants + send helper
    storage.js              chrome.storage.sync settings wrapper + defaults
    purchases.js            chrome.storage.local CRUD: confirmed / pending / ignored
    character.js             XP formula, tier thresholds, Pip's SVG renderer
    color.js                 hex shade() helper used by character.js
    coupons.js                [Rohit] coupon search/validate/ranking -- see Team section above
    supabase.js                [Kevin+Deetya] hand-rolled REST+Auth client, no SDK
    supabaseConfig.js           [Kevin+Deetya] gitignored -- real project URL/anon key
    supabaseConfig.example.js    [Kevin+Deetya] committed template, copy to the above
supabase/                  [Kevin+Deetya] schema.sql + setup docs -- see supabase/README.md
icons/                     generated placeholders — see scripts/make-icons.mjs
scripts/
  check.mjs                verifies manifest references resolve
  make-icons.mjs            regenerates icons/*.png, no dependencies
```

## Scripts

```bash
npm run check    # validate manifest.json before loading or shipping
npm test         # run savings/storage unit tests (Node.js 18+)
npm run icons    # regenerate the placeholder icons
npm run zip      # check + package dist/pocket.zip for the Web Store
```

## Test and run locally

1. Install [Node.js 18 or newer](https://nodejs.org/).
2. From the repository root, run `npm test` and `npm run check`. Both use Node's built-in tools; no `npm install` is needed.
3. To run the extension, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's root folder (the one containing `manifest.json`). Pin Pocket, then click its toolbar icon to exercise the popup and options dashboard.
4. For purchase-detection smoke testing, open a normal HTTP/HTTPS page that represents an order confirmation. Check the page console for content-script errors, then inspect the staged purchase in the popup. Detection is heuristic, so a miss on a regular storefront page is not by itself a failure. To test coupons, open `http://example.com`, then click **Coupons & savings** in the popup.

The current `savings-storage/` files are a Phase 1 prototype: they are not referenced by `manifest.json` or wired into the popup/options UI yet. `npm test` verifies their purchase validation, savings summaries, and Chrome-storage behavior using a local mock; loading the extension does not display that prototype dashboard until it is integrated. The prototype expects a cents-based record (`originalTotalCents`, `paidTotalCents`, `savingsCents`), while the current extension purchase store uses dollar fields (`pricePaid`, `savings`) and `title`; add an adapter or agree on a shared schema before wiring the view to `src/lib/purchases.js`. Supabase setup is not required for the local extension demo.

## Things that will bite you

- **Content scripts aren't ES modules.** `src/content/content.js` can't `import`, which is why its message-type string is duplicated at the top rather than pulled from `src/lib/messages.js`.
- **`manifest.json` has no comments.** JSON only — a stray `//` breaks the load silently.
- **The content script matches `<all_urls>` (http/https only).** That's required for passive detection to work on arbitrary storefronts. It does nothing visible unless it thinks it found an order confirmation; there's no injected UI otherwise. Users can turn it off in settings.
- **Message listeners must `return true`** to reply asynchronously, or the sender gets `undefined`.
- **Detection is heuristic, not exhaustive.** It won't catch every retailer, and it can occasionally misfire on a page that merely *mentions* an order. That's exactly why confirmations are staged rather than auto-added — bad scrapes get caught and edited/dismissed in one tap instead of silently polluting the data.
- **Local testing over `file://` breaks ES module `<script type="module">` tags** (CORS). If you ever build a standalone preview of the popup/options HTML outside the extension, serve it over `http://` (e.g. `python3 -m http.server`) — inside the actual extension this isn't an issue, since `chrome-extension://` pages aren't subject to the same restriction.

## Next steps

Tune the dollar thresholds in `src/lib/character.js` (`STAGES`) and the XP rate (`XP_PER_DOLLAR`) to whatever pacing feels right, and consider adding more retailer-specific extraction rules to `content.js` as you test against real checkout pages.
