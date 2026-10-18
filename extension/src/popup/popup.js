import { checkAuth, signInWithGoogle, signOut } from "../lib/auth.js";
import { getActiveTabCheckout, takePopupIntent } from "../lib/checkout.js";
import { applyConversation, loadProgress } from "../lib/progress.js";
import { icons, squirrel } from "../ui/art.js";
import { acornChip, cartCard, escape, logo, navBar, progressCard } from "../ui/components.js";

const app = document.getElementById("app");

const state = {
  screen: "loading", // loading | welcome | talk | conversation | rewards | companion
  session: null,
  progress: null,
  checkout: null, // cart the content script spotted in the active tab
  error: null,
  busy: false,
  // conversation
  startedAt: 0,
  micOn: true,
  timer: null,
  // set when a conversation ends
  result: null,
  recommendation: null, // e.g. "Wait 24 hours" / "Go for it", from the voice agent
};

const hasScarf = () => state.progress?.unlocked.includes("scarf");

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const elapsedSeconds = () => Math.floor((Date.now() - state.startedAt) / 1000);

// ---------- shared pieces ----------

function header({ tagline } = {}) {
  const right = tagline ? `<span class="tagline">${tagline}</span>` : acornChip(state.progress?.acorns);
  return `<header class="topbar">${logo()}${right}</header>`;
}

const errorBox = () => (state.error ? `<p class="error" role="alert">${escape(state.error)}</p>` : "");

// ---------- screens ----------

const screens = {
  loading: () => `
    ${header({ tagline: "Shop with intention" })}
    <main class="screen center">
      <div class="art">${squirrel()}</div>
      <div class="spinner" aria-hidden="true"></div>
      <p class="muted">Checking in…</p>
    </main>`,

  welcome: () => `
    ${header({ tagline: "Shop with intention" })}
    <main class="screen welcome">
      <span class="pill">${icons.sprout(13)} Pause. Talk. Decide.</span>
      <div class="art">${squirrel()}</div>
      <h1 class="title-lg">Pause before<br />you purchase.</h1>
      <p class="muted center-text lede">Meet Pip, your squirrel voice agent. Make your case at checkout—or let Pip help you skip an impulse buy.</p>
      <button class="btn btn-outline" data-action="google" ${state.busy ? "disabled" : ""}>
        ${icons.google()}<span>${state.busy ? "Opening Google…" : "Continue with Google"}</span>
      </button>
      ${errorBox()}
      <p class="fine">${icons.lock(12)} Sign in to save your squirrel's progress.</p>
      <p class="fine">By continuing, you agree to our Terms &amp; Privacy Policy.</p>
    </main>`,

  talk: () =>
    state.checkout
      ? `
    ${header()}
    <main class="screen">
      <h1 class="title">Pip noticed a checkout.</h1>
      <p class="muted sub">Make your case before you buy.</p>
      ${cartCard(state.checkout)}
      <div class="art art-sm">${squirrel({ scarf: hasScarf() })}</div>
      ${progressCard(state.progress)}
      <button class="btn btn-primary" data-action="start">${icons.mic(16)}<span>Talk to Pip</span></button>
      <p class="fine">${icons.headphones(12)} Tell Pip why this purchase matters.</p>
    </main>
    ${navBar("talk")}`
      : `
    ${header()}
    <main class="screen">
      <h1 class="title">No checkout yet.</h1>
      <p class="muted sub">Pip will pop up when you reach a checkout page.</p>
      <div class="empty-cart">${icons.bag(18)}<span>Shopping for something? Talk it through before you head to checkout.</span></div>
      <div class="art art-sm">${squirrel({ scarf: hasScarf() })}</div>
      ${progressCard(state.progress)}
      <button class="btn btn-primary" data-action="start">${icons.mic(16)}<span>Talk to Pip</span></button>
      <p class="fine">${icons.headphones(12)} Tell Pip what you're thinking of buying.</p>
    </main>
    ${navBar("talk")}`,

  conversation: () => `
    ${header()}
    <main class="screen">
      <div class="session-row">
        <span><span class="dot"></span>Talk to Pip</span>
        <span id="timer">${formatTime(elapsedSeconds())}</span>
      </div>
      <div class="art">${squirrel({ scarf: hasScarf() })}</div>
      <div class="wave ${state.micOn ? "" : "paused"}" aria-hidden="true">
        ${Array.from({ length: 11 }, (_, i) => `<span style="animation-delay:${(i % 5) * 0.12}s"></span>`).join("")}
      </div>
      <h2 class="title-md">${
        !state.micOn ? "Paused." : state.checkout ? "Pip is reviewing your cart." : "Pip is listening."
      }</h2>
      <p class="quote">${
        !state.micOn
          ? "Tap the mic when you're ready to keep going."
          : state.checkout
            ? "“Why do you need this purchase today?”"
            : "“What are you thinking of buying?”"
      }</p>
      <div class="call-controls">
        <button class="btn-round ${state.micOn ? "" : "off"}" data-action="toggle-mic"
                aria-label="${state.micOn ? "Mute microphone" : "Unmute microphone"}">${icons.mic(18)}</button>
        <button class="btn btn-primary btn-inline" data-action="end">${icons.stop(14)}<span>End conversation</span></button>
      </div>
      <p class="fine">Explain your purchase · Pip may advise waiting or give you a go-ahead.</p>
    </main>`,

  rewards: () => {
    const { reward, levelUps } = state.result;
    const firstUp = levelUps[0];
    const lastUp = levelUps.at(-1);
    return `
    ${header()}
    <main class="screen">
      <h1 class="title center-text">You thought it through<br />with Pip.</h1>
      <p class="muted center-text sub">You explained your purchase and Pip gave you a thoughtful recommendation.</p>
      <div class="art art-sm">
        ${squirrel({ scarf: hasScarf(), sparkles: true })}
        ${state.recommendation ? `<span class="verdict">${icons.clock(12)} ${escape(state.recommendation)}</span>` : ""}
      </div>
      <div class="stats">
        <div class="stat">${icons.sparkle(18)}<strong>+${reward.xp}</strong><span>XP for reflection</span></div>
        <div class="stat">${icons.acorn(20)}<strong>+${reward.acorns}</strong><span>Acorns earned</span></div>
      </div>
      ${lastUp ? `
      <div class="levelup">
        ${icons.check(20)}
        <div>
          <strong>Level up! ${firstUp.from} → ${lastUp.to}</strong>
          <span>${escape(levelUps.find((u) => u.unlock)?.unlock.description ?? "Pip is growing with you.")}</span>
        </div>
      </div>` : ""}
      <button class="btn btn-primary" data-action="continue">${icons.arrow(16)}<span>Continue</span></button>
    </main>`;
  },

  companion: () => `
    ${header()}
    <main class="screen">
      <div class="title-row">
        <div>
          <h1 class="title">Meet Pip</h1>
          <p class="muted sub">Thoughtful choices help Pip grow.</p>
        </div>
        <span class="level-chip">Level ${state.progress.level}</span>
      </div>
      <div class="art">${squirrel({ scarf: hasScarf(), sparkles: true })}</div>
      ${hasScarf() ? `<p class="new-look">${icons.sparkle(12)} New look: Forest scarf</p>` : ""}
      <div class="card">${progressCard(state.progress)}</div>
      <button class="btn btn-primary" data-action="done">${icons.check(16)}<span>Done for now</span></button>
      <button class="link" data-action="sign-out">Sign out</button>
    </main>
    ${navBar("companion")}`,
};

