import { Conversation } from "@elevenlabs/client";
import { apiFetch } from "./api.js";

const ELEVENLABS_AGENT_ID = "agent_4801m56k1bnffh1sfrwk9a90dvry";

/**
 * Starts a live voice conversation with Pip at checkout and sends the final JSON verdict to FastAPI.
 * @param {Object} cart - { items: "Pro Over-Ear Gym Headphones", total: "eighty-nine dollars" }
 * @param {Object} callbacks - Optional UI hooks: { onTranscript, onModeChange, onVerdict, onError }
 */
export async function startSquirrelVoiceSession(cart = {}, callbacks = {}) {
  // 1. Request microphone permission from the browser
  await navigator.mediaDevices.getUserMedia({ audio: true });

  const cartItems = typeof cart.items === "string" ? cart.items : JSON.stringify(cart.items || "empty");
  const cartTotal = String(cart.total || "empty");
  const transcript = [];
  let verdictSent = false;

  async function sendVerdictToBackend() {
    if (verdictSent || transcript.length === 0) return;
    verdictSent = true;

    try {
      const response = await apiFetch("/api/checkout/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_items: cartItems,
          cart_total: cartTotal,
          transcript: transcript,
        }),
      });

      // Handle both parsed JSON and raw Fetch Response depending on how src/lib/api.js is written
      const data = typeof response?.json === "function" ? await response.json() : response;
      console.log("✅ Structured Verdict saved to FastAPI:", data);
      callbacks.onVerdict?.(data);
      return data;
    } catch (err) {
      console.error("❌ Failed to send verdict to backend:", err);
      callbacks.onError?.(err);
    }
  }

  console.log(`[ElevenLabs API] Connecting WebSocket to agent: ${ELEVENLABS_AGENT_ID}`);
  console.log(`[ElevenLabs API] Dynamic variables:`, { cart_items: cartItems, cart_total: cartTotal });

  // 2. Start live WebSocket session with your ElevenLabs Agent
  const conversation = await Conversation.startSession({
    agentId: ELEVENLABS_AGENT_ID,
    dynamicVariables: {
      cart_items: cartItems,
      cart_total: cartTotal,
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

    // Fires automatically when Pip ends the call on Turn 3 (or if manually stopped)
    onDisconnect: async () => {
      console.log("[ElevenLabs Response] 📞 Call disconnected.");
      await sendVerdictToBackend();
    },

    onError: (err) => {
      console.error("[ElevenLabs Error] ❌", err);
      callbacks.onError?.(err);
    },
  });

  return {
    conversation,
    stopSession: async () => {
      await conversation.endSession();
      return await sendVerdictToBackend();
    },
  };
}
