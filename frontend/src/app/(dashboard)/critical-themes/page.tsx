'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL THEMES (PATCH 0627 + 0630)
//
// Institutional view of high-conviction structural themes for the next 10+
// years. Themes themselves are EDITORIALLY CURATED in
// /lib/critical-themes.ts (judgment, not auto-discovered). But rankings,
// news-heat, and leader-momentum are DYNAMIC — they refresh from live data
// every time the page loads.
//
// Dynamic ranking formula per theme:
//   themeScore = editorialPrior  // base from priorityRank (0-100)
//              + newsHeat        // count of last-30d articles matching searchKeywords
//              + leaderMomentum  // avg week-of-week change of leader stocks
//              + bottleneckOverlay // amplifier if any bottleneck bucket overlaps
//
// Themes re-sort live. Top of the list = strongest signal RIGHT NOW.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  USA_THEMES, INDIA_THEMES, type CriticalTheme, type ThemeRegion,
  loadCustomThemes, saveCustomTheme, deleteCustomTheme, getAllThemesForRegion,
  findEmergingThemes, type EmergingTheme,
} from '@/lib/critical-themes';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

type ViewMode = 'BOTH' | 'IN' | 'US';

interface LiveSignal {
  newsHeat: number;       // raw article count (last 30d)
  newsHeatScore: number;  // normalized 0-30
  leaderMomentum: number; // avg weekly change %
  momentumScore: number;  // 0-30 scaled
  bottleneckBoost: number;// 0-15
  totalScore: number;     // priorityPrior (0-25) + newsHeatScore + momentumScore + bottleneckBoost
  topArticleTitle?: string;
}

async function safeJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

