# dubhacks26

```
extension/   Chrome extension (Manifest V3, Vite, Supabase Auth w/ Google)
backend/     FastAPI server that verifies Supabase JWTs
```

## 1. Supabase setup

1. Create a project at https://supabase.com.
2. **Authentication → Sign In / Providers → Google**: enable it and paste a Google OAuth
   Client ID + Secret (create a "Web application" client in Google Cloud Console; its
   authorized redirect URI is the callback URL Supabase shows on that page).
3. **Authentication → URL Configuration → Redirect URLs**: add
   `https://<your-extension-id>.chromiumapp.org/**` (get the ID after loading the extension, step 2).

## 2. Chrome extension

```bash
cd extension
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # rebuilds dist/ on change (or `npm run build`)
```

Open `chrome://extensions`, turn on Developer mode, **Load unpacked** → `extension/dist`.
Copy the extension ID and add its redirect URL to Supabase (step 1.3).

> The ID of an unpacked extension depends on its folder path. To pin it across machines,
> add a `"key"` field to `public/manifest.json`.

Code layout:

- `src/lib/supabase.js` – Supabase client, session stored in `chrome.storage.local`
- `src/lib/auth.js` – `signInWithGoogle()` via `chrome.identity.launchWebAuthFlow` (PKCE)
- `src/lib/api.js` – `apiFetch(path)` adds `Authorization: Bearer <access_token>`
- `src/popup/` – popup UI, `src/background/` – service worker

## 3. FastAPI backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL
uvicorn app.main:app --reload
```

Docs at http://localhost:8000/docs. `GET /health` is public, `GET /api/me` requires a token.

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
