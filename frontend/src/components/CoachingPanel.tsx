import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/translations';

interface CoachingSuggestion {
  type: string;
  suggestion: string;
  title?: string;
  priority?: string;
  script?: string;
}

interface CoachingPanelProps {
  suggestions: CoachingSuggestion[];
  streamingText: string;
  isStreaming: boolean;
  language: string;
  onSpeakScript?: (script: string) => void;
}

interface ParsedStream {
  type?: string;
  priority?: string;
  title?: string;
  suggestion?: string;
  script?: string;
}

/**
 * CoachingPanel — Renders AI coach feedback dynamically.
 * Features stateful click-to-copy tags, streaming animation logs, and category color codings.
 */
export default function CoachingPanel({ suggestions, streamingText, isStreaming, language, onSpeakScript }: CoachingPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [suggestions, streamingText]);

  const getTypeConfig = (type: string) => {
    const tLower = (type || '').toLowerCase();
    if (tLower.startsWith('obj')) {
      return {
        icon: '⚠️',
        label: t('objectionHandling', language),
        cardClass: 'coaching-card--objection',
        badge: 'bg-[--color-accent-rose]/10 text-[--color-accent-rose] border-[--color-accent-rose]/20'
      };
    }
    if (tLower.startsWith('sc') || tLower.startsWith('talk')) {
      return {
        icon: '💬',
        label: t('suggestedScript', language),
        cardClass: 'coaching-card--script',
        badge: 'bg-[--color-accent-blue]/10 text-[--color-accent-blue] border-[--color-accent-blue]/20'
      };
    }
    if (tLower.startsWith('al')) {
      return {
        icon: '⚡',
        label: t('immediateAlert', language),
        cardClass: 'coaching-card--alert',
        badge: 'bg-[--color-accent-amber]/10 text-[--color-accent-amber] border-[--color-accent-amber]/20'
      };
    }
    if (tLower.startsWith('cl') || tLower.startsWith('buy')) {
      return {
        icon: '🎯',
        label: t('closingOpportunity', language),
        cardClass: 'coaching-card--closing',
        badge: 'bg-[--color-accent-violet]/10 text-[--color-accent-violet] border-[--color-accent-violet]/20'
      };
    }
    // Default to tip
    return {
      icon: '💡',
      label: t('coachingTip', language),
      cardClass: 'coaching-card--tip',
      badge: 'bg-[--color-accent-emerald]/10 text-[--color-accent-emerald] border-[--color-accent-emerald]/20'
    };
  };

  const getLiveLabel = (type: string) => {
    const tLower = (type || '').toLowerCase();
    if (tLower.startsWith('obj')) return t('liveObjection', language);
    if (tLower.startsWith('sc') || tLower.startsWith('talk')) return t('liveSuggestedScript', language);
    if (tLower.startsWith('al')) return t('liveImmediateAlert', language);
    if (tLower.startsWith('cl') || tLower.startsWith('buy')) return t('liveClosingOpportunity', language);
    return t('liveTip', language);
  };

  const getPriorityBadge = (priority: string) => {
    const pLower = (priority || '').toLowerCase();
    if (pLower.startsWith('hi')) {
      return 'bg-[--color-accent-rose]/10 text-[--color-accent-rose] border-[--color-accent-rose]/30';
    }
    if (pLower.startsWith('me')) {
      return 'bg-[--color-accent-amber]/10 text-[--color-accent-amber] border-[--color-accent-amber]/30';
    }
    return 'bg-white/[0.03] text-[--color-text-muted] border-[--color-border]';
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  // Parse streaming JSON to extract suggestion details dynamically
  const getParsedStream = (text: string): ParsedStream | null => {
    if (!text) return null;
    let cleanText = text.trim();

    // Find where the JSON starts
    const firstBrace = cleanText.indexOf('{');
    if (firstBrace !== -1) {
      cleanText = cleanText.substring(firstBrace).trim();
    } else {
      // If we haven't received the starting brace of the JSON object, return null
      return null;
    }

    // Clean trailing backticks or closing markdown wrappers if any
    cleanText = cleanText.replace(/```$/, '').trim();

    try {
      // Try to parse the entire text if it's already a complete valid JSON
      return JSON.parse(cleanText);
    } catch (e) {
      // Otherwise, parse each key-value pair of the JSON separately using regex
      const extractField = (key: string): string | undefined => {
        // Try completed string value match
        const completedRegex = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
        const completedMatch = cleanText.match(completedRegex);
        if (completedMatch) {
          return completedMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
        }
        // Try partial string value match (quote is open and goes until end of string)
        const partialRegex = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$`);
        const partialMatch = cleanText.match(partialRegex);
        if (partialMatch) {
          return partialMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
        }
        return undefined;
      };

      const result: ParsedStream = {};
      const typeVal = extractField('type');
      const priorityVal = extractField('priority');
      const titleVal = extractField('title');
      const suggestionVal = extractField('suggestion');
      const scriptVal = extractField('script');

      if (typeVal) result.type = typeVal;
      if (priorityVal) result.priority = priorityVal;
      if (titleVal) result.title = titleVal;
      if (suggestionVal) result.suggestion = suggestionVal;
      if (scriptVal) result.script = scriptVal;

      return result;
    }
  };

  const renderActiveCard = (suggestion: CoachingSuggestion, index: number) => {
    const config = getTypeConfig(suggestion.type);
    return (
      <div
        key={`active-${index}`}
        className={`glass-card ${config.cardClass} p-5 animate-slide-up relative overflow-hidden border-[--color-accent-blue]/40 shadow-[0_4px_24px_rgba(99,102,241,0.15)] ring-1 ring-[--color-accent-blue]/10`}
      >
        {/* Card Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">{config.icon}</span>
          <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${config.badge}`}>
            {config.label}
          </span>
          {suggestion.priority && (
            <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ml-auto ${getPriorityBadge(suggestion.priority)}`}>
              {suggestion.priority === 'high' ? (language === 'he' ? 'גבוה' : 'high') :
                suggestion.priority === 'medium' ? (language === 'he' ? 'בינוני' : 'medium') :
                  suggestion.priority}
            </span>
          )}
        </div>

        {/* Title */}
        {suggestion.title && (
          <h3 className="text-base font-extrabold text-[--color-text-primary] mb-2 tracking-tight">
            {suggestion.title}
          </h3>
        )}

        {/* Suggestion Text */}
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-[--color-text-secondary] leading-relaxed font-semibold flex-grow">
            {suggestion.suggestion}
          </p>
          {!suggestion.script && onSpeakScript && (
            <button
              onClick={() => onSpeakScript(suggestion.suggestion)}
              className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider rounded-lg bg-gradient-to-r from-[--color-accent-blue]/25 to-[--color-accent-violet]/25 border border-[--color-accent-blue]/40 hover:from-[--color-accent-blue]/35 hover:to-[--color-accent-violet]/35 hover:border-[--color-accent-blue] text-[--color-text-primary] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] cursor-pointer"
              title={language === 'he' ? 'דבר הצעת אימון' : 'Speak Suggestion'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-1">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>{language === 'he' ? 'דבר הצעה' : 'Speak Suggestion'}</span>
            </button>
          )}
        </div>

        {/* Script Bubble */}
        {suggestion.script && (
          <div className="mt-4 relative group/script">
            <div className="bg-[--color-bg-secondary] rounded-xl p-3.5 border border-[--color-border] bg-opacity-80 transition-all duration-300 group-hover/script:border-white/10">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[9px] text-[--color-text-muted] uppercase tracking-wider font-extrabold">
                  {t('dialogueTalkTrack', language)}
                </span>

                <div className='flex gap-2 items-center'>
                  <button
                    onClick={() => copyToClipboard(suggestion.script!, index)}
                    className="text-[9px] text-[--color-accent-blue] hover:text-[--color-text-primary] transition-all duration-200 opacity-0 group-hover/script:opacity-100 flex items-center gap-1.5 cursor-pointer font-bold uppercase tracking-wider"
                  >
                    {copiedIndex === index ? (
                      <span className="text-[--color-accent-emerald] flex items-center gap-1">
                        <span>✓</span> {t('copied', language)}
                      </span>
                    ) : (
                      <span>{t('copyTalkTrack', language)}</span>
                    )}
                  </button>
                  {onSpeakScript && (
                    <button
                      onClick={() => onSpeakScript(suggestion.script!)}
                      className="flex items-center justify-center gap-2 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider rounded-lg bg-gradient-to-r from-[--color-accent-blue]/25 to-[--color-accent-violet]/25 border border-[--color-accent-blue]/40 hover:from-[--color-accent-blue]/35 hover:to-[--color-accent-violet]/35 hover:border-[--color-accent-blue] text-[--color-text-primary] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] cursor-pointer"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-1">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>{language === 'he' ? 'דבר תסריט מוצע' : 'Speak Suggested Script'}</span>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-lg text-[--color-text-primary] italic leading-relaxed font-mono font-semibold pl-2 border-l-2 border-[--color-accent-blue] mb-1">
                "{suggestion.script}"
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPreviousCard = (suggestion: CoachingSuggestion, index: number) => {
    const config = getTypeConfig(suggestion.type);
    return (
      <div
        key={`previous-${index}`}
        className={`glass-card ${config.cardClass} p-3.5 animate-slide-up relative overflow-hidden opacity-60 hover:opacity-90 border-white/[0.02] bg-white/[0.003] transition-all duration-300 shadow-sm`}
        style={{ animationDelay: `${index * 0.05}s` }}
      >
        {/* Card Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs">{config.icon}</span>
          <span className={`text-[8px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full border ${config.badge} opacity-80`}>
            {config.label}
          </span>
          {suggestion.priority && (
            <span className={`text-[8px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full border ml-auto ${getPriorityBadge(suggestion.priority)} opacity-80`}>
              {suggestion.priority === 'high' ? (language === 'he' ? 'גבוה' : 'high') :
                suggestion.priority === 'medium' ? (language === 'he' ? 'בינוני' : 'medium') :
                  suggestion.priority}
            </span>
          )}
        </div>

        {/* Title */}
        {suggestion.title && (
          <h4 className="text-sm font-bold text-[--color-text-secondary] mb-1 tracking-tight">
            {suggestion.title}
          </h4>
        )}

        {/* Suggestion Text */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] text-[--color-text-muted] leading-relaxed flex-grow">
            {suggestion.suggestion}
          </p>
          {!suggestion.script && onSpeakScript && (
            <button
              onClick={() => onSpeakScript(suggestion.suggestion)}
              className="flex-shrink-0 flex items-center justify-center gap-1 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[--color-text-primary] transition-all duration-300 cursor-pointer"
              title={language === 'he' ? 'דבר' : 'Speak'}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue]">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>{language === 'he' ? 'דבר' : 'Speak'}</span>
            </button>
          )}
        </div>

        {/* Script Bubble */}
        {suggestion.script && (
          <div className="mt-2.5 relative group/script">
            <div className="bg-[--color-bg-secondary]/50 rounded-lg p-2.5 border border-white/[0.01] transition-all duration-300 group-hover/script:border-white/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[8px] text-[--color-text-muted] uppercase tracking-wider font-extrabold">
                  {t('dialogueTalkTrack', language)}
                </span>

                <div className='flex gap-1.5 items-center'>
                  <button
                    onClick={() => copyToClipboard(suggestion.script!, index)}
                    className="text-[8px] text-[--color-accent-blue] hover:text-[--color-text-primary] transition-all duration-200 opacity-60 group-hover/script:opacity-100 flex items-center gap-1 cursor-pointer font-bold uppercase tracking-wider"
                  >
                    {copiedIndex === index ? (
                      <span className="text-[--color-accent-emerald] flex items-center gap-1">
                        <span>✓</span> {t('copied', language)}
                      </span>
                    ) : (
                      <span>{t('copyTalkTrack', language)}</span>
                    )}
                  </button>
                  {onSpeakScript && (
                    <button
                      onClick={() => onSpeakScript(suggestion.script!)}
                      className="flex items-center justify-center gap-1 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[--color-text-primary] transition-all duration-300 cursor-pointer"
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue]">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>{language === 'he' ? 'דבר' : 'Speak'}</span>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-md text-[--color-text-secondary] italic leading-relaxed font-mono pl-1.5 border-l border-white/5 mb-0.5">
                "{suggestion.script}"
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Identify active and previous suggestions
  const hasStreaming = isStreaming && streamingText;
  let activeSuggestion: CoachingSuggestion | null = null;
  let previousSuggestions: CoachingSuggestion[] = [];

  if (hasStreaming) {
    previousSuggestions = suggestions;
  } else if (suggestions.length > 0) {
    activeSuggestion = suggestions[suggestions.length - 1];
    previousSuggestions = suggestions.slice(0, suggestions.length - 1);
  }

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4.5 border-b border-[--color-border] bg-white/[0.01]">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🤖</span>
          <h2 className="text-xs font-bold text-[--color-text-primary] uppercase tracking-wider">
            {t('copilotTitle', language)}
          </h2>
          {isStreaming && (
            <div className="flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded-full bg-[--color-accent-blue]/5 border border-[--color-accent-blue]/15 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-[--color-accent-blue]" />
              <span className="text-[9px] text-[--color-accent-blue] font-bold uppercase tracking-wider animate-pulse">
                {t('analyzingAudio', language)}
              </span>
            </div>
          )}
        </div>
        <span className="text-[10px] font-bold text-[--color-text-muted] uppercase tracking-widest bg-white/[0.04] px-2 py-0.5 rounded-full">
          {suggestions.length} {t('tips', language)}
        </span>
      </div>

      {/* Suggestions List */}
      <div className="flex-grow overflow-hidden relative">
        <div ref={scrollRef} className="h-full overflow-y-auto p-5 space-y-4 scroll-smooth">
          {suggestions.length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-[--color-border] flex items-center justify-center mb-4.5 animate-float">
                <span className="text-2xl drop-shadow-[0_2px_10px_rgba(99,102,241,0.2)]">🤖</span>
              </div>
              <p className="text-[--color-text-muted] text-xs font-medium tracking-wide">
                {t('coachingIdle', language)}
              </p>
              <p className="text-[--color-text-muted] text-[10px] mt-1 opacity-70">
                {t('coachingIdleSubtext', language)}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Current Active Suggestion (Top) */}
              {(() => {
                if (hasStreaming) {
                  const parsed = getParsedStream(streamingText);
                  if (!parsed || (!parsed.suggestion && !parsed.title)) {
                    return (
                      <div className="glass-card coaching-card--tip p-5 animate-fade-in border border-dashed border-[--color-accent-blue]/40 bg-white/[0.01] shadow-[0_4px_20px_rgba(99,102,241,0.08)]">
                        <div className="flex items-center gap-2 mb-3.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-[--color-accent-blue] animate-ping" />
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-[--color-accent-blue] tracking-wider">
                            {t('analyzingSpeech', language)}
                          </span>
                        </div>
                        <div className="space-y-3 py-1">
                          <div className="w-1/2 h-3.5 bg-white/5 rounded animate-pulse" />
                          <div className="w-5/6 h-3 bg-white/5 rounded animate-pulse" />
                        </div>
                      </div>
                    );
                  }

                  const config = getTypeConfig(parsed.type || 'tip');
                  return (
                    <div className={`glass-card ${config.cardClass} p-5 animate-fade-in relative overflow-hidden border-dashed border-[--color-accent-blue]/40 shadow-[0_4px_24px_rgba(99,102,241,0.12)] ring-1 ring-[--color-accent-blue]/10`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm">{config.icon}</span>
                        <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${config.badge} flex items-center gap-1.5`}>
                          <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
                          <span>{getLiveLabel(parsed.type || 'tip')}</span>
                        </span>
                        {parsed.priority && (
                          <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ml-auto ${getPriorityBadge(parsed.priority)}`}>
                            {parsed.priority === 'high' ? (language === 'he' ? 'גבוה' : 'high') :
                              parsed.priority === 'medium' ? (language === 'he' ? 'בינוני' : 'medium') :
                                parsed.priority}
                          </span>
                        )}
                      </div>

                      {parsed.title && (
                        <h3 className="text-base font-extrabold text-[--color-text-primary] mb-2 tracking-tight">
                          {parsed.title}
                        </h3>
                      )}

                      {/* Suggestion Text */}
                      <div className="flex items-start justify-between gap-4">
                        {parsed.suggestion && (
                          <p className="text-sm text-[--color-text-secondary] leading-relaxed typing-cursor font-semibold flex-grow">
                            {parsed.suggestion}
                          </p>
                        )}
                        {!parsed.script && parsed.suggestion && onSpeakScript && (
                          <button
                            onClick={() => onSpeakScript(parsed.suggestion!)}
                            className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider rounded-lg bg-gradient-to-r from-[--color-accent-blue]/25 to-[--color-accent-violet]/25 border border-[--color-accent-blue]/40 hover:from-[--color-accent-blue]/35 hover:to-[--color-accent-violet]/35 hover:border-[--color-accent-blue] text-[--color-text-primary] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] cursor-pointer"
                            title={language === 'he' ? 'דבר הצעת אימון' : 'Speak Suggestion'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-1">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            <span>{language === 'he' ? 'דבר הצעה' : 'Speak Suggestion'}</span>
                          </button>
                        )}
                      </div>

                      {parsed.script && (
                        <div className="mt-4 relative">
                          <div className="bg-[--color-bg-secondary] rounded-xl p-3.5 border border-[--color-border] bg-opacity-80">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] text-[--color-text-muted] uppercase tracking-wider font-extrabold">
                                {t('dialogueTalkTrack', language)}
                              </span>
                              {onSpeakScript && (
                                <button
                                  onClick={() => onSpeakScript(parsed.script!)}
                                  className="flex items-center justify-center gap-2 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider rounded-lg bg-gradient-to-r from-[--color-accent-blue]/25 to-[--color-accent-violet]/25 border border-[--color-accent-blue]/40 hover:from-[--color-accent-blue]/35 hover:to-[--color-accent-violet]/35 hover:border-[--color-accent-blue] text-[--color-text-primary] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] cursor-pointer"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-1">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                  </svg>
                                  <span>{language === 'he' ? 'דבר תסריט מוצע' : 'Speak Suggested Script'}</span>
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-[--color-text-primary] italic leading-relaxed font-mono font-medium pl-1.5 border-l-2 border-white/10">
                              "{parsed.script}"
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                } else if (activeSuggestion) {
                  return renderActiveCard(activeSuggestion, suggestions.length - 1);
                }
                return null;
              })()}

              {/* Separation & Previous Suggestions List */}
              {previousSuggestions.length > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-3.5 pb-1">
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-[--color-text-muted] whitespace-nowrap">
                      {language === 'he' ? 'הצעות אימון קודמות' : 'Previous Coaching Suggestions'}
                    </span>
                    <div className="flex-grow h-px bg-[--color-border] opacity-20" />
                  </div>

                  <div className="space-y-4">
                    {previousSuggestions.slice().reverse().map((suggestion, idx) => {
                      // suggestions were cloned and reversed to show in reverse chronological order (latest previous on top of previous list)
                      // index mapping: original index is suggestions.length - 1 - idx if not streaming,
                      // or suggestions.length - 1 - idx if streaming.
                      const originalIdx = hasStreaming 
                        ? suggestions.length - 1 - idx 
                        : suggestions.length - 2 - idx;
                      return renderPreviousCard(suggestion, originalIdx);
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Soft Scroll-Gradient Overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[--color-bg-secondary] to-transparent pointer-events-none opacity-60" />
      </div>
    </div>
  );
}
