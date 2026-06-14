import { useState, useEffect } from 'react';

/**
 * CallStats — Live call metrics displayed as stat cards.
 */
export default function CallStats({ callStartTime, isActive, transcriptCount, suggestionCount, objectionsDetected }) {
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

  const formatDuration = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const stats = [
    { label: 'Duration', value: formatDuration(elapsed), icon: '⏱', color: 'text-[--color-accent-blue]' },
    { label: 'Transcripts', value: transcriptCount, icon: '📝', color: 'text-[--color-accent-emerald]' },
    { label: 'AI Tips', value: suggestionCount, icon: '🤖', color: 'text-[--color-accent-violet]' },
    { label: 'Objections', value: objectionsDetected, icon: '🔴', color: 'text-[--color-accent-rose]' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <div key={i} className="glass-card px-4 py-3 flex items-center gap-3 animate-slide-up" style={{ animationDelay: `${i * 0.1}s` }}>
          <span className="text-xl">{stat.icon}</span>
          <div>
            <p className={`text-lg font-bold ${stat.color} font-mono`}>{stat.value}</p>
            <p className="text-[10px] text-[--color-text-muted] uppercase tracking-wider">{stat.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
