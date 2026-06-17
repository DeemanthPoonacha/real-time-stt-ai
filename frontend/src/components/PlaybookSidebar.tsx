import { useState, useEffect, useCallback } from 'react';
import { t } from '../lib/translations';

interface PlaybookPricing {
  price: string;
  features?: string[];
}

interface PlaybookOpening {
  scenario: string;
  script: string;
}

interface PlaybookValueProp {
  headline: string;
  detail: string;
}

interface PlaybookClosing {
  name: string;
  script: string;
}

interface PlaybookCompetitor {
  competitor: string;
  talk_track: string;
}

interface PlaybookProduct {
  name: string;
  tagline: string;
}

interface PlaybookData {
  pricing?: Record<string, PlaybookPricing>;
  opening_scripts?: PlaybookOpening[];
  value_propositions?: PlaybookValueProp[];
  closing_techniques?: PlaybookClosing[];
  competitor_comparisons?: PlaybookCompetitor[];
  product?: PlaybookProduct;
}

interface PlaybookSection {
  key: string;
  title: string;
  items: { label: string; detail: string }[];
}

/**
 * PlaybookSidebar — Dynamic lookup for company product playbook details.
 * Supports keyword search, category quick-filter chips, and stateful copying.
 */
export default function PlaybookSidebar({ language = 'en', activeRetrievedDocs = [], onSpeakScript }: { language?: string; activeRetrievedDocs?: any[]; onSpeakScript?: (script: string) => void }) {
  const [playbook, setPlaybook] = useState<PlaybookData | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ pricing: true });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [copiedItemKey, setCopiedItemKey] = useState<string | null>(null);

  const getSectionKeyForDoc = useCallback((doc: any) => {
    const docSection = (doc.section || '').toLowerCase();
    const docSourceType = (doc.source_type || '').toLowerCase();
    const docSource = (doc.source || '').toLowerCase();

    if (docSection.includes('pricing') || docSourceType === 'pricing' || docSource.includes('pricing')) return 'pricing';
    if (docSection.includes('opening_scripts') || docSourceType === 'opening' || docSource.includes('opening')) return 'opening';
    if (docSection.includes('value_propositions') || docSourceType === 'value' || docSource.includes('value')) return 'value';
    if (docSection.includes('closing_techniques') || docSourceType === 'closing' || docSource.includes('closing')) return 'closing';
    if (docSection.includes('competitor_comparisons') || docSourceType === 'competitor' || docSection.includes('competitors') || docSource.includes('competitor')) return 'competitors';

    if (docSource.includes('objection') || docSourceType === 'objection') return 'competitors';

    return 'value';
  }, []);

  const isMatchedItem = useCallback((sectionKey: string, itemLabel: string, itemDetail: string) => {
    if (!activeRetrievedDocs || activeRetrievedDocs.length === 0) return false;

    return activeRetrievedDocs.some(doc => {
      const docSection = doc.section || '';
      const docSourceType = doc.source_type || '';

      let sectionMatch = false;
      if (sectionKey === 'pricing' && (docSection.includes('pricing') || docSourceType === 'pricing')) sectionMatch = true;
      if (sectionKey === 'opening' && (docSection.includes('opening_scripts') || docSourceType === 'opening')) sectionMatch = true;
      if (sectionKey === 'value' && (docSection.includes('value_propositions') || docSourceType === 'value')) sectionMatch = true;
      if (sectionKey === 'closing' && (docSection.includes('closing_techniques') || docSourceType === 'closing')) sectionMatch = true;
      if (sectionKey === 'competitors' && (docSection.includes('competitor_comparisons') || docSourceType === 'competitor')) sectionMatch = true;

      if (!sectionMatch) return false;

      const textLower = (doc.text || '').toLowerCase();
      let labelLower = (itemLabel || '').toLowerCase();
      if (sectionKey === 'pricing' && labelLower.includes(':')) {
        labelLower = labelLower.split(':')[0].trim();
      }

      const detailLower = (itemDetail || '').toLowerCase();

      return textLower.includes(labelLower) || textLower.includes(detailLower) || detailLower.includes(textLower);
    });
  }, [activeRetrievedDocs]);

  useEffect(() => {
    fetch(`/api/playbook?language=${language}`)
      .then(r => r.json())
      .then(data => {
        setPlaybook(data);
        if (data) setExpandedSections({ pricing: true });
      })
      .catch(e => console.error('Failed to load playbook:', e));
  }, [language]);

  const toggleSection = (sectionKey: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const copyText = (text: string, itemKey: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedItemKey(itemKey);
      setTimeout(() => setCopiedItemKey(null), 2000);
    });
  };

  useEffect(() => {
    if (!activeRetrievedDocs || activeRetrievedDocs.length === 0 || !playbook) return;

    const matchedDoc = activeRetrievedDocs[0];
    if (matchedDoc) {
      const sectionKey = getSectionKeyForDoc(matchedDoc);
      setExpandedSections(prev => ({
        ...prev,
        matches: true,
        [sectionKey]: true
      }));
      setActiveCategory(prev => (prev === 'all' || prev === sectionKey) ? prev : 'all');
    }
  }, [activeRetrievedDocs, playbook, getSectionKeyForDoc]);

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

  const sections: PlaybookSection[] = [
    { key: 'pricing', title: t('pricingPlans', language), items: playbook.pricing ? Object.entries(playbook.pricing).map(([k, v]) => ({ label: language === 'he' ? `${t('planPlan', language)} ${k}: ${v.price}` : `${k}: ${v.price}`, detail: v.features?.join(', ') || '' })) : [] },
    { key: 'opening', title: t('openingScripts', language), items: playbook.opening_scripts?.map(s => ({ label: s.scenario, detail: s.script })) || [] },
    { key: 'value', title: t('valueProps', language), items: playbook.value_propositions?.map(v => ({ label: v.headline, detail: v.detail })) || [] },
    { key: 'closing', title: t('closingTechniques', language), items: playbook.closing_techniques?.map(c => ({ label: c.name, detail: c.script })) || [] },
    { key: 'competitors', title: t('competitorTracks', language), items: playbook.competitor_comparisons?.map(c => ({ label: c.competitor, detail: c.talk_track })) || [] },
  ];

  const dynamicSections = sections.map(section => {
    const currentItems = [...section.items];

    if (activeRetrievedDocs && activeRetrievedDocs.length > 0) {
      activeRetrievedDocs.forEach(doc => {
        const targetSectionKey = getSectionKeyForDoc(doc);
        if (targetSectionKey !== section.key) return;

        const textLower = (doc.text || '').toLowerCase();

        const alreadyExists = currentItems.some(item => {
          const itemLabelLower = (item.label || '').toLowerCase();
          const itemDetailLower = (item.detail || '').toLowerCase();
          return textLower.includes(itemLabelLower) || textLower.includes(itemDetailLower) || itemDetailLower.includes(textLower);
        });

        if (!alreadyExists) {
          let label = doc.section || (language === 'he' ? 'מידע מתוכנית המכירות' : 'Playbook Context');
          let detail = doc.text;

          if (doc.text.includes('\n')) {
            const lines = doc.text.split('\n');
            let category = '';
            let responseText = '';

            for (const line of lines) {
              const lower = line.toLowerCase();
              const colonIdx = line.indexOf(':');
              const value = colonIdx !== -1 ? line.substring(colonIdx + 1).trim() : '';

              if (lower.startsWith('category:') || lower.startsWith('objection:') || lower.startsWith('headline:') || lower.startsWith('name:') || lower.startsWith('scenario:')) {
                category = value;
              } else if (lower.startsWith('response:') || lower.startsWith('primary_script:') || lower.startsWith('response_strategy:') || lower.startsWith('detail:') || lower.startsWith('script:') || lower.startsWith('talk track:') || lower.startsWith('talk_track:')) {
                responseText = value;
              }
            }
            if (category) label = category;
            if (responseText) detail = responseText;
          }

          if (label.length > 50) label = label.substring(0, 47) + '...';

          currentItems.push({
            label,
            detail
          });
        }
      });
    }

    return {
      ...section,
      items: currentItems
    };
  });

  // Create final sections, prepending RAG matches if present
  const finalSections = [...dynamicSections];
  if (activeRetrievedDocs && activeRetrievedDocs.length > 0) {
    const matchItems = activeRetrievedDocs.map(doc => {
      let label = doc.section || (language === 'he' ? 'מידע מתוכנית המכירות' : 'Playbook Context');
      let detail = doc.text;
      
      if (doc.text.includes('\n')) {
        const lines = doc.text.split('\n');
        let category = '';
        let responseText = '';
        
        for (const line of lines) {
          const lower = line.toLowerCase();
          const colonIdx = line.indexOf(':');
          const value = colonIdx !== -1 ? line.substring(colonIdx + 1).trim() : '';

          if (lower.startsWith('category:') || lower.startsWith('objection:') || lower.startsWith('headline:') || lower.startsWith('name:') || lower.startsWith('scenario:')) {
            category = value;
          } else if (lower.startsWith('response:') || lower.startsWith('primary_script:') || lower.startsWith('response_strategy:') || lower.startsWith('detail:') || lower.startsWith('script:') || lower.startsWith('talk track:') || lower.startsWith('talk_track:')) {
            responseText = value;
          }
        }
        if (category) label = category;
        if (responseText) detail = responseText;
      }
      
      if (label.length > 50) label = label.substring(0, 47) + '...';
      
      return { label, detail };
    });

    finalSections.unshift({
      key: 'matches',
      title: language === 'he' ? '🎯 התאמות בזמן אמת' : '🎯 Live Matches',
      items: matchItems
    });
  }

  // Quick categories
  const categories = [
    { key: 'all', label: t('all', language) },
    { key: 'pricing', label: t('pricingCategory', language) },
    { key: 'opening', label: t('openingCategory', language) },
    { key: 'value', label: t('valueCategory', language) },
    { key: 'closing', label: t('closingCategory', language) },
    { key: 'competitors', label: t('competitorsCategory', language) },
  ];

  // Apply search query filter and category selection filter
  const filteredSections = finalSections
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
            {t('playbookTitle', language)}
          </h2>
        </div>

        {/* Search Field */}
        <div className="relative">
          <input
            id="playbook-search"
            type="text"
            placeholder={t('searchPlaceholder', language)}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[--color-bg-secondary] border border-[--color-border] rounded-xl pl-9 pr-3 py-2 text-xs text-[--color-text-primary] placeholder-[--color-text-muted] outline-none focus:border-[--color-accent-blue] focus:ring-1 focus:ring-[--color-accent-blue-glow] transition-all duration-300 bg-opacity-70"
          />
          <svg className="absolute left-3 top-2.5 text-[--color-text-muted] w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
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
                  setExpandedSections(prev => ({ ...prev, [cat.key]: true }));
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
            {t('noSectionsFound', language)}
          </div>
        ) : (
          filteredSections.map(section => (
            <div key={section.key} className="border border-[rgba(255,255,255,0.02)] rounded-xl overflow-hidden bg-white/[0.005]">
              <button
                onClick={() => toggleSection(section.key)}
                className={`w-full flex items-center justify-between px-4 py-3 text-xs font-bold transition-all duration-300 cursor-pointer ${
                  expandedSections[section.key]
                    ? 'text-[--color-text-primary] bg-white/[0.03]'
                    : 'text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/[0.02]'
                }`}
              >
                <span>{section.title}</span>
                <span className={`text-[10px] text-[--color-text-muted] transition-transform duration-300 ${
                  expandedSections[section.key] ? 'rotate-180 text-[--color-accent-blue]' : ''
                }`}>
                  ▼
                </span>
              </button>

              {expandedSections[section.key] && (
                <div className="px-3.5 py-3 space-y-2.5 animate-slide-up border-t border-[rgba(255,255,255,0.02)]">
                  {section.key === 'pricing' ? (
                    section.items.map((item, i) => {
                      const colonIdx = item.label.indexOf(':');
                      const name = colonIdx !== -1 ? item.label.substring(0, colonIdx).trim() : item.label;
                      const price = colonIdx !== -1 ? item.label.substring(colonIdx + 1).trim() : '';
                      const uniqueKey = `${section.key}-${i}`;
                      const isMatched = isMatchedItem(section.key, item.label, item.detail);

                      return (
                        <div
                          key={i}
                          className={`group p-3.5 rounded-xl transition-all duration-200 cursor-pointer border ${
                            isMatched
                              ? 'bg-[rgba(99,102,241,0.08)] border-[--color-accent-blue]/40 shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                              : 'bg-white/[0.005] border-white/[0.02] hover:bg-white/[0.02] hover:border-[--color-border]'
                          }`}
                          onClick={() => copyText(`${name}: ${price} (${item.detail})`, uniqueKey)}
                          title={t('clickToCopyPlan', language)}
                        >
                          <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-[10px] uppercase tracking-wider text-[--color-accent-blue]">
                                {language === 'he' ? `${t('planPlan', language)} ${name}` : `${name} ${t('planPlan', language)}`}
                              </span>
                              {isMatched && (
                                <span className="text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[--color-accent-blue]/20 border border-[--color-accent-blue]/35 text-[--color-text-primary] animate-pulse">
                                  {language === 'he' ? 'התאמה' : 'Match'}
                                </span>
                              )}
                            </div>
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

                          <div className="mt-2.5 pt-2 border-t border-white/[0.02] flex items-center justify-between">
                            <span className={`text-[9px] font-extrabold uppercase tracking-wide transition-all duration-200 ${
                              copiedItemKey === uniqueKey
                                ? 'text-[--color-accent-emerald] opacity-100'
                                : 'text-[--color-accent-blue] opacity-0 group-hover:opacity-100'
                            }`}>
                              {copiedItemKey === uniqueKey ? t('planCopied', language) : t('copyPlanDetails', language)}
                            </span>
                            {onSpeakScript && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSpeakScript(
                                    language === 'he'
                                      ? `תוכנית ${name} עולה ${price} וכוללת ${item.detail}`
                                      : `${name} plan is ${price} and includes ${item.detail}`
                                  );
                                }}
                                className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[--color-text-primary] transition-all duration-200 cursor-pointer opacity-0 group-hover:opacity-100"
                                title={language === 'he' ? 'דבר' : 'Speak'}
                              >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-0.5">
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                <span>{language === 'he' ? 'דבר' : 'Speak'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    section.items.map((item, i) => {
                      const uniqueKey = `${section.key}-${i}`;
                      const isMatched = isMatchedItem(section.key, item.label, item.detail) || section.key === 'matches';
                      return (
                        <div
                          key={i}
                          className={`group p-3 rounded-xl border transition-all duration-200 cursor-pointer relative ${
                            isMatched
                              ? 'bg-[rgba(99,102,241,0.08)] border-[--color-accent-blue]/40 shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                              : 'border-transparent hover:border-[--color-border] bg-white/[0.005] hover:bg-white/[0.02]'
                          }`}
                          onClick={() => copyText(item.detail, uniqueKey)}
                          title={t('clickToCopyScript', language)}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-bold text-[--color-text-primary] mb-0">
                              {item.label}
                            </p>
                            {isMatched && (
                              <span className="text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[--color-accent-blue]/20 border border-[--color-accent-blue]/35 text-[--color-text-primary] animate-pulse">
                                {section.key === 'matches'
                                  ? (language === 'he' ? 'התאמה בזמן אמת' : 'Live Match')
                                  : (language === 'he' ? 'התאמה לתוכנית' : 'Playbook Match')}
                              </span>
                            )}
                          </div>
                          <p className="border-l pl-2 text-sm text-[--color-text-secondary] leading-relaxed">
                            {item.detail}
                          </p>
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className={`text-[9px] font-extrabold uppercase tracking-wide transition-all duration-200 ${
                              copiedItemKey === uniqueKey
                                ? 'text-[--color-accent-emerald] opacity-100'
                                : 'text-[--color-accent-blue] opacity-0 group-hover:opacity-100'
                            }`}>
                              {copiedItemKey === uniqueKey ? t('scriptCopied', language) : t('clickToCopy', language)}
                            </span>
                            {onSpeakScript && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSpeakScript(item.detail);
                                }}
                                className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-[--color-text-primary] transition-all duration-200 cursor-pointer opacity-0 group-hover:opacity-100"
                                title={language === 'he' ? 'דבר' : 'Speak'}
                              >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--color-accent-blue] mr-0.5">
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                <span>{language === 'he' ? 'דבר' : 'Speak'}</span>
                              </button>
                            )}
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
            <p className="text-[8px] text-[--color-text-muted] uppercase tracking-widest font-extrabold">
              {t('playbookScope', language)}
            </p>
            <p className="text-xs font-bold text-[--color-text-primary] mt-0.5">{playbook.product.name}</p>
            <p className="text-[10px] text-[--color-text-muted] mt-0.5 font-medium">{playbook.product.tagline}</p>
          </div>
          <span className="text-lg animate-pulse">⚡</span>
        </div>
      )}
    </div>
  );
}
