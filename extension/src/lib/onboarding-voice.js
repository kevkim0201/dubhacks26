// Voice interview for onboarding: Pip asks about the user's spending habits out loud.
//
// ─── For the agent builder ──────────────────────────────────────────────────────────────
// 1. ONBOARDING_AGENT_ID is the ElevenLabs agent. Set it to "" to run a clearly-labelled
//    PREVIEW (scripted conversation) instead.
// 2. When the call ends, the page sends the transcript to POST /api/onboarding/from-conversation,
//    where Gemini turns it into the answers below plus a persona, and saves them.
//    Optional CLIENT TOOLS (ElevenLabs → Agent → Tools → Client tool) the page also handles:
//      note_answer(field, value)   optional, call as you learn things; fills "What Pip learned" live
//      save_personalization({...}) call once at the end with everything (shape below), then end the call
//    Personalization shape (validated by POST /api/onboarding; unknown values are rejected):
//      spend_categories: ("electronics"|"clothing"|"shoes"|"beauty"|"home"|"kitchen"|"food"|"health"|
//                         "sports"|"outdoors"|"toys"|"books"|"entertainment"|"travel"|"office"|"pets"|
//                         "jewelry"|"automotive"|"other")[]
//      impulse_triggers: ("late_night"|"stress"|"boredom"|"sales"|"social_media"|"payday"|"with_friends"|"other")[]
//      goals: ("fewer_impulse_buys"|"save_for_goal"|"stick_to_budget"|"better_deals"|"think_before_big_buys"|"pay_off_debt")[]
//      savings_goal: { name: string, amount?: number } | null
//      monthly_budget: number | null
//      coaching_style: "gentle"|"balanced"|"tough_love"
//      notes: string (≤ 500 chars)
// 3. End the call with the built-in end_call tool after save_personalization.
// ─────────────────────────────────────────────────────────────────────────────────────────

import { Conversation } from "@elevenlabs/client";

export const ONBOARDING_AGENT_ID = "agent_7201m576qwpmf2qb35r1b1pp4bej"; // PersonalizationAgent

const MIC_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 12_000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Starts the onboarding interview.
 * @param {{ firstName?: string }} context
 * @param {{
 *   onStatus?: (step: "mic" | "connecting" | "retrying" | "live") => void,
 *   onModeChange?: (mode: "speaking" | "listening") => void,
 *   onTranscript?: (entry: { role: "pip" | "user", text: string }) => void,
 *   onLearned?: (partial: object) => void,          // some answers learned so far
 *   onEnd?: (result: { personalization: object | null, transcript: {role, text}[], byAgent: boolean }) => void,
 *   onError?: (err: Error) => void,
 * }} callbacks
 * @returns {Promise<{ conversation: object, preview: boolean, setMuted: (m: boolean) => void, stop: () => Promise<void> }>}
 */
export async function startOnboardingVoiceSession(context = {}, callbacks = {}) {
  if (!ONBOARDING_AGENT_ID) return startPreview(context, callbacks);

  callbacks.onStatus?.("mic");
  const probe = await withTimeout(
    navigator.mediaDevices.getUserMedia({ audio: true }),
    MIC_TIMEOUT_MS,
    "Microphone permission timed out. Allow mic access, then try again."
  );
  probe.getTracks().forEach((t) => t.stop());

  let personalization = null;
  let stoppedByUser = false;
  const transcript = [];
  const options = {
    agentId: ONBOARDING_AGENT_ID,
    clientTools: {
      note_answer: ({ field, value }) => {
        callbacks.onLearned?.({ [field]: value });
        return "noted";
      },
      save_personalization: (params) => {
        personalization = params;
        callbacks.onLearned?.(params);
        return "saved";
      },
    },
    onConnect: () => callbacks.onStatus?.("live"),
    onMessage: (msg) => {
      const entry = { role: msg.source === "ai" ? "pip" : "user", text: msg.message };
      transcript.push(entry);
      callbacks.onTranscript?.(entry);
    },
    onModeChange: ({ mode }) => callbacks.onModeChange?.(mode),
    onDisconnect: (details) =>
      callbacks.onEnd?.({ personalization, transcript: [...transcript], byAgent: !stoppedByUser && details?.reason !== "user" }),
    onError: (err) => callbacks.onError?.(err instanceof Error ? err : new Error(String(err))),
  };

  async function connect(connectionType) {
    const pending = Conversation.startSession({ ...options, connectionType });
    try {
      return await withTimeout(pending, CONNECT_TIMEOUT_MS, `Pip didn't connect (${connectionType}) in time.`);
    } catch (err) {
      pending.then((late) => late.endSession()).catch(() => {});
      throw err;
    }
  }

  callbacks.onStatus?.("connecting");
  let conversation;
  try {
    conversation = await connect("webrtc");
  } catch {
    callbacks.onStatus?.("retrying");
    conversation = await connect("websocket");
  }
  return {
    conversation,
    preview: false,
    setMuted: (muted) => conversation.setMicMuted?.(muted),
    stop: async () => {
      stoppedByUser = true;
      await conversation.endSession();
    },
  };
}

