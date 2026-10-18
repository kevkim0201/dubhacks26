// Pip's onboarding interview: a few quick questions about how the user shops.
// Answers are saved to profiles.personalization via POST /api/onboarding.
import { checkAuth, signInWithGoogle } from "../lib/auth.js";
import { getOnboarding, onboardingFromConversation, saveOnboarding, skipOnboarding } from "../lib/onboarding-api.js";
import { startOnboardingVoiceSession } from "../lib/onboarding-voice.js";
import { icons, squirrel } from "../ui/art.js";
import { startPipMotion } from "../ui/pip-motion.js";
import { escape, logo } from "../ui/components.js";

const app = document.getElementById("app");

// ---------- the interview ----------

const CATEGORIES = [
  ["electronics", "📱 Electronics"], ["clothing", "👕 Clothing"], ["shoes", "👟 Shoes"], ["beauty", "💄 Beauty"],
  ["home", "🛋️ Home"], ["kitchen", "🍳 Kitchen"], ["food", "🍜 Food & takeout"], ["health", "💊 Health"],
  ["sports", "🏀 Sports"], ["outdoors", "🏕️ Outdoors"], ["toys", "🧸 Toys & hobbies"], ["books", "📚 Books"],
  ["entertainment", "🎮 Games & entertainment"], ["travel", "✈️ Travel"], ["office", "🖇️ Office & school"],
  ["pets", "🐶 Pets"], ["jewelry", "💍 Jewelry & accessories"], ["automotive", "🚗 Car"], ["other", "🌀 Something else"],
];

const STEPS = [
  {
    key: "spend_categories", type: "multi", max: 8,
    ask: "What do you tend to overspend on?",
    hint: "Pick any that sound like you.",
    options: CATEGORIES,
    react: (v) => (v.length ? `${v.length > 3 ? "Ooh, a well-rounded shopper." : "Got it."} I'll keep an extra eye on those.` : "No worries, we'll figure it out together."),
  },
  {
    key: "impulse_triggers", type: "multi", max: 8,
    ask: "When do impulse buys usually sneak up on you?",
    options: [
      ["late_night", "🌙 Late at night"], ["stress", "😮‍💨 When I'm stressed"], ["boredom", "🥱 When I'm bored"],
      ["sales", "🏷️ Sales and deals"], ["social_media", "📲 Scrolling social media"], ["payday", "💸 Right after payday"],
      ["with_friends", "👯 Shopping with friends"], ["other", "🤷 Other times"],
    ],
    react: (v) => (v.includes("late_night") ? "Ah, the midnight cart. I know it well." : v.includes("sales") ? "Sales are sneaky! I'll help you check if it's really a deal." : "Thanks for being honest. That really helps."),
  },
  {
    key: "goals", type: "multi", max: 6,
    ask: "What would you like my help with?",
    options: [
      ["fewer_impulse_buys", "🛑 Fewer impulse buys"], ["save_for_goal", "🎯 Save up for something"],
      ["stick_to_budget", "📊 Stick to a budget"], ["better_deals", "🔎 Find better deals"],
      ["think_before_big_buys", "🤔 Think before big purchases"], ["pay_off_debt", "💳 Pay off debt"],
    ],
    react: () => "I'm on it. Little pauses add up!",
  },
  {
    key: "savings_goal", type: "goal", optional: true,
    ask: "Are you saving up for anything right now?",
    hint: "Totally optional. I'll cheer you on.",
    react: (v) => (v ? `${escape(v.name)}! Let's get you there.` : "That's fine. We can set one later."),
  },
  {
    key: "monthly_budget", type: "money", optional: true,
    ask: "Is there a monthly amount you'd like to keep shopping under?",
    hint: "Also optional. Just a number to keep in mind.",
    react: (v) => (v ? "Noted. I'll remember that when you're at checkout." : "No budget? No problem."),
  },
  {
    key: "coaching_style", type: "single",
    ask: "When you're about to splurge, how should I talk to you?",
    options: [
      ["gentle", "🌸 Gentle nudges", "Kind reminders, no pressure"],
      ["balanced", "🐿️ Honest friend", "Friendly, but I'll be real with you"],
      ["tough_love", "🔥 Tough love", "Call me out. I can take it."],
    ],
    react: (v) => ({ gentle: "Gentle it is. I'll be soft as a tail.", balanced: "Honest and friendly, my favorite.", tough_love: "Ooh, tough love. Your wallet won't know what hit it." })[v],
  },
  {
    key: "notes", type: "text", optional: true,
    ask: "Anything else I should know about how you shop?",
    hint: "For example: \"I always buy gadgets I don't use.\"",
    react: () => "Thank you for telling me!",
  },
];

