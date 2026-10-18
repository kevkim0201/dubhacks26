// Voice engine for Pip the Squirrel
// Manages ElevenLabs Eleven Turbo audio playback and microphone speech recognition.

class VoiceEngine {
  constructor() {
    this.audio = null;
    this.recognition = null;
    this.isSpeaking = false;
    this.isListening = false;
    this.onSubtitle = null;
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
  }

  // Starts microphone speech recognition
  startListening({ onResult, onError, onEnd }) {
    this.stopListening();

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("Speech recognition not supported in this browser context.");
      return false;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        this.isListening = true;
        this._notifyState();
      };

      rec.onresult = (e) => {
        const transcript = e.results[0]?.[0]?.transcript?.trim();
        if (transcript && onResult) {
          onResult(transcript);
        }
      };

      rec.onerror = (err) => {
        console.warn("Speech recognition error:", err);
        if (onError) onError(err);
      };

      rec.onend = () => {
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
    this.isListening = false;
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
