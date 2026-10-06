'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { type ReactNode, useState, useMemo, useEffect } from 'react';
import { Activity, TrendingUp, BookOpen, Globe, Calendar, Map as MapIcon, CheckSquare, ExternalLink, AlertCircle } from 'lucide-react';
import { TIER_MAP, CONFERENCES, TAG_COLORS, SUPPLY_CHAIN } from './constants';
import { SCORE_FORMULA_LINES, PROMOTED_THEMES_KEY, GEO_MECHANISMS, EARNINGS_WATCH, TIER_TO_BUCKET } from './constants2';
import { scoreColor, detectEmergingThemes, detectMechanism, cleanUrl, getTickerSymbols, timeAgo, useConferenceSignals, useEarningsSignals, calcBucketVelocity } from './helpers';
import { type Tab, type NewsArticle, type BnDashboard } from './types';

export const TAB_META: Record<Tab, { icon: ReactNode; short: string; description: string }> = {
  Rotation:  { icon: <Activity className="w-3.5 h-3.5" />,   short: 'Rotation',  description: 'Active bottleneck layer right now — Model 04' },
  Scanner:   { icon: <TrendingUp className="w-3.5 h-3.5" />, short: 'Scanner',   description: 'Bottleneck stocks ranked by Serenity Score — Models 02, 06, 10' },
  Drilldown: { icon: <BookOpen className="w-3.5 h-3.5" />,   short: 'Drilldown', description: "Per-layer: why it's a bottleneck, supply vs demand, winners & losers — Model 01" },
  Geo:       { icon: <Globe className="w-3.5 h-3.5" />,      short: 'Geo',       description: 'Active geopolitical events accelerating or threatening bottleneck positions — Models 25, 29, 36' },
  Calendar:  { icon: <Calendar className="w-3.5 h-3.5" />,   short: 'Calendar',  description: 'Upcoming industry conferences — frontrun 4-6 weeks early — Model 22' },
  Map:       { icon: <MapIcon className="w-3.5 h-3.5" />,    short: 'Map',       description: 'AI infrastructure supply chain value chain from raw materials to hyperscaler — Model 01, 05, 18' },
  Checklist: { icon: <CheckSquare className="w-3.5 h-3.5" />,short: 'Checklist', description: 'Serenity research checklist per stock — track your validation steps — Part V' },
};
export function ScoreGauge({ score }: { score: number }) {
  const c = scoreColor(score);
  const [showFormula, setShowFormula] = React.useState(false);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ width: '38px', height: '38px', position: 'relative', cursor: 'pointer' }}
           onClick={e => { e.stopPropagation(); setShowFormula(v => !v); }}
           title="Click to see scoring formula">
        <svg viewBox="0 0 38 38" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
          <circle cx="19" cy="19" r="15" fill="none" stroke="#1A2840" strokeWidth="3.5" />
          <circle cx="19" cy="19" r="15" fill="none" stroke={c} strokeWidth="3.5"
            strokeDasharray={`${(score / 100) * 94.2} 94.2`} strokeLinecap="round" />
        </svg>
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800', color: c }}>{score}</span>
      </div>
      {showFormula && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '44px', left: 0, zIndex: 100,
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '10px',
          padding: '14px 16px', width: '300px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--mc-text-0)', letterSpacing: '0.5px' }}>HOW THE SERENITY SCORE WORKS</span>
            <button onClick={() => setShowFormula(false)} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
          </div>
          {SCORE_FORMULA_LINES.map(({ label, detail }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '4px 0', borderBottom: '1px solid var(--mc-bg-4)' }}>
              <span style={{ fontSize: '10px', color: 'var(--mc-text-3)', flexShrink: 0, minWidth: '120px' }}>{label}</span>
              <span style={{ fontSize: '10px', color: 'var(--mc-text-2)', textAlign: 'right' }}>{detail}</span>
            </div>
          ))}
          <p style={{ fontSize: '9px', color: 'var(--mc-text-4)', marginTop: '8px' }}>Score = sum of all bonuses − failed check penalties, capped at 100. Click score ring again to dismiss.</p>
        </div>
      )}
    </div>
  );
}
export function EmergingThemes({ articles }: { articles: NewsArticle[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const themes = useMemo(() => detectEmergingThemes(articles), [articles]);

  // Promotion workflow: track how many sessions each new theme has appeared
  // When a theme appears in 3+ sessions → show "Promote to framework" button
  const [themeSeen, setThemeSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(PROMOTED_THEMES_KEY) || '{}'); } catch { return {}; }
  });
  const [promotedMsg, setPromotedMsg] = useState<string | null>(null);

  // On mount/new articles: increment seen count for new themes with articles this week
  useEffect(() => {
    const newActive = themes.filter(t => t.isNew && t.weekCount > 0);
    if (newActive.length === 0) return;
    setThemeSeen(prev => {
      const updated = { ...prev };
      for (const t of newActive) { updated[t.id] = (updated[t.id] || 0) + 1; }
      try { localStorage.setItem(PROMOTED_THEMES_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes.length]);

  if (themes.length === 0) return null;
  const newThemes = themes.filter(t => t.isNew);
  const coveredThemes = themes.filter(t => !t.isNew);

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '1px', color: 'var(--mc-text-4)' }}>🔍 LIVE THEME DETECTION</span>
        {newThemes.length > 0 && <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--mc-warn)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', padding: '1px 7px', borderRadius: '3px' }}>{newThemes.length} NEW themes not in framework</span>}
        <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>auto-detected from live news · not hardcoded</span>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {themes.map(t => {
          const isExp = expanded === t.id;
          return (
            <div key={t.id} style={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${t.isNew ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : t.color + '30'}` }}>
              <button
                onClick={() => setExpanded(isExp ? null : t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px',
                  background: isExp ? t.color + '18' : t.isNew ? 'color-mix(in srgb, var(--mc-warn) 3%, transparent)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '14px' }}>{t.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: t.isNew ? 'var(--mc-warn)' : 'var(--mc-text-2)' }}>{t.label}</span>
                    {t.isNew && <span style={{ fontSize: '8px', fontWeight: '800', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', padding: '0 4px', borderRadius: '3px' }}>NEW</span>}
                    {!t.isNew && <span style={{ fontSize: '8px', color: 'var(--mc-text-4)', border: '1px solid color-mix(in srgb, var(--mc-bg-4) 19%, transparent)', padding: '0 4px', borderRadius: '3px' }}>IN FRAMEWORK</span>}
                    {t.weekCount >= 3 && <span style={{ fontSize: '9px', color: 'var(--mc-bearish)' }}>🔥</span>}
                    {/* Promotion badge: appears when seen 3+ sessions */}
                    {t.isNew && (themeSeen[t.id] ?? 0) >= 3 && (
                      <span style={{ fontSize: '8px', fontWeight: '800', color: 'var(--mc-state-persistent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', padding: '0 4px', borderRadius: '3px', cursor: 'help' }}
                        title={`Seen ${themeSeen[t.id]} sessions — candidate for formal taxonomy`}>
                        🚀 PROMOTE
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '9px', color: 'var(--mc-text-4)' }}>{t.count} articles · {t.weekCount} this week</span>
                </div>
              </button>
              {isExp && (
                <div style={{ padding: '8px 12px', backgroundColor: '#060E1A', borderTop: `1px solid ${t.color}20` }}>
                  {t.headlines.map((h, i) => (
                    <div key={i} style={{ fontSize: '11px', color: 'var(--mc-text-3)', padding: '3px 0', borderBottom: i < t.headlines.length - 1 ? '1px solid var(--mc-bg-4)' : 'none', lineHeight: '1.4' }}>
                      › {h}
                    </div>
                  ))}
                  {t.isNew && (
                    <div style={{ marginTop: '6px', padding: '6px 10px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)', borderRadius: '4px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--mc-warn)', marginBottom: '3px' }}>⭐ Not in framework watchlist — potential new bottleneck class</div>
                      {(themeSeen[t.id] ?? 0) >= 3 ? (
                        <div style={{ fontSize: '10px', color: 'var(--mc-state-persistent)', marginTop: '3px', fontWeight: '700' }}>
                          🚀 Seen {themeSeen[t.id]} sessions — ready for formal taxonomy inclusion
                          {promotedMsg === t.id && <span style={{ marginLeft: '8px', color: 'var(--mc-bullish)' }}>✓ Added to watchlist!</span>}
                        </div>
                      ) : (
                        <div style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>Seen {themeSeen[t.id] ?? 1} session(s) — promote to framework after 3 consistent appearances</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ── Criteria check helper ─────────────────────────────────────────────────────
export function CriteriaCheck({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span title={label} style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '2px', color: pass ? 'var(--mc-bullish)' : 'color-mix(in srgb, var(--mc-bearish) 50%, transparent)', whiteSpace: 'nowrap' }}>
      {pass ? '✅' : '❌'} {label}
    </span>
  );
}
export function GeoOverlay({ articles, isLoading }: { articles: NewsArticle[]; isLoading: boolean }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [mechFilter, setMechFilter] = useState('ALL');
  if (isLoading) return <SkeletonGrid count={6} height={80} />;

  // All articles already geo-filtered upstream (useGeoNews applies keyword filter).
  // Detect mechanism from content — article_type is now secondary.
  const withMechanism = articles
    .map(a => ({ ...a, mechanism: detectMechanism(a) }))
    .filter(a => a.mechanism !== null || ['GEOPOLITICAL','TARIFF'].includes(a.article_type ?? ''));

  // Filter: MECHANISM-first (not article_type), since geo keywords span all article types
  const filtered = withMechanism.filter(a =>
    (typeFilter === 'ALL' || (typeFilter === 'GEOPOLITICAL' && ['EXPORT_BAN','MILITARY'].includes(a.mechanism?.key ?? '')) ||
     (typeFilter === 'TARIFF' && a.mechanism?.key === 'TARIFF') ||
     (typeFilter === 'MACRO' && !a.mechanism && a.article_type === 'MACRO')) &&
    (mechFilter === 'ALL' || a.mechanism?.key === mechFilter)
  );
  const typeColor = (t: string) => ({ GEOPOLITICAL: '#EF4444', TARIFF: '#F59E0B', MACRO: '#8B5CF6' })[t] ?? '#4A5B6C';
  // Counts by mechanism bucket
  const geopoliticalCount = withMechanism.filter(a => ['EXPORT_BAN','MILITARY'].includes(a.mechanism?.key ?? '')).length;
  const tariffCount = withMechanism.filter(a => a.mechanism?.key === 'TARIFF').length;

  // Count mechanisms in current view
  const mechCounts = Object.fromEntries(
    Object.keys(GEO_MECHANISMS).map(k => [k, withMechanism.filter(a => a.mechanism?.key === k).length])
  );

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 16%, transparent)', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: 'var(--mc-bearish)', fontWeight: '700', margin: '0 0 4px' }}>⚠️ Geopolitical Accelerant — Model 29</p>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: 0, lineHeight: '1.5' }}>
          Geopolitical disruption = accelerant to upstream supply chain bottleneck positions. When supply chains become more fragile globally, chokepoint companies become MORE valuable.
        </p>
      </div>

      {/* Type filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {[
          {k:'ALL', label:'ALL', cnt: withMechanism.length},
          {k:'GEOPOLITICAL', label:'GEOPOLITICAL', cnt: geopoliticalCount},
          {k:'TARIFF', label:'TARIFF', cnt: tariffCount},
          {k:'MACRO', label:'MACRO', cnt: withMechanism.filter(a => !a.mechanism && a.article_type === 'MACRO').length},
        ].map(({k, label, cnt}) => (
          <button key={k} onClick={() => setTypeFilter(k)} style={{ padding: '5px 12px', borderRadius: '7px', border: `1px solid ${typeFilter === k ? typeColor(k) + '60' : 'var(--mc-bg-4)'}`, cursor: 'pointer', backgroundColor: typeFilter === k ? typeColor(k) + '14' : 'transparent', color: typeFilter === k ? typeColor(k) : 'var(--mc-text-4)', fontSize: '11px', fontWeight: '600' }}>
            {label} ({cnt})
          </button>
        ))}
        <span style={{ fontSize: '11px', color: 'var(--mc-text-4)', marginLeft: 'auto', alignSelf: 'center' }}>Live · every 90s</span>
      </div>

      {/* Mechanism filter — auto-classified from article text */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', alignSelf: 'center', letterSpacing: '0.5px' }}>MECHANISM:</span>
        <button onClick={() => setMechFilter('ALL')} style={{ padding: '3px 10px', borderRadius: '6px', border: `1px solid ${mechFilter === 'ALL' ? 'color-mix(in srgb, var(--mc-accent) 38%, transparent)' : 'var(--mc-bg-4)'}`, cursor: 'pointer', backgroundColor: mechFilter === 'ALL' ? 'color-mix(in srgb, var(--mc-accent) 8%, transparent)' : 'transparent', color: mechFilter === 'ALL' ? 'var(--mc-accent)' : 'var(--mc-text-4)', fontSize: '10px', fontWeight: '600' }}>ALL</button>
        {Object.entries(GEO_MECHANISMS).filter(([k]) => (mechCounts[k] ?? 0) > 0).map(([k, m]) => (
          <button key={k} onClick={() => setMechFilter(k === mechFilter ? 'ALL' : k)} style={{ padding: '3px 10px', borderRadius: '6px', border: `1px solid ${mechFilter === k ? m.color + '60' : 'var(--mc-bg-4)'}`, cursor: 'pointer', backgroundColor: mechFilter === k ? m.color + '14' : 'transparent', color: mechFilter === k ? m.color : 'var(--mc-text-4)', fontSize: '10px', fontWeight: '600' }}>
            {m.icon} {m.label} ({mechCounts[k]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? <EmptyState msg="No geopolitical articles for this filter." /> : filtered.map((a, i) => {
        const url = cleanUrl(a.url || a.source_url || '#');
        const tc = typeColor(a.article_type);
        const tickers = getTickerSymbols(a);
        const sentiment = a.sentiment?.toUpperCase();
        const sentColor = sentiment === 'BULLISH' ? '#10B981' : sentiment === 'BEARISH' ? '#EF4444' : '#6B7A8D';
        const mech = a.mechanism;
        return (
          <div key={a.id || i} style={{ marginBottom: '8px', padding: '12px 14px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '10px', borderLeft: `3px solid ${mech ? mech.color : tc}` }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: tc, backgroundColor: tc + '18', padding: '2px 7px', borderRadius: '3px', flexShrink: 0 }}>{a.article_type}</span>
              {mech && (
                <span style={{ fontSize: '9px', fontWeight: '700', color: mech.color, backgroundColor: mech.color + '18', border: `1px solid ${mech.color}40`, padding: '2px 7px', borderRadius: '3px' }}>
                  {mech.icon} {mech.label}
                </span>
              )}
              {sentiment && sentiment !== 'NEUTRAL' && <span style={{ fontSize: '9px', color: sentColor, fontWeight: '700', marginLeft: 'auto' }}>{sentiment === 'BULLISH' ? '↑' : '↓'} {sentiment}</span>}
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: '13px', color: 'var(--mc-text-2)', margin: '0 0 6px', lineHeight: '1.4', fontWeight: '500' }}>{a.title || a.headline}</p>
            </a>
            {a.summary && <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: '0 0 8px', lineHeight: '1.5' }}>{a.summary}</p>}
            {mech && mech.layers.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '9px', color: 'var(--mc-text-4)', fontWeight: '600' }}>CHAIN IMPACT →</span>
                {mech.layers.map(l => {
                  const ti = TIER_MAP[l];
                  return ti ? <span key={l} style={{ fontSize: '9px', color: ti.color, backgroundColor: ti.color + '14', border: `1px solid ${ti.color}30`, padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>T{ti.tier} {l.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).split(' ').slice(0,2).join(' ')}</span> : null;
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{a.source_name} · {timeAgo(a.published_at)}</span>
              {tickers.slice(0, 4).map(t => <span key={t} style={{ fontSize: '10px', color: 'var(--mc-accent)', fontWeight: '600', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', padding: '1px 5px', borderRadius: '3px' }}>${t}</span>)}
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: 'var(--mc-text-4)' }}><ExternalLink className="w-3 h-3" /></a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function ConferenceCalendar() {
  const now = new Date();
  const { data: confSignals = {} } = useConferenceSignals();
  const { data: earningsArticles = [] } = useEarningsSignals();

  const getStatus = (dateStr: string): 'upcoming' | 'past' | 'soon' => {
    const parts = dateStr.split(' ');
    if (parts.length < 2) return 'upcoming';
    const monthMap: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const m = monthMap[parts[0]] ?? 0;
    const y = parseInt(parts[1]);
    const confDate = new Date(y, m, 15);
    const diffDays = (confDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return 'past';
    if (diffDays <= 42) return 'soon';
    return 'upcoming';
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 16%, transparent)', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: 'var(--mc-accent)', fontWeight: '700', margin: '0 0 3px' }}>📅 Frontrun Conferences — Model 22</p>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: 0 }}>Position 4–6 weeks BEFORE each conference. A single Jensen Huang slide on CPO sends photonics names up 20–50% in a day. The day after is too late.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {CONFERENCES.map((conf) => {
          const status = getStatus(conf.date);
          const liveSignals = confSignals[conf.name] ?? 0;
          const isHot = liveSignals >= 3; // 3+ articles = conference generating buzz
          const statusStyle = {
            upcoming: { bg: '#0F7ABF14', border: '#0F7ABF30', badge: '#0F7ABF', label: 'UPCOMING' },
            soon:     { bg: '#F59E0B14', border: '#F59E0B30', badge: '#F59E0B', label: '⚡ ENTER NOW' },
            past:     { bg: '#4A5B6C14', border: '#1A2840',   badge: '#4A5B6C', label: 'PAST' },
          }[status];
          return (
            <div key={conf.name} style={{ padding: '16px', border: `1px solid ${isHot ? 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' : statusStyle.border}`, borderRadius: '12px', backgroundColor: statusStyle.bg, boxShadow: isHot ? '0 0 12px color-mix(in srgb, var(--mc-bearish) 8%, transparent)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--mc-text-0)' }}>{conf.name}</span>
                    <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', color: statusStyle.badge, backgroundColor: statusStyle.badge + '20', padding: '2px 6px', borderRadius: '3px' }}>{statusStyle.label}</span>
                    {liveSignals > 0 && (
                      <span style={{ fontSize: '9px', fontWeight: '700', color: isHot ? 'var(--mc-bearish)' : 'var(--mc-bullish)', backgroundColor: isHot ? 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: `1px solid ${isHot ? 'color-mix(in srgb, var(--mc-bearish) 19%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)'}`, padding: '2px 6px', borderRadius: '3px' }}>
                        {isHot ? '🔥' : '📡'} {liveSignals} live article{liveSignals !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--mc-text-3)', fontWeight: '600' }}>{conf.date}</span>
                </div>
                {conf.url && status !== 'past' && (
                  <a href={conf.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-text-4)', flexShrink: 0 }}><ExternalLink className="w-3.5 h-3.5" /></a>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', fontWeight: '600', margin: '0 0 6px' }}>{conf.theme}</p>
              <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: '0 0 10px', lineHeight: '1.5' }}>{conf.relevance}</p>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {conf.tags.map(t => <span key={t} style={{ fontSize: '9px', fontWeight: '700', color: TAG_COLORS[t] ?? 'var(--mc-text-4)', border: `1px solid ${(TAG_COLORS[t] ?? 'var(--mc-text-4)') + '40'}`, padding: '1px 6px', borderRadius: '3px' }}>{t}</span>)}
              </div>
              {status === 'soon' && (
                <div style={{ marginTop: '10px', padding: '8px 10px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 16%, transparent)', borderRadius: '6px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--mc-warn)', fontWeight: '600', margin: 0 }}>🎯 Entry window open — build positions now</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Earnings Catalyst Engine ── */}
      <div style={{ marginTop: '28px' }}>
        <div style={{ marginBottom: '14px', padding: '10px 16px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 16%, transparent)', borderRadius: '10px' }}>
          <p style={{ fontSize: '12px', color: 'var(--mc-bullish)', fontWeight: '700', margin: '0 0 2px' }}>📊 Earnings Catalyst Engine — Live</p>
          <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: 0 }}>
            Recent earnings news for Serenity universe stocks. These are the qualification→ramp→visible order cycles that confirm or break theses. Auto-fetched from live news.
          </p>
        </div>
        {earningsArticles.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mc-text-4)', fontSize: '12px' }}>No recent earnings articles for universe stocks. Check back after earnings season.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {earningsArticles.slice(0, 15).map((a, i) => {
              const url = cleanUrl(a.url || a.source_url || '#');
              const tickers = (a.ticker_symbols ?? []).filter((t: string) => EARNINGS_WATCH.includes(t.toUpperCase()));
              const text = ((a.title || a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
              // Detect if this is a positive (beat/raised) or negative (miss/cut) signal
              const positive = ['beat','raised','raised guidance','record revenue','exceeded','above estimates','top estimates'].some(kw => text.includes(kw));
              const negative = ['missed','lowered','cut guidance','below estimates','disappointing','warning'].some(kw => text.includes(kw));
              const sentColor = positive ? '#10B981' : negative ? '#EF4444' : '#8A95A3';
              // Detect Serenity-relevant keywords in earnings
              const qualSignal = ['design win','qual','qualification','ramp'].some(kw => text.includes(kw));
              const backlogSignal = ['backlog','lead time','allocation','sold out'].some(kw => text.includes(kw));
              return (
                <div key={a.id || i} style={{ padding: '10px 14px', backgroundColor: 'var(--mc-bg-1)', border: `1px solid ${positive ? 'color-mix(in srgb, var(--mc-bullish) 16%, transparent)' : negative ? 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: '8px', borderLeft: `3px solid ${sentColor}` }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '5px', flexWrap: 'wrap' }}>
                    {tickers.slice(0,3).map((t: string) => <span key={t} style={{ fontSize: '11px', fontWeight: '800', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', padding: '1px 7px', borderRadius: '4px' }}>{t}</span>)}
                    {positive && <span style={{ fontSize: '9px', color: 'var(--mc-bullish)', fontWeight: '700', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>↑ BEAT / RAISED</span>}
                    {negative && <span style={{ fontSize: '9px', color: 'var(--mc-bearish)', fontWeight: '700', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>↓ MISS / CUT</span>}
                    {qualSignal && <span style={{ fontSize: '9px', color: 'var(--mc-state-persistent)', fontWeight: '700', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>🎯 QUAL SIGNAL</span>}
                    {backlogSignal && <span style={{ fontSize: '9px', color: 'var(--mc-warn)', fontWeight: '700', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>⏱️ BACKLOG SIGNAL</span>}
                    <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>{timeAgo(a.published_at)}</span>
                  </div>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                    <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', margin: '0 0 3px', lineHeight: '1.4', fontWeight: '500' }}>{a.title || a.headline}</p>
                  </a>
                  <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{a.source_name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
export function SupplyChainMap({ dashboard, articles }: { dashboard?: BnDashboard; articles: NewsArticle[] }) {
  const activeBuckets = new Set(dashboard?.buckets?.filter(b => b.severity >= 3).map(b => b.bucket_id) ?? []);
  const activeSevMap = Object.fromEntries(dashboard?.buckets?.map(b => [b.bucket_id, b.severity]) ?? []);

  // Live evidence counts per sub_tag from news
  const evidencePerTag = useMemo(() => {
    const counts: Record<string, { count: number; lastSignal?: string }> = {};
    for (const a of articles) {
      const tag = a.bottleneck_sub_tag;
      if (!tag) continue;
      if (!counts[tag]) counts[tag] = { count: 0 };
      counts[tag].count++;
      if (!counts[tag].lastSignal || a.published_at > counts[tag].lastSignal!) counts[tag].lastSignal = a.published_at;
    }
    return counts;
  }, [articles]);

  // Bottleneck probability: 0–100% derived from severity + evidence
  function bottleneckProb(subTag: string): number {
    const sev = activeSevMap[subTag] ?? 0;
    const ev = evidencePerTag[subTag]?.count ?? 0;
    return Math.min(100, Math.round(sev * 20 + Math.min(40, ev * 4)));
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 16%, transparent)', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: 'var(--mc-state-persistent)', fontWeight: '700', margin: '0 0 3px' }}>🗺️ AI Infrastructure Value Chain — Models 01, 05, 18</p>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: 0 }}>The further upstream from the hyped name, the less investor competition. Monopolistic positioning increases as you go further upstream. Active bottlenecks highlighted.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {SUPPLY_CHAIN.map((tier, i) => {
          const tagForTier = TIER_TO_BUCKET[tier.tier];
          const isActive = tagForTier ? activeBuckets.has(tagForTier) : false;
          const evData = tagForTier ? evidencePerTag[tagForTier] : null;
          const prob = tagForTier ? bottleneckProb(tagForTier) : 0;
          const vel = tagForTier ? calcBucketVelocity(articles, tagForTier) : null;
          // For T9/T10 that share a bucket with earlier tiers, show a note
          const isSharedBucket = tier.tier > 6 && tagForTier && (tier.tier === 9 || tier.tier === 7 || tier.tier === 8);
          const arrow = i < SUPPLY_CHAIN.length - 1;

          return (
            <div key={tier.tier}>
              <div style={{
                padding: '14px 18px', borderRadius: '10px',
                backgroundColor: isActive ? tier.color + '12' : 'var(--mc-bg-1)',
                border: `1px solid ${isActive ? tier.color + '60' : vel?.trend === '🔥' ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : 'var(--mc-bg-4)'}`,
                boxShadow: isActive ? `0 0 14px ${tier.color}18` : 'none',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: '14px',
              }}>
                <div style={{ width: '46px', flexShrink: 0, textAlign: 'center' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: tier.color + '20', border: `1px solid ${tier.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: tier.color }}>T{tier.tier}</span>
                  </div>
                  {prob > 0 && (
                    <div title={`Bottleneck probability: ${prob}%`} style={{ fontSize: '9px', color: prob >= 60 ? 'var(--mc-bearish)' : prob >= 30 ? 'var(--mc-warn)' : 'var(--mc-text-4)', fontWeight: '700' }}>{prob}%</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{tier.label}</span>
                    {isActive && (
                      <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--mc-bearish)', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', padding: '2px 7px', borderRadius: '3px', letterSpacing: '0.8px' }}>
                        ⚡ ACTIVE BOTTLENECK{isSharedBucket ? ' (shared)' : ''}
                      </span>
                    )}
                    {vel?.trend === '🔥' && !isActive && <span style={{ fontSize: '9px', color: 'var(--mc-warn)', fontWeight: '700' }}>🔥 Rising</span>}
                    {evData && evData.count > 0 && <span style={{ fontSize: '9px', color: 'var(--mc-bullish)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', padding: '1px 5px', borderRadius: '3px' }}>📡 {evData.count} live</span>}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: '0 0 4px' }}>{tier.sub}</p>
                  {tier.lens && (
                    <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '0 0 6px', fontStyle: 'italic' }}>{tier.lens}</p>
                  )}
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {tier.companies.map(c => (
                      <span key={c} style={{ fontSize: '10px', fontWeight: '600', color: tier.color, backgroundColor: tier.color + '14', border: `1px solid ${tier.color}30`, padding: '1px 7px', borderRadius: '4px' }}>{c}</span>
                    ))}
                    {evData?.lastSignal && <span style={{ fontSize: '9px', color: 'var(--mc-text-4)', marginLeft: '4px' }}>· last {timeAgo(evData.lastSignal)}</span>}
                  </div>
                </div>
                {/* Probability bar — flex-end fills from bottom, no position:absolute needed */}
                {prob > 0 && (
                  <div title={`Bottleneck probability ${prob}%`} style={{ width: '6px', height: '60px', backgroundColor: 'var(--mc-bg-4)', borderRadius: '3px', flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', height: `${prob}%`, backgroundColor: prob >= 60 ? 'var(--mc-bearish)' : prob >= 30 ? 'var(--mc-warn)' : 'var(--mc-accent)', borderRadius: '3px', transition: 'height 0.3s' }} />
                  </div>
                )}
              </div>
              {arrow && <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0', color: 'var(--mc-bg-4)', fontSize: '16px' }}>↓</div>}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '20px', padding: '14px 16px', backgroundColor: '#060E1A', border: '1px solid var(--mc-bg-4)', borderRadius: '10px' }}>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 8px' }}>SERENITY'S DEMAND CHAIN (Model 18)</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--mc-text-3)' }}>
          {['Raw InP/GaAs crystal', 'Substrate wafer', 'Laser chip', 'CPO module', 'NVL72 rack', 'AI factory', 'Hyperscaler capex'].map((s, i, arr) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--mc-text-2)' }}>{s}</span>
              {i < arr.length - 1 && <span style={{ color: 'var(--mc-accent)' }}>→</span>}
            </span>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: '8px 0 0' }}>Translate every hyperscaler capex announcement into units → transceivers → lasers → substrate revenue. That $850M Swedish laser company IS the demand chain end-point.</p>
      </div>
    </div>
  );
}
// ── Shared micro-components ───────────────────────────────────────────────────

export function SkeletonGrid({ count, height }: { count: number; height: number }) {
  return (
    <div style={{ padding: '20px' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.7}}`}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ height, backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '10px', marginBottom: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}
export function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--mc-text-4)' }}>
      <AlertCircle className="w-10 h-10" style={{ margin: '0 auto 12px', color: 'var(--mc-bg-4)' }} />
      <p style={{ fontSize: '13px' }}>{msg}</p>
    </div>
  );
}
export function Tag({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: '9px', color, border: `1px solid ${color}30`, padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>{label}</span>;
}
