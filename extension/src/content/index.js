// Runs on every page. When it spots a checkout, it tells the background worker
// (so the popup can show the cart) and shows Pip's overlay on the page.
import themeCss from "../ui/theme.css?inline";
import overlayCss from "./overlay.css?inline";
import { icons, squirrel } from "../ui/art.js";
import { acornChip, cartCard, logo, navBar, progressCard } from "../ui/components.js";
import { looksLikeCheckout, readCheckout } from "./detect.js";

let host = null; // overlay host element (null when hidden)
let dismissedUrl = null;
let lastSent = null;

function send(message) {
  try {
    return chrome.runtime.sendMessage(message);
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
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && host) dismissOverlay();
});

async function showOverlay(checkout) {
  const status = await send({ type: "GET_STATUS" });
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
      } else if (action === "go-companion") {
        openPopup("companion");
      }
    });
    document.documentElement.appendChild(host);
  }
  host.shadowRoot.innerHTML = `<style>${themeCss}${overlayCss}</style>${panelHtml(checkout, status)}`;
}

function scan() {
  if (!looksLikeCheckout()) {
    if (lastSent !== "none") send({ type: "CHECKOUT_CLEARED" });
    lastSent = "none";
    hideOverlay();
    return;
  }

  const checkout = readCheckout();
  const key = JSON.stringify(checkout);
  if (key === lastSent) return;
  lastSent = key;

  send({ type: "CHECKOUT_DETECTED", checkout });
  if (dismissedUrl !== location.href) showOverlay(checkout);
}

// Re-scan when the page changes (SPAs, carts that load late), debounced.
let timer = null;
const scheduleScan = () => {
  clearTimeout(timer);
  timer = setTimeout(scan, 600);
};

new MutationObserver((mutations) => {
  // Ignore our own overlay updates.
  if (mutations.every((m) => m.target === host || host?.contains(m.target))) return;
  scheduleScan();
}).observe(document.body, { childList: true, subtree: true, characterData: true });

scan();
