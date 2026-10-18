import { supabase } from "../lib/supabase.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("DubHacks26 extension installed");
});

supabase.auth.onAuthStateChange((event, session) => {
  console.log("Auth state changed:", event, session?.user?.email ?? null);
});

// Message handler so content scripts / popup can ask the worker for things.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SESSION") {
    supabase.auth.getSession().then(({ data }) => sendResponse(data.session));
    return true; // keep the channel open for the async response
  }
});
