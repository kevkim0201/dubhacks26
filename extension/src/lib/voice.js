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

  // Play audio from ElevenLabs Turbo endpoint
  playAudio(audioUrl) {
    this.stopAudio();
    this.isSpeaking = true;
    this._notifyState();

    try {
      this.audio = new Audio(audioUrl);
      this.audio.crossOrigin = "anonymous";

      this.audio.onended = () => {
        this.isSpeaking = false;
        this._notifyState();
      };

      this.audio.onerror = (err) => {
        console.warn("Audio playback error:", err);
        this.isSpeaking = false;
        this._notifyState();
      };

      return this.audio.play().catch((err) => {
        console.warn("Audio play() blocked or failed:", err);
        this.isSpeaking = false;
        this._notifyState();
      });
    } catch (err) {
      console.warn("Failed to create Audio instance:", err);
      this.isSpeaking = false;
      this._notifyState();
    }
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

  // Request microphone permission and start speech recognition
  async startListening({ onInterim, onResult, onError, onEnd }) {
    this.stopListening();

    // 1. Explicitly prompt / request microphone access
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      console.warn("Microphone permission denied or unavailable:", err);
      if (onError) {
        onError(
          new Error("Microphone permission needed. Please allow microphone access or type below.")
        );
      }
      this.isListening = false;
      this._notifyState();
      return false;
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

      let finalTranscript = "";

      rec.onstart = () => {
        this.isListening = true;
        this._notifyState();
      };

      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const item = e.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }

        const currentText = (finalTranscript || interim).trim();
        if (onInterim && currentText) {
          onInterim(currentText);
        }

        if (finalTranscript.trim() && onResult) {
          const sent = finalTranscript.trim();
          finalTranscript = "";
          onResult(sent);
        }
      };

      rec.onerror = (err) => {
        console.warn("Speech recognition event error:", err.error, err);
        if (err.error !== "no-speech" && onError) {
          onError(err);
        }
      };

      rec.onend = () => {
        // If final transcript is waiting, deliver it
        if (finalTranscript.trim() && onResult) {
          onResult(finalTranscript.trim());
          finalTranscript = "";
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
