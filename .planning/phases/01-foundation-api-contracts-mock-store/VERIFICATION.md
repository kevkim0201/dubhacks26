# Phase 1 Verification Guide

## Verification Criteria

### 1. API Contracts & Endpoints
- [ ] `POST /checkout/start` returns `200 OK` with valid `session_id`, `opening_line`, and optional `voice_link`.
- [ ] `POST /checkout/turn` returns `200 OK` with `reply_text` and `done` flag.
- [ ] `POST /checkout/decision` returns `200 OK` with `acorns_awarded`, `balance`, `tier`, and `tier_up` boolean.
- [ ] `GET /user/state` returns valid user state with `total_earned`, `balance`, `tier`, and `recent_decisions`.

### 2. Rewards Engine Math
- [ ] Skip decision rewards 40 + floor(total/2) capped at 150.
- [ ] Save decision rewards 30.
- [ ] Buy decision rewards 20.
- [ ] Crossing 250, 1000, 3000, 7500 total XP accurately flags `tier_up: true`.

### 3. Mock Store
- [ ] `demo/store/index.html` loads cleanly with product catalog.
- [ ] Items can be added to the cart drawer.
- [ ] Proceeding to checkout navigates to `demo/store/checkout.html`.
- [ ] Cart items and order total are clearly structured in semantic DOM tags for the content script.

## Test Commands
```bash
# Run backend tests
cd backend && pytest

# Start backend dev server
cd backend && uvicorn app.main:app --reload --port 8000
```
