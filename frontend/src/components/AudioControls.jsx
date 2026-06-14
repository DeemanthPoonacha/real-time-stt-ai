import { useState, useRef, useEffect } from 'react';

/**
 * AudioControls — Mic button, language selector, connection status, and audio level meter.
 */
export default function AudioControls({
  isRecording,
  isDemo,
  connectionState,
  audioLevel,
  language,
  onToggleRecording,
  onToggleDemo,
  onLanguageChange,
  onReset,
}) {
  const bars = 12;

  return (
    <div className="flex items-center gap-6">
      {/* Mic Button */}
      <button
        id="mic-toggle-btn"
        onClick={onToggleRecording}
        disabled={isDemo}
        className={`mic-button ${isRecording ? 'mic-button--active' : ''} ${isDemo ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isRecording ? 'Stop Recording' : 'Start Recording'}
      >
        {isRecording ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {/* Audio Level Meter */}
      <div className="audio-meter">
        {Array.from({ length: bars }, (_, i) => {
          const h = isRecording
            ? Math.max(3, Math.min(24, audioLevel * 200 * Math.sin((i / bars) * Math.PI) + Math.random() * 4))
            : 3;
          return (
            <div
              key={i}
              className="audio-meter__bar"
              style={{
                height: `${h}px`,
                opacity: isRecording ? 0.5 + audioLevel * 2 : 0.2,
              }}
            />
          );
        })}
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2">
        <div className={`status-dot ${
          connectionState === 'connected' ? 'status-dot--connected' :
          connectionState === 'processing' ? 'status-dot--processing' :
          'status-dot--disconnected'
        }`} />
        <span className="text-xs text-[--color-text-muted] uppercase tracking-wider font-medium">
          {connectionState === 'connected' ? 'Connected' :
           connectionState === 'processing' ? 'Processing' :
           connectionState === 'error' ? 'Error' : 'Disconnected'}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-[--color-border]" />

      {/* Language Selector */}
      <div className="flex items-center gap-2">
        <label htmlFor="language-select" className="text-xs text-[--color-text-muted] uppercase tracking-wider">
          Lang
        </label>
        <select
          id="language-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="bg-[--color-bg-glass] border border-[--color-border] rounded-lg px-3 py-1.5 text-sm text-[--color-text-primary] outline-none focus:border-[--color-accent-blue] transition-colors cursor-pointer"
        >
          <option value="en">English</option>
          <option value="he">עברית (Hebrew)</option>
          <option value="auto">Auto-detect</option>
        </select>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-[--color-border]" />

      {/* Demo Mode Toggle */}
      <button
        id="demo-toggle-btn"
        onClick={onToggleDemo}
        disabled={isRecording}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          isDemo
            ? 'bg-[--color-accent-violet] text-white shadow-lg shadow-[--color-accent-violet-glow]'
            : 'bg-[--color-bg-glass] border border-[--color-border] text-[--color-text-secondary] hover:text-[--color-text-primary] hover:border-[--color-border-bright]'
        } ${isRecording ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {isDemo ? '⏹ Stop Demo' : '▶ Demo Mode'}
      </button>

      {/* Reset Button */}
      <button
        id="reset-btn"
        onClick={onReset}
        className="px-3 py-2 rounded-lg text-sm text-[--color-text-muted] bg-[--color-bg-glass] border border-[--color-border] hover:text-[--color-accent-rose] hover:border-[--color-accent-rose] transition-all cursor-pointer"
        title="Reset Session"
      >
        ↻ Reset
      </button>
    </div>
  );
}
