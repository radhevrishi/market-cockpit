'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { SEV_KEYS_ORDER, SEV, LEVEL_STYLES, STRUCTURAL_THEMES, CHANGE_TRACKER_KEY, TIER_MAP } from './constants';
import { JUNK, WEEK_MS, UNIVERSE_DEDUPED, EMERGING_THEME_DETECTORS, THEME_TO_BUCKET, MECHANISM_KEYWORDS, GEO_MECHANISMS, EARNINGS_WATCH, CONF_KEYWORDS } from './constants2';
import { type BucketSnapshot, type BucketLifecycleState, type NewsArticle, type BnDashboard, type QuoteStock, type EnrichedStock, type DetectedTheme } from './types';

export const getSev = (label: string) => {
  const up = label?.toUpperCase() || '';
  for (const k of SEV_KEYS_ORDER) if (up.includes(k)) return SEV[k];
  return SEV.DEFAULT;
};
export const getLvl = (l?: string) => l ? (LEVEL_STYLES[l.toUpperCase()] ?? null) : null;
// Investability score: combines evidence quality, lifecycle state, and company mapping completeness
export function getInvestabilityScore(bucketId: string, vel: { week: number; trend: string }, signalCount: number, articleCount: number, hasChokepoints: boolean): {
  score: number; label: string; color: string; reasoning: string;
} {
  let score = 0;
  const reasons: string[] = [];
  // Evidence freshness (40%)
  if (vel.week >= 3)     { score += 40; reasons.push('live acceleration'); }
  else if (vel.week >= 1){ score += 25; reasons.push('active evidence'); }
  else if (STRUCTURAL_THEMES.has(bucketId)) { score += 15; reasons.push('structural'); }
  else                    { score += 0;  reasons.push('stale'); }
  // Signal diversity (30%) — ratio check
  const ratio = articleCount > 0 ? signalCount / articleCount : 1;
  if (ratio < 0.6)        { score += 30; reasons.push('diverse signals'); }
  else if (ratio < 0.85)  { score += 18; reasons.push('moderate diversity'); }
  else                    { score += 5;  reasons.push('low diversity'); }
  // Company mapping completeness (30%)
  if (hasChokepoints)     { score += 30; reasons.push('company-mapped'); }
  else                    { score += 8;  reasons.push('theme-only'); }
  const label = score >= 75 ? '🟢 HIGH' : score >= 50 ? '🟡 MEDIUM' : score >= 30 ? '🟠 LOW' : '🔴 VERY LOW';
  const color = score >= 75 ? '#10B981' : score >= 50 ? '#F59E0B' : score >= 30 ? '#F97316' : '#EF4444';
  return { score, label, color, reasoning: reasons.join(' · ') };
}
export function saveSnapshot(buckets: {bucket_id: string; severity: number; signal_count: number}[], vels: Record<string, {week: number}>) {
  try {
    const snap: BucketSnapshot[] = buckets.map(b => ({
      id: b.bucket_id, severity: b.severity, signal_count: b.signal_count,
      week: vels[b.bucket_id]?.week ?? 0, timestamp: Date.now(),
    }));
    localStorage.setItem(CHANGE_TRACKER_KEY, JSON.stringify(snap));
  } catch {}
}
export function getChanges(buckets: {bucket_id: string; label: string; severity: number; signal_count: number}[], vels: Record<string, {week: number}>): { type: string; bucket: string; label: string; detail: string; color: string }[] {
  try {
    const prev: BucketSnapshot[] = JSON.parse(localStorage.getItem(CHANGE_TRACKER_KEY) || '[]');
    const prevMap = new Map(prev.map(p => [p.id, p]));
    const AGE_HOURS = prev.length > 0 ? (Date.now() - Math.max(...prev.map(p => p.timestamp))) / 3600000 : 999;
    if (AGE_HOURS > 48) return []; // Only show changes within 48 hours
    const changes: { type: string; bucket: string; label: string; detail: string; color: string }[] = [];
    for (const b of buckets) {
      const p = prevMap.get(b.bucket_id);
      const curWeek = vels[b.bucket_id]?.week ?? 0;
      const prevWeek = p?.week ?? 0;
      if (!p) { changes.push({ type: 'NEW', bucket: b.bucket_id, label: b.label, detail: 'Appeared this session', color: '#8B5CF6' }); continue; }
      if (b.severity > p.severity) changes.push({ type: 'UPGRADED', bucket: b.bucket_id, label: b.label, detail: `Severity ↑ ${p.severity}→${b.severity}`, color: '#EF4444' });
      else if (b.severity < p.severity) changes.push({ type: 'DOWNGRADED', bucket: b.bucket_id, label: b.label, detail: `Severity ↓ ${p.severity}→${b.severity}`, color: '#10B981' });
      if (curWeek > prevWeek + 2) changes.push({ type: 'RISING', bucket: b.bucket_id, label: b.label, detail: `Evidence surge +${curWeek - prevWeek} articles this week`, color: '#F59E0B' });
      else if (prevWeek >= 3 && curWeek === 0) changes.push({ type: 'COLLAPSED', bucket: b.bucket_id, label: b.label, detail: `Was ${prevWeek} articles/wk → now 0`, color: '#4A5B6C' });
    }
    return changes.slice(0, 6); // max 6 change cards
  } catch { return []; }
}
// Score decay: stale non-structural themes auto-lose tactical prominence over time
export function getDecayedSeverity(bucketId: string, severity: number, vel: { week: number; prev: number }): {
  effective: number; decayed: boolean; weeksStale: number;
} {
  if (vel.week > 0 || STRUCTURAL_THEMES.has(bucketId)) return { effective: severity, decayed: false, weeksStale: 0 };
  // Estimate weeks stale from velocity data (prev week also 0 = at least 2 weeks)
  const weeksStale = vel.prev === 0 ? 2 : 1;
  const decayed = weeksStale >= 1;
  // Decay: -1 severity per week stale, minimum 1
  const effective = Math.max(1, severity - weeksStale);
  return { effective, decayed, weeksStale };
}
// Evidence diversity: source family analysis
export function calcEvidenceDiversity(signalCount: number, articleCount: number): {
  ratio: number; label: string; color: string; detail: string;
} {
  if (articleCount === 0) return { ratio: 0, label: 'No data', color: '#4A5B6C', detail: 'No articles this period' };
  const ratio = signalCount / articleCount;
  // Count estimated source families (rough proxy: if ratio > 0.9, likely 1 family; < 0.6 = multiple)
  const estimatedFamilies = ratio >= 0.9 ? 1 : ratio >= 0.75 ? 2 : ratio >= 0.6 ? 3 : 4;
  if (ratio >= 0.9) return { ratio, label: 'Single-source', color: '#EF4444', detail: `${signalCount}/${articleCount} — ~1 source family · evidence is article-proxy only` };
  if (ratio >= 0.75) return { ratio, label: 'Low diversity', color: '#F59E0B', detail: `${signalCount}/${articleCount} — ~${estimatedFamilies} source families · needs broader confirmation` };
  if (ratio >= 0.55) return { ratio, label: 'Moderate', color: '#0F7ABF', detail: `${signalCount}/${articleCount} — ~${estimatedFamilies} source families · reasonable signal quality` };
  return { ratio, label: 'Good diversity', color: '#10B981', detail: `${signalCount}/${articleCount} — ~${estimatedFamilies}+ source families · signals are genuinely aggregated` };
}
export function getBucketLifecycle(bucketId: string, vel: { week: number; prev: number; trend: string }): {
  state: BucketLifecycleState; label: string; color: string; desc: string;
} {
  if (vel.week >= 2 && vel.trend === '🔥')
    return { state: 'ACCELERATING', label: '🔥 ACCELERATING', color: '#F59E0B', desc: `${vel.week} articles this week vs ${vel.prev} prior — real-time stress building` };
  if (vel.week >= 1)
    return { state: 'ACTIVE', label: '⚡ ACTIVE', color: '#10B981', desc: `${vel.week} article${vel.week !== 1 ? 's' : ''} this week — thesis actively playing out` };
  if (vel.trend === '📉' && vel.prev > 0)
    return { state: 'FADING', label: '📉 FADING', color: '#4A5B6C', desc: `Signal decelerating — was ${vel.prev} last week, now 0 this week` };
  if (STRUCTURAL_THEMES.has(bucketId))
    return { state: 'STRUCTURAL', label: '🏗 STRUCTURAL', color: '#8B5CF6', desc: 'Long-cycle constraint — persists across news cycles (3–10yr duration), not driven by weekly headlines' };
  return { state: 'STALE', label: '⏸ STALE', color: '#4A5B6C', desc: 'No articles this week — thesis may be resolved, paused, or low-priority right now' };
}
export function isLikelyTicker(t: any): boolean {
  // PATCH 0446 BUG-047 — Geo tab crashed with 't.toUpperCase is not a function'
  // because some payload variants serialize ticker_symbols as { ticker: 'NVDA' }
  // objects instead of plain strings, and getTickerSymbols passed them through
  // unchanged. Now coerce defensively before any string op.
  if (t == null) return false;
  const s = typeof t === 'string' ? t : (t?.ticker ?? t?.symbol ?? '');
  if (typeof s !== 'string' || !s) return false;
  const u = s.toUpperCase();
  if (JUNK.has(u)) return false;
  // Standard ticker OR Asian ticker with 2+ digit suffix (TOWA6315, WIN3105).
  // Single-digit suffix pattern [A-Z]{2,5}[0-9] was causing COHR+T4="COHRT4" false positives.
  if (!/^[A-Z]{2,6}(\.[A-Z]{1,2})?$/.test(u) && !/^[A-Z]{2,5}[0-9]{2,}$/.test(u)) return false;
  // Reject {ticker}T{digit} concatenations (tier badges from article text: "COHR T4" → "COHRT4")
  if (/^[A-Z]{2,4}T[0-9]$/.test(u)) return false;
  const vowels = u.replace(/[^AEIOU]/g, '').length;
  if (u.length === 3 && vowels === 0) return false;
  return true;
}
export function getTickerSymbols(a: NewsArticle): string[] {
  // PATCH 0446 BUG-047 — Normalize BOTH ticker_symbols AND tickers as the
  // same string[]. Some upstream payloads ship ticker_symbols as objects.
  const coerce = (t: any): string => typeof t === 'string' ? t : (t?.ticker ?? t?.symbol ?? '');
  const raw: string[] = a.ticker_symbols?.length
    ? (a.ticker_symbols as any[]).map(coerce).filter(Boolean)
    : (a.tickers ?? []).map(coerce).filter(Boolean);
  return raw.filter(t => isLikelyTicker(t));
}
// ── Serenity Score ────────────────────────────────────────────────────────────

