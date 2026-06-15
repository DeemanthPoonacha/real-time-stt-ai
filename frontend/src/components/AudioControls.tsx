
import { t } from '../lib/translations';

interface AudioControlsProps {
  isRecording: boolean;
  isDemo: boolean;
  connectionState: string;
  audioLevel: number;
  language: string;
  onToggleRecording: () => void;
  onToggleDemo: () => void;
  onLanguageChange: (lang: string) => void;
  onReset: () => void;
}

/**
 * AudioControls — Redesigned controls featuring a premium mic controller, 
 * language toggle pills, dynamic visualizer, and action buttons.
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
}: AudioControlsProps) {
  const bars = 14;
  const isActive = isRecording || isDemo;

  return (
    <div className="flex items-center gap-5">
      {/* Mic Button */}
      <button
        id="mic-toggle-btn"
        onClick={onToggleRecording}
        disabled={isDemo}
        className={`mic-button ${isRecording ? 'mic-button--active' : ''} ${isDemo ? 'opacity-40 cursor-not-allowed' : ''}`}
        title={isRecording ? t('stopSession', language) : t('startMicStream', language)}
      >
        {isRecording ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)]">
            <rect x="5" y="5" width="14" height="14" rx="3" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {/* Audio Level Spectrum Visualizer */}
      <div className="flex flex-col gap-1 items-center">
        <div className="audio-meter">
          {Array.from({ length: bars }, (_, i) => {
            const midDist = Math.abs(i - bars / 2) / (bars / 2);
            const peakFactor = Math.max(0.1, 1 - midDist);
            const h = isActive
              ? Math.max(4, Math.min(28, audioLevel * 180 * peakFactor + Math.random() * 5))
              : 4;
            return (
              <div
                key={i}
                className="audio-meter__bar"
                style={{
                  height: `${h}px`,
                  opacity: isActive ? 0.4 + (audioLevel * 1.5) : 0.15,
                }}
              />
            );
          })}
        </div>
        <span className="text-[8px] text-[--color-text-muted] uppercase tracking-widest font-extrabold">
          {isActive ? t('liveStream', language) : t('idle', language)}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-white/5" />

      {/* Connection Status Pill */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.01] border border-[--color-border]">
        <div className={`status-dot ${
          connectionState === 'connected' ? 'status-dot--connected' :
          connectionState === 'processing' ? 'status-dot--processing' :
          connectionState === 'error' ? 'status-dot--error' :
          'status-dot--disconnected'
        }`} />
        <span className="text-[10px] text-[--color-text-secondary] uppercase tracking-wider font-bold">
          {connectionState === 'connected' ? t('connected', language) :
           connectionState === 'processing' ? t('processing', language) :
           connectionState === 'error' ? t('error', language) : t('offline', language)}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-white/5" />

      {/* Language Switcher */}
      <div className="flex items-center gap-2">
        <div className="lang-pill-container">
          <button
            onClick={() => onLanguageChange('en')}
            className={`lang-pill ${language === 'en' ? 'lang-pill--active' : ''}`}
            title="English"
          >
            EN
          </button>
          <button
            onClick={() => onLanguageChange('he')}
            className={`lang-pill ${language === 'he' ? 'lang-pill--active' : ''}`}
            title="עברית (Hebrew)"
          >
            HE
          </button>
          <button
            onClick={() => onLanguageChange('auto')}
            className={`lang-pill ${language === 'auto' ? 'lang-pill--active' : ''}`}
            title="Auto-detect Language"
          >
            AUTO
          </button>
        </div>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-white/5" />

      {/* Demo Mode Toggle */}
      <button
        id="demo-toggle-btn"
        onClick={onToggleDemo}
        disabled={isRecording}
        className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 relative overflow-hidden flex items-center gap-1.5 ${
          isDemo
            ? 'bg-gradient-to-r from-[--color-accent-violet] to-indigo-600 text-white shadow-lg shadow-[rgba(139,92,246,0.3)] border border-transparent'
            : 'bg-white/[0.02] border border-[--color-border] text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/[0.05] hover:border-[--color-border-bright]'
        } ${isRecording ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.03]'}`}
      >
        <span>{isDemo ? t('stopDemo', language) : t('playDemo', language)}</span>
      </button>

      {/* Reset Button */}
      <button
        id="reset-btn"
        onClick={onReset}
        className="p-2 px-3.5 rounded-xl text-xs font-bold uppercase tracking-wider text-[--color-text-muted] bg-white/[0.02] border border-[--color-border] hover:text-[--color-accent-rose] hover:border-[--color-accent-rose] hover:bg-[rgba(244,63,94,0.05)] transition-all duration-300 cursor-pointer hover:scale-[1.03]"
        title={t('resetCurrentSession', language)}
      >
        {t('reset', language)}
      </button>
    </div>
  );
}
