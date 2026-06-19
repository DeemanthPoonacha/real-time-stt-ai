import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '../lib/translations';

interface ScreenRecorderProps {
  language: string;
}

type RecordState = 'idle' | 'recording' | 'paused' | 'completed';

const getSharedAudioContext = (): AudioContext => {
  if (!(window as any).__salescoach_shared_audio_context__) {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    (window as any).__salescoach_shared_audio_context__ = new AudioCtxClass({
      sampleRate: 16000,
    });
  }
  return (window as any).__salescoach_shared_audio_context__;
};

const getSharedAudioStream = (): MediaStream => {
  const ctx = getSharedAudioContext();
  if (!(window as any).__salescoach_app_audio_stream__) {
    const dest = ctx.createMediaStreamDestination();
    (window as any).__salescoach_app_audio_stream__ = dest.stream;
    (window as any).__salescoach_audio_destination_node__ = dest;
  }
  return (window as any).__salescoach_app_audio_stream__;
};

export default function ScreenRecorder({ language }: ScreenRecorderProps) {
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [includeMic, setIncludeMic] = useState<boolean>(true);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Clean up function to stop all tracks
  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => console.error("Error closing AudioContext:", err));
      audioContextRef.current = null;
    }
  }, []);

  // Timer effect
  useEffect(() => {
    if (recordState === 'recording') {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [recordState]);

  // Clean up URL object on unmount
  useEffect(() => {
    return () => {
      stopAllTracks();
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl, stopAllTracks]);

  const handleStartRecording = useCallback(async () => {
    try {
      chunksRef.current = [];
      setRecordingTime(0);
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }

      // 1. Get Screen Stream (display media)
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // Prompt user for system audio
      });

      streamRef.current = screenStream;

      // 2. Optional Microphone Stream
      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
            }
          });
          micStreamRef.current = micStream;
        } catch (micErr) {
          console.warn("Microphone access denied or failed:", micErr);
          alert(t('micAccessError', language));
        }
      }

      const hasScreenAudio = screenStream.getAudioTracks().length > 0;
      const hasMicAudio = micStream && micStream.getAudioTracks().length > 0;
      const appAudioStream = getSharedAudioStream();
      const hasAppAudio = appAudioStream && appAudioStream.getAudioTracks().length > 0;

      let combinedAudioStream: MediaStream | null = null;
      const activeSourcesCount = (hasScreenAudio ? 1 : 0) + (hasMicAudio ? 1 : 0) + (hasAppAudio ? 1 : 0);

      if (activeSourcesCount > 1) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const destination = audioCtx.createMediaStreamDestination();

        if (hasScreenAudio) {
          const screenSource = audioCtx.createMediaStreamSource(new MediaStream([screenStream.getAudioTracks()[0]]));
          screenSource.connect(destination);
        }
        if (hasMicAudio && micStream) {
          const micSource = audioCtx.createMediaStreamSource(new MediaStream([micStream.getAudioTracks()[0]]));
          micSource.connect(destination);
        }
        if (hasAppAudio && appAudioStream) {
          const appSource = audioCtx.createMediaStreamSource(new MediaStream([appAudioStream.getAudioTracks()[0]]));
          appSource.connect(destination);
        }

        combinedAudioStream = destination.stream;
      } else if (hasScreenAudio) {
        combinedAudioStream = new MediaStream([screenStream.getAudioTracks()[0]]);
      } else if (hasMicAudio && micStream) {
        combinedAudioStream = new MediaStream([micStream.getAudioTracks()[0]]);
      } else if (hasAppAudio && appAudioStream) {
        combinedAudioStream = new MediaStream([appAudioStream.getAudioTracks()[0]]);
      }

      // Assemble final track list
      const videoTrack = screenStream.getVideoTracks()[0];
      const finalTracks: MediaStreamTrack[] = [videoTrack];
      if (combinedAudioStream) {
        finalTracks.push(combinedAudioStream.getAudioTracks()[0]);
      }

      const recordStream = new MediaStream(finalTracks);

      // Select supported mimeType
      let options = { mimeType: 'video/webm;codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8,opus' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/mp4' };
      }

      const recorder = new MediaRecorder(recordStream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType });
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordState('completed');
        stopAllTracks();
      };

      // Listen for screen sharing stop button of browser UI
      videoTrack.onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };

      recorder.start(1000); // chunk size 1 second
      setRecordState('recording');
    } catch (err) {
      console.error("Recording initialization failed:", err);
      alert(t('screenShareError', language));
      stopAllTracks();
    }
  }, [includeMic, language, recordedUrl, stopAllTracks]);

  const handlePauseResume = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recordState === 'recording') {
      recorder.pause();
      setRecordState('paused');
    } else if (recordState === 'paused') {
      recorder.resume();
      setRecordState('recording');
    }
  }, [recordState]);

  const handleStopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!recordedUrl) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = recordedUrl;
    a.download = `salescoach-demo-${dateStr}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [recordedUrl]);

  const handleDiscard = useCallback(() => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    setRecordState('idle');
  }, [recordedUrl]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <>
      {/* Floating Recorder Widget */}
      <div 
        className={`fixed bottom-6 right-6 z-[999] transition-all duration-300 ${
          isExpanded ? 'w-80' : 'w-14 h-14'
        }`}
      >
        {isExpanded ? (
          <div className="glass-card p-4 w-full flex flex-col gap-4 animate-slide-up bg-[rgba(8,12,28,0.85)] border-[rgba(99,102,241,0.2)] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-extrabold uppercase tracking-widest text-[--color-text-primary] flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[--color-accent-violet] animate-pulse" />
                {t('recorderTitle', language)}
              </span>
              <button 
                onClick={() => setIsExpanded(false)}
                className="text-[--color-text-secondary] hover:text-[--color-text-primary] transition-colors p-1 cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Content for Idle State */}
            {recordState === 'idle' && (
              <div className="flex flex-col gap-3.5">
                <p className="text-[10px] text-[--color-text-secondary] leading-relaxed">
                  {t('readyToRecord', language)}
                </p>
                {/* Microphone toggle switch */}
                <label className="flex items-center justify-between cursor-pointer group bg-white/[0.02] border border-white/[0.04] p-2.5 rounded-xl hover:bg-white/[0.04] transition-all duration-200">
                  <span className="text-[11px] font-semibold text-[--color-text-secondary] group-hover:text-[--color-text-primary] flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[--color-accent-blue]">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                    {t('includeMic', language)}
                  </span>
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      checked={includeMic}
                      onChange={(e) => setIncludeMic(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-white/10 rounded-full peer peer-focus:ring-0 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white/60 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[--color-accent-blue] peer-checked:after:bg-white peer-checked:after:border-transparent" />
                  </div>
                </label>

                {/* Start Button */}
                <button
                  onClick={handleStartRecording}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[--color-accent-blue] to-[--color-accent-violet] text-white text-xs font-bold uppercase tracking-wider hover:scale-[1.02] hover:shadow-lg hover:shadow-[rgba(99,102,241,0.25)] transition-all duration-300 cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                  {t('startRecord', language)}
                </button>
              </div>
            )}

            {/* Content for Recording / Paused States */}
            {(recordState === 'recording' || recordState === 'paused') && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full bg-[--color-accent-rose] ${recordState === 'recording' ? 'animate-ping' : ''}`} />
                    <span className="text-[11px] font-bold text-[--color-text-secondary]">
                      {recordState === 'recording' ? t('recordingActive', language) : 'Paused'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-[--color-text-primary] font-bold">
                    {formatTime(recordingTime)}
                  </span>
                </div>

                <div className="flex gap-2">
                  {/* Pause / Resume */}
                  <button
                    onClick={handlePauseResume}
                    className="flex-1 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] text-xs font-bold uppercase tracking-wider text-[--color-text-primary] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {recordState === 'recording' ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                        Pause
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Resume
                      </>
                    )}
                  </button>

                  {/* Stop */}
                  <button
                    onClick={handleStopRecording}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-[--color-accent-rose] to-red-600 text-white text-xs font-bold uppercase tracking-wider hover:shadow-lg hover:shadow-[rgba(244,63,94,0.25)] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                    {t('stopRecord', language)}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setIsExpanded(true)}
            className="w-14 h-14 rounded-full glass-card hoverable flex items-center justify-center bg-[rgba(8,12,28,0.7)] border-[rgba(255,255,255,0.08)] text-[--color-text-secondary] hover:text-[--color-accent-violet] shadow-xl hover:scale-105 cursor-pointer"
            title={t('recorderTitle', language)}
          >
            {recordState === 'recording' ? (
              <div className="relative flex items-center justify-center">
                <span className="absolute w-4 h-4 rounded-full bg-[--color-accent-rose] animate-ping opacity-75" />
                <span className="relative w-3.5 h-3.5 rounded-full bg-[--color-accent-rose]" />
              </div>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="animate-bounce-subtle">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
                <circle cx="12" cy="10" r="3" fill="currentColor" className="text-[--color-accent-violet]" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Preview Modal */}
      {recordState === 'completed' && recordedUrl && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in p-4">
          <div className="glass-card max-w-2xl w-full p-6 bg-[rgba(10,15,35,0.9)] border-[rgba(99,102,241,0.25)] shadow-2xl animate-slide-up flex flex-col gap-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-sm font-extrabold uppercase tracking-widest text-[--color-text-primary] flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[--color-accent-emerald] animate-pulse" />
                {t('recordingPreview', language)}
              </h3>
              <button
                onClick={handleDiscard}
                className="text-[--color-text-secondary] hover:text-[--color-text-primary] transition-colors p-1 cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Video Player */}
            <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black/40 border border-white/5 shadow-inner">
              <video 
                src={recordedUrl} 
                controls 
                className="w-full h-full object-contain"
              />
            </div>

            {/* Modal Footer / Actions */}
            <div className="flex justify-end gap-3 border-t border-white/5 pt-4">
              <button
                onClick={handleDiscard}
                className="px-4 py-2.5 rounded-xl border border-white/5 hover:border-[--color-accent-rose] hover:bg-[rgba(244,63,94,0.05)] text-[--color-text-secondary] hover:text-[--color-accent-rose] text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {t('discard', language)}
              </button>

              <button
                onClick={handleDownload}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[--color-accent-blue] to-[--color-accent-violet] text-white text-xs font-bold uppercase tracking-wider hover:scale-[1.02] hover:shadow-lg hover:shadow-[rgba(99,102,241,0.25)] transition-all duration-300 cursor-pointer flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('download', language)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
