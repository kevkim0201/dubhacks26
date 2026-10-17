# Backend / database (Kevin + Deetya)

This project talks to Supabase directly from the extension (background
service worker / popup) via plain `fetch()` -- there's no separate Node
server. That's not a limitation: Supabase's REST API (PostgREST) and Auth
API are designed for exactly this, and it sidesteps Manifest V3's
restriction on loading remotely-hosted JS (no CDN `<script>` allowed in an
extension), which is why `src/lib/supabase.js` is a small hand-rolled
client instead of the `@supabase/supabase-js` npm package.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** in the dashboard, paste in [`schema.sql`](./schema.sql), and run it. That creates `profiles`, `purchases`, `coupons`, and `coupon_validations`, each with Row Level Security policies already enabled.
3. Go to **Project Settings -> API** and copy the **Project URL** and **anon public** key.
4. In the repo: `cp src/lib/supabaseConfig.example.js src/lib/supabaseConfig.js` and paste those two values in. This file is gitignored -- every teammate runs their own copy against the same shared project (or their own, while prototyping).
5. Reload the extension. `src/lib/supabase.js` exports `selectFrom` / `insertInto` / `updateTable` / `deleteFrom` plus `signUp` / `signIn` / `signOut` / `getSession`.

## What's here

- **`schema.sql`** -- starting tables, mirrored from the shapes already used client-side (`src/lib/purchases.js`, `src/lib/character.js` settings). Extend or redesign freely; this is a first draft, not a contract.
- **`../src/lib/supabase.js`** -- the client. `selectFrom('coupons', { filters: { store: 'target.com' } })` style calls; see its JSDoc comments.
- **Nothing is wired up yet.** The extension currently reads/writes `chrome.storage.local` for purchases (`src/lib/purchases.js`) and `chrome.storage.sync` for settings (`src/lib/storage.js`). Whether/how those move to Supabase (full replacement? local-first with background sync? auth-gated?) is a real design decision worth making as a team before changing those files -- they're actively used by the popup/options/background/content-script code everyone else depends on.

## Where this plugs into the coupon feature

Rohit's/your teammates' `src/lib/coupons.js` has a `TODO` marking exactly where it should call `selectFrom('coupons', { filters: { store } })` once there's real data in the table. That's the integration seam between the two workstreams -- no need to touch each other's files to connect them later.
