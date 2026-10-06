'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type EarningsScanCard } from '@/components/EarningsScanCard';
import { HUB_FILTER_DEFAULT } from './constants';
import { passesHubFilter } from './helpers';
import { type HubFilters } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0539 — Hub-Scan-style filter rail (rich view only).
// Composes AND-style with the conviction-level filters. Each chip shows the
// post-filter count so the user sees how each chip would narrow the view.
// ═══════════════════════════════════════════════════════════════════════════
export function HubFilterRail({
  cards, filters, setFilters, watchlistSet, portfolioSet,
}: {
  cards: EarningsScanCard[];
  filters: HubFilters;
  setFilters: React.Dispatch<React.SetStateAction<HubFilters>>;
  watchlistSet: Set<string>;
  portfolioSet: Set<string>;
}) {
  const chipBase: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 14,
    cursor: 'pointer', border: '1px solid #2A3B4C', background: '#0A1422',
    color: '#8BA3C1', whiteSpace: 'nowrap',
  };
  const chipActive = (color: string): React.CSSProperties => ({
    ...chipBase, background: `${color}22`, borderColor: `${color}99`, color,
  });

  // count helper — probe filter narrows by toggling chip in question
  const countGradeChip = (g: HubFilters['grades'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.grades);
    if (next.has(g as any)) next.delete(g as any); else next.add(g as any);
    const probe: HubFilters = { ...filters, grades: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countScoreChip = (v: number) => {
    const probe: HubFilters = { ...filters, scoreMin: filters.scoreMin === v ? null : v };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countDivergenceChip = () => {
    const probe: HubFilters = { ...filters, divergenceOnly: !filters.divergenceOnly };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countDqChip = (q: HubFilters['dataQuality'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.dataQuality);
    if (next.has(q as any)) next.delete(q as any); else next.add(q as any);
    const probe: HubFilters = { ...filters, dataQuality: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };
  const countAudienceChip = (a: HubFilters['audience'] extends Set<infer X> ? X : never) => {
    const next = new Set(filters.audience);
    if (next.has(a as any)) next.delete(a as any); else next.add(a as any);
    const probe: HubFilters = { ...filters, audience: next };
    return cards.filter(c => passesHubFilter(c, probe, watchlistSet, portfolioSet)).length;
  };

  const toggleGrade = (g: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD') =>
    setFilters(f => {
      const next = new Set(f.grades);
      if (next.has(g)) next.delete(g); else next.add(g);
      return { ...f, grades: next };
    });
  const toggleDq = (q: 'FULL' | 'PARTIAL' | 'PRICE_ONLY') =>
    setFilters(f => {
      const next = new Set(f.dataQuality);
      if (next.has(q)) next.delete(q); else next.add(q);
      return { ...f, dataQuality: next };
    });
  const toggleAudience = (a: 'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK') =>
    setFilters(f => {
      const next = new Set(f.audience);
      if (next.has(a)) next.delete(a); else next.add(a);
      return { ...f, audience: next };
    });

  const isDefault =
    filters.grades.size === 0 && filters.scoreMin === null && !filters.divergenceOnly &&
    filters.dataQuality.size === 0 && filters.audience.size === 0;

  const gradeCfg: Array<{ v: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD'; color: string }> = [
    { v: 'EXCELLENT', color: '#7C3AED' },
    { v: 'STRONG',    color: '#00C853' },
    { v: 'GOOD',      color: '#4CAF50' },
    { v: 'OK',        color: '#FFD600' },
    { v: 'BAD',       color: '#F44336' },
  ];

  return (
    <div style={{
      padding: '10px 14px', backgroundColor: 'var(--mc-bg-0)',
      border: '1px solid var(--mc-bg-4)', borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px' }}>
          HUB FILTERS
        </div>
        <button onClick={() => setFilters(HUB_FILTER_DEFAULT)}
          disabled={isDefault}
          style={{ ...chipBase, opacity: isDefault ? 0.4 : 1 }}>Clear</button>
      </div>
      {/* GRADE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>GRADE</span>
        {gradeCfg.map(g => {
          const active = filters.grades.has(g.v);
          return (
            <button key={g.v} onClick={() => toggleGrade(g.v)}
              style={active ? chipActive(g.color) : chipBase}>
              {g.v} <span style={{ color: active ? g.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countGradeChip(g.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* SCORE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>SCORE</span>
        {[60, 75, 85].map(v => {
          const active = filters.scoreMin === v;
          return (
            <button key={v} onClick={() => setFilters(f => ({ ...f, scoreMin: f.scoreMin === v ? null : v }))}
              style={active ? chipActive('#22D3EE') : chipBase}>
              ≥{v} <span style={{ color: active ? 'var(--mc-cyan)' : 'var(--mc-text-4)', marginLeft: 3 }}>({countScoreChip(v)})</span>
            </button>
          );
        })}
      </div>
      {/* AUDIENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>AUDIENCE</span>
        {([
          { v: 'PORTFOLIO', color: '#10B981' },
          { v: 'WATCHLIST', color: '#0F7ABF' },
          { v: 'BOTH',      color: '#8B5CF6' },
          { v: 'BANK',      color: '#FF9800' },
        ] as const).map(o => {
          const active = filters.audience.has(o.v as any);
          return (
            <button key={o.v} onClick={() => toggleAudience(o.v as any)}
              style={active ? chipActive(o.color) : chipBase}>
              {o.v} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countAudienceChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DATA QUALITY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>QUALITY</span>
        {([
          { v: 'FULL', color: '#00C853', lbl: 'Full' },
          { v: 'PARTIAL', color: '#FFD600', lbl: 'Partial' },
          { v: 'PRICE_ONLY', color: '#F44336', lbl: 'Price Only' },
        ] as const).map(o => {
          const active = filters.dataQuality.has(o.v as any);
          return (
            <button key={o.v} onClick={() => toggleDq(o.v as any)}
              style={active ? chipActive(o.color) : chipBase}>
              {o.lbl} <span style={{ color: active ? o.color : 'var(--mc-text-4)', marginLeft: 3 }}>({countDqChip(o.v as any)})</span>
            </button>
          );
        })}
      </div>
      {/* DIVERGENCE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>FLAGS</span>
        <button onClick={() => setFilters(f => ({ ...f, divergenceOnly: !f.divergenceOnly }))}
          style={filters.divergenceOnly ? chipActive('#F59E0B') : chipBase}>
          ⚡ Divergence Only <span style={{ color: filters.divergenceOnly ? 'var(--mc-warn)' : 'var(--mc-text-4)', marginLeft: 3 }}>({countDivergenceChip()})</span>
        </button>
      </div>
    </div>
  );
}
