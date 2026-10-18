# Squirrel Savings (DubHacks '26)

## Overview & Vision
A browser extension and web companion where an AI squirrel intercepts checkout to prompt thoughtful spending reflection:
- **Pitch:** *"Every loyalty program rewards you for spending more. Ours rewards you for spending well."*
- **Track:** DubHacks '26 — Reimagine Shopping (Checkout, Payments, Loyalty/Rewards).
- **Core Loop:** Checkout detected -> Squirrel voice overlay asks why the user wants the items -> User justifies or reflects -> Decision made (Buy, Save for later, Skip) -> Acorns awarded -> Squirrel character evolves in 3D (Three.js popup + full tree home game page).

## Core Philosophy & Persona
- **Squirrel Persona:** Warm, curious, cheeky. Never preachy, judgmental, or blocking. Advises and asks questions based on cart details and past purchase context.
- **User Agency:** Three persistent buttons (*Buy it*, *Save for later*, *Skip*) remain visible; user always makes the final call.

## Technical Architecture & Stack
- **Browser Extension:** Chrome Manifest V3, Vite build, Three.js bundled via npm, Shadow DOM for non-intrusive store injection, Supabase Auth.
- **Backend API:** FastAPI (Python), httpx, Pydantic, Supabase/SQLite persistence.
- **AI & Audio Engine:** 
  - **Gemini:** Conversational reflection, intent assessment, witty cart-specific opening lines.
  - **ElevenLabs:** Real-time speech-to-text / text-to-speech squirrel voice synthesis.
- **Game & Companion:** Three.js 3D character with 5 evolution tiers (Baby, Scout, Forager, Hoarder, Golden), dynamic instanced acorn stash, tree home, cosmetics shop, and savings history.

## Team Workstreams
- **Workstream 1 (Voice & Checkout Interaction — Rohit & William):**
  - Checkout page detection & cart parsing.
  - Shadow DOM overlay with mic, voice synthesis playback, and decision buttons.
  - Gemini prompt engineering & conversation loop (<= 3 turns, ~45s).
  - ElevenLabs integration / fallback audio loop.
- **Workstream 2 (Rewards, Game & Persistence — Kevin & Deetya):**
  - Mock store & checkout playground.
  - FastAPI backend endpoints for `/checkout/*` and `/user/*`.
  - Acorn reward calculation logic, streaks, and database schemas.
  - 3D Three.js squirrel popup and game page with tree home.

## Key Constraints & Hackathon Non-Goals
- No real affiliate network or bank integrations (simulated rewards & mock store for demo).
- No real store price-scraping or brittle coupon search (focus on voice checkout reflection).
- Max 3 turns per checkout conversation to keep interaction snappy and under 45 seconds.
