// Voice engine for Pip the Squirrel
// Manages ElevenLabs Eleven Turbo audio playback and microphone speech recognition.

class VoiceEngine {
  constructor() {
    this.audio = null;
    this.mediaStream = null;
    this.recognition = null;
    this.isSpeaking = false;
    this.isListening = false;
    this.onStateChange = null;
  }

  // Play audio from ElevenLabs Turbo endpoint, returns promise that resolves when speech ends
  playAudio(audioUrl) {
    this.stopAudio();
    this.stopListening(); // Ensure microphone does not pick up Pip's own voice
    this.isSpeaking = true;
    this._notifyState();

    return new Promise((resolve) => {
      try {
        const audio = new Audio(audioUrl);
        audio.crossOrigin = "anonymous";
        this.audio = audio;

        const cleanup = () => {
          this.isSpeaking = false;
          if (this.audio === audio) {
            this.audio = null;
          }
          this._notifyState();
          resolve();
        };

        audio.onended = cleanup;
        audio.onerror = (err) => {
          console.warn("Audio playback error:", err);
          cleanup();
        };

        audio.play().catch((err) => {
          console.warn("Audio play() blocked or failed:", err);
          cleanup();
        });
      } catch (err) {
        console.warn("Failed to create Audio instance:", err);
        this.isSpeaking = false;
        this.audio = null;
        this._notifyState();
        resolve();
      }
    });
  }

  stopAudio() {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch {}
      this.audio = null;
    }
    this.isSpeaking = false;
    this._notifyState();
  }

  // Request microphone permission and start speech recognition with silence detection
  async startListening({ onInterim, onResult, onError, onEnd, silenceMs = 1300 }) {
    this.stopListening();

    // 1. Try requesting microphone stream if available
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      console.warn("getUserMedia permission check in popup:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        if (onError) onError({ code: "not-allowed", message: "Microphone permission required." });
        return false;
      }
    }

    // 2. Initialize Web Speech API
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      const err = new Error("Speech recognition not supported in this browser window.");
      console.warn(err);
      if (onError) onError(err);
      return false;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      let latestSpokenText = "";
      let silenceTimer = null;
      let hasDispatched = false;

      const finishAndDispatch = () => {
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
        const text = latestSpokenText.trim();
        if (text && !hasDispatched) {
          hasDispatched = true;
          latestSpokenText = "";
          try {
            rec.stop();
          } catch {}
          if (onResult) onResult(text);
        }
      };

      rec.onstart = () => {
        this.isListening = true;
        this._notifyState();
      };

      rec.onresult = (e) => {
        let interim = "";
        let finalSegment = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const item = e.results[i];
          if (item.isFinal) {
            finalSegment += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }

        const currentText = (finalSegment || interim).trim();
        if (currentText) {
          latestSpokenText = currentText;
          if (onInterim) {
            onInterim(currentText);
          }

          // User spoke — reset silence timer
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            finishAndDispatch();
          }, silenceMs);
        }

        if (finalSegment.trim()) {
          latestSpokenText = finalSegment.trim();
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            finishAndDispatch();
          }, 600);
        }
      };

      rec.onerror = (err) => {
        console.warn("Speech recognition event error:", err.error, err);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (err.error === "not-allowed") {
          if (onError) onError({ code: "not-allowed", message: "Microphone permission required." });
        } else if (err.error !== "no-speech" && onError) {
          onError(err);
        }
      };

      rec.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (latestSpokenText.trim() && !hasDispatched) {
          finishAndDispatch();
        }
        this.isListening = false;
        this._notifyState();
        if (onEnd) onEnd();
      };

      this.recognition = rec;
      rec.start();
      return true;
    } catch (err) {
      console.warn("Failed to start speech recognition:", err);
      this.isListening = false;
      this._notifyState();
      if (onError) onError(err);
      return false;
    }
  }

  stopListening() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch {}
      this.mediaStream = null;
    }
    this.isListening = false;
    this._notifyState();
  }

  stopAll() {
    this.stopAudio();
    this.stopListening();
  }

  _notifyState() {
    if (this.onStateChange) {
      this.onStateChange({
        isSpeaking: this.isSpeaking,
        isListening: this.isListening,
      });
    }
  }
}

export const voiceEngine = new VoiceEngine();
