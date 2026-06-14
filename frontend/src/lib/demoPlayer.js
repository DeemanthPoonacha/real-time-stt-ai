/**
 * DemoPlayer — Orchestrates demo mode using browser Text-to-Speech.
 *
 * Instead of relying on the backend to play back a canned transcript,
 * this class fetches the demo script, speaks each segment aloud via
 * the Web Speech Synthesis API, and sends the text to the backend's
 * coaching WebSocket for real-time AI analysis.
 *
 * Flow:
 *   1. Fetch demo transcript from /api/demo-transcript
 *   2. For each segment:
 *      a. Speak the text via SpeechSynthesis (different voices for rep/prospect)
 *      b. Show the transcript in the UI immediately
 *      c. Send the text to backend via WS for coaching analysis
 *   3. Report progress via callbacks
 */

const API_BASE = `http://${window.location.hostname}:8000`;

export class DemoPlayer {
  constructor({ onTranscript, onSpeakingChange, onProgress, onComplete, onError }) {
    this.onTranscript = onTranscript;
    this.onSpeakingChange = onSpeakingChange;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    this.segments = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isCancelled = false;
    this.speed = 1.0;
    this.wsManager = null;

    // TTS voice cache
    this._repVoice = null;
    this._prospectVoice = null;
    this._voicesReady = false;

    // Preload voices
    this._initVoices();
  }

  _initVoices() {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) return;

      this._voicesReady = true;

      // Pick distinct voices for rep vs prospect
      // Prefer English voices; use male-sounding for rep, female-sounding for prospect
      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      const fallback = enVoices.length > 0 ? enVoices : voices;

      // Try to find specifically named voices for variety
      const maleKeywords = ['male', 'david', 'james', 'daniel', 'mark', 'google uk english male'];
      const femaleKeywords = ['female', 'samantha', 'karen', 'victoria', 'zira', 'google uk english female'];

      this._repVoice = fallback.find(v =>
        maleKeywords.some(k => v.name.toLowerCase().includes(k))
      ) || fallback[0];

      this._prospectVoice = fallback.find(v =>
        femaleKeywords.some(k => v.name.toLowerCase().includes(k))
      ) || fallback[Math.min(1, fallback.length - 1)];

      // If both ended up the same, just use different pitch later
      console.log(`🎤 TTS voices loaded — Rep: "${this._repVoice?.name}", Prospect: "${this._prospectVoice?.name}"`);
    };

    // Voices may load asynchronously
    if (synth.getVoices().length > 0) {
      loadVoices();
    }
    synth.addEventListener('voiceschanged', loadVoices);
  }

  /**
   * Start the demo playback.
   * @param {WebSocketManager} wsManager — connected to /ws/coaching
   * @param {number} speed — playback speed multiplier
   */
  async start(wsManager, speed = 1.0) {
    this.wsManager = wsManager;
    this.speed = speed;
    this.isPlaying = true;
    this.isCancelled = false;
    this.currentIndex = 0;

    try {
      // Fetch demo transcript from backend
      const res = await fetch(`${API_BASE}/api/demo-transcript`);
      if (!res.ok) throw new Error(`Failed to fetch demo transcript: ${res.status}`);
      const data = await res.json();
      this.segments = data.segments || [];

      if (this.segments.length === 0) {
        throw new Error('Demo transcript has no segments');
      }

      console.log(`🎬 Demo loaded: ${this.segments.length} segments`);

      // Play each segment sequentially
      for (let i = 0; i < this.segments.length; i++) {
        if (this.isCancelled) break;

        this.currentIndex = i;
        const segment = this.segments[i];

        // Wait for the segment delay (simulates natural conversation pacing)
        const delay = (segment.delay_ms || 2000) / 1000.0 / this.speed;
        if (delay > 0 && i > 0) {
          await this._sleep(delay * 1000);
        }
        if (this.isCancelled) break;

        // Show transcript in UI immediately
        this.onTranscript?.({
          text: segment.text,
          speaker: segment.speaker,
          timestamp: Date.now() / 1000,
        });

        // Send text to backend for coaching analysis
        this.wsManager?.send({
          type: 'demo_text',
          text: segment.text,
          speaker: segment.speaker,
        });

        // Report progress
        this.onProgress?.({
          current: i + 1,
          total: this.segments.length,
          speaker: segment.speaker,
        });

        // Speak via TTS and wait for it to finish
        this.onSpeakingChange?.(segment.speaker);
        await this._speak(segment.text, segment.speaker);
        this.onSpeakingChange?.(null);

        if (this.isCancelled) break;
      }

      if (!this.isCancelled) {
        this.isPlaying = false;
        this.onComplete?.();
      }
    } catch (err) {
      console.error('Demo player error:', err);
      this.isPlaying = false;
      this.onError?.(err.message);
    }
  }

  /**
   * Speak text using the Web Speech Synthesis API.
   * Returns a promise that resolves when speech finishes.
   */
  _speak(text, speaker) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;

      // Cancel any ongoing speech first
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      if (speaker === 'rep') {
        utterance.voice = this._repVoice;
        utterance.pitch = 1.0;
        utterance.rate = 1.05 * this.speed;
      } else {
        utterance.voice = this._prospectVoice;
        utterance.pitch = 1.1;
        utterance.rate = 0.95 * this.speed;
      }

      utterance.volume = 0.8;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        console.warn('TTS error:', e);
        resolve(); // Don't block the demo on TTS errors
      };

      synth.speak(utterance);

      // Chrome bug workaround: long utterances get paused after ~15s
      // Periodically resume to prevent stalling
      const keepAlive = setInterval(() => {
        if (!synth.speaking) {
          clearInterval(keepAlive);
          return;
        }
        synth.pause();
        synth.resume();
      }, 10000);

      utterance.onend = () => {
        clearInterval(keepAlive);
        resolve();
      };
    });
  }

  /**
   * Stop the demo playback.
   */
  stop() {
    this.isCancelled = true;
    this.isPlaying = false;
    window.speechSynthesis.cancel();
    this.onSpeakingChange?.(null);
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      // Check for cancellation
      const check = setInterval(() => {
        if (this.isCancelled) {
          clearTimeout(id);
          clearInterval(check);
          resolve();
        }
      }, 100);
      // Also clear the check interval when the sleep finishes normally
      setTimeout(() => clearInterval(check), ms + 50);
    });
  }
}