// ─── Preview: a scripted interview so the UI works before the agent exists ──────────────

const SCRIPT = [
  ["pip", (c) => `Hi ${c.firstName ?? "there"}! I'm Pip. Mind if I ask a few quick questions about how you shop?`],
  ["user", () => "Sure, go for it."],
  ["pip", () => "What do you tend to overspend on?"],
  ["user", () => "Probably gadgets and takeout. Way too much takeout."],
  ["learn", () => ({ spend_categories: ["electronics", "food"] })],
  ["pip", () => "Ha, takeout is sneaky. When do impulse buys usually happen for you?"],
  ["user", () => "Late at night, and whenever there's a big sale."],
  ["learn", () => ({ impulse_triggers: ["late_night", "sales"] })],
  ["pip", () => "The midnight cart, I know it well. Are you saving up for anything?"],
  ["user", () => "A trip to Japan, about twenty-five hundred dollars."],
  ["learn", () => ({ savings_goal: { name: "Trip to Japan", amount: 2500 }, goals: ["save_for_goal", "fewer_impulse_buys"] })],
  ["pip", () => "Love that. Last one: when you're about to splurge, should I be gentle, or tough love?"],
  ["user", () => "Tough love. I need it."],
  ["learn", () => ({ coaching_style: "tough_love" })],
  ["pip", () => "Tough love it is. Thanks for sharing, I've got everything I need!"],
];

function startPreview(context, callbacks) {
  let stopped = false;
  let speaking = false;
  let muted = false;
  const learned = {};
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(() => !stopped && fn(), ms));

  // Fake voice levels so Pip's mouth and nods animate like a real call.
  const conversation = {
    getOutputVolume: () => (speaking ? 0.12 + 0.12 * Math.abs(Math.sin(Date.now() / 90)) : 0),
    getInputVolume: () => (!speaking && !muted && userTalking ? 0.1 + 0.1 * Math.abs(Math.sin(Date.now() / 110)) : 0),
  };
  let userTalking = false;

  callbacks.onStatus?.("connecting");
  let t = 900;
  later(t, () => callbacks.onStatus?.("live"));
  for (const [role, line] of SCRIPT) {
    if (role === "learn") {
      later(t, () => {
        Object.assign(learned, line(context));
        callbacks.onLearned?.(line(context));
      });
      t += 300;
      continue;
    }
    const text = line(context);
    const duration = Math.min(4200, 900 + text.length * 45);
    later(t, () => {
      speaking = role === "pip";
      userTalking = role === "user";
      callbacks.onModeChange?.(role === "pip" ? "speaking" : "listening");
      callbacks.onTranscript?.({ role, text });
    });
    t += duration;
    later(t, () => {
      speaking = false;
      userTalking = false;
      callbacks.onModeChange?.("listening");
    });
    t += 700; // a beat of "thinking" between turns
  }
  later(t, () => {
    stopped = true;
    callbacks.onEnd?.({ personalization: { ...learned }, transcript: [], byAgent: true });
  });

  return Promise.resolve({
    conversation,
    preview: true,
    setMuted: (m) => (muted = m),
    stop: async () => {
      stopped = true;
      timers.forEach(clearTimeout);
      callbacks.onEnd?.({ personalization: Object.keys(learned).length ? { ...learned } : null, transcript: [], byAgent: false });
    },
  });
}
