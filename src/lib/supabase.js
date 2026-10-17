// Minimal Supabase REST (PostgREST) client -- no @supabase/supabase-js
// dependency, deliberately. Manifest V3's extension CSP forbids loading
// remotely-hosted scripts (no CDN `<script>`), and this project has no
// bundler to vendor the SDK locally, so this hand-rolled client talks to
// Supabase's REST + Auth HTTP APIs directly with fetch(). It covers the
// handful of operations this extension needs; reach for the real SDK
// instead if the project later adds a build step and needs realtime
// subscriptions, storage, etc.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseConfig.js';

const SESSION_KEY = 'supabaseSession'; // chrome.storage.local -- access/refresh tokens

function assertConfigured() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR-PROJECT')) {
    throw new Error(
      'Supabase is not configured. Copy src/lib/supabaseConfig.example.js to ' +
        'src/lib/supabaseConfig.js and fill in your project URL + anon key.',
    );
  }
}

async function getAccessToken() {
  const session = await getSession();
  if (!session) return null;

  // Refresh a bit early (30s of slack) rather than waiting for a request
  // to fail with a 401 -- access tokens are short-lived (~1h) by default.
  if (session.expires_at && Date.now() > session.expires_at - 30_000) {
    try {
      const refreshed = await refreshSession();
      return refreshed?.access_token || null;
    } catch {
      return session.access_token || null; // let the actual request 401 if this truly didn't work
    }
  }
  return session.access_token;
}

// GoTrue (Supabase Auth) returns `expires_in` (seconds from now), not an
// absolute time -- stamp one on the way in so getAccessToken() can check
// it later without redoing this math everywhere a session is stored.
function withExpiry(session) {
  const expiresInSec = Number(session.expires_in) || 3600;
  return { ...session, expires_at: Date.now() + expiresInSec * 1000 };
}

async function authHeaders() {
  const token = await getAccessToken();
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
  };
}

// Builds a PostgREST query string from a simple filter object, e.g.
// { store: 'target.com' } -> "store=eq.target.com". Pass a raw
// "column=op.value" string in the array form for anything fancier
// (PostgREST operators: eq, neq, gt, gte, lt, lte, like, ilike, in, ...).
function buildQuery({ select, filters, order, limit } = {}) {
  const params = new URLSearchParams();
  if (select) params.set('select', select);
  if (order) params.set('order', order);
  if (limit) params.set('limit', String(limit));

  for (const [key, value] of Object.entries(filters || {})) {
    params.append(key, typeof value === 'string' && value.includes('.') ? value : `eq.${value}`);
  }
  return params.toString();
}

async function request(path, { method = 'GET', query = '', body, headers = {} } = {}) {
  assertConfigured();
  const url = `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** @param {string} table @param {{select?: string, filters?: object, order?: string, limit?: number}} [opts] */
export async function selectFrom(table, opts = {}) {
  return request(table, { query: buildQuery(opts) });
}

/** @param {string} table @param {object|object[]} rows */
export async function insertInto(table, rows) {
  return request(table, { method: 'POST', body: rows });
}

/** @param {string} table @param {{filters: object, patch: object}} opts */
export async function updateTable(table, { filters, patch }) {
  return request(table, { method: 'PATCH', query: buildQuery({ filters }), body: patch });
}

/** @param {string} table @param {{filters: object}} opts */
export async function deleteFrom(table, { filters }) {
  return request(table, { method: 'DELETE', query: buildQuery({ filters }) });
}

/**
 * Calls a Postgres function exposed by PostgREST at /rest/v1/rpc/<name> --
 * see supabase/schema.sql's validate_purchase()/redeem_acorns() for the
 * ones that currently exist. Runs as the signed-in user (RLS/auth.uid()
 * still apply inside the function); there's no way to call these as
 * anyone else.
 * @param {string} fnName @param {object} [args] keyed by the function's parameter names
 */
export async function callRpc(fnName, args = {}) {
  const [row] = await request(`rpc/${fnName}`, { method: 'POST', body: args });
  return row ?? null;
}

// --- Auth: email/password, Google OAuth (see supabase/README.md's
// "Google sign-in setup" for the Supabase dashboard + Google Cloud
// Console configuration this needs before it actually works) ---

export async function signUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || data?.error_description || 'Sign up failed');
  if (data.access_token) await chrome.storage.local.set({ [SESSION_KEY]: withExpiry(data) });
  return data;
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || data?.error_description || 'Sign in failed');
  await chrome.storage.local.set({ [SESSION_KEY]: withExpiry(data) });
  return data;
}

/**
 * Google sign-in via chrome.identity.launchWebAuthFlow -- the standard
 * way an extension does OAuth, distinct from chrome.identity.getAuthToken
 * (which is Chrome's own native Google flow and needs an `oauth2` key in
 * the manifest). Here, Supabase is the OAuth client -- it holds the real
 * Google client ID/secret on its own backend -- so the extension never
 * touches Google credentials directly, only Supabase's /authorize
 * redirect and the token fragment it comes back with.
 */
export async function signInWithGoogle() {
  assertConfigured();

  const redirectTo = chrome.identity.getRedirectURL();
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message || 'Sign-in was cancelled.'));
      } else {
        resolve(url);
      }
    });
  });

  const session = parseSessionFromRedirect(responseUrl);
  await chrome.storage.local.set({ [SESSION_KEY]: withExpiry(session) });
  return session;
}

// Supabase's /authorize redirect hands tokens back in the URL fragment
// (#access_token=...&refresh_token=...), not a query string or a body --
// there's no server here to receive a POST, so this is the "implicit"
// style redirect, read directly off the URL launchWebAuthFlow resolves
// with. If the Supabase project ever requires PKCE instead, this is the
// one place that would need to change (exchange a `code` param via
// POST /auth/v1/token?grant_type=pkce instead of reading a fragment).
function parseSessionFromRedirect(url) {
  const fragment = new URL(url).hash.slice(1);
  const params = new URLSearchParams(fragment);

  const error = params.get('error_description') || params.get('error');
  if (error) throw new Error(error);

  const access_token = params.get('access_token');
  if (!access_token) {
    throw new Error('No access token in the redirect -- check that Google is enabled under Supabase > Authentication > Providers.');
  }

  return {
    access_token,
    refresh_token: params.get('refresh_token'),
    token_type: params.get('token_type'),
    expires_in: params.get('expires_in'),
  };
}

export async function refreshSession() {
  const session = await getSession();
  if (!session?.refresh_token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || data?.error_description || 'Session refresh failed');

  const next = withExpiry(data);
  await chrome.storage.local.set({ [SESSION_KEY]: next });
  return next;
}

export async function signOut() {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function getSession() {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get({ [SESSION_KEY]: null });
  return session;
}

/** The signed-in user's profile (email, Google name/avatar under `user_metadata`), or null. */
export async function getUser() {
  const token = await getAccessToken();
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}
