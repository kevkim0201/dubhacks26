// Drives Pip's live poses during a voice conversation (see pip-motion.css).
// Every frame it reads voice levels, smooths them into --mouth / --voice, and
// picks a mood: speaking, listening, thinking (you stopped talking, Pip hasn't
// started yet) or muted.

const clamp = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {() => HTMLElement | null} getStage  element wrapping Pip (re-queried each frame, survives re-renders)
 * @param {() => { speaking: boolean, listening: boolean, micOn: boolean, connecting: boolean,
 *                 outputVolume: number | null, inputVolume: number | null }} read
 * @param {(mood: string) => void} [onMood]  called when the mood changes
 * @returns {() => void} stop
 */
export function startPipMotion(getStage, read, onMood = () => {}) {
  let raf = 0;
  let mouth = 0;
  let voice = 0;
  let heardUserAt = 0; // last time the user was audibly talking
  let userTookTurn = false; // the user spoke since Pip last spoke

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const stage = getStage();
    if (!stage) return;
    const s = read();

    // Volumes from the SDK are small RMS values; scale them into 0–1 and smooth.
    const out = s.outputVolume == null ? 0 : clamp(s.outputVolume * 3.5);
    const inp = s.inputVolume == null ? 0 : clamp(s.inputVolume * 4);
    mouth += (out - mouth) * (out > mouth ? 0.6 : 0.25); // open fast, close a bit slower
    voice += (inp - voice) * 0.3;

    if (inp > 0.12) {
      heardUserAt = now;
      userTookTurn = true;
    }
    if (s.speaking) userTookTurn = false;

    let mood;
    if (!s.micOn) mood = "muted";
    else if (s.connecting) mood = "thinking";
    else if (s.speaking) mood = "speaking";
    else if (userTookTurn && now - heardUserAt > 700) mood = "thinking";
    else mood = "listening";

    if (stage.dataset.pipMood !== mood) {
      stage.dataset.pipMood = mood;
      onMood(mood);
    }
    // No live levels (local fallback voice): let CSS fake the mouth movement.
    stage.toggleAttribute("data-pip-auto", s.outputVolume == null);
    stage.style.setProperty("--mouth", mood === "speaking" ? mouth.toFixed(3) : "0");
    stage.style.setProperty("--voice", mood === "listening" ? voice.toFixed(3) : "0");
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
