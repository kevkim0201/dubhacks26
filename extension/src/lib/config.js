export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Set when extension/.env is missing values at build time.
export const CONFIG_ERROR =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? null
    : "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Fill in extension/.env and rebuild.";
