import { checkAuth, signInWithGoogle } from "../lib/auth.js";
import { setPopupIntent } from "../lib/checkout.js";
import { claimQuest, errorMessage, getForest, getLeaderboard, getQuests, plantTrees } from "../lib/quests-api.js";
import { icons } from "../ui/art.js";
import { acornChip, escape, logo } from "../ui/components.js";
import { sampleForest, sampleLeaderboard, sampleQuests } from "./sample.js";

const app = document.getElementById("app");

const state = {
  session: null,
  loading: true,
  sample: false,      // showing sample data instead of the user's
  notice: "",         // why we're showing sample data
  quests: null,       // { week_start, quests: [...] }
  forest: null,
  board: null,
  busy: false,
  toast: "",
};

// ---------- helpers ----------

const QUEST_ICONS = { talk: icons.wave, follow: icons.check, pause: icons.clock, kept: icons.wallet };

const money = (n) => `$${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tree(filled, index) {
  const shade = ["#2f4f3e", "#3d6a52", "#4f7d5f"][index % 3];
  return filled
    ? `<svg class="tree" viewBox="0 0 40 48" aria-hidden="true">
         <rect x="17" y="34" width="6" height="11" rx="2" fill="#8a5a2b"/>
         <circle cx="20" cy="20" r="14" fill="${shade}"/>
         <circle cx="12" cy="27" r="9" fill="${shade}"/>
         <circle cx="28" cy="27" r="9" fill="${shade}"/>
         <circle cx="16" cy="14" r="4" fill="#ffffff" opacity="0.12"/>
       </svg>`
    : `<svg class="tree empty" viewBox="0 0 40 48" aria-hidden="true">
         <ellipse cx="20" cy="42" rx="9" ry="3" fill="#e2dccb"/>
         <path d="M20 41v-8M20 35c-3-1-5-3-5-6 3 0 5 2 5 6zM20 33c0-3 2-5 5-5 0 3-2 5-5 5z" stroke="#b9b29c" stroke-width="1.6" fill="none" stroke-linecap="round"/>
       </svg>`;
}

function notify(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 2800);
}

// ---------- sections ----------

function header() {
  return `
    <header class="quests-topbar">
      <a class="brand" href="${chrome.runtime.getURL("dashboard/index.html")}" aria-label="Nook home">${logo()}</a>
      <nav class="page-nav" aria-label="Nook pages">
        <a href="${chrome.runtime.getURL("dashboard/index.html")}">${icons.chart(16)}<span>Your impact</span></a>
        <a href="${chrome.runtime.getURL("avatar/index.html")}">${icons.sparkle(16)}<span>Avatar</span></a>
        <a class="active" href="${chrome.runtime.getURL("quests/index.html")}">${icons.leaf(16)}<span>Quests</span></a>
        <button data-action="open-talk">${icons.wave(16)}<span>Talk to Pip</span></button>
      </nav>
      <div class="top-balance">${acornChip(state.forest?.acorn_balance ?? 0)}</div>
    </header>`;
}

function sampleBanner() {
  if (!state.sample) return "";
  return `
    <div class="sample-banner" role="note">
      <span class="sample-tag">Sample</span>
      <span>${escape(state.notice)}</span>
      ${state.session ? `<button class="btn-pill" data-action="retry">Try again</button>`
                      : `<button class="btn-pill" data-action="google">${icons.google()}<span>Sign in</span></button>`}
    </div>`;
}

function progressText(q) {
  return q.quest_type === "kept"
    ? `${money(q.progress)} / ${money(q.target)}`
    : `${q.progress} / ${q.target}`;
}

function questCard(q) {
  const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
  const icon = (QUEST_ICONS[q.quest_type] ?? icons.sparkle)(18);
  const action =
    q.status === "claimed"
      ? `<span class="quest-done">${icons.check(15)}<span>Claimed</span></span>`
      : q.claimable
        ? `<button class="btn btn-primary quest-claim" data-claim="${escape(q.id)}" ${state.busy ? "disabled" : ""}>Claim</button>`
        : `<span class="quest-wip">In progress</span>`;
  return `
    <article class="quest ${q.status === "claimed" ? "is-claimed" : ""} ${q.claimable ? "is-ready" : ""}">
      <div class="quest-icon">${icon}</div>
      <div class="quest-body">
        <div class="quest-head">
          <h3>${escape(q.title)}</h3>
          <span class="quest-level">Level ${q.level}</span>
        </div>
        <p class="muted">${escape(q.hint)}</p>
        <div class="quest-track" role="progressbar" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.progress}">
          <span style="width:${pct}%"></span>
        </div>
        <div class="quest-foot">
          <span class="quest-progress">${progressText(q)}</span>
          <span class="quest-reward">${icons.acorn(14)}<span>+${q.reward_acorns} acorns · +${q.reward_acorns} XP</span></span>
          ${action}
        </div>
      </div>
    </article>`;
}

function questsCard() {
  const quests = state.quests?.quests ?? [];
  const done = quests.filter((q) => q.status === "claimed").length;
  return `
    <section class="card quests-card" aria-labelledby="quests-title">
      <div class="card-head">
        <div>
          <p class="eyebrow">This week</p>
          <h2 id="quests-title">Your personal quests</h2>
        </div>
        <span class="pill">${done} / ${quests.length} done · resets Monday</span>
      </div>
      <div class="quest-list">${quests.map(questCard).join("")}</div>
    </section>`;
}

function forestCard() {
  const f = state.forest;
  const slots = Array.from({ length: f.trees_per_forest }, (_, i) => tree(i < f.trees_in_current_forest, i)).join("");
  const canPlant = f.acorn_balance >= f.tree_cost;
  const short = f.tree_cost - f.acorn_balance;
  return `
    <section class="card forest-card" aria-labelledby="forest-title">
      <div class="card-head">
        <div>
          <p class="eyebrow">Your forest</p>
          <h2 id="forest-title">${f.trees_in_current_forest} / ${f.trees_per_forest} trees</h2>
        </div>
        <span class="pill pill-gold">${money(f.dollars_pledged)} pledged</span>
      </div>
      <div class="forest-grid" aria-label="${plural(f.trees_in_current_forest, "tree")} planted in this forest">${slots}</div>
      <div class="forest-stats">
        <div><strong>${f.trees}</strong><span>trees planted</span></div>
        <div><strong>${f.forests}</strong><span>forests completed</span></div>
        <div><strong>${money(f.dollars_pledged)}</strong><span>donated</span></div>
      </div>
      <button class="btn btn-primary plant-btn" data-action="plant" ${canPlant && !state.busy ? "" : "disabled"}>
        ${icons.sprout(16)}<span>Plant a tree · ${f.tree_cost}</span>${icons.acorn(14)}
      </button>
      <p class="fine">${canPlant
        ? `Every ${f.trees_per_forest} trees completes a forest: a ${money(f.dollars_per_forest)} donation.`
        : `${short} more acorns to plant your next tree.`}</p>
    </section>`;
}

function leaderboardRow(r) {
  return `
    <tr class="${r.is_you ? "is-you" : ""}">
      <td class="rank">${r.rank}</td>
      <td>${escape(r.is_you && !state.sample ? `${r.display_name} (you)` : r.display_name)}</td>
      <td class="num">${r.trees}</td>
      <td class="num">${r.forests}</td>
    </tr>`;
}

function leaderboardCard() {
  const b = state.board;
  const rows = [...b.top];
  if (b.you && !rows.some((r) => r.is_you)) rows.push(b.you);
  const body = rows.length
    ? rows.map(leaderboardRow).join("")
    : `<tr><td colspan="4" class="empty-row">No trees yet. Plant the first one!</td></tr>`;
  return `
    <section class="card board-card" aria-labelledby="board-title">
      <div class="card-head">
        <div>
          <p class="eyebrow">Leaderboard</p>
          <h2 id="board-title">Top forest growers</h2>
        </div>
        <span class="pill">Ranked by trees planted</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Name</th><th class="num">Trees planted</th><th class="num">Forests completed</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function page() {
  return `
    ${header()}
    <main class="quests-page">
      <div class="page-intro">
        <div>
          <p class="eyebrow">Quests &amp; forest</p>
          <h1>Small wins. <em>Real trees.</em></h1>
          <p class="muted">Finish quests to earn acorns, then plant them into a forest that turns into a real donation.</p>
        </div>
      </div>
      ${sampleBanner()}
      <div class="top-grid">${questsCard()}${forestCard()}</div>
      ${leaderboardCard()}
    </main>
    ${state.toast ? `<div class="toast" role="status">${escape(state.toast)}</div>` : ""}`;
}

