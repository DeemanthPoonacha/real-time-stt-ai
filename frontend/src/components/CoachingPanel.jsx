import { useEffect, useRef, useState } from 'react';

/**
 * CoachingPanel — Displays AI coaching suggestions with streaming text effect.
 * Color-coded by type (objection, tip, script, alert, closing).
 */
export default function CoachingPanel({ suggestions, streamingText, isStreaming }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [suggestions, streamingText]);

  const getTypeConfig = (type) => {
    switch (type) {
      case 'objection':
        return { icon: '🔴', label: 'Objection Handling', cardClass: 'coaching-card--objection', badge: 'bg-[--color-accent-rose]/20 text-[--color-accent-rose]' };
      case 'tip':
        return { icon: '💡', label: 'Coaching Tip', cardClass: 'coaching-card--tip', badge: 'bg-[--color-accent-emerald]/20 text-[--color-accent-emerald]' };
      case 'script':
        return { icon: '📝', label: 'Suggested Script', cardClass: 'coaching-card--script', badge: 'bg-[--color-accent-blue]/20 text-[--color-accent-blue]' };
      case 'alert':
        return { icon: '⚡', label: 'Alert', cardClass: 'coaching-card--alert', badge: 'bg-[--color-accent-amber]/20 text-[--color-accent-amber]' };
      case 'closing':
        return { icon: '🎯', label: 'Closing Opportunity', cardClass: 'coaching-card--closing', badge: 'bg-[--color-accent-violet]/20 text-[--color-accent-violet]' };
      default:
        return { icon: '💡', label: 'Tip', cardClass: 'coaching-card--tip', badge: 'bg-[--color-accent-emerald]/20 text-[--color-accent-emerald]' };
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-[--color-accent-rose]/10 text-[--color-accent-rose] border-[--color-accent-rose]/30';
      case 'medium':
        return 'bg-[--color-accent-amber]/10 text-[--color-accent-amber] border-[--color-accent-amber]/30';
      default:
        return 'bg-[--color-bg-glass] text-[--color-text-muted] border-[--color-border]';
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // Brief visual feedback handled by CSS
    });
  };

  return (
    <div className="glass-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[--color-border]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-semibold text-[--color-text-primary] uppercase tracking-wider">
            AI Coach
          </h2>
          {isStreaming && (
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[--color-accent-blue] animate-pulse" />
              <span className="text-[10px] text-[--color-accent-blue] font-medium">Thinking...</span>
            </div>
          )}
        </div>
        <span className="text-xs text-[--color-text-muted]">
          {suggestions.length} suggestions
        </span>
      </div>

      {/* Suggestions List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {suggestions.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-[--color-bg-glass] border border-[--color-border] flex items-center justify-center mb-4 animate-float">
              <span className="text-2xl">🤖</span>
            </div>
            <p className="text-[--color-text-muted] text-sm mb-1">
              AI Coach is ready
            </p>
            <p className="text-[--color-text-muted] text-xs">
              Suggestions will appear as the conversation progresses
            </p>
          </div>
        ) : (
          <>
            {suggestions.map((suggestion, index) => {
              const config = getTypeConfig(suggestion.type);
              return (
                <div
                  key={index}
                  className={`glass-card ${config.cardClass} p-4 animate-slide-up`}
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Card Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">{config.icon}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${config.badge}`}>
                      {config.label}
                    </span>
                    {suggestion.priority && (
                      <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ml-auto ${getPriorityBadge(suggestion.priority)}`}>
                        {suggestion.priority}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  {suggestion.title && (
                    <h3 className="text-sm font-semibold text-[--color-text-primary] mb-1.5">
                      {suggestion.title}
                    </h3>
                  )}

                  {/* Suggestion Text */}
                  <p className="text-sm text-[--color-text-secondary] leading-relaxed">
                    {suggestion.suggestion}
                  </p>

                  {/* Script (if available) */}
                  {suggestion.script && (
                    <div className="mt-3 relative group">
                      <div className="bg-[--color-bg-secondary] rounded-lg p-3 border border-[--color-border]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-[--color-text-muted] uppercase tracking-wider font-medium">
                            Suggested Script
                          </span>
                          <button
                            onClick={() => copyToClipboard(suggestion.script)}
                            className="text-[10px] text-[--color-accent-blue] hover:text-[--color-text-primary] transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                          >
                            📋 Copy
                          </button>
                        </div>
                        <p className="text-sm text-[--color-text-primary] italic leading-relaxed font-mono">
                          "{suggestion.script}"
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming Text */}
            {isStreaming && streamingText && (
              <div className="glass-card coaching-card--tip p-4 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">🤖</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[--color-accent-blue]">
                    Analyzing...
                  </span>
                </div>
                <p className="text-sm text-[--color-text-secondary] leading-relaxed typing-cursor">
                  {streamingText}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
