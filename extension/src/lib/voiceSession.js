import { Conversation } from "@elevenlabs/client";
import { apiFetch } from "./api.js";

const ELEVENLABS_AGENT_ID = "agent_4801m56k1bnffh1sfrwk9a90dvry";
// The agent prompt uses {{user_persona}}; ElevenLabs rejects calls that leave it out.
export const NO_PERSONA = "No profile yet: this shopper hasn't shared their spending habits with Pip.";

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
 * Starts a live voice conversation with Pip at checkout and sends the final JSON verdict to FastAPI.
 * @param {Object} cart - { items: "Pro Over-Ear Gym Headphones", total: "eighty-nine dollars", sessionId, startedAt, userPersona }
 *   userPersona: the onboarding interview as text (GET /api/onboarding -> persona_prompt).
 *   sessionId (from POST /api/checkout/start) makes the backend save the verdict + transcript on that session.
 * @param {Object} callbacks - Optional UI hooks: { onStatus, onTranscript, onModeChange, onVerdict, onEnd, onError }
 *   onStatus("mic" | "connecting" | "retrying") reports which connect step is running.
 *   onEnd({ byAgent, verdict }) fires once the call is over and the verdict request has finished.
 */
export async function startSquirrelVoiceSession(cart = {}, callbacks = {}) {
  // 1. Microphone permission. Extension popups sometimes can't show Chrome's prompt and
  //    the request just waits, so give up after a while and ask for it in a tab instead.
  callbacks.onStatus?.("mic");
  const probe = await withTimeout(
    navigator.mediaDevices.getUserMedia({ audio: true }),
    MIC_TIMEOUT_MS,
    "Microphone permission timed out. Allow mic access in a tab, then try again."
  );
  probe.getTracks().forEach((track) => track.stop()); // the SDK opens its own stream

  const cartItems = typeof cart.items === "string" ? cart.items : JSON.stringify(cart.items || "empty");
  const cartTotal = String(cart.total || "empty");
  const transcript = [];
  let verdictSent = false;
  let verdictPromise = null;
  let stoppedByUser = false;

  // Only one verdict request per call; later callers share its result.
  function sendVerdictToBackend() {
    verdictPromise ??= requestVerdict();
    return verdictPromise;
  }

  async function requestVerdict() {
    if (verdictSent || transcript.length === 0) return null;
    verdictSent = true;

    try {
      const response = await apiFetch("/api/checkout/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_items: cartItems,
          cart_total: cartTotal,
          transcript: transcript,
          ...(cart.sessionId ? { session_id: cart.sessionId } : {}),
          duration_seconds: Math.round((Date.now() - (cart.startedAt ?? Date.now())) / 1000),
        }),
      });

      // Handle both parsed JSON and raw Fetch Response depending on how src/lib/api.js is written
      const data = typeof response?.json === "function" ? await response.json() : response;
      console.log("✅ Structured Verdict saved to FastAPI:", data);
      callbacks.onVerdict?.(data);
      return data;
    } catch (err) {
      console.error("❌ Failed to send verdict to backend:", err);
      callbacks.onVerdictError?.(err);
      callbacks.onError?.(err);
      return null;
    }
  }

  console.log(`[ElevenLabs API] Connecting WebSocket to agent: ${ELEVENLABS_AGENT_ID}`);
  console.log(`[ElevenLabs API] Dynamic variables:`, { cart_items: cartItems, cart_total: cartTotal, user_persona: cart.userPersona || NO_PERSONA });

  // 2. Start live WebSocket session with your ElevenLabs Agent
  const sessionOptions = {
    agentId: ELEVENLABS_AGENT_ID,
    dynamicVariables: {
      cart_items: cartItems,
      cart_total: cartTotal,
      user_persona: cart.userPersona || NO_PERSONA,
    },

    onConnect: () => {
      console.log(`[ElevenLabs Response] ✅ Connected WebSocket to agent: ${ELEVENLABS_AGENT_ID}`);
    },

    onMessage: (msg) => {
      // msg.source is "ai" or "user", msg.message is the spoken text
      const role = msg.source === "ai" ? "squirrel" : "user";
      const entry = { role, text: msg.message };
      transcript.push(entry);
      console.log(`[ElevenLabs Response] 💬 ${role.toUpperCase()}:`, msg.message);
      callbacks.onTranscript?.(entry, transcript);
    },

    onModeChange: ({ mode }) => {
      console.log(`[ElevenLabs Response] 🔄 Mode changed: ${mode}`);
      callbacks.onModeChange?.(mode);
    },

    // Fires when Pip calls the end_call tool after its verdict, or when we stop the session.
    onDisconnect: async (details) => {
      const byAgent = !stoppedByUser && details?.reason !== "user";
      console.log(`[ElevenLabs Response] 📞 Call disconnected (${details?.reason ?? "unknown"}).`);
      const verdict = await sendVerdictToBackend();
      callbacks.onEnd?.({ byAgent, verdict });
    },

    onError: (err) => {
      console.error("[ElevenLabs Error] ❌", err);
      callbacks.onError?.(err);
    },
  };

  // 2. Connect. Voice defaults to WebRTC (LiveKit), which can stall on some networks;
  //    if it doesn't connect in time, retry over a plain WebSocket.
  async function connect(connectionType) {
    const pending = Conversation.startSession({ ...sessionOptions, connectionType });
    try {
      return await withTimeout(pending, CONNECT_TIMEOUT_MS, `Pip didn't connect (${connectionType}) in time.`);
    } catch (err) {
      pending.then((late) => late.endSession()).catch(() => {}); // don't leave a late session open
      throw err;
    }
  }

  callbacks.onStatus?.("connecting");
  let conversation;
  try {
    conversation = await connect("webrtc");
  } catch (err) {
    console.warn("[ElevenLabs] WebRTC connect failed, retrying over WebSocket:", err);
    callbacks.onStatus?.("retrying");
    conversation = await connect("websocket");
  }

  return {
    conversation,
    stopSession: async () => {
      stoppedByUser = true;
      await conversation.endSession();
      return await sendVerdictToBackend();
    },
  };
}
