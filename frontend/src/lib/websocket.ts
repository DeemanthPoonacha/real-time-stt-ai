/**
 * WebSocket Manager — Handles connection to the FastAPI backend.
 *
 * Supports:
 *   - Auto-reconnection with exponential backoff
 *   - Audio streaming (base64 PCM)
 *   - Event-based message handling
 *   - Connection state management
 */

const WS_BASE = `ws://${window.location.hostname}:8000`;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private onMessage: (data: any) => void;
  private onStateChange: (state: string) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isIntentionalClose = false;
  private endpoint = '/ws/coaching';

  constructor(onMessage: (data: any) => void, onStateChange: (state: string) => void) {
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
  }

  connect(endpoint = '/ws/coaching') {
    this.endpoint = endpoint;
    this.isIntentionalClose = false;

    try {
      this.ws = new WebSocket(`${WS_BASE}${endpoint}`);

      this.ws.onopen = () => {
        console.log(`✅ WebSocket connected to ${endpoint}`);
        this.reconnectAttempts = 0;
        this.onStateChange('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`🔌 WebSocket disconnected (code: ${event.code})`);
        this.onStateChange('disconnected');

        if (!this.isIntentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})...`);
          this.reconnectAttempts++;
          setTimeout(() => this.connect(this.endpoint), delay);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onStateChange('error');
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.onStateChange('error');
    }
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendAudio(base64Audio: string) {
    this.send({ type: 'audio', data: base64Audio });
  }

  sendConfig(config: any) {
    this.send({ type: 'config', ...config });
  }

  sendReset() {
    this.send({ type: 'reset' });
  }

  startDemo(speed = 1.0) {
    this.send({ type: 'start', speed });
  }

  disconnect() {
    this.isIntentionalClose = true;
    this.ws?.close();
    this.ws = null;
    this.onStateChange('disconnected');
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * AudioCapture — Manages microphone capture and audio streaming.
 *
 * Captures audio via MediaRecorder API, converts to 16-bit PCM,
 * and sends base64-encoded chunks via the WebSocket manager.
 */
export class AudioCapture {
  private wsManager: WebSocketManager;
  private onAudioLevel: (level: number) => void;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private isRecording = false;
  private animationFrame: number | null = null;
  private options: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };

  constructor(
    wsManager: WebSocketManager,
    onAudioLevel: (level: number) => void,
    options: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean } = {}
  ) {
    this.wsManager = wsManager;
    this.onAudioLevel = onAudioLevel;
    this.options = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...options
    };
  }

  async start(): Promise<boolean> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: this.options.echoCancellation,
          noiseSuppression: this.options.noiseSuppression,
          autoGainControl: this.options.autoGainControl,
        }
      });

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Analyser for audio level visualization
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // ScriptProcessor for raw PCM capture
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Convert float32 to int16
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        this.wsManager.sendAudio(base64);
      };

      this.isRecording = true;
      this._updateAudioLevel();

      return true;
    } catch (e) {
      console.error('Failed to capture audio:', e);
      return false;
    }
  }

  private _updateAudioLevel() {
    if (!this.analyser || !this.isRecording) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // Calculate average level (0-1)
    const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length / 255;
    this.onAudioLevel(avg);

    this.animationFrame = requestAnimationFrame(() => this._updateAudioLevel());
  }

  stop() {
    this.isRecording = false;

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    this.onAudioLevel(0);
  }
}
