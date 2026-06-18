import { useEffect, useRef } from 'react';
import { t } from '../lib/translations';

interface TranscriptSegment {
  text: string;
  speaker: string;
  timestamp?: number;
  language?: string;
}

interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  language: string;
  interimTranscript?: { text: string; speaker: string } | null;
}

/**
 * LiveTranscript — Scrolling live dialogue container.
 * Features distinct avatars for Rep vs Prospect, RTL support, and elegant timing indicators.
 */
export default function LiveTranscript({ segments, language, interimTranscript }: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isRTL = language === 'he';

  // Auto-scroll to bottom on new segments or live interim speech updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, interimTranscript]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getSpeakerConfig = (speaker: string) => {
    if (speaker === 'rep') {
      return {
        label: t('salesRepRole', language),
        avatarText: t('salesRepAvatar', language),
        colorClass: 'text-accent-blue',
        avatarClass: 'speaker-avatar--rep',
        segmentClass: 'transcript-segment--rep'
      };
    }
    if (speaker === 'prospect') {
      return {
        label: t('prospectRole', language),
        avatarText: t('prospectAvatar', language),
        colorClass: 'text-accent-emerald',
        avatarClass: 'speaker-avatar--prospect',
        segmentClass: 'transcript-segment--prospect'
      };
    }
    return {
      label: t('speakerRole', language),
      avatarText: t('speakerAvatar', language),
      colorClass: 'text-text-muted',
      avatarClass: 'speaker-avatar--unknown',
      segmentClass: ''
    };
  };

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-border bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
          <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider">
            {t('liveTranscriptTitle', language)}
          </h2>
        </div>
        <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest bg-white/[0.04] px-2.5 py-0.5 rounded-full border border-border">
          {segments.length} {t('segments', language)}
        </span>
      </div>

      {/* Scroller Area */}
      <div className="flex-1 overflow-hidden relative soft-edge-fade">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto p-4 space-y-3.5 scroll-smooth"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {segments.length === 0 && !interimTranscript ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-border flex items-center justify-center mb-4.5 animate-float">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-secondary">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </div>
              <p className="text-text-primary text-xs font-bold tracking-wide">
                {t('micSilent', language)}
              </p>
              <p className="text-text-secondary text-xs mt-1">
                {t('micSilentSubtext', language)}
              </p>
            </div>
          ) : (
            <>
              {segments.map((segment, index) => {
                const config = getSpeakerConfig(segment.speaker);
                return (
                  <div
                    key={index}
                    className={`transcript-segment ${config.segmentClass} flex flex-col gap-1.5`}
                    style={{ animationDelay: `${index * 0.04}s` }}
                  >
                    {/* Speaker Header */}
                    <div className="flex items-center gap-2">
                      <div className={`speaker-avatar ${config.avatarClass} flex-shrink-0`}>
                        {config.avatarText}
                      </div>
                      <span className={`text-xs font-bold ${config.colorClass} uppercase tracking-wider`}>
                        {config.label}
                      </span>
                      <span className="text-[10px] text-text-secondary font-semibold ml-auto font-mono">
                        {segment.timestamp ? formatTime(segment.timestamp) : ''}
                      </span>
                    </div>

                    <p className="text-sm text-text-primary leading-relaxed ps-9 pe-2">
                      {segment.text}
                    </p>
                  </div>
                );
              })}

              {interimTranscript && (() => {
                const config = getSpeakerConfig(interimTranscript.speaker);
                return (
                  <div className={`transcript-segment ${config.segmentClass} flex flex-col gap-1.5 opacity-75 border-dashed border border-white/5 bg-white/[0.01] rounded-xl p-3`}>
                    {/* Speaker Header */}
                    <div className="flex items-center gap-2">
                      <div className={`speaker-avatar ${config.avatarClass} flex-shrink-0`}>
                        {config.avatarText}
                      </div>
                      <span className={`text-xs font-bold ${config.colorClass} uppercase tracking-wider flex items-center gap-2`}>
                        {config.label}
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-blue opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-blue"></span>
                        </span>
                      </span>
                    </div>

                    <p className="text-sm text-text-primary leading-relaxed ps-9 pe-2 italic">
                      {interimTranscript.text}
                    </p>
                  </div>
                );
              })()}
            </>
          )}
        </div>
        
        {/* Soft Scroll-Gradient Overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-bg-secondary to-transparent pointer-events-none opacity-60" />
      </div>
    </div>
  );
}
