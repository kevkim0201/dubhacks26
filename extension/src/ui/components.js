// HTML snippets shared by the popup and the in-page checkout overlay.
import { levelInfo, xpToNext } from "../lib/progress.js";
import { icons } from "./art.js";

export const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function acornChip(acorns) {
  return `<span class="acorn-chip">${icons.acorn(16)}<span>${acorns ?? 0}</span></span>`;
}

export function logo(label) {
  return `<span class="logo">${icons.logo()}<span>nook</span>${label ? `<span class="logo-label">${label}</span>` : ""}</span>`;
}

export function nextUnlockText({ level, xp }) {
  const remaining = xpToNext(level) - xp;
  const unlock = levelInfo(level + 1).unlock;
  return unlock
    ? `${remaining} XP to level ${level + 1} · A new ${unlock.label.split(" ").pop().toLowerCase()} for Pip`
    : `${remaining} XP to level ${level + 1} · Grow with each pause`;
}

export function progressCard(progress, { footnote = true } = {}) {
  const { level, xp } = progress;
  const needed = xpToNext(level);
  const pct = Math.min(100, Math.round((xp / needed) * 100));
  return `
    <div class="progress">
      <div class="progress-row">
        <strong>Level ${level} · ${escape(levelInfo(level).name)}</strong>
        <span>${xp} / ${needed} XP</span>
      </div>
      <div class="bar" role="progressbar" aria-valuenow="${xp}" aria-valuemax="${needed}">
        <div class="bar-fill" style="width:${pct}%"></div>
      </div>
      ${footnote ? `<p class="footnote">${nextUnlockText(progress)}</p>` : ""}
    </div>`;
}

function itemSummary(checkout) {
  const count = checkout.itemCount;
  return count ? `${count} item${count === 1 ? "" : "s"}` : "Your cart";
}

function thumb(item) {
  return item?.image
    ? `<img class="thumb" src="${escape(item.image)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="thumb thumb-empty">${icons.bag(18)}</span>`;
}

// The cart Pip spotted. `variant: "popup"` puts the total in the header row;
// `"overlay"` puts it under the item name.
export function cartCard(checkout, { variant = "popup" } = {}) {
  const item = checkout.items?.[0];
  const name = item?.name ?? "Items in your cart";
  const more = checkout.itemCount > 1 ? ` + ${checkout.itemCount - 1} more` : "";
  const total = checkout.total ? escape(checkout.total) : "";

  if (variant === "overlay") {
    return `
      <div class="cart">
        <div class="cart-head"><span>${escape(checkout.store)} · ${itemSummary(checkout)}</span></div>
        <div class="cart-item">
          ${thumb(item)}
          <div>
            <strong>${escape(name)}${more}</strong>
            ${total ? `<span class="cart-price">${total}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="cart">
      <div class="cart-head">
        <span><strong>${escape(checkout.store)}</strong> · At checkout</span>
        ${total ? `<strong class="cart-total">${total}</strong>` : ""}
      </div>
      <div class="cart-item">
        ${thumb(item)}
        <div>
          <strong>${escape(name)}${more}</strong>
          <span class="muted">${itemSummary(checkout)} in cart</span>
        </div>
      </div>
    </div>`;
}

export function navBar(active) {
  const tab = (id, label, icon) => `
    <button class="nav-tab ${active === id ? "active" : ""}" data-action="go-${id}">
      ${icon(16)}<span>${label}</span>
    </button>`;
  return `<nav class="bottom-nav">${tab("talk", "Talk", icons.wave)}${tab("companion", "Companion", icons.sprout)}${tab("impact", "Impact", icons.chart)}${tab("avatar", "Avatar", icons.sparkle)}</nav>`;
}
