import { WebSocketManager } from './websocket';

interface DemoPlayerOptions {
  onTranscript?: (segment: { text: string; speaker: string; timestamp: number }) => void;
  onSpeakingChange?: (speaker: string | null) => void;
  onProgress?: (progress: { current: number; total: number; speaker: string }) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
  clearLatestRepScript?: () => void;
  onCoachingSuggestion?: (suggestion: { type: string; suggestion: string; title?: string; priority?: string; script?: string }) => void;
}

interface Segment {
  text: string;
  speaker: string;
  delay_ms?: number;
}

const API_BASE = `http://${window.location.hostname}:8000`;
const MAX_CONV_LIMIT = 15;

export class DemoPlayer {
  private onTranscript?: (segment: { text: string; speaker: string; timestamp: number }) => void;
  private onSpeakingChange?: (speaker: string | null) => void;
  private onProgress?: (progress: { current: number; total: number; speaker: string }) => void;
  private onComplete?: () => void;
  private onError?: (message: string) => void;
  private clearLatestRepScript?: () => void;
  private onCoachingSuggestion?: (suggestion: { type: string; suggestion: string; title?: string; priority?: string; script?: string }) => void;

  private segments: Segment[] = [];
  private isCancelled = false;
  private speed = 1.0;
  private wsManager: WebSocketManager | null = null;

  // TTS voice cache (for browser synthesis fallbacks)
  private _repVoice: SpeechSynthesisVoice | null = null;
  private _prospectVoice: SpeechSynthesisVoice | null = null;

