import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CONFIG_ERROR } from "./config.js";

// Extension pages and the service worker don't share localStorage reliably,
// so persist the Supabase session in chrome.storage.local instead.
const chromeStorageAdapter = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

if (CONFIG_ERROR) console.error(CONFIG_ERROR);

// Placeholder values keep the import from throwing so the UI can show CONFIG_ERROR.
export const supabase = createClient(
  SUPABASE_URL || "http://invalid.localhost",
  SUPABASE_ANON_KEY || "missing",
  {
    auth: {
      storage: chromeStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  }
);
