import { apiFetch } from "../lib/api.js";
import { checkAuth, signInWithGoogle } from "../lib/auth.js";
import { setPopupIntent } from "../lib/checkout.js";
import { levelInfo, loadProgress, xpToNext } from "../lib/progress.js";
import { icons, squirrel } from "../ui/art.js";
import { acornChip, escape } from "../ui/components.js";
import { decisionsChart, savingsChart } from "./charts.js";
import { sampleImpact } from "./sample.js";

const app = document.getElementById("app");

const state = {
  session: null,
  progress: null,
  data: null,
  notice: null, // why we're showing sample data, if we are
  weeks: 4,
  outcome: "all",
  page: 1,
  loading: true,
  toast: null,
};

const PAGE_SIZE = 6;

const OUTCOME_LABEL = { avoided: "Avoided", postponed: "Postponed", proceeded: "Proceeded" };
const OUTCOME_ICON = { avoided: icons.check, postponed: icons.clock, proceeded: icons.arrow };

// ---------- formatting ----------

function moneyFormatter(currency, cents) {
  const f = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return (v) => f.format(v ?? 0);
}

const shortDate = (iso, opts = {}) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: iso.length === 10 ? "UTC" : undefined,
    ...opts,
  });

const pct = (share) => `${Math.round(share * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function firstName(session) {
  const meta = session?.user?.user_metadata ?? {};
  const name = meta.full_name || meta.name || session?.user?.email?.split("@")[0] || "friend";
  return name.split(" ")[0];
}

// ---------- data ----------

async function load() {
  state.loading = true;
  render();
  const query = { weeks: state.weeks, outcome: state.outcome, page: state.page, pageSize: PAGE_SIZE };

  try {
    const params = new URLSearchParams({ weeks: query.weeks, outcome: query.outcome, page: query.page, page_size: PAGE_SIZE });
    const real = await apiFetch(`/api/impact?${params}`);
    if (real.decisions > 0) {
      state.data = real;
      state.notice = null;
    } else {
      state.data = sampleImpact(query);
      state.notice = "empty";
    }
  } catch (err) {
    console.error(err);
    state.data = sampleImpact(query);
    state.notice = "error";
  }
  state.loading = false;
  render();
}

// ---------- sections ----------

function topbar() {
  const initial = firstName(state.session).charAt(0).toUpperCase();
  const tab = (id, label, icon, active) =>
    `<button class="top-tab ${active ? "active" : ""}" data-action="${id}">${icon(16)}<span>${label}</span></button>`;
  return `
    <header class="dash-top">
      <div class="brand">
        <span class="logo">${icons.logo()}<span>nook</span></span>
        <span class="brand-divider"></span>
        <span class="tagline">Shop with intention</span>
      </div>
      <nav class="top-tabs" aria-label="Nook">
        ${tab("noop", "Your impact", icons.chart, true)}
        ${tab("open-companion", "Companion", icons.sprout)}
        ${tab("open-talk", "Talk", icons.wave)}
      </nav>
      <div class="top-right">
        ${acornChip(state.progress?.acorns)}
        <span class="avatar" title="${escape(state.session?.user?.email)}">${escape(initial)}</span>
      </div>
    </header>`;
}

function hero() {
  const { range } = state.data;
  const end = new Date(`${range.end}T00:00:00Z`);
  return `
    <section class="hero">
      <div>
        <p class="eyebrow">Your impact</p>
        <h1>Little pauses. Real perspective.</h1>
        <p class="muted">Here's how you and Pip are making room for more thoughtful choices, ${escape(firstName(state.session))}.</p>
      </div>
      <div class="range">
        <label class="select-btn">
          ${icons.calendar(15)}
          <select data-change="weeks" aria-label="Date range">
            ${[4, 8, 12].map((w) => `<option value="${w}" ${w === state.weeks ? "selected" : ""}>Last ${w} weeks</option>`).join("")}
          </select>
        </label>
        <span class="muted range-dates">${shortDate(range.start)} – ${shortDate(range.end)}, ${end.getUTCFullYear()}</span>
      </div>
    </section>`;
}

function banner() {
  if (!state.notice) return "";
  const text =
    state.notice === "error"
      ? "We couldn't reach your Nook data right now, so this is illustrative activity, not your real decisions."
      : "A look at what your Nook dashboard can show. These are illustrative decisions, not real customer data. Yours appear after your first talk with Pip.";
  return `<div class="sample-banner" role="note"><span class="sample-tag">Sample activity</span><span>${text}</span>
    ${state.notice === "error" ? `<button class="link-btn" data-action="retry">Try again</button>` : ""}</div>`;
}

function kpis(money) {
  const { outcomes, decisions, conversations, money_saved, currency } = state.data;
  const tile = (label, value, sub, icon, hero = false) => `
    <div class="kpi ${hero ? "kpi-hero" : ""}">
      <div class="kpi-head"><span>${label}</span>${icon(18)}</div>
      <strong>${value}</strong>
      <span class="kpi-sub">${sub}</span>
    </div>`;
  return `
    <section class="kpis">
      ${tile("Estimated money saved", money(money_saved), `From ${plural(outcomes.avoided.count, "avoided purchase")} · ${currency}`, icons.wallet, true)}
      ${tile("Impulse purchases avoided", outcomes.avoided.count, `${pct(outcomes.avoided.share)} of your ${plural(decisions, "decision")}`, icons.leaf)}
      ${tile("Purchases postponed", outcomes.postponed.count, `${money(outcomes.postponed.amount)} on hold · not counted as saved`, icons.clock)}
      ${tile("Conversations with Pip", conversations, `${plural(conversations, "moment")} to think it through`, icons.wave)}
    </section>`;
}

function trends(money) {
  const { weekly } = state.data;
  return `
    <section class="card trends">
      <div class="card-head"><h2>Your pauses are adding up</h2><span class="caps muted">Weekly view</span></div>
      <div class="trend-grid">
        <div>
          <p class="chart-title">Cumulative estimated savings</p>
          <div class="chart" id="savings-chart"></div>
          ${
            weekly.length <= 6
              ? `<div class="week-deltas" style="--cols:${weekly.length}">
            ${weekly.map((w) => `<div><strong>+${money(w.saved)}</strong><span>this week</span></div>`).join("")}
          </div>`
              : `<p class="week-note muted">Hover the chart for each week's savings.</p>`
          }
        </div>
        <div class="trend-divider"></div>
        <div>
          <p class="chart-title">Decisions each week</p>
          <div class="chart" id="decisions-chart"></div>
          <div class="legend">
            ${Object.entries(OUTCOME_LABEL).map(([k, l]) => `<span><i class="swatch swatch-${k}"></i>${l}</span>`).join("")}
          </div>
        </div>
      </div>
    </section>`;
}

function growing() {
  const p = state.progress ?? { level: 1, xp: 0, unlocked: [] };
  const needed = xpToNext(p.level);
  const scarf = p.unlocked?.includes("scarf");
  return `
    <section class="card card-green growing">
      <div class="card-head"><h2>Growing with Pip</h2><span class="level-chip">Level ${p.level}</span></div>
      <p class="muted">Thoughtful choices help Pip grow.</p>
      <div class="art">${squirrel({ scarf, sparkles: true })}</div>
      ${scarf ? `<p class="new-look">${icons.sparkle(12)} New look: Forest scarf</p>` : ""}
      <div class="level-card">
        <strong>Level ${p.level} · ${escape(levelInfo(p.level).name)}</strong>
        <div class="progress-row"><span>${p.xp} / ${needed} XP</span><span>${needed - p.xp} XP to level ${p.level + 1}</span></div>
        <div class="bar"><div class="bar-fill" style="width:${Math.round((p.xp / needed) * 100)}%"></div></div>
      </div>
      <p class="fine-left">XP &amp; acorns come from reflecting with Pip, never from spending.</p>
    </section>`;
}

function decisionsTable() {
  const { recent, currency } = state.data;
  const money = moneyFormatter(currency, true);
  const pages = Math.max(1, Math.ceil(recent.total / recent.page_size));
  const rows = recent.items
    .map(
      (d) => `
      <tr>
        <td>
          <div class="purchase">
            ${d.image ? `<img src="${escape(d.image)}" alt="" referrerpolicy="no-referrer" />` : `<span class="purchase-icon">${icons.bag(16)}</span>`}
            <div><strong>${escape(d.name)}</strong><span>${escape(d.store)}</span></div>
          </div>
        </td>
        <td class="muted">${shortDate(d.date)}</td>
        <td>${money(d.cart_total)}</td>
        <td><span class="pill-outcome pill-${d.outcome}">${OUTCOME_ICON[d.outcome](12)} ${OUTCOME_LABEL[d.outcome]}</span></td>
        <td class="num">${d.saved != null ? `<strong>${money(d.saved)}</strong>` : `<span class="muted">—</span>`}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="card recent">
      <div class="card-head">
        <div><h2>Your recent decisions</h2><p class="muted">A little context behind the numbers.</p></div>
        <label class="select-btn">
          ${icons.chevron(14)}
          <select data-change="outcome" aria-label="Filter by outcome">
            <option value="all" ${state.outcome === "all" ? "selected" : ""}>All outcomes</option>
            ${Object.entries(OUTCOME_LABEL).map(([k, l]) => `<option value="${k}" ${state.outcome === k ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Purchase</th><th>Date</th><th>Cart</th><th>Your decision</th><th class="num">Est. saved</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty">No ${state.outcome === "all" ? "" : OUTCOME_LABEL[state.outcome].toLowerCase() + " "}decisions in this range.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="table-foot">
        <span class="muted">Showing ${recent.items.length} of ${plural(recent.total, state.notice ? "sample decision" : "decision")}</span>
        <div class="pager">
          <span class="muted">Page ${recent.page} of ${pages}</span>
          ${recent.page > 1 ? `<button class="btn-pill" data-action="prev">${icons.arrow(14)}<span>Back</span></button>` : ""}
          ${recent.page < pages ? `<button class="btn-pill" data-action="next">${icons.arrow(14)}<span>Next</span></button>` : ""}
        </div>
      </div>
    </section>`;
}

function afterTalking(money) {
  const { outcomes, decisions, conversations } = state.data;
  const sub = {
    avoided: `${money(outcomes.avoided.amount)} counted as estimated savings`,
    postponed: `${money(outcomes.postponed.amount)} still on hold`,
    proceeded: `${money(outcomes.proceeded.amount)} in considered purchases`,
  };
  return `
    <section class="card after">
      <h2>After talking with Pip</h2>
      <p class="muted">${plural(conversations, "conversation")}. ${plural(decisions, "thoughtful decision")}.</p>
      <div class="split-bar" role="img" aria-label="Share of decisions by outcome">
        ${Object.keys(OUTCOME_LABEL).map((k) => (outcomes[k].count ? `<span class="seg-${k}" style="flex:${outcomes[k].count}"></span>` : "")).join("")}
      </div>
      <ul class="outcome-list">
        ${Object.entries(OUTCOME_LABEL)
          .map(
            ([k, l]) => `
          <li>
            <i class="swatch swatch-${k}"></i>
            <div><strong>${l}</strong><span>${sub[k]}</span></div>
            <strong class="num">${outcomes[k].count} · ${pct(outcomes[k].share)}</strong>
          </li>`
          )
          .join("")}
      </ul>
      <div class="info-box">
        <strong>${icons.info(14)} What counts as saved?</strong>
        <p>Only the cart value of purchases marked avoided. Postponed and proceeded purchases add $0 to savings. Estimates are not bank-verified.</p>
      </div>
      <p class="fine-left">A considered “yes” is progress, too. You earn rewards for the reflection, whatever you decide.</p>
    </section>`;
}

// ---------- render ----------

function render() {
  if (!state.session) {
    app.innerHTML = `
      <main class="signin">
        <div class="art">${squirrel()}</div>
        <h1>See your impact with Nook</h1>
        <p class="muted">Sign in to see how your pauses add up.</p>
        <button class="btn btn-outline" data-action="google">${icons.google()}<span>Continue with Google</span></button>
        ${state.toast ? `<p class="error">${escape(state.toast)}</p>` : ""}
      </main>`;
    return;
  }
  if (!state.data) {
    app.innerHTML = `${topbar()}<main class="dash loading"><div class="spinner"></div></main>`;
    return;
  }

  const money = moneyFormatter(state.data.currency, false);
  app.innerHTML = `
    ${topbar()}
    <main class="dash ${state.loading ? "is-loading" : ""}">
      ${hero()}
      ${banner()}
      ${kpis(money)}
      <div class="dash-grid">
        <div class="col">${trends(money)}${decisionsTable()}</div>
        <div class="col">${growing()}${afterTalking(money)}</div>
      </div>
    </main>
    ${state.toast ? `<div class="toast" role="status">${escape(state.toast)}</div>` : ""}`;
  drawCharts();
}

function drawCharts() {
  const money = moneyFormatter(state.data.currency, false);
  const savings = document.getElementById("savings-chart");
  const decisions = document.getElementById("decisions-chart");
  if (savings) savingsChart(savings, state.data.weekly, money);
  if (decisions) decisionsChart(decisions, state.data.weekly);
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data && drawCharts(), 120);
});

// ---------- actions ----------

function showToast(text) {
  state.toast = text;
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 4000);
}

async function openPopup(screen) {
  await setPopupIntent(screen);
  try {
    await chrome.action.openPopup();
  } catch {
    showToast("Click the Nook icon in your toolbar to open Pip.");
  }
}

const actions = {
  async google() {
    try {
      state.session = await signInWithGoogle();
      await start();
    } catch (err) {
      state.toast = err?.message ?? String(err);
      render();
    }
  },
  "open-companion": () => openPopup("companion"),
  "open-talk": () => openPopup("talk"),
  retry: load,
  next() {
    state.page += 1;
    load();
  },
  prev() {
    state.page -= 1;
    load();
  },
};

app.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  actions[action]?.();
});

app.addEventListener("change", (e) => {
  const key = e.target.dataset.change;
  if (!key) return;
  state[key] = key === "weeks" ? Number(e.target.value) : e.target.value;
  state.page = 1;
  load();
});

async function start() {
  state.progress = await loadProgress(state.session.user.id);
  await load();
}

checkAuth()
  .then(async (session) => {
    state.session = session;
    if (session) await start();
    else render();
  })
  .catch((err) => {
    console.error(err);
    state.toast = err?.message ?? String(err);
    render();
  });
