# Nook Deal Agent: Implementation Plan

## Context
Nook is a browser extension for DubHacks '26 (Reimagine Shopping track). When a user views a product page, Nook answers **"is this a good deal?"**. It finds cheaper offers for the same item, compares price, shipping, and coupons, and reports savings. A squirrel character evolves as the user saves; savings are shown as acorns.

This plan covers the **backend deal agent** only. The extension UI, savings tracking, and the squirrel game are built by other teammates and consume the API defined here. **Keep the API contract stable.**

> Before starting: inspect the existing repo. If a backend, framework, or folder layout already exists, adapt this plan to fit it rather than creating a parallel structure. Ask before changing anything outside `backend/`.

## Goals
1. Given a product scraped from a page, return verified cheaper offers for the **exact same item**, with total cost (price + shipping) and savings.
2. Give a short verdict: `great_deal | fair | overpriced`, plus a one-line reason.
3. Stream the agent's steps to the extension so the squirrel can narrate the hunt.
4. Respond fast enough to demo: first event in under 1s, final result in under 15s, instant for cached products.

## Non-goals (for the hackathon)
- No user accounts or auth on the agent endpoint. Savings tracking belongs to the other workstream.
- No scraping retailer sites from the server. The extension sends page data; offers come from search APIs.
- No purchasing or checkout automation.

## Stack
- Python 3.11+, FastAPI, uvicorn, httpx
- Gemini via `google-genai` SDK, model `gemini-flash-latest` (override with env `GEMINI_MODEL`)
- SerpAPI Google Shopping for offer search
- In-memory cache (dict with TTL) for now; swap for Redis only if time allows
- Env vars: `GEMINI_API_KEY`, `SERPAPI_KEY`, `GEMINI_MODEL`, `DEMO_MODE`
- **API keys live only on the server. Never ship them in the extension.**

## File layout
```
backend/
  app.py              # FastAPI app, routes, CORS for the extension
  models.py           # Pydantic request/response/event models
  agent.py            # agent loop, system prompt, event emitter
  tools/
    search_offers.py  # SerpAPI Google Shopping
    coupons.py        # coupon lookup (static JSON to start)
    price_history.py  # stub returning None unless data is available
  verify.py           # post-processing: link check, math, filtering, verdict
  cache.py            # TTL cache keyed by normalized product URL / identifier
  fixtures/           # canned responses for DEMO_MODE
  tests/
  requirements.txt
  .env.example
```

## API contract

### `POST /deals` → final JSON (non-streaming)
Request:
```json
{
  "title": "Sony WH-1000XM5 Wireless Headphones - Black",
  "price": 399.99,
  "shipping": 0,
  "currency": "USD",
  "url": "https://www.example-retailer.com/...",
  "domain": "example-retailer.com",
  "identifier": { "type": "gtin|asin|upc|mpn", "value": "..." },
  "brand": "Sony",
  "condition": "new"
}
```
Only `title`, `price`, and `url` are required.

Response:
```json
{
  "verdict": "overpriced",
  "verdict_reason": "Same model is $52 cheaper at Target with free shipping.",
  "current_total": 399.99,
  "best_total": 347.99,
  "max_savings": 52.00,
  "acorns": 52,
  "offers": [
    {
      "seller": "Target",
      "price": 347.99,
      "shipping": 0,
      "total": 347.99,
      "savings": 52.00,
      "link": "https://...",
      "condition": "new",
      "match_confidence": 0.93,
      "reason": "Same model number and color"
    }
  ],
  "alternatives": [
    { "title": "Bose QuietComfort Headphones", "seller": "Best Buy", "price": 359.0, "shipping": 0, "total": 359.0,
      "savings": 40.99, "link": "https://...", "condition": "new", "fit_score": 0.92,
      "why": "Top-tier noise cancelling for calls", "tradeoff": "24h battery vs 30h", "thumbnail": null }
  ],
  "coupons": [{ "code": "SAVE10", "description": "10% off", "source": "static" }],
  "cached": false
}
```
- `acorns` = `floor(max_savings)` for now. This is a single place the game team can hook into; confirm the formula with them.
- If nothing cheaper is found, return `verdict: "great_deal"` with empty `offers`. That is a valid, positive result, not an error.