const state = {
  session: null,
  mode: "voice", // "voice" interview with Pip, or "type" (tap through the questions)
  call: null, // live voice interview, see startVoice()
  step: -1, // -1 intro, 0..n-1 typed questions, n summary (both modes end there)
  answers: { spend_categories: [], impulse_triggers: [], goals: [], savings_goal: null, monthly_budget: null, coaching_style: "balanced", notes: "" },
  persona: null, // Gemini's summary of the user, from the voice interview
  source: "typed",
  summarizing: false,
  reaction: null,
  alreadyDone: false,
  saving: false,
  saved: false,
  error: null,
};

// ---------- rendering ----------

function bubble(text, sub = "") {
  return `
    <div class="pip-row">
      <div class="pip-art">${squirrel()}</div>
      <div class="bubble" role="status"><p>${text}</p>${sub ? `<span>${sub}</span>` : ""}</div>
    </div>`;
}

function progress() {
  const pct = Math.round((Math.max(0, state.step) / STEPS.length) * 100);
  return `<div class="ob-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemax="100"><div style="width:${pct}%"></div></div>`;
}

function stepView(step) {
  const value = state.answers[step.key];
  let body = "";
  if (step.type === "multi" || step.type === "single") {
    body = `<div class="choices ${step.type === "single" ? "choices-single" : ""}" role="group" aria-label="${escape(step.ask)}">
      ${step.options
        .map(([id, label, desc]) => {
          const on = step.type === "multi" ? value.includes(id) : value === id;
          return `<button class="choice-chip ${on ? "on" : ""}" data-action="pick" data-id="${id}" aria-pressed="${on}">
            <span>${label}</span>${desc ? `<small>${desc}</small>` : ""}</button>`;
        })
        .join("")}
    </div>`;
  } else if (step.type === "goal") {
    body = `<div class="fields">
      <label><span>What for?</span><input id="goal-name" maxlength="80" placeholder="A trip to Japan, a new laptop…" value="${escape(value?.name ?? "")}" /></label>
      <label><span>How much? (optional)</span><input id="goal-amount" type="number" min="1" step="1" placeholder="1500" value="${value?.amount ?? ""}" /></label>
    </div>`;
  } else if (step.type === "money") {
    body = `<div class="fields"><label><span>Per month</span><div class="money"><span>$</span><input id="budget" type="number" min="1" step="1" placeholder="300" value="${value ?? ""}" /></div></label></div>`;
  } else if (step.type === "text") {
    body = `<div class="fields"><label><span>Your note</span><textarea id="notes" maxlength="500" rows="4" placeholder="${escape(step.hint ?? "")}">${escape(value)}</textarea></label></div>`;
  }
  const last = state.step === STEPS.length - 1;
  return `
    ${progress()}
    ${bubble(state.reaction ? `${state.reaction}<br/>${escape(step.ask)}` : escape(step.ask), step.hint && step.type !== "text" ? escape(step.hint) : "")}
    ${body}
    <div class="ob-nav">
      <button class="btn btn-outline" data-action="back">${icons.arrow(14)}<span>Back</span></button>
      <button class="btn btn-primary" data-action="next">${last ? "Review" : step.type === "multi" && isEmpty(step) ? "Skip" : "Next"}</button>
    </div>`;
}

