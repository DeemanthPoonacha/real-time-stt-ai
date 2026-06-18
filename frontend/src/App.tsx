import { useState, useCallback, useRef, useEffect } from 'react';
import AudioControls from './components/AudioControls';
import LiveTranscript from './components/LiveTranscript';
import CoachingPanel from './components/CoachingPanel';
import CallStats from './components/CallStats';
import PlaybookSidebar from './components/PlaybookSidebar';
import { WebSocketManager, AudioCapture } from './lib/websocket';
import { DemoPlayer } from './lib/demoPlayer';
import { t } from './lib/translations';

interface TranscriptSegment {
  text: string;
  speaker: string;
  timestamp?: number;
  language?: string;
}

interface CoachingSuggestion {
  type: string;
  suggestion: string;
  title?: string;
  priority?: string;
  script?: string;
  retrieved_docs?: Array<{
    text: string;
    source: string;
    source_type: string;
    section?: string;
    distance?: number;
  }>;
}

export default function App() {
  // --- State ---
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isDemo, setIsDemo] = useState<boolean>(false);
  const [language, setLanguage] = useState<string>('en');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [coachingSuggestions, setCoachingSuggestions] = useState<CoachingSuggestion[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [objectionsDetected, setObjectionsDetected] = useState<number>(0);
  const [demoSpeaker, setDemoSpeaker] = useState<string | null>(null); // who is currently speaking in demo
  const [demoProgress, setDemoProgress] = useState<{ current: number; total: number; speaker: string } | null>(null); // {current, total}
  const [activeRetrievedDocs, setActiveRetrievedDocs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'transcript' | 'coaching' | 'playbook'>('coaching');
  const [interimTranscript, setInterimTranscript] = useState<{ text: string; speaker: string } | null>(null);

  // --- Refs ---
  const wsRef = useRef<WebSocketManager | null>(null);
  const audioRef = useRef<AudioCapture | null>(null);
  const demoRef = useRef<DemoPlayer | null>(null);
  const isDemoRef = useRef<boolean>(isDemo);
  const demoSpeakerRef = useRef<string | null>(demoSpeaker);
  const latestRepScriptRef = useRef<string | null>(null);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const awaitingNewProspectTurnRef = useRef<boolean>(false);
  const activeRetrievedDocsRef = useRef<any[]>([]);

  // Keep refs in sync with state for use inside useCallback closures
  useEffect(() => {
    isDemoRef.current = isDemo;
  }, [isDemo]);

  useEffect(() => {
    demoSpeakerRef.current = demoSpeaker;
  }, [demoSpeaker]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    activeRetrievedDocsRef.current = activeRetrievedDocs;
  }, [activeRetrievedDocs]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // --- WebSocket Message Handler ---
  const handleMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'transcript':
        // Map transcript to current speaker if in demo mode, prioritizing backend speaker
        const currentSpeaker = data.speaker || (isDemoRef.current ? (demoSpeakerRef.current || 'prospect') : 'unknown');

        // If representative starts speaking in live mode, prepare to clear suggestions when next prospect turn starts
        if (currentSpeaker === 'rep') {
          awaitingNewProspectTurnRef.current = true;
        } else if (currentSpeaker === 'prospect') {
          // Prospect starts speaking: reset streaming state but retain history
          if (awaitingNewProspectTurnRef.current) {
            setStreamingText('');
            setIsStreaming(false);
            awaitingNewProspectTurnRef.current = false;
          }
        }

        if (data.is_final === false) {
          setInterimTranscript({ text: data.text, speaker: currentSpeaker });
        } else {
          setInterimTranscript(null);
          setTranscriptSegments(prev => [...prev, {
            text: data.text,
            speaker: currentSpeaker,
            timestamp: data.timestamp,
            language: data.language,
          }]);
        }
        break;

      case 'retrieved_docs':
        setActiveRetrievedDocs(data.docs || []);
        break;

      case 'coaching':
        if (data.data) {
          // Attach the activeRetrievedDocs to the finalized suggestion card
          const newSuggestion = {
            ...data.data,
            retrieved_docs: activeRetrievedDocsRef.current
          };
          setCoachingSuggestions(prev => [...prev, newSuggestion]); // Append suggestions
          setActiveTab('coaching'); // Auto switch tab to coaching to highlight new recommendations
          
          
          // Fall back to suggestion description if no script is present to ensure playability
          const repText = data.data.script || data.data.suggestion;
          if (repText) {
            latestRepScriptRef.current = repText;
            if (demoRef.current) {
              demoRef.current.setDynamicRepScript(repText);
            }
          }
          if (data.data.type === 'objection') {
            setObjectionsDetected(prev => prev + 1);
          }
        }
        setStreamingText('');
        setIsStreaming(false);
        break;

      case 'prospect_response':
        if (demoRef.current) {
          demoRef.current.handleDynamicProspectResponse(data.text);
        }
        break;

      case 'flush_done':
        if (demoRef.current) {
          demoRef.current.handleFlushDone();
        }
        break;

      case 'coaching_stream':
        if (data.done) {
          setIsStreaming(false);
        } else {
          if (!isStreamingRef.current) {
            setStreamingText('');
            setIsStreaming(true);
          }
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
  const handleStateChange = useCallback((state: string) => {
    setConnectionState(state);
  }, []);

  // --- Speak Suggested Script (Demo Manual Trigger) ---
  const handleSpeakSuggestedScript = useCallback((script: string) => {
    if (demoRef.current) {
      demoRef.current.triggerRepresentativeResponse(script);
    }
    awaitingNewProspectTurnRef.current = true;
    setStreamingText('');
    setIsStreaming(false);
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
      setTranscriptSegments([]);
      setInterimTranscript(null);
      setCoachingSuggestions([]);
      setActiveRetrievedDocs([]);
      setStreamingText('');
      setIsStreaming(false);
      setObjectionsDetected(0);
      awaitingNewProspectTurnRef.current = false;

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
      wsRef.current?.disconnect();
      wsRef.current = null;
      setIsDemo(false);
      setCallStartTime(null);
      setDemoSpeaker(null);
      setDemoProgress(null);
      setConnectionState('disconnected');
      latestRepScriptRef.current = null;
      awaitingNewProspectTurnRef.current = false;
    } else {
      // Connect to coaching WS
      setTranscriptSegments([]);
      setInterimTranscript(null);
      setCoachingSuggestions([]);
      setActiveRetrievedDocs([]);
      setStreamingText('');
      setIsStreaming(false);
      setObjectionsDetected(0);
      awaitingNewProspectTurnRef.current = false;

      const ws = new WebSocketManager(handleMessage, handleStateChange);
      ws.connect('/ws/coaching');
      wsRef.current = ws;

      // Wait for WS connection
      await new Promise(resolve => setTimeout(resolve, 800));

      ws.sendConfig({ language });

      const demo = new DemoPlayer({
        onTranscript: (segment) => {
          setTranscriptSegments(prev => [...prev, {
            text: segment.text,
            speaker: segment.speaker,
            timestamp: segment.timestamp,
          }]);
        },
        onSpeakingChange: (speaker) => {
          setDemoSpeaker(speaker);
          if (speaker === 'prospect' && awaitingNewProspectTurnRef.current) {
            setStreamingText('');
            setIsStreaming(false);
            awaitingNewProspectTurnRef.current = false;
          }
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
          wsRef.current?.disconnect();
          wsRef.current = null;
          latestRepScriptRef.current = null;
        },
        onError: (msg) => {
          console.error('Demo error:', msg);
          setIsDemo(false);
          setDemoSpeaker(null);
          setDemoProgress(null);
          setCallStartTime(null);
          setConnectionState('disconnected');
          wsRef.current?.disconnect();
          wsRef.current = null;
          latestRepScriptRef.current = null;
        },
        clearLatestRepScript: () => {
          latestRepScriptRef.current = null;
        },
        onCoachingSuggestion: (suggestion) => {
          setCoachingSuggestions(prev => [...prev, suggestion]);
        }
      });

      demoRef.current = demo;
      setIsDemo(true);
      setCallStartTime(Date.now());

      // Start TTS playback
      demo.start(ws, 1.0, language);
    }
  }, [isDemo, language, handleMessage, handleStateChange]);

  // --- Language Change ---
  const handleLanguageChange = useCallback((lang: string) => {
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
    setInterimTranscript(null);
    setCoachingSuggestions([]);
    setActiveRetrievedDocs([]);
    setStreamingText('');
    setIsStreaming(false);
    setCallStartTime(null);
    setObjectionsDetected(0);
    setAudioLevel(0);
    setDemoSpeaker(null);
    setDemoProgress(null);
    setConnectionState('disconnected');
    latestRepScriptRef.current = null;
    awaitingNewProspectTurnRef.current = false;
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
    <div className="h-screen w-screen flex flex-col relative z-0 overflow-hidden">

      {/* ===== Top Bar ===== */}
      <header className="glass-card rounded-none border-x-0 border-t-0 px-6 py-4 bg-[rgba(8,12,28,0.5)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-blue to-accent-violet flex items-center justify-center shadow-lg shadow-[rgba(99,102,241,0.25)] relative overflow-hidden group">
              <span className="text-white text-lg font-black tracking-wider relative z-10">S</span>
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-text-primary tracking-tight flex items-center gap-1.5">
                <span>SalesCoach</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-blue to-accent-violet drop-shadow-[0_0_15px_rgba(99,102,241,0.2)]">AI</span>

                {/* Connection Status Pill */}
                <div className="flex items-center gap-2 rounded-full bg-white/[0.01]">
                  <div className={`status-dot ${
                    connectionState === 'connected' ? 'status-dot--connected' :
                    connectionState === 'processing' ? 'status-dot--processing' :
                    connectionState === 'error' ? 'status-dot--error' :
                    'status-dot--disconnected'
                  }`} />
                </div>
              </h1>
              <p className="text-[9px] text-text-muted uppercase tracking-widest font-semibold">
                {t('logoSubtitle', language)}
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
            theme={theme}
            onToggleTheme={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            onToggleRecording={handleToggleRecording}
            onToggleDemo={handleToggleDemo}
            onLanguageChange={handleLanguageChange}
            onReset={handleReset}
          />
        </div>

        {/* Demo TTS indicator */}
        {isDemo && (
          <div className="flex items-center gap-3 mt-3.5 px-3 py-2 bg-[rgba(255,255,255,0.01)] border border-border rounded-xl animate-fade-in max-w-fit">
            <div className="flex items-center gap-2">
              <span className="text-xs animate-bounce-subtle">🔊</span>
              <span className="text-[9px] uppercase tracking-wider text-text-muted font-bold">
                {t('simulationActive', language)}
              </span>
            </div>
            {demoSpeaker && (
              <div className="flex items-center gap-2 animate-fade-in border-l border-border pl-3">
                <div className={`w-2 h-2 rounded-full animate-ping ${demoSpeaker === 'rep'
                    ? 'bg-accent-blue'
                    : 'bg-accent-emerald'
                  }`} />
                <span className={`text-xs font-semibold tracking-wide ${demoSpeaker === 'rep'
                    ? 'text-accent-blue'
                    : 'text-accent-emerald'
                  }`}>
                  {demoSpeaker === 'rep' ? t('repSpeaking', language) : t('prospectSpeaking', language)}
                </span>
              </div>
            )}
            {demoProgress && (
              <div className="flex items-center gap-3 border-l border-border pl-3 ml-2">
                <div className="w-20 h-1 bg-bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-blue to-accent-violet rounded-full transition-all duration-500"
                    style={{ width: `${(demoProgress.current / demoProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[9px] text-text-muted font-mono font-bold">
                  {demoProgress.current}/{demoProgress.total} {t('phrases', language)}
                </span>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ===== Stats Bar ===== */}
      <div className="px-6 py-4">
        <CallStats
          callStartTime={callStartTime}
          isActive={isActive}
          transcriptCount={transcriptSegments.length}
          suggestionCount={coachingSuggestions.length}
          objectionsDetected={objectionsDetected}
          language={language}
        />
      </div>

      {/* ===== Mobile View Tabs Navigation Bar ===== */}
      <div className="flex lg:hidden justify-between border border-border bg-white/[0.01] p-1 rounded-xl mx-6 mb-3 gap-1">
        <button
          onClick={() => setActiveTab('transcript')}
          className={`flex-1 text-center py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            activeTab === 'transcript'
              ? 'bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/25'
              : 'text-text-secondary hover:text-text-primary border border-transparent'
          }`}
        >
          {language === 'he' ? 'תמליל שיחה' : 'Transcript'}
        </button>
        <button
          onClick={() => setActiveTab('coaching')}
          className={`flex-1 text-center py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            activeTab === 'coaching'
              ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/25'
              : 'text-text-secondary hover:text-text-primary border border-transparent'
          }`}
        >
          {language === 'he' ? 'עוזר מכירות AI' : 'AI Copilot'}
        </button>
        <button
          onClick={() => setActiveTab('playbook')}
          className={`flex-1 text-center py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            activeTab === 'playbook'
              ? 'bg-accent-violet/10 text-accent-violet border border-accent-violet/25'
              : 'text-text-secondary hover:text-text-primary border border-transparent'
          }`}
        >
          {language === 'he' ? 'ספר הדרכה' : 'Playbook'}
        </button>
      </div>

      {/* ===== Main Content: Responsive 3-Panel Layout ===== */}
      <main className="flex-grow px-6 pb-6 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Left Panel: Live Transcript */}
        <div className={`col-span-1 lg:col-span-3 h-full flex flex-col min-h-0 ${activeTab === 'transcript' ? 'flex' : 'hidden lg:flex'}`}>
          <LiveTranscript
            segments={transcriptSegments}
            language={language}
            interimTranscript={interimTranscript}
          />
        </div>

        {/* Center Panel: AI Coaching suggestions feed */}
        <div className={`col-span-1 lg:col-span-6 h-full flex flex-col min-h-0 ${activeTab === 'coaching' ? 'flex' : 'hidden lg:flex'}`}>
          <CoachingPanel
            suggestions={coachingSuggestions}
            streamingText={streamingText}
            isStreaming={isStreaming}
            language={language}
            onSpeakScript={isDemo ? handleSpeakSuggestedScript : undefined}
          />
        </div>

        {/* Right Panel: Playbook Reference lookup */}
        <div className={`col-span-1 lg:col-span-3 h-full flex flex-col min-h-0 ${activeTab === 'playbook' ? 'flex' : 'hidden lg:flex'}`}>
          <PlaybookSidebar
            language={language}
            activeRetrievedDocs={activeRetrievedDocs}
            onSpeakScript={isDemo ? handleSpeakSuggestedScript : undefined}
          />
        </div>
      </main>
    </div>
  );
}
