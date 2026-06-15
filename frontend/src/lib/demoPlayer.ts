import { WebSocketManager } from './websocket';

interface DemoPlayerOptions {
  onTranscript?: (segment: { text: string; speaker: string; timestamp: number }) => void;
  onSpeakingChange?: (speaker: string | null) => void;
  onProgress?: (progress: { current: number; total: number; speaker: string }) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
  getLatestRepScript?: () => string | null;
  clearLatestRepScript?: () => void;
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
  private getLatestRepScript?: () => string | null;
  private clearLatestRepScript?: () => void;

  private segments: Segment[] = [];
  private isCancelled = false;
  private speed = 1.0;
  private wsManager: WebSocketManager | null = null;

  // TTS voice cache (for browser synthesis fallbacks)
  private _repVoice: SpeechSynthesisVoice | null = null;
  private _prospectVoice: SpeechSynthesisVoice | null = null;

  // Low-latency cache and dynamic response state
  private latestRepScript: string | null = null;
  private audioCache = new Map<string, HTMLAudioElement>();

  constructor({
    onTranscript,
    onSpeakingChange,
    onProgress,
    onComplete,
    onError,
    getLatestRepScript,
    clearLatestRepScript
  }: DemoPlayerOptions) {
    this.onTranscript = onTranscript;
    this.onSpeakingChange = onSpeakingChange;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    this.getLatestRepScript = getLatestRepScript;
    this.clearLatestRepScript = clearLatestRepScript;

    // Preload voices
    this._initVoices();
  }

  private _initVoices() {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) return;

      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      const fallback = enVoices.length > 0 ? enVoices : voices;

      const maleKeywords = ['male', 'david', 'james', 'daniel', 'mark', 'google uk english male'];
      const femaleKeywords = ['female', 'samantha', 'karen', 'victoria', 'zira', 'google uk english female'];

      this._repVoice = fallback.find(v =>
          maleKeywords.some(k => v.name.toLowerCase().includes(k))
      ) || fallback[0];

      this._prospectVoice = fallback.find(v =>
          femaleKeywords.some(k => v.name.toLowerCase().includes(k))
      ) || fallback[Math.min(1, fallback.length - 1)];
    };

    if (synth.getVoices().length > 0) {
      loadVoices();
    }
    synth.addEventListener('voiceschanged', loadVoices);
  }

  setDynamicRepScript(script: string) {
    if (!script || !script.trim()) return;
    this.latestRepScript = script;

    // Start pre-fetching the audio for this dynamic script
    const ttsUrl = `${API_BASE}/api/tts?lang=${this.language}&speaker=rep&text=${encodeURIComponent(script.trim())}`;
    console.log(`📡 demoPlayer: Pre-fetching dynamic AI response audio: "${script.substring(0, 30)}..."`);
    const audio = new Audio(ttsUrl);
    audio.load();
    this.audioCache.set('dynamic-rep', audio);
  }

  private _prefetchNextSegment(index: number) {
    if (index >= this.segments.length) return;
    const cacheKey = `static-${index}`;
    if (this.audioCache.has(cacheKey)) return;

    const segment = this.segments[index];
    const text = segment.text.trim();
    if (!text) return;

    const ttsUrl = `${API_BASE}/api/tts?lang=${this.language}&speaker=${segment.speaker}&text=${encodeURIComponent(text)}`;
    console.log(`📡 demoPlayer: Pre-fetching static segment ${index} (${segment.speaker}): "${text.substring(0, 20)}..."`);
    const audio = new Audio(ttsUrl);
    audio.load();
    this.audioCache.set(cacheKey, audio);
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
    this.audioCache.clear();
    this.latestRepScript = null;

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

      // Pre-fetch the first segment
      this._prefetchNextSegment(0);

      // Play each segment sequentially
      for (let i = 0; i < this.segments.length; i++) {
        if (this.isCancelled) break;

        // Pre-fetch the next segment in the background
        this._prefetchNextSegment(i + 1);

        const segment = this.segments[i];

        // Wait for the segment delay (simulates natural pacing)
        const delay = (segment.delay_ms || 2000) / 1000.0 / this.speed;
        if (delay > 0 && i > 0) {
          await this._sleep(delay * 1000);
        }
        if (this.isCancelled) break;

        let textToSpeak = segment.text;
        let audioToPlay: HTMLAudioElement | null = null;

        if (segment.speaker === 'rep') {
          // Check if AI generated a live response for the rep's turn
          const aiScript = this.latestRepScript || this.getLatestRepScript?.();
          if (aiScript && aiScript.trim()) {
            textToSpeak = aiScript;
            this.latestRepScript = null;
            this.clearLatestRepScript?.();

            // Check if we have pre-fetched dynamic audio
            audioToPlay = this.audioCache.get('dynamic-rep') || null;
            this.audioCache.delete('dynamic-rep');
            console.log(`🤖 demoPlayer: Rep speaking live AI response: "${textToSpeak}"`);
          }
        }

        if (!audioToPlay) {
          // Fall back to pre-fetched static audio
          const cacheKey = `static-${i}`;
          audioToPlay = this.audioCache.get(cacheKey) || null;
          this.audioCache.delete(cacheKey);
        }

        // Show transcript in UI immediately
        this.onTranscript?.({
          text: textToSpeak,
          speaker: segment.speaker,
          timestamp: Date.now() / 1000,
        });

        // Send text to backend for coaching analysis (keeps LLM history in sync)
        this.wsManager?.send({
          type: 'demo_text',
          text: textToSpeak,
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
        await this._speak(textToSpeak, segment.speaker, audioToPlay);
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
   * Speak text using Edge TTS proxy (premium neural voices) falling back to Web Speech.
   * Returns a promise that resolves when speech finishes.
   */
  private _speak(text: string, speaker: string, preloadedAudio?: HTMLAudioElement | null): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      synth.cancel();

      const fallbackToLocal = () => {
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
            utterance.onerror = () => resolve();
            synth.speak(utterance);
          } else {
            resolve();
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
          utterance.onerror = () => resolve();
          synth.speak(utterance);
        }
      };

      let audio: HTMLAudioElement;
      if (preloadedAudio) {
        audio = preloadedAudio;
        console.log(`🔊 Playing preloaded TTS audio for speaker "${speaker}"...`);
      } else {
        console.log(`🔊 Playing backend neural TTS proxy for speaker "${speaker}" (${this.language})...`);
        const ttsUrl = `${API_BASE}/api/tts?lang=${this.language}&speaker=${speaker}&text=${encodeURIComponent(text)}`;
        audio = new Audio(ttsUrl);
      }

      audio.playbackRate = this.speed;
      audio.volume = 0.8;

      audio.onended = () => {
        (this as any)._activeAudio = null;
        resolve();
      };
      
      audio.onerror = (e) => {
        console.warn("Backend neural TTS proxy failed, falling back to local speech synthesis:", e);
        (this as any)._activeAudio = null;
        fallbackToLocal();
      };
      
      (this as any)._activeAudio = audio;
      audio.play().catch(err => {
        console.warn("Audio play blocked, falling back to local speech synthesis:", err);
        fallbackToLocal();
      });
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
    this.audioCache.clear();
    this.latestRepScript = null;
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