const label = (step, id) => (STEPS.find((s) => s.key === step).options.find((o) => o[0] === id) ?? [id, id])[1];

function summaryView() {
  const a = state.answers;
  const list = (key) => (a[key].length ? a[key].map((id) => `<span class="tag">${label(key, id)}</span>`).join("") : `<span class="muted">Nothing picked</span>`);
  const money = (n) => (n ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "");
  const row = (title, html, step) => `<div class="sum-row"><div><strong>${title}</strong><div class="sum-val">${html}</div></div>
    <button class="link-btn" data-action="edit" data-step="${step}">Edit</button></div>`;
  if (state.summarizing) {
    return `${progress()}${bubble("Give me a sec, I'm writing down what you told me…")}
      <div class="summarizing"><span class="deal-spinner"></span><span>Pip is summarizing your chat</span></div>`;
  }
  const persona = state.persona;
  return `
    ${progress()}
    ${bubble(state.saved ? "All set! Here's what I'll remember about you. You can tweak anything. 🐿️" : "Here's what I learned about you. Look right?")}
    ${
      persona?.summary
        ? `<div class="persona">
            ${persona.shopper_type ? `<span class="persona-type">${icons.sparkle(12)} ${escape(persona.shopper_type)}</span>` : ""}
            <p>${escape(persona.summary)}</p>
            ${persona.tips_for_pip?.length ? `<ul>${persona.tips_for_pip.map((t) => `<li>${escape(t)}</li>`).join("")}</ul>` : ""}
          </div>`
        : ""
    }
    <div class="summary">
      ${row("Overspends on", list("spend_categories"), 0)}
      ${row("Impulse buys happen", list("impulse_triggers"), 1)}
      ${row("Wants help with", list("goals"), 2)}
      ${row("Saving for", a.savings_goal ? `${escape(a.savings_goal.name)}${a.savings_goal.amount ? ` · ${money(a.savings_goal.amount)}` : ""}` : `<span class="muted">Nothing yet</span>`, 3)}
      ${row("Monthly limit", a.monthly_budget ? `${money(a.monthly_budget)} / month` : `<span class="muted">No limit</span>`, 4)}
      ${row("Coaching style", label("coaching_style", a.coaching_style), 5)}
      ${row("Notes", a.notes ? escape(a.notes) : `<span class="muted">None</span>`, 6)}
    </div>
    ${state.error ? `<p class="error" role="alert">${escape(state.error)}</p>` : ""}
    <div class="ob-nav">
      ${
        state.saved && !state.dirty
          ? `<button class="btn btn-primary wide" data-action="close">${icons.check(16)}<span>Done</span></button>`
          : `<button class="btn btn-outline" data-action="back">${icons.arrow(14)}<span>Back</span></button>
             <button class="btn btn-primary" data-action="save" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving…" : state.saved ? "Save changes" : "Save"}</button>`
      }
    </div>`;
}

function introView() {
  return `
    ${bubble(
      state.alreadyDone
        ? "Welcome back! Want to chat again so I can update what I know about how you shop?"
        : "Hi, I'm Pip! 🐿️ Can we chat for a minute about how you shop? Then I can help in the way that works for you.",
      "Just talk like you would to a friend. You can skip anything."
    )}
    ${state.error ? `<p class="error" role="alert">${escape(state.error)}</p>` : ""}
    <div class="ob-nav ob-nav-intro">
      <button class="btn btn-primary wide" data-action="voice">${icons.mic(16)}<span>${state.alreadyDone ? "Talk to Pip again" : "Talk to Pip"}</span></button>
      <div class="ob-alt">
        <button class="link-btn" data-action="start">Prefer to type? Answer a few quick questions</button>
        <button class="link-btn muted-link" data-action="later">${state.alreadyDone ? "Keep my answers" : "Maybe later"}</button>
      </div>
    </div>`;
}

// ---------- voice interview ----------

const STATUS_TEXT = {
  mic: "Checking your microphone…",
  connecting: "Connecting with Pip…",
  retrying: "Still connecting… trying another way",
};

const FIELD_LABEL = {
  spend_categories: "Overspends on",
  impulse_triggers: "Impulse buys happen",
  goals: "Wants help with",
  savings_goal: "Saving for",
  monthly_budget: "Monthly limit",
  coaching_style: "Coaching style",
  notes: "Notes",
};

function learnedValue(key, value) {
  if (Array.isArray(value)) return value.map((id) => `<span class="tag">${label(key, id)}</span>`).join("");
  if (key === "coaching_style") return `<span class="tag">${label(key, value)}</span>`;
  if (key === "savings_goal") return value ? `${escape(value.name)}${value.amount ? ` · $${Number(value.amount).toLocaleString()}` : ""}` : "";
  if (key === "monthly_budget") return value ? `$${Number(value).toLocaleString()} / month` : "";
  return escape(String(value ?? ""));
}

function voiceView() {
  const c = state.call;
  const live = c.status === "live";
  const learned = Object.entries(FIELD_LABEL).filter(([k]) => c.learned[k] != null && !(Array.isArray(c.learned[k]) && !c.learned[k].length));
  const status = !live ? STATUS_TEXT[c.status] ?? "Connecting with Pip…" : !c.micOn ? "Microphone muted" : c.mode === "speaking" ? "Pip is talking…" : "Listening…";
  return `
    ${c.preview ? `<p class="preview-note">${icons.info(13)} Preview: the onboarding voice agent isn't connected yet, so this is a scripted demo.</p>` : ""}
    <div class="call">
      <div class="call-stage">
        <div class="art pip-stage call-pip" data-pip-mood="${c.mood}">
          ${squirrel()}
          <div class="think-bubble" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
        <p class="call-status ${live ? "" : "is-connecting"}" aria-live="polite">${escape(status)}</p>
        <div class="call-controls">
          <button class="btn-round ${c.micOn ? "" : "off"}" data-action="toggle-mic" aria-label="${c.micOn ? "Mute" : "Unmute"} microphone" ${live ? "" : "disabled"}>${icons.mic(18)}</button>
          <button class="btn btn-primary btn-inline" data-action="end-voice">${icons.stop(14)}<span>${live ? "I'm done" : "Cancel"}</span></button>
        </div>
      </div>
      <div class="call-side">
        <div class="transcript" id="transcript" aria-live="polite">
          ${c.transcript.length ? c.transcript.map((m, i) => `<p class="msg msg-${m.role} ${i >= c.shownMsgs ? "is-new" : ""}">${escape(m.text)}</p>`).join("") : `<p class="muted transcript-empty">Your conversation will show up here.</p>`}
        </div>
        <div class="learned">
          <p class="learned-title">${icons.sparkle(12)} What Pip learned</p>
          ${
            learned.length
              ? learned.map(([k, l]) => `<div class="learned-row ${c.shownLearned.has(k) ? "" : "is-new"}"><span>${l}</span><div>${learnedValue(k, c.learned[k])}</div></div>`).join("")
              : `<p class="muted learned-empty">Nothing yet. Pip is all ears.</p>`
          }
        </div>
      </div>
    </div>`;
}

async function startVoice() {
  state.mode = "voice";
  state.error = null;
  state.call = {
    status: "connecting", mode: "listening", micOn: true, transcript: [], learned: {}, mood: "thinking",
    session: null, preview: false, shownMsgs: 0, shownLearned: new Set(), // only new items animate in
  };
  render();
  const call = state.call;
  const firstName = (state.session?.user?.user_metadata?.full_name ?? "").split(" ")[0] || undefined;
  try {
    call.session = await startOnboardingVoiceSession(
      { firstName },
      {
        onStatus: (s) => { call.status = s; render(); },
        onModeChange: (m) => { call.mode = m; },
        onTranscript: (entry) => { call.transcript.push(entry); render(); scrollTranscript(); },
        onLearned: (partial) => { Object.assign(call.learned, partial); render(); },
        onEnd: ({ personalization, transcript }) => finishVoice(personalization, transcript),
        onError: (err) => console.warn("[onboarding voice]", err),
      }
    );
    call.preview = call.session.preview;
    render();
    stopMotion = startPipMotion(
      () => (state.call === call ? document.querySelector(".call-pip") : null),
      () => ({
        speaking: call.mode === "speaking",
        listening: call.mode === "listening",
        micOn: call.micOn,
        connecting: call.status !== "live",
        outputVolume: call.session?.conversation?.getOutputVolume?.() ?? null,
        inputVolume: call.session?.conversation?.getInputVolume?.() ?? null,
      }),
      (mood) => (call.mood = mood)
    );
  } catch (err) {
    state.call = null;
    state.error = /permission|microphone/i.test(String(err?.message))
      ? "I need your microphone for this. Allow it in Chrome, or type your answers instead."
      : `I couldn't start our chat: ${err?.message ?? err}`;
    state.step = -1;
    render();
  }
}

