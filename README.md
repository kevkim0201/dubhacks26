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
- Five tiers, each with a dollar threshold: Baby Squirrel ($0) → Scout ($25) → Forager ($100) → Hoarder ($300) → Golden Squirrel ($750, the max tier). Per-tier accessories/environment/fur described in the squirrel design plan aren't built yet — only the tier names/thresholds moved over so far.
- The dashboard's progress bar/ring show **absolute** progress (`xp / nextTier.minXp`, e.g. 1,284/2,500 = 51%) rather than progress relative to the current tier's own floor -- matches the percentage shown directly in the UI.
- Pip is **procedurally drawn SVG**, not an image asset — `renderCharacterSVG(stageKey, { skinColor, leafColor, flowerColor, size })` returns a self-contained `<svg>` string. All five stages share one geometry function; only scale/limb/leaf/flower-count parameters change per tier, so there's no per-stage artwork to maintain.
- Colors are user-themeable (dashboard settings) and rendered via a tiny hex-shading helper (`src/lib/color.js`) — no CSS color-mixing dependency.
- Pip still drives the dashboard, the pending-review cards, and the coupons-view footer icon. The **popup's main character display is now a different character** — see below.

## The squirrel (popup's main character)

A second, experimental character — a 3D squirrel with an acorn pile that grows as you save — lives in `src/lib/squirrelScene.js` and is mounted once in `src/popup/popup.js` (`els.art`, the same slot that used to hold Pip's SVG). It started as a standalone prototype (`squirrel-prototype/`, still there as a fast playground — see its README) and was merged into the real popup.

- **Three.js is vendored locally** at `src/lib/vendor/three.module.min.js` (~656KB, MIT licensed) rather than imported from a CDN like the standalone prototype does — Manifest V3's extension CSP (`script-src 'self'`) blocks remotely-hosted scripts in the extension's own pages. Verified against that exact policy (a page served with `script-src 'self'; object-src 'self'` via a CSP meta tag) before trusting it would work inside the real `chrome-extension://` origin.
- **No persistence of its own.** Unlike the standalone prototype (which uses `localStorage` + simulated purchases), `squirrelScene.js` is pure rendering: `syncToXP(xp)` is called with the popup's real `character.xp` (already computed from `chrome.storage` purchases) every time the popup renders, and the acorn pile/hop reaction just follow that number. A real purchase showing up (auto-detected or manual) is what makes XP go up and an acorn drop in — not a button, not its own storage.
- **The model is still a placeholder** (procedural spheres/cones, not a sourced `.glb`) — swapping in a real model is unchanged from the prototype's plan, just done once in `squirrelScene.js` instead of twice.
- Adds meaningfully to popup load size (~656KB parsed/compiled on open, vs. Pip's few KB of inline SVG) — worth knowing if popup-open speed becomes a concern.
- **Only the popup's main view changed.** The dashboard, pending-review cards, and the coupons-view's small footer icon all still render Pip. Two mascots in one app is a real product question, not yet decided either way — ask before assuming it should be unified in one direction or the other.

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
    options.html/.css/.js  dashboard, 3 tabs: Overview (companion card, progress ring, chapters
                           gallery, recent savings, coupon teaser), Savings activity (pending
                           review, manual add, settings, purchases table), How it works (static)
  lib/
    messages.js            message type constants + send helper
    storage.js              chrome.storage.sync settings wrapper + defaults
    purchases.js            chrome.storage.local CRUD: confirmed / pending / ignored
    character.js             XP formula, tier thresholds, Pip's SVG renderer
    color.js                 hex shade() helper used by character.js
    squirrelScene.js          popup's main character -- see "The squirrel" section above
    vendor/
      three.module.min.js      vendored (not CDN -- see above), MIT licensed, r160
    coupons.js                [Rohit] coupon search/validate/ranking -- see Team section above
    supabase.js                [Kevin+Deetya] hand-rolled REST+Auth client, no SDK
    supabaseConfig.js           [Kevin+Deetya] gitignored -- real project URL/anon key
    supabaseConfig.example.js    [Kevin+Deetya] committed template, copy to the above
supabase/                  [Kevin+Deetya] schema.sql + setup docs -- see supabase/README.md
savings-storage/
  savings-storage.js        [Kevin+Deetya] the "current deal" the dashboard's coupon teaser
                            reads (getCurrentDealSavings/saveCurrentDealSavings/DEAL_KEY in
                            chrome.storage.local) -- lives outside src/lib by whoever started it;
                            left in place rather than moved, to avoid merge friction
icons/                     generated placeholders — see scripts/make-icons.mjs
scripts/
  check.mjs                verifies manifest references resolve
  make-icons.mjs            regenerates icons/*.png, no dependencies
```

## Scripts

```bash
npm run check    # validate manifest.json before loading or shipping
npm run icons    # regenerate the placeholder icons
npm run zip      # check + package dist/pocket.zip for the Web Store
```

## Things that will bite you

- **Content scripts aren't ES modules.** `src/content/content.js` can't `import`, which is why its message-type string is duplicated at the top rather than pulled from `src/lib/messages.js`.
- **`manifest.json` has no comments.** JSON only — a stray `//` breaks the load silently.
- **The content script matches `<all_urls>` (http/https only).** That's required for passive detection to work on arbitrary storefronts. It does nothing visible unless it thinks it found an order confirmation; there's no injected UI otherwise. Users can turn it off in settings.
- **Message listeners must `return true`** to reply asynchronously, or the sender gets `undefined`.
- **Detection is heuristic, not exhaustive.** It won't catch every retailer, and it can occasionally misfire on a page that merely *mentions* an order. That's exactly why confirmations are staged rather than auto-added — bad scrapes get caught and edited/dismissed in one tap instead of silently polluting the data.
- **Local testing over `file://` breaks ES module `<script type="module">` tags** (CORS). If you ever build a standalone preview of the popup/options HTML outside the extension, serve it over `http://` (e.g. `python3 -m http.server`) — inside the actual extension this isn't an issue, since `chrome-extension://` pages aren't subject to the same restriction.
- **"Sign in with Google" (dashboard, top-right avatar menu) needs external setup before it works.** The code is complete (`src/lib/supabase.js`'s `signInWithGoogle`), but Google has to be enabled as an auth provider in the Supabase dashboard first, which needs a Google Cloud OAuth client — see `supabase/README.md`'s "Google sign-in setup." Until that's done, clicking it fails with a clear error rather than crashing.

## Next steps

Tune the dollar thresholds in `src/lib/character.js` (`STAGES`) and the XP rate (`XP_PER_DOLLAR`) to whatever pacing feels right, and consider adding more retailer-specific extraction rules to `content.js` as you test against real checkout pages.
