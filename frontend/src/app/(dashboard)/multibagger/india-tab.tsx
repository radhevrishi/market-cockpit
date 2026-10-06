'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { getDecision, subscribeDecisions, type DecisionStatus } from '@/lib/decisions';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import { ValuationStrip } from '@/components/valuation/ValuationStrip';
import { detectCsvMarket } from '@/lib/multibagger-csv-parsers';
import { SYNC_ROUTING, getSyncStatus, fetchCsvsAsFiles, shouldAutoLoad, markAutoLoaded, resetAutoLoadFlag, type SyncStatus, fetchTradingviewCsvsAsFiles } from '@/lib/screener-data-loader';
import { GRADE_COLOR, OWNERSHIP_CONFIG, BUCKET_CONFIG, SBENCH, getSectorKey, applyForcedRanking, scoreExcelRow } from '@/lib/multibagger-india-scoring';
import type { Grade, NewsArticle, ExcelRow, OwnershipCategory, Bucket, ExcelResult } from '@/lib/multibagger-india-scoring';
import { buildColMap, rawRowToExcelRow } from './column-map';
import { ACCENT, API_BASE, BORDER, CARD2, CARD_BG, F, GREEN, MUTED, ORANGE, PURPLE, RED, TEXT, YELLOW } from './constants';
import { NewSeenCheckbox, useNewTracker } from './new-tracker';
import { STORAGE_KEY, STORAGE_META, mbIdbGet } from './storage';
import { CloudSaveStatusBadge, DecisionBar, ScoreMoversStrip, ThesisDriftStrip } from './widgets';