let stopMotion = null;

// Gemini reads the conversation and saves the answers + a persona; then the user reviews them.
async function summarize(lines, fallback) {
  state.summarizing = true;
  state.error = null;
  state.step = STEPS.length;
  render();
  try {
    const saved = await onboardingFromConversation(lines);
    const p = saved.personalization ?? {};
    for (const key of Object.keys(state.answers)) if (p[key] != null) state.answers[key] = p[key];
    state.persona = p.persona ?? null;
    state.source = "voice";
    state.saved = true; // already stored; "Save changes" re-saves edits
  } catch (err) {
    console.warn("Persona summary failed:", err);
    for (const key of Object.keys(state.answers)) if (fallback[key] != null) state.answers[key] = fallback[key];
    state.error = `I couldn't summarize our chat (${err?.message ?? err}). Check your answers below and save them.`;
  }
  state.summarizing = false;
  render();
}

function scrollTranscript() {
  const el = document.getElementById("transcript");
  if (el) el.scrollTop = el.scrollHeight;
}

// The call is over (Pip ended it, or the user did): review what Pip learned, then save.
function finishVoice(personalization, transcript = null) {
  const call = state.call;
  if (!call || call.finished) return;
  call.finished = true;
  stopMotion?.();
  const lines = transcript?.length ? transcript : call.transcript;
  if (!call.preview && lines.some((l) => l.role === "user")) {
    state.call = null;
    return summarize(lines, { ...call.learned, ...(personalization ?? {}) });
  }
  const learned = { ...call.learned, ...(personalization ?? {}) };
  state.call = null;
  if (!Object.keys(learned).length) {
    // Ended before Pip learned anything: back to the start, nothing to review.
    state.step = -1;
    return render();
  }
  for (const key of Object.keys(state.answers)) if (learned[key] != null) state.answers[key] = learned[key];
  state.step = STEPS.length; // the summary screen; every answer can still be edited there
  render();
}

