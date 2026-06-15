import { useEffect, useRef, useState } from 'react';

/**
 * CoachingPanel — Renders AI coach feedback dynamically.
 * Features stateful click-to-copy tags, streaming animation logs, and category color codings.
 */
export default function CoachingPanel({ suggestions, streamingText, isStreaming }) {
  const scrollRef = useRef(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [suggestions, streamingText]);

  const getTypeConfig = (type) => {
    switch (type) {
      case 'objection':
        return { 
          icon: '⚠️', 
          label: 'Objection Handling', 
          cardClass: 'coaching-card--objection', 
          badge: 'bg-[--color-accent-rose]/10 text-[--color-accent-rose] border-[--color-accent-rose]/20' 
        };
      case 'tip':
        return { 
          icon: '💡', 
          label: 'Coaching Tip', 
          cardClass: 'coaching-card--tip', 
          badge: 'bg-[--color-accent-emerald]/10 text-[--color-accent-emerald] border-[--color-accent-emerald]/20' 
        };
      case 'script':
        return { 
          icon: '💬', 
          label: 'Suggested Script', 
          cardClass: 'coaching-card--script', 
          badge: 'bg-[--color-accent-blue]/10 text-[--color-accent-blue] border-[--color-accent-blue]/20' 
        };
      case 'alert':
        return { 
          icon: '⚡', 
          label: 'Immediate Alert', 
          cardClass: 'coaching-card--alert', 
          badge: 'bg-[--color-accent-amber]/10 text-[--color-accent-amber] border-[--color-accent-amber]/20' 
        };
      case 'closing':
        return { 
          icon: '🎯', 
          label: 'Closing Opportunity', 
          cardClass: 'coaching-card--closing', 
          badge: 'bg-[--color-accent-violet]/10 text-[--color-accent-violet] border-[--color-accent-violet]/20' 
        };
      default:
        return { 
          icon: '💡', 
          label: 'Tip', 
          cardClass: 'coaching-card--tip', 
          badge: 'bg-[--color-accent-emerald]/10 text-[--color-accent-emerald] border-[--color-accent-emerald]/20' 
        };
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-[--color-accent-rose]/10 text-[--color-accent-rose] border-[--color-accent-rose]/30';
      case 'medium':
        return 'bg-[--color-accent-amber]/10 text-[--color-accent-amber] border-[--color-accent-amber]/30';
      default:
        return 'bg-white/[0.03] text-[--color-text-muted] border-[--color-border]';
    }
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  // Parse streaming JSON to extract suggestion details dynamically
  const getParsedStream = (text) => {
    if (!text) return null;
    const cleanText = text.trim();
    if (!cleanText.startsWith('{')) {
      return { suggestion: cleanText };
    }
    try {
      return JSON.parse(cleanText);
    } catch (e) {
      const result = {};
      const typeMatch = cleanText.match(/"type"\s*:\s*"([^"]*)"/);
      const priorityMatch = cleanText.match(/"priority"\s*:\s*"([^"]*)"/);
      const titleMatch = cleanText.match(/"title"\s*:\s*"([^"]*)"/);
      
      if (typeMatch) result.type = typeMatch[1];
      if (priorityMatch) result.priority = priorityMatch[1];
      if (titleMatch) result.title = titleMatch[1];
      
      const suggestionMatch = cleanText.match(/"suggestion"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (suggestionMatch) {
        result.suggestion = suggestionMatch[1].replace(/\\"/g, '"');
      } else {
        const partialSuggestion = cleanText.match(/"suggestion"\s*:\s*"([^"]*)$/);
        if (partialSuggestion) result.suggestion = partialSuggestion[1];
      }
      
      const scriptMatch = cleanText.match(/"script"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (scriptMatch) {
        result.script = scriptMatch[1].replace(/\\"/g, '"');
      } else {
        const partialScript = cleanText.match(/"script"\s*:\s*"([^"]*)$/);
        if (partialScript) result.script = partialScript[1];
      }
      return result;
    }
  };

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4.5 border-b border-[--color-border] bg-white/[0.01]">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🤖</span>
          <h2 className="text-xs font-bold text-[--color-text-primary] uppercase tracking-wider">
            AI Sales Copilot
          </h2>
          {isStreaming && (
            <div className="flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded-full bg-[--color-accent-blue]/5 border border-[--color-accent-blue]/15 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-[--color-accent-blue]" />
              <span className="text-[9px] text-[--color-accent-blue] font-bold uppercase tracking-wider animate-pulse">Analyzing audio</span>
            </div>
          )}
        </div>
        <span className="text-[10px] font-bold text-[--color-text-muted] uppercase tracking-widest bg-white/[0.04] px-2 py-0.5 rounded-full">
          {suggestions.length} tips
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
                AI Coaching Engine Idle
              </p>
              <p className="text-[--color-text-muted] text-[10px] mt-1 opacity-70">
                Actionable tips and scripts will generate as the dialogue flows
              </p>
            </div>
          ) : (
            <>
              {suggestions.map((suggestion, index) => {
                const config = getTypeConfig(suggestion.type);
                return (
                  <div
                    key={index}
                    className={`glass-card ${config.cardClass} p-4.5 animate-slide-up relative overflow-hidden`}
                    style={{ animationDelay: `${index * 0.08}s` }}
                  >
                    {/* Card Header */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-sm">{config.icon}</span>
                      <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${config.badge}`}>
                        {config.label}
                      </span>
                      {suggestion.priority && (
                        <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ml-auto ${getPriorityBadge(suggestion.priority)}`}>
                          {suggestion.priority}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    {suggestion.title && (
                      <h3 className="text-sm font-bold text-[--color-text-primary] mb-1.5 tracking-tight">
                        {suggestion.title}
                      </h3>
                    )}

                    {/* Suggestion Text */}
                    <p className="text-xs text-[--color-text-secondary] leading-relaxed">
                      {suggestion.suggestion}
                    </p>

                    {/* Script Bubble */}
                    {suggestion.script && (
                      <div className="mt-3.5 relative group/script">
                        <div className="bg-[--color-bg-secondary] rounded-xl p-3.5 border border-[--color-border] bg-opacity-80 transition-all duration-300 group-hover/script:border-white/10">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] text-[--color-text-muted] uppercase tracking-wider font-extrabold">
                              Dialogue talk track
                            </span>
                            <button
                              onClick={() => copyToClipboard(suggestion.script, index)}
                              className="text-[9px] text-[--color-accent-blue] hover:text-[--color-text-primary] transition-all duration-200 opacity-0 group-hover/script:opacity-100 flex items-center gap-1.5 cursor-pointer font-bold uppercase tracking-wider"
                            >
                              {copiedIndex === index ? (
                                <span className="text-[--color-accent-emerald] flex items-center gap-1">
                                  <span>✓</span> Copied
                                </span>
                              ) : (
                                <span>📋 Copy Talk Track</span>
                              )}
                            </button>
                          </div>
                          <p className="text-xs text-[--color-text-primary] italic leading-relaxed font-mono font-medium pl-1.5 border-l-2 border-white/10">
                            "{suggestion.script}"
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Streaming Real-Time Prediction */}
              {isStreaming && streamingText && (() => {
                const parsed = getParsedStream(streamingText);
                if (!parsed || (!parsed.suggestion && !parsed.title)) {
                  return (
                    <div className="glass-card coaching-card--tip p-4.5 animate-fade-in border border-dashed border-[rgba(255,255,255,0.06)] bg-white/[0.005]">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[--color-accent-blue] animate-ping" />
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-[--color-accent-blue]">
                          Analyzing Speech...
                        </span>
                      </div>
                      <div className="space-y-2 py-1">
                        <div className="w-1/2 h-3 bg-white/5 rounded animate-pulse" />
                        <div className="w-5/6 h-2 bg-white/5 rounded animate-pulse" />
                      </div>
                    </div>
                  );
                }
                
                const config = getTypeConfig(parsed.type || 'tip');
                return (
                  <div className={`glass-card ${config.cardClass} p-4.5 animate-fade-in relative overflow-hidden border-dashed border-[--color-border-bright]`}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-sm">{config.icon}</span>
                      <span className="text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border bg-[--color-accent-blue]/5 text-[--color-accent-blue] border-[--color-accent-blue]/15 animate-pulse">
                        Predicting Insights
                      </span>
                      {parsed.priority && (
                        <span className={`text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ml-auto ${getPriorityBadge(parsed.priority)}`}>
                          {parsed.priority}
                        </span>
                      )}
                    </div>

                    {parsed.title && (
                      <h3 className="text-sm font-bold text-[--color-text-primary] mb-1.5 tracking-tight">
                        {parsed.title}
                      </h3>
                    )}

                    {parsed.suggestion && (
                      <p className="text-xs text-[--color-text-secondary] leading-relaxed typing-cursor font-medium">
                        {parsed.suggestion}
                      </p>
                    )}

                    {parsed.script && (
                      <div className="mt-3.5 relative">
                        <div className="bg-[--color-bg-secondary] rounded-xl p-3.5 border border-[--color-border] bg-opacity-80">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] text-[--color-text-muted] uppercase tracking-wider font-extrabold">
                              Dialogue talk track
                            </span>
                          </div>
                          <p className="text-xs text-[--color-text-primary] italic leading-relaxed font-mono font-medium pl-1.5 border-l-2 border-white/10">
                            "{parsed.script}"
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
        
        {/* Soft Scroll-Gradient Overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[--color-bg-secondary] to-transparent pointer-events-none opacity-60" />
      </div>
    </div>
  );
}
