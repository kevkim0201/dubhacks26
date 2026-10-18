import { supabase } from "./supabase.js";
import { CONFIG_ERROR } from "./config.js";

// Google sign-in via Supabase OAuth + chrome.identity.launchWebAuthFlow.
// The redirect URL (https://<extension-id>.chromiumapp.org/) must be added to
// Supabase -> Authentication -> URL Configuration -> Redirect URLs.
export async function signInWithGoogle() {
  if (CONFIG_ERROR) throw new Error(CONFIG_ERROR);
  if (!chrome?.identity?.launchWebAuthFlow || !chrome.identity.getRedirectURL) {
    throw new Error("Google sign-in requires the extension Identity permission. Reload the extension and try again.");
  }

  const redirectTo = chrome.identity.getRedirectURL();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    if (/cancel|closed/i.test(message)) throw new Error("Google sign-in was cancelled.");
    throw new Error(
      `Google sign-in could not finish. Check the Google OAuth callback URL and the Supabase redirect allow list. (${message})`
    );
  }

  const url = new URL(responseUrl);
  const expectedRedirect = new URL(redirectTo);
  if (url.origin !== expectedRedirect.origin || url.pathname !== expectedRedirect.pathname) {
    throw new Error("Google sign-in returned an unexpected extension callback URL.");
  }
  const oauthError = url.searchParams.get("error") ?? url.hash.match(/(?:^|&)error=([^&]+)/)?.[1];
  if (oauthError) {
    const description =
      url.searchParams.get("error_description") ??
      url.hash.match(/(?:^|&)error_description=([^&]+)/)?.[1];
    throw new Error(
      description
        ? decodeURIComponent(description.replace(/\+/g, " "))
        : `Google sign-in failed: ${decodeURIComponent(oauthError)}`
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error(
      "Google sign-in returned no authorization code. Check that the exact extension redirect URL is allowed in Supabase."
    );
  }

  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  if (!sessionData.session) throw new Error("Google sign-in finished without creating a session.");
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