function render() {
  let main;
  if (!state.session) {
    main = `${bubble("Sign in first so I can remember your answers.")}
      <div class="ob-nav"><button class="btn btn-outline wide" data-action="google">${icons.google()}<span>Continue with Google</span></button></div>
      ${state.error ? `<p class="error">${escape(state.error)}</p>` : ""}`;
  } else if (state.call) {
    main = voiceView();
    state.call.shownMsgs = state.call.transcript.length;
    for (const k of Object.keys(state.call.learned)) state.call.shownLearned.add(k);
  }
  else if (state.step < 0) main = introView();
  else if (state.step >= STEPS.length) main = summaryView();
  else main = stepView(STEPS[state.step]);

  app.innerHTML = `
    <header class="ob-top">${logo()}<span class="tagline">Getting to know you</span></header>
    <main class="ob-card ${state.call ? "is-call" : ""}">${main}</main>`;
  if (!state.call) app.querySelector("input, textarea")?.focus();
  scrollTranscript();
}

// ---------- behaviour ----------

function isEmpty(step) {
  const v = state.answers[step.key];
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Reads typed fields into answers (chips update answers directly).
function collect(step) {
  if (step.type === "goal") {
    const name = document.getElementById("goal-name")?.value.trim();
    const amount = Number(document.getElementById("goal-amount")?.value);
    state.answers.savings_goal = name ? { name: name.slice(0, 80), amount: amount > 0 ? amount : null } : null;
  } else if (step.type === "money") {
    const n = Number(document.getElementById("budget")?.value);
    state.answers.monthly_budget = n > 0 ? n : null;
  } else if (step.type === "text") {
    state.answers.notes = (document.getElementById("notes")?.value ?? "").slice(0, 500);
  }
}

function close() {
  window.close(); // works when the popup opened this tab
  setTimeout(() => (location.href = chrome.runtime.getURL("dashboard/index.html")), 150);
}

const actions = {
  voice: startVoice,
  "toggle-mic"() {
    const call = state.call;
    if (!call) return;
    call.micOn = !call.micOn;
    call.session?.setMuted?.(!call.micOn);
    render();
  },
  async "end-voice"() {
    const call = state.call;
    if (!call) return;
    if (call.session) await call.session.stop().catch(() => {});
    // Cancelled before connecting, or the agent never reported back.
    if (state.call === call) finishVoice(null);
  },
  start() {
    state.mode = "type";
    state.source = "typed";
    state.step = 0;
    state.reaction = null;
    render();
  },
  async later() {
    if (!state.alreadyDone) await skipOnboarding().catch((e) => console.warn("skip failed", e));
    close();
  },
  pick(button) {
    const step = STEPS[state.step];
    const id = button.dataset.id;
    if (step.type === "single") state.answers[step.key] = id;
    else {
      const list = state.answers[step.key];
      state.answers[step.key] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, step.max);
    }
    render();
  },
  next() {
    const step = STEPS[state.step];
    collect(step);
    state.reaction = step.react?.(state.answers[step.key]) ?? null;
    state.step += 1;
    render();
  },
  back() {
    if (state.step < STEPS.length) collect(STEPS[state.step]);
    state.step -= 1;
    state.reaction = null;
    render();
  },
  edit(button) {
    state.dirty = true;
    state.step = Number(button.dataset.step);
    state.reaction = null;
    render();
  },
  async save() {
    state.saving = true;
    state.error = null;
    render();
    try {
      await saveOnboarding({ ...state.answers, ...(state.persona ? { persona: state.persona } : {}), source: state.source });
      state.saved = true;
      state.dirty = false;
    } catch (err) {
      state.error = `I couldn't save that: ${err?.message ?? err}`;
    }
    state.saving = false;
    render();
  },
  close,
  async google() {
    try {
      state.session = await signInWithGoogle();
      await start();
    } catch (err) {
      state.error = err?.message ?? String(err);
      render();
    }
  },
};

app.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled) return;
  actions[button.dataset.action]?.(button);
});

// Enter moves on from typed fields (not from the notes box).
app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input")) actions.next();
});

async function start() {
  try {
    const current = await getOnboarding();
    state.alreadyDone = !current.needs_onboarding;
    const saved = current.personalization ?? {};
    if (!saved.skipped) {
      for (const key of Object.keys(state.answers)) if (saved[key] != null) state.answers[key] = saved[key];
      state.persona = saved.persona ?? null;
      state.source = saved.source ?? "typed";
    }
  } catch (err) {
    state.error = `I couldn't load your profile: ${err?.message ?? err}`;
  }
  render();
}

checkAuth()
  .then(async (session) => {
    state.session = session;
    if (session) await start();
    else render();
  })
  .catch((err) => {
    state.error = err?.message ?? String(err);
    render();
  });
