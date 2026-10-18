// HTML snippets shared by the popup and the in-page checkout overlay.
import { levelInfo } from "../lib/progress.js";
import { icons } from "./art.js";

export const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function acornChip(acorns) {
  return `<span class="acorn-chip">${icons.acorn(16)}<span>${acorns ?? 0}</span></span>`;
}

export function logo(label) {
  return `<span class="logo">${icons.logo()}<span>nook</span>${label ? `<span class="logo-label">${label}</span>` : ""}</span>`;
}

export function nextUnlockText({ level, xp, needed, maxed }) {
  if (maxed) return "Top tier reached · Keep growing together";
  const remaining = needed - xp;
  const unlock = levelInfo(level + 1).unlock;
  return unlock
    ? `${remaining} XP to level ${level + 1} · A new ${unlock.label.split(" ").pop().toLowerCase()} for Pip`
    : `${remaining} XP to level ${level + 1} · Grow with each pause`;
}

export function progressCard(progress, { footnote = true } = {}) {
  const { level, xp } = progress;
  const { needed } = progress;
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
  return `<nav class="bottom-nav">${tab("talk", "Talk", icons.wave)}${tab("companion", "Companion", icons.sprout)}</nav>`;
}

// Full-page extension views, opened in their own tab from the top-right menu.
export const PAGES = [
  { path: "dashboard/index.html", label: "Your impact", sub: "Savings and decisions", icon: icons.chart },
  { path: "avatar/index.html", label: "Avatar", sub: "Dress up Pip", icon: icons.sparkle },
  { path: "quests/index.html", label: "Quests", sub: "Weekly goals and forest", icon: icons.leaf },
];

export function pageMenu(open, { signOut = true } = {}) {
  return `
    <div class="menu-wrap">
      <button class="icon-btn menu-btn ${open ? "open" : ""}" data-action="toggle-menu"
              aria-label="More pages" aria-haspopup="menu" aria-expanded="${open}">${icons.menu(18)}</button>
      ${
        open
          ? `<div class="menu" role="menu">
        ${PAGES.map(
          (p) => `<button class="menu-item" role="menuitem" data-action="open-page" data-path="${p.path}">
            ${p.icon(16)}<span><strong>${p.label}</strong><small>${p.sub}</small></span>${icons.external(12)}
          </button>`
        ).join("")}
        ${signOut ? `<div class="menu-sep"></div><button class="menu-item" role="menuitem" data-action="sign-out">${icons.logout(16)}<span><strong>Sign out</strong></span></button>` : ""}
      </div>`
          : ""
      }
    </div>`;
}

export function pipsSwapsCard(recommendations, { isLoading = false } = {}) {
  if (isLoading) {
    return `
      <div class="swaps-container loading">
        <div class="swaps-header">
          <div class="swaps-title">
            <span class="swaps-sparkle">✨</span>
            <strong>Pip's Swaps</strong>
          </div>
          <span class="swaps-pill-loading">Searching deals...</span>
        </div>
        <div class="swap-shimmer-card">
          <div class="swap-shimmer-bar short"></div>
          <div class="swap-shimmer-bar long"></div>
        </div>
      </div>`;
  }

  const items = Array.isArray(recommendations) ? recommendations : [];
  if (items.length === 0) return "";

  const maxSavings = Math.max(...items.map((r) => Number(r.estimated_savings) || 0));
  const savingsBadge = maxSavings > 0
    ? `<span class="swaps-pill-save">Save up to $${maxSavings.toFixed(2)}</span>`
    : "";

  return `
    <div class="swaps-container">
      <div class="swaps-header">
        <div class="swaps-title">
          <span class="swaps-sparkle">✨</span>
          <strong>Pip's Swaps</strong>
        </div>
        ${savingsBadge}
      </div>
      <div class="swaps-list">
        ${items
          .slice(0, 3)
          .map((rec) => {
            const price = Number(rec.estimated_price || 0).toFixed(2);
            const savings = Number(rec.estimated_savings || 0);
            return `
              <div class="swap-item" data-swap-id="${escape(rec.id)}">
                <div class="swap-item-header">
                  <span class="swap-product-name" title="${escape(rec.title)}">${escape(rec.title)}</span>
                  <div class="swap-tags">
                    <span class="swap-price">$${price}</span>
                    ${savings > 0 ? `<span class="swap-savings">Save $${savings.toFixed(2)}</span>` : ""}
                  </div>
                </div>
                ${rec.pip_reason ? `<p class="swap-advice">🐿️ “${escape(rec.pip_reason)}”</p>` : ""}
                <div class="swap-actions">
                  <button class="swap-btn" data-action="view-swap" data-swap-id="${escape(rec.id)}" data-url="${escape(rec.search_url)}" data-title="${escape(rec.title)}">
                    <span>Check Deal</span>
                    <span class="swap-btn-icon">↗</span>
                  </button>
                  <span class="swap-reward-hint">+10 🌰 on check</span>
                </div>
              </div>`;
          })
          .join("")}
      </div>
    </div>`;
}
