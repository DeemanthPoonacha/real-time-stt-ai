import { useState, useEffect } from 'react';

/**
 * PlaybookSidebar — Dynamic lookup for company product playbook details.
 * Supports keyword search, category quick-filter chips, and stateful copying.
 */
export default function PlaybookSidebar() {
  const [playbook, setPlaybook] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [copiedItemKey, setCopiedItemKey] = useState(null);

  useEffect(() => {
    fetch('/api/playbook')
      .then(r => r.json())
      .then(data => {
        setPlaybook(data);
        // Expand first section by default for better onboarding UI
        if (data) setExpandedSection('pricing');
      })
      .catch(e => console.error('Failed to load playbook:', e));
  }, []);

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const copyText = (text, itemKey) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedItemKey(itemKey);
      setTimeout(() => setCopiedItemKey(null), 2000);
    });
  };

  if (!playbook) {
    return (
      <div className="glass-card h-full flex flex-col p-5 space-y-4 overflow-hidden">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white/10 rounded animate-pulse" />
          <div className="w-24 h-4 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="w-full h-9 bg-white/5 rounded-xl animate-pulse" />
        <div className="flex-grow space-y-2.5">
          <div className="w-full h-11 bg-white/[0.01] border border-white/5 rounded-xl shimmer" />
          <div className="w-full h-11 bg-white/[0.01] border border-white/5 rounded-xl shimmer" />
          <div className="w-full h-11 bg-white/[0.01] border border-white/5 rounded-xl shimmer" />
        </div>
      </div>
    );
  }

  const sections = [
    { key: 'pricing', title: '💰 Pricing Plans', items: playbook.pricing ? Object.entries(playbook.pricing).map(([k, v]) => ({ label: `${k}: ${v.price}`, detail: v.features?.join(', ') })) : [] },
    { key: 'opening', title: '🎬 Opening Scripts', items: playbook.opening_scripts?.map(s => ({ label: s.scenario, detail: s.script })) || [] },
    { key: 'value', title: '✨ Value Props', items: playbook.value_propositions?.map(v => ({ label: v.headline, detail: v.detail })) || [] },
    { key: 'closing', title: '🎯 Closing Techniques', items: playbook.closing_techniques?.map(c => ({ label: c.name, detail: c.script })) || [] },
    { key: 'competitors', title: '⚔️ Competitor Tracks', items: playbook.competitor_comparisons?.map(c => ({ label: c.competitor, detail: c.talk_track })) || [] },
  ];

  // Quick categories
  const categories = [
    { key: 'all', label: 'All' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'opening', label: 'Opening' },
    { key: 'value', label: 'Value' },
    { key: 'closing', label: 'Closing' },
    { key: 'competitors', label: 'Battlecards' },
  ];

  // Apply search query filter and category selection filter
  const filteredSections = sections
    .filter(s => activeCategory === 'all' || s.key === activeCategory)
    .map(s => {
      const filteredItems = s.items.filter(item =>
        !searchQuery ||
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.detail?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      return { ...s, items: filteredItems };
    })
    .filter(s => s.items.length > 0);

  return (
    <div className="glass-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4.5 border-b border-[--color-border] bg-white/[0.01] space-y-3.5 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-base">📖</span>
          <h2 className="text-xs font-bold text-[--color-text-primary] uppercase tracking-wider">
            Sales Playbook
          </h2>
        </div>

        {/* Search Field */}
        <div className="relative">
          <input
            id="playbook-search"
            type="text"
            placeholder="Search talk tracks, pricing..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[--color-bg-secondary] border border-[--color-border] rounded-xl pl-9 pr-3 py-2 text-xs text-[--color-text-primary] placeholder-[--color-text-muted] outline-none focus:border-[--color-accent-blue] focus:ring-1 focus:ring-[--color-accent-blue-glow] transition-all duration-300 bg-opacity-70"
          />
          <svg className="absolute left-3 top-2.5 text-[--color-text-muted] w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
          {categories.map(cat => (
            <button
              key={cat.key}
              onClick={() => {
                setActiveCategory(cat.key);
                if (cat.key !== 'all') {
                  setExpandedSection(cat.key);
                }
              }}
              className={`filter-chip ${activeCategory === cat.key ? 'filter-chip--active' : ''}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accordion List Content */}
      <div className="flex-grow overflow-y-auto p-3.5 space-y-2">
        {filteredSections.length === 0 ? (
          <div className="text-center py-12 text-[--color-text-muted] text-xs">
            No playbook sections found matching criteria
          </div>
        ) : (
          filteredSections.map(section => (
            <div key={section.key} className="border border-[rgba(255,255,255,0.02)] rounded-xl overflow-hidden bg-white/[0.005]">
              <button
                onClick={() => toggleSection(section.key)}
                className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold transition-all duration-300 cursor-pointer ${
                  expandedSection === section.key 
                    ? 'text-[--color-text-primary] bg-white/[0.03]' 
                    : 'text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/[0.02]'
                }`}
              >
                <span>{section.title}</span>
                <span className={`text-[10px] text-[--color-text-muted] transition-transform duration-300 ${
                  expandedSection === section.key ? 'rotate-180 text-[--color-accent-blue]' : ''
                }`}>
                  ▼
                </span>
              </button>

              {expandedSection === section.key && (
                <div className="px-3.5 py-3 space-y-2.5 animate-slide-up border-t border-[rgba(255,255,255,0.02)]">
                  {section.key === 'pricing' ? (
                    section.items.map((item, i) => {
                      const parts = item.label.split(':');
                      const name = parts[0]?.trim() || '';
                      const price = parts[1]?.trim() || '';
                      const uniqueKey = `${section.key}-${i}`;
                      
                      return (
                        <div
                          key={i}
                          className="group p-3.5 rounded-xl bg-white/[0.005] hover:bg-white/[0.02] border border-white/[0.02] hover:border-[--color-border] transition-all duration-200 cursor-pointer"
                          onClick={() => copyText(`${name}: ${price} (${item.detail})`, uniqueKey)}
                          title="Click to copy plan details"
                        >
                          <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                            <span className="font-extrabold text-[10px] uppercase tracking-wider text-[--color-accent-blue]">
                              {name} Plan
                            </span>
                            <span className="font-mono text-xs font-bold text-white bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                              {price}
                            </span>
                          </div>
                          
                          {/* Features */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {item.detail.split(',').map((feat, fi) => (
                              <span key={fi} className="text-[9px] text-[--color-text-secondary] bg-white/[0.015] px-2 py-0.5 rounded-full border border-white/[0.02] font-medium">
                                ✓ {feat.trim()}
                              </span>
                            ))}
                          </div>
                          
                          <div className="mt-2.5 pt-2 border-t border-white/[0.02] flex items-center gap-1">
                            <span className={`text-[9px] font-extrabold uppercase tracking-wide transition-all duration-200 ${
                              copiedItemKey === uniqueKey 
                                ? 'text-[--color-accent-emerald] opacity-100' 
                                : 'text-[--color-accent-blue] opacity-0 group-hover:opacity-100'
                            }`}>
                              {copiedItemKey === uniqueKey ? '✓ Plan copied' : '📋 Copy Plan Details'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    section.items.map((item, i) => {
                      const uniqueKey = `${section.key}-${i}`;
                      return (
                        <div
                          key={i}
                          className="group p-3 rounded-xl bg-white/[0.005] hover:bg-white/[0.02] border border-transparent hover:border-[--color-border] transition-all duration-200 cursor-pointer relative"
                          onClick={() => copyText(item.detail, uniqueKey)}
                          title="Click to copy script"
                        >
                          <p className="text-xs font-bold text-[--color-text-primary] mb-1">
                            {item.label}
                          </p>
                          <p className="text-[11px] text-[--color-text-secondary] leading-relaxed line-clamp-3">
                            {item.detail}
                          </p>
                          <div className="mt-2.5 flex items-center gap-1">
                            <span className={`text-[9px] font-extrabold uppercase tracking-wide transition-all duration-200 ${
                              copiedItemKey === uniqueKey 
                                ? 'text-[--color-accent-emerald] opacity-100' 
                                : 'text-[--color-accent-blue] opacity-0 group-hover:opacity-100'
                            }`}>
                              {copiedItemKey === uniqueKey ? '✓ Script Copied' : '📋 Click to copy'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer Playbook Meta */}
      {playbook.product && (
        <div className="px-5 py-3.5 border-t border-[--color-border] bg-white/[0.01] flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-[8px] text-[--color-text-muted] uppercase tracking-widest font-extrabold">Playbook Scope</p>
            <p className="text-xs font-bold text-[--color-text-primary] mt-0.5">{playbook.product.name}</p>
            <p className="text-[10px] text-[--color-text-muted] mt-0.5 font-medium">{playbook.product.tagline}</p>
          </div>
          <span className="text-lg animate-pulse">⚡</span>
        </div>
      )}
    </div>
  );
}
