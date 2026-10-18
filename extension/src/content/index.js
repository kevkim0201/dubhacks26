// Runs on every page. When it spots a checkout, it tells the background worker
// (so the popup can show the cart) and shows Pip's overlay on the page.
import themeCss from "../ui/theme.css?inline";
import overlayCss from "./overlay.css?inline";
import { icons, setSquirrelCosmetics, squirrel } from "../ui/art.js";
import { acornChip, cartCard, logo, navBar, progressCard } from "../ui/components.js";
import { readCheckout, scoreCheckout } from "./detect.js";

// "Not now" only hides Pip for the current page view; reloading or the next
// checkout page shows the overlay again.

let host = null; // overlay host element (null when hidden)
let lastSent = null;
let dismissedUrl = null; // set by "Not now" so DOM changes on this page don't re-open it
let activeCheckout = null;
// Stores often render the order summary a moment after the checkout page itself.
const CART_GRACE_MS = 8000;
let cartSeen = { url: null, at: 0 };
let graceTimer = null;
let activeUserId = null;
let debug = false;

function send(message) {
  try {
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    // Extension was reloaded; this content script is orphaned.
    return Promise.resolve(null);
  }
}

// @font-face doesn't work inside shadow roots, so register the font on the page.
function ensureFont() {
  if (document.getElementById("nook-font")) return;
  const style = document.createElement("style");
  style.id = "nook-font";
  style.textContent = `@font-face {
    font-family: "Nook Nunito";
    src: url("${chrome.runtime.getURL("fonts/nunito.woff2")}") format("woff2");
    font-weight: 200 1000;
    font-display: swap;
  }`;
  document.head.appendChild(style);
}

function panelHtml(checkout, status) {
  const progress = status?.progress;
  return `
    <div class="backdrop" aria-hidden="true"></div>
    <section class="nook panel" role="dialog" aria-modal="true" aria-label="Nook">
      <header class="topbar">
        ${logo("Extension")}
        <span class="head-right">
          ${progress ? acornChip(progress.acorns) : ""}
          <button class="icon-btn" data-action="close" aria-label="Close">${icons.close(14)}</button>
        </span>
      </header>
      <div class="body">
        <h1 class="title">Pip noticed a checkout.</h1>
        <p class="muted">Make your case before you buy.</p>
        ${cartCard(checkout, { variant: "overlay" })}
        <div class="art art-xs">${squirrel({ scarf: progress?.unlocked?.includes("scarf") })}</div>
        <p class="ask">“Why do you need this today?”</p>
        <p class="ask-sub muted">Tell your squirrel. Pip will challenge your reasons and may suggest buying or waiting.</p>
        ${progress ? progressCard(progress, { footnote: false }) : ""}
        <button class="btn btn-primary" data-action="talk">${icons.mic(16)}<span>Talk to Pip</span></button>
        <button class="link" data-action="close">Not now</button>
        <p class="fine">A voice conversation. Your checkout stays in your hands.</p>
        <p class="fine hint" hidden></p>
      </div>
      ${navBar("talk")}
    </section>`;
}

async function openPopup(screen) {
  const res = await send({ type: "OPEN_POPUP", screen });
  if (!res?.ok) {
    const hint = host?.shadowRoot.querySelector(".hint");
    if (hint) {
      hint.hidden = false;
      hint.textContent = "Click the Nook icon in your toolbar to continue.";
    }
  }
}

function dismissOverlay() {
  dismissedUrl = location.href;
  hideOverlay();
}

function hideOverlay() {
  host?.remove();
  host = null;
  activeCheckout = null;
  activeUserId = null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && host) dismissOverlay();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && activeCheckout && activeUserId && changes[`cosmetics:${activeUserId}`]) {
    showOverlay(activeCheckout);
  }
});

async function showOverlay(checkout) {
  activeCheckout = checkout;
  const status = await send({ type: "GET_STATUS" });
  activeUserId = status?.userId ?? null;
  setSquirrelCosmetics(status?.cosmetics ?? null);
  ensureFont();

  if (!host) {
    host = document.createElement("nook-overlay");
    const root = host.attachShadow({ mode: "open" });
    root.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "close") {
        dismissOverlay();
      } else if (action === "talk" || action === "go-talk") {
        openPopup("conversation");
      } else if (action === "go-impact") {
        send({ type: "OPEN_DASHBOARD" });
      } else if (action === "go-avatar") {
        send({ type: "OPEN_AVATAR" });
      } else if (action === "go-companion") {
        openPopup("companion");
      }
    });
    document.documentElement.appendChild(host);
  }
  host.shadowRoot.innerHTML = `<style>${themeCss}${overlayCss}</style>${panelHtml(checkout, status)}`;
}

async function scan() {
  const url = new URL(location.href);
  const result = scoreCheckout(document, url);
  if (debug) console.debug("[Nook] score", result.score, result.isCheckout ? "→ checkout" : "", result.reasons);

  if (!result.isCheckout) {
    if (lastSent !== "none") send({ type: "CHECKOUT_CLEARED" });
    lastSent = "none";
    hideOverlay();
    return;
  }

  const checkout = readCheckout(document, url, result.site);
  if (cartSeen.url !== location.href) cartSeen = { url: location.href, at: Date.now() };
  const hasDetails = checkout.items.length > 0 || !!checkout.total;
  const waited = Date.now() - cartSeen.at;
  checkout.loading = !hasDetails && waited < CART_GRACE_MS;
  // Re-check once the grace period ends, so the skeleton becomes the plain fallback even
  // on pages that stop changing.
  clearTimeout(graceTimer);
  if (checkout.loading) graceTimer = setTimeout(scheduleScan, CART_GRACE_MS - waited + 50);
  if (debug) console.debug("[Nook] cart", checkout);
  const key = JSON.stringify(checkout);
  if (key === lastSent) return;
  lastSent = key;

  send({ type: "CHECKOUT_DETECTED", checkout });
  if (host || dismissedUrl !== location.href) showOverlay(checkout);
}

// Re-scan when the page changes (SPAs, carts that load late). Debounced, but
// forced at least every 2s so pages that never stop mutating still get scanned.
let timer = null;
let firstPending = 0;
function scheduleScan() {
  const now = Date.now();
  if (!timer) firstPending = now;
  clearTimeout(timer);
  const wait = Math.max(0, Math.min(600, firstPending + 2000 - now));
  timer = setTimeout(() => {
    timer = null;
    scan();
  }, wait);
}

new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, characterData: true });
// SPA route changes that don't touch the DOM much.
window.addEventListener("popstate", scheduleScan);

// Turn on logging: chrome.storage.local.set({ nookDebug: true }) from the
// service-worker console, then reload the page.
chrome.storage.local.get("nookDebug").then(({ nookDebug }) => {
  debug = !!nookDebug;
  scan();
});