  // Low-latency cache and dynamic response state
  private audioCache = new Map<string, HTMLAudioElement>();
  private isDynamic = true;
  private dynamicTurnCount = 0;
  private waitingForFlush = false;
  private repTriggerResolve: ((script: string) => void) | null = null;
  private interruptedByRepScript: string | null = null;
  private activeSpeakResolve: (() => void) | null = null;

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
    clearLatestRepScript,
    onCoachingSuggestion
  }: DemoPlayerOptions) {
    this.onTranscript = onTranscript;
    this.onSpeakingChange = onSpeakingChange;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    this.clearLatestRepScript = clearLatestRepScript;
    this.onCoachingSuggestion = onCoachingSuggestion;

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

    // Start pre-fetching the audio for this dynamic script
    const ttsUrl = `${API_BASE}/api/tts?lang=${this.language}&speaker=rep&text=${encodeURIComponent(script.trim())}`;
    console.log(`📡 demoPlayer: Pre-fetching dynamic AI response audio: "${script.substring(0, 30)}..."`);
    const audio = new Audio(ttsUrl);
    audio.load();
    this.audioCache.set('dynamic-rep', audio);
  }

  handleFlushDone() {
    console.log("🏁 demoPlayer: STT buffer flushed and final coaching suggestions streamed.");
    this.waitingForFlush = false;
  }

  waitForRepTrigger(): Promise<string> {
    return new Promise((resolve) => {
      this.repTriggerResolve = resolve;
    });
  }

  triggerRepresentativeResponse(script: string) {
    console.log(`📡 demoPlayer: triggerRepresentativeResponse called with script: "${script.substring(0, 30)}..."`);
    
    // Stop any active audio or local speech synthesis
    if ((this as any)._activeAudio) {
      try {
        (this as any)._activeAudio.pause();
        this._stopStreamingAudio();
      } catch (e) {}
      (this as any)._activeAudio = null;
    }
    window.speechSynthesis.cancel();

    // Resolve any active speak promise immediately to unblock execution loops
    if (this.activeSpeakResolve) {
      const resolveFn = this.activeSpeakResolve;
      this.activeSpeakResolve = null;
      resolveFn();
    }

    if (this.repTriggerResolve) {
      const resolveFn = this.repTriggerResolve;
      this.repTriggerResolve = null;
      resolveFn(script);
    } else {
      // Interrupt current step and force jump to rep turn
      this.interruptedByRepScript = script;
      this.waitingForFlush = false; // abort flush wait if any
    }
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

  private async speakRepScript(scriptToSpeak: string) {
    this.interruptedByRepScript = null; // Reset the flag

    // Show representative transcript in UI
    this.onTranscript?.({
      text: scriptToSpeak,
      speaker: 'rep',
      timestamp: Date.now() / 1000,
    });

    // Report progress
    const totalTurns = this.isDynamic ? MAX_CONV_LIMIT : this.segments.length;
    this.onProgress?.({
      current: this.dynamicTurnCount,
      total: totalTurns,
      speaker: 'rep',
    });
    this.dynamicTurnCount++;

    // Speak representative script
    this.onSpeakingChange?.('rep');
    // Retrieve pre-fetched dynamic audio if available
    const audioToPlay = this.audioCache.get('dynamic-rep') || null;
    this.audioCache.delete('dynamic-rep');
    
    await this._speak(scriptToSpeak, 'rep', audioToPlay);
    this.onSpeakingChange?.(null);

    // Send rep response to backend to trigger the next dynamic prospect turn!
    this.wsManager?.send({
      type: 'demo_text',
      text: scriptToSpeak,
      speaker: 'rep',
    });
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

    // Check interruption BEFORE speaking
    if (this.interruptedByRepScript !== null) {
      await this.speakRepScript(this.interruptedByRepScript);
      return;
    }

    // 2. Speak prospect's text via TTS and wait for it to finish (this streams the audio to backend STT)
    this.onSpeakingChange?.('prospect');
    await this._speak(text, 'prospect');
    this.onSpeakingChange?.(null);

    if (this.isCancelled) return;

    // Check interruption AFTER speaking (during flush)
    if (this.interruptedByRepScript !== null) {
      await this.speakRepScript(this.interruptedByRepScript);
      return;
    }

    // 3. Flush the backend STT buffer and wait for the final suggestion to finish streaming
    if (this.wsManager) {
      console.log("📡 demoPlayer: Sending flush to backend STT...");
      this.waitingForFlush = true;
      this.wsManager.send({
        type: 'flush',
        speaker: 'prospect',
      });
      // Wait for flush to be complete (deterministic backend-driven sync loop)
      while (this.waitingForFlush && !this.isCancelled) {
        if (this.interruptedByRepScript !== null) {
          this.waitingForFlush = false;
          await this.speakRepScript(this.interruptedByRepScript);
          return;
        }
        await this._sleep(100);
      }
    }

    if (this.isCancelled) return;

    // End call if we reached the turn limit (MAX_CONV_LIMIT turns total)
    const isWrapUp = this.dynamicTurnCount >= MAX_CONV_LIMIT;

    if (isWrapUp) {
      console.log("🏁 demoPlayer: Reached dynamic turn limit. Offering final wrap-up script.");

      const wrapupScript = this.language === 'he'
        ? "מצוין שרה, אשלח לך את כל החומרים וההשוואה עוד היום. תודה רבה והמשך יום נהדר!"
        : this.language === 'es'
        ? "Excelente Sarah, te enviaré todos los materiales y la tabla comparativa hoy mismo. ¡Muchas gracias y que tengas un excelente día!"
        : this.language === 'fr'
        ? "Excellent Sarah, je t'enverrai tous les documents et le tableau comparatif plus tard aujourd'hui. Merci pour ton temps et bonne journée !"
        : "Excellent Sarah, I'll send over all the materials and the comparison table later today. Thanks for your time and have a great day!";

      this.onCoachingSuggestion?.({
        type: 'closing',
        title: this.language === 'he' ? 'סיכום וסיום השיחה'
          : this.language === 'es' ? 'Resumen y fin de la llamada'
          : this.language === 'fr' ? 'Synthèse et fin de l\'appel'
          : 'Wrap Up & End Call',
        suggestion: this.language === 'he'
          ? 'השיחה הגיעה לסיומה. הודה ללקוח וסכם את הצעדים הבאים.'
          : this.language === 'es'
          ? 'La conversación está terminando. Agradezca al cliente y resuma los próximos pasos.'
          : this.language === 'fr'
          ? 'La conversation se termine. Remerciez le client et résumez les prochaines étapes.'
          : 'The conversation is wrapping up. Thank the customer and summarize the next steps.',
        script: wrapupScript,
        priority: 'high'
      });

      // Wait for user to trigger rep response
      console.log("⏳ demoPlayer: Pausing. Awaiting user's manual trigger for the final call wrap-up script...");
      const scriptToSpeak = await this.waitForRepTrigger();

      if (this.isCancelled) return;

      // Show representative transcript in UI
      this.onTranscript?.({
        text: scriptToSpeak,
        speaker: 'rep',
        timestamp: Date.now() / 1000,
      });

      // Report final progress
      this.onProgress?.({
        current: this.dynamicTurnCount,
        total: MAX_CONV_LIMIT,
        speaker: 'rep',
      });
      this.dynamicTurnCount++;

      // Speak representative script
      this.onSpeakingChange?.('rep');
      await this._speak(scriptToSpeak, 'rep');
      this.onSpeakingChange?.(null);

      // Send rep response to backend to keep history in sync, but do not wait for another prospect turn
      this.wsManager?.send({
        type: 'demo_text',
        text: scriptToSpeak,
        speaker: 'rep',
      });

      // Complete the demo player
      this.onComplete?.();
      return;
    }

    // 4. Wait for the user to trigger the representative's response by clicking the play button next to the suggestion
    console.log("⏳ demoPlayer: Pausing. Awaiting user's manual trigger via 'Speak Suggested Script' button...");
    const scriptToSpeak = await this.waitForRepTrigger();

    if (this.isCancelled) return;

    await this.speakRepScript(scriptToSpeak);
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

        // 1. Show greeting on Coaching Panel as a suggested script card
        this.onCoachingSuggestion?.({
          type: 'script',
          title: this.language === 'he' ? 'פתח שיחה: ברכה ראשונית'
            : this.language === 'es' ? 'Apertura de llamada: Saludo inicial'
            : this.language === 'fr' ? 'Ouverture de l\'appel : Salutation initiale'
            : 'Call Opener: Initial Greeting',
          suggestion: this.language === 'he' 
            ? 'התחל את השיחה על ידי ברכת הלקוח והצגת עצמך.' 
            : this.language === 'es'
            ? 'Inicie la conversación saludando al cliente y presentándose.'
            : this.language === 'fr'
            ? 'Commencez la conversation en saluant le client et en vous présentant.'
            : 'Start the conversation by greeting the customer and introducing yourself.',
          script: greetingSegment.text,
          priority: 'high'
        });

        // 2. Wait for the user to click the "Speak Suggested Script" button on the greeting card
        console.log("⏳ demoPlayer: Pausing. Awaiting user's trigger for the initial greeting greeting segment...");
        const scriptToSpeak = await this.waitForRepTrigger();

        if (this.isCancelled) return;

        // 3. Show greeting in UI
        this.onTranscript?.({
          text: scriptToSpeak,
          speaker: 'rep',
          timestamp: Date.now() / 1000,
        });

        // 4. Report initial progress
        this.onProgress?.({
          current: 1,
          total: MAX_CONV_LIMIT,
          speaker: 'rep',
        });
        this.dynamicTurnCount++;

        // 5. Speak greeting
        this.onSpeakingChange?.('rep');
        await this._speak(scriptToSpeak, 'rep');
        this.onSpeakingChange?.(null);

        if (this.isCancelled) return;

        // 6. Send greeting to backend to kick off conversation history and prospect generator
        this.wsManager?.send({
          type: 'demo_text',
          text: scriptToSpeak,
          speaker: 'rep',
        });
        return;
      }

      // Pre-fetch the first segment (static fallback mode)
      this._prefetchNextSegment(0);

      // Play each segment sequentially
      for (let i = 0; i < this.segments.length; i++) {
        if (this.isCancelled) break;

        if (this.interruptedByRepScript !== null) {
          await this.speakRepScript(this.interruptedByRepScript);
          continue;
        }

        // Pre-fetch the next segment in the background
        this._prefetchNextSegment(i + 1);

        const segment = this.segments[i];

        // Wait for the segment delay (simulates natural pacing)
        const delay = (segment.delay_ms || 2000) / 1000.0 / this.speed;
        if (delay > 0 && i > 0) {
          await this._sleep(delay * 1000);
        }
        if (this.isCancelled) break;

        if (this.interruptedByRepScript !== null) {
          await this.speakRepScript(this.interruptedByRepScript);
          continue;
        }

        let textToSpeak = segment.text;
        let audioToPlay: HTMLAudioElement | null = null;

        if (segment.speaker === 'rep') {
          const suggestionTitle = i === 0
            ? (this.language === 'he' ? 'פתח שיחה: ברכה ראשונית'
              : this.language === 'es' ? 'Apertura de llamada: Saludo inicial'
              : this.language === 'fr' ? 'Ouverture de l\'appel : Salutation initiale'
              : 'Call Opener: Initial Greeting')
            : (this.language === 'he' ? 'תסריט מוצע'
              : this.language === 'es' ? 'Guion sugerido'
              : this.language === 'fr' ? 'Script suggéré'
              : 'Suggested Script');
          const suggestionDesc = i === 0
            ? (this.language === 'he' ? 'התחל את השיחה על ידי ברכת הלקוח והצגת עצמך.'
              : this.language === 'es' ? 'Inicie la conversación saludando al cliente y presentándose.'
              : this.language === 'fr' ? 'Commencez la conversation en saluant le client et en vous présentant.'
              : 'Start the conversation by greeting the customer and introducing yourself.')
            : (this.language === 'he' ? 'קרא את התסריט המוצע לפרק זה.'
              : this.language === 'es' ? 'Diga el guion sugerido para este segmento.'
              : this.language === 'fr' ? 'Dites le script suggéré pour ce segment.'
              : 'Speak the suggested talk track for this segment.');
          const suggestionPriority = i === 0 ? 'high' : 'medium';

          this.onCoachingSuggestion?.({
            type: 'script',
            title: suggestionTitle,
            suggestion: suggestionDesc,
            script: textToSpeak,
            priority: suggestionPriority
          });

          console.log(`⏳ demoPlayer (static): Pausing at segment ${i}. Awaiting user trigger...`);
          textToSpeak = await this.waitForRepTrigger();

          this.clearLatestRepScript?.();
          audioToPlay = this.audioCache.get('dynamic-rep') || null;
          this.audioCache.delete('dynamic-rep');
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

        if (this.interruptedByRepScript !== null) {
          await this.speakRepScript(this.interruptedByRepScript);
          continue;
        }

        // Flush and wait for suggestions if the prospect was speaking
        if (segment.speaker === 'prospect' && this.wsManager) {
          console.log("📡 demoPlayer (static): Sending flush to backend STT...");
          this.waitingForFlush = true;
          this.wsManager.send({
            type: 'flush',
            speaker: 'prospect',
          });
          while (this.waitingForFlush && !this.isCancelled) {
            if (this.interruptedByRepScript !== null) {
              this.waitingForFlush = false;
              await this.speakRepScript(this.interruptedByRepScript);
              break;
            }
            await this._sleep(100);
          }
        }

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

      const handleResolve = () => {
        this.activeSpeakResolve = null;
        resolve();
      };

      this.activeSpeakResolve = handleResolve;

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
            utterance.onend = handleResolve;
            utterance.onerror = handleResolve;
            synth.speak(utterance);
          } else {
            handleResolve();
          }
        } else if (this.language === 'es') {
          const esVoices = synth.getVoices().filter(v => v.lang.startsWith('es'));
          if (esVoices.length > 0) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.voice = speaker === 'rep' ? esVoices[0] : (esVoices[1] || esVoices[0]);
            utterance.pitch = speaker === 'rep' ? 1.0 : 1.1;
            utterance.rate = 1.0 * this.speed;
            utterance.volume = 0.8;
            utterance.onend = handleResolve;
            utterance.onerror = handleResolve;
            synth.speak(utterance);
          } else {
            handleResolve();
          }
        } else if (this.language === 'fr') {
          const frVoices = synth.getVoices().filter(v => v.lang.startsWith('fr'));
          if (frVoices.length > 0) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'fr-FR';
            utterance.voice = speaker === 'rep' ? frVoices[0] : (frVoices[1] || frVoices[0]);
            utterance.pitch = speaker === 'rep' ? 1.0 : 1.1;
            utterance.rate = 1.0 * this.speed;
            utterance.volume = 0.8;
            utterance.onend = handleResolve;
            utterance.onerror = handleResolve;
            synth.speak(utterance);
          } else {
            handleResolve();
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
          utterance.onend = handleResolve;
          utterance.onerror = handleResolve;
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
        handleResolve();
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
    this.repTriggerResolve = null;
    if ((this as any)._activeAudio) {
      try {
        (this as any)._activeAudio.pause();
      } catch (e) { }
      (this as any)._activeAudio = null;
    }
    this.audioCache.clear();
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
