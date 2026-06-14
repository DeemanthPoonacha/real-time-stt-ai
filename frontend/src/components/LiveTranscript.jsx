import { useEffect, useRef } from 'react';

/**
 * LiveTranscript — Real-time scrolling transcript display.
 * Supports RTL for Hebrew, speaker differentiation, and keyword highlighting.
 */
export default function LiveTranscript({ segments, language }) {
  const scrollRef = useRef(null);
  const isRTL = language === 'he';

  // Auto-scroll to bottom on new segments
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getSpeakerLabel = (speaker) => {
    if (speaker === 'rep') return { label: 'Sales Rep', color: 'text-[--color-accent-blue]', dotClass: 'bg-[--color-accent-blue]' };
    if (speaker === 'prospect') return { label: 'Prospect', color: 'text-[--color-accent-emerald]', dotClass: 'bg-[--color-accent-emerald]' };
    return { label: 'Speaker', color: 'text-[--color-text-muted]', dotClass: 'bg-[--color-text-muted]' };
  };

  return (
    <div className="glass-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[--color-border]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[--color-accent-emerald] animate-pulse" />
          <h2 className="text-sm font-semibold text-[--color-text-primary] uppercase tracking-wider">
            Live Transcript
          </h2>
        </div>
        <span className="text-xs text-[--color-text-muted]">
          {segments.length} segments
        </span>
      </div>

      {/* Transcript Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-[--color-bg-glass] border border-[--color-border] flex items-center justify-center mb-4 animate-float">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[--color-text-muted]">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </div>
            <p className="text-[--color-text-muted] text-sm">
              Start recording or run a demo to see the live transcript
            </p>
          </div>
        ) : (
          segments.map((segment, index) => {
            const speaker = getSpeakerLabel(segment.speaker);
            return (
              <div
                key={index}
                className={`transcript-segment ${
                  segment.speaker === 'rep' ? 'transcript-segment--rep' :
                  segment.speaker === 'prospect' ? 'transcript-segment--prospect' : ''
                }`}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${speaker.dotClass}`} />
                  <span className={`text-xs font-semibold ${speaker.color} uppercase tracking-wider`}>
                    {speaker.label}
                  </span>
                  <span className="text-[10px] text-[--color-text-muted] ml-auto">
                    {segment.timestamp ? formatTime(segment.timestamp) : ''}
                  </span>
                </div>
                <p className="text-sm text-[--color-text-primary] leading-relaxed pl-3.5">
                  {segment.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
