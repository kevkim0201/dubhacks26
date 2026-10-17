# Quick Plan: PayPal Honey-Style URL Matcher & Store Resolution Lifecycle

## Context & Objectives
Implement the reverse-engineered PayPal Honey store matching and tab lifecycle architecture adapted for Pocket's Chrome Extension (Manifest V3) and Supabase coupon system:
1. **URL Normalization & PSL Parser Helper (`y(e)` + `g(...)`)**:
   - Protocol checks (`http:`, `https:`).
   - Host normalization with leading dot (`.${hostname}`).
   - SPA hash-path rewriting (`/#/checkout` -> `/checkout/`) ensuring trailing slash `/`.
   - Zero-dependency Public Suffix / multi-part TLD parsing (`.co.uk`, `.com.au`, `.co.jp`, `.com`, `.org`, etc.) to accurately resolve root domains and subdomains.
2. **Partial URL Exact Matching Algorithm (`v(e, t)`)**:
   - Dictionary matching against candidate partial URLs (`[partialUrl]: storeMeta`).
   - Suffix matching on host (`t.host.endsWith(i)`) and prefix matching on path (`t.path.startsWith(a)`).
   - Longest-prefix specificity tie-breaker:
     1. `lengthHost` (subdomain beats root domain: e.g. `store.nike.com/` beats `nike.com/`).
     2. `lengthPath` (deeper path beats shallow path: e.g. `nike.com/gb/en_gb/` beats `nike.com/`).
3. **Store & Partials Registry**:
   - Curated dictionary of top e-commerce store partials + metadata.
   - Dynamic extension via Supabase `coupons` table and offline failsafe cache.
4. **Chrome Tab Lifecycle & Cache (`d.get(tabId)`, `getStoreByTabId`)**:
   - In-memory active tab store cache with lifecycle eviction on tab close.
   - `chrome.tabs.onUpdated` and `chrome.tabs.onActivated` listeners in `service-worker.js`.
   - Update extension badge / notification indicator when active tab is on a supported coupon store.
5. **Coupons & Popup Integration**:
   - Connect `src/lib/coupons.js` to use `resolveStoreFromUrl` instead of raw `hostname.replace(/^www\./, '')`.
   - Expose `getTabStore` and `resolveStore` message handlers in background worker.
   - Update `popup.js` to immediately display recognized store badges and auto-fetch coupons.
6. **Automated Verification**:
   - Test suite `scripts/test-store-matcher.mjs` verifying normalization, hash paths, PSL parsing, specificity sorting, and edge cases.

## Execution Tasks
- [x] Step 1: Create `src/lib/store-matcher.js` implementing `normalizeUrl`, `matchStorePartials`, curated partials dictionary, and store resolver.
- [x] Step 2: Update `manifest.json` to include `"tabs"` permission for tab lifecycle listeners.
- [x] Step 3: Update `src/lib/messages.js` to export store resolution message types (`RESOLVE_STORE`, `GET_TAB_STORE`).
- [x] Step 4: Update `src/background/service-worker.js` with tab state cache (`tabStoreCache`), `tabs.onUpdated`, `tabs.onActivated`, `tabs.onRemoved`, and message routing.
- [x] Step 5: Update `src/lib/coupons.js` to utilize store resolution for querying coupons and validating them.
- [x] Step 6: Enhance `src/popup/popup.js` and `src/popup/popup.html` to display the detected store and coupon count.
- [x] Step 7: Create and run comprehensive unit tests in `scripts/test-store-matcher.mjs` and execute `npm run check`.
