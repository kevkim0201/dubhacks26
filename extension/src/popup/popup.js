import { checkAuth, signInWithGoogle, signOut } from "../lib/auth.js";
import { getActiveTabCheckout, takePopupIntent } from "../lib/checkout.js";
import { startCheckoutSession, submitCheckoutDecision } from "../lib/checkout-api.js";
import { loadCosmeticsState } from "../lib/cosmetics-api.js";
import { progressFromProfile } from "../lib/progress.js";
import { icons, setSquirrelCosmetics, squirrel } from "../ui/art.js";
import { acornChip, cartCard, escape, logo, navBar, pageMenu, progressCard } from "../ui/components.js";
import { API_BASE_URL } from "../lib/config.js";
import { apiFetch } from "../lib/api.js";
import { voiceEngine } from "../lib/voice.js";
import { startSquirrelVoiceSession } from "../lib/voiceSession.js";
import { startPipMotion } from "../ui/pip-motion.js";

const app = document.getElementById("app");

const state = {
  screen: "loading", // loading | welcome | talk | conversation | verdict | rewards | companion
  session: null,
  progress: null,
  cosmetics: null,
  checkout: null, // cart the content script spotted in the active tab
  checkoutSessionId: null,
  error: null,
  busy: false,
  // conversation
  startedAt: 0,
  micOn: true,
  timer: null,
  subtitle: "",
  userTranscript: "",
  turnCount: 0,
  speaking: false,
  listening: false,
  // set when a conversation ends
  result: null,
  recommendation: null, // e.g. "Wait 24 hours" / "Go for it", from the voice agent
  suggestion: null, // raw verdict from the backend: "buy" | "wait" | "skip"
  endedAt: 0, // when the call ended, so time on the verdict screen doesn't count as talk time
  micBlocked: false,
  grantMicStatus: null,
  activeVoiceSession: null,
  pipMood: "thinking", // live pose while talking; kept here so re-renders keep it
  stopPipMotion: null,
};

voiceEngine.onStateChange = ({ isSpeaking, isListening }) => {
  state.speaking = isSpeaking;
  state.listening = isListening;
  if (state.screen === "conversation") {
    // Update live status text and waves without losing input focus
    const waveEl = document.querySelector(".wave");
    if (waveEl) {
      waveEl.className = `wave ${state.micOn && (isSpeaking || isListening) ? "" : "paused"}`;
    }
    const statusEl = document.getElementById("conv-status-text");
    if (statusEl) {
      if (!state.micOn) {
        statusEl.className = "conversation-status paused";
        statusEl.textContent = "⏸️ Microphone muted";
      } else if (isSpeaking) {
        statusEl.className = "conversation-status speaking";
        statusEl.textContent = "🔊 Pip is speaking with Eleven Turbo…";
      } else if (isListening) {
        statusEl.className = "conversation-status";
        statusEl.textContent = "🎤 Listening… speak into your microphone";
      } else {
        statusEl.className = "conversation-status paused";
        statusEl.textContent = "Thinking…";
      }
    }
  }
};

const hasScarf = () => state.progress?.unlocked.includes("scarf");

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const elapsedSeconds = () => Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1000);

// ---------- shared pieces ----------

