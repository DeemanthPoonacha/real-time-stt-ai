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
const MAX_CONV_LIMIT = 10;

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
  private isDynamic = true;
  private dynamicTurnCount = 0;

  // Web Audio elements for streaming TTS output to WebSocket
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

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

  async handleDynamicProspectResponse(text: string) {
    if (this.isCancelled) return;

    console.log(`🤖 demoPlayer: Received dynamic prospect response: "${text}"`);

    // 1. Report progress
    this.onProgress?.({
      current: this.dynamicTurnCount,
      total: MAX_CONV_LIMIT,
      speaker: 'prospect',
    });
    this.dynamicTurnCount++;

    // 2. Speak prospect's text via TTS and wait for it to finish (this streams the audio to backend STT)
    this.onSpeakingChange?.('prospect');
    await this._speak(text, 'prospect');
    this.onSpeakingChange?.(null);

    if (this.isCancelled) return;

    // 5. Wait for pacing delay before representative speaks
    const pacingDelay = (2500 / this.speed);
    await this._sleep(pacingDelay);

    if (this.isCancelled) return;

    // End call if we reached the turn limit (MAX_CONV_LIMIT turns total)
    if (this.dynamicTurnCount > MAX_CONV_LIMIT && !this.isCancelled) {
      console.log("🏁 demoPlayer: Reached dynamic turn limit. Completing demo.");

      // Let's speak a concluding line to wrap up cleanly
      const wrapupText = this.language === 'he'
        ? "נהדר שרה, אשלח לך את הסיכום והתמחור והצעת ה-CTO מייד. תודה רבה!"
        : "Great Sarah, I will send you the cost summary and the CTO call proposal right away. Thank you!";

      this.onTranscript?.({
        text: wrapupText,
        speaker: 'rep',
        timestamp: Date.now() / 1000,
      });

      this.onSpeakingChange?.('rep');
      await this._speak(wrapupText, 'rep');
      this.onSpeakingChange?.(null);

      this.onComplete?.();

      return;
    }

    // 6. Representative speaks the dynamic AI script suggested by the AI Coach.
    // Wait for the coaching script suggestion to be generated.
    let script = this.latestRepScript;
    if (!script) {
      console.log("⏳ demoPlayer: Waiting for AI representative suggestion script...");
      for (let attempt = 0; attempt < 45; attempt++) {
        await this._sleep(100);
        if (this.latestRepScript) {
          script = this.latestRepScript;
          break;
        }
      }
    }

    if (!script) {
      // Fallback if AI coaching fails or is too slow to load
      script = this.language === 'he'
        ? "הבנתי. בואי נדבר על איך נוכל לעזור לכם לפתור את זה."
        : "I see. Let's discuss how we can help you solve that.";
    }

    // Reset rep script
    this.latestRepScript = null;

    // Retrieve pre-fetched dynamic audio if available
    const audioToPlay = this.audioCache.get('dynamic-rep') || null;
    this.audioCache.delete('dynamic-rep');

    // Show representative transcript in UI
    this.onTranscript?.({
      text: script,
      speaker: 'rep',
      timestamp: Date.now() / 1000,
    });

    // Report progress
    this.onProgress?.({
      current: this.dynamicTurnCount,
      total: MAX_CONV_LIMIT,
      speaker: 'rep',
    });
    this.dynamicTurnCount++;

    // Speak representative script
    this.onSpeakingChange?.('rep');
    await this._speak(script, 'rep', audioToPlay);
    this.onSpeakingChange?.(null);

    // Send rep response to backend to trigger the next dynamic prospect turn!
    this.wsManager?.send({
      type: 'demo_text',
      text: script,
      speaker: 'rep',
    });

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

      if (this.isDynamic) {
        this.dynamicTurnCount = 1;
        const greetingSegment = this.segments[0];
        console.log(`🎬 Running Demo in Dynamic AI-vs-AI mode! Initial greeting: "${greetingSegment.text}"`);

        // Show greeting in UI
        this.onTranscript?.({
          text: greetingSegment.text,
          speaker: greetingSegment.speaker,
          timestamp: Date.now() / 1000,
        });

        // Report initial progress
        this.onProgress?.({
          current: 1,
          total: MAX_CONV_LIMIT,
          speaker: greetingSegment.speaker,
        });

        // Speak greeting
        this.onSpeakingChange?.(greetingSegment.speaker);
        await this._speak(greetingSegment.text, greetingSegment.speaker);
        this.onSpeakingChange?.(null);

        // Send greeting to backend to kick off conversation history and prospect generator
        this.wsManager?.send({
          type: 'demo_text',
          text: greetingSegment.text,
          speaker: greetingSegment.speaker,
        });
        return;
      }

      // Pre-fetch the first segment (static fallback mode)
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

        if (segment.speaker === 'rep') {
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
        }

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
        // Send backup text message to backend so that conversation doesn't get stuck if streaming fails
        if (speaker === 'prospect') {
          console.log(`⚠️ demoPlayer: TTS failed, sending prospect text as backup fallback: "${text}"`);
          this.wsManager?.send({
            type: 'demo_text',
            text: text,
            speaker: 'prospect',
          });
        }

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

      if (speaker === 'prospect') {
        this._startStreamingAudio(audio);
      }

      audio.onended = () => {
        this._stopStreamingAudio();
        (this as any)._activeAudio = null;
        resolve();
      };

      audio.onerror = (e) => {
        this._stopStreamingAudio();
        console.warn("Backend neural TTS proxy failed, falling back to local speech synthesis:", e);
        (this as any)._activeAudio = null;
        fallbackToLocal();
      };

      (this as any)._activeAudio = audio;
      audio.play().catch(err => {
        this._stopStreamingAudio();
        console.warn("Audio play blocked, falling back to local speech synthesis:", err);
        (this as any)._activeAudio = null;
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
    this._stopStreamingAudio();
    if ((this as any)._activeAudio) {
      try {
        (this as any)._activeAudio.pause();
      } catch (e) { }
      (this as any)._activeAudio = null;
    }
    this.audioCache.clear();
    this.latestRepScript = null;
    this.onSpeakingChange?.(null);
  }

  private _startStreamingAudio(audio: HTMLAudioElement) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
        });
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      audio.crossOrigin = 'anonymous';

      const source = this.audioContext.createMediaElementSource(audio);
      this.sourceNode = source;
      source.connect(this.audioContext.destination);

      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(this.audioContext.destination);
      this.processor = processor;

      processor.onaudioprocess = (e) => {
        if (this.isCancelled || !this.wsManager) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        this.wsManager.send({
          type: 'audio',
          data: base64,
          speaker: 'prospect',
        });
      };
    } catch (err) {
      console.error('Failed to stream audio of element:', err);
    }
  }

  private _stopStreamingAudio() {
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) {}
      this.processor = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
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
