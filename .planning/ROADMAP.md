# Project Roadmap: Squirrel Savings (DubHacks '26)

## Overview & Milestones

```mermaid
gantt
    title Squirrel Savings Build Plan
    dateFormat X
    axisFormat %s
    section Core Infrastructure
    Phase 1: Contracts, Backend & Mock Store       :active, p1, 0, 3
    section Checkout & Voice
    Phase 2: Checkout Interception & Overlay UI    :p2, 3, 6
    Phase 3: Gemini & ElevenLabs Voice Loop        :p3, 6, 11
    section Companion & 3D
    Phase 4: Three.js 3D Squirrel Popup & Acorns   :p4, 5, 10
    Phase 5: Web Game Page & Evolution World       :p5, 9, 13
    section Polish
    Phase 6: Demo Script, Seeding & Hardening      :p6, 13, 16
```

---

## Phase Breakdown

### Phase 1: Foundation, API Contracts & Mock Store
- **Goal:** Agree on contracts, spin up FastAPI checkout & user state endpoints, create database schema, and provide a realistic mock store.
- **Plans:**
  - `01-01`: Backend API contracts (`/checkout/start`, `/checkout/turn`, `/checkout/decision`, `/user/state`).
  - `01-02`: Database models & acorn reward calculator (20 flat for buy, 30 save, 40+ skip, daily cap).
  - `01-03`: Mock shopping store with cart and checkout page.
- **Success Criteria:** Mock store checkout can trigger backend API calls and receive simulated session and acorn responses.

### Phase 2: Checkout Interception & Shadow DOM Overlay
- **Goal:** Extension detects checkout pages, parses cart items, and injects a floating conversation overlay with decision buttons.
- **Plans:**
  - `02-01`: Content script checkout detector and cart parser.
  - `02-02`: Shadow DOM conversational widget with mic button, dialogue bubble, and 3 persistent decision buttons.
  - `02-03`: Wire decision buttons to backend `/checkout/decision` and toast acorn awards.
- **Success Criteria:** Clicking checkout injects overlay, shows cart summary, and allows submitting decisions with immediate visual feedback.

### Phase 3: Gemini & ElevenLabs Conversational Voice Loop
- **Goal:** Bring the squirrel to life with Gemini persona and ElevenLabs voice audio.
- **Plans:**
  - `03-01`: Backend Gemini integration with system persona, context injection, and max 3 turns.
  - `03-02`: ElevenLabs text-to-speech voice generation and audio streaming.
  - `03-03`: Overlay audio playback, mic voice input (Web Speech / ElevenLabs agent), and fallback text input.
- **Success Criteria:** Reaching checkout starts natural spoken dialogue with the squirrel; user can speak or click to reply.

### Phase 4: Three.js 3D Squirrel Popup & Dynamic Acorn Stash
- **Goal:** Rich 3D squirrel popup in the browser extension displaying balance and live evolution.
- **Plans:**
  - `04-01`: Three.js scene setup in popup with lighting, camera, and low-poly squirrel model/idle loop.
  - `04-02`: Instanced mesh acorn pile scaling dynamically with balance.
  - `04-03`: Evolution sequence (particles, glow, model change) when `tier_up: true` triggers.
- **Success Criteria:** Opening extension popup renders smooth 3D squirrel and accurate acorn stash; triggers evolution when crossing tier thresholds.

### Phase 5: Companion Web Game Page
- **Goal:** Full web experience displaying squirrel tree home, cosmetics shop, and savings history.
- **Plans:**
  - `05-01`: Tree home scene and tier unlocking map.
  - `05-02`: Decision & money-saved history dashboard.
  - `05-03`: Cosmetics shop for spending earned acorn balance.
- **Success Criteria:** Users can visit the companion page to review decisions, see money saved, and customize their tree home.

### Phase 6: Demo Hardening & Presentation Rehearsal
- **Goal:** Flawless 2-minute demo flow for hackathon judges.
- **Plans:**
  - `06-01`: Account seeding script (sets user at 980 XP, right before Forager tier).
  - `06-02`: Fail-safe fallbacks (offline audio cache, push-to-talk, manual overrides).
  - `06-03`: End-to-end dry run verification and backup recording.
- **Success Criteria:** Two consecutive checkouts (Skip -> Buy) cleanly demonstrate voice reflection and live evolution to Forager tier.
