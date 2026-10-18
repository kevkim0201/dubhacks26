import { supabase } from "./supabase.js";
import { CONFIG_ERROR } from "./config.js";

// Google sign-in via Supabase OAuth + chrome.identity.launchWebAuthFlow.
// The redirect URL (https://<extension-id>.chromiumapp.org/) must be added to
// Supabase -> Authentication -> URL Configuration -> Redirect URLs.
export async function signInWithGoogle() {
  const redirectTo = chrome.identity.getRedirectURL();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: data.url,
    interactive: true,
  });

  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  if (!code) {
    const message = url.searchParams.get("error_description") ?? "No auth code returned";
    throw new Error(message);
  }

  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  return sessionData.session;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

// Returns a session right away if email confirmation is off in Supabase;
// otherwise session is null and the user must confirm via email first.
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.session;
}

// Reads the stored session and confirms with Supabase that the user still
// exists / the token is still valid. Clears a dead session.
export async function checkAuth() {
  if (CONFIG_ERROR) throw new Error(CONFIG_ERROR);
  const session = await getSession();
  if (!session) return null;

  const { error } = await supabase.auth.getUser();
  if (error) {
    await supabase.auth.signOut({ scope: "local" });
    return null;
  }
  return session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
