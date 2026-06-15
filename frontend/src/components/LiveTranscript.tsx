import { useEffect, useRef } from 'react';

interface TranscriptSegment {
  text: string;
  speaker: string;
  timestamp?: number;
  language?: string;
}

interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  language: string;
}

/**
 * LiveTranscript — Scrolling live dialogue container.
 * Features distinct avatars for Rep vs Prospect, RTL support, and elegant timing indicators.
 */
export default function LiveTranscript({ segments, language }: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isRTL = language === 'he';

  // Auto-scroll to bottom on new segments
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getSpeakerConfig = (speaker: string) => {
    if (speaker === 'rep') {
      return {
        label: 'Sales Rep',
        avatarText: 'SR',
        colorClass: 'text-[--color-accent-blue]',
        avatarClass: 'speaker-avatar--rep',
        segmentClass: 'transcript-segment--rep'
      };
    }
    if (speaker === 'prospect') {
      return {
        label: 'Prospect',
        avatarText: 'PR',
        colorClass: 'text-[--color-accent-emerald]',
        avatarClass: 'speaker-avatar--prospect',
        segmentClass: 'transcript-segment--prospect'
      };
    }
    return {
      label: 'Speaker',
      avatarText: 'SP',
      colorClass: 'text-[--color-text-muted]',
      avatarClass: 'speaker-avatar--unknown',
      segmentClass: ''
    };
  };

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4.5 border-b border-[--color-border] bg-white/[0.01]">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[--color-accent-emerald] animate-pulse" />
          <h2 className="text-xs font-bold text-[--color-text-primary] uppercase tracking-wider">
            Live Conversation Transcript
          </h2>
        </div>
        <span className="text-[10px] font-bold text-[--color-text-muted] uppercase tracking-widest bg-white/[0.04] px-2 py-0.5 rounded-full">
          {segments.length} segments
        </span>
      </div>

      {/* Scroller Area */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto p-5 space-y-3.5 scroll-smooth"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {segments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-[--color-border] flex items-center justify-center mb-4.5 animate-float">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[--color-text-muted]">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </div>
              <p className="text-[--color-text-muted] text-xs font-medium tracking-wide">
                Microphone stream is silent
              </p>
              <p className="text-[--color-text-muted] text-[10px] mt-1 opacity-70">
                Activate the recording or demo mode to begin transcription
              </p>
            </div>
          ) : (
            segments.map((segment, index) => {
              const config = getSpeakerConfig(segment.speaker);
              return (
                <div
                  key={index}
                  className={`transcript-segment ${config.segmentClass} flex flex-col gap-1.5`}
                  style={{ animationDelay: `${index * 0.04}s` }}
                >
                  {/* Speaker Header */}
                  <div className="flex items-center gap-2">
                    <div className={`speaker-avatar ${config.avatarClass}`}>
                      {config.avatarText}
                    </div>
                    <span className={`text-[11px] font-bold ${config.colorClass} uppercase tracking-wider`}>
                      {config.label}
                    </span>
                    <span className="text-[9px] text-[--color-text-muted] font-medium ml-auto font-mono">
                      {segment.timestamp ? formatTime(segment.timestamp) : ''}
                    </span>
                  </div>

                  {/* Speech Text Content */}
                  <p className="text-sm text-[--color-text-primary] leading-relaxed pl-7.5 pr-2">
                    {segment.text}
                  </p>
                </div>
              );
            })
          )}
        </div>
        
        {/* Soft Scroll-Gradient Overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[--color-bg-secondary] to-transparent pointer-events-none opacity-60" />
      </div>
    </div>
  );
}