function header({ tagline } = {}) {
  const right = tagline
    ? `<span class="tagline">${tagline}</span>`
    : `<span class="topbar-right">${acornChip(state.progress?.acorns)}${pageMenu(state.menuOpen)}</span>`;
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
      <div class="empty-cart">${icons.bag(18)}<span>Shopping for something? Reach a checkout page or add items to your cart to talk with Pip.</span></div>
      <div class="art art-sm">${squirrel({ scarf: hasScarf() })}</div>
      ${progressCard(state.progress)}
      <button class="btn btn-primary" data-action="start" disabled>${icons.mic(16)}<span>Talk to Pip</span></button>
      <p class="fine">${icons.headphones(12)} Disabled until a checkout is detected.</p>
    </main>
    ${navBar("talk")}`,

  conversation: () => `
    ${header()}
    <main class="screen">
      <div class="session-row">
        <span><span class="dot"></span>Talk to Pip (Eleven Turbo)</span>
        <span id="timer">${formatTime(elapsedSeconds())}</span>
      </div>
      <div class="art pip-stage" data-pip-mood="${state.pipMood}">
        ${squirrel({ scarf: hasScarf() })}
        <div class="think-bubble" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>
      <div class="wave ${state.micOn && (state.speaking || state.listening) ? "" : "paused"}" aria-hidden="true">
        ${Array.from({ length: 11 }, (_, i) => `<span style="animation-delay:${(i % 5) * 0.12}s"></span>`).join("")}
      </div>
      
      <div id="conv-status-text" class="conversation-status ${state.speaking ? "speaking" : state.listening ? "" : "paused"}">
        ${
          !state.micOn
            ? "⏸️ Microphone muted"
            : state.micBlocked
              ? "⚠️ Mic permission needed"
              : state.speaking
                ? "🔊 Pip is speaking with Eleven Turbo…"
                : state.listening
                  ? "🎤 Listening… speak into your microphone"
                  : "Thinking…"
        }
      </div>

      ${
        state.micBlocked
          ? `<div style="margin: 6px 0; padding: 6px 10px; background: #fff3cd; color: #856404; border-radius: 8px; font-size: 11px; text-align: center; border: 1px solid #ffeeba;">
               Chrome requires granting mic permission once.
               <button class="btn btn-primary" data-action="grant-mic" style="margin-top: 5px; padding: 4px 10px; font-size: 11px; width: auto; display: inline-block;">Allow Mic in Tab</button>
             </div>`
          : ""
      }

      <p class="quote" id="pip-quote">${escape(state.subtitle || (state.checkout ? "“Why do you need this purchase today?”" : "“What are you thinking of buying?”"))}</p>
      
      <p id="user-transcript-live" class="muted center-text" style="font-size: 12px; margin-top: 4px; font-style: italic; min-height: 16px;">
        ${state.userTranscript ? `You: “${escape(state.userTranscript)}”` : ""}
      </p>

      ${
        state.recommendation
          ? `<div style="margin: 6px auto; text-align: center;"><span class="verdict">${icons.sparkle(12)} Pip suggests: ${escape(state.recommendation)}</span></div>`
          : ""
      }

      <form class="reply-form" id="chat-reply-form">
        <input type="text" id="chat-reply-text" class="reply-input" placeholder="Or type your reply here…" autocomplete="off" />
        <button type="submit" class="reply-btn">Send</button>
      </form>

      <div class="decision-actions">
        <button class="btn btn-outline" data-action="decide-buy">Buy it</button>
        <button class="btn btn-outline" data-action="decide-wait">Wait 24h</button>
        <button class="btn btn-primary" data-action="decide-skip">Skip purchase</button>
      </div>

      <div class="call-controls" style="padding-top: 4px;">
        <button class="btn-round ${state.micOn ? "" : "off"}" data-action="toggle-mic"
                aria-label="${state.micOn ? "Mute microphone" : "Unmute microphone"}">${icons.mic(18)}</button>
        <button class="btn btn-primary btn-inline" data-action="end">${icons.stop(14)}<span>End conversation</span></button>
      </div>
      <p class="fine">Powered by ElevenLabs Eleven Turbo · Instant voice reflection</p>
    </main>`,

  verdict: () => {
    const pick = { buy: "decide-buy", wait: "decide-wait", skip: "decide-skip" }[state.suggestion];
    const choice = (action, label, sub) => `
      <button class="choice ${pick === action ? "choice-pick" : ""}" data-action="${action}" ${state.busy ? "disabled" : ""}>
        <span><strong>${label}</strong><span class="muted">${sub}</span></span>
        ${pick === action ? `<span class="pick-tag">Pip's pick</span>` : ""}
      </button>`;
    return `
    ${header()}
    <main class="screen">
      <h1 class="title center-text">${state.recommendation ? "Pip's verdict" : "Thanks for talking it through"}</h1>
      <p class="muted center-text sub">${formatTime(elapsedSeconds())} with Pip${state.checkout?.store ? ` · ${escape(state.checkout.store)}` : ""}</p>
      <div class="art art-sm">
        ${squirrel({ scarf: hasScarf() })}
        ${state.recommendation ? `<span class="verdict">${icons.sparkle(12)} ${escape(state.recommendation)}</span>` : ""}
      </div>
      ${state.subtitle ? `<p class="quote">“${escape(state.subtitle.replace(/^[“"]|[”"]$/g, ""))}”</p>` : ""}
      <p class="choice-label">What will you do?</p>
      <div class="choices">
        ${choice("decide-buy", "Buy it", "It's worth it right now")}
        ${choice("decide-wait", "Wait 24 hours", "Sleep on it and come back")}
        ${choice("decide-skip", "Skip it", "Keep the money in your pocket")}
      </div>
      <p class="fine">You earn acorns for reflecting, whatever you choose.</p>
    </main>`;
  },

  rewards: () => {
    const { award, decision } = state.result;
    const followed = award.recommendation_matched;
    const title = { buy: "Enjoy your purchase.", save: "Saved for later.", skip: "You kept your money." }[decision];
    return `
    ${header()}
    <main class="screen">
      <h1 class="title center-text">${title}</h1>
      <p class="muted center-text sub">${escape(awardReason(award))}</p>
      <div class="art art-sm">
        ${squirrel({ scarf: hasScarf(), sparkles: award.acorns_awarded > 0 })}
        ${state.recommendation ? `<span class="verdict">${icons.clock(12)} Pip: ${escape(state.recommendation)}${followed ? " ✓" : ""}</span>` : ""}
      </div>
      <div class="stats">
        <div class="stat">${icons.sparkle(18)}<strong>+${award.xp_awarded}</strong><span>XP earned</span></div>
        <div class="stat">${icons.acorn(20)}<strong>+${award.acorns_awarded}</strong><span>Acorns earned</span></div>
      </div>
      ${award.tier_up ? `
      <div class="levelup">
        ${icons.check(20)}
        <div>
          <strong>New tier: ${escape(award.tier)}!</strong>
          <span>New looks may be waiting in Pip's shop.</span>
        </div>
      </div>` : ""}
      <p class="fine">${award.acorn_balance} acorns · ${award.total_xp} XP total · ${escape(award.tier)} tier</p>
      ${
        decision !== "buy" && state.checkout?.tabId
          ? `<button class="btn btn-primary" data-action="close-checkout">${icons.close(16)}<span>Close this checkout</span></button>
             <button class="btn btn-outline" data-action="continue">${icons.arrow(16)}<span>Keep it open</span></button>`
          : `<button class="btn btn-primary" data-action="continue">${icons.arrow(16)}<span>Continue</span></button>`
      }
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
    </main>
    ${navBar("companion")}`,

  grantMic: () => `
    ${header()}
    <main class="screen center">
      <div class="art">${squirrel({ scarf: hasScarf(), sparkles: true })}</div>
      <h1 class="title center-text">Enable Microphone</h1>
      <p class="muted center-text sub">Chrome requires microphone permission to be granted in a tab so Pip can hear you talk.</p>
      ${
        state.grantMicStatus === "success"
          ? `<div style="padding:12px; background:#d4edda; color:#155724; border-radius:10px; font-size:13px; text-align:center; font-weight:600;">
               ✅ Microphone enabled!<br><span style="font-size:11px; font-weight:normal;">You can now close this tab and return to Pip.</span>
             </div>
             <button class="btn btn-primary" data-action="close-tab" style="margin-top:14px;">Close Tab</button>`
          : state.grantMicStatus === "denied"
            ? `<div style="padding:12px; background:#f8d7da; color:#721c24; border-radius:10px; font-size:12px; text-align:center;">
                 ⚠️ Access was denied. Please click the camera/mic icon in the address bar to allow microphone access.
               </div>
               <button class="btn btn-primary" data-action="request-mic-permission" style="margin-top:14px;">Try Again</button>`
            : `<button class="btn btn-primary" data-action="request-mic-permission">${icons.mic(18)}<span>Click to Allow Microphone</span></button>`
      }
    </main>`,
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
  [state.checkout, state.cosmetics] = await Promise.all([
    getActiveTabCheckout().catch(() => null),
    loadCosmeticsState(),
  ]);
  state.progress = progressFromProfile(state.cosmetics?.profile);
  setSquirrelCosmetics(state.cosmetics);
  if (intent === "conversation") {
    // Land on Talk first so a failed start shows its error there, not on the loading screen.
    state.screen = "talk";
    await startConversation();
  } else go(intent === "companion" ? "companion" : "talk");
}

async function handleUserTurn(transcript) {
  if (!transcript || !transcript.trim()) return;
  const cleanText = transcript.trim();
  voiceEngine.stopListening();

  state.userTranscript = cleanText;
  const tEl = document.getElementById("user-transcript-live");
  if (tEl) tEl.textContent = `You: “${cleanText}”`;

  const statusEl = document.getElementById("conv-status-text");
  if (statusEl) {
    statusEl.className = "conversation-status paused";
    statusEl.textContent = "🤔 Pip is thinking…";
  }

  try {
    const rawTotal = String(state.checkout?.total ?? "0").replace(/[^0-9.]/g, "");
    const turnRes = await apiFetch("/api/checkout/turn", {
      method: "POST",
      body: JSON.stringify({
        user_text: cleanText,
        cart_total: parseFloat(rawTotal || "0"),
        turn_count: (state.turnCount || 0) + 1,
      }),
    });

    state.turnCount = (state.turnCount || 0) + 1;
    if (turnRes?.reply_text) {
      state.subtitle = turnRes.reply_text;
      const qEl = document.getElementById("pip-quote");
      if (qEl) qEl.textContent = turnRes.reply_text;
    }
    if (turnRes?.recommendation) {
      state.recommendation = turnRes.recommendation;
    }
    render();

    if (turnRes?.reply_audio_url) {
      const audioUrl = turnRes.reply_audio_url.startsWith("http")
        ? turnRes.reply_audio_url
        : `${API_BASE_URL}${turnRes.reply_audio_url}`;
      await voiceEngine.playAudio(audioUrl);
    }

    if (!turnRes?.done && state.micOn && state.screen === "conversation") {
      listenForUser();
    }
  } catch (err) {
    console.warn("Turn error:", err);
    state.error = err?.message ?? String(err);
    render();
  }
}

function listenForUser() {
  if (!state.micOn || state.screen !== "conversation") return;
  voiceEngine.startListening({
    onInterim: (interimText) => {
      state.userTranscript = interimText;
      const tEl = document.getElementById("user-transcript-live");
      if (tEl) tEl.textContent = `You: “${interimText}”`;
    },
    onResult: (finalText) => {
      handleUserTurn(finalText);
    },
    onError: (err) => {
      console.warn("Speech recognition warning:", err);
      if (err?.code === "not-allowed" || err?.error === "not-allowed") {
        state.micBlocked = true;
        render();
      }
    },
  });
}

async function startConversation() {
  state.busy = true;
  state.error = null;
  render();

  try {
    const rawTotal = String(state.checkout?.total ?? "").replace(/[^0-9.]/g, "") || "0";
    const cartItems = state.checkout?.items?.map((i) => i.name).filter(Boolean).join(", ") ||
                      state.checkout?.store ||
                      "Items in cart";
    const cartTotal = state.checkout?.total ? String(state.checkout.total) : `$${rawTotal}`;

    // Log every conversation: create the checkout session before the call starts.
    // If this fails, say so instead of talking without saving anything.
    const logged = await startCheckoutSession(state.checkout);
    state.checkoutSessionId = logged.session_id;

    state.startedAt = Date.now();
    state.micOn = true;
    state.recommendation = null;
    state.suggestion = null;
    state.verdictError = null;
    state.endedAt = 0;
    state.userTranscript = "";
    state.subtitle = "Connecting with Pip…";
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const el = document.getElementById("timer");
      if (el) el.textContent = formatTime(elapsedSeconds());
    }, 1000);

    go("conversation");
    animatePip();

    try {
      state.activeVoiceSession = await startSquirrelVoiceSession(
        { items: cartItems, total: cartTotal, sessionId: state.checkoutSessionId, startedAt: state.startedAt },
        {
          onStatus: (step) => {
            state.subtitle = {
              mic: "Checking your microphone…",
              connecting: "Connecting with Pip…",
              retrying: "Still connecting… trying another way",
            }[step];
            const qEl = document.getElementById("pip-quote");
            if (qEl) qEl.textContent = state.subtitle;
          },
          onTranscript: (entry) => {
            if (entry.role === "squirrel") {
              state.subtitle = entry.text;
              const qEl = document.getElementById("pip-quote");
              if (qEl) qEl.textContent = entry.text;
            } else {
              state.userTranscript = entry.text;
              const tEl = document.getElementById("user-transcript-live");
              if (tEl) tEl.textContent = `You: “${entry.text}”`;
            }
          },
          onModeChange: (mode) => {
            state.speaking = mode === "speaking";
            state.listening = mode === "listening";
            const waveEl = document.querySelector(".wave");
            if (waveEl) waveEl.className = `wave ${mode === "speaking" || mode === "listening" ? "" : "paused"}`;
            const statusEl = document.getElementById("conv-status-text");
            if (statusEl) {
              if (mode === "speaking") {
                statusEl.className = "conversation-status speaking";
                statusEl.textContent = "🔊 Pip is speaking…";
              } else if (mode === "listening") {
                statusEl.className = "conversation-status";
                statusEl.textContent = "🎤 Listening… speak into your microphone";
              } else {
                statusEl.className = "conversation-status paused";
                statusEl.textContent = "Thinking…";
              }
            }
          },
          onVerdict: (verdict) => {
            if (verdict?.suggestion) state.suggestion = verdict.suggestion;
            if (verdict?.suggestion) {
              state.recommendation =
                verdict.suggestion === "buy" ? "Go for it" :
                verdict.suggestion === "wait" ? "Wait 24h" : "Skip purchase";
            }
            if (verdict?.closing_line) {
              state.subtitle = verdict.closing_line;
            }
            render();
          },
          onVerdictError: (err) => {
            // e.g. API 503: GEMINI_API_KEY not configured — shown if the decision can't be saved
            state.verdictError = String(err?.message ?? err).replace(/^API \d+: /, "");
          },
          onEnd: ({ byAgent }) => {
            if (byAgent && state.screen === "conversation") showVerdict();
          },
          onError: (err) => {
            console.warn("ElevenLabs Agent error:", err);
            const errStr = String(err?.message || err);
            if (errStr.includes("NotAllowedError") || errStr.includes("permission")) {
              state.micBlocked = true;
              render();
            }
          },
        }
      );
    } catch (wsErr) {
      console.warn("ElevenLabs WebSocket agent failed, using local voice fallback:", wsErr);
      const errStr = String(wsErr?.message || wsErr);
      if (errStr.includes("NotAllowedError") || errStr.includes("permission")) {
        state.micBlocked = true;
        render();
        return;
      }
      // Fallback to local TTS + SpeechRecognition engine (reuses the session created above)
      const session = logged;
      state.subtitle = session?.opening_line || "“Why do you need this purchase today?”";
      render();
      if (session?.audio_url) {
        await voiceEngine.playAudio(`${API_BASE_URL}${session.audio_url}`);
      }
      if (state.micOn && state.screen === "conversation") {
        listenForUser();
      }
    }
  } catch (err) {
    state.error = err?.message ?? String(err);
    render();
  } finally {
    state.busy = false;
    if (state.screen !== "conversation") render();
  }
}

// Pip reacts to the call: mouth follows his voice, ears perk and he nods while you
// talk, and he looks up "thinking" between turns. Stops when you leave the call.
function animatePip() {
  state.stopPipMotion?.();
  const stop = startPipMotion(
    () => {
      if (state.screen !== "conversation") {
        stop();
        state.stopPipMotion = null;
        return null;
      }
      return document.querySelector(".pip-stage");
    },
    () => {
      const conv = state.activeVoiceSession?.conversation;
      const live = typeof conv?.getOutputVolume === "function";
      return {
        speaking: state.speaking,
        listening: state.listening,
        micOn: state.micOn,
        connecting: !conv && !state.speaking && !state.listening,
        outputVolume: live ? conv.getOutputVolume() : null,
        inputVolume: live ? conv.getInputVolume() : null,
      };
    },
    (mood) => (state.pipMood = mood)
  );
  state.stopPipMotion = stop;
}

// Stops the call (if it's still live) and shows Pip's verdict with buy / wait / skip.
function showVerdict() {
  clearInterval(state.timer);
  state.endedAt ||= Date.now();
  state.activeVoiceSession = null;
  voiceEngine.stopAll();
  go("verdict");
}

async function stopAndShowVerdict() {
  state.busy = true;
  render();
  const live = state.activeVoiceSession;
  state.endedAt ||= Date.now();
  if (live) {
    try {
      await live.stopSession(); // waits for the verdict request
    } catch (e) {
      console.warn("Error stopping voice session:", e);
    }
  }
  state.busy = false;
  showVerdict();
}

async function endConversation(decision = "buy") {
  clearInterval(state.timer);
  state.busy = true;
  if (state.activeVoiceSession) {
    try {
      await state.activeVoiceSession.stopSession();
    } catch (e) {
      console.warn("Error stopping voice session:", e);
    }
    state.activeVoiceSession = null;
  }
  voiceEngine.stopAll();

  // The database (record_checkout_decision, 20261017_recommendation_rewards.sql) decides
  // the award from Pip's saved verdict + this decision, logs it, and updates the profile.
  let saveError = null;
  let award = null;
  if (state.checkoutSessionId) {
    try {
      award = await submitCheckoutDecision(state.checkoutSessionId, decision, state.checkout);
    } catch (e) {
      console.warn("Could not submit decision:", e);
      saveError = !/409|not ready/i.test(String(e?.message))
        ? `Your decision wasn't saved: ${e?.message ?? e}`
        : state.verdictError
          ? `Pip's verdict failed, so this decision wasn't saved: ${state.verdictError}`
          : "Pip didn't finish a verdict, so this decision wasn't saved.";
    }
  } else {
    saveError = "This conversation wasn't linked to a checkout session, so the decision wasn't saved.";
  }
  state.busy = false;

  if (saveError) {
    // Nothing was awarded. Stay on the verdict screen so the choice can be retried.
    state.screen = state.screen === "conversation" ? "verdict" : state.screen;
    state.endedAt ||= Date.now();
    state.error = saveError;
    render();
    return;
  }

  state.checkoutSessionId = null;
  state.result = { award, decision };
  syncBalances(award);
  go("rewards");
}

