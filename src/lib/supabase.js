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
  const { [SESSION_KEY]: session } = await chrome.storage.local.get({ [SESSION_KEY]: null });
  return session?.access_token || null;
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

// --- Auth (email/password; swap for OAuth/magic-link later if needed) ---

export async function signUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || data?.error_description || 'Sign up failed');
  if (data.access_token) await chrome.storage.local.set({ [SESSION_KEY]: data });
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
  await chrome.storage.local.set({ [SESSION_KEY]: data });
  return data;
}

export async function signOut() {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function getSession() {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get({ [SESSION_KEY]: null });
  return session;
}
