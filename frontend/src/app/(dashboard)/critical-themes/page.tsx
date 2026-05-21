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
import { USA_THEMES, INDIA_THEMES, type CriticalTheme, type ThemeRegion } from '@/lib/critical-themes';

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
        <span style={{ fontSize: 9, color: DIM, background: '#1A2540', padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: '0.3px' }}>
          editorial #{t.priorityRank}
        </span>
        {signal && (
          <>
            <span title="News articles in last 30 days matching theme keywords"
                  style={{ fontSize: 9, color: '#22D3EE', background: '#22D3EE15', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
              📰 {signal.newsHeat} news
            </span>
            <span title="Avg leader-stock change last 7 days" style={{
              fontSize: 9, color: signal.leaderMomentum >= 0 ? '#10B981' : '#EF4444',
              background: (signal.leaderMomentum >= 0 ? '#10B981' : '#EF4444') + '15',
              padding: '2px 6px', borderRadius: 3, fontWeight: 700,
            }}>
              📈 {signal.leaderMomentum >= 0 ? '+' : ''}{signal.leaderMomentum.toFixed(1)}%
            </span>
            {signal.bottleneckBoost > 0 && (
              <span style={{ fontSize: 9, color: '#F59E0B', background: '#F59E0B15', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
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
        <span style={{ color: '#10B981' }}>{t.bullCase}</span>

        {signal?.topArticleTitle && (
          <>
            <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>NEWS</span>
            <span style={{ color: '#22D3EE', fontSize: 12, fontStyle: 'italic' }} title={signal.topArticleTitle}>
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

  const allThemes = useMemo(() => [...INDIA_THEMES, ...USA_THEMES], []);

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
      const qRes = await safeJson<any>(`/api/market/quotes?market=india&_=${Date.now()}`, 18_000);
      if (cancelled) return;
      const indiaQuotes: any[] = qRes?.stocks || [];
      const quotesByTicker = new Map<string, any>();
      for (const s of indiaQuotes) {
        const k = (s.ticker || '').toUpperCase();
        if (k) quotesByTicker.set(k, s);
      }

      // 3. Bottleneck dashboard
      const bnRes = await safeJson<any>(`/api/v1/news/bottleneck-dashboard?_=${Date.now()}`, 18_000);
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

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🔥 Critical Themes</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
              Choke-point themes for the next 10+ years — editorially curated, <b style={{ color: '#22D3EE' }}>dynamically ranked</b> using live news heat + leader momentum + bottleneck overlay.
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
                background: view === v ? (v === 'US' ? '#F87171' : v === 'IN' ? '#22D3EE' : '#A78BFA') : 'transparent',
                border: `1px solid ${view === v ? (v === 'US' ? '#F87171' : v === 'IN' ? '#22D3EE' : '#A78BFA') : '#1E2D45'}`,
                color: view === v ? '#0A0E1A' : TEXT,
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

        <div style={{
          marginTop: 8, padding: '14px 16px',
          fontSize: 11, color: DIM,
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6,
          lineHeight: 1.65,
        }}>
          <b style={{ color: TEXT }}>How dynamic ranking works:</b> each theme starts with an editorial prior (priorityRank in <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 3 }}>lib/critical-themes.ts</code>) and gets re-scored every load using:
          <ul style={{ margin: '6px 0 0 22px', padding: 0 }}>
            <li><b>News heat</b> — count of last-30d articles matching the theme&apos;s <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 3 }}>searchKeywords</code> (max 30 pts)</li>
            <li><b>Leader momentum</b> — avg weekly % change of the theme&apos;s leader stocks from /api/market/quotes (max 30 pts, India only)</li>
            <li><b>Bottleneck overlay</b> — +15 if any HIGH-severity bottleneck bucket overlaps the theme keywords</li>
            <li><b>Editorial prior</b> — base 25 pts for priorityRank #1, falling 2.5 pts per rank</li>
          </ul>
          Themes auto-resort on every page load — top of the list = strongest signal RIGHT NOW. Themes themselves stay editorial (human judgment); ranking and news context update live. To add or edit a theme: append to <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 3 }}>lib/critical-themes.ts</code> — the page picks it up automatically.
        </div>
      </div>
    </div>
  );
}
