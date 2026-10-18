// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startSession = vi.fn();
vi.mock("@elevenlabs/client", () => ({ Conversation: { startSession: (...a) => startSession(...a) } }));
vi.mock("./api.js", () => ({ apiFetch: vi.fn() }));
const { startSquirrelVoiceSession, NO_PERSONA } = await import("./voiceSession.js");

const fakeConversation = () => ({ endSession: vi.fn(async () => {}), getOutputVolume: () => 0, getInputVolume: () => 0 });

beforeEach(() => {
  vi.useFakeTimers();
  startSession.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
  });
});
afterEach(() => vi.useRealTimers());

describe("startSquirrelVoiceSession connect", () => {
  it("uses WebRTC when it connects", async () => {
    startSession.mockImplementation(async () => fakeConversation());
    const statuses = [];
    const session = await startSquirrelVoiceSession({}, { onStatus: (s) => statuses.push(s) });
    expect(session.conversation).toBeTruthy();
    expect(startSession.mock.calls.map((c) => c[0].connectionType)).toEqual(["webrtc"]);
    expect(statuses).toEqual(["mic", "connecting"]);
  });

  it("falls back to WebSocket when WebRTC stalls, and closes the late WebRTC session", async () => {
    let lateResolve;
    const late = fakeConversation();
    startSession
      .mockImplementationOnce(() => new Promise((r) => (lateResolve = r))) // webrtc hangs
      .mockImplementationOnce(async () => fakeConversation()); // websocket works
    const statuses = [];
    const pending = startSquirrelVoiceSession({}, { onStatus: (s) => statuses.push(s) });
    await vi.advanceTimersByTimeAsync(12_001);
    const session = await pending;
    expect(startSession.mock.calls.map((c) => c[0].connectionType)).toEqual(["webrtc", "websocket"]);
    expect(statuses).toEqual(["mic", "connecting", "retrying"]);
    lateResolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.endSession).toHaveBeenCalled();
    expect(session.conversation).not.toBe(late);
  });

  it("gives up on a stuck microphone prompt with a permission error", async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise(() => {}));
    const pending = startSquirrelVoiceSession({}, {});
    const assertion = expect(pending).rejects.toThrow(/permission/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(startSession).not.toHaveBeenCalled();
  });

  it("always sends user_persona (the agent prompt requires it)", async () => {
    startSession.mockImplementation(async () => fakeConversation());
    await startSquirrelVoiceSession({ items: "Mug", total: "$18", userPersona: "Saving up for: Japan." }, {});
    expect(startSession.mock.calls[0][0].dynamicVariables).toEqual({ cart_items: "Mug", cart_total: "$18", user_persona: "Saving up for: Japan." });
    await startSquirrelVoiceSession({ items: "Mug", total: "$18" }, {});
    expect(startSession.mock.calls[1][0].dynamicVariables.user_persona).toBe(NO_PERSONA);
  });
});
