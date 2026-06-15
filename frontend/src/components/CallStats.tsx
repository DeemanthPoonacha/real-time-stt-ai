import { useState, useEffect } from 'react';

interface CallStatsProps {
  callStartTime: number | null;
  isActive: boolean;
  transcriptCount: number;
  suggestionCount: number;
  objectionsDetected: number;
}

/**
 * CallStats — Displays key session metrics in high-fidelity cards.
 */
export default function CallStats({ 
  callStartTime, 
  isActive, 
  transcriptCount, 
  suggestionCount, 
  objectionsDetected 
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
      label: 'Call Duration', 
      value: formatDuration(elapsed), 
      icon: '⏱️', 
      color: 'text-[--color-accent-blue]',
      bgColor: 'rgba(56,189,248,0.06)',
      borderColor: 'rgba(56,189,248,0.12)'
    },
    { 
      label: 'Transcripts', 
      value: transcriptCount.toString(), 
      icon: '💬', 
      color: 'text-[--color-accent-emerald]',
      bgColor: 'rgba(16,185,129,0.06)',
      borderColor: 'rgba(16,185,129,0.12)'
    },
    { 
      label: 'AI Coach Tips', 
      value: suggestionCount.toString(), 
      icon: '🤖', 
      color: 'text-[--color-accent-violet]',
      bgColor: 'rgba(167,139,250,0.06)',
      borderColor: 'rgba(167,139,250,0.12)'
    },
    { 
      label: 'Objections Blocked', 
      value: objectionsDetected.toString(), 
      icon: '⚠️', 
      color: 'text-[--color-accent-rose]',
      bgColor: 'rgba(244,63,94,0.06)',
      borderColor: 'rgba(244,63,94,0.12)'
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div 
          key={i} 
          className="glass-card glass-card-hoverable px-5 py-4.5 flex items-center gap-4 animate-slide-up" 
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          {/* Glowing Icon Wrapper */}
          <div 
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow-inner border"
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
            <p className={`text-xl font-black ${stat.color} font-mono tracking-tight`}>
              {stat.value}
            </p>
            <p className="text-[9px] text-[--color-text-muted] uppercase tracking-wider font-extrabold mt-0.5">
              {stat.label}
            </p>
          </div>

          {/* Active Breath Indicator for Call Duration */}
          {i === 0 && isActive && (
            <div className="ml-auto w-2 h-2 rounded-full bg-[--color-accent-blue] animate-ping" />
          )}
        </div>
      ))}
    </div>
  );
}
