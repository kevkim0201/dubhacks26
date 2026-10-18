// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPipMotion } from "./pip-motion.js";

let frames, now;
beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

// Runs one animation frame `ms` after the previous one.
const tick = (ms = 16) => {
  now += ms;
  frames.shift()?.(now);
};

function setup(initial) {
  const stage = document.createElement("div");
  const s = { speaking: false, listening: true, micOn: true, connecting: false, outputVolume: 0, inputVolume: 0, ...initial };
  const moods = [];
  startPipMotion(() => stage, () => s, (m) => moods.push(m));
  return { stage, s, moods };
}

describe("startPipMotion", () => {
  it("opens Pip's mouth with his voice while speaking", () => {
    const { stage, s } = setup({ speaking: true, listening: false, outputVolume: 0.2 });
    for (let i = 0; i < 10; i++) tick();
    expect(stage.dataset.pipMood).toBe("speaking");
    expect(Number(stage.style.getPropertyValue("--mouth"))).toBeGreaterThan(0.5);
    s.outputVolume = 0;
    for (let i = 0; i < 30; i++) tick();
    expect(Number(stage.style.getPropertyValue("--mouth"))).toBeLessThan(0.05);
  });

  it("listens while you talk, then thinks once you stop", () => {
    const { stage, s, moods } = setup({ inputVolume: 0.2 });
    tick();
    expect(stage.dataset.pipMood).toBe("listening");
    expect(Number(stage.style.getPropertyValue("--voice"))).toBeGreaterThan(0);
    s.inputVolume = 0;
    tick(300);
    expect(stage.dataset.pipMood).toBe("listening");
    tick(500); // > 700ms of silence after you spoke
    expect(stage.dataset.pipMood).toBe("thinking");
    s.speaking = true;
    s.listening = false;
    tick();
    expect(stage.dataset.pipMood).toBe("speaking");
    expect(moods).toEqual(["listening", "thinking", "speaking"]);
  });

  it("is muted when the mic is off, and fakes the mouth without volume data", () => {
    const { stage, s } = setup({ micOn: false });
    tick();
    expect(stage.dataset.pipMood).toBe("muted");
    Object.assign(s, { micOn: true, speaking: true, listening: false, outputVolume: null, inputVolume: null });
    tick();
    expect(stage.dataset.pipMood).toBe("speaking");
    expect(stage.hasAttribute("data-pip-auto")).toBe(true);
  });
});