function ThemeBlock({ t, signal, dynamicRank }: { t: CriticalTheme; signal?: LiveSignal; dynamicRank: number }) {
  const accent = t.region === 'US' ? '#F87171' : '#22D3EE';
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 8,
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: TEXT }}>
          🔥 {t.name} <span style={{ marginLeft: 4 }}>{t.emoji}</span>
        </h2>
        <span style={{ fontSize: 10, color: accent, background: `${accent}22`, padding: '2px 8px', borderRadius: 3, fontWeight: 800, letterSpacing: '0.5px' }}>
          RANK #{dynamicRank}
        </span>
        <span style={{ fontSize: 9, color: DIM, background: 'var(--mc-bg-4)', padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: '0.3px' }}>
          editorial #{t.priorityRank}
        </span>
        {signal && (
          <>
            <span title="News articles in last 30 days matching theme keywords"
                  style={{ fontSize: 9, color: 'var(--mc-cyan)', background: '#22D3EE15', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
              📰 {signal.newsHeat} news
            </span>
            <span title="Avg leader-stock change last 7 days" style={{
              fontSize: 9, color: signal.leaderMomentum >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
              background: (signal.leaderMomentum >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)') + '15',
              padding: '2px 6px', borderRadius: 3, fontWeight: 700,
            }}>
              📈 {signal.leaderMomentum >= 0 ? '+' : ''}{signal.leaderMomentum.toFixed(1)}%
            </span>
            {signal.bottleneckBoost > 0 && (
              <span style={{ fontSize: 9, color: 'var(--mc-warn)', background: '#F59E0B15', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
                ⚠ bottleneck active
              </span>
            )}
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
              score {Math.round(signal.totalScore)}
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13, lineHeight: 1.65, marginTop: 6 }}>
        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>WHY</span>
        <span style={{ color: TEXT }}>{t.why}</span>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>LEADERS</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {t.leaders.map((l) => (
            <Link key={l.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(l.ticker)}${t.region === 'US' ? '&market=us' : ''}`}
              style={{
                fontSize: 12, padding: '4px 10px',
                background: `${accent}15`, border: `1px solid ${accent}50`,
                color: accent, textDecoration: 'none', borderRadius: 4, fontWeight: 700,
              }}
              title={l.note || ''}
            >
              {l.ticker} · {l.name}
              {l.exchange && <span style={{ marginLeft: 4, fontSize: 9, color: DIM, fontWeight: 600 }}>({l.exchange})</span>}
            </Link>
          ))}
        </div>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BEAR</span>
        <span style={{ color: '#FCA5A5' }}>{t.bearCase}</span>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BULL</span>
        <span style={{ color: 'var(--mc-bullish)' }}>{t.bullCase}</span>

        {signal?.topArticleTitle && (
          <>
            <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>NEWS</span>
            <span style={{ color: 'var(--mc-cyan)', fontSize: 12, fontStyle: 'italic' }} title={signal.topArticleTitle}>
              {signal.topArticleTitle.slice(0, 140)}{signal.topArticleTitle.length > 140 ? '…' : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function PlaybookCallout({ region, themes }: { region: ThemeRegion; themes: CriticalTheme[] }) {
  const top = themes.slice(0, 5);
  const accent = region === 'US' ? '#F87171' : '#22D3EE';
  return (
    <div style={{
      background: `linear-gradient(180deg, ${accent}12 0%, transparent 100%)`,
      border: `1px solid ${accent}40`,
      borderRadius: 8,
      padding: '18px 20px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: accent, letterSpacing: '0.5px', marginBottom: 10 }}>
        🎯 INVESTOR PLAYBOOK — {region === 'US' ? 'USA' : 'INDIA'}
      </div>
      <ol style={{ margin: '0 0 12px 22px', fontSize: 13, color: TEXT, lineHeight: 1.7 }}>
        {top.map((t, i) => (
          <li key={t.id}><b>{t.emoji} {t.name}</b> — {t.bullCase}</li>
        ))}
      </ol>
      <div style={{ fontSize: 11.5, color: DIM, lineHeight: 1.6, fontStyle: 'italic' }}>
        <b style={{ color: TEXT }}>Accumulation strategy:</b> assume 2-3 year bear ahead. Build positions in tranches at -30%, -50%, -70% drawdowns. Cap individual theme exposure at 25% of book. Filter any name with audit issues, family disputes, or weak governance.
      </div>
    </div>
  );
}

export default function CriticalThemesPage() {
  const [view, setView] = useState<ViewMode>('BOTH');
  const [signals, setSignals] = useState<Record<string, LiveSignal>>({});
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // PATCH 0631 — pull static + user-added custom themes. Re-fetch on storage events.
  const [customTick, setCustomTick] = useState(0);
  useEffect(() => {
    const onChange = () => setCustomTick(t => t + 1);
    window.addEventListener('mc:custom-themes-updated', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('mc:custom-themes-updated', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  const allThemes = useMemo(() => [
    ...getAllThemesForRegion('IN'),
    ...getAllThemesForRegion('US'),
  ], [customTick]);
  const [emerging, setEmerging] = useState<EmergingTheme[]>([]);

  // ── DYNAMIC RANK COMPUTATION ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const compute = async () => {
      // 1. One news fetch with broad query — we'll match per-theme client-side
      const newsRes = await safeJson<any>(`/api/v1/news?limit=500&_=${Date.now()}`, 20_000);
      if (cancelled) return;
      const articles: any[] = Array.isArray(newsRes) ? newsRes : (newsRes?.articles || []);

      // 2. Quotes for India leaders (one shot)
      // PATCH 1057: bumped 18s → 25s + 1 retry on failure (leader-momentum blanks were 18s timeouts)
      let qRes = await safeJson<any>(`/api/market/quotes?market=india&_=${Date.now()}`, 25_000);
      if (!qRes) qRes = await safeJson<any>(`/api/market/quotes?market=india&_=${Date.now()}`, 25_000);
      if (cancelled) return;
      const indiaQuotes: any[] = qRes?.stocks || [];
      const quotesByTicker = new Map<string, any>();
      for (const s of indiaQuotes) {
        const k = (s.ticker || '').toUpperCase();
        if (k) quotesByTicker.set(k, s);
      }

      // 3. Bottleneck dashboard
      const bnRes = await safeJson<any>(`/api/v1/news/bottleneck-dashboard?_=${Date.now()}`, 22_000);  // PATCH 1057: bumped 18s → 22s
      if (cancelled) return;
      const bottleneckBuckets: any[] = bnRes?.buckets || [];
      const activeThemeKeywords = bottleneckBuckets
        .filter((b) => (b.severity_label || '').toLowerCase() === 'high')
        .flatMap((b) => [b.theme || '', b.label || ''])
        .join(' ').toLowerCase();

      // 4. Per-theme scoring
      const out: Record<string, LiveSignal> = {};
      const THIRTY_D_MS = 30 * 24 * 3600_000;
      const now = Date.now();

      for (const t of allThemes) {
        // News heat
        let heat = 0;
        let topArticle: any = null;
        for (const a of articles) {
          if (a.is_synthetic) continue;
          if (a?.published_at) {
            const age = now - new Date(a.published_at).getTime();
            if (age > THIRTY_D_MS) continue;
          }
          const haystack = ((a.title || '') + ' ' + (a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
          const hit = t.searchKeywords.some(kw => haystack.includes(kw.toLowerCase()));
          if (hit) {
            heat++;
            if (!topArticle || (a.importance_score ?? 0) > (topArticle.importance_score ?? 0)) topArticle = a;
          }
        }
        const newsHeatScore = Math.min(30, heat * 1.5);

        // Leader momentum (India only — we don't have US quotes here)
        let leaderMomentum = 0;
        if (t.region === 'IN') {
          const leaderPcts: number[] = [];
          for (const l of t.leaders) {
            const q = quotesByTicker.get(l.ticker.toUpperCase());
            if (q && typeof q.changePercent === 'number') leaderPcts.push(q.changePercent);
          }
          if (leaderPcts.length > 0) {
            leaderMomentum = leaderPcts.reduce((a, b) => a + b, 0) / leaderPcts.length;
          }
        }
        const momentumScore = Math.max(0, Math.min(30, (leaderMomentum + 5) * 3));

        // Bottleneck overlay
        const bnHit = t.searchKeywords.some(kw => activeThemeKeywords.includes(kw.toLowerCase()));
        const bottleneckBoost = bnHit ? 15 : 0;

        // Editorial prior (priorityRank 1 → 25, 8 → ~5)
        const prior = Math.max(0, 25 - (t.priorityRank - 1) * 2.5);

        out[t.id] = {
          newsHeat: heat,
          newsHeatScore,
          leaderMomentum,
          momentumScore,
          bottleneckBoost,
          totalScore: prior + newsHeatScore + momentumScore + bottleneckBoost,
          topArticleTitle: topArticle?.title || topArticle?.headline,
        };
      }

      if (cancelled) return;
      setSignals(out);
      setLoading(false);
      setFetchedAt(Date.now());

      // PATCH 0631 — emerging-theme detection (news topics not yet covered)
      const allCuratedKeywords = allThemes.flatMap(t => t.searchKeywords);
      setEmerging(findEmergingThemes(articles, allCuratedKeywords));
    };

    compute();
    return () => { cancelled = true; };
  }, [allThemes]);

  const rankedIN = useMemo(() => {
    const ranked = [...INDIA_THEMES].sort((a, b) => {
      const sa = signals[a.id]?.totalScore ?? (25 - (a.priorityRank - 1) * 2.5);
      const sb = signals[b.id]?.totalScore ?? (25 - (b.priorityRank - 1) * 2.5);
      return sb - sa;
    });
    return ranked;
  }, [signals]);

  const rankedUS = useMemo(() => {
    const ranked = [...USA_THEMES].sort((a, b) => {
      const sa = signals[a.id]?.totalScore ?? (25 - (a.priorityRank - 1) * 2.5);
      const sb = signals[b.id]?.totalScore ?? (25 - (b.priorityRank - 1) * 2.5);
      return sb - sa;
    });
    return ranked;
  }, [signals]);

  const ageMin = fetchedAt ? Math.round((Date.now() - fetchedAt) / 60_000) : null;

  // PATCH 0631 — Custom theme add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftRegion, setDraftRegion] = useState<ThemeRegion>('IN');
  const [draftWhy, setDraftWhy] = useState('');
  const [draftLeaders, setDraftLeaders] = useState('');
  const [draftKeywords, setDraftKeywords] = useState('');
  const [draftBear, setDraftBear] = useState('Liquidity tightening drawdown: -40%');
  const [draftBull, setDraftBull] = useState('Structural tailwind: 3-5×');
  const submitCustomTheme = () => {
    if (!draftName.trim()) return;
    const leaders = draftLeaders.split(',').map(s => s.trim()).filter(Boolean).map(t => ({ ticker: t, name: t }));
    const keywords = draftKeywords.split(',').map(s => s.trim()).filter(Boolean);
    saveCustomTheme({
      region: draftRegion, name: draftName.trim(), emoji: '🆕',
      why: draftWhy.trim() || 'User-added theme.',
      leaders, bearCase: draftBear, bullCase: draftBull,
      priorityRank: 9, searchKeywords: keywords.length > 0 ? keywords : [draftName.trim().split(' ')[0]],
    });
    setShowAddForm(false);
    setDraftName(''); setDraftWhy(''); setDraftLeaders(''); setDraftKeywords('');
  };
  const promoteEmerging = (e: EmergingTheme, region: ThemeRegion) => {
    saveCustomTheme({
      region, name: e.keyword.replace(/\b\w/g, c => c.toUpperCase()), emoji: '✨',
      why: `Auto-detected from news heat (${e.articleCount} articles in last 30 days). User-promoted from emerging-themes suggestion.`,
      leaders: [], bearCase: 'Theme fades / news heat dissipates: -50%',
      bullCase: 'Theme becomes structural: 3-5×',
      priorityRank: 7,
      searchKeywords: [e.keyword],
    });
  };

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🔥 Critical Themes</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
              Choke-point themes for the next 10+ years — editorially curated, <b style={{ color: 'var(--mc-cyan)' }}>dynamically ranked</b> using live news heat + leader momentum + bottleneck overlay.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {fetchedAt && (
              <span style={{ fontSize: 10, color: DIM, marginRight: 6, fontFamily: 'ui-monospace, monospace' }}>
                refreshed {ageMin === 0 ? 'just now' : `${ageMin}m ago`}
              </span>
            )}
            {(['BOTH', 'IN', 'US'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                fontSize: 12,
                padding: '6px 14px',
                background: view === v ? (v === 'US' ? '#F87171' : v === 'IN' ? 'var(--mc-cyan)' : 'var(--mc-state-persistent)') : 'transparent',
                border: `1px solid ${view === v ? (v === 'US' ? '#F87171' : v === 'IN' ? 'var(--mc-cyan)' : 'var(--mc-state-persistent)') : 'var(--mc-border-1)'}`,
                color: view === v ? 'var(--mc-bg-0)' : TEXT,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 800,
                letterSpacing: '0.5px',
              }}>
                {v === 'US' ? '🇺🇸 USA' : v === 'IN' ? '🇮🇳 INDIA' : '🌐 BOTH'}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', padding: '4px 0' }}>
            📡 Scanning news heat + leader momentum + bottleneck overlay across {allThemes.length} themes…
          </div>
        )}

        {/* Side-by-side BOTH view */}
        {view === 'BOTH' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <PlaybookCallout region="IN" themes={rankedIN} />
              {rankedIN.map((t, i) => <ThemeBlock key={t.id} t={t} signal={signals[t.id]} dynamicRank={i + 1} />)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <PlaybookCallout region="US" themes={rankedUS} />
              {rankedUS.map((t, i) => <ThemeBlock key={t.id} t={t} signal={signals[t.id]} dynamicRank={i + 1} />)}
            </div>
          </div>
        )}

        {view === 'IN' && (
          <>
            <PlaybookCallout region="IN" themes={rankedIN} />
            {rankedIN.map((t, i) => <ThemeBlock key={t.id} t={t} signal={signals[t.id]} dynamicRank={i + 1} />)}
          </>
        )}

        {view === 'US' && (
          <>
            <PlaybookCallout region="US" themes={rankedUS} />
            {rankedUS.map((t, i) => <ThemeBlock key={t.id} t={t} signal={signals[t.id]} dynamicRank={i + 1} />)}
          </>
        )}

        {/* PATCH 0631 — EMERGING THEMES (news-derived suggestions) */}
        {emerging.length > 0 && (
          <div style={{
            background: 'linear-gradient(180deg, #F59E0B12 0%, transparent 100%)',
            border: '1px solid #F59E0B40',
            borderRadius: 8, padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>✨ EMERGING THEMES — auto-detected from news</span>
                <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>
                  High-frequency keyword pairs in last-30d news that don&apos;t match any curated theme. Click ✚ to promote to a custom theme.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {emerging.slice(0, 12).map((e) => (
                <div key={e.keyword} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'var(--mc-bg-4)', border: '1px solid #F59E0B30', borderRadius: 4, padding: '4px 8px',
                }}>
                  <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>{e.keyword}</span>
                  <span style={{ fontSize: 9, color: DIM }}>· {e.articleCount} news</span>
                  <button onClick={() => promoteEmerging(e, 'IN')} title="Promote to India theme"
                    style={{ marginLeft: 4, fontSize: 9, padding: '1px 5px', background: '#22D3EE22', border: '1px solid #22D3EE60', color: 'var(--mc-cyan)', borderRadius: 3, cursor: 'pointer', fontWeight: 800 }}>
                    ✚ IN
                  </button>
                  <button onClick={() => promoteEmerging(e, 'US')} title="Promote to USA theme"
                    style={{ fontSize: 9, padding: '1px 5px', background: '#F8717122', border: '1px solid #F8717160', color: '#F87171', borderRadius: 3, cursor: 'pointer', fontWeight: 800 }}>
                    ✚ US
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PATCH 0631 — CUSTOM THEME ADD */}
        <div style={{ background: CARD, border: `1px dashed #22D3EE40`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.5px' }}>➕ ADD YOUR OWN THEME</span>
            <button onClick={() => setShowAddForm(v => !v)} style={{
              fontSize: 11, padding: '5px 12px', background: '#22D3EE15', border: '1px solid #22D3EE50',
              color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 800,
            }}>
              {showAddForm ? 'CANCEL' : 'NEW THEME'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>
            Custom themes you add appear alongside curated ones, get the same live ranking, and persist across reloads. Edit-free updates — no code changes needed.
          </div>
          {showAddForm && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              <label style={{ fontSize: 11, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>
                Region
                <select value={draftRegion} onChange={e => setDraftRegion(e.target.value as ThemeRegion)} style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '6px 8px', borderRadius: 4, fontSize: 12 }}>
                  <option value="IN">🇮🇳 INDIA</option>
                  <option value="US">🇺🇸 USA</option>
                </select>
              </label>
              <label style={{ fontSize: 11, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>
                Theme name
                <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="e.g. Quantum Computing"
                  style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '6px 8px', borderRadius: 4, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3, gridColumn: '1 / -1' }}>
                Why (structural driver)
                <textarea value={draftWhy} onChange={e => setDraftWhy(e.target.value)} placeholder="2-3 lines on macro / policy / tech driver"
                  rows={2} style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '6px 8px', borderRadius: 4, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
              </label>
              <label style={{ fontSize: 11, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>
                Leader tickers (comma-separated)
                <input value={draftLeaders} onChange={e => setDraftLeaders(e.target.value)} placeholder="HAL, BEL, BDL"
                  style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '6px 8px', borderRadius: 4, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>
                Search keywords (drives news heat)
                <input value={draftKeywords} onChange={e => setDraftKeywords(e.target.value)} placeholder="quantum, cryogenic, qubit, IonQ"
                  style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '6px 8px', borderRadius: 4, fontSize: 12 }} />
              </label>
              <button onClick={submitCustomTheme} disabled={!draftName.trim()} style={{
                gridColumn: '1 / -1', marginTop: 4,
                fontSize: 12, padding: '8px 14px', background: 'var(--mc-cyan)', border: 'none',
                color: 'var(--mc-bg-0)', borderRadius: 4, cursor: draftName.trim() ? 'pointer' : 'not-allowed', fontWeight: 800,
                opacity: draftName.trim() ? 1 : 0.5,
              }}>
                ➕ ADD THEME
              </button>
            </div>
          )}
          {/* Custom theme list (with delete) */}
          {loadCustomThemes().length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 6 }}>YOUR CUSTOM THEMES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {loadCustomThemes().map(t => (
                  <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--mc-bg-4)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}>
                    <span style={{ color: TEXT, fontWeight: 600 }}>{t.emoji} {t.name}</span>
                    <span style={{ fontSize: 9, color: DIM }}>· {t.region}</span>
                    <button onClick={() => { deleteCustomTheme(t.id); setCustomTick(x => x + 1); }} title="Delete"
                      style={{ fontSize: 10, padding: '0 4px', background: 'transparent', border: '1px solid #EF444460', color: 'var(--mc-bearish)', borderRadius: 3, cursor: 'pointer', marginLeft: 4 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{
          marginTop: 8, padding: '14px 16px',
          fontSize: 11, color: DIM,
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6,
          lineHeight: 1.65,
        }}>
          <b style={{ color: TEXT }}>How dynamic ranking works:</b> each theme starts with an editorial prior (priorityRank in <code style={{ background: 'var(--mc-bg-4)', padding: '1px 4px', borderRadius: 3 }}>lib/critical-themes.ts</code>) and gets re-scored every load using:
          <ul style={{ margin: '6px 0 0 22px', padding: 0 }}>
            <li><b>News heat</b> — count of last-30d articles matching the theme&apos;s <code style={{ background: 'var(--mc-bg-4)', padding: '1px 4px', borderRadius: 3 }}>searchKeywords</code> (max 30 pts)</li>
            <li><b>Leader momentum</b> — avg weekly % change of the theme&apos;s leader stocks from /api/market/quotes (max 30 pts, India only)</li>
            <li><b>Bottleneck overlay</b> — +15 if any HIGH-severity bottleneck bucket overlaps the theme keywords</li>
            <li><b>Editorial prior</b> — base 25 pts for priorityRank #1, falling 2.5 pts per rank</li>
          </ul>
          Themes auto-resort on every page load — top of the list = strongest signal RIGHT NOW. Themes themselves stay editorial (human judgment); ranking and news context update live. To add or edit a theme: append to <code style={{ background: 'var(--mc-bg-4)', padding: '1px 4px', borderRadius: 3 }}>lib/critical-themes.ts</code> — the page picks it up automatically.
        </div>
      </div>
    </div>
  );
}
