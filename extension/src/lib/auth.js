import { supabase } from "./supabase.js";

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

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
