# Project State: Squirrel Savings

## Current Status
- **Current Milestone:** Milestone 1 (Hackathon MVP)
- **Active Phase:** Phase 1 (Foundation, API Contracts & Mock Store)
- **Status:** Initialized from `squirrel-savings-design-doc.md`
- **Next Command:** `/gsd-plan-phase 1`

## Decision Log
- **2026-10-17:** Adopted FastAPI backend (`backend/`) and Vite Chrome MV3 extension (`extension/`).
- **2026-10-17:** Dropped price scrapers and coupon automation to focus 100% on high-impact conversational checkout reflection.
- **2026-10-17:** Voice conversation architecture capped at 3 turns (~45 seconds) to keep checkout friction low.
- **2026-10-17:** Decoupled decision logic from LLM: user buttons make final decision; Gemini advises and calculates intent assessment.
- **2026-10-17:** Dual-balance acorn economy: Total Earned (immutable XP determining tier) and Spendable Balance (for cosmetics).

## Known Blockers & Key Risks
- ElevenLabs latency / ambient noise at hackathon venue: mitigated by push-to-talk, short phrases, and hidden fallback text input.
- Manifest V3 script restrictions: Three.js must be bundled directly in extension package via npm, no external CDN loading.
