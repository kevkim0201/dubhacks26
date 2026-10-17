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
5. Reload the extension. `src/lib/supabase.js` exports `selectFrom` / `insertInto` / `updateTable` / `deleteFrom` plus auth: `signUp` / `signIn` / `signInWithGoogle` / `signOut` / `getSession` / `getUser` / `refreshSession`.

## Google sign-in setup

"Sign in with Google" is wired up end-to-end in the dashboard (the avatar menu, top right) and in `signInWithGoogle()`, but **it won't actually work until Google is enabled as a provider in the Supabase dashboard** -- that step needs a Google Cloud project, which I can't create on anyone's behalf. Whoever owns the Supabase project (or sets up their own to test with) needs to do this once:

1. **Get the extension's redirect URL.** Load the unpacked extension, open the dashboard (options page), open its DevTools console, and run:
   ```js
   chrome.identity.getRedirectURL()
   ```
   It prints something like `https://<32-lowercase-letters>.chromiumapp.org/` -- that's specific to this extension's ID (which is itself stable for a given unpacked folder path, but changes if the extension is ever published/repackaged). Copy it.

2. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Create a project (or use an existing one) → **APIs & Services → OAuth consent screen** → set it up (External, fill in the required fields -- it can stay in "Testing" mode for a hackathon demo).
   - **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Web application**.
   - Under **Authorized redirect URIs**, add the one Supabase's own setup screen asks for in the next step (a `https://<project-ref>.supabase.co/auth/v1/callback` URL) -- **not** the `chromiumapp.org` one from step 1; that one goes into Supabase instead, in step 4.
   - Save, then copy the generated **Client ID** and **Client Secret**.

3. **Supabase dashboard → Authentication → Providers → Google**: toggle it on, paste in the Client ID + Secret from step 2, save. This screen also shows you the exact callback URL to put in Google Cloud Console if you did step 2 first instead.

4. **Supabase dashboard → Authentication → URL Configuration → Redirect URLs**: add the `https://<...>.chromiumapp.org/` URL from step 1. This is the one Supabase redirects back to after Google auth completes -- without it, Supabase will refuse to redirect there and the flow dead-ends.

5. Reload the extension and try the dashboard's "Sign in with Google" button again.

If it still doesn't work: open the dashboard's console and check for an error from `signInWithGoogle()` -- it throws descriptive messages for "Supabase isn't configured" and "no access token in the redirect" (usually means step 3 or 4 above is missing/wrong) separately, rather than a generic failure.

**How the flow works, for context:** `chrome.identity.launchWebAuthFlow` (not `chrome.identity.getAuthToken`, which is a different, Google-specific API requiring a manifest `oauth2` key) opens Supabase's `/auth/v1/authorize?provider=google&redirect_to=...` URL, lets the user authenticate with Google, and resolves with Supabase's final redirect -- which carries `access_token`/`refresh_token` in the URL fragment (no server-side code exchange needed, since there's no server). `signInWithGoogle()` in `src/lib/supabase.js` parses that fragment directly.

## What's here

- **`schema.sql`** -- starting tables, mirrored from the shapes already used client-side (`src/lib/purchases.js`, `src/lib/character.js` settings). Extend or redesign freely; this is a first draft, not a contract.
- **`../src/lib/supabase.js`** -- the client. `selectFrom('coupons', { filters: { store: 'target.com' } })` style calls; see its JSDoc comments.
- **Nothing is wired up yet.** The extension currently reads/writes `chrome.storage.local` for purchases (`src/lib/purchases.js`) and `chrome.storage.sync` for settings (`src/lib/storage.js`). Whether/how those move to Supabase (full replacement? local-first with background sync? auth-gated?) is a real design decision worth making as a team before changing those files -- they're actively used by the popup/options/background/content-script code everyone else depends on.

## Where this plugs into the coupon feature

Rohit's/your teammates' `src/lib/coupons.js` has a `TODO` marking exactly where it should call `selectFrom('coupons', { filters: { store } })` once there's real data in the table. That's the integration seam between the two workstreams -- no need to touch each other's files to connect them later.