// Signal diversity: when signal_count ≈ article_count, evidence is article-proxy-driven not aggregated
export function signalDiversityScore(signalCount: number, articleCount: number): { warning: boolean; label: string } {
  if (articleCount === 0 || signalCount === 0) return { warning: false, label: '' };
  const ratio = signalCount / articleCount;
  if (ratio >= 0.85) return { warning: true, label: '⚠ 1-article-1-signal: evidence not yet aggregated from multiple source types' };
  if (ratio >= 0.65) return { warning: false, label: '→ Some signal aggregation present' };
  return { warning: false, label: '✓ Good signal diversity — multiple source types' };
}
export function calcScore(row: { level?: string; evidence_count: number; sub_tag?: string; is_small_cap: boolean }): number {
  const lw: Record<string, number> = { CRITICAL: 40, BOTTLENECK: 25, WATCH: 12, RESOLVED: 2 };
  const lv = lw[(row.level ?? '').toUpperCase()] ?? 5;
  const ev = Math.min(30, Math.round(Math.log2(row.evidence_count + 1) * 10));
  const ti = row.sub_tag ? TIER_MAP[row.sub_tag] : undefined;
  const tb = ti ? Math.max(0, (7 - ti.tier) * 3) : 0;
  const sb = row.is_small_cap ? 12 : 0;
  return Math.min(100, lv + ev + tb + sb);
}
export const scoreColor = (s: number) => s >= 80 ? '#EF4444' : s >= 60 ? '#F59E0B' : s >= 40 ? '#0F7ABF' : '#4A5B6C';
// ── Helpers ───────────────────────────────────────────────────────────────────

