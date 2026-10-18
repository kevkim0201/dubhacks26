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
// Shimmering placeholder while the store's page is still filling in the order summary.
function cartSkeleton(checkout) {
  return `
    <div class="cart cart-loading" aria-busy="true" aria-label="Reading your cart">
      <div class="cart-head"><span>${checkout.store ? `<strong>${escape(checkout.store)}</strong> · ` : ""}Pip is reading your cart…</span>
        <span class="sk sk-price"></span></div>
      <div class="cart-item">
        <span class="thumb sk"></span>
        <div class="sk-lines"><span class="sk sk-line"></span><span class="sk sk-line short"></span></div>
      </div>
    </div>`;
}

export function cartCard(checkout, { variant = "popup" } = {}) {
  if (checkout.loading) return cartSkeleton(checkout);
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
  { path: "onboarding/index.html", label: "Personalize Pip", sub: "Your spending habits", icon: icons.sprout },
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

// ---------- deal checks ----------

const money = (value, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value ?? 0);

/**
 * One item's deal-check result (or progress). `check` is a deal_checks row; `live` is the
 * latest step message while Pip is still hunting.
 */
export function dealCard(check, { live = null, compact = false } = {}) {
  const r = check.result;
  const name = escape(check.item_name);
  const head = `<div class="deal-head"><strong title="${name}">${name}</strong><span>${money(check.item_price, check.currency)}${check.store ? ` · ${escape(check.store)}` : ""}</span></div>`;

  if (!r) {
    const waiting = check.status === "pending" && !check.due;
    const text = waiting
      ? `Pip will check prices ${dueIn(check.due_at)}.`
      : live ?? (check.status === "failed" ? "Pip couldn't finish this one." : "Pip is checking prices…");
    return `<div class="deal-card ${waiting ? "is-waiting" : "is-running"}" data-check="${escape(check.id)}">
      ${head}<p class="deal-live">${waiting ? icons.clock(13) : `<span class="deal-spinner"></span>`}<span>${escape(text)}</span></p></div>`;
  }

  const best = r.offers?.[0];
  const badge = { overpriced: "Cheaper elsewhere", fair: "Fair price", great_deal: "Best price" }[r.verdict];
  return `<div class="deal-card verdict-${r.verdict}" data-check="${escape(check.id)}">
    ${head}
    <p class="deal-verdict"><span class="deal-badge">${badge}</span>${escape(r.verdict_reason)}</p>
    ${
      best && !compact
        ? `<a class="deal-offer" href="${escape(best.link)}" target="_blank" rel="noopener noreferrer">
            <span><strong>${escape(best.seller)}</strong> · ${money(best.total, check.currency)}${best.shipping === 0 ? " · free shipping" : ""}</span>
            <span class="deal-save">Save ${money(best.savings, check.currency)} ${icons.external(12)}</span>
          </a>`
        : ""
    }
    ${!compact && r.alternatives?.length ? similarPicks(r.alternatives, check.currency) : ""}
    ${r.coupons?.length && !compact ? `<p class="deal-coupon">${icons.sparkle(12)} Coupon: <code>${escape(r.coupons[0].code)}</code> ${escape(r.coupons[0].description)}</p>` : ""}
  </div>`;
}

// Different products that do the same job for less, with why they fit and what you give up.
function similarPicks(alternatives, currency) {
  return `<div class="deal-alts">
    <p class="deal-alts-title">${icons.sparkle(12)} Similar picks that fit your need</p>
    ${alternatives
      .map(
        (a) => `<a class="deal-alt" href="${escape(a.link)}" target="_blank" rel="noopener noreferrer" title="${escape(a.title)}">
          ${a.thumbnail ? `<img src="${escape(a.thumbnail)}" alt="" referrerpolicy="no-referrer" />` : ""}
          <span class="deal-alt-body">
            <strong>${escape(a.title)}</strong>
            <span>${escape(a.seller)} · ${money(a.total, currency)} · <b>save ${money(a.savings, currency)}</b></span>
            ${a.why ? `<span class="deal-alt-why">${escape(a.why)}</span>` : ""}
            ${a.tradeoff ? `<span class="deal-alt-trade">Trade-off: ${escape(a.tradeoff)}</span>` : ""}
          </span>
        </a>`
      )
      .join("")}
  </div>`;
}

function dueIn(iso) {
  const hours = Math.max(0, (new Date(iso) - Date.now()) / 36e5);
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${Math.round(hours)}h`;
  return `tomorrow`;
}
