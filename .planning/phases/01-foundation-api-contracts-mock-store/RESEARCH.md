# Phase 1 Research: Foundation, API Contracts & Mock Store

## Context & Objectives
Phase 1 establishes the bedrock for both workstreams:
1. **Workstream 1 (Voice & Overlay)** needs concrete, working HTTP endpoints to call from the content script (`/checkout/start`, `/checkout/turn`, `/checkout/decision`).
2. **Workstream 2 (Game & 3D Companion)** needs persistent user state (`/user/state`) returning `total_earned`, `balance`, `tier`, `next_tier_at`, and `recent_decisions`.
3. **Demo Execution** needs a realistic standalone mock store where users can browse items (e.g., hoodies, headphones, sneakers), add them to cart, and proceed to a realistic checkout page.

## Technical Architecture Decisions

### 1. Backend Router Structure
- Mount a new router `app/routers/checkout.py` and enhance `app/routers/users.py`.
- Keep session state in memory (with a fallback database/in-memory dictionary for rapid hackathon testing without mandatory remote Supabase connection).
- Support optional user authentication: if a Bearer token is provided, extract `user_id`; otherwise allow a fallback guest/demo `user_id` so the extension and mock store work immediately without requiring full Google OAuth login.

### 2. Acorn Reward Calculation Rules
- **Decision "skip":**
  - Base: 40 acorns.
  - Kept money bonus: `floor(cart.total / 2)`.
  - Max skip reward: 150 acorns.
- **Decision "save":**
  - Flat: 30 acorns.
- **Decision "buy":**
  - Flat: 20 acorns.
- **Streak calculation:**
  - If last 3 decisions were "save" or "skip", award +25 bonus acorns.
- **Daily cap:**
  - 300 acorns per 24-hour rolling window.
- **Tiers:**
  - `Baby`: 0 - 249 XP (Next tier at 250)
  - `Scout`: 250 - 999 XP (Next tier at 1,000)
  - `Forager`: 1,000 - 2,999 XP (Next tier at 3,000)
  - `Hoarder`: 3,000 - 7,499 XP (Next tier at 7,500)
  - `Golden`: 7,500+ XP (Max tier)

### 3. Mock Shopping Store (`demo/store/`)
- A standalone HTML/CSS/JS mock eCommerce site:
  - Products: Tech & apparel (e.g., "$89 Wireless Sport Headphones", "$65 Oversized Hoodie", "$110 Running Shoes").
  - Features: Product catalog, interactive "Add to Cart" button, slide-out cart drawer, and a dedicated checkout page (`checkout.html`).
  - Checkout page DOM structure: clearly marked semantic elements (`#cart-items`, `.cart-total`, `[data-checkout-form]`) that the extension content script can easily identify and parse.