function render() {
  if (state.loading) {
    app.innerHTML = `<main class="quests-loading"><div class="spinner" aria-label="Loading"></div><p>Loading your quests…</p></main>`;
    return;
  }
  app.innerHTML = page();
}

// ---------- data ----------

function useSample(notice) {
  state.sample = true;
  state.notice = notice;
  state.quests = sampleQuests();
  state.forest = sampleForest();
  state.board = sampleLeaderboard();
}

async function load() {
  state.loading = true;
  render();
  if (!state.session) {
    useSample("You're seeing an example. Sign in to start your own quests and forest.");
  } else {
    try {
      const [quests, forest] = await Promise.all([getQuests(), getForest()]);
      const board = await getLeaderboard(); // after getForest, which saves your leaderboard name
      Object.assign(state, { quests, forest, board, sample: false, notice: "" });
    } catch (error) {
      console.error(error);
      useSample(`Couldn't load your quests (${errorMessage(error)}). Showing an example.`);
    }
  }
  state.loading = false;
  render();
}

async function claim(questId) {
  const quest = state.quests.quests.find((q) => q.id === questId);
  if (!quest) return;
  if (state.sample) {
    quest.status = "claimed";
    quest.claimable = false;
    state.forest.acorn_balance += quest.reward_acorns;
    notify(`+${quest.reward_acorns} acorns (sample only)`);
    return;
  }
  state.busy = true;
  render();
  try {
    const result = await claimQuest(questId);
    state.quests = { week_start: result.week_start, quests: result.quests };
    state.forest = await getForest();
    notify(`+${result.result.reward_acorns} acorns and XP!`);
  } catch (error) {
    notify(errorMessage(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function plant() {
  const f = state.forest;
  if (f.acorn_balance < f.tree_cost) return;
  if (state.sample) {
    f.acorn_balance -= f.tree_cost;
    f.trees += 1;
    f.forests = Math.floor(f.trees / f.trees_per_forest);
    f.trees_in_current_forest = f.trees % f.trees_per_forest;
    f.dollars_pledged = f.forests * f.dollars_per_forest;
    const you = state.board.top.find((r) => r.is_you);
    if (you) Object.assign(you, { trees: f.trees, forests: f.forests });
    notify("Tree planted (sample only)");
    return;
  }
  state.busy = true;
  render();
  try {
    state.forest = await plantTrees(1);
    state.board = await getLeaderboard();
    notify(state.forest.trees_in_current_forest === 0
      ? `Forest complete! That's ${money(state.forest.dollars_per_forest)} pledged. 🌲`
      : "Tree planted! 🌱");
  } catch (error) {
    notify(errorMessage(error));
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- events ----------

app.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.claim) return claim(button.dataset.claim);

  switch (button.dataset.action) {
    case "plant":
      return plant();
    case "retry":
      return load();
    case "google":
      try {
        state.session = await signInWithGoogle();
        return load();
      } catch (error) {
        return notify(errorMessage(error));
      }
    case "open-talk":
      await setPopupIntent("talk");
      try {
        await chrome.action.openPopup();
      } catch {
        notify("Click the Nook icon in your toolbar to talk with Pip.");
      }
  }
});

checkAuth()
  .then((session) => {
    state.session = session;
  })
  .catch((error) => console.error(error))
  .finally(load);