// Keep the header chip, shop and avatar in step with the database after an award.
function syncBalances(award) {
  state.progress = progressFromProfile(award);
  if (state.cosmetics?.profile) {
    state.cosmetics.profile = {
      ...state.cosmetics.profile,
      acorn_balance: award.acorn_balance,
      total_xp: award.total_xp,
      tier: award.tier,
    };
  }
  loadCosmeticsState()
    .then((c) => {
      state.cosmetics = c;
      setSquirrelCosmetics(c);
    })
    .catch((e) => console.warn("Could not refresh cosmetics after award:", e));
}

// Plain-language reason for the award, mirroring the matrix in the rewards migration.
function awardReason({ decision, recommended_decision: rec, recommendation_matched: matched, daily_cap_applied: capped }) {
  const pick = { buy: "buying", save: "waiting", skip: "skipping" }[rec] ?? "something else";
  const base = {
    buy: matched ? "Pip agreed it was worth it, so you earned the full reward." : `Pip suggested ${pick}. Buying anyway earns no acorns.`,
    save: "Saving it for later always earns acorns.",
    skip: matched ? "You skipped it, just like Pip suggested. That's the biggest reward." : `Pip suggested ${pick}, but skipping still earns a little.`,
  }[decision];
  return capped ? `${base} You've hit today's 200-acorn limit, so this was capped.` : base;
}

