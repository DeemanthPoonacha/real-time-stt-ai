import { WebSocketManager } from './websocket';

interface DemoPlayerOptions {
  onTranscript?: (segment: { text: string; speaker: string; timestamp: number }) => void;
  onSpeakingChange?: (speaker: string | null) => void;
  onProgress?: (progress: { current: number; total: number; speaker: string }) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

interface Segment {
  text: string;
  speaker: string;
  delay_ms?: number;
}

const API_BASE = `http://${window.location.hostname}:8000`;

export class DemoPlayer {
  private onTranscript?: (segment: { text: string; speaker: string; timestamp: number }) => void;
  private onSpeakingChange?: (speaker: string | null) => void;
  private onProgress?: (progress: { current: number; total: number; speaker: string }) => void;
  private onComplete?: () => void;
  private onError?: (message: string) => void;

  private segments: Segment[] = [];
  private isCancelled = false;
  private speed = 1.0;
  private wsManager: WebSocketManager | null = null;

  // TTS voice cache
  private _repVoice: SpeechSynthesisVoice | null = null;
  private _prospectVoice: SpeechSynthesisVoice | null = null;

  constructor({ onTranscript, onSpeakingChange, onProgress, onComplete, onError }: DemoPlayerOptions) {
    this.onTranscript = onTranscript;
    this.onSpeakingChange = onSpeakingChange;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;

    // Preload voices
    this._initVoices();
  }

  private _initVoices() {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) return;

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

      console.log(`🎤 TTS voices loaded — Rep: "${this._repVoice?.name}", Prospect: "${this._prospectVoice?.name}"`);
      const hebrewVoices = voices.filter(v => v.lang.startsWith('he') || v.lang.startsWith('iw'));
      console.log(`🇮🇱 Available Hebrew TTS voices:`, hebrewVoices.map(v => `${v.name} (${v.lang})`));
    };

    // Voices may load asynchronously
    if (synth.getVoices().length > 0) {
      loadVoices();
    }
    synth.addEventListener('voiceschanged', loadVoices);
  }

  language = 'en';

  /**
   * Start the demo playback.
   * @param wsManager — connected to /ws/coaching
   * @param speed — playback speed multiplier
   * @param language — transcript language ('en' | 'he')
   */
  async start(wsManager: WebSocketManager, speed = 1.0, language = 'en') {
    this.wsManager = wsManager;
    this.speed = speed;
    this.language = language;
    this.isCancelled = false;

    try {
      // Fetch demo transcript from backend
      const res = await fetch(`${API_BASE}/api/demo-transcript?language=${language}`);
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
        this.onComplete?.();
      }
    } catch (err: any) {
      console.error('Demo player error:', err);
      this.onError?.(err.message);
    }
  }

  /**
   * Speak text using the Web Speech Synthesis API.
   * Returns a promise that resolves when speech finishes.
   */
  private _speak(text: string, speaker: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;

      // Cancel any ongoing speech first
      synth.cancel();

      if (this.language === 'he') {
        const heVoices = synth.getVoices().filter(v => v.lang.startsWith('he') || v.lang.startsWith('iw'));
        if (heVoices.length > 0) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'he-IL';
          utterance.voice = speaker === 'rep' ? heVoices[0] : (heVoices[1] || heVoices[0]);
          utterance.pitch = speaker === 'rep' ? 1.0 : 1.15;
          utterance.rate = 1.0 * this.speed;
          utterance.volume = 0.8;
          
          utterance.onend = () => resolve();
          utterance.onerror = (e) => {
            console.warn('TTS error:', e);
            resolve();
          };
          synth.speak(utterance);
        } else {
          console.log("🔊 No local Hebrew TTS voice found. Falling back to backend Google Translate TTS proxy...");
          const ttsUrl = `${API_BASE}/api/tts?lang=he&text=${encodeURIComponent(text)}`;
          const audio = document.createElement('audio');
          audio.src = ttsUrl;
          audio.playbackRate = this.speed;
          audio.volume = 0.8;
          
          audio.onended = () => {
            (this as any)._activeAudio = null;
            resolve();
          };
          audio.onerror = (e) => {
            console.warn("Google TTS audio play failed:", e);
            (this as any)._activeAudio = null;
            resolve();
          };
          
          (this as any)._activeAudio = audio;
          audio.play().catch(err => {
            console.warn("Audio play blocked by browser autoplay policy:", err);
            resolve();
          });
        }
      } else {
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
          resolve();
        };

        synth.speak(utterance);

        // Chrome bug workaround: long utterances get paused after ~15s
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
      }
    });
  }

  /**
   * Stop the demo playback.
   */
  stop() {
    this.isCancelled = true;
    window.speechSynthesis.cancel();
    if ((this as any)._activeAudio) {
      try {
        (this as any)._activeAudio.pause();
      } catch (e) {}
      (this as any)._activeAudio = null;
    }
    this.onSpeakingChange?.(null);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (this.isCancelled) {
          clearTimeout(id);
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => clearInterval(check), ms + 50);
    });
  }
}
