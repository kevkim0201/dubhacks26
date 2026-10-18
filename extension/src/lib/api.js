import { API_BASE_URL, CONFIG_ERROR } from "./config.js";
import { getSession } from "./auth.js";

// fetch wrapper that attaches the Supabase access token for the FastAPI backend.
export async function apiFetch(path, options = {}) {
  if (CONFIG_ERROR) throw new Error(CONFIG_ERROR);
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("Sign in with Google before connecting to the backend.");
  }
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}