const actions = {
  async google() {
    state.busy = true;
    state.error = null;
    render();
    try {
      const intent = state.pendingIntent;
      state.pendingIntent = null;
      await enterApp(await signInWithGoogle(), intent);
    } catch (err) {
      console.error(err);
      state.error = err?.message ?? String(err);
    } finally {
      state.busy = false;
      if (state.screen === "welcome") render();
    }
  },
  start: startConversation,
  end: stopAndShowVerdict,
  "decide-buy": () => endConversation("buy"),
  "decide-wait": () => endConversation("save"),
  "decide-skip": () => endConversation("skip"),
  "toggle-mic"() {
    state.micOn = !state.micOn;
    if (state.activeVoiceSession?.conversation?.setMicMuted) {
      state.activeVoiceSession.conversation.setMicMuted(!state.micOn);
    }
    if (!state.micOn) {
      voiceEngine.stopListening();
    } else if (!state.activeVoiceSession) {
      listenForUser();
    }
    render();
  },
  continue: () => go("companion"),
  // Skip / wait: close the store tab on the user's say-so (never automatically).
  async "close-checkout"() {
    const tabId = state.checkout?.tabId;
    if (tabId) await chrome.tabs.remove(tabId).catch((e) => console.warn("Could not close checkout tab:", e));
    window.close();
  },
  done: () => window.close(),
  "go-talk": () => go("talk"),
  "go-companion": () => go("companion"),
  "toggle-menu"() {
    state.menuOpen = !state.menuOpen;
    render();
  },
  async "sign-out"() {
    voiceEngine.stopAll();
    await signOut();
    state.session = null;
    state.progress = null;
    state.cosmetics = null;
    setSquirrelCosmetics(null);
    go("welcome");
  },
  "grant-mic"() {
    const url = chrome?.runtime?.getURL ? chrome.runtime.getURL("popup/index.html?grant_mic=1") : "popup/index.html?grant_mic=1";
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  },
  async "request-mic-permission"() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      state.grantMicStatus = "success";
      state.micBlocked = false;
      render();
    } catch (e) {
      console.warn("User media error:", e);
      state.grantMicStatus = "denied";
      render();
    }
  },
  "close-tab"() {
    window.close();
  },
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.menuOpen) {
    state.menuOpen = false;
    render();
  }
});