export function ExcelCompare({ rows, setRows }: { rows: ExcelResult[]; setRows:(r:ExcelResult[])=>void }) {
  const [fileName, setFileName] = useState(() => {
    // Restore last session's file label from meta
    try {
      const meta = JSON.parse(localStorage.getItem(STORAGE_META) || '{}');
      if (meta.count && meta.savedAt) {
        const d = new Date(meta.savedAt);
        return `${meta.count} stocks · saved ${d.toLocaleString()}`;
      }
    } catch {}
    return '';
  });
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  // PATCH 1083 — orphan-meta detection. If STORAGE_META shows count > 0 but
  // localStorage[STORAGE_KEY] is empty (quota wiped after 5MB cap or app version
  // change), show a red banner so user knows to re-upload. Auto-clears stale
  // meta after dismissal so it doesn't keep firing.
  const [orphanMetaCount, setOrphanMetaCount] = useState<number>(0);
  // PATCH 1084 — sync fileName when the parent clears all data via the
  // mb-upload:updated event. Previously fileName stayed showing "1 file · N
  // stocks" even after Clear because the state lives in this child component.
  useEffect(() => {
    function onUploadEvent(e: Event) {
      const ce = e as CustomEvent<{ cleared?: boolean }>;
      if (ce.detail && ce.detail.cleared) {
        setFileName('');
        setOrphanMetaCount(0);
        setParseError('');
      }
    }
    window.addEventListener('mb-upload:updated', onUploadEvent);
    return () => window.removeEventListener('mb-upload:updated', onUploadEvent);
  }, []);
  // PATCH 1099 — REAL persistence fix. Previous PATCH 1083/1084/1090 patched
  // symptoms; this addresses three structural bugs that kept producing the
  // "Saved data lost (N stocks)" banner even after a successful upload:
  //
  //   (1) META was written in the same call as data, but localStorage data
  //       writes can silently fail (5MB quota) while META always succeeds.
  //       Result: META=345 + data=empty is possible. Fix is in setExcelRows
  //       (in MultibaggerPage below): write IDB first, only write META after
  //       IDB confirms.
  //
  //   (2) This effect ran ONCE on mount and raced the parent's async IDB
  //       hydration. If the child's check resolved first, the banner fired
  //       even when IDB had data the parent would soon load. Fix: rerun on
  //       rows.length change, wait 1.2s for parent hydration to settle, and
  //       always clear the banner the instant rows is populated.
  //
  //   (3) The displayed "✅ N stocks · saved …" came from META alone, so the
  //       success message and warning banner could appear simultaneously —
  //       exactly the user-reported confusion. fileName is now resynced on
  //       rows hydration (see effect below).
  useEffect(() => {
    if (rows.length > 0) {
      setOrphanMetaCount(0);
      return;
    }
    let alive = true;
    const tid = window.setTimeout(async () => {
      if (!alive) return;
      try {
        const metaRaw = localStorage.getItem(STORAGE_META);
        if (!metaRaw) { setOrphanMetaCount(0); return; }
        const meta = JSON.parse(metaRaw);
        if (!meta || !meta.count || meta.count === 0) { setOrphanMetaCount(0); return; }
        const dataRaw = localStorage.getItem(STORAGE_KEY);
        if (dataRaw && dataRaw !== '[]') return; // parent's sync init will restore
        const idbRaw = await mbIdbGet('mb_scored');
        if (!alive) return;
        if (idbRaw && idbRaw !== '[]') {
          try {
            const parsed = JSON.parse(idbRaw) as ExcelResult[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setRows(applyForcedRanking(parsed));
              return;
            }
          } catch {}
        }
        setOrphanMetaCount(meta.count);
      } catch {}
    }, 1200);
    return () => { alive = false; clearTimeout(tid); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // PATCH 1099 — keep the file-label honest. Once rows hydrate from any source
  // (localStorage init or parent's IDB rehydrate), refresh fileName from META
  // so the timestamp matches what the user is actually looking at.
  // PATCH 1101zzz43 — guarded: only refresh from META when the existing
  // fileName looks like the stale IDB-restore format (`N stocks · saved …`).
  // The handleFiles upload toast sets fileName to "+N new stocks added · …"
  // and that string MUST NOT be clobbered by this effect, otherwise the user
  // never sees the diagnostic counts and the displayed count/date freeze on
  // the last IDB snapshot. Regression seen after auto-sync from 121 → 137:
  // toast briefly correct then snapped back to "121 stocks · saved 6/19".
  useEffect(() => {
    if (rows.length === 0) return;
    // Only allow this effect to refresh the label when the current label is
    // either empty OR the IDB-restore format. Never overwrite an active
    // upload toast (contains "added" / "files ·" / "membership refreshed").
    const isUploadToast = !!fileName && /added|files\s*·|membership refreshed/i.test(fileName);
    if (isUploadToast) return;
    try {
      const meta = JSON.parse(localStorage.getItem(STORAGE_META) || '{}');
      if (meta.count && meta.savedAt) {
        const d = new Date(meta.savedAt);
        setFileName(`${meta.count} stocks · saved ${d.toLocaleString()}`);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  const [expRow, setExpRow] = useState<string|null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set(['ALL']));
  const [goodOnly, setGoodOnly] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<Bucket|'ALL'>('ALL');
  // PATCH 0127 — sector dropdown so the analyst can rank within a single
  // industry (e.g. compare HBLENGINE only against Defence peers, not all 84).
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [accelOnly, setAccelOnly] = useState(false);
  const [fcfOnly, setFcfOnly] = useState(false);
  const [discoveryOnly, setDiscoveryOnly] = useState(false);
  // PATCH 1052 — "Above 50 & 200 DMA" combined-uptrend filter. Most CSV exports
  // only carry 200 DMA, so when 50 DMA isn't available we fall back to a proxy:
  // price > 200 DMA AND 1-month return > -3% (positive short-term momentum
  // implies the price is also above the 50 DMA on most reasonable distributions).
  // User-requested preset for stacking on top of the Good filter.
  const [dmaConfirmedOnly, setDmaConfirmedOnly] = useState(false);
  // PATCH 1046 — fraud risk filter (lets user verify the fraud detection by isolating flagged stocks)
  const [fraudFilter, setFraudFilter] = useState<'ALL'|'CLEAN'|'CRITICAL'|'HIGH'|'ANY'>('ALL');
  const [inflectionOnly, setInflectionOnly] = useState(false);
  // P/E and PEG range filters — 'ALL' means no filter
  const [peMax, setPeMax] = useState<'ALL'|15|25|40|60|100>('ALL');
  const [pegMax, setPegMax] = useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  // PATCH 0345 — India institutional-quality composite filters (analogs of USA R40/Piotroski/GPM):
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of Rule of 40.
  // Captures both moat (ROCE) and growth in one metric.
  const [indQualityMin, setIndQualityMin] = useState<'ALL'|50|75|100>('ALL');
  // ROCE filter standalone — moat signature (>25% = elite, >20% = strong)
  const [indRoceMin, setIndRoceMin] = useState<'ALL'|20|25|30>('ALL');
  // Cash conversion — CFO/PAT ≥ 1.0 = earnings fully cash-backed (≥0.8 = clean, ≥1.0 = elite)
  const [indCfoMin, setIndCfoMin] = useState<'ALL'|0.8|1.0>('ALL');
  // PATCH 0347 — Decision filter (filter India rows by user's logbook status)
  const [indDecisionFilter, setIndDecisionFilter] = useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  // PATCH 0347 — Bump to force re-render when decisions change (cross-tab/edit sync)
  const [decisionsVersion, setDecisionsVersion] = useState(0);
  const bumpDecisions = useCallback(() => setDecisionsVersion(v => v + 1), []);
  useEffect(() => subscribeDecisions(() => bumpDecisions()), [bumpDecisions]);
  // Guidance tier filter — only applies when guidanceMode is ON
  type GuidanceTier = 'ALL'|'STRONG'|'POS'|'NEUTRAL'|'NEG'|'WEAK';
  const [guidanceTier, setGuidanceTier] = useState<GuidanceTier>('ALL');

  // ── GUIDANCE MODE ──────────────────────────────────────────────────────────
  // When ON: fetches recent earnings/guidance news, scores each company
  // by guidance quality (0.0-1.0), re-scores and re-sorts.
  // When OFF: no change to existing scores.
  const [guidanceMode, setGuidanceMode] = useState(false);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceScores, setGuidanceScores] = useState<Record<string, number>>({}); // symbol → 0.0-1.0
  const [guidanceArticleCounts, setGuidanceArticleCounts] = useState<Record<string, number>>({});
  // PATCH 1050 — Haiku AI guidance overlay (separate from news-keyword guidance above)
  // Cache key: mc:multibagger:ai-guidance:v1 — 100-day TTL per ticker
  // PATCH 1052 — Extended entry stores rich content: rationale (full), quotes,
  // numbers (metric/value/period rows), catalysts (event/timing rows), sourceUrl.
  type GuidanceQuote = { quote: string; speaker?: string };
  type GuidanceNumber = { metric?: string; value?: string; period?: string };
  type GuidanceCatalyst = { event?: string; timing?: string };
  type AiGuidanceEntry = {
    score: number;
    tier: 'EXCELLENT'|'POSITIVE'|'NEUTRAL'|'CAUTIOUS'|'NEGATIVE'|'NOGUIDANCE';
    summary: string;          // short rationale (300 char) used in hover
    rationale?: string;       // full rationale (kept for the rich expand panel)
    quotes?: GuidanceQuote[];
    numbers?: GuidanceNumber[];
    catalysts?: GuidanceCatalyst[];
    sourceUrl?: string;
    period: string;
    fetchedAt: number;
  };
  const [aiGuidanceMap, setAiGuidanceMap] = useState<Record<string, AiGuidanceEntry>>({});
  const [aiGuidanceLoading, setAiGuidanceLoading] = useState(false);
  const [aiGuidanceProgress, setAiGuidanceProgress] = useState({done:0, total:0, failed:0, configMissing:false});
  const [aiTierFilter, setAiTierFilter] = useState<'ALL'|'EXCELLENT'|'POSITIVE'|'NEUTRAL'|'CAUTIOUS'|'NEGATIVE'|'NOGUIDANCE'>('ALL');
  // Load cached guidance on mount
  React.useEffect(() => {
    try { const raw = localStorage.getItem('mc:multibagger:ai-guidance:v1'); if (raw) setAiGuidanceMap(JSON.parse(raw)); } catch {}
  }, []);
  // Persist cache on change
  React.useEffect(() => {
    try { localStorage.setItem('mc:multibagger:ai-guidance:v1', JSON.stringify(aiGuidanceMap)); } catch {}
  }, [aiGuidanceMap]);

  // ADDITIVE — Transformation-radar overlay. Best-effort fetch of the concall
  // transformation-screener; builds an upper(symbol)->entry map used to render a
  // small "🚀 T-{score}" badge next to on-radar tickers. Non-invasive; hides on failure.
  const [transformMap, setTransformMap] = useState<Map<string, { symbol: string; transformation_score: number; stage_sweet_spot?: any; velocity?: any }>>(new Map());
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/concall-intel/transformation-screener?days=60&limit=24', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const entries: any[] = Array.isArray(data?.entries) ? data.entries : [];
        const m = new Map<string, { symbol: string; transformation_score: number; stage_sweet_spot?: any; velocity?: any }>();
        for (const e of entries) {
          const sym = String(e?.symbol || '').toUpperCase().replace(/\.NS$|\.BO$/i, '');
          if (sym) m.set(sym, e);
        }
        if (alive) setTransformMap(m);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // Soft fetch: only fetch tickers with no cache OR cache > 100 days old. Hard refresh: bypass cache, re-fetch all.
  async function fetchAIGuidance(hardRefresh: boolean) {
    const STALE_MS = 100 * 86_400_000; // 100 days
    const now = Date.now();
    // Resolve current quarter (FY-Indian: Apr-Mar)
    const d = new Date(); const m = d.getMonth(); const y = d.getFullYear();
    const fy = m >= 3 ? y + 1 : y;
    const q = m >= 3 && m <= 5 ? 'Q4' : m >= 6 && m <= 8 ? 'Q1' : m >= 9 && m <= 11 ? 'Q2' : 'Q3';
    const PERIOD = `${q}-FY${String(fy).slice(-2)}`;
    // Only the GOOD-filtered subset (existing goodCompanies var, score >= 60)
    const targets = (typeof goodCompanies !== 'undefined' ? goodCompanies : rows.filter((r: any) => r.score >= 60))
      .map((r: any) => String(r.symbol || '').toUpperCase()).filter(Boolean);
    const needsFetch = hardRefresh ? targets : targets.filter(t => {
      const e = aiGuidanceMap[t]; return !e || (now - (e.fetchedAt || 0)) > STALE_MS;
    });
    if (needsFetch.length === 0) { alert('All Good-filter stocks already have fresh AI Guidance cached (< 100 days). Use Hard Refresh if needed.'); return; }
    if (hardRefresh && !confirm(`Hard Refresh will re-fetch AI Guidance for ${targets.length} stocks (cost ~$${(targets.length * 0.0014).toFixed(2)} of AI (OpenAI) credits). Continue?`)) return;
    setAiGuidanceLoading(true);
    setAiGuidanceProgress({done: 0, total: needsFetch.length, failed: 0, configMissing: false});
    const CHUNK = 5;
    const newMap: Record<string, AiGuidanceEntry> = { ...aiGuidanceMap };
    let done = 0, failed = 0, configMissing = false;
    for (let i = 0; i < needsFetch.length; i += CHUNK) {
      const chunk = needsFetch.slice(i, i + CHUNK).map(t => ({ ticker: t, period: PERIOD }));
      try {
        const r = await fetch('/api/v1/haiku/forward-guidance', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: chunk, force: hardRefresh }),
          signal: AbortSignal.timeout(55_000),
        });
        if (r.status === 503) {
          const body = await r.json().catch(() => ({}));
          if (typeof body?.error === 'string' && /(ANTHROPIC|OPENAI)_API_KEY/i.test(body.error)) {
            configMissing = true; failed += chunk.length; done += chunk.length; setAiGuidanceProgress({done, total: needsFetch.length, failed, configMissing});
            break;
          }
          failed += chunk.length; done += chunk.length;
        } else if (!r.ok) {
          failed += chunk.length; done += chunk.length;
        } else {
          const json = await r.json();
          // PATCH — API returns {results: {TICKER: {label, score, rationale, ...}}} (object map, not array)
          const resultsMap: Record<string, any> = (json && typeof json === 'object' && json.results && typeof json.results === 'object') ? json.results : {};
          Object.entries(resultsMap).forEach(([sym, data]) => {
            if (!data || typeof data !== 'object') return;
            const d: any = data;
            const upperSym = sym.toUpperCase();
            const score = typeof d.score === 'number' ? d.score : 0;
            const label = (d.label || '').toString().toUpperCase();
            let tier: AiGuidanceEntry['tier'] = 'NOGUIDANCE';
            if (label.includes('EXCELLENT') || score >= 0.7) tier = 'EXCELLENT';
            else if (label.includes('POSITIVE') || score >= 0.25) tier = 'POSITIVE';
            else if (label.includes('CAUTIOUS') || score <= -0.25) tier = 'CAUTIOUS';
            else if (label.includes('NEGATIVE') || score <= -0.7) tier = 'NEGATIVE';
            else if (typeof d.score === 'number') tier = 'NEUTRAL';
            // PATCH 1052 — keep the rich Anthropic-response fields so the row
            // expansion can show rationale + quotes + numbers + catalysts.
            const rationale = (d.rationale || d.label || '').toString();
            const quotes: GuidanceQuote[] = Array.isArray(d.quotes)
              ? d.quotes.slice(0, 6).map((q: any) => typeof q === 'string'
                  ? { quote: q.slice(0, 280) }
                  : { quote: String(q?.quote || q?.text || '').slice(0, 280), speaker: q?.speaker ? String(q.speaker).slice(0, 60) : undefined })
                .filter((q: any) => q.quote)
              : [];
            const numbers: GuidanceNumber[] = Array.isArray(d.numbers)
              ? d.numbers.slice(0, 8).map((n: any) => typeof n === 'string'
                  ? { value: n.slice(0, 100) }
                  : { metric: n?.metric ? String(n.metric).slice(0, 60) : undefined, value: n?.value !== undefined ? String(n.value).slice(0, 60) : undefined, period: n?.period ? String(n.period).slice(0, 30) : undefined })
                .filter((n: any) => n.metric || n.value)
              : [];
            const catalysts: GuidanceCatalyst[] = Array.isArray(d.catalysts)
              ? d.catalysts.slice(0, 6).map((c: any) => typeof c === 'string'
                  ? { event: c.slice(0, 140) }
                  : { event: c?.event ? String(c.event).slice(0, 140) : undefined, timing: c?.timing ? String(c.timing).slice(0, 40) : undefined })
                .filter((c: any) => c.event)
              : [];
            const sourceUrl = (typeof d.source_url === 'string' && d.source_url.startsWith('http')) ? d.source_url : undefined;
            newMap[upperSym] = { score, tier, summary: rationale.slice(0, 300), rationale: rationale.slice(0, 2000), quotes, numbers, catalysts, sourceUrl, period: PERIOD, fetchedAt: Date.now() };
          });
          done += chunk.length;
        }
      } catch { failed += chunk.length; done += chunk.length; }
      setAiGuidanceProgress({done, total: needsFetch.length, failed, configMissing});
      setAiGuidanceMap({ ...newMap });
    }
    setAiGuidanceLoading(false);
  }


  // PATCH 0272 — Conviction Beats overlay. Subscribes to the institutional
  // bench so we can mark rows that have already passed the BLOCKBUSTER /
  // STRONG earnings filter on /earnings-opportunities. Cross-tab sync via
  // the storage event + the 'conviction-beats:updated' custom event.
  const [convictionSet, setConvictionSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase())); }
    catch { return new Set(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionSet(new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase()))); }
      catch {}
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);
  // AUDIT_100 #52 — portfolio attribution overlay. When a row is also a
  // holding, render OWN N%/Δ+M% next to the ticker. Cross-tab sync via
  // storage event.
  const [portfolioMap, setPortfolioMap] = useState<Map<string, any>>(() => {
    if (typeof window === 'undefined') return new Map();
    try { return getPortfolioMap(); } catch { return new Map(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { try { setPortfolioMap(getPortfolioMap()); } catch {} };
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('storage', refresh); };
  }, []);
  // Conviction-only filter chip in the toolbar.
  const [convictionOnly, setConvictionOnly] = useState(false);

  const GUIDANCE_POSITIVE = ['raised guidance','guidance upgrade','raised outlook','beats estimates','above estimates','record quarter','record revenue','strong beat','raised earnings','margin expansion','strong growth','upgraded','rerating','guidance raised'];
  const GUIDANCE_NEGATIVE = ['cut guidance','lowered guidance','below estimates','disappointing','warning','cautious','revenue miss','profit miss','guidance cut','margin pressure','revised down','lowered outlook'];

  async function fetchGuidanceScores() {
    if (rows.length === 0) return;
    setGuidanceLoading(true);
    try {
      // For Indian small-caps, earnings coverage in news is sparse.
      // Strategy: fetch ALL recent articles broadly (not type-filtered),
      // try multiple matching approaches, then fall back to trajectory proxy.
      const fetches = await Promise.all([
        fetch(`${API_BASE}/news?limit=500&importance_min=1&article_type=EARNINGS`),
        fetch(`${API_BASE}/news?limit=300&importance_min=1&article_type=CORPORATE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=1&article_type=RATING_CHANGE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=2&article_type=GENERAL`),
        fetch(`${API_BASE}/news?limit=100&importance_min=2&article_type=BOTTLENECK`),
      ]);
      const datas = await Promise.all(fetches.map(r => r.ok ? r.json().catch(()=>[]) : Promise.resolve([])));
      const all = (datas.flat() as NewsArticle[]);
      // Deduplicate by id
      const seen = new Set<string>();
      const articles = all.filter(a => {
        const id = a.id ?? (a.title ?? '') + (a.published_at ?? '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const scores: Record<string, number> = {};
      const counts: Record<string, number> = {};

      // Pre-process articles for fast matching
      const articleTexts = articles.map(a => ({
        a,
        full: ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase(),
        tickers: ((a.ticker_symbols ?? []) as string[]).map((t: string) =>
          t.toUpperCase().replace(/\.NS$|\.BO$|^NSE:|^BSE:/i, '')
        ),
      }));

      for (const stock of rows) {
        const sym = stock.symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');

        // Build company name search tokens — multiple strategies for Indian names
        const companyRaw = (stock.company || '').toLowerCase();
        // Remove noise words
        const cleanCompany = companyRaw
          .replace(/\b(ltd|limited|pvt|private|india|industries|solutions|tech|technologies|systems|services|enterprises|group|engineering|energy|power|chemicals|pharma|pharmaceuticals|finance|capital|holdings|infra|infrastructure)\b/gi, '')
          .replace(/[()]/g, '').trim();
        const companyWords = cleanCompany.split(/\s+/).filter(w => w.length >= 4).slice(0, 2);
        // Also try: first 6 chars of symbol as a text match (e.g. "SKIPPER" in article)
        const symShort = sym.toLowerCase().slice(0, 6);

        // Match strategies (OR logic - any match counts)
        const relevant = articleTexts.filter(({ full, tickers }) => {
          // 1. Ticker match (exact, stripping exchange suffixes)
          if (tickers.some(t => t === sym || t.includes(sym.slice(0,6)))) return true;
          // 2. Symbol text appears in article (e.g. "SKIPPER reported...")
          if (full.includes(sym.toLowerCase()) || (symShort.length >= 4 && full.includes(symShort))) return true;
          // 3. Company name keywords (ALL significant words must appear)
          if (companyWords.length >= 2 && companyWords.every(w => full.includes(w))) return true;
          if (companyWords.length === 1 && companyWords[0].length >= 6 && full.includes(companyWords[0])) return true;
          return false;
        }).map(({ a }) => a);

        counts[sym] = relevant.length;

        if (relevant.length > 0) {
          // Score from actual news articles
          let score = 0.5;
          for (const a of relevant.slice(0, 8)) {
            const text = ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase();
            const isPositive = GUIDANCE_POSITIVE.some(kw => text.includes(kw));
            const isNegative = GUIDANCE_NEGATIVE.some(kw => text.includes(kw));
            if (isPositive && !isNegative)      score = Math.min(1.0, score + 0.15);
            else if (isNegative && !isPositive) score = Math.max(0.0, score - 0.15);
            else if (isPositive && isNegative)  score = Math.min(0.75, score + 0.04);
          }
          scores[sym] = Math.round(score * 10) / 10;
        } else {
          // NO NEWS FOUND — use earnings trajectory as proxy for ALL stocks.
          // For Indian small-caps there is often zero press coverage; the trajectory
          // from quarterly numbers IS the forward signal. Score capped at 0.65.
          // Key fix: STABLE = 0.50 (neutral, not "no data"). ACCELERATING = ≥0.55
          // even when delta is small, because accelSignal itself is meaningful.
          const revAccel  = stock.revenueAcceleration;
          const profAccel = stock.profitAcceleration;
          const trajectory = (revAccel ?? 0) + (profAccel ?? 0);
          const accel = stock.accelSignal;
          const hasMetrics = revAccel !== undefined || profAccel !== undefined ||
                             stock.revCagr !== undefined || stock.profitCagr !== undefined;

          if (accel === 'ACCELERATING') {
            // ACCELERATING signal is meaningful by itself — trajectory shows magnitude
            if (trajectory > 60)      scores[sym] = 0.65;
            else if (trajectory > 30) scores[sym] = 0.60;
            else if (trajectory > 10) scores[sym] = 0.57;
            else                      scores[sym] = 0.55; // low-delta ACCELERATING still positive
          } else if (accel === 'STABLE') {
            // STABLE = performing as expected, no upgrade/downgrade signal
            // Show 0.50 (neutral) NOT -1 — "no surprise" IS information
            scores[sym] = 0.50;
          } else if (accel === 'DECELERATING') {
            if (trajectory < -40)      scores[sym] = 0.25;
            else if (trajectory < -20) scores[sym] = 0.35;
            else                       scores[sym] = 0.40;
          } else if (hasMetrics) {
            // accelSignal undefined (e.g. missing YOY data) but some metrics exist
            scores[sym] = 0.50; // neutral default
          } else {
            scores[sym] = -1;   // truly no information at all
          }
          counts[sym] = 0; // mark as proxy (no actual articles)
        }
      }

      setGuidanceScores(scores);
      setGuidanceArticleCounts(counts);
    } catch (e) {
      console.error('Guidance fetch failed:', e);
    }
    setGuidanceLoading(false);
  }

  function guidanceBonus(sym: string): number {
    const g = guidanceScores[sym];
    if (g === undefined || g === -1) return 0; // no data = no adjustment
    if (g >= 0.85) return 14;  // multiple raises / strong guidance upgrade
    if (g >= 0.70) return 8;   // single raise or beat
    if (g >= 0.55) return 3;   // mildly positive
    if (g <= 0.15) return -14; // multiple cuts or misses
    if (g <= 0.30) return -8;  // guidance cut or miss
    if (g <= 0.45) return -3;  // mildly negative
    return 0; // neutral (0.5)
  }

  function applyGuidance(r: ExcelResult): ExcelResult & { guidanceScore?: number; guidanceAdj?: number } {
    if (!guidanceMode || Object.keys(guidanceScores).length === 0) return r;
    const gs = guidanceScores[r.symbol];
    // -1 = no data found, don't adjust score
    if (gs === -1) return { ...r, guidanceScore: -1, guidanceAdj: 0 };
    const adj = guidanceBonus(r.symbol);
    let newScore = Math.max(0, Math.min(100, r.score + adj));

    // Re-apply quality and valuation caps — guidance cannot bypass these hard limits.
    // A company with poor cash flow or overvalued vs intrinsic value should not
    // jump past its quality-capped ceiling even with great earnings news.
    const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
    const hasQualWeakness = (r.cfoToPat !== undefined && r.cfoToPat < 0.6) ||
                            (r.opm !== undefined && r.opm < b2.opm[0]) ||
                            (r.roce !== undefined && r.roce < 15);
    if (hasQualWeakness)                              newScore = Math.min(newScore, 85);
    if ((r.cfoToPat ?? 1) < 0.5)                     newScore = Math.min(newScore, 80);
    if ((r.marginOfSafety ?? 0) < -50)               newScore = Math.min(newScore, 80);
    else if ((r.marginOfSafety ?? 0) < -30)          newScore = Math.min(newScore, 90);

    // PATCH 0336 — Re-apply red-flag structural/cyclical caps after guidance.
    // Without this, a +3 guidance bonus could push a "1 HIGH structural · cap 60"
    // stock to 63, contradicting the audit-panel claim that the cap was binding.
    // Visible symptom (post-0335 deployment): Tips Music score=63 with audit
    // "Active cap: 60 (binding)"; Skipper score=51 with audit "Active cap: 48
    // (binding)". The audit count is correct; the score evaluation also caps
    // correctly inside computeOne(), but applyGuidance() runs afterward and
    // bypasses the structural/cyclical caps. Re-apply them here.
    const critG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const structHighG = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
    const cycHighG    = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
    if (critG)                       newScore = Math.min(newScore, 38);
    else if (structHighG >= 2)       newScore = Math.min(newScore, 48);
    else if (structHighG >= 1)       newScore = Math.min(newScore, 60);
    else if (cycHighG >= 2)          newScore = Math.min(newScore, 62);
    else if (cycHighG >= 1)          newScore = Math.min(newScore, 72);
    // Re-apply governance watch cap (Patch 0313)
    if ((r as any).governanceWatch)  newScore = Math.min(newScore, 65);
    // Re-apply decelerating + monitor bucket caps
    if (r.accelSignal === 'DECELERATING') newScore = Math.min(newScore, 52);
    if (r.bucket === 'MONITOR')           newScore = Math.min(newScore, 45);

    // PATCH 0337 — Mirror the new op-lev <1.0 and cyclical-peak caps so
    // guidance bonus can't slip an A-grade past them.
    if (r.recentOpLev !== undefined && r.recentOpLev < 1.0
        && (r.yoySalesGrowth ?? 0) > 15) {
      newScore = Math.min(newScore, 75);
    }
    const b2cyc = (r.sector || '').match(/METAL|CHEMICAL|TEXTILE|OIL|SHIPPING|CEMENT|TIRE|RUBBER|PAPER/i) !== null;
    if (b2cyc && r.opm !== undefined && (b2.opm?.[2] ?? 0) > 0
        && r.opm > b2.opm[2] * 1.5
        && (r.profitCagr ?? 0) > 40
        && !(r as any).isCyclicRecovery) {
      newScore = Math.min(newScore, 80);
    }

    // Re-apply A+ gate — guidance articles cannot grant A+ if quality gates fail
    if (newScore >= 90) {
      const passGate = (r.cfoToPat ?? 0) > 1.0 && (r.roce ?? 0) > 20 &&
                       (r.fcfAbsolute ?? -1) > 0 && (r.promoter ?? 0) > 50;
      if (!passGate) newScore = Math.min(newScore, 89);
    }

    let newGrade: Grade = newScore>=90?'A+':newScore>=80?'A':newScore>=68?'B+':newScore>=55?'B':newScore>=42?'C':'D';

    // ── GUIDANCE TIER PROMOTION ───────────────────────────────────────────────
    // Guidance upgrades can move stocks 10–30% in weeks (market behavior).
    // Binary trigger: if guidance strongly positive AND stock is accelerating →
    // promote one full grade tier. This is the "forward visibility" premium.
    const guidanceScore = guidanceScores[r.symbol];
    const GRADE_UP_MAP: Record<Grade, Grade> = {'D':'C','C':'B','B':'B+','B+':'A','A':'A+','A+':'A+','NR':'NR'};
    const GRADE_DOWN_MAP: Record<Grade, Grade> = {'A+':'A','A':'B+','B+':'B','B':'C','C':'D','D':'D','NR':'NR'};

    if (guidanceScore !== undefined && guidanceScore !== -1) {
      if (guidanceScore >= 0.7 && r.accelSignal === 'ACCELERATING') {
        newGrade = GRADE_UP_MAP[newGrade] as Grade;
      } else if (guidanceScore <= 0.3 && r.accelSignal === 'DECELERATING') {
        newGrade = GRADE_DOWN_MAP[newGrade] as Grade;
      }
    }
    // Consistency gate: guidance promotion cannot create A+ if stock has flags
    const hasCritForG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const highCntForG = r.redFlags.filter(f => f.severity === 'HIGH').length;
    if (hasCritForG && (newGrade === 'A+' || newGrade === 'A')) newGrade = 'B+';
    if (highCntForG >= 2 && newGrade === 'A+') newGrade = 'A';

    return { ...r, score: newScore, grade: newGrade, guidanceScore: guidanceScores[r.symbol], guidanceAdj: adj };
  }

  const fileRef = useRef<HTMLInputElement>(null);

  // ── PATCH 1101qqq — AUTO-SYNC FROM screener.in via GitHub Action ──────────
  // Loads 12 screen CSVs from /data/screener/ (committed daily by the
  // workflow) and runs them through handleFiles(). One-shot on mount when
  // storage is empty + always-available manual refresh button.
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  useEffect(() => { getSyncStatus().then(setSyncStatus); }, []);
  // PATCH 1101zzz40 — track the server lastSync timestamp the user has
  // already absorbed. Lets us auto-refresh existing IDB state when the
  // GitHub Action commits a newer manifest, instead of leaving users stuck
  // on weeks-old snapshots until they remember to click "🔄 Refresh now".
  // PATCH 1101zzz42 — bumped v1 → v2 to invalidate stamps written by
  // zzz40's silent-stamp branch. v1 stampers never actually pulled, so
  // every subsequent visit thought "already up to date". v2 ensures
  // first-load after this deploy sees seenIso === null → triggers pull.
  const LAST_SYNC_SEEN_KEY = 'mb_india_last_sync_seen_v2';
  const runAutoSync = useCallback(async (force = false) => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      const files = await fetchCsvsAsFiles(SYNC_ROUTING.multibaggerIndia);
      if (files.length === 0) {
        setParseError('Auto-sync failed: no CSVs in /data/screener/. Run the GitHub Action first.');
        return;
      }
      // zzz479 — also pull the India Multibagger screeners that live on TradingView
      // (they sync to /data/tradingview/ like USA Multibagger does) and MERGE them
      // into the same India pool. Best-effort + additive: if they haven't synced yet
      // the screener.in pool still loads exactly as before, and handleFiles never
      // replaces an existing screener.in row — it only adds new tickers.
      let allFiles: File[] = files;
      try {
        const tvFiles = await fetchTradingviewCsvsAsFiles(SYNC_ROUTING.multibaggerIndiaTV);
        if (tvFiles.length) allFiles = [...files, ...tvFiles];
      } catch { /* TV screeners not synced yet — India pool still loads */ }
      await handleFiles(allFiles);
      markAutoLoaded('multibagger-india');
      // Stamp the lastSync timestamp the user just absorbed so the
      // freshness check below doesn't re-fire on every navigation.
      const fresh = await getSyncStatus();
      setSyncStatus(fresh);
      try {
        if (fresh?.lastSync) {
          localStorage.setItem(LAST_SYNC_SEEN_KEY, fresh.lastSync);
        }
      } catch {}
    } finally {
      setSyncLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncLoading]);
  // First-mount: if nothing's been loaded yet AND we haven't auto-loaded
  // before, pull from sync. Skips when user has manually uploaded already.
  useEffect(() => {
    if (rows.length > 0) return;
    if (!shouldAutoLoad('multibagger-india')) return;
    // Wait 1.5s so the parent's IDB hydration has time to finish first.
    const t = setTimeout(() => {
      if (rows.length === 0 && shouldAutoLoad('multibagger-india')) {
        runAutoSync(false);
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  // PATCH 1101zzz40 — freshness check. If the user already has rows but the
  // server manifest's lastSync is newer than what they've absorbed, pull the
  // diff automatically. handleFiles MERGES (existingSymbols dedup), so this
  // is non-destructive: existing tickers stay, new tickers join. Wait 2s
  // after mount to avoid racing the IDB hydration and the initial sync
  // status fetch.
  // PATCH 1101zzz41 — when seenIso is null (first encounter with this
  // patch), DO trigger a pull. Stamping silently meant established users
  // never auto-received the daily diff. Pull is non-destructive.
  useEffect(() => {
    if (!syncStatus?.lastSync) return;
    if (syncLoading) return;
    if (rows.length === 0) return;  // first-mount path handles this
    let seenIso: string | null = null;
    try { seenIso = localStorage.getItem(LAST_SYNC_SEEN_KEY); } catch {}
    const serverMs = new Date(syncStatus.lastSync).getTime();
    if (!Number.isFinite(serverMs)) return;
    if (seenIso) {
      const seenMs = new Date(seenIso).getTime();
      if (Number.isFinite(seenMs) && serverMs <= seenMs) return;  // already up to date
    }
    // Either no seen-stamp yet (first encounter) OR server is newer than what
    // we last absorbed → pull. handleFiles dedupes, so safe.
    const t = setTimeout(() => { runAutoSync(true); }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus?.lastSync, rows.length]);

  // ── SORTABLE COLUMNS ──────────────────────────────────────────────────────
  type IndiaSort = 'score'|'pe'|'peg'|'roce'|'revCagr'|'profitCagr'|'marketCapCr'|'revenueAcceleration'|'opm'|'cfoToPat';
  const [sortField, setSortField] = useState<IndiaSort>('score');
  const [sortAsc,   setSortAsc]   = useState(false);
  function handleSort(field: IndiaSort) {
    if (sortField === field) { setSortAsc(v => !v); return; }
    // Default direction: ascending is "better" for PE/PEG/MCap (lower = better); descending for everything else
    setSortField(field);
    setSortAsc(['pe','peg','marketCapCr'].includes(field));
  }
  // Sort indicator helper
  const sortIcon = (f: IndiaSort) => sortField===f ? (sortAsc?' ▲':' ▼') : '';

  // ── SCORE CHANGE (vs prev upload baseline) ────────────────────────────────
  const PREV_SCORES_KEY = 'mb_india_prev_scores_v1';
  const prevScoreMap = useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(PREV_SCORES_KEY)||'{}'); } catch { return {}; }
  }, []); // read once on mount

  async function parseSingleFile(file:File, XLSX: typeof import('xlsx')) {
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    return XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
  }

  async function handleFiles(files:FileList|File[]) {
    const arr=Array.from(files);
    setLoading(true); setParseError('');
    // PATCH 0872 — Save PRE-upload score baseline FIRST so the next analytics
    // render can compute genuine score deltas. Previously this was saved
    // AFTER scoring (line ~1039 pre-0872), which meant PREV always equalled
    // CURRENT and every delta-driven panel (RE-RATING, DROP ALERTS,
    // "new since last upload", sector rotation) was permanently zeroed.
    try { localStorage.setItem(PREV_SCORES_KEY, JSON.stringify(Object.fromEntries(rows.map(r=>[r.symbol,r.score])))); } catch {}
    try {
      const XLSX=await import('xlsx');
      // Start with existing rows — new uploads MERGE in, never replace
      const existingSymbols = new Set(rows.map(r => r.symbol));
      const newRows: ExcelRow[] = [];
      const seenNew = new Set<string>();

      // PATCH 0347 — Cross-market detection on India upload (peek first file)
      if (arr.length > 0) {
        const peekBuf = await arr[0].arrayBuffer();
        const peekWb = XLSX.read(peekBuf, { type:'array' });
        const peekRaw = XLSX.utils.sheet_to_json<Record<string,unknown>>(peekWb.Sheets[peekWb.SheetNames[0]], { defval:'' });
        if (peekRaw.length > 0) {
          const headers = Object.keys(peekRaw[0]);
          const detected = detectCsvMarket(headers);
          if (detected === 'US') {
            const proceed = window.confirm(
              `⚠️ This CSV looks like a USA TradingView export (found USA-specific columns like Forward non-GAAP P/E, Piotroski F-score, Altman Z-score).\n\nYou're currently on the India tab.\n\nClick OK to switch to USA Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
            );
            if (proceed) {
              window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'usa' } }));
              setLoading(false);
              return;
            }
          }
        }
      }

      // PATCH 0987 — track per-file screener membership.
      // Same ticker in multiple files now collects ALL file names instead of
      // being deduped to the first appearance. Stocks in 2+ files surface in
      // a new "🎯 MULTI-CONFIRMED" card in Analytics.
      const _screenerMap = new Map<string, string[]>();
      const _newRowByTicker = new Map<string, ExcelRow>();
      // PATCH 1101zzz39 — diagnostic counters so the upload toast reveals
      // whether rows are silently disappearing (parser reject, no-symbol skip,
      // or dedup drop). Previously the toast only said "+N new" which hid
      // every silent loss.
      let _diagParsed = 0;
      let _diagSkippedNullRow = 0;
      let _diagSkippedDup = 0;
      let _diagFreshIpo = 0;
      for (const file of arr) {
        const raw = await parseSingleFile(file, XLSX);
        if (!raw.length) continue;
        const cm = buildColMap(raw[0] as Record<string, unknown>);
        if (!cm['symbol']) continue;
        for (const r of raw) {
          _diagParsed++;
          const row = rawRowToExcelRow(r as Record<string, unknown>, cm);
          if (!row) { _diagSkippedNullRow++; continue; }
          // PATCH 1101zzz39 — tag fresh IPOs (no 1-yr return → IPO age <1y).
          // Lets analytics/scoring give a neutral technical pillar instead
          // of penalising as "no momentum data."
          const rawRow = r as Record<string, unknown>;
          const ret1y = rawRow['Return over 1year'] ?? rawRow['1Yr return %'] ?? rawRow['Return over 1 year'];
          if (ret1y === undefined || ret1y === null || String(ret1y).trim() === '') {
            (row as any)._freshIpo = true;
            _diagFreshIpo++;
          }
          // Always record screener membership (even for tickers we already have)
          const prev = _screenerMap.get(row.symbol) || [];
          if (!prev.includes(file.name)) prev.push(file.name);
          _screenerMap.set(row.symbol, prev);
          // Collect row data only if it's truly new
          if (!existingSymbols.has(row.symbol) && !_newRowByTicker.has(row.symbol)) {
            _newRowByTicker.set(row.symbol, row);
          } else {
            _diagSkippedDup++;
          }
        }
      }
      // Attach diagnostics to the post-load toast so user can see drop counts.
      const _diagSummary = `· ${_diagParsed} parsed · ${_diagSkippedNullRow} rejected · ${_diagSkippedDup} duplicates${_diagFreshIpo > 0 ? ` · ${_diagFreshIpo} fresh IPOs` : ''}`;
      for (const sym of _newRowByTicker.keys()) seenNew.add(sym);
      newRows.push(..._newRowByTicker.values());

      if(!newRows.length && rows.length > 0) {
        // PATCH 1043 — even when no NEW tickers, a re-upload must flush
        // screener-membership onto existing rows so 🎯 MULTI-CONFIRMED card populates.
        const rowsWithUpdatedScreeners = rows.map(r => {
          const newSources = _screenerMap.get(r.symbol);
          if (!newSources || newSources.length === 0) return r;
          const existing = (r as ExcelResult & { _screeners?: string[] })._screeners || [];
          const mergedScr = Array.from(new Set([...existing, ...newSources]));
          return { ...r, _screeners: mergedScr } as ExcelResult;
        });
        const reranked = applyForcedRanking([...rowsWithUpdatedScreeners].sort((a, b) => b.score - a.score));
        // PATCH 1090 — REGRESSION FIX: was `setExcelRows(reranked)` which is
        // the PARENT scope's setter (defined inside MultibaggerPage). Inside
        // ExcelCompare the prop is named `setRows` — calling the parent name
        // here is a ReferenceError that silently crashed every same-file
        // re-upload since PATCH 1043. That's the "Saved data lost (N stocks)"
        // banner staying visible even after the user re-uploaded.
        setRows(reranked);
        try {
          const existingFiles: string[] = JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]');
          const mergedFiles = Array.from(new Set([...existingFiles, ...arr.map(f => f.name)]));
          localStorage.setItem('mb_excel_files_v1', JSON.stringify(mergedFiles));
          window.dispatchEvent(new CustomEvent('mb-files:updated'));
        } catch {}
        const updatedCount = rowsWithUpdatedScreeners.filter((r, i) => r !== rows[i]).length;
        setFileName(`Screener membership refreshed on ${updatedCount} existing stocks · ${rows.length} total`);
        setLoading(false); return;
      }
      if(!newRows.length) {
        setParseError('No valid rows found. Ensure files have NSE Code column.');
        setLoading(false); return;
      }

      // Score new rows and merge with existing
      const newScored = newRows.map(r => {
        const scored = scoreExcelRow(r);
        // PATCH 0987 — attach screener membership recorded above
        const sc = _screenerMap.get(r.symbol) || [];
        return { ...scored, _screeners: sc };
      });
      // PATCH 0987 — also append new screener memberships onto existing rows
      // (a stock already in dataset that appears in a new screener should grow
      //  its membership, not stay frozen).
      const rowsWithUpdatedScreeners = rows.map(r => {
        const newSources = _screenerMap.get(r.symbol);
        if (!newSources || newSources.length === 0) return r;
        const existing = (r as ExcelResult & { _screeners?: string[] })._screeners || [];
        const merged = Array.from(new Set([...existing, ...newSources]));
        return { ...r, _screeners: merged };
      });
      const merged = [...rowsWithUpdatedScreeners, ...newScored].sort((a, b) => b.score - a.score);
      const allScored = applyForcedRanking(merged);
      setRows(allScored);
      // PATCH 0872 — Pre-upload baseline now captured at the TOP of this
      // function (saving current scores here turned PREV==CURRENT and broke
      // every score-delta indicator). Intentional no-op write here so the
      // old call site stays grep-able for future devs.

      const addedCount = newRows.length;
      const totalCount = allScored.length;
      setFileName(rows.length > 0
        ? `+${addedCount} new stocks added · ${totalCount} total ${_diagSummary}`
        : `${arr.length} file${arr.length>1?'s':''} · ${totalCount} stocks ${_diagSummary}`
      );
      // PATCH 0984 — persist Screener CSV names so MultibaggerAnalytics
      // can show a compact "N screeners · name1 · name2 · …" chip row.
      try {
        const existing: string[] = JSON.parse(localStorage.getItem('mb_excel_files_v1') || '[]');
        const newNames = arr.map(f => f.name);
        const merged = Array.from(new Set([...existing, ...newNames]));
        localStorage.setItem('mb_excel_files_v1', JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('mb-files:updated'));
      } catch {}
    } catch(e:unknown){setParseError(`Error: ${e instanceof Error?e.message:String(e)}`);}
    setLoading(false);
  }

  const GRADES:Grade[]=['A+','A','B+','B','C','D'];
  // "Good companies only" = passes all hard survival criteria
  // PATCH 1101d — null-safe optional chaining so a Screener CSV row missing
  // the decisionStrip fields can't crash the filter (silent crash → mystery 0).
  const goodCompanies = rows.filter(r =>
    (r.decisionStrip?.survival?.pass ?? false) &&
    r.accelSignal !== 'DECELERATING' &&
    r.bucket !== 'MONITOR' &&
    r.score >= 60
  );

  // Apply all active filters in order
  let baseRows = goodOnly ? goodCompanies : rows;
  if (bucketFilter !== 'ALL') baseRows = baseRows.filter(r => r.bucket === bucketFilter);
  // PATCH 1050 — AI tier filter (uses cached aiGuidanceMap)
  if (aiTierFilter !== 'ALL') {
    baseRows = baseRows.filter(r => aiGuidanceMap[(r.symbol || '').toUpperCase()]?.tier === aiTierFilter);
  }
  // PATCH 1046 — fraud risk filter
  if (fraudFilter !== 'ALL') {
    baseRows = baseRows.filter(r => {
      const fraudFlags = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:'));
      const hasCrit = fraudFlags.some(f => f.severity === 'CRITICAL');
      const hasHigh = fraudFlags.some(f => f.severity === 'HIGH');
      if (fraudFilter === 'CLEAN')    return fraudFlags.length === 0;
      if (fraudFilter === 'CRITICAL') return hasCrit;
      if (fraudFilter === 'HIGH')     return hasHigh && !hasCrit;
      if (fraudFilter === 'ANY')      return fraudFlags.length > 0;
      return true;
    });
  }
  // PATCH 0127 — sector filter: institutional users want to compare within
  // sector (e.g. all Defence stocks ranked together, not all 84 mixed).
  if (sectorFilter !== 'ALL') baseRows = baseRows.filter(r => r.sector === sectorFilter);
  if (accelOnly)      baseRows = baseRows.filter(r => r.decisionStrip.acceleration.pass);
  if (fcfOnly)        baseRows = baseRows.filter(r => (r.fcfAbsolute ?? -1) > 0 || (r.cfoToPat ?? 0) >= 0.8);
  if (discoveryOnly)   baseRows = baseRows.filter(r => (r.fiiPlusDii ?? 100) < 15);
  // PATCH 1052 — 50/200 DMA confirmed-uptrend filter. Requires aboveDMA200 > 0
  // (price above 200 DMA) AND short-term momentum positive (return1m > -3%) as
  // a proxy for "price above 50 DMA" since most Screener CSV exports only carry
  // 200 DMA. When applied, narrows the list to stocks in confirmed long-term
  // and short-term uptrends — the institutional "trend is your friend" preset.
  // PATCH 1060 — Use actual aboveDMA50 when CSV has it; fall back to
  // pctFrom52wHigh > -15 as proxy when 50DMA is missing; relax return1m
  // requirement (most Screener CSVs ship "Return over 1year" not 1month).
  if (dmaConfirmedOnly) baseRows = baseRows.filter(r => {
    const above200 = (r.aboveDMA200 ?? -100) > 0;
    const above50  = (r as any).aboveDMA50 !== undefined ? ((r as any).aboveDMA50 > 0) : ((r.pctFrom52wHigh ?? -100) > -15);
    return above200 && above50;
  });
  if (inflectionOnly)  baseRows = baseRows.filter(r => r.inflectionSignal || r.triggerBonus >= 10);
  // PATCH 0272 — Conviction-only filter. When ON, narrows the universe to
  // tickers already on the Conviction Beats bench (synced from /earnings-opportunities).
  if (convictionOnly) baseRows = baseRows.filter(r => convictionSet.has((r.symbol || '').toUpperCase()));
  // P/E and PEG filters — only apply when data is available for a stock
  if (peMax  !== 'ALL') baseRows = baseRows.filter(r => r.pe  !== undefined && r.pe  > 0 && r.pe  <= peMax);
  if (pegMax !== 'ALL') baseRows = baseRows.filter(r => r.peg !== undefined && r.peg > 0 && r.peg <= pegMax);
  // PATCH 0345 — India institutional-quality composite filters (AND-style).
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of USA Rule of 40.
  if (indQualityMin !== 'ALL') baseRows = baseRows.filter(r => {
    const score = (r.roce ?? 0) + (r.profitCagr ?? 0);
    return score >= indQualityMin;
  });
  if (indRoceMin !== 'ALL') baseRows = baseRows.filter(r => (r.roce ?? 0) >= indRoceMin);
  if (indCfoMin !== 'ALL')  baseRows = baseRows.filter(r => (r.cfoToPat ?? 0) >= indCfoMin);
  // PATCH 0347 — decision filter
  if (indDecisionFilter !== 'ALL') {
    baseRows = baseRows.filter(r => {
      const d = getDecision(r.symbol);
      if (indDecisionFilter === 'WITH') return !!d;
      if (indDecisionFilter === 'NONE') return !d;
      return d?.status === indDecisionFilter;
    });
  }
  // Guidance tier filter — only meaningful when guidance mode is ON
  if (guidanceTier !== 'ALL' && guidanceMode) {
    baseRows = baseRows.filter(r => {
      const gs = guidanceScores[r.symbol];
      if (gs === undefined || gs === -1) return false;
      if (guidanceTier === 'STRONG')  return gs >= 0.70;
      if (guidanceTier === 'POS')     return gs >= 0.55 && gs < 0.70;
      if (guidanceTier === 'NEUTRAL') return gs > 0.45 && gs < 0.55;
      if (guidanceTier === 'NEG')     return gs > 0.30 && gs <= 0.45;
      if (guidanceTier === 'WEAK')    return gs <= 0.30;
      return true;
    });
  }
  const baseFiltered = gradeFilter.has('ALL') ? baseRows : baseRows.filter(r => gradeFilter.has(r.grade));
  // Apply guidance re-scoring when active
  const guidanceApplied = guidanceMode && Object.keys(guidanceScores).length > 0
    ? [...baseFiltered.map(r => applyGuidance(r))] : baseFiltered;
  // Apply sortable column sort (default: score descending — same as before)
  const sortedFiltered = [...guidanceApplied].sort((a, b) => {
    const getV = (r: ExcelResult): number => {
      switch(sortField) {
        case 'pe':                  return r.pe ?? (sortAsc ? 999 : -1);
        case 'peg':                 return r.peg ?? (sortAsc ? 999 : -1);
        // zzz378 — missing values must sink to the BOTTOM in BOTH directions
        // (== ascending ? +BIG : -BIG). The old hi-good sentinels were inverted, so
        // rows with no ROCE/OPM/CFO-PAT/CAGR floated to the TOP of a descending sort.
        case 'roce':                return r.roce ?? (sortAsc ? 1e9 : -1e9);
        case 'revCagr':             return r.revCagr ?? (sortAsc ? 1e9 : -1e9);
        case 'profitCagr':          return r.profitCagr ?? (sortAsc ? 1e9 : -1e9);
        case 'marketCapCr':         return r.marketCapCr ?? (sortAsc ? 1e9 : -1e9);
        case 'revenueAcceleration': return r.revenueAcceleration ?? (sortAsc ? 1e9 : -1e9);
        case 'opm':                 return r.opm ?? (sortAsc ? 1e9 : -1e9);
        case 'cfoToPat':            return r.cfoToPat ?? (sortAsc ? 1e9 : -1e9);
        default:                    return r.score; // 'score'
      }
    };
    const av = getV(a), bv = getV(b);
    return sortAsc ? av - bv : bv - av;
  });
  // zzz175 India Multibagger tracker
  const indAllSymbols = React.useMemo(() => rows.map(r => r.symbol).filter(Boolean), [rows]);
  const { newTickerSet: indNewSet, ackSet: indAckSet, toggleAck: toggleIndAck } = useNewTracker('in-mb', indAllSymbols);
  const [showOnlyNewInd, setShowOnlyNewInd] = React.useState(false);
  const filtered = showOnlyNewInd ? sortedFiltered.filter(r => indNewSet.has(r.symbol)) : sortedFiltered;
  const topPicks = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');

  const METRICS: [keyof ExcelRow, string, string][] = [
    ['roce','ROCE %','Quality'],['roe','ROE %','Quality'],['opm','OPM %','Quality'],
    ['cfoToPat','CFO/PAT x','Quality'],['fcfAbsolute','FCF ₹Cr','Quality'],
    ['revCagr','Sales CAGR %','Growth'],['profitCagr','Profit CAGR %','Growth'],
    ['opLeverageRatio','Op Leverage x','Growth'],
    ['yoySalesGrowth','YOY Sales %','Growth'],['yoyProfitGrowth','YOY Profit %','Growth'],
    ['revenueAcceleration','Rev Accel pp','Recent'],['profitAcceleration','Profit Accel pp','Recent'],
    ['recentOpLev','Recent Op Lev x','Recent'],
    ['epsGrowth','EPS Growth %','Growth'],
    ['de','D/E x','Fin Str'],['netDebtEbitda','ND/EBITDA x','Fin Str'],
    ['promoter','Promoter %','Fin Str'],['pledge','Pledge %','Fin Str'],
    ['changeInPromoter','Δ Promoter %','Fin Str'],['icr','ICR x','Fin Str'],
    ['pe','P/E x','Valuation'],['peg','PEG','Valuation'],['pb','P/B x','Valuation'],
    ['marketCapCr','MCap ₹Cr','Valuation'],['marginOfSafety','MoS %','Valuation'],
    ['fiiPlusDii','FII+DII %','SQGLP-S'],['fii','FII %','SQGLP-S'],['dii','DII %','SQGLP-S'],
    ['aboveDMA200','vs DMA200 %','Market'],['return1m','Ret 1M %','Market'],
    ['pctFrom52wHigh','vs 52W High %','Market'],
    ['evEbitda','EV/EBITDA x','Valuation'],['fcfYield','FCF Yield %','Valuation'],
    ['roceExpansion','ROCE Δ 3yr pp','Quality'],['opmExpansion','OPM Δ 3yr pp','Quality'],
    ['gpm','GPM %','Quality'],['roic','ROIC %','Quality'],
  ];

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {/* PATCH 1054 — Compact header. Replaces the 14-card "extra columns"
          grid (read like onboarding marketing) with a single dense status
          strip + one-line CSV hint. Institutional-style: information density
          over decorative cards. */}
      <div style={{marginBottom:16,padding:'10px 14px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,display:'flex',alignItems:'baseline',gap:14,flexWrap:'wrap',fontVariantNumeric:'tabular-nums'}}>
        <span style={{fontSize:F.sm,fontWeight:800,color:PURPLE,letterSpacing:0.3}}>MULTIBAGGER ENGINE</span>
        <span style={{fontSize:F.xs,color:MUTED}}>SQGLP · Fisher 100-Bagger · Framework · auto-merge dedup</span>
        {rows.length > 0 && (
          <span style={{fontSize:F.xs,fontWeight:700,color:GREEN,letterSpacing:0.3}}>{rows.length} stocks loaded</span>
        )}
        <details style={{marginLeft:'auto',fontSize:F.xs,color:MUTED,cursor:'pointer'}}>
          <summary style={{listStyle:'none',color:'var(--mc-cyan)'}}>+ Optional CSV columns for full scoring</summary>
          <div style={{marginTop:6,paddingTop:6,borderTop:`1px dashed ${BORDER}`,maxWidth:720,lineHeight:1.55,fontSize:9,color:MUTED}}>
            <strong style={{color:TEXT}}>Quality:</strong> Gross profit margin · Return on invested capital · OPM last year
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Cash:</strong> Free Cash Flow · FCF Yield · Net Debt · EBITDA · EV/EBITDA
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Ownership:</strong> FII Holding · DII Holding · Change in promoter holding
            &nbsp;·&nbsp;<strong style={{color:TEXT}}>Trend:</strong> EPS growth · From 52W High · High price
          </div>
        </details>
      </div>

      {/* PATCH 1083 — orphan-meta warning banner. PATCH 1090 — also gate
          on rows.length === 0; once IDB rehydration or re-upload populates
          rows, the banner becomes stale and shouldn't keep firing. */}
      {orphanMetaCount > 0 && rows.length === 0 && (
        <div style={{marginBottom:14,padding:'14px 18px',backgroundColor:`color-mix(in srgb, ${RED} 12%, transparent)`,border:`1px solid ${RED}88`,borderLeft:`4px solid ${RED}`,borderRadius:8,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontSize:18}}>⚠</div>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:F.sm,fontWeight:800,color:RED}}>Saved data lost ({orphanMetaCount} stocks)</div>
            <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5,marginTop:4}}>
              Browser localStorage was wiped (5 MB cap reached after other uploads). The metadata
              survived but the actual stock data is gone. Re-upload your Excel file once — future
              uploads also write to IndexedDB which doesn&apos;t have the 5 MB limit, so they will
              persist permanently.
            </div>
          </div>
          <button onClick={() => { try { localStorage.removeItem(STORAGE_META); } catch {} setFileName(''); setOrphanMetaCount(0); }}
            style={{padding:'6px 14px',backgroundColor:'transparent',border:`1px solid ${RED}88`,borderRadius:6,color:RED,fontSize:F.xs,fontWeight:700,cursor:'pointer'}}>
            Dismiss
          </button>
        </div>
      )}

      {/* PATCH 1101m — Cloud save status badge. Visible at all times so the
          user can SEE whether their data has been backed up to Railway
          Postgres (the third persistence layer that survives browser
          eviction). Includes a manual "Backup now" button as an escape
          valve if the auto-save ever fails. */}
      <CloudSaveStatusBadge rows={rows} />


      {/* zzz214 — score movers since the previous upload/refresh */}
      <ScoreMoversStrip rows={rows} prevKey="mb_india_prev_scores_v1" />
      {/* THESIS DRIFT — current re-score vs Decision Logbook (REOPEN / BREAK) */}
      <ThesisDriftStrip rows={rows} />

      {/* PATCH 1101qqq — Auto-sync status chip + manual refresh button.
          Shows last-sync date, lets user pull fresh CSVs without leaving tab. */}
      {syncStatus && syncStatus.hasManifest && (() => {
        // zzz409 — the banner used to collapse two very different states into a
        // single red "STALE": (a) the background screener.in auto-sync PIPELINE
        // failed to fetch anything (ok=0, fail>0 — almost always an expired
        // SCREENER_SESSION cookie), which shows a contradictory "0h ago · STALE",
        // and (b) the pre-baked screens are genuinely old (>36h). Neither has
        // anything to do with a CSV the user uploaded by hand — that data is
        // always fresh. Split the copy so the message is accurate and actionable.
        const broken = syncStatus.syncBroken;                 // auth/pipeline failure
        const staleByAge = !broken && (syncStatus.hoursOld ?? 0) > 36;
        const accent = broken ? ORANGE : staleByAge ? RED : PURPLE;
        const lastRun = syncStatus.lastSync?.toLocaleString();
        const hrs = syncStatus.hoursOld != null ? Math.round(syncStatus.hoursOld) : '?';
        return (
        <div style={{marginBottom:8,padding:'6px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',backgroundColor:`${accent}10`,border:`1px solid ${accent}30`,borderRadius:8}}>
          <span style={{fontSize:F.xs,color:(broken||staleByAge)?accent:MUTED}}>
            {broken
              ? <>⚠ screener.in auto-sync couldn't refresh — last attempt {lastRun} fetched <b>0 of {syncStatus.failCount}</b> screens (screener.in session likely expired). <b>Any CSV you uploaded is unaffected</b>; the built-in screens are serving the last good copy. Fix: refresh the <code>SCREENER_SESSION</code> GitHub secret, then re-run the sync.</>
              : <>🔄 Auto-sync from screener.in · last run {lastRun} ({hrs}h ago){staleByAge && ' · built-in screens may be stale (>36h)'}</>}
          </span>
          <button
            onClick={() => { resetAutoLoadFlag('multibagger-india'); runAutoSync(true); }}
            disabled={syncLoading}
            style={{marginLeft:'auto',padding:'4px 10px',backgroundColor:accent,color:'#fff',border:'none',borderRadius:6,fontSize:F.xs,fontWeight:700,cursor:syncLoading?'wait':'pointer'}}
          >
            {syncLoading ? 'Loading...' : 'Refresh now'}
          </button>
        </div>
        );
      })()}

      {/* Upload zone */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:12,padding:'8px 14px',border:`1px dashed ${PURPLE}40`,borderRadius:8,cursor:'pointer',backgroundColor:`${PURPLE}05`,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}
      >
        <span style={{fontSize:16}}>{loading?'⏳':'📁'}</span>
        <span style={{fontSize:F.sm,fontWeight:700,color:PURPLE}}>
          {loading?'Scoring...':fileName?`✅ ${fileName}`:'Click or drop CSV / XLSX'}
        </span>
        <span style={{fontSize:F.xs,color:MUTED}}>
          Screener.in format · auto-detected · duplicates merged
        </span>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>

      {parseError&&<div style={{marginBottom:14,padding:'12px 16px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {/* ── GUIDANCE BUTTON — always visible, prominent ─────────────────────────
          Fetches recent earnings/guidance news and re-scores all loaded stocks.
          Shows disabled state when no data is loaded yet. */}
      <div style={{marginBottom:20,display:'flex',alignItems:'center',gap:14,padding:'16px 20px',backgroundColor:CARD_BG,border:`2px solid ${guidanceMode?'var(--mc-warn)':'color-mix(in srgb, var(--mc-warn) 25%, transparent)'}`,borderRadius:12,flexWrap:'wrap'}}>
        <button
          onClick={() => {
            if (rows.length === 0) return;
            if (guidanceMode) {
              setGuidanceMode(false);
              setGuidanceScores({});
              // PATCH 1101d — reset guidanceTier on mode-off so the hidden
              // filter can't silently empty the result set later (this was
              // the root of the "Good Only shows 0" bug: guidanceTier
              // persisted from an earlier session, its chip hid with
              // guidanceMode, and it kept filtering invisibly).
              setGuidanceTier('ALL');
            } else {
              setGuidanceMode(true);
              fetchGuidanceScores();
            }
          }}
          style={{
            padding:'14px 28px', borderRadius:10,
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            border:`2px solid ${guidanceMode?'var(--mc-warn)':'color-mix(in srgb, var(--mc-warn) 38%, transparent)'}`,
            background: guidanceMode ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
            color: rows.length === 0 ? 'color-mix(in srgb, var(--mc-warn) 31%, transparent)' : 'var(--mc-warn)',
            display:'flex', alignItems:'center', gap:10,
            opacity: rows.length === 0 ? 0.5 : 1,
            transition:'all 0.15s',
          }}
        >
          <span style={{fontSize:26}}>{guidanceLoading ? '⏳' : '📡'}</span>
          <div>
            <div style={{fontSize:F.lg,fontWeight:900,letterSpacing:'-0.3px'}}>
              {guidanceLoading ? 'Fetching guidance…' : guidanceMode ? 'Guidance: ON' : 'Guidance'}
            </div>
            <div style={{fontSize:F.xs,fontWeight:400,marginTop:2,color:'color-mix(in srgb, var(--mc-warn) 60%, transparent)'}}>
              {rows.length === 0 ? 'Upload data first, then click to score with guidance' :
               guidanceMode ? `${Object.keys(guidanceScores).length} stocks re-scored · click again to reset` :
               `Re-score ${rows.length} stocks using live earnings & guidance news`}
            </div>
          </div>
          {guidanceMode && <span style={{fontSize:F.sm,fontWeight:700,color:'var(--mc-warn)',marginLeft:8}}>✓ ACTIVE</span>}
        </button>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:F.sm,color:MUTED,lineHeight:1.6}}>
            Fetches latest earnings results + guidance upgrades/cuts from live news feed.
            Re-ranks all stocks: <span style={{color:GREEN}}>raised guidance = +14 pts</span> · <span style={{color:RED}}>cut guidance = −14 pts</span> · shows guidance score (0.0–1.0) per stock.
          </div>
        </div>
        {guidanceMode && !guidanceLoading && Object.keys(guidanceScores).length > 0 && (
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {[
              {label:'Strong ▲',  count:Object.values(guidanceScores).filter(v=>v>=0.7).length,           color:GREEN},
              {label:'Positive',  count:Object.values(guidanceScores).filter(v=>v>=0.55&&v<0.7).length,   color:'#34d399'},
              {label:'Neutral',   count:Object.values(guidanceScores).filter(v=>v>0.45&&v<0.55).length,   color:MUTED},
              {label:'Negative',  count:Object.values(guidanceScores).filter(v=>v>0.3&&v<=0.45).length,   color:ORANGE},
              {label:'Weak ▼',   count:Object.values(guidanceScores).filter(v=>v>=0&&v<=0.3).length,      color:RED},
              {label:'No data',  count:Object.values(guidanceScores).filter(v=>v===-1).length,             color:MUTED},
            ].map(({label,count,color})=>(
              <div key={label} style={{padding:'6px 10px',backgroundColor:`${color}14`,border:`1px solid ${color}30`,borderRadius:7,textAlign:'center',minWidth:60}}>
                <div style={{fontSize:F.md,fontWeight:800,color}}>{count}</div>
                <div style={{fontSize:F.xs,color:MUTED}}>{label}</div>
              </div>
            ))}
            {/* Legend */}
            <div style={{fontSize:F.xs,color:MUTED,marginLeft:8,lineHeight:1.5}}>
              <span style={{color:GREEN}}>News-based</span> = from earnings articles ·&nbsp;
              <span style={{color:ACCENT}}>📊 proxy</span> = trajectory signal (no news coverage) ·&nbsp;
              <span style={{color:MUTED}}>— no data</span> = no signal available
            </div>
          </div>
        )}
      </div>

      {rows.length>0&&(
        <>
          {/* Summary + GUIDANCE button on same row */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:PURPLE},
              {label:'Top Picks (B+)',value:topPicks.length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}

            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {/* Good Companies Only */}
              <button onClick={()=>setGoodOnly(v=>!v)} style={{fontSize:F.sm,fontWeight:800,padding:'8px 16px',borderRadius:8,border:`2px solid ${goodOnly?GREEN+'80':BORDER}`,background:goodOnly?`${GREEN}18`:'transparent',color:goodOnly?GREEN:MUTED,cursor:'pointer'}}>
                {goodOnly?`✅ Good Only (${goodCompanies.length})`:`🔍 Good Only`}
              </button>
              <div style={{width:1,background:BORDER,height:24}}/>
              {/* Grade filter */}
              {(['ALL',...GRADES] as const).map(g=>{
                const active = gradeFilter.has(g);
                const col = GRADE_COLOR[g as Grade] || PURPLE;
                return (
                <button key={g} onClick={()=>{
                  if (g === 'ALL') { setGradeFilter(new Set(['ALL'])); return; }
                  setGradeFilter(prev => {
                    const next = new Set(prev);
                    next.delete('ALL'); // clear ALL when selecting specific grades
                    if (next.has(g)) { next.delete(g); if (next.size === 0) next.add('ALL'); }
                    else next.add(g);
                    return next;
                  });
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>
                );})}
            </div>
          </div>
          {/* Bucket + quick filters row */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>BUCKET:</span>
            {(['ALL','CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK','MONITOR'] as const).map(b=>{
              const cfg = b==='ALL' ? {label:'All',color:MUTED,icon:'',count:rows.length} :
                {...BUCKET_CONFIG[b], count:rows.filter(r=>r.bucket===b).length};
              return (
                <button key={b} onClick={()=>setBucketFilter(b)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${bucketFilter===b?cfg.color+'60':BORDER}`,background:bucketFilter===b?cfg.color+'18':'transparent',color:bucketFilter===b?cfg.color:MUTED,cursor:'pointer'}}>
                  {cfg.icon && `${cfg.icon} `}{'label' in cfg ? cfg.label : b} ({cfg.count})
                </button>
              );
            })}
            <div style={{width:1,background:BORDER,height:20}}/>
            {/* PATCH 0127 — Sector filter dropdown */}
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>SECTOR:</span>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              style={{fontSize:F.xs,fontWeight:700,padding:'5px 8px',borderRadius:7,border:`1px solid ${sectorFilter==='ALL'?BORDER:'color-mix(in srgb, var(--mc-cyan) 38%, transparent)'}`,background:sectorFilter==='ALL'?'transparent':'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',color:sectorFilter==='ALL'?MUTED:'var(--mc-cyan)',cursor:'pointer'}}>
              <option value="ALL">All sectors</option>
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of rows) counts[r.sector] = (counts[r.sector] ?? 0) + 1;
                return Object.entries(counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, c]) => (
                    <option key={s} value={s}>{s} ({c})</option>
                  ));
              })()}
            </select>
            <div style={{width:1,background:BORDER,height:20}}/>
            {/* PATCH 1050 — AI GUIDANCE buttons + status + filter chips */}
            {(() => {
              const cachedCount = Object.keys(aiGuidanceMap).length;
              const goodCount = (typeof goodCompanies !== 'undefined' ? goodCompanies : rows.filter((r: any) => r.score >= 60)).length;
              const oldestFetched = cachedCount > 0 ? Math.min(...Object.values(aiGuidanceMap).map(e => e.fetchedAt || Date.now())) : 0;
              const daysAgo = oldestFetched > 0 ? Math.floor((Date.now() - oldestFetched) / 86_400_000) : 0;
              return (
                <>
                  <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>🤖 AI GUIDANCE:</span>
                  <button onClick={()=>fetchAIGuidance(false)} disabled={aiGuidanceLoading || rows.length === 0} title={`Soft fetch: only new tickers or cache > 100 days old. Free if all cached.`} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${PURPLE}80`,background:`${PURPLE}14`,color:PURPLE,cursor:rows.length===0?'not-allowed':'pointer'}}>
                    {aiGuidanceLoading ? `⏳ ${aiGuidanceProgress.done}/${aiGuidanceProgress.total}` : `📡 Fetch (gaps only)`}
                  </button>
                  <button onClick={()=>fetchAIGuidance(true)} disabled={aiGuidanceLoading || rows.length === 0} title={`Hard refresh: re-fetch ALL ${goodCount} Good-filter stocks. Costs ~$${(goodCount * 0.0014).toFixed(2)}.`} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${ORANGE}80`,background:`${ORANGE}14`,color:ORANGE,cursor:rows.length===0?'not-allowed':'pointer'}}>
                    🔄 Hard Refresh
                  </button>
                  <span style={{fontSize:F.xs,color:MUTED}}>{cachedCount > 0 ? `${cachedCount} cached · oldest ${daysAgo}d ago` : 'No cache yet'}</span>
                  {aiGuidanceProgress.configMissing && <span style={{fontSize:F.xs,color:RED,fontWeight:800,padding:'2px 6px',background:`${RED}14`,borderRadius:4}}>🔧 model API key not set in Railway (OPENAI_API_KEY)</span>}
                  {/* AI tier filter chips */}
                  {([
                    {key:'ALL', label:'All', color:MUTED},
                    {key:'EXCELLENT', label:'🚀 Excellent', color:'#10B981'},
                    {key:'POSITIVE', label:'▲ Positive', color:'#34D399'},
                    {key:'NEUTRAL', label:'● Neutral', color:'#94A3B8'},
                    {key:'CAUTIOUS', label:'▽ Cautious', color:'#F59E0B'},
                    {key:'NEGATIVE', label:'⚠ Negative', color:'#EF4444'},
                  ] as const).map(t => {
                    const cnt = t.key === 'ALL' ? rows.length : Object.values(aiGuidanceMap).filter(e => e.tier === t.key).length;
                    return (
                      <button key={t.key} onClick={()=>setAiTierFilter(t.key as any)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,border:`1px solid ${aiTierFilter===t.key?t.color+'80':BORDER}`,background:aiTierFilter===t.key?t.color+'14':'transparent',color:aiTierFilter===t.key?t.color:MUTED,cursor:'pointer'}}>
                        {t.label} ({cnt})
                      </button>
                    );
                  })}
                  <div style={{width:1,background:BORDER,height:20}}/>
                </>
              );
            })()}
            {/* PATCH 1046 — FRAUD RISK filter chips */}
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>🛡 FRAUD:</span>
            {(() => {
              const fraudCounts = {
                CLEAN: rows.filter(r => !r.redFlags.some(f => f.source && f.source.startsWith('fraud:'))).length,
                CRITICAL: rows.filter(r => r.redFlags.some(f => f.source && f.source.startsWith('fraud:') && f.severity === 'CRITICAL')).length,
                HIGH: rows.filter(r => { const ff = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:')); return ff.some(f => f.severity === 'HIGH') && !ff.some(f => f.severity === 'CRITICAL'); }).length,
                ANY: rows.filter(r => r.redFlags.some(f => f.source && f.source.startsWith('fraud:'))).length,
              };
              const opts: Array<{key:'ALL'|'CLEAN'|'CRITICAL'|'HIGH'|'ANY', label:string, color:string, count:number}> = [
                {key:'ALL',      label:'All',                   color:MUTED,  count: rows.length},
                {key:'CLEAN',    label:'✓ Clean only',           color:GREEN,  count: fraudCounts.CLEAN},
                {key:'ANY',      label:'⚠ Any flag',             color:ORANGE, count: fraudCounts.ANY},
                {key:'HIGH',     label:'⚠ HIGH risk',            color:ORANGE, count: fraudCounts.HIGH},
                {key:'CRITICAL', label:'🚨 NEVER BUY (Critical)', color:RED,    count: fraudCounts.CRITICAL},
              ];
              return opts.map(o => (
                <button key={o.key} onClick={()=>setFraudFilter(o.key)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${fraudFilter===o.key?o.color+'80':BORDER}`,background:fraudFilter===o.key?o.color+'14':'transparent',color:fraudFilter===o.key?o.color:MUTED,cursor:'pointer'}}>
                  {o.label} ({o.count})
                </button>
              ));
            })()}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>QUICK:</span>
            {[
              {key:'accel',  label:'🚀 Accelerating', active:accelOnly,  toggle:()=>setAccelOnly(v=>!v),  count:rows.filter(r=>r.decisionStrip.acceleration.pass).length},
              {key:'fcf',    label:'💰 FCF+',         active:fcfOnly,    toggle:()=>setFcfOnly(v=>!v),    count:rows.filter(r=>(r.fcfAbsolute??-1)>0||(r.cfoToPat??0)>=0.8).length},
              {key:'disc',    label:'🔍 Discovery <15%', active:discoveryOnly,  toggle:()=>setDiscoveryOnly(v=>!v),  count:rows.filter(r=>(r.fiiPlusDii??100)<15).length},
      // PATCH 1052 — Combined 50/200 DMA above filter chip. Stacks on top of
      // any other filter; user explicitly requested as the "always-on combo
      // when picking the best stocks" preset.
      {key:'dma',     label:'📈 50/200 DMA ↑',    active:dmaConfirmedOnly, toggle:()=>setDmaConfirmedOnly(v=>!v), count:rows.filter(r=>{const a200=(r.aboveDMA200??-100)>0; const a50=(r as any).aboveDMA50!==undefined?((r as any).aboveDMA50>0):((r.pctFrom52wHigh??-100)>-15); return a200 && a50;}).length},  // PATCH 1060
      {key:'inflect', label:'💥 Inflection',     active:inflectionOnly, toggle:()=>setInflectionOnly(v=>!v), count:rows.filter(r=>r.inflectionSignal||r.triggerBonus>=10).length},
      // PATCH 0272 — Conviction-only chip. Counts how many uploaded rows
      // intersect the Conviction Beats bench so users can see at a glance
      // which of their multibagger candidates ALSO just printed a BLOCKBUSTER/STRONG.
      {key:'cb',     label:'🏆 Conviction',     active:convictionOnly, toggle:()=>setConvictionOnly(v=>!v), count:rows.filter(r=>convictionSet.has((r.symbol||'').toUpperCase())).length},
      // Guidance button — separate from regular toggles, has its own fetch action
            ].map(f=>(
              <button key={f.key} onClick={f.toggle} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${f.active?ACCENT+'60':BORDER}`,background:f.active?ACCENT+'14':'transparent',color:f.active?ACCENT:MUTED,cursor:'pointer'}}>
                {f.label} ({f.count})
              </button>
            ))}
            {/* zzz175 New filter */}
            <button onClick={()=>setShowOnlyNewInd(v=>!v)}
              title="Show only tickers first seen in last 7 days"
              style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showOnlyNewInd?'#22D3EE60':BORDER}`,background:showOnlyNewInd?'#22D3EE14':'transparent',color:showOnlyNewInd?'#22D3EE':MUTED,cursor:'pointer'}}>
              🆕 New ({indNewSet.size}){showOnlyNewInd?' · ON':''}
            </button>
            {indAckSet.size > 0 && <span style={{fontSize:F.xs,color:MUTED,fontStyle:'italic'}}>✓ {indAckSet.size} seen</span>}
            {/* PATCH 0345 — India "Quality of 50" composite filter (analog of USA R40).
                ROCE + Profit CAGR ≥ threshold. ≥50 = passes (MOSL elite baseline);
                ≥75 = strong compounder; ≥100 = 100-bagger DNA tier.
                Composes AND-style with all other filters. */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'var(--mc-state-persistent)',fontWeight:700,letterSpacing:'0.5px'}}>Q50:</span>
            {(['ALL',50,75,100] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndQualityMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indQualityMin===v?'color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)':BORDER}`,background:indQualityMin===v?'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)':'transparent',color:indQualityMin===v?'var(--mc-state-persistent)':MUTED,cursor:'pointer'}}
                title={v==='ALL'?'No quality filter':`ROCE + Profit CAGR ≥ ${v}${v===100?' = 100-bagger DNA tier':v===75?' = strong compounder':' = MOSL elite baseline'}`}>
                {v==='ALL'?'All':`≥${v}${v===100?' 🏆':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)+(r.profitCagr??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — ROCE filter standalone (moat signature) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'var(--mc-bullish)',fontWeight:700,letterSpacing:'0.5px'}}>ROCE:</span>
            {(['ALL',20,25,30] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndRoceMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indRoceMin===v?'color-mix(in srgb, var(--mc-bullish) 38%, transparent)':BORDER}`,background:indRoceMin===v?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':'transparent',color:indRoceMin===v?'var(--mc-bullish)':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v}%${v===30?' 💎':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — CFO/PAT filter (cash conversion / earnings quality) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700,letterSpacing:'0.5px'}}>CFO/PAT:</span>
            {(['ALL',0.8,1.0] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndCfoMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indCfoMin===v?'#34d39960':BORDER}`,background:indCfoMin===v?'#34d39914':'transparent',color:indCfoMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v.toFixed(1)}${v===1.0?'× 💎':'×'}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.cfoToPat??0)>=v).length})`}
              </button>
            ))}
            {/* Guidance tier filter — only shown when guidance mode is ON */}
            {guidanceMode && <>
              <div style={{width:1,background:BORDER,height:20}}/>
              <span style={{fontSize:F.xs,color:'var(--mc-warn)',fontWeight:700,letterSpacing:'0.5px'}}>GUIDANCE:</span>
              {([
                {k:'ALL' as GuidanceTier,    label:'All',        col:MUTED},
                {k:'STRONG' as GuidanceTier, label:'▲ Strong',   col:GREEN},
                {k:'POS' as GuidanceTier,    label:'↑ Positive', col:'#34d399'},
                {k:'NEUTRAL' as GuidanceTier,label:'→ Neutral',  col:MUTED},
                {k:'NEG' as GuidanceTier,    label:'↓ Negative', col:ORANGE},
                {k:'WEAK' as GuidanceTier,   label:'▼ Weak',     col:RED},
              ] as const).map(({k,label,col})=>(
                <button key={k} onClick={()=>setGuidanceTier(prev=>prev===k?'ALL':k)}
                  style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${guidanceTier===k?col+'60':BORDER}`,background:guidanceTier===k?col+'18':'transparent',color:guidanceTier===k?col:MUTED,cursor:'pointer'}}>
                  {label}
                </button>
              ))}
            </>}
            {/* P/E filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>P/E:</span>
            {(['ALL',15,25,40,60,100] as const).map(v=>(
              <button key={v} onClick={()=>setPeMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${peMax===v?YELLOW+'60':BORDER}`,background:peMax===v?`${YELLOW}14`:'transparent',color:peMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}×`}
              </button>
            ))}
            {/* PEG filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>PEG:</span>
            {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
              <button key={v} onClick={()=>setPegMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${pegMax===v?GREEN+'60':BORDER}`,background:pegMax===v?`${GREEN}14`:'transparent',color:pegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}`}
              </button>
            ))}
            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{filtered.length} showing</span>
            <button
              onClick={() => { setExpandAll(v => !v); setExpRow(null); }}
              style={{
                fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer',
                border:`1px solid ${expandAll ? ACCENT+'60' : BORDER}`,
                background: expandAll ? ACCENT+'14' : 'transparent',
                color: expandAll ? ACCENT : MUTED,
              }}
            >
              {expandAll ? '⊟ Collapse All' : '⊞ Expand All'}
            </button>

            {/* ── DOWNLOAD DOCX ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as Word document"
                onClick={async () => {
                  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
                    HeadingLevel, AlignmentType, WidthType, BorderStyle: BS, ShadingType, LevelFormat } = await import('docx');
                  const border = { style: BS.SINGLE, size: 1, color: 'CCCCCC' };
                  const borders = { top: border, bottom: border, left: border, right: border };
                  const cm = { top: 80, bottom: 80, left: 120, right: 120 };
                  const fmtVal = (field: keyof ExcelRow, label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%') || label.includes('pp') ? '%' : ''}`;
                  };
                  const children: any[] = [
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '📊 Multibagger Research Report', bold: true, size: 36 })] }),
                    new Paragraph({ children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}  |  Stocks: ${filtered.length}  |  Framework: SQGLP + Fisher 100-Bagger`, size: 20, color: '666666' })] }),
                    new Paragraph({ children: [new TextRun('')] }),
                    // Grade summary table
                    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [1560,1560,1560,1560,1560,1560], rows: [
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, shading: { fill: g==='A+'?'E8F5E9':g==='A'?'F1F8E9':g==='B+'?'FFF8E1':g==='B'?'FFF3E0':'FAFAFA', type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: g, bold: true })] })] })) }),
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(filtered.filter(r=>r.grade===g).length), bold: true, size: 24 })] })] })) }),
                    ]}),
                    new Paragraph({ children: [new TextRun('')] }),
                  ];
                  for (const r of filtered) {
                    const gs = guidanceScores[r.symbol];
                    children.push(
                      new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: children.length > 10, children: [new TextRun({ text: `${r.symbol}  —  ${r.company || r.sector}`, bold: true })] }),
                      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340,2340,2340,2340], rows: [
                        new TableRow({ children: [
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'F5F5F5', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: `Score: ${r.score} | Grade: ${r.grade}`, bold: true })] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Bucket: ${r.bucket.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Ownership: ${r.ownershipCategory.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(gs !== undefined && gs !== -1 ? `Guidance: ${gs.toFixed(1)}` : 'Guidance: —')] })] }),
                        ]}),
                      ]}),
                    );
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null);
                    if (metricRows.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: 'Metrics', bold: true, size: 22 })] }));
                      const half = Math.ceil(metricRows.length / 2);
                      for (let i = 0; i < half; i++) {
                        const left = metricRows[i], right = metricRows[i + half];
                        children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2600,2080,2600,2080], rows: [
                          new TableRow({ children: [
                            new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: left[1], size: 18 })] })] }),
                            new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(left[0], left[1], r[left[0]] as number), bold: true, size: 18 })] })] }),
                            ...(right ? [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: right[1], size: 18 })] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(right[0], right[1], r[right[0]] as number), bold: true, size: 18 })] })] }),
                            ] : [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                            ]),
                          ]}),
                        ]}));
                      }
                    }
                    // Strengths
                    if (r.strengths.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '✅ Strengths', bold: true, size: 22, color: '1B7F4F' })] }));
                      r.strengths.forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    // Risks
                    if (r.risks.length > 0 || r.redFlags.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '⚠ Risks & Flags', bold: true, size: 22, color: 'B91C1C' })] }));
                      r.redFlags.forEach(f => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `🚩 [${f.severity}] ${f.label}`, size: 18, color: 'B91C1C' })] })));
                      r.risks.filter(s => !s.startsWith('Hard ')).forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    children.push(new Paragraph({ children: [new TextRun({ text: `Sector: ${r.sector}  |  Data: ${r.coverage}%  |  Pillar weights: ${r.pillarScores.map(p=>`${p.label} ${p.weight}%`).join(' · ')}`, size: 16, color: '888888' })] }));
                    children.push(new Paragraph({ children: [new TextRun('')] }));
                  }
                  const doc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }] });
                  const blob = await Packer.toBlob(doc);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `multibagger-${new Date().toISOString().slice(0,10)}.docx`; a.click(); URL.revokeObjectURL(url);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'var(--mc-state-persistent)' }}
              >⬇ DOCX</button>
            )}

            {/* ── DOWNLOAD PDF ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as PDF"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const autoTable = (await import('jspdf-autotable')).default;
                  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                  const pageW = doc.internal.pageSize.getWidth();
                  const margin = 14;
                  const contentW = pageW - margin * 2;
                  const fmtV = (label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN',{maximumFractionDigits:1})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%')||label.includes('pp')?'%':''}`;
                  };
                  // Cover page
                  doc.setFontSize(22); doc.setFont('helvetica','bold');
                  doc.text('Multibagger Research Report', pageW/2, 40, { align: 'center' });
                  doc.setFontSize(11); doc.setFont('helvetica','normal');
                  doc.text(`SQGLP · Fisher 100-Bagger · ${filtered.length} stocks · ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}`, pageW/2, 50, { align: 'center' });
                  // Grade summary
                  const gradeSummary = ['A+','A','B+','B','C','D'].map(g => [g, String(filtered.filter(r=>r.grade===g).length)]);
                  autoTable(doc, { startY: 60, margin: { left: margin }, head: [['A+','A','B+','B','C','D']], body: [gradeSummary.map(([,n])=>n)], theme: 'grid', headStyles: { fillColor: [88,28,135], textColor: 255, fontStyle: 'bold', halign: 'center' }, bodyStyles: { halign: 'center', fontStyle: 'bold', fontSize: 13 }, tableWidth: contentW });
                  for (let i = 0; i < filtered.length; i++) {
                    const r = filtered[i];
                    doc.addPage();
                    const gs = guidanceScores[r.symbol];
                    // Stock header
                    doc.setFillColor(15, 23, 42); doc.rect(0, 0, pageW, 22, 'F');
                    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold');
                    doc.text(`${r.symbol}  —  ${r.company || r.sector}`, margin, 10);
                    doc.setFontSize(9); doc.setFont('helvetica','normal');
                    const gradeColor: Record<string,[number,number,number]> = {'A+':[16,185,129],'A':[52,211,153],'B+':[245,158,11],'B':[249,115,22],'C':[251,146,60],'D':[239,68,68]};
                    const gc = gradeColor[r.grade] || [100,100,100];
                    doc.setTextColor(...gc); doc.setFontSize(18); doc.setFont('helvetica','bold');
                    doc.text(r.grade, pageW - margin - 10, 13, { align: 'right' });
                    doc.setTextColor(200,200,200); doc.setFontSize(9); doc.setFont('helvetica','normal');
                    doc.text(`Score: ${r.score}  |  ${r.bucket.replace(/_/g,' ')}  |  ${r.ownershipCategory.replace(/_/g,' ')}  |  Guidance: ${gs !== undefined && gs !== -1 ? gs.toFixed(1) : '—'}`, margin, 18);
                    doc.setTextColor(0,0,0);
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null)
                      .map(([f,label]) => [label, fmtV(label, r[f] as number)]);
                    const half = Math.ceil(metricRows.length / 2);
                    const leftCol = metricRows.slice(0, half);
                    const rightCol = metricRows.slice(half);
                    const tableBody = leftCol.map((row, i) => [...row, ...(rightCol[i] || ['',''])]);
                    autoTable(doc, { startY: 26, margin: { left: margin }, head: [['Metric','Value','Metric','Value']], body: tableBody, theme: 'striped', headStyles: { fillColor: [30,41,59], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7.5 }, columnStyles: { 0: { cellWidth: contentW*0.32 }, 1: { cellWidth: contentW*0.18, halign:'right' }, 2: { cellWidth: contentW*0.32 }, 3: { cellWidth: contentW*0.18, halign:'right' } }, tableWidth: contentW });
                    const afterMetrics = (doc as any).lastAutoTable?.finalY || 80;
                    // Strengths
                    if (r.strengths.length > 0) {
                      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(27,127,79);
                      doc.text('✅ STRENGTHS', margin, afterMetrics + 6);
                      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
                      let y = afterMetrics + 11;
                      for (const s of r.strengths.slice(0,12)) {
                        const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                        doc.text(lines, margin + 2, y); y += lines.length * 4;
                        if (y > 260) break;
                      }
                      // Risks
                      if (r.risks.length > 0 || r.redFlags.length > 0) {
                        doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
                        doc.text('⚠ RISKS', margin, y + 4);
                        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(60,40,40);
                        y += 9;
                        for (const f of r.redFlags.slice(0,5)) {
                          const lines = doc.splitTextToSize(`🚩 [${f.severity}] ${f.label}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                        for (const s of r.risks.filter(x=>!x.startsWith('Hard ')).slice(0,8)) {
                          const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                      }
                    }
                    // Footer
                    doc.setFontSize(7); doc.setTextColor(140,140,140);
                    doc.text(`Sector: ${r.sector}  |  Data: ${r.coverage}%  |  ${i+1}/${filtered.length}`, margin, 289);
                  }
                  doc.save(`multibagger-${new Date().toISOString().slice(0,10)}.pdf`);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'var(--mc-warn)' }}
              >⬇ PDF</button>
            )}

            {/* ── CSV EXPORT ── */}
            {filtered.length > 0 && (
              <button
                title="Export as CSV (Excel-compatible)"
                onClick={async () => {
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r => ({
                    Symbol: r.symbol, Company: r.company, Score: r.score, Grade: r.grade,
                    Bucket: r.bucket, Sector: r.sector,
                    'ROCE %': r.roce, 'ROE %': r.roe, 'OPM %': r.opm, 'CFO/PAT': r.cfoToPat,
                    'FCF Cr': r.fcfAbsolute, 'Rev CAGR %': r.revCagr, 'Profit CAGR %': r.profitCagr,
                    'YOY Sales %': r.yoySalesGrowth, 'YOY Profit %': r.yoyProfitGrowth,
                    'D/E': r.de, 'Pledge %': r.pledge, 'Promoter %': r.promoter, 'Δ Promoter': r.changeInPromoter,
                    'P/E': r.pe, 'PEG': r.peg, 'MCap Cr': r.marketCapCr, 'MoS %': r.marginOfSafety,
                    'FII+DII %': r.fiiPlusDii, 'GPM %': r.gpm, 'ROIC %': r.roic,
                    'Rev Accel pp': r.revenueAcceleration, 'Profit Accel pp': r.profitAcceleration,
                    'Accel Signal': r.accelSignal, 'EV/EBITDA': r.evEbitda, 'FCF Yield %': r.fcfYield,
                    'ROCE Δ 3yr': r.roceExpansion, 'OPM Δ': r.opmExpansion,
                    'KS Pass': (r.killSwitch??[]).filter(t=>t.pass&&t.checks.some(c=>c.pass!==null)).length + '/' +
                              (r.killSwitch??[]).filter(t=>t.checks.some(c=>c.pass!==null)).length,
                    'Rerating': r.reratingBonus, Coverage: r.coverage,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'India');
                  XLSX.writeFile(wb, `india-multibagger-${new Date().toISOString().slice(0,10)}.csv`, { bookType: 'csv' });
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'#06b6d4' }}
              >⬇ CSV</button>
            )}
          </div>

          {/* ── GAP 6: PORTFOLIO CONSTRUCTION PANEL ─────────────────────────── */}
          {(() => {
            // Grade → position size recommendation (SQGLP-based, risk-adjusted)
            const sizeMap: Record<Grade,string> = {'A+':'8–12%','A':'5–8%','B+':'3–5%','B':'1–3%','C':'0%','D':'0%','NR':'0%'};
            const actionMap: Record<Grade,string> = {'A+':'Core position','A':'Standard position','B+':'Pilot / accumulate on dips','B':'Watchlist only','C':'Avoid','D':'Avoid','NR':'No data'};
            const actionColor: Record<Grade,string> = {'A+':GREEN,'A':'#34d399','B+':YELLOW,'B':MUTED,'C':RED,'D':RED,'NR':MUTED};
            // Bucket allocation caps
            const bucketCaps: Record<Bucket, { maxPct: number; label: string; color: string }> = {
              CORE_COMPOUNDER:      { maxPct:40, label:'Core (≤40% total)', color:GREEN },
              EMERGING_MULTIBAGGER: { maxPct:35, label:'Emerging (≤35% total)', color:PURPLE },
              HIGH_RISK:            { maxPct:15, label:'High-Risk (≤15% total)', color:ORANGE },
              MONITOR:              { maxPct:5,  label:'Monitor (≤5% total)', color:MUTED },
            };
            const actionableRows = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');
            // Sector concentration
            const sectorCounts = actionableRows.reduce((acc, r) => {
              acc[r.sector] = (acc[r.sector] || 0) + 1;
              return acc;
            }, {} as Record<string,number>);
            const concentratedSectors = Object.entries(sectorCounts).filter(([,c]) => c >= 3);
            // Bucket breakdowns of actionable picks
            const bucketGroups = (['CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK'] as Bucket[]).map(b => ({
              b, cfg: bucketCaps[b],
              stocks: actionableRows.filter(r => r.bucket === b),
            }));
            return (
              <details style={{marginBottom:16}} open={false}>
                <summary style={{cursor:'pointer',padding:'12px 16px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,
                  fontSize:F.md,fontWeight:700,color:PURPLE,userSelect:'none',
                  display:'flex',gap:10,alignItems:'center',listStyle:'none'}}>
                  📐 Portfolio Construction (Gap 6)
                  <span style={{fontSize:F.xs,fontWeight:400,color:MUTED,marginLeft:4}}>
                    {actionableRows.length} actionable picks — allocation guide, sizing, concentration check
                  </span>
                </summary>
                <div style={{padding:'18px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderTop:'none',borderRadius:'0 0 10px 10px'}}>
                  {/* Position sizing by grade */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>POSITION SIZING BY GRADE</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {(['A+','A','B+','B'] as Grade[]).map(g => {
                        const cnt = actionableRows.filter(r => r.grade === g).length;
                        return (
                          <div key={g} style={{padding:'12px 18px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${GRADE_COLOR[g]}30`,minWidth:140}}>
                            <div style={{display:'flex',gap:8,alignItems:'baseline',marginBottom:4}}>
                              <span style={{fontSize:F.xl,fontWeight:900,color:GRADE_COLOR[g]}}>{g}</span>
                              <span style={{fontSize:F.xs,color:MUTED}}>{cnt} stocks</span>
                            </div>
                            <div style={{fontSize:F.md,fontWeight:700,color:TEXT}}>{sizeMap[g]}</div>
                            <div style={{fontSize:F.xs,color:actionColor[g],marginTop:3}}>{actionMap[g]}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Bucket allocation limits */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>BUCKET ALLOCATION CAPS</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {bucketGroups.map(({b, cfg, stocks}) => (
                        <div key={b} style={{padding:'12px 16px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}30`,flex:'1 1 160px'}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color,marginBottom:4}}>{BUCKET_CONFIG[b].icon} {BUCKET_CONFIG[b].label}</div>
                          <div style={{fontSize:F.lg,fontWeight:800,color:TEXT,marginBottom:2}}>{stocks.length} picks</div>
                          <div style={{fontSize:F.xs,color:MUTED}}>{cfg.label}</div>
                          {stocks.slice(0,3).map(s => (
                            <div key={s.symbol} style={{fontSize:F.xs,color:MUTED,marginTop:3}}>
                              <span style={{color:GRADE_COLOR[s.grade],fontWeight:700}}>{s.grade}</span> {s.symbol} ({sizeMap[s.grade]})
                            </div>
                          ))}
                          {stocks.length > 3 && <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>+{stocks.length-3} more</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Sector concentration warning */}
                  {concentratedSectors.length > 0 && (
                    <div style={{padding:'12px 16px',backgroundColor:`${ORANGE}10`,border:`1px solid ${ORANGE}30`,borderRadius:8,marginBottom:16}}>
                      <div style={{fontSize:F.sm,fontWeight:800,color:ORANGE,marginBottom:6}}>⚠️ Sector Concentration Risk</div>
                      {concentratedSectors.map(([sector, cnt]) => (
                        <div key={sector} style={{fontSize:F.xs,color:TEXT,marginBottom:3}}>
                          <strong>{sector}</strong>: {cnt} picks in top grades — consider capping at 2 per sector for diversification
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Ownership allocation guidance */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
                    {(['FOUNDER_CONTROLLED','INSTITUTIONALIZING','MATURE','OWNERSHIP_VACUUM'] as OwnershipCategory[]).map(cat => {
                      const cfg = OWNERSHIP_CONFIG[cat];
                      const cnt = actionableRows.filter(r => r.ownershipCategory === cat).length;
                      return (
                        <div key={cat} style={{padding:'10px 14px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}20`}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color}}>{cfg.icon} {cfg.label}</div>
                          <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>{cnt} picks · {cfg.allocation}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })()}

          {/* PATCH 0367 — India export toolbar. Filtered tickers from `filtered`.
              Builds ticker -> company map for Screener.in name-based matching
              (NSE symbols like '360ONE' don't match Screener fuzzy search;
              'Three Sixty One Capital' / '360 ONE WAM Ltd' does). */}
          {filtered.length > 0 && (() => {
            const tickerCompanyMap: Record<string, string> = {};
            for (const r of filtered) {
              if (r.symbol && r.company) tickerCompanyMap[r.symbol.toUpperCase()] = r.company;
            }
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange="NSE"
                  filenameHint="multibagger-india"
                  tickerCompanyMap={tickerCompanyMap}
                  compact
                />
              </div>
            );
          })()}

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 90px 96px 86px 120px 1fr 76px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            {/* Clickable sort headers */}
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleSort('score')} style={{cursor:'pointer',userSelect:'none',color:sortField==='score'?ACCENT:MUTED}}>SCORE{sortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleSort('pe')} style={{cursor:'pointer',userSelect:'none',color:sortField==='pe'||sortField==='peg'?YELLOW:MUTED}}>P/E{sortIcon('pe')} · <span onClick={e=>{e.stopPropagation();handleSort('peg')}} style={{cursor:'pointer'}}>PEG{sortIcon('peg')}</span></span>
            <span style={{color:guidanceMode?'var(--mc-warn)':MUTED}}>GUIDANCE{!guidanceMode&&<span style={{fontSize:9,fontWeight:400}}> ↑📡</span>}</span>
            <span>DECISION STRIP</span>
            <span onClick={()=>handleSort('revenueAcceleration')} style={{cursor:'pointer',userSelect:'none',color:sortField==='revenueAcceleration'?GREEN:MUTED}}>SQGLP PILLARS{sortIcon('revenueAcceleration')}</span>
            <span onClick={()=>handleSort('marketCapCr')} style={{cursor:'pointer',userSelect:'none',color:sortField==='marketCapCr'?'var(--mc-warn)':MUTED}}>COV{sortIcon('marketCapCr')}</span>
          </div>

          {/* PATCH 1101d — Empty-state diagnostic. When the filter chain reduces
              the row list to zero but rows are loaded, surface which filters
              are active + a one-click reset, so silent zero-row states no
              longer look like a phantom data loss. */}
          {filtered.length === 0 && rows.length > 0 && (() => {
            const active: string[] = [];
            if (goodOnly) active.push('Good Only');
            if (!gradeFilter.has('ALL')) active.push(`Grade: ${Array.from(gradeFilter).join(', ')}`);
            if (bucketFilter !== 'ALL') active.push(`Bucket: ${bucketFilter}`);
            if (sectorFilter !== 'ALL') active.push(`Sector: ${sectorFilter}`);
            if (aiTierFilter !== 'ALL') active.push(`AI tier: ${aiTierFilter}`);
            if (fraudFilter !== 'ALL') active.push(`Fraud: ${fraudFilter}`);
            if (accelOnly) active.push('Accelerating');
            if (fcfOnly) active.push('FCF+');
            if (discoveryOnly) active.push('Discovery <15%');
            if (dmaConfirmedOnly) active.push('50/200 DMA ↑');
            if (inflectionOnly) active.push('Inflection');
            if (convictionOnly) active.push('Conviction');
            if (peMax !== 'ALL') active.push(`PE ≤ ${peMax}`);
            if (pegMax !== 'ALL') active.push(`PEG ≤ ${pegMax}`);
            if (indQualityMin !== 'ALL') active.push(`Q50 ≥ ${indQualityMin}`);
            if (indRoceMin !== 'ALL') active.push(`ROCE ≥ ${indRoceMin}%`);
            if (indCfoMin !== 'ALL') active.push(`CFO/PAT ≥ ${indCfoMin}×`);
            if (indDecisionFilter !== 'ALL') active.push(`Decision: ${indDecisionFilter}`);
            if (guidanceMode && guidanceTier !== 'ALL') active.push(`Guidance tier: ${guidanceTier}`);
            return (
              <div style={{padding:'24px 18px',textAlign:'center',backgroundColor:CARD_BG,borderRadius:8,margin:'14px 0',border:`1px dashed ${BORDER}`}}>
                <div style={{fontSize:F.md,color:TEXT,fontWeight:700,marginBottom:8}}>No stocks match the current filters</div>
                <div style={{fontSize:F.sm,color:MUTED,marginBottom:12,lineHeight:1.5}}>
                  {active.length > 0
                    ? <>Active filters: <strong style={{color:YELLOW}}>{active.join(' · ')}</strong></>
                    : <>All filters set to All — but no rows after sort/grade gate. Try reloading the CSV.</>}
                </div>
                {active.length > 0 && (
                  <button onClick={() => {
                    setGoodOnly(false);
                    setGradeFilter(new Set(['ALL']));
                    setBucketFilter('ALL');
                    setSectorFilter('ALL');
                    setAiTierFilter('ALL');
                    setFraudFilter('ALL');
                    setAccelOnly(false);
                    setFcfOnly(false);
                    setDiscoveryOnly(false);
                    setDmaConfirmedOnly(false);
                    setInflectionOnly(false);
                    setConvictionOnly(false);
                    setPeMax('ALL');
                    setPegMax('ALL');
                    setIndQualityMin('ALL');
                    setIndRoceMin('ALL');
                    setIndCfoMin('ALL');
                    setIndDecisionFilter('ALL');
                    setGuidanceTier('ALL');
                  }} style={{padding:'8px 18px',borderRadius:8,border:`1px solid ${ACCENT}50`,background:`${ACCENT}14`,color:ACCENT,fontSize:F.sm,fontWeight:700,cursor:'pointer'}}>
                    Clear all filters
                  </button>
                )}
              </div>
            );
          })()}

          {filtered.map((r,idx)=>{
            const isExp=expandAll || expRow===r.symbol;
            // PATCH 1101d — null-safe redFlags access (Screener CSV gaps).
            const hasCrit=(r.redFlags ?? []).some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`, position:'relative'}}>
                <div onClick={(e)=>{ e.stopPropagation(); }} style={{position:'absolute', top:8, right:8, zIndex:2}}>
                  <NewSeenCheckbox isNew={indNewSet.has(r.symbol)} isAcked={indAckSet.has(r.symbol)} onToggle={()=>toggleIndAck(r.symbol)} />
                </div>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 90px 96px 86px 180px 1fr 76px',gap:8,alignItems:'center'}}>
                    {/* Ticker + bucket + accel badge */}
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:hasCrit?RED:r.bucket==='MONITOR'?MUTED:TEXT}}>{r.symbol}</span>
                        {idx<3&&r.bucket!=='MONITOR'&&<span style={{fontSize:F.md}}>⭐</span>}
                        {/* PATCH 1050 — AI guidance score chip from cache, shows without expanding row */}
                        {(() => {
                          const ai = aiGuidanceMap[(r.symbol || '').toUpperCase()];
                          if (!ai) return null;
                          const c = ai.tier === 'EXCELLENT' ? '#10B981' : ai.tier === 'POSITIVE' ? '#34D399' : ai.tier === 'NEUTRAL' ? '#94A3B8' : ai.tier === 'CAUTIOUS' ? '#F59E0B' : ai.tier === 'NEGATIVE' ? '#EF4444' : '#6B7280';
                          const ic = ai.tier === 'EXCELLENT' ? '🚀' : ai.tier === 'POSITIVE' ? '▲' : ai.tier === 'NEUTRAL' ? '●' : ai.tier === 'CAUTIOUS' ? '▽' : ai.tier === 'NEGATIVE' ? '⚠' : '◌';
                          const days = Math.floor((Date.now() - ai.fetchedAt) / 86_400_000);
                          return (
                            <span title={`AI Guidance ${ai.tier} (${ai.score>=0?'+':''}${ai.score.toFixed(2)}) · ${ai.period} · fetched ${days}d ago\n${ai.summary}`} style={{fontSize:9,fontWeight:800,color:c,border:`1px solid ${c}60`,backgroundColor:`${c}14`,padding:'1px 5px',borderRadius:3,letterSpacing:0.3}}>🤖 {ic} {ai.score>=0?'+':''}{ai.score.toFixed(2)}</span>
                          );
                        })()}
                        {/* PATCH 0272 — Conviction Beats overlay badge. Amber 🏆 means
                            this ticker is on the institutional Conviction Beats bench
                            (synced from /earnings-opportunities BLOCKBUSTER/STRONG output). */}
                        {convictionSet.has((r.symbol || '').toUpperCase()) && (
                          <span
                            title="On Conviction Beats bench (BLOCKBUSTER/STRONG earnings)"
                            style={{
                              fontSize: 9, fontWeight: 800, color: 'var(--mc-warn)',
                              border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', backgroundColor: 'rgba(245,158,11,0.10)',
                              padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                            }}
                          >🏆 CB</span>
                        )}
                        {/* ADDITIVE — Transformation-radar badge. Shows when this
                            ticker is on the concall transformation-screener radar. */}
                        {(() => {
                          const te = transformMap.get((r.symbol || '').toUpperCase().replace(/\.NS$|\.BO$/i, ''));
                          if (!te) return null;
                          const sc = Math.round(Number(te.transformation_score) || 0);
                          return (
                            <span
                              title={`On transformation radar — score ${sc}${te.stage_sweet_spot ? ` · ${te.stage_sweet_spot}` : ''}${te.velocity ? ` · velocity ${te.velocity}` : ''}`}
                              style={{
                                fontSize: 9, fontWeight: 800, color: 'var(--mc-cyan)',
                                border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', backgroundColor: 'rgba(34,211,238,0.10)',
                                padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                              }}
                            >🚀 T-{sc}</span>
                          );
                        })()}
                        {/* AUDIT_100 #52 — Portfolio attribution. If user already
                            holds this ticker show OWN/Δ chip so they don't double-buy
                            without seeing the existing position. */}
                        {(() => {
                          const h = portfolioMap.get((r.symbol || '').toUpperCase());
                          if (!h) return null;
                          const wt = typeof h.weight === 'number' ? `${h.weight.toFixed(1)}%` : '';
                          const pnl = typeof h.pnlPercent === 'number'
                            ? `${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent.toFixed(1)}%` : '';
                          const tip = `In your portfolio${wt ? ` · weight ${wt}` : ''}${pnl ? ` · P&L ${pnl}` : ''}. Open /portfolio to view.`;
                          return (
                            <span title={tip} style={{
                              fontSize: 9, fontWeight: 800,
                              color: (h.pnlPercent ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                              border: '1px solid currentColor',
                              padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                              backgroundColor: 'rgba(16,185,129,0.08)',
                            }}>💼 OWN{wt && ` ${wt}`}{pnl && ` ${pnl}`}</span>
                          );
                        })()}
                      </div>
                      {/* Bucket badge */}
                      <span style={{fontSize:F.xs,fontWeight:700,color:BUCKET_CONFIG[r.bucket].color,border:`1px solid ${BUCKET_CONFIG[r.bucket].color}40`,padding:'1px 5px',borderRadius:3,width:'fit-content'}}>
                        {BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label.split(' ').slice(0,2).join(' ')}
                      </span>
                      {/* Ownership category badge */}
                      {r.ownershipCategory && (
                        <span title={OWNERSHIP_CONFIG[r.ownershipCategory].strategy} style={{fontSize:9,fontWeight:700,color:OWNERSHIP_CONFIG[r.ownershipCategory].color,border:`1px solid ${OWNERSHIP_CONFIG[r.ownershipCategory].color}40`,padding:'1px 4px',borderRadius:3,width:'fit-content'}}>
                          {OWNERSHIP_CONFIG[r.ownershipCategory].icon} {r.ownershipCategory === 'FOUNDER_CONTROLLED' ? 'Founder' : r.ownershipCategory === 'INSTITUTIONALIZING' ? 'Institutnlzg' : r.ownershipCategory === 'MATURE' ? 'Mature' : 'Vac⚠'}
                        </span>
                      )}
                      {/* PATCH 0313 — Governance Watch badge. Fires when the
                          pump-and-dump fingerprint is present (promoter ≤25%,
                          FII+DII ≤5%, mcap <₹2000Cr). Composite score is
                          capped at 65 in this state. */}
                      {(r as any).governanceWatch && (
                        <span
                          title={`GOVERNANCE WATCH: classic operator-driven small-cap setup (low promoter + zero institutional + small mcap). Score capped at 65 regardless of fundamentals because the financial quality itself can't be independently verified without institutional auditor pressure.`}
                          style={{
                            fontSize: 9, fontWeight: 800, color: 'var(--mc-bearish)',
                            border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)',
                            backgroundColor: 'rgba(239,68,68,0.12)',
                            padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                            letterSpacing: 0.3,
                          }}
                        >🛑 GOV⚠</span>
                      )}
                      {/* PATCH 0326 — Forensic pump-score chip. Visible on
                          row when forensic signals fire. Hover shows the
                          individual flags. Red ≥5 = CRITICAL, orange ≥3 =
                          HIGH, yellow ≥1 = soft signal. */}
                      {(r as any).pumpScore > 0 && (() => {
                        const ps = (r as any).pumpScore;
                        const flags = ((r as any).pumpFlags as string[]) || [];
                        const tone = ps >= 5 ? '#EF4444' : ps >= 3 ? '#F97316' : '#F59E0B';
                        const label = ps >= 5 ? `🔥 PUMP ${ps}` : ps >= 3 ? `⚠ PUMP ${ps}` : `· pump ${ps}`;
                        return (
                          <span
                            title={`Forensic pump-detector: ${ps} signals fired. ${flags.length > 0 ? '\n\n' + flags.slice(0, 6).map(f => '• ' + f).join('\n') : ''}`}
                            style={{
                              fontSize: 9, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                              letterSpacing: 0.3,
                            }}
                          >{label}</span>
                        );
                      })()}
                      {/* Signals: inflection/trigger/trajectory/rerating */}
                      <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:2}}>
                        {r.inflectionSignal&&<span title="Early inflection phase: low-base high profit growth" style={{fontSize:9,fontWeight:800,color:'var(--mc-warn)',border:'1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',padding:'0 4px',borderRadius:3}}>💥 INFLECT</span>}
                        {r.triggerBonus>=10&&<span title={`Trigger bonus +${r.triggerBonus}: turnaround/new engine/industry shift proxy`} style={{fontSize:9,fontWeight:700,color:'var(--mc-bullish)',border:'1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)',padding:'0 4px',borderRadius:3}}>⚡+{r.triggerBonus}</span>}
                        {r.trajectoryScore>20&&<span title={`Trajectory +${r.trajectoryScore.toFixed(0)}pp above historical`} style={{fontSize:9,fontWeight:700,color:'#38bdf8',border:'1px solid #38bdf840',padding:'0 4px',borderRadius:3}}>↑T+{r.trajectoryScore.toFixed(0)}</span>}
                        {r.trajectoryScore<-20&&<span title={`Trajectory ${r.trajectoryScore.toFixed(0)}pp below historical`} style={{fontSize:9,color:RED}}>↓T{r.trajectoryScore.toFixed(0)}</span>}
                        {r.reratingBonus!==0&&<span style={{fontSize:9,color:r.reratingBonus>0?GREEN:RED}}>{r.reratingBonus>0?'↑':'↓'}{Math.abs(r.reratingBonus)}r</span>}
                      </div>
                    </div>

                    {/* Company */}
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company||r.sector}</span>

                    {/* Score */}
                    <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR[r.grade]??MUTED}}>{r.score}</span>

                    {/* PATCH 1101e — Wrap Grade chip + 1101a NOT A SETUP / NEVER
                        BUY chip in a single grid cell so column count stays at
                        9 and the SQGLP pillar block (col 8) doesn't wrap. */}
                    <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start'}}>
                      {/* Grade */}
                      <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR[r.grade],backgroundColor:`${GRADE_COLOR[r.grade]}18`,border:`1px solid ${GRADE_COLOR[r.grade]}30`,textAlign:'center',alignSelf:'stretch'}}>{r.grade}</span>
                      {/* PATCH 1101a — Grade D label split (fraud vs not-a-setup) */}
                      {r.grade === 'D' && (() => {
                        const isFraudFlagged = (r.redFlags ?? []).some(f => f.source && f.source.startsWith('fraud:') && f.severity === 'CRITICAL');
                        if (isFraudFlagged) {
                          return (
                            <span title="Critical fraud-pattern flag fired" style={{fontSize:9,fontWeight:800,padding:'1px 4px',borderRadius:4,color:RED,backgroundColor:`${RED}18`,border:`1px solid ${RED}50`,letterSpacing:'0.3px',whiteSpace:'nowrap',lineHeight:1.2}}>🚨 NEVER BUY</span>
                          );
                        }
                        return (
                          <span title="Doesn't fit megawinner setup — not necessarily a bad business" style={{fontSize:9,fontWeight:700,padding:'1px 4px',borderRadius:4,color:MUTED,backgroundColor:'transparent',border:`1px solid ${MUTED}40`,letterSpacing:'0.3px',whiteSpace:'nowrap',lineHeight:1.2}}>NOT A SETUP</span>
                        );
                      })()}
                    </div>

                    {/* P/E + PEG — always visible for every stock */}
                    {(() => {
                      const pe = r.pe;
                      const peg = r.peg;
                      const mcap = r.marketCapCr;
                      // P/E color: sector-appropriate. Green < sector mid, Orange = mid-high, Red > 2× sector p75
                      const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
                      const peColor = pe === undefined ? MUTED :
                        pe < b2.pe[1]   ? GREEN :
                        pe < b2.pe[2]   ? YELLOW :
                        pe > b2.pe[2]*1.5 ? RED : ORANGE;
                      // PEG color: < 1 = green (cheap growth), 1-1.5 = yellow, > 2 = red
                      const pegColor = peg === undefined || peg <= 0 ? MUTED :
                        peg < 1.0 ? GREEN : peg < 1.5 ? YELLOW : peg < 2.5 ? ORANGE : RED;
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          {pe !== undefined
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PE</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:peColor}}>{pe.toFixed(0)}×</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PE —</span>
                          }
                          {peg !== undefined && peg > 0
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PEG</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:pegColor}}>{peg.toFixed(2)}</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PEG —</span>
                          }
                          {mcap !== undefined &&
                            <span style={{fontSize:9,color:MUTED}}>
                              {mcap >= 100000 ? `₹${(mcap/100000).toFixed(1)}L Cr` :
                               mcap >= 1000   ? `₹${(mcap/1000).toFixed(1)}k Cr`  :
                                                `₹${mcap.toFixed(0)}Cr`}
                            </span>
                          }
                          {/* PATCH 0166 — MC-Efficiency = rev_growth × ROCE / log10(MCap_Cr)
                              Higher = small company growing fast at high ROCE = great compounding setup.
                              ROCE/FCF Quality = ROCE / (FCF/Revenue) — high ROCE backed by strong FCF wins. */}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const revG = (r as any).revenue_growth as number | undefined ?? (r as any).rev_g as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && revG != null && mcap != null && mcap > 0) {
                              const denom = Math.log10(Math.max(mcap, 10));
                              const mcEff = (revG * roce) / denom;
                              const col = mcEff >= 200 ? GREEN : mcEff >= 100 ? YELLOW : mcEff >= 50 ? ORANGE : MUTED;
                              return (
                                <span title={`MC-Efficiency = revG × ROCE / log(MCap). ${mcEff.toFixed(0)} (rev growth ${revG.toFixed(0)}% × ROCE ${roce.toFixed(0)}% / log MCap ${denom.toFixed(2)}).`}
                                  style={{fontSize:9, color: col, fontWeight: 700, marginTop: 2}}>
                                  MC-Eff {mcEff.toFixed(0)}
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && fcf != null && rev != null && rev > 0) {
                              const fcfPct = (fcf / rev) * 100;
                              const ratio = fcfPct > 0 ? roce / fcfPct : 0;
                              const col = fcfPct >= 8 ? GREEN : fcfPct >= 3 ? YELLOW : RED;
                              return (
                                <span title={`ROCE/FCF Quality. ROCE ${roce.toFixed(0)}%, FCF/Rev ${fcfPct.toFixed(1)}% → ratio ${ratio.toFixed(2)} (closer-to-1 = high-quality earnings backed by cash).`}
                                  style={{fontSize:9, color: col, fontWeight: 700}}>
                                  ROCE/FCF {fcfPct.toFixed(1)}%
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {/* Feature 2 — Incremental ROIC chip. Surfaces the
                              already-computed roceExpansion (= roce − roce3yr)
                              alongside Q50/ROCE/CFO economics so the user can
                              see whether new capital is compounding or diluting
                              returns without expanding the row. */}
                          {(() => {
                            const rx = (r as any).roceExpansion as number | undefined;
                            const ox = (r as any).opmExpansion as number | undefined;
                            if (rx === undefined) return null;
                            const col = rx >= 3 ? GREEN : rx >= 0 ? YELLOW : RED;
                            return (
                              <span title={`Incremental ROIC = current ROCE − ROCE 3yr ago. ${rx >= 0 ? '+' : ''}${rx.toFixed(1)}pp${ox !== undefined ? ` · OPM Δ ${ox >= 0 ? '+' : ''}${ox.toFixed(1)}pp` : ''}. Positive = new capital earns ≥ legacy returns (Fisher's reinvestment test); negative = growth diluting returns.`}
                                style={{fontSize:9, color: col, fontWeight: 700}}>
                                Inc ROIC {rx >= 0 ? '+' : ''}{rx.toFixed(1)}pp
                              </span>
                            );
                          })()}
                          {/* VALUATION-B — Inline fair-value strip from 10 valuation models.
                              Shows FV, MoS%, and how many models agree. Click → /valuations?symbol=X */}
                          <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                            <ValuationStrip
                              row={r}
                              onClick={() => {
                                if (typeof window !== 'undefined') {
                                  window.location.href = `/valuations?symbol=${encodeURIComponent(r.symbol)}`;
                                }
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Guidance column — always shown, populated when guidance mode active */}
                    {!guidanceMode
                      ? <div style={{fontSize:F.xs,color:MUTED,textAlign:'center'}}>—</div>
                      : (() => {
                      const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                      const gs = rAny.guidanceScore;
                      const adj = rAny.guidanceAdj ?? 0;
                      const articleCount = guidanceArticleCounts[r.symbol] ?? 0;
                      // -1 = no matching articles found
                      if (gs === undefined || gs === -1) {
                        return <div style={{fontSize:F.xs,color:MUTED,fontStyle:'italic'}}>—<br/><span style={{fontSize:9}}>no data</span></div>;
                      }
                      const gColor = gs >= 0.7 ? GREEN : gs <= 0.3 ? RED : gs >= 0.55 ? '#34d399' : gs <= 0.45 ? ORANGE : MUTED;
                      const gLabel = gs >= 0.85 ? '▲ Strong' : gs >= 0.70 ? '▲ Positive' : gs >= 0.55 ? '↑ Mild +' : gs <= 0.15 ? '▼ Weak' : gs <= 0.30 ? '▼ Negative' : gs <= 0.45 ? '↓ Mild −' : '→ Neutral';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:2}}>
                          <div style={{display:'flex',alignItems:'center',gap:4}}>
                            <div style={{width:32,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${Math.round(gs*100)}%`,backgroundColor:gColor,borderRadius:2}}/>
                            </div>
                            <span style={{fontSize:F.xs,fontWeight:700,color:gColor}}>{gs.toFixed(1)}</span>
                          </div>
                          <span style={{fontSize:9,color:gColor,fontWeight:600}}>{gLabel}{adj !== 0 ? ` (${adj>0?'+':''}${adj}pts)` : ''}</span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {articleCount > 0 ? `${articleCount} article${articleCount!==1?'s':''}` : '📊 trajectory proxy'}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Decision strip — PATCH 1052: institutional-density layout.
                        Removed the 60px maxWidth + nowrap on the detail span so the
                        full "+32% vs DMA" / "PEG 0.6" / "FII+DII 28%" text is visible
                        instead of being chopped to "+32% v..." Layout now uses
                        column-gap label-and-detail with detail wrapping when needed. */}
                    <div style={{display:'flex',flexDirection:'column',gap:3,minWidth:0}}>
                      {([
                        {key:'survival',   s:r.decisionStrip.survival},
                        {key:'acceleration',s:r.decisionStrip.acceleration},
                        {key:'valuation',  s:r.decisionStrip.valuation},
                        {key:'discovery',  s:r.decisionStrip.discovery},
                        {key:'technical',  s:r.decisionStrip.technical},
                      ] as const).map(({key,s})=>(
                        <div key={key} title={`${s.label}: ${s.detail}`} style={{display:'flex',alignItems:'baseline',gap:4,minWidth:0}}>
                          <div style={{width:8,height:8,borderRadius:2,backgroundColor:s.pass?GREEN:RED,flexShrink:0,marginTop:3}}/>
                          <span style={{fontSize:9,color:s.pass?`${GREEN}CC`:`${RED}CC`,fontWeight:700,letterSpacing:0.2,flexShrink:0}}>{s.label}</span>
                          <span style={{fontSize:9,color:MUTED,wordBreak:'break-word',whiteSpace:'normal',lineHeight:1.25,fontVariantNumeric:'tabular-nums'}}>{s.detail}</span>
                        </div>
                      ))}
                    </div>

                    {/* SQGLP pillar bars */}
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {(r.pillarScores || []).map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.split(' ')[0].slice(0,4)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Coverage + kill-switch + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {r.redFlags.length>0&&<span style={{fontSize:F.xs,color:hasCrit?RED:ORANGE}}>⚠{r.redFlags.length}</span>}
                      {/* Kill-switch badge — N/8 tests pass */}
                      {(() => {
                        const ks = r.killSwitch ?? [];
                        const tested = ks.filter(t => t.checks.some(c=>c.pass!==null));
                        if (tested.length < 4) return null;
                        const passed = tested.filter(t=>t.pass).length;
                        const col = passed>=6?GREEN:passed>=4?YELLOW:ORANGE;
                        return <span title="Kill-switch: N/8 tests pass" style={{fontSize:9,fontWeight:700,color:col}}>🛡{passed}/{tested.length}</span>;
                      })()}
                      {/* PATCH 0056: Reinvestment Engine verdict (data from patch 0055) */}
                      {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                        const verdict = r.reinvestment.verdict;
                        const score = r.reinvestment.score;
                        const col = verdict === 'COMPOUNDING' ? GREEN
                                  : verdict === 'BUILDING' ? '#22d3ee'
                                  : verdict === 'STALLING' ? RED
                                  : MUTED;
                        const icon = verdict === 'COMPOUNDING' ? '⚙' : verdict === 'BUILDING' ? '↗' : verdict === 'STALLING' ? '✗' : '·';
                        const lbl = verdict === 'COMPOUNDING' ? 'COMP' : verdict === 'BUILDING' ? 'BUILD' : verdict === 'STALLING' ? 'STALL' : 'ord';
                        return (
                          <span title={`Reinvestment Engine ${score}/100 — ${r.reinvestment.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {score}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Dilution verdict (data from patch 0055) */}
                      {r.dilution && r.dilution.verdict !== 'NA' && r.dilution.verdict !== 'NEUTRAL' && (() => {
                        const v = r.dilution.verdict;
                        const drag = r.dilution.drag_pp;
                        const col = v === 'SEVERELY_DILUTIVE' ? RED
                                  : v === 'DILUTIVE' ? ORANGE
                                  : GREEN;
                        const icon = v === 'SEVERELY_DILUTIVE' || v === 'DILUTIVE' ? '⤓' : '⤒';
                        const lbl = v === 'SEVERELY_DILUTIVE' ? 'DIL!!' : v === 'DILUTIVE' ? 'DIL' : 'ACCR';
                        return (
                          <span title={`Dilution: ${r.dilution.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {drag !== null ? (drag > 0 ? '+' : '') + drag.toFixed(1) + 'pp' : ''}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Framework data coverage indicator */}
                      {r.framework_coverage && (() => {
                        const conf = r.framework_coverage.confidence;
                        const pct = r.framework_coverage.coverage_pct;
                        const col = conf === 'HIGH' ? GREEN : conf === 'MEDIUM' ? YELLOW : ORANGE;
                        return (
                          <span title={`Framework coverage: ${pct}% of ideal data present. ${r.framework_coverage.note}`}
                                style={{fontSize:9,fontWeight:600,color:col,opacity:0.85}}>
                            ◔ {pct}%
                          </span>
                        );
                      })()}
                      {/* PATCH 0058: Archetype match badge — most important addition */}
                      {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                        const s = r.archetype.strength;
                        const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                        const icon = s === 'STRONG' ? '🎯' : s === 'PARTIAL' ? '◓' : '○';
                        const archShort = (r.archetype.closest_archetype ?? '').replace(/\s\d+$/, '');
                        return (
                          <span title={`Closest historical 100× archetype: ${r.archetype.closest_archetype} (${r.archetype.ten_year_return_x}×). Match strength ${s}. Score ${r.archetype.match_score}/100.\n\n${r.archetype.verdict}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {archShort.length > 14 ? archShort.slice(0, 12) + '…' : archShort} ({r.archetype.match_score})
                          </span>
                        );
                      })()}
                      {/* PATCH 0327 — Score-change vs prev upload, upgraded to
                          institutional-visible chip. Shows prior score in
                          hover tooltip. "NEW" chip for stocks with no prior. */}
                      {(() => {
                        const prev = prevScoreMap[r.symbol];
                        if (prev === undefined) {
                          return (
                            <span
                              title="No prior score on file — this is a new entry since the last Multibagger upload."
                              style={{
                                fontSize: 9, fontWeight: 700, color: PURPLE,
                                border: `1px solid ${PURPLE}60`,
                                backgroundColor: `${PURPLE}14`,
                                padding: '1px 5px', borderRadius: 3,
                                letterSpacing: 0.3,
                              }}
                            >NEW</span>
                          );
                        }
                        const delta = r.score - prev;
                        if (delta === 0) {
                          return (
                            <span
                              title={`Score unchanged from prior upload (${prev}).`}
                              style={{ fontSize: 9, fontWeight: 700, color: MUTED }}
                            >=</span>
                          );
                        }
                        const tone = delta > 0 ? GREEN : RED;
                        const arrow = delta > 0 ? '▲' : '▼';
                        return (
                          <span
                            title={`Score changed from ${prev} → ${r.score} since prior upload (${delta > 0 ? '+' : ''}${delta} pts).`}
                            style={{
                              fontSize: 10, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 6px', borderRadius: 3,
                              letterSpacing: 0.3,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >{arrow} {delta > 0 ? '+' : ''}{delta}</span>
                        );
                      })()}
                    </div>
                  </div>
                </button>

                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (per-stock BUY/WATCH/NEUTRAL/REJECTED + reason) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="IN" score={r.score} grade={r.grade} currentPrice={(r as any).cmp} bump={bumpDecisions} />
                    {/* PATCH 1056 — Two-column layout. LEFT = numbers / audit / fraud
                        (the analytical "facts" column). RIGHT = AI guidance + analysis
                        + framework (the narrative "judgment" column). Reduces vertical
                        scroll by ~50% on wide screens; gracefully stacks to 1-col
                        below 1100px so mobile/narrow windows still work. */}
                    <div style={{display:'grid',gridTemplateColumns:'minmax(280px, 1fr) minmax(360px, 1.4fr)',gap:18,alignItems:'flex-start'}}>
                      {/* ═════ LEFT COLUMN — METRICS + SCORE AUDIT + FRAUD RISK ═════ */}
                      <div style={{display:'flex',flexDirection:'column',gap:14,minWidth:0}}>
                      {/* Metrics by group */}
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>ALL METRICS</div>
                        {METRICS.filter(([field])=>(r[field]!==undefined&&r[field]!==null)).map(([field,label,group])=>{
                          const v=r[field] as number;
                          const isPercent=label.includes('%');
                          const isX=label.includes('x')||field==='peg'; // PATCH 1029: PEG label has no 'x' suffix; treat as multiplier
                          const isCr=label.includes('Cr');
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}<span style={{fontSize:F.xs,color:`${MUTED}70`,marginLeft:4}}>[{group}]</span></span>
                              <span style={{color:TEXT,fontWeight:700}}>{isCr?`₹${v.toLocaleString()}`:isX?`${v.toFixed(field==='de'||field==='cfoToPat'||field==='peg'||field==='netDebtEbitda'||field==='opLeverageRatio'?2:1)}×`:`${v.toFixed(1)}%`}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* PATCH 0316 — SCORING AUDIT BREAKDOWN. Shows the caps
                          that fired and the count of each severity tier so
                          the user can see at-a-glance why a stock landed at
                          its score (e.g. "1 STRUCTURAL HIGH → cap 60"). */}
                      {(() => {
                        const crit = r.redFlags.filter(f => f.severity === 'CRITICAL').length;
                        const structHigh = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
                        const cycHigh = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
                        const meds = r.redFlags.filter(f => f.severity === 'MEDIUM').length;
                        const cap = crit > 0 ? 38
                          : structHigh >= 2 ? 48
                          : structHigh >= 1 ? 60
                          : cycHigh >= 2 ? 62
                          : cycHigh >= 1 ? 72
                          : 100;
                        const govWatch = (r as any).governanceWatch;
                        return (
                          <div style={{marginBottom:12,padding:'10px 12px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:8}}>
                            <div style={{fontSize:F.xs,fontWeight:800,letterSpacing:'0.7px',color:ACCENT,marginBottom:8}}>📋 SCORE AUDIT — WHY {r.score}?</div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:8,fontSize:F.xs}}>
                              <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${BORDER}`,color:TEXT}}>Composite: <strong>{r.score}</strong> · Grade <strong style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</strong></span>
                              {crit > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>{crit} CRITICAL · cap 38</span>}
                              {structHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ORANGE}60`,backgroundColor:`${ORANGE}14`,color:ORANGE,fontWeight:700}}>{structHigh} HIGH structural · cap {structHigh>=2?48:60}</span>}
                              {cycHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${YELLOW}60`,backgroundColor:`${YELLOW}14`,color:YELLOW,fontWeight:700}}>{cycHigh} HIGH cyclical · cap {cycHigh>=2?62:72}</span>}
                              {meds > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>{meds} MEDIUM · −{meds*5}</span>}
                              {govWatch && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>🛑 GOVERNANCE WATCH · cap 65</span>}
                              {r.accelSignal === 'DECELERATING' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,color:RED,fontWeight:700}}>DECELERATING · cap 52</span>}
                              {r.bucket === 'MONITOR' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>MONITOR bucket · cap 45</span>}
                              {cap < 100 && (
                                <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ACCENT}60`,backgroundColor:`${ACCENT}14`,color:ACCENT,fontWeight:700}}>
                                  Active cap: {cap}{r.score < cap ? '' : ' (binding)'}
                                </span>
                              )}
                              {/* PATCH 1030: mcap > ₹20kCr forces grade cap at B (multibagger math floor) — surface it honestly */}
                              {(r.marketCapCr ?? 0) > 20000 && (
                                <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ORANGE}60`,backgroundColor:`${ORANGE}14`,color:ORANGE,fontWeight:700}}>MCap &gt; ₹20kCr · grade capped at B (multibagger math)</span>
                              )}
                              {cap === 100 && r.redFlags.length === 0 && (r.marketCapCr ?? 0) <= 20000 && (
                                <span style={{padding:'2px 8px',borderRadius:4,color:GREEN,fontWeight:700}}>No red-flag caps active — score is uncapped</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {/* PATCH 1045 — FRAUD RISK panel: counts fraud:* flags from PATCH 1044's computeFraudRiskFlags */}
                      {(() => {
                        const fraudFlags = r.redFlags.filter(f => f.source && f.source.startsWith('fraud:'));
                        const critF = fraudFlags.filter(f => f.severity === 'CRITICAL').length;
                        const highF = fraudFlags.filter(f => f.severity === 'HIGH').length;
                        const medF  = fraudFlags.filter(f => f.severity === 'MEDIUM').length;
                        const fraudScore = Math.min(100, critF*30 + highF*15 + medF*5);
                        const FRAUD_RULES_TOTAL = 19; // PATCH 1101j — added C7 revenue-inflation archetype (Rajesh Exports)
                        const passed = FRAUD_RULES_TOTAL - fraudFlags.length;
                        const verdict = critF>=2?'NEVER BUY': critF>=1?'AVOID': highF>=2?'HIGH RISK': highF>=1?'CAUTION': medF>=2?'MINOR FLAGS':'CLEAN';
                        const color = critF>=1?RED: highF>=1?ORANGE: medF>=1?YELLOW:GREEN;
                        return (
                          <div style={{marginTop:14,marginBottom:10,padding:'10px 14px',backgroundColor:`${color}10`,border:`1px solid ${color}40`,borderRadius:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                              <span style={{fontSize:F.sm,fontWeight:800,color:color,letterSpacing:'0.5px'}}>🛡 FRAUD RISK</span>
                              <span style={{fontSize:F.md,fontWeight:900,color:color}}>{verdict}</span>
                              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>Score: <strong style={{color:color}}>{fraudScore}/100</strong></span>
                              <span style={{fontSize:F.xs,color:MUTED}}>· {passed}/{FRAUD_RULES_TOTAL} fraud checks passed</span>
                              {critF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${RED}20`,color:RED,fontWeight:700}}>{critF} CRITICAL</span>}
                              {highF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${ORANGE}20`,color:ORANGE,fontWeight:700}}>{highF} HIGH</span>}
                              {medF>0 && <span style={{fontSize:F.xs,padding:'1px 6px',borderRadius:3,backgroundColor:`${YELLOW}20`,color:YELLOW,fontWeight:700}}>{medF} MEDIUM</span>}
                            </div>
                            {fraudFlags.length === 0 && (
                              <div style={{fontSize:F.xs,color:MUTED,marginTop:4}}>✓ No fraud patterns detected: earnings-without-cash, pledge cascade, smart-money exit, operator/shell, ghost ROCE, banking NPA proxy, debtor buildup, rollup proxy, ICR leverage, microcap stretch — all clean.</div>
                            )}
                            {fraudFlags.length > 0 && (
                              <div style={{marginTop:6}}>
                                {fraudFlags.map((f,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:f.severity==='CRITICAL'?RED:f.severity==='HIGH'?ORANGE:YELLOW,padding:'2px 0'}}>▸ [{f.severity}] {f.label}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      </div>
                      {/* ═════ RIGHT COLUMN — AI GUIDANCE + STRENGTHS/RISKS + FRAMEWORK ═════ */}
                      <div style={{display:'flex',flexDirection:'column',gap:14,minWidth:0}}>
                      {/* PATCH 1052 — Rich AI Guidance panel. Shows full
                          rationale, direct quotes, hard numbers (metric/value/period)
                          and forward catalysts (event/timing) when the row has a
                          cached entry from the Haiku forward-guidance API.
                          Hidden when no AI guidance fetched for this ticker. */}
                      {(() => {
                        const ai = aiGuidanceMap[(r.symbol || '').toUpperCase()];
                        if (!ai) return null;
                        const tierColor = ai.tier === 'EXCELLENT' ? '#10B981' : ai.tier === 'POSITIVE' ? '#34D399' : ai.tier === 'NEUTRAL' ? '#94A3B8' : ai.tier === 'CAUTIOUS' ? '#F59E0B' : ai.tier === 'NEGATIVE' ? '#EF4444' : '#6B7280';
                        const tierIcon = ai.tier === 'EXCELLENT' ? '🚀' : ai.tier === 'POSITIVE' ? '▲' : ai.tier === 'NEUTRAL' ? '●' : ai.tier === 'CAUTIOUS' ? '▽' : ai.tier === 'NEGATIVE' ? '⚠' : '◌';
                        const ageDays = Math.floor((Date.now() - ai.fetchedAt) / 86_400_000);
                        return (
                          <div style={{marginBottom:12,padding:'10px 12px',backgroundColor:`${tierColor}08`,border:`1px solid ${tierColor}30`,borderLeft:`3px solid ${tierColor}`,borderRadius:7}}>
                            <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                              <span style={{fontSize:F.sm,fontWeight:800,color:tierColor,letterSpacing:'0.5px'}}>🤖 AI FORWARD GUIDANCE</span>
                              <span style={{fontSize:F.xs,fontWeight:700,color:tierColor}}>{tierIcon} {ai.tier} · {ai.score >= 0 ? '+' : ''}{ai.score.toFixed(2)}</span>
                              <span style={{fontSize:F.xs,color:MUTED}}>· {ai.period} · fetched {ageDays}d ago</span>
                              {ai.sourceUrl && <a href={ai.sourceUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:F.xs,color:'var(--mc-cyan)',marginLeft:'auto',textDecoration:'none'}}>↗ Source</a>}
                            </div>
                            {(ai.rationale || ai.summary) && (
                              <div style={{fontSize:F.sm,color:TEXT,lineHeight:1.5,marginBottom:8}}>
                                {ai.rationale || ai.summary}
                              </div>
                            )}
                            {Array.isArray(ai.numbers) && ai.numbers.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-cyan)',letterSpacing:'0.4px',marginBottom:4}}>📊 NUMBERS</div>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:6}}>
                                  {ai.numbers.map((n,i) => (
                                    <div key={i} style={{fontSize:F.xs,padding:'4px 6px',backgroundColor:CARD2,borderRadius:4,fontVariantNumeric:'tabular-nums'}}>
                                      {n.metric && <span style={{color:MUTED}}>{n.metric}: </span>}
                                      {n.value && <span style={{color:TEXT,fontWeight:700}}>{n.value}</span>}
                                      {n.period && <span style={{color:MUTED,fontSize:9}}> · {n.period}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {Array.isArray(ai.catalysts) && ai.catalysts.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-warn)',letterSpacing:'0.4px',marginBottom:4}}>⚡ FORWARD CATALYSTS</div>
                                {ai.catalysts.map((c,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0',lineHeight:1.4}}>
                                    › <span style={{color:TEXT}}>{c.event}</span>
                                    {c.timing && <span style={{color:'var(--mc-warn)',fontWeight:700}}> · {c.timing}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {Array.isArray(ai.quotes) && ai.quotes.length > 0 && (
                              <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${tierColor}30`}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-state-persistent)',letterSpacing:'0.4px',marginBottom:4}}>💬 KEY QUOTES (CONCALL)</div>
                                {ai.quotes.map((q,i) => (
                                  <div key={i} style={{fontSize:F.xs,color:MUTED,padding:'4px 0',lineHeight:1.45,borderLeft:`2px solid ${tierColor}30`,paddingLeft:8,marginBottom:3,fontStyle:'italic'}}>
                                    "{q.quote}"{q.speaker && <span style={{color:'var(--mc-state-persistent)',fontStyle:'normal',fontWeight:700}}> — {q.speaker}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
{/* Analysis */}
                      <div>
                        {r.strengths.length>0&&(() => {
                          // PATCH 1056 — Strengths grouped by pillar so 17 bullets aren't
                          // an undifferentiated wall. Heuristic: classify each bullet by
                          // the metric/keyword it cites. Keeps the engine output untouched
                          // — purely a display rollup. Pillars match the SQGLP framework.
                          type Pillar = {key:string;label:string;icon:string;col:string;keys:RegExp};
                          const PILLARS: Pillar[] = [
                            {key:'quality', label:'Quality',         icon:'◆', col:'#a78bfa', keys:/roce|roe|opm|gpm|roic|cfo|fcf|cash|moat|incremental/i},
                            {key:'growth',  label:'Growth & Accel',  icon:'▲', col:'#38bdf8', keys:/cagr|growth|acceler|profit|sales|eps|inflection|breakout|leverage|trajectory|engine/i},
                            {key:'fin',     label:'Balance Sheet',   icon:'■', col:'#34d399', keys:/debt|pledge|d\/e|leverage|interest|coverage|net cash|debt-free/i},
                            {key:'ownership',label:'Ownership',      icon:'◉', col:'#f59e0b', keys:/promoter|fii|dii|founder|institution|insider|conviction|ownership|mnc/i},
                            {key:'value',   label:'Valuation',       icon:'$', col:'#22d3ee', keys:/peg|p\/e|valuation|mos|margin of safety|fcf yield|ev\/ebitda|undervalued/i},
                            {key:'tech',    label:'Trend / Market',  icon:'~', col:'#10b981', keys:/dma|trend|52w|re-rating|technical|near 52w/i},
                            {key:'dna',     label:'DNA / Archetype', icon:'◆', col:'#ef4444', keys:/dna|archetype|bagger|page|astral|avanti|caplin|symphony|bajaj|eicher/i},
                          ];
                          const groups: Record<string,string[]> = Object.fromEntries(PILLARS.map(p=>[p.key,[]]));
                          const orphans: string[] = [];
                          for (const s of r.strengths) {
                            let placed = false;
                            for (const p of PILLARS) {
                              if (p.keys.test(s)) { groups[p.key].push(s); placed = true; break; }
                            }
                            if (!placed) orphans.push(s);
                          }
                          return (
                            <>
                              <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,letterSpacing:'0.8px',marginBottom:6}}>✅ STRENGTHS <span style={{color:MUTED,fontWeight:600,fontSize:F.xs}}>({r.strengths.length})</span></div>
                              {PILLARS.filter(p=>groups[p.key].length>0).map(p=>(
                                <div key={p.key} style={{marginBottom:6}}>
                                  <div style={{fontSize:9,fontWeight:800,color:p.col,letterSpacing:0.4,marginBottom:2}}>{p.icon} {p.label.toUpperCase()} <span style={{color:MUTED,fontWeight:600}}>({groups[p.key].length})</span></div>
                                  {groups[p.key].map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0 2px 14px',lineHeight:1.4}}>› {s}</div>)}
                                </div>
                              ))}
                              {orphans.length>0 && (
                                <div style={{marginBottom:6}}>
                                  <div style={{fontSize:9,fontWeight:800,color:'var(--mc-text-3)',letterSpacing:0.4,marginBottom:2}}>· OTHER ({orphans.length})</div>
                                  {orphans.map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0 2px 14px',lineHeight:1.4}}>› {s}</div>)}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {r.risks.length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>⚠️ RISKS <span style={{color:MUTED,fontWeight:600,fontSize:F.xs}}>({r.risks.length})</span></div>
                          {r.risks.map((s,i)=><div key={i} style={{fontSize:F.xs,color:MUTED,padding:'2px 0',lineHeight:1.4}}>› {s}</div>)}
                        </>}
                        
                        {r.redFlags.length>0&&<>
                          <div style={{fontSize:F.sm,color:RED,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>🚨 RED FLAGS</div>
                          {r.redFlags.map((f,i)=>{
                            const isStruct = (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL';
                            const cost = f.severity === 'CRITICAL' ? -25 : f.severity === 'HIGH' ? (isStruct ? -12 : -6) : -5;
                            return (
                              <div key={i} style={{fontSize:F.md,color:f.severity==='CRITICAL'?RED:ORANGE,padding:'3px 0'}}>
                                ⛔ {f.label}
                                <span style={{fontSize:F.xs,color:f.severity==='CRITICAL'?RED:ORANGE,fontWeight:700,marginLeft:6}}>{cost} pts</span>
                                <span style={{fontSize:F.xs,color:MUTED,marginLeft:6}}>[{f.severity} · {isStruct?'structural':'cyclical'} · {f.source}]</span>
                              </div>
                            );
                          })}
                        </>}

                        {/* ── PATCH 0056+0058: MULTIBAGGER FRAMEWORK PANEL ── */}
                        {(r.dilution || r.reinvestment || r.framework_coverage || r.archetype) && (
                          <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                            <div style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:'var(--mc-cyan)',marginBottom:10}}>
                              🧬 MULTIBAGGER FRAMEWORK ANALYSIS
                            </div>
                            {/* PATCH 0058: Archetype card — featured first */}
                            {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                              const s = r.archetype.strength;
                              const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                              return (
                                <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${col}10`,border:`1px solid ${col}40`,borderLeft:`3px solid ${col}`,borderRadius:7}}>
                                  <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}}>
                                    <span style={{fontSize:F.sm,fontWeight:800,color:col,letterSpacing:'0.5px'}}>
                                      🎯 ARCHETYPE MATCH: {s}
                                    </span>
                                    <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{r.archetype.closest_archetype}</span>
                                    <span style={{fontSize:F.xs,color:GREEN,fontWeight:700}}>{r.archetype.ten_year_return_x}× in 10y</span>
                                    <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>match score {r.archetype.match_score}/100</span>
                                  </div>
                                  <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.5,marginBottom:8}}>{r.archetype.verdict}</div>
                                  {r.archetype.matching_dimensions.length > 0 && (
                                    <div style={{marginBottom:6}}>
                                      <div style={{fontSize:9,color:GREEN,fontWeight:700,marginBottom:3}}>✓ MATCHING DIMENSIONS</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.matching_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${GREEN}15`,color:GREEN,border:`1px solid ${GREEN}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {r.archetype.missing_dimensions.length > 0 && (
                                    <div>
                                      <div style={{fontSize:9,color:ORANGE,fontWeight:700,marginBottom:3}}>⚠ MISSING vs ARCHETYPE</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.missing_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${ORANGE}15`,color:ORANGE,border:`1px solid ${ORANGE}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {r.archetype && r.archetype.strength === 'NO_MATCH' && (
                              <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${MUTED}10`,border:`1px solid ${MUTED}40`,borderLeft:`3px solid ${MUTED}`,borderRadius:7}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:MUTED,marginBottom:4}}>○ NO ARCHETYPE MATCH</div>
                                <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{r.archetype.verdict}</div>
                              </div>
                            )}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:8}}>
                              {/* PATCH 0066: ROIC vs sector WACC */}
                              {r.roic_vs_wacc && r.roic_vs_wacc.verdict !== 'NA' && (() => {
                                const v = r.roic_vs_wacc.verdict;
                                const col = v==='VALUE_CREATING'?GREEN:v==='VALUE_DESTROYING'?RED:MUTED;
                                const label = v.replace('_',' ').toLowerCase();
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>📈 ROIC vs WACC</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{label}</span>
                                      {r.roic_vs_wacc.spread_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.roic_vs_wacc.spread_pp >= 0 ? '+' : ''}{r.roic_vs_wacc.spread_pp.toFixed(1)}pp
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.roic_vs_wacc.note}</div>
                                  </div>
                                );
                              })()}
                              {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                                const v = r.reinvestment.verdict;
                                const col = v==='COMPOUNDING'?GREEN:v==='BUILDING'?'#22d3ee':v==='STALLING'?RED:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>⚙ Reinvestment Engine</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{r.reinvestment.score}/100</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.reinvestment.note}</div>
                                  </div>
                                );
                              })()}
                              {r.dilution && r.dilution.verdict !== 'NA' && (() => {
                                const v = r.dilution.verdict;
                                const col = v==='SEVERELY_DILUTIVE'?RED:v==='DILUTIVE'?ORANGE:v==='ACCRETIVE'?GREEN:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{v.includes('DILUTIVE')?'⤓':'⤒'} Dilution Trajectory</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v.replace('_',' ')}</span>
                                      {r.dilution.drag_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.dilution.drag_pp > 0 ? '+' : ''}{r.dilution.drag_pp.toFixed(1)}pp drag
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.dilution.note}</div>
                                  </div>
                                );
                              })()}
                              {r.framework_coverage && (() => {
                                const c = r.framework_coverage;
                                const col = c.confidence==='HIGH'?GREEN:c.confidence==='MEDIUM'?YELLOW:ORANGE;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>◔ Framework Coverage</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{c.confidence}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{c.coverage_pct}%</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4,marginBottom:4}}>{c.note}</div>
                                    {c.missing.length > 0 && c.missing.length <= 6 && (
                                      <div style={{fontSize:9,color:'var(--mc-text-4)',lineHeight:1.4}}>
                                        Missing: {c.missing.join(', ')}
                                      </div>
                                    )}
                                    {c.missing.length > 6 && (
                                      <div style={{fontSize:9,color:'var(--mc-text-4)',lineHeight:1.4}}>
                                        Missing {c.missing.length} fields incl. {c.missing.slice(0,3).join(', ')}…
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* PATCH 1054 — Compact dimensions table. Replaces the 5-card
                                grid with a dense status table — institutional style: status
                                column, dimension column, one-line explanation. Hint hidden
                                inside hover-tooltip to avoid visual noise. */}
                            {r.missing_dimensions && r.missing_dimensions.length > 0 && (
                              <div style={{marginTop:10,padding:'8px 12px',backgroundColor:`${MUTED}05`,border:`1px solid ${MUTED}20`,borderLeft:`3px solid ${MUTED}`,borderRadius:6}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-text-3)',marginBottom:6,letterSpacing:0.4,display:'flex',alignItems:'baseline',gap:8}}>
                                  <span>FRAMEWORK BOUNDARY</span>
                                  <span style={{color:MUTED,fontSize:9,fontWeight:600}}>· qualitative dimensions outside Screener export · verify manually for high-conviction picks</span>
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'auto auto 1fr',rowGap:3,columnGap:10,fontSize:F.xs,lineHeight:1.4}}>
                                  {r.missing_dimensions.map((d, i) => {
                                    const col = d.status === 'MEASURED' ? GREEN : d.status === 'PROXY' ? YELLOW : ORANGE;
                                    const icon = d.status === 'MEASURED' ? '●' : d.status === 'PROXY' ? '◐' : '○';
                                    const tip = d.upload_hint && d.status !== 'MEASURED' ? `${d.explanation}\n→ ${d.upload_hint}` : d.explanation;
                                    return (
                                      <React.Fragment key={i}>
                                        <span style={{color:col,fontWeight:700}}>{icon} {d.status}</span>
                                        <span style={{color:TEXT,fontWeight:600}}>{d.dimension}</span>
                                        <span title={tip} style={{color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.explanation}</span>
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── 8-TEST KILL-SWITCH PANEL ── */}
                        {r.killSwitch && r.killSwitch.length > 0 && (() => {
                          const tested = r.killSwitch.filter(t => t.checks.some(c => c.pass !== null));
                          if (tested.length === 0) return null;
                          const passed = tested.filter(t => t.pass).length;
                          const failed = tested.filter(t => !t.pass).length;
                          const pColor = passed >= 6 ? GREEN : passed >= 4 ? YELLOW : ORANGE;
                          return (
                            <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                                <span style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:PURPLE}}>🛡 8-TEST KILL-SWITCH</span>
                                <span style={{fontSize:F.xs,color:pColor,fontWeight:700}}>{passed}/{tested.length} pass</span>
                                {failed > 0 && <span style={{fontSize:F.xs,color:failed>=5?RED:ORANGE}}>· {failed} fail{failed>=4?' (grade capped)':''}</span>}
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                                {r.killSwitch.map(t => {
                                  const hasTested = t.checks.some(c => c.pass !== null);
                                  const tColor = !hasTested ? MUTED : t.pass ? GREEN : ORANGE;
                                  const passedC = t.checks.filter(c=>c.pass===true).length;
                                  const failedC = t.checks.filter(c=>c.pass===false).length;
                                  return (
                                    <details key={t.id} style={{backgroundColor:CARD2,border:`1px solid ${tColor}30`,borderLeft:`3px solid ${tColor}`,borderRadius:7,padding:'8px 10px'}}>
                                      <summary style={{cursor:'pointer',listStyle:'none',display:'flex',alignItems:'center',gap:6,userSelect:'none'}}>
                                        <span style={{fontSize:14}}>{t.icon}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:TEXT,flex:1}}>{t.label}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:tColor}}>
                                          {!hasTested ? '⬜ No data' : t.pass ? `✅ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}` : `❌ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}`}
                                        </span>
                                      </summary>
                                      <div style={{marginTop:8,borderTop:`1px solid ${BORDER}`,paddingTop:6}}>
                                        {t.checks.map((c,ci)=>(
                                          <div key={ci} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'3px 0'}}>
                                            <span style={{fontSize:12,flexShrink:0,marginTop:1}}>
                                              {c.pass===true?'✅':c.pass===false?'❌':'⬜'}
                                            </span>
                                            <div>
                                              <div style={{fontSize:F.xs,fontWeight:600,color:c.pass===true?GREEN:c.pass===false?RED:MUTED}}>{c.label}</div>
                                              <div style={{fontSize:10,color:`${MUTED}CC`,lineHeight:1.4}}>{c.detail}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </details>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      </div>{/* PATCH 1056 — close RIGHT column */}
                    </div>
                    <div style={{fontSize:F.sm,color:MUTED,borderTop:`1px solid ${BORDER}`,paddingTop:8,marginTop:12}}>
                      <span>Sector: {r.sector}</span> · <span>Data: {r.coverage}%</span> ·
                      <span style={{color:BUCKET_CONFIG[r.bucket].color}}>{BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label}</span> ·
                      {r.reratingBonus!==0&&<span style={{color:r.reratingBonus>0?GREEN:RED}}>Rerating {r.reratingBonus>0?'+':''}{r.reratingBonus}pts</span>}
                      {r.ownershipCategory&&<span style={{color:OWNERSHIP_CONFIG[r.ownershipCategory].color,fontWeight:700}}>{OWNERSHIP_CONFIG[r.ownershipCategory].icon} {OWNERSHIP_CONFIG[r.ownershipCategory].label}: {OWNERSHIP_CONFIG[r.ownershipCategory].strategy}</span>}
                      {guidanceMode && (() => {
                        const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                        if (rAny.guidanceScore === undefined) return null;
                        const gColor = (rAny.guidanceScore ?? 0.5) >= 0.7 ? GREEN : (rAny.guidanceScore ?? 0.5) <= 0.3 ? RED : '#F59E0B';
                        return <span style={{color:gColor}}>Guidance {rAny.guidanceScore?.toFixed(1)} → score adj {rAny.guidanceAdj && rAny.guidanceAdj>0?'+':''}{rAny.guidanceAdj}pts</span>;
                      })()}
                      <span style={{color:MUTED,fontSize:F.xs}}>Wts: Q{r.pillarScores[0].weight}% G{r.pillarScores[1].weight}% L{r.pillarScores[2].weight}% F{r.pillarScores[3].weight}% V{r.pillarScores[4].weight}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!rows.length&&!loading&&!parseError&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>📤</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload Screener.in exports to score all stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            SQGLP framework (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework<br/>
            All {METRICS.length} fields scored · New: LONGEVITY pillar · Operating Leverage · Net Debt/EBITDA · FII/DII undiscovered check
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST TAB — 37 criteria, institutional scale, auto-checks from Excel data
// ═══════════════════════════════════════════════════════════════════════════════
