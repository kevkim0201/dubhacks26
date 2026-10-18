# dubhacks26

```
extension/   Chrome extension (Manifest V3, Vite, Supabase Auth w/ Google)
backend/     FastAPI server that verifies Supabase JWTs
```

## 1. Supabase setup

1. Create a project at https://supabase.com.
2. In Google Cloud Console, create an OAuth client with application type **Web application**.
   In Supabase **Authentication → Sign In / Providers → Google**, enable Google and paste
   that client's ID and secret. In Google Cloud, add the exact **callback URL shown by
   Supabase** as an authorized redirect URI. This is the Supabase callback, usually
   `https://<project-ref>.supabase.co/auth/v1/callback`—it is not the Chrome extension URL.
   If the Google consent screen is in Testing mode, add each tester's Google account as a
   test user.
3. In Supabase **Authentication → URL Configuration → Redirect URLs**, allow the Chrome
   extension callback `https://<your-extension-id>.chromiumapp.org/`. Get the extension ID
   after loading the build. The ID must match the extension that is installed.
4. The extension manifest grants access to the Supabase project host shown in
   `extension/.env.example`. If you change Supabase projects, update the corresponding
   `host_permissions` entry in `extension/public/manifest.json`, rebuild, and reload the
   unpacked extension.

The two OAuth redirect URLs are different on purpose:

- Google Cloud redirects back to Supabase's `/auth/v1/callback`.
- Supabase redirects back to Chrome's `<extension-id>.chromiumapp.org/` callback.

After the first successful Google login, confirm the account appears under Supabase
**Authentication → Users** and its profile row appears in **Table Editor → profiles**.
The database schema's Auth trigger creates that profile.

## 2. Chrome extension

```bash
cd extension
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # rebuilds dist/ on change (or `npm run build`)
```

Open `chrome://extensions`, turn on Developer mode, **Load unpacked** → `extension/dist`.
Copy the extension ID and add its callback URL to Supabase (step 1.3).

> Keep the unpacked extension in the same folder to keep its ID stable on your machine.
> Teammates may have different IDs and must allow their own callback URL in Supabase.

### Avatar closet

Open the Nook popup and choose **Avatar**, or choose **Avatar** from the impact dashboard.
Apply `supabase/migrations/20261018_avatar_cosmetics.sql` in the Supabase SQL Editor
after the recommendation rewards migration. The closet then loads the signed-in account's
acorn balance and cosmetics; purchases and equipment are saved to the account and used to
render Pip in the popup, dashboard, and checkout overlay.

To add floating pet companions to the closet, apply
`supabase/migrations/20261018_pet_cosmetics.sql` after the avatar cosmetics migration.
To let users remove equipped items without losing ownership, apply
`supabase/migrations/20261018_cosmetic_unequip.sql` and restart the backend.

### Trying the checkout flow

```bash
cd extension && npm run demo   # serves a fake store at http://localhost:4321/checkout.html
```

Open that page with the extension loaded and Pip's overlay appears in the corner.

How detection works (`src/content/`):

- `sites.js` – known stores/platforms (Amazon, Shopify, Walmart, Target, Best Buy, eBay,
  Etsy, Stripe, PayPal, WooCommerce, Magento, BigCommerce) count as a checkout outright.
- `detect.js` – everything else is scored: checkout URL, card fields or card iframes,
  place-order buttons, checkout headings, address fields and an order total each add
  points; article pages lose points. 5+ points = checkout.
- "Not now" hides the overlay for the current page only; reloading the page or moving to
  the next checkout step shows Pip again.
- `npm test` runs fixture tests (`detect.test.js`). Add a fixture when a real site misfires.

Debugging on a real site: open the service worker console from `chrome://extensions` and run
`chrome.storage.local.set({ nookDebug: true })`, reload the store page, and its console will
log `[Nook] score …` with the reasons and the cart Pip read.

Code layout:

- `src/lib/supabase.js` – Supabase client, session stored in `chrome.storage.local`
- `src/lib/auth.js` – `signInWithGoogle()` via `chrome.identity.launchWebAuthFlow` (PKCE)
- `src/lib/checkout-api.js` – authenticated checkout session and decision API helpers
- `src/lib/api.js` – `apiFetch(path)` adds `Authorization: Bearer <access_token>`
- `src/popup/` – popup screens, `src/background/` – service worker (messages, opens popup)
- `src/content/` – checkout detection + in-page overlay (built separately as an IIFE)
- `src/ui/` – shared Pip art, components and theme used by popup and overlay
- `src/lib/progress.js` – XP / levels / acorns, `src/lib/checkout.js` – per-tab cart storage

## 3. FastAPI backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL
uvicorn app.main:app --reload
```

Docs at http://localhost:8000/docs. `GET /health` is public, `GET /api/me` requires a token.
After Google sign-in, **Talk to Pip** creates an authenticated checkout session through
`POST /api/checkout/start`. The returned `session_id` is the handoff ID for the voice-agent
integration; `apiFetch()` supplies the user's bearer token for backend calls.
The popup currently does not contain a voice implementation; it saves the session so the
voice work can connect to it. OAuth setup errors are shown on the welcome screen. If sign-in
still fails, record the exact on-screen error and check that the installed extension ID,
Google callback URL, Supabase redirect allow list, and Supabase project host permission all
match.

### Deal agent

`POST /api/deals` and `/api/deals/stream` answer "is this a good deal?" for a product page
(Gemini + SerpAPI Google Shopping). Needs `GEMINI_API_KEY` and `SERPAPI_KEY`; set `DEMO_MODE=1`
for canned results. Try it from the terminal:

```bash
cd backend && .venv/bin/python -m scripts.try_product https://www.bestbuy.com/site/123 --title "Sony WH-1000XM5" --price 399.99
```

Design and contract: [DEAL_AGENT_PLAN.md](DEAL_AGENT_PLAN.md).

### Adding a route

Create `app/routers/things.py`:

```python
from fastapi import APIRouter
from app.core.auth import AuthUser

router = APIRouter(prefix="/api/things", tags=["things"])

@router.get("")
def list_things(user: AuthUser):
    return {"owner": user.id, "things": []}
```

Then register it in `app/main.py` with `app.include_router(things.router)`.
If you deploy the backend somewhere other than localhost, add that host to
`host_permissions` in `extension/public/manifest.json` and `VITE_API_BASE_URL`.

Checkout rewards are documented in `supabase/README.md`. For the backend, copy
`backend/.env.example` to `backend/.env` and configure `SUPABASE_SERVICE_ROLE_KEY`
and a strong `INTERNAL_SERVICE_TOKEN` in addition to `SUPABASE_URL`. Keep both
server-only secrets out of the extension and source control.