### `GET /deals/stream?payload=<urlencoded json>` → Server-Sent Events
(Alternatively, `POST` with a fetch-based SSE reader. Pick whichever works best in the extension's service worker.)

Event types:
```
event: step    data: {"message": "Searching Google Shopping for 'Sony WH-1000XM5 black'..."}
event: step    data: {"message": "Skipping a refurbished listing"}
event: step    data: {"message": "Checking coupons for bestbuy.com"}
event: result  data: <same JSON as POST /deals>
event: error   data: {"message": "..."}
```
Step messages are short and playful: they're spoken by the squirrel. Never include raw tool JSON in step messages.

## Agent design

### Tools exposed to Gemini
Plain Python functions with type hints and docstrings; the SDK builds schemas from these.

1. `search_offers(query: str) -> list[dict]`: SerpAPI Google Shopping, top 10. Return title, price, shipping (if present), seller, link, condition, thumbnail. **Record every returned link in a per-request `seen_links` set.**
2. `check_coupons(domain: str) -> list[dict]`: start with `fixtures/coupons.json` keyed by domain.
3. `get_price_history(product: str) -> dict | None`: stub for now; returns typical/low price if data exists, else None. The prompt must handle None gracefully.

### Loop
- Use `google-genai` with tools. Prefer a **manual function-calling loop** over automatic function calling so each tool call can emit a `step` event before and after it runs.
- Cap at 6 tool calls per request; hard timeout 20s overall. On timeout, return the best result found so far.
- System prompt essentials:
  - Match the **exact** product: same model number, variant, size, color, condition. Accessories, bundles, and used or refurbished items are not matches unless the source item is the same condition.
  - Start with the identifier or model number if present. Refine the query if results are weak; don't repeat identical queries.
  - Check coupons for the source domain and the top 1–2 offer domains.
  - Final answer is JSON only, matching the offers schema. Only use links that came from tool results.

### Verification (`verify.py`); code decides, not the model
1. Parse the model's JSON. Strip code fences. On parse failure, do one retry with a formatting-only call (`response_mime_type="application/json"`, no tools).
2. Drop offers whose `link` is not in `seen_links`.
3. Drop offers with `match_confidence < 0.8`.
4. Recompute `total = price + shipping` and `savings = current_total - total` in code. Drop offers with `savings <= 0`.
5. Sort by savings descending; keep the top 5.
6. Compute verdict in code:
   - `overpriced` if max_savings ≥ max($10, 5% of current_total)
   - `fair` if 0 < max_savings below that threshold
   - `great_deal` if no cheaper verified offer
   - The model may supply `verdict_reason` text, but code sets `verdict`.

### Caching
- Key: identifier value if present, else normalized URL (strip query params and tracking tags).
- TTL: 30 minutes. Return `cached: true`. For a cached stream request, emit one quick `step` ("I've sniffed this one out before!") and then the result.

### Demo mode
- `DEMO_MODE=1` serves responses from `fixtures/` for 3–4 pre-chosen demo products (keyed by URL), with simulated step events spaced ~600ms apart.
- Lets the demo work if the venue WiFi dies or an API quota runs out. **Build this early.**

## Milestones (do in order; each ends with something runnable)
1. **Skeleton**: FastAPI app, Pydantic models, `/health`, `POST /deals` returning a hardcoded response matching the contract. CORS allows the extension origin. *Done when:* frontend teammates can call it.
2. **Search tool**: `search_offers` working against SerpAPI with a CLI test script.
3. **Agent loop**: Gemini manual tool loop + verification, wired into `POST /deals`. *Done when:* 3 real products return sensible verified offers.
4. **Streaming**: SSE endpoint emitting step/result/error events. *Done when:* `curl -N` shows steps arriving live.
5. **Coupons + verdict polish**: coupon tool, verdict thresholds, acorns field.
6. **Cache + demo mode**: TTL cache, fixtures for demo products, `DEMO_MODE` switch.
7. **Hardening**: timeouts, graceful errors (always return a valid result shape), logging of each tool call and latency.

## Testing
- Unit tests for `verify.py`: hallucinated link dropped, low confidence dropped, savings math, verdict thresholds, shipping included in totals.
- Unit test for JSON parsing with and without code fences.
- Integration test with mocked Gemini and SerpAPI responses (no network in tests).
- Manual check script: `python -m backend.scripts.try_product <url-or-json>` prints streamed steps and the final result.

## Edge cases to handle
- Product with no identifier and a vague title → lower confidence, fewer offers; that's fine.
- Price missing from the scraped page → return 422 with a clear message.
- Non-USD currency → pass currency to search; don't compare across currencies.
- SerpAPI quota or error → emit a `step` saying search is unavailable, return `great_deal`-style empty result with `verdict_reason` explaining the limitation (not a false "great deal" claim; use `verdict: "fair"` and say we couldn't check).
- Gemini error → same graceful fallback.

---

## As built (adapted to the existing backend)

**Endpoints** (same JSON contract as above, under the backend's `/api` prefix):
- `POST /api/deals` → final JSON
- `GET /api/deals/stream?payload=<urlencoded json>` → SSE (`step` / `result` / `error`)
- `POST /api/deals/stream` → same SSE, for `fetch()`-based readers in the service worker

**Where the code lives** (inside the existing `backend/app` package, not a parallel app):
```
backend/app/routers/deals.py                 routes + SSE formatting
backend/app/services/deal_agent/
  models.py      DealRequest / Offer / Coupon / DealResponse
  agent.py       manual Gemini tool loop, system prompt, step events
  verify.py      code-side checks, math, verdict, fallback matcher
  cache.py       30-min TTL cache
  demo.py        DEMO_MODE fixtures runner
  service.py     cache → demo → live agent
  context.py     per-request state (offers by id, seen links, coupons)
  tools/         search_offers.py (SerpAPI), coupons.py, price_history.py (stub)
  fixtures/      coupons.json, demo/*.json (4 demo-store products)
backend/scripts/try_product.py               terminal check: python -m scripts.try_product ...
backend/tests/test_deal_*.py, test_deals_api.py
```

**Differences from the plan, and why**
- **Similar picks (`alternatives`):** besides exact matches, the agent returns up to 3 *different*
  products that meet the same need for less, each with `fit_score` (≥ 0.7 to be kept), `why`,
  `tradeoff`, `title`, `thumbnail` and the usual price/total/savings/link. They don't change
  `verdict`, `max_savings` or `acorns`, which stay about the exact item. Requests can pass an optional
  `need` (why the shopper wants it) and `category`; deal checks fill these from the Pip conversation.
- **Offers by id, not link:** search results get short ids (`o1`, `o2`, …) and the model answers with ids; code fills in the real link. Hallucinated links are impossible, and links are still checked against `seen_links`.
- **Used/refurbished items are dropped in code** (not just by the prompt) unless the source item is used.
- **Speed:** Gemini runs with `thinking_level=LOW`, tool calls in one turn run in parallel, and the last 5 s of the 20 s budget are reserved for the final answer. A live Sony WH-1000XM5 check took ~7.5 s.
- **Timeouts / Gemini errors with offers already found** use a conservative title + model-number matcher instead of returning nothing.
- **Cache key** also includes currency and the current total, so a price change gets a fresh answer. URL normalization drops the query string but keeps `#fragment` (single-page stores put the product there).
- **Coupons:** `coupons.json` only has the demo store's code. Only add codes you've verified; Pip repeats them to users.
- **Acorns:** `acorns = floor(max_savings)` is returned for display only. It is **not** awarded; awarding would go through the database's reward rules (daily cap etc.). Decide with the game team.
- **Python 3.10** (the backend's venv), so no 3.11-only features.

**Env vars** (backend/.env): `GEMINI_API_KEY`, `GEMINI_MODEL` (defaults to the backend's `gemini-3.8-flash`), `SERPAPI_KEY`, `DEMO_MODE=1` for canned fixtures.
