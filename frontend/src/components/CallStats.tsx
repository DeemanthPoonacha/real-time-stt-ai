import { useState, useEffect } from 'react';
import { t } from '../lib/translations';

interface CallStatsProps {
  callStartTime: number | null;
  isActive: boolean;
  transcriptCount: number;
  suggestionCount: number;
  objectionsDetected: number;
  language: string;
}

/**
 * CallStats — Displays key session metrics in high-fidelity cards.
 */
export default function CallStats({ 
  callStartTime, 
  isActive, 
  transcriptCount, 
  suggestionCount, 
  objectionsDetected,
  language
}: CallStatsProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive || !callStartTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive, callStartTime]);

  useEffect(() => {
    if (!isActive) setElapsed(0);
  }, [isActive]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const stats = [
    { 
      label: t('callDuration', language), 
      value: formatDuration(elapsed), 
      icon: '⏱️', 
      color: 'text-accent-blue',
      bgColor: 'rgba(56,189,248,0.06)',
      borderColor: 'rgba(56,189,248,0.12)'
    },
    { 
      label: t('transcripts', language), 
      value: transcriptCount.toString(), 
      icon: '💬', 
      color: 'text-accent-emerald',
      bgColor: 'rgba(16,185,129,0.06)',
      borderColor: 'rgba(16,185,129,0.12)'
    },
    { 
      label: t('aiCoachTips', language), 
      value: suggestionCount.toString(), 
      icon: '🤖', 
      color: 'text-accent-violet',
      bgColor: 'rgba(167,139,250,0.06)',
      borderColor: 'rgba(167,139,250,0.12)'
    },
    { 
      label: t('objectionsBlocked', language), 
      value: objectionsDetected.toString(), 
      icon: '⚠️', 
      color: 'text-accent-rose',
      bgColor: 'rgba(244,63,94,0.06)',
      borderColor: 'rgba(244,63,94,0.12)'
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div 
          key={i} 
          className="glass-card glass-card-hoverable px-4 py-4 flex items-center gap-3.5 animate-slide-up" 
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          {/* Glowing Icon Wrapper */}
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-inner border flex-shrink-0"
            style={{ 
              backgroundColor: stat.bgColor, 
              borderColor: stat.borderColor,
              boxShadow: `0 0 15px ${stat.bgColor}`
            }}
          >
            <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]">{stat.icon}</span>
          </div>

          {/* Metric Details */}
          <div>
            <p className={`text-lg lg:text-xl font-black ${stat.color} font-mono tracking-tight`}>
              {stat.value}
            </p>
            <p className="text-[10px] sm:text-[11px] text-text-secondary uppercase tracking-wider font-bold mt-0.5">
              {stat.label}
            </p>
          </div>

          {/* Active Breath Indicator for Call Duration */}
          {i === 0 && isActive && (
            <div className="ml-auto w-2 h-2 rounded-full bg-accent-blue animate-ping flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}