function render() {
  app.dataset.screen = state.screen;
  app.innerHTML = screens[state.screen]();
  // Welcome renders its own error box; elsewhere show errors as a toast.
  if (state.error && state.screen !== "welcome") {
    app.insertAdjacentHTML("beforeend", `<div class="toast">${errorBox()}</div>`);
  }
}

function go(screen) {
  state.screen = screen;
  state.error = null;
  render();
}

// ---------- actions ----------

async function enterApp(session, intent) {
  state.session = session;
  [state.progress, state.checkout] = await Promise.all([
    loadProgress(session.user.id),
    getActiveTabCheckout().catch(() => null),
  ]);
  if (intent === "conversation") startConversation();
  else go(intent === "companion" ? "companion" : "talk");
}

function startConversation() {
  state.startedAt = Date.now();
  state.micOn = true;
  state.recommendation = null;
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    const el = document.getElementById("timer");
    if (el) el.textContent = formatTime(elapsedSeconds());
  }, 1000);
  // TODO: start the voice session with the backend here, passing state.checkout as context.
  go("conversation");
}

async function endConversation() {
  clearInterval(state.timer);
  // TODO: stop the voice session and set state.recommendation from the agent's verdict.
  state.result = await applyConversation(state.session.user.id, elapsedSeconds());
  state.progress = state.result.progress;
  go("rewards");
}

const actions = {
  async google() {
    state.busy = true;
    state.error = null;
    render();
    try {
      await enterApp(await signInWithGoogle());
    } catch (err) {
      console.error(err);
      state.error = err?.message ?? String(err);
    } finally {
      state.busy = false;
      if (state.screen === "welcome") render();
    }
  },
  start: startConversation,
  end: endConversation,
  "toggle-mic"() {
    state.micOn = !state.micOn;
    render();
  },
  continue: () => go("companion"),
  done: () => window.close(),
  "go-talk": () => go("talk"),
  "go-companion": () => go("companion"),
  async "sign-out"() {
    await signOut();
    state.session = null;
    state.progress = null;
    go("welcome");
  },
};

app.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled) return;
  Promise.resolve(actions[button.dataset.action]?.()).catch((err) => {
    console.error(err);
    state.error = err?.message ?? String(err);
    render();
  });
});

// ---------- startup: check auth status first ----------

render();
Promise.all([checkAuth(), takePopupIntent().catch(() => null)])
  .then(([session, intent]) => (session ? enterApp(session, intent) : go("welcome")))
  .catch((err) => {
    console.error(err);
    go("welcome");
    state.error = err?.message ?? "Couldn't check your session. Please sign in.";
    render();
  });
