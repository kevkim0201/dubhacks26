# Requirements Specification — Squirrel Savings

## Functional Requirements

### 1. Checkout Detection & Cart Ingestion (Workstream 1)
- **REQ-CART-1:** Content script must detect checkout pages on the mock store (and extensible selectors for demo sites).
- **REQ-CART-2:** Parse cart details: store domain, item list (name, price, quantity), and cart total.
- **REQ-CART-3:** Inject a floating conversational overlay into a clean Shadow DOM to avoid styling conflicts.

### 2. Conversational Agent & Voice Loop (Workstream 1)
- **REQ-VOICE-1:** Backend `POST /checkout/start` issues a signed ElevenLabs WebSocket URL with dynamic cart variables and squirrel prompt override.
- **REQ-VOICE-2:** Client connects directly to ElevenLabs Conversational AI Agent (Turbo) for full-duplex conversational voice with sub-second response times.
- **REQ-VOICE-3:** Squirrel agent initiates speech immediately upon connection with a personalized, cheeky opening question based on cart items.
- **REQ-VOICE-4:** Agent handles real-time speech listening, turn-taking, and interruptions with squirrel voice persona.
- **REQ-VOICE-5:** Cap conversation at 3 turns (~45 seconds) and maintain structured evaluation summary.
- **REQ-VOICE-6:** Persistent decision buttons in overlay: "Buy it" (+20 acorns), "Save for later" (+30 acorns), "Skip" (+40+ acorns).

### 3. Rewards & Acorns System (Workstream 2)
- **REQ-REWARD-1:** Award flat 20 acorns for "Buy" after conversation.
- **REQ-REWARD-2:** Award 30 acorns for "Save for later" (with future redemption bonus).
- **REQ-REWARD-3:** Award 40 + (1 per $2 kept, capped at 150) for "Skip".
- **REQ-REWARD-4:** Track two balances: Total Earned (determines tier, permanent) and Spendable Acorn Balance.
- **REQ-REWARD-5:** Enforce 300 daily acorn cap to prevent gamification.
- **REQ-REWARD-6:** Streak bonus: +25 acorns for 3 non-immediate buy decisions in a row.

### 4. 3D Squirrel Popup & Evolution (Workstream 2)
- **REQ-3D-1:** Render interactive 3D squirrel scene using Three.js bundled in extension popup.
- **REQ-3D-2:** Display dynamic acorn stash rendered as instanced meshes reflecting user balance.
- **REQ-3D-3:** Support 5 evolution tiers:
  - Baby (0 XP): plain brown, bare ground.
  - Scout (250 XP): backpack, sapling.
  - Forager (1,000 XP): explorer hat, young tree with hollow.
  - Hoarder (3,000 XP): glossy fur, scarf, lantern tree home.
  - Golden (7,500 XP): golden fur, crown, glowing oak.
- **REQ-3D-4:** Trigger celebratory evolution animation (particles, hop, audio chime) when `tier_up: true` is returned.

### 5. Backend API & Persistence (Workstream 2)
- **REQ-API-1:** `POST /checkout/start` — accepts cart metadata, returns session_id, opening line, and voice audio.
- **REQ-API-2:** `POST /checkout/turn` — handles user dialogue turn, calls Gemini & ElevenLabs, returns reply & audio.
- **REQ-API-3:** `POST /checkout/decision` — records decision, computes acorns, updates tier and balance.
- **REQ-API-4:** `GET /user/state` — returns balance, tier, streak, and recent decisions.
- **REQ-API-5:** Supabase / SQLite persistence for `users`, `decisions`, `saved_items`, and `unlocks`.

### 6. Mock Store & Demo Environment
- **REQ-DEMO-1:** Standalone mock shopping store with products, cart drawer, and realistic checkout page.
- **REQ-DEMO-2:** Demo seeding script / preset to seed account to ~980 acorns to showcase live tier evolution.

---

## Non-Functional Requirements
- **NFR-PERF-1:** Voice reply latency <= 1.5s for snappy conversational flow.
- **NFR-SEC-1:** Keep API keys (Gemini, ElevenLabs, Supabase Service Role) secure in backend; never expose to client bundle.
- **NFR-COMP-1:** Chrome Manifest V3 compliant; no remote code execution or forbidden CDN script imports.
- **NFR-REL-1:** Backup text input and audio pre-rendering fallback for live presentation reliability.