export const timeAgo = (iso: string) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return iso; } };
export function cleanUrl(r: string) { if (!r || r === '#') return '#'; let u = r.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim(); const idx = u.indexOf('http', 1); if (idx > 0 && u.startsWith('http')) u = u.slice(idx); return u; }
export function fmtCap(mc?: number) { if (!mc || mc <= 0) return '—'; if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`; if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`; if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`; return `$${mc}`; }
export function exchangeFlag(exchange?: string) {
  if (!exchange) return null;
  const e = exchange.toUpperCase();
  if (e.includes('NSE') || e.includes('BSE')) return { flag: '🇮🇳', label: 'India' };
  if (e.includes('STO') || e.includes('OMX')) return { flag: '🇸🇪', label: 'Sweden' };
  if (e.includes('TSE') || e.includes('JPX')) return { flag: '🇯🇵', label: 'Japan' };
  if (e.includes('KRX') || e.includes('KOS')) return { flag: '🇰🇷', label: 'Korea' };
  if (e.includes('FRA') || e.includes('XETRA')) return { flag: '🇩🇪', label: 'Germany' };
  if (e.includes('TWO') || e.includes('TWSE')) return { flag: '🇹🇼', label: 'Taiwan' };
  return null;
}
// ── API hooks ─────────────────────────────────────────────────────────────────

// PATCH 0472 — 20s AbortController per query so a stuck endpoint doesn't
// pin the workbench in a permanent loading state.
export function useDashboard() {
  return useQuery<BnDashboard>({
    queryKey: ['bn', 'dashboard'],
    queryFn: async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      try {
        const r = await fetch('/api/v1/news/bottleneck-dashboard', { signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // PATCH 0716 — safe JSON parse so malformed payload doesn't crash.
        try { return await r.json(); } catch (e: any) { throw new Error(`parse error: ${e?.message || 'invalid JSON'}`); }
      } finally { clearTimeout(t); }
    },
    refetchInterval: 180_000, staleTime: 120_000, retry: 1,
  });
}
export function useBNNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'news'],
    queryFn: async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      try {
        const r = await fetch('/api/v1/news?limit=400&importance_min=2&article_type=BOTTLENECK', { signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // PATCH 0716 — safe JSON parse.
        let d: any;
        try { d = await r.json(); } catch { return []; }
        return Array.isArray(d) ? d : [];
      } finally { clearTimeout(t); }
    },
    refetchInterval: 90_000, staleTime: 60_000, retry: 1,
  });
}
// AUDIT_100 #94 — gate Geo query so it only fires when the user lands on
// the Geo tab. Cuts 5 simultaneous /api/v1/news requests on mount → 0 until
// activated. Other 5 hooks are smaller payloads + needed by Rotation tab.
export function useGeoNews(enabled = true) {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'geo'],
    enabled,
    queryFn: async () => {
      // Fetch from MULTIPLE types — typed GEOPOLITICAL/TARIFF are rare in most feeds.
      // Instead use broad fetches and apply geo keyword filtering client-side.
      const fetches = await Promise.allSettled([
        fetch('/api/v1/news?limit=100&importance_min=2&article_type=GEOPOLITICAL'),
        fetch('/api/v1/news?limit=100&importance_min=2&article_type=TARIFF'),
        fetch('/api/v1/news?limit=100&importance_min=2&article_type=MACRO'),
        fetch('/api/v1/news?limit=100&importance_min=2&article_type=GENERAL'),
        fetch('/api/v1/news?limit=80&importance_min=3&article_type=CORPORATE'),
      ]);
      const arrays = await Promise.all(fetches.map(async r => {
        if (r.status !== 'fulfilled' || !r.value.ok) return [];
        try { const d = await r.value.json(); return Array.isArray(d) ? d : []; } catch { return []; }
      }));
      // Deduplicate by URL and title hash
      const seen = new Set<string>();
      const all: NewsArticle[] = [];
      for (const arr of arrays) {
        for (const a of arr) {
          const key = (a.url || a.source_url || '') + '|' + (a.title || a.headline || '').slice(0, 60);
          if (!seen.has(key)) { seen.add(key); all.push(a); }
        }
      }
      // Filter to geo-relevant: must match at least one geo keyword
      const GEO_KWS = ['tariff','trade war','export ban','export control','sanction','chips act','china','taiwan','geopolit','supply chain disruption','subsidy','government contract','military','defense','federal funding','grid','electricity','shipping','port','red sea','currency','yuan','yen','trade restriction','section 301','gallium','germanium','rare earth','nato','war ','freight','logistics'];
      const geoRelevant = all.filter(a => {
        const text = ((a.title||'') + ' ' + (a.headline||'') + ' ' + (a.summary||'')).toLowerCase();
        return GEO_KWS.some(kw => text.includes(kw));
      });
      return geoRelevant
        .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
        .slice(0, 80);
    },
    refetchInterval: 90_000, staleTime: 60_000, retry: 1,
  });
}
export function useUSQuotes(enabled = true) {
  // PATCH 0446 BUG-028 v2 — Audit reported NHPC / NTPC scanner prices showed
  // '—' alongside US tickers. Root cause: this hook only fetched US quotes,
  // so Indian symbols never bound. Now fetch BOTH markets in parallel and
  // merge — the scanner has US + India tickers in the same universe.
  return useQuery<QuoteStock[]>({
    queryKey: ['bn', 'us-india-quotes'],
    queryFn: async () => {
      try {
        const [usRes, inRes] = await Promise.all([
          fetch('/api/market/quotes?market=us').catch(() => null),
          fetch('/api/market/quotes?market=india').catch(() => null),
        ]);
        const all: QuoteStock[] = [];
        if (usRes?.ok) {
          const d = await usRes.json();
          if (Array.isArray(d?.stocks)) all.push(...d.stocks);
        }
        if (inRes?.ok) {
          const d = await inRes.json();
          if (Array.isArray(d?.stocks)) all.push(...d.stocks);
        }
        return all;
      } catch { return []; }
    },
    refetchInterval: 90_000 /* PATCH 0818: 60s→5m */, staleTime: 45_000, retry: 1,
    // AUDIT_100 #94 — gate so the heavy paired-market quote fetch only fires
    // when the Scanner tab is active (where prices actually render).
    enabled,
  });
}
export function calcVelocity(articles: NewsArticle[], matchFn: (a: NewsArticle) => boolean): {
  week: number; prev: number; trend: '🔥' | '📉' | '→'; isNew: boolean; accel: number;
} {
  const now = Date.now();
  let week = 0, prev = 0;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const age = now - new Date(a.published_at).getTime();
    if (age < WEEK_MS) week++;
    else if (age < 2 * WEEK_MS) prev++;
  }
  const ratio = prev === 0 ? week : week / prev;
  const trend: '🔥' | '📉' | '→' = ratio >= 1.5 ? '🔥' : ratio <= 0.5 && prev > 0 ? '📉' : '→';
  const accel = Math.min(12, Math.round((ratio - 1) * 6)); // -6 to +12 velocity bonus
  return { week, prev, trend, isNew: week > 0 && week >= prev, accel };
}
export function calcBucketVelocity(articles: NewsArticle[], bucketId: string) {
  return calcVelocity(articles, a => a.bottleneck_sub_tag === bucketId);
}
export function buildEnrichedStocks(articles: NewsArticle[], quotes: QuoteStock[]): EnrichedStock[] {
  // Build evidence map from live articles
  const evidenceMap = new Map<string, { count: number; headlines: string[]; latest: string }>();
  for (const a of articles) {
    for (const sym of getTickerSymbols(a)) {
      const key = sym.toUpperCase();
      if (!evidenceMap.has(key)) evidenceMap.set(key, { count: 0, headlines: [], latest: '' });
      const e = evidenceMap.get(key)!;
      e.count++;
      const h = a.title || a.headline || '';
      if (h && e.headlines.length < 3 && !e.headlines.includes(h)) e.headlines.push(h);
      if (!e.latest || a.published_at > e.latest) e.latest = a.published_at;
    }
  }
  // Build quote map
  // PATCH 0261 — defend against undefined/null quote tickers
  const qm = new Map<string, QuoteStock>(
    (quotes || []).filter(q => q?.ticker).map(q => [q.ticker.toUpperCase(), q])
  );

  return UNIVERSE_DEDUPED.map((u): EnrichedStock => {
    // Match quotes by short ticker (strip exchange suffix like 6315, 322310)
    const shortTicker = u.ticker.replace(/\d+$/, '').toUpperCase();
    const q = qm.get(u.ticker.toUpperCase()) ?? qm.get(shortTicker);
    const ev = evidenceMap.get(u.ticker.toUpperCase()) ?? evidenceMap.get(shortTicker);
    const mc = q?.marketCap;
    const isSC = !!(mc && mc > 0 && mc < 2_000_000_000);
    const evidenceCount = ev?.count ?? 0;

    // Serenity Score:
    // - Upstream bonus: earlier in value chain = rarer = more asymmetric
    const upstreamBonus = Math.max(0, (10 - u.val_tier) * 7); // T1=63, T2=56, T3=49, ..., T10=0
    // - Size asymmetry bonus: unified $2B threshold (was inconsistently $2B display / $10B calc)
    const sizeBonus = isSC ? 15 : 0; // only true small-cap (<$2B) gets bonus; removed $10B tier
    // - Cross-border arb bonus (non-US = info asymmetry)
    const nonUsBonuses: Record<string, number> = { STO: 12, TSE: 12, KRX: 12, TWO: 10, FRA: 8 };
    const arb = nonUsBonuses[u.exchange] ?? 0;
    // - Serenity explicit mention
    const serenityBonus = u.is_serenity_pick ? 10 : 0;
    // - Live evidence bonus (max 8) — absolute count signal
    const evBonus = Math.min(8, evidenceCount * 2);
    // - Competition moat
    const compBonus = u.competitors === '1 public' ? 10 : u.competitors === '2–3 public' ? 5 : 0;
    // - Velocity bonus: articles this week vs prior week (dynamic)
    const vel = calcVelocity(articles, a =>
      getTickerSymbols(a).some(s => s.toUpperCase() === u.ticker.replace(/\d+$/,'').toUpperCase() || s.toUpperCase() === shortTicker)
    );
    const velBonus = Math.max(0, vel.accel); // 0–12 if accelerating
    // FIX: evidence and velocity measured the same thing — don't sum both.
    // A stock with 5 articles this week + 0 prior would get evBonus=8 + velBonus=12 = 20pts noise bonus.
    // Use max(evidence, velocity): rewards TRUE acceleration over one-time article dumps.
    const newsBonus = Math.max(evBonus, velBonus);

    // Criteria checks — now part of score (each failed check = −5 pts)
    // check1: <3 public competitors (monopoly / duopoly test)
    const check1 = u.competitors === '1 public' || u.competitors === '2–3 public';
    // check2: small-cap (<$2B) — size asymmetry (now unified with sizeBonus threshold)
    const check2 = isSC;
    // check3: non-US listing — cross-border info arbitrage
    const check3 = u.exchange !== 'NYSE' && u.exchange !== 'NASDAQ';
    // check4: tier ≤4 upstream — close enough to the bottleneck
    const check4 = u.val_tier <= 4;
    const criteriaFail = [check1, check2, check3, check4].filter(c => !c).length;
    const criteriaBonus = -criteriaFail * 5; // −5 per failed check (max −20)

    // Hard-cap junk: stocks failing ALL 4 criteria are fundamentally unsuitable
    // (large-cap, US-listed, downstream, crowded) — cap at 20 regardless of news
    const rawScore = Math.min(100, Math.max(0,
      upstreamBonus + sizeBonus + arb + serenityBonus + newsBonus + compBonus + criteriaBonus
    ));
    const score = criteriaFail >= 4 ? Math.min(rawScore, 20) : rawScore;

    return {
      ...u,
      evidence_count: evidenceCount,
      headlines: ev?.headlines ?? [],
      latest_at: ev?.latest,
      price: q?.price,
      market_cap: mc,
      change_pct: q?.changePercent,
      quote_name: q?.company,
      is_small_cap: isSC,
      is_non_us: !!exchangeFlag(u.exchange),
      score,
      velocity: vel,
    };
  }).sort((a, b) => b.score - a.score);
}
export function detectEmergingThemes(articles: NewsArticle[]): DetectedTheme[] {
  const now = Date.now();
  const results: DetectedTheme[] = [];
  for (const det of EMERGING_THEME_DETECTORS) {
    const matched = articles.filter(a => {
      const text = ((a.title || a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
      return det.keywords.some(kw => text.includes(kw));
    });
    if (matched.length === 0) continue;
    const weekMatched = matched.filter(a => now - new Date(a.published_at).getTime() < WEEK_MS);
    const headlines = matched.slice(0, 3).map(a => a.title || a.headline || '');
    results.push({
      id: det.id, label: det.label, icon: det.icon, color: det.color,
      count: matched.length, weekCount: weekMatched.length,
      headlines,
      isNew: !THEME_TO_BUCKET[det.id], // "new" = not already covered by existing 9 buckets
    });
  }
  return results.sort((a, b) => b.weekCount - a.weekCount || b.count - a.count);
}
export function detectMechanism(article: NewsArticle): { key: string; label: string; color: string; icon: string; layers: string[] } | null {
  const text = ((article.title || article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
  for (const [key, kws] of Object.entries(MECHANISM_KEYWORDS)) {
    if (kws.some(kw => text.includes(kw))) return { key, ...GEO_MECHANISMS[key] };
  }
  return null;
}
export function useEarningsSignals() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'earnings-signals'],
    queryFn: async () => {
      // PATCH 0716 — added 15s timeout + safe JSON parse + shape guard.
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      let r: Response;
      try { r = await fetch('/api/v1/news?limit=100&importance_min=3&article_type=EARNINGS', { signal: ctl.signal }); }
      catch { clearTimeout(t); return []; }
      finally { clearTimeout(t); }
      if (!r.ok) return [];
      let data: any;
      try { data = await r.json(); } catch { return []; }
      if (!Array.isArray(data)) return [];
      // Filter to universe stocks only
      return data.filter((a: NewsArticle) => {
        const tickers = (a?.ticker_symbols ?? []);
        return Array.isArray(tickers) && tickers.some((t: string) => typeof t === 'string' && EARNINGS_WATCH.includes(t.toUpperCase()));
      });
    },
    refetchInterval: 90_000,
    staleTime: 240_000,
    retry: 1,
  });
}
export function useConferenceSignals() {
  return useQuery<Record<string, number>>({
    queryKey: ['bn', 'conf-signals'],
    queryFn: async () => {
      // PATCH 0716 — added 15s timeout + safe JSON parse + array guard.
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      let r: Response;
      try { r = await fetch('/api/v1/news?limit=200&importance_min=2', { signal: ctl.signal }); }
      catch { clearTimeout(t); return {}; }
      finally { clearTimeout(t); }
      if (!r.ok) return {};
      let parsed: any;
      try { parsed = await r.json(); } catch { return {}; }
      const articles: NewsArticle[] = Array.isArray(parsed) ? parsed : [];
      const counts: Record<string, number> = {};
      for (const [confName, kws] of Object.entries(CONF_KEYWORDS)) {
        counts[confName] = articles.filter(a => {
          const text = ((a?.title || a?.headline || '') + ' ' + (a?.summary || '')).toLowerCase();
          return kws.some(kw => text.includes(kw));
        }).length;
      }
      return counts;
    },
    refetchInterval: 90_000, // 5 min
    staleTime: 240_000,
    retry: 1,
  });
}