app.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  // Any click outside the menu (or on one of its items) closes it.
  if (state.menuOpen && button?.dataset.action !== "toggle-menu") {
    state.menuOpen = false;
    if (!button) return render();
  }
  if (button?.dataset.action === "open-page") {
    const url = chrome.runtime.getURL(button.dataset.path);
    if (button.dataset.path === "avatar/index.html") {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab?.id) throw new Error("Couldn't find the current browser tab.");
        return chrome.tabs.update(tab.id, { url });
      }).catch((err) => {
        console.error(err);
        state.error = err?.message ?? String(err);
        render();
      });
    } else {
      chrome.tabs.create({ url });
    }
    return render();
  }
  if (!button || button.disabled) return;
  Promise.resolve(actions[button.dataset.action]?.()).catch((err) => {
    console.error(err);
    state.error = err?.message ?? String(err);
    render();
  });
});

app.addEventListener("submit", (e) => {
  if (e.target.id === "chat-reply-form") {
    e.preventDefault();
    const input = document.getElementById("chat-reply-text");
    const text = input?.value?.trim();
    if (text) {
      input.value = "";
      if (state.activeVoiceSession?.conversation?.sendUserMessage) {
        state.userTranscript = text;
        const tEl = document.getElementById("user-transcript-live");
        if (tEl) tEl.textContent = `You: “${text}”`;
        state.activeVoiceSession.conversation.sendUserMessage(text);
      } else {
        handleUserTurn(text);
      }
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  const key = state.session?.user?.id ? `cosmetics:${state.session.user.id}` : "";
  if (areaName === "local" && key && changes[key]?.newValue) {
    state.cosmetics = changes[key].newValue;
    setSquirrelCosmetics(state.cosmetics);
    state.progress = progressFromProfile(state.cosmetics.profile);
    render();
  }
});

// ---------- startup: check auth status first ----------

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("grant_mic") === "1") {
  go("grantMic");
  actions["request-mic-permission"]();
} else {
  render();
  // Conversations are saved to the user's account, so a real Supabase sign-in is required.
  Promise.all([checkAuth(), takePopupIntent().catch(() => null)])
    .then(([session, intent]) => {
      if (session) return enterApp(session, intent);
      state.pendingIntent = intent; // resume e.g. "Talk to Pip" right after signing in
      go("welcome");
    })
    .catch((err) => {
      console.warn("Auth check failed:", err);
      go("welcome");
      state.error = err?.message ?? "Couldn't check your session. Please sign in.";
      render();
    });
}
