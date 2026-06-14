import { useState, useEffect } from 'react';

/**
 * PlaybookSidebar — Quick-reference panel for the sales playbook.
 */
export default function PlaybookSidebar() {
  const [playbook, setPlaybook] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch('/api/playbook')
      .then(r => r.json())
      .then(setPlaybook)
      .catch(e => console.error('Failed to load playbook:', e));
  }, []);

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
  };

  if (!playbook) {
    return (
      <div className="glass-card h-full flex items-center justify-center">
        <div className="shimmer w-full h-full rounded-lg" />
      </div>
    );
  }

  const sections = [
    { key: 'pricing', title: '💰 Pricing', items: playbook.pricing ? Object.entries(playbook.pricing).map(([k, v]) => ({ label: `${k}: ${v.price}`, detail: v.features?.join(', ') })) : [] },
    { key: 'opening', title: '🎬 Opening Scripts', items: playbook.opening_scripts?.map(s => ({ label: s.scenario, detail: s.script })) || [] },
    { key: 'value', title: '✨ Value Props', items: playbook.value_propositions?.map(v => ({ label: v.headline, detail: v.detail })) || [] },
    { key: 'closing', title: '🎯 Closing', items: playbook.closing_techniques?.map(c => ({ label: c.name, detail: c.script })) || [] },
    { key: 'competitors', title: '⚔️ Competitors', items: playbook.competitor_comparisons?.map(c => ({ label: c.competitor, detail: c.talk_track })) || [] },
  ];

  const filteredSections = searchQuery
    ? sections.map(s => ({
        ...s,
        items: s.items.filter(item =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.detail?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      })).filter(s => s.items.length > 0)
    : sections;

  return (
    <div className="glass-card flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[--color-border]">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📖</span>
          <h2 className="text-sm font-semibold text-[--color-text-primary] uppercase tracking-wider">
            Playbook
          </h2>
        </div>
        {/* Search */}
        <input
          id="playbook-search"
          type="text"
          placeholder="Search playbook..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full bg-[--color-bg-secondary] border border-[--color-border] rounded-lg px-3 py-2 text-sm text-[--color-text-primary] placeholder-[--color-text-muted] outline-none focus:border-[--color-accent-blue] transition-colors"
        />
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {filteredSections.map(section => (
          <div key={section.key}>
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-[--color-bg-glass-hover] transition-all cursor-pointer"
            >
              <span>{section.title}</span>
              <span className={`text-xs transition-transform ${expandedSection === section.key ? 'rotate-180' : ''}`}>
                ▾
              </span>
            </button>

            {expandedSection === section.key && (
              <div className="ml-2 pl-3 border-l border-[--color-border] space-y-2 py-2 animate-slide-up">
                {section.items.map((item, i) => (
                  <div
                    key={i}
                    className="group px-3 py-2 rounded-lg hover:bg-[--color-bg-glass-hover] transition-all cursor-pointer"
                    onClick={() => copyText(item.detail)}
                    title="Click to copy"
                  >
                    <p className="text-xs font-semibold text-[--color-text-primary] mb-0.5">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-[--color-text-muted] line-clamp-2 leading-relaxed">
                      {item.detail}
                    </p>
                    <span className="text-[9px] text-[--color-accent-blue] opacity-0 group-hover:opacity-100 transition-opacity">
                      📋 Click to copy
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Product Info */}
      {playbook.product && (
        <div className="px-5 py-3 border-t border-[--color-border]">
          <p className="text-[10px] text-[--color-text-muted] uppercase tracking-wider">Product</p>
          <p className="text-sm font-semibold text-[--color-text-primary]">{playbook.product.name}</p>
          <p className="text-xs text-[--color-text-muted]">{playbook.product.tagline}</p>
        </div>
      )}
    </div>
  );
}
