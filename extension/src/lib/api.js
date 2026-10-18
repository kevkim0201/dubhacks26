import { API_BASE_URL, CONFIG_ERROR } from "./config.js";
import { getSession } from "./auth.js";

// fetch with the Supabase access token for the FastAPI backend; throws on non-2xx.
async function authedFetch(path, options = {}) {
  if (CONFIG_ERROR) throw new Error(CONFIG_ERROR);
  const session = await getSession().catch(() => null);
  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res;
}

export async function apiFetch(path, options = {}) {
  const res = await authedFetch(path, options);
  return res.status === 204 ? null : res.json();
}

// Reads a Server-Sent Events response (event: … / data: …) and calls onEvent(type, data) per event.
// Uses fetch so it can send the Authorization header (EventSource can't).
export async function apiStream(path, options = {}, onEvent = () => {}) {
  const res = await authedFetch(path, { ...options, headers: { Accept: "text/event-stream", ...options.headers } });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const type = block.match(/^event: (.*)$/m)?.[1] ?? "message";
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (data != null) onEvent(type, JSON.parse(data));
    }
    if (done) break;
  }
}
