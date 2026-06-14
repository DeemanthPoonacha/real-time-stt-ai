import { useState, useCallback, useRef, useEffect } from 'react';
import AudioControls from './components/AudioControls';
import LiveTranscript from './components/LiveTranscript';
import CoachingPanel from './components/CoachingPanel';
import CallStats from './components/CallStats';
import PlaybookSidebar from './components/PlaybookSidebar';
import { WebSocketManager, AudioCapture } from './lib/websocket';
import { DemoPlayer } from './lib/demoPlayer';

export default function App() {
  // --- State ---
  const [connectionState, setConnectionState] = useState('disconnected');
  const [isRecording, setIsRecording] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [language, setLanguage] = useState('en');
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcriptSegments, setTranscriptSegments] = useState([]);
  const [coachingSuggestions, setCoachingSuggestions] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [callStartTime, setCallStartTime] = useState(null);
  const [objectionsDetected, setObjectionsDetected] = useState(0);
  const [demoSpeaker, setDemoSpeaker] = useState(null); // who is currently speaking in demo
  const [demoProgress, setDemoProgress] = useState(null); // {current, total}

  // --- Refs ---
  const wsRef = useRef(null);
  const audioRef = useRef(null);
  const demoRef = useRef(null);
  const isDemoRef = useRef(isDemo);
  const demoSpeakerRef = useRef(demoSpeaker);

  // Keep refs in sync with state for use inside useCallback closures
  useEffect(() => {
    isDemoRef.current = isDemo;
  }, [isDemo]);

  useEffect(() => {
    demoSpeakerRef.current = demoSpeaker;
  }, [demoSpeaker]);

  // --- WebSocket Message Handler ---
  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'transcript':
        // Map transcript to current speaker if in demo mode
        setTranscriptSegments(prev => [...prev, {
          text: data.text,
          speaker: isDemoRef.current ? (demoSpeakerRef.current || 'prospect') : (data.speaker || 'unknown'),
          timestamp: data.timestamp,
          language: data.language,
        }]);
        break;

      case 'coaching':
        if (data.data) {
          setCoachingSuggestions(prev => [...prev, data.data]);
          if (data.data.type === 'objection') {
            setObjectionsDetected(prev => prev + 1);
          }
        }
        setStreamingText('');
        setIsStreaming(false);
        break;

      case 'coaching_stream':
        if (data.done) {
          setIsStreaming(false);
        } else {
          setIsStreaming(true);
          setStreamingText(prev => prev + (data.chunk || ''));
        }
        break;

      case 'status':
        if (data.state === 'completed') {
          // Don't auto-clear demo — that's handled by DemoPlayer.onComplete
        } else if (data.state === 'playing') {
          setConnectionState('processing');
        } else {
          setConnectionState(data.state === 'ready' ? 'connected' : data.state);
        }
        break;

      case 'error':
        console.error('Server error:', data.message);
        break;

      default:
        break;
    }
  }, []);

  // --- Connection State Handler ---
  const handleStateChange = useCallback((state) => {
    setConnectionState(state);
  }, []);

  // --- Toggle Recording ---
  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      // Stop
      audioRef.current?.stop();
      audioRef.current = null;
      wsRef.current?.disconnect();
      wsRef.current = null;
      setIsRecording(false);
      setCallStartTime(null);
    } else {
      // Start
      const ws = new WebSocketManager(handleMessage, handleStateChange);
      ws.connect('/ws/coaching');
      wsRef.current = ws;

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 500));

      ws.sendConfig({ language });

      const audio = new AudioCapture(ws, setAudioLevel);
      const started = await audio.start();

      if (started) {
        audioRef.current = audio;
        setIsRecording(true);
        setCallStartTime(Date.now());
      } else {
        ws.disconnect();
        alert('Failed to access microphone. Please check permissions.');
      }
    }
  }, [isRecording, language, handleMessage, handleStateChange]);

  // --- Toggle Demo (TTS-powered with live audio capture) ---
  const handleToggleDemo = useCallback(async () => {
    if (isDemo) {
      // Stop demo
      demoRef.current?.stop();
      demoRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
      wsRef.current?.disconnect();
      wsRef.current = null;
      setIsDemo(false);
      setCallStartTime(null);
      setDemoSpeaker(null);
      setDemoProgress(null);
      setConnectionState('disconnected');
    } else {
      // Connect to coaching WS
      const ws = new WebSocketManager(handleMessage, handleStateChange);
      ws.connect('/ws/coaching');
      wsRef.current = ws;

      // Wait for WS connection
      await new Promise(resolve => setTimeout(resolve, 800));

      ws.sendConfig({ language });

      // Start Audio Capture with echoCancellation disabled so it hears the speakers
      const audio = new AudioCapture(ws, setAudioLevel, {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      });
      const started = await audio.start();

      if (started) {
        audioRef.current = audio;

        const demo = new DemoPlayer({
          onTranscript: (segment) => {
            console.log(`[Demo TTS] ${segment.speaker}: "${segment.text}"`);
          },
          onSpeakingChange: (speaker) => {
            setDemoSpeaker(speaker);
          },
          onProgress: (progress) => {
            setDemoProgress(progress);
            setConnectionState('processing');
          },
          onComplete: () => {
            setIsDemo(false);
            setDemoSpeaker(null);
            setDemoProgress(null);
            setCallStartTime(null);
            setConnectionState('connected');
            audioRef.current?.stop();
            audioRef.current = null;
            wsRef.current?.disconnect();
            wsRef.current = null;
          },
          onError: (msg) => {
            console.error('Demo error:', msg);
            setIsDemo(false);
            setDemoSpeaker(null);
            setDemoProgress(null);
            setCallStartTime(null);
            setConnectionState('disconnected');
            audioRef.current?.stop();
            audioRef.current = null;
            wsRef.current?.disconnect();
            wsRef.current = null;
          },
        });

        demoRef.current = demo;
        setIsDemo(true);
        setCallStartTime(Date.now());

        // Start TTS playback
        demo.start(ws, 1.0);
      } else {
        ws.disconnect();
        alert('Failed to access microphone. Microphone access is required to capture the TTS speaker output for transcription.');
      }
    }
  }, [isDemo, language, handleMessage, handleStateChange]);

  // --- Language Change ---
  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang);
    wsRef.current?.sendConfig({ language: lang });
    // Toggle HTML dir for RTL
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, []);

  // --- Reset ---
  const handleReset = useCallback(() => {
    demoRef.current?.stop();
    demoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    wsRef.current?.disconnect();
    wsRef.current = null;
    setIsRecording(false);
    setIsDemo(false);
    setTranscriptSegments([]);
    setCoachingSuggestions([]);
    setStreamingText('');
    setIsStreaming(false);
    setCallStartTime(null);
    setObjectionsDetected(0);
    setAudioLevel(0);
    setDemoSpeaker(null);
    setDemoProgress(null);
    setConnectionState('disconnected');
    window.speechSynthesis.cancel();
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      demoRef.current?.stop();
      audioRef.current?.stop();
      wsRef.current?.disconnect();
      window.speechSynthesis.cancel();
    };
  }, []);

  // --- Animate audio level during demo TTS ---
  useEffect(() => {
    if (!isDemo || !demoSpeaker) return;

    const interval = setInterval(() => {
      setAudioLevel(0.2 + Math.random() * 0.5);
    }, 120);

    return () => {
      clearInterval(interval);
      setAudioLevel(0);
    };
  }, [isDemo, demoSpeaker]);

  const isActive = isRecording || isDemo;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ===== Top Bar ===== */}
      <header className="glass-card rounded-none border-x-0 border-t-0 px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[--color-accent-blue] to-[--color-accent-violet] flex items-center justify-center shadow-lg shadow-[--color-accent-blue-glow]">
              <span className="text-white text-lg font-bold">S</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[--color-text-primary] tracking-tight">
                SalesCoach <span className="text-[--color-accent-blue]">AI</span>
              </h1>
              <p className="text-[10px] text-[--color-text-muted] uppercase tracking-widest">
                Real-Time Sales Enablement
              </p>
            </div>
          </div>

          {/* Controls */}
          <AudioControls
            isRecording={isRecording}
            isDemo={isDemo}
            connectionState={connectionState}
            audioLevel={audioLevel}
            language={language}
            onToggleRecording={handleToggleRecording}
            onToggleDemo={handleToggleDemo}
            onLanguageChange={handleLanguageChange}
            onReset={handleReset}
          />
        </div>

        {/* Demo TTS indicator */}
        {isDemo && (
          <div className="flex items-center gap-3 mt-3 px-2">
            <div className="flex items-center gap-2">
              <span className="text-xs">🔊</span>
              <span className="text-[10px] uppercase tracking-wider text-[--color-text-muted] font-medium">
                TTS Demo
              </span>
            </div>
            {demoSpeaker && (
              <div className="flex items-center gap-2 animate-fade-in">
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  demoSpeaker === 'rep'
                    ? 'bg-[--color-accent-blue]'
                    : 'bg-[--color-accent-emerald]'
                }`} />
                <span className={`text-xs font-semibold ${
                  demoSpeaker === 'rep'
                    ? 'text-[--color-accent-blue]'
                    : 'text-[--color-accent-emerald]'
                }`}>
                  {demoSpeaker === 'rep' ? 'Sales Rep speaking...' : 'Prospect speaking...'}
                </span>
              </div>
            )}
            {demoProgress && (
              <div className="ml-auto flex items-center gap-2">
                <div className="w-24 h-1.5 bg-[--color-bg-secondary] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[--color-accent-blue] to-[--color-accent-violet] rounded-full transition-all duration-500"
                    style={{ width: `${(demoProgress.current / demoProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-[--color-text-muted] font-mono">
                  {demoProgress.current}/{demoProgress.total}
                </span>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ===== Stats Bar ===== */}
      <div className="px-6 py-3">
        <CallStats
          callStartTime={callStartTime}
          isActive={isActive}
          transcriptCount={transcriptSegments.length}
          suggestionCount={coachingSuggestions.length}
          objectionsDetected={objectionsDetected}
        />
      </div>

      {/* ===== Main Content: 3-Panel Layout ===== */}
      <main className="flex-1 px-6 pb-6 grid grid-cols-12 gap-4 min-h-0">
        {/* Left: Live Transcript */}
        <div className="col-span-4 min-h-0" style={{ height: 'calc(100vh - 220px)' }}>
          <LiveTranscript
            segments={transcriptSegments}
            language={language}
          />
        </div>

        {/* Center: AI Coaching */}
        <div className="col-span-5 min-h-0" style={{ height: 'calc(100vh - 220px)' }}>
          <CoachingPanel
            suggestions={coachingSuggestions}
            streamingText={streamingText}
            isStreaming={isStreaming}
          />
        </div>

        {/* Right: Playbook */}
        <div className="col-span-3 min-h-0" style={{ height: 'calc(100vh - 220px)' }}>
          <PlaybookSidebar />
        </div>
      </main>
    </div>
  );
}
