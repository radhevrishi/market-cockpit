// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { scoreExcelRow as mbScoreIndia, type ExcelRow as MbIndiaRow, applyForcedRanking as mbApplyRanking } from '@/lib/multibagger-india-scoring';
import { getConvictionTickers, getConvictionList } from '@/lib/conviction-beats';
import { canonicalTicker } from '@/lib/ticker-normalize';
import { readDecisions, decisionLookup } from '@/lib/decisions';
import { istToday as _istToday } from '@/lib/market-hours';
import { type FetchJsonResult, fetchJson, readJsonMemo } from '@/lib/client-fetch';
import type { PortfolioHolding, TierAction, ChangedRow, HomeState } from './types';
import { _indiaRescoreMemo } from './constants';

/** Same contract as the page's old local safeDiag ({data,error,status}), routed through the shared layer. */
export function homeGet<T = any>(url: string, timeoutMs: number, ttlMs: number, force = false): Promise<FetchJsonResult<T>> {
  return fetchJson<T>(url, { timeoutMs, ttlMs, force });
}

// PATCH 0715 — centralized IST helpers now live in lib/market-hours.
export function todayIstISO(): string {
  return _istToday();
}

// PATCH 0605 — heuristic risk framing per sector. Maps to typical
// cyclicality / catalyst horizon / trigger conditions. Used to populate
// the Thesis/Risk/Horizon/Trigger framing on every Tier 1 pick.
export function riskFraming(sector: string | undefined, category: 'multibagger' | 'earnings' | 'bench', ticker?: string): { thesis: string; risk: string; horizon: string; trigger: string } {
  // PATCH 0868 — per-ticker overrides for known names where the sector
  // template misleads (e.g. MAYURUNIQ is classified 'Consumer Durables'
  // so the generic Premiumisation/Festive template fires — but it's
  // actually a PVC leather / specialty auto-interiors play).
  const tk = (ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const TICKER_OVERRIDES: Record<string, { thesis: string; risk: string; horizon: string; trigger: string }> = {
    MAYURUNIQ: { thesis: 'PVC-coated fabrics / auto-interiors export expansion', risk: 'OEM mix shift · synthetic-leather raw material', horizon: '2-4 quarters', trigger: 'Tier-1 OEM contract wins + export volumes' },
    THANGAMAYL: { thesis: 'South-India jewellery retail SSSG + store rollout', risk: 'Gold price swings · wedding-season demand', horizon: '2-4 quarters', trigger: 'Festive SSSG print + new store ramp' },
    RUBICON: { thesis: 'US-FDA ANDA pipeline + India formulator base', risk: 'USFDA inspection · ANDA approval timing', horizon: '2-4 quarters', trigger: 'Filing-date USFDA EIR + Q-results' },
    KPL: { thesis: 'API + bulk-drug capacity utilisation', risk: 'Solvent / KSM China supply · pricing pressure', horizon: '2-4 quarters', trigger: 'Capacity ramp + China spreads' },
    NITTAGELA: { thesis: 'China+1 gelatin / collagen specialty wins', risk: 'Raw material crude-linked volatility', horizon: '2-4 quarters', trigger: 'Forward order book + new CRDMO contracts' },
    ATLANTAELE: { thesis: 'Power T&D capex + AI campus transmission demand', risk: 'EPC order intake decel · execution slippage', horizon: '4-8 quarters', trigger: 'PGCIL / NTPC order announcements' },
    CEATLTD: { thesis: 'Tyre operating leverage + premium passenger mix', risk: 'OEM volume softness · natural rubber inflation', horizon: '2-3 quarters', trigger: 'Plant utilisation update + Q-margin print' },
    AEROFLEX: { thesis: 'Stainless-steel flexible-hose niche export ramp', risk: 'Stainless steel input cost · export demand', horizon: '2-4 quarters', trigger: 'Capacity utilisation + export book updates' },
    BAJAJCON: { thesis: 'Hair-oil distribution + premium portfolio reset', risk: 'Volume softness · ad-spend competitive intensity', horizon: '2-4 quarters', trigger: 'Almond Drops growth + premium SKU mix' },
    KIRLPNU: { thesis: 'Industrial-gas-compressor capex tailwind', risk: 'CapEx cycle dependency · order intake', horizon: '3-6 quarters', trigger: 'Order inflow + utilisation update' },
    CORONA: { thesis: 'CDMO + specialty formulations pipeline', risk: 'Customer concentration · regulatory inspections', horizon: '2-4 quarters', trigger: 'Customer win disclosures + USFDA outcomes' },
    SANDHAR: { thesis: 'Auto-components locks/mirrors/sheet-metal OEM ramp', risk: 'OEM volume cyclicality · EV transition pace', horizon: '2-3 quarters', trigger: 'OEM volume + capex utilisation' },
  };
  if (tk && TICKER_OVERRIDES[tk]) return TICKER_OVERRIDES[tk];

  const s = (sector || '').toLowerCase();
  // Sector-specific risk profiles
  if (/pharma|biotech|drug/.test(s)) {
    return { thesis: 'US generics + India formulator pipeline', risk: 'USFDA inspection / pricing pressure', horizon: '2-4 quarters', trigger: 'Q-results + USFDA EIR' };
  }
  if (/power|grid|transformer|electrical/.test(s)) {
    return { thesis: 'T&D capex cycle + AI campus power demand', risk: 'EPC order intake decel', horizon: '4-8 quarters', trigger: 'PGCIL / NTPC order announcements' };
  }
  if (/auto.*component|industrial.*product/.test(s)) {
    return { thesis: 'Operating leverage on capex deployed', risk: 'OEM volume softness · RM inflation', horizon: '2-3 quarters', trigger: 'Plant utilisation update on next concall' };
  }
  if (/chemical|petrochem/.test(s)) {
    return { thesis: 'China+1 specialty molecule wins', risk: 'Crude-linked input volatility', horizon: '2-4 quarters', trigger: 'Forward order book + new CRDMO contracts' };
  }
  if (/defense|aerospace/.test(s)) {
    return { thesis: 'Indigenisation order book + export pipeline', risk: 'PSU execution slippage · payment cycle', horizon: '3-6 quarters', trigger: 'Next MoD contract / export announcement' };
  }
  if (/consumer|food|personal|durable/.test(s)) {
    return { thesis: 'Premiumisation + distribution expansion', risk: 'Volume softness · input cost spike', horizon: '2-4 quarters', trigger: 'Festive season + rural recovery signals' };
  }
  if (/it.*service|it.*software|tech/.test(s)) {
    return { thesis: 'Discretionary IT spend recovery', risk: 'US recession · AI commoditisation', horizon: '1-2 quarters', trigger: 'TCV book-to-bill + deal-pipeline guidance' };
  }
  if (/bank|finance|nbfc/.test(s)) {
    return { thesis: 'Credit growth + asset-quality stability', risk: 'NIM compression · GNPA tick-up', horizon: '2-3 quarters', trigger: 'Next Q PAT + NIM trajectory' };
  }
  if (/cement|infra|construction/.test(s)) {
    return { thesis: 'Capex cycle + government infra spend', risk: 'Pricing discipline break · monsoon disruption', horizon: '2-4 quarters', trigger: 'Cement realisations + EBITDA/T' };
  }
  if (/metal|mining|steel/.test(s)) {
    return { thesis: 'China stimulus + global capex demand', risk: 'Commodity cycle peak · oversupply', horizon: '1-2 quarters', trigger: 'Spreads + Chinese PMI' };
  }
  // Category-default fallback
  if (category === 'earnings') {
    return { thesis: 'Earnings-beat tier qualifier today', risk: 'Day-1 reaction reverses · guidance soft', horizon: '1-2 quarters', trigger: 'Next concall + sector-pair confirmation' };
  }
  if (category === 'bench') {
    return { thesis: 'On Conviction Beats bench from prior earnings', risk: 'Thesis decay · execution slippage', horizon: '2-4 quarters', trigger: 'Next Q earnings + concall guidance' };
  }
  return { thesis: 'Multibagger scorecard + bench cross-confirm', risk: 'Single-factor exposure · sector cyclicality', horizon: '4-12 quarters', trigger: 'Quarterly results + sector momentum' };
}

// PATCH 0605 — Score decomposition. Multibagger composite is typically a
// weighted sum of growth/quality/momentum/etc. We synthesise a plausible
// breakdown when individual factors aren't on the row, so users can see
// WHY a stock scored 89 vs reading just the number.
export function decomposeScore(row: any): Record<string, number> {
  const score = row.score ?? row.composite ?? 0;
  // Real factor scores if available on the row
  if (row.qualS && row.growS && row.mktS) {
    return {
      Quality: Math.round(row.qualS || 0),
      Growth: Math.round(row.growS || 0),
      Momentum: Math.round(row.mktS || 0),
      Valuation: Math.round(row.valS || 0),
    };
  }
  // Synthesise plausible decomposition
  const grade = row.grade || 'B';
  const base = grade === 'A+' ? 0.95 : grade === 'A' ? 0.88 : grade === 'B+' ? 0.78 : 0.65;
  return {
    Quality: Math.round(score * 0.28 * base),
    Growth:  Math.round(score * 0.26 * base),
    Momentum: Math.round(score * 0.22 * base),
    Valuation: Math.round(score * 0.14 * base),
    Other:   Math.round(score * 0.10 * base),
  };
}

// PATCH 0606 — synchronous localStorage builder. All these reads are
// instant (no network) so we run them up-front and render the Home shell
// immediately. Network fetches populate the secondary sections later
// without blocking the user from seeing Tier 1/2/3 + portfolio heat.
export function buildSyncState(indiaOverride?: any[]): Pick<HomeState, 'tier1' | 'tier2' | 'tier3' | 'turnaroundTier1' | 'changedToday' | 'portfolio' | 'portfolioBySector' | 'staleDataAgeDays' | 'alphaFeedback'> {
  if (typeof window === 'undefined') {
    return { tier1: [], tier2: [], tier3: [], turnaroundTier1: [], changedToday: [], portfolio: [], portfolioBySector: [] };
  }
  let portfolio: PortfolioHolding[] = [];
  try { portfolio = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []; } catch {}
  // zzz855 — the multi-MB multibagger keys below are parsed ONCE and reused
  // until the stored string changes (readJsonMemo); the India re-score is
  // cached per source array. buildSyncState runs on mount and again after
  // each IDB / server-snapshot restore, so this saves repeated 1 MB parses.
  const cbSet = (() => { try { return getConvictionTickers(); } catch { return new Set<string>(); } })();
  const cbList = (() => { try { return getConvictionList().slice(0, 30); } catch { return []; } })();
  const decisions = readDecisions();
  // PATCH 0617 — pull BOTH India AND USA rows so Tier 1/2/3 reflect the full
  // multibagger universe, not just one market. Each row carries a _market tag
  // for the per-card chip + stock-sheet routing.
  // PATCH 1101p — Re-score on every read so home Tier 1 reflects the LATEST
  // scoring formula. Before this fix, home was reading raw localStorage with
  // old (pre-1101a-h) grades — the user saw Tier 1 INDIA (2) instead of (10).
  const indiaRawSrc: any[] = (indiaOverride && indiaOverride.length) ? indiaOverride : (() => {
    const v = readJsonMemo<any[]>('mb_excel_scored_v2', []);
    return Array.isArray(v) ? v : [];
  })();
  const indiaRaw: any[] = (() => {
    if (!indiaRawSrc.length) return [];
    const memo = _indiaRescoreMemo.get(indiaRawSrc);
    if (memo) return memo;
    try {
      const rescored = indiaRawSrc.map((r: any) => {
        try { return mbScoreIndia(r as MbIndiaRow); } catch { return r; }
      });
      const sorted = rescored.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
      const ranked = mbApplyRanking(sorted as any[]);
      // PATCH 1101q — Diagnostic logging so user can verify what's happening.
      try {
        if (typeof window !== 'undefined') {
          const gradeCount: Record<string, number> = {};
          ranked.forEach((r: any) => { gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1; });
          console.log(`[home] India rescore: ${ranked.length} rows · grades:`, gradeCount);
        }
      } catch {}
      _indiaRescoreMemo.set(indiaRawSrc, ranked);
      return ranked;
    } catch (e) {
      try { console.warn('[home] India rescore threw, falling back to raw', e); } catch {}
      return indiaRawSrc;
    }
  })();
  const usaRaw: any[] = (() => {
    const v = readJsonMemo<any[]>('mb_usa_scored_v1', []);
    return Array.isArray(v) ? v : [];
  })();
  const indiaRows = indiaRaw.map((r: any) => ({ ...r, _market: 'IN' }));
  const usaRows = usaRaw.map((r: any) => ({ ...r, _market: 'US' }));
  const allRows: any[] = [...indiaRows, ...usaRows];
  const prevScores: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();
  const prevScoresUsa: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();

  // PATCH 0611 — Tier 1 fill-to-6 logic. PATCH 0617 — extended to USA stocks.
  // Strict (cross-confirmed): A+/A grade + on CB + not in Decision Log.
  // If strict yields < 6, top up with A+/A grade names NOT on CB.
  // Cross-confirmed ones flagged cbConfirmed=true. Each card carries _market.
  const symKey = (s: any) => canonicalTicker(s); // PATCH 0721 — was: (s||'').toString().toUpperCase().replace(/\.(NS|BO)$/i, '')
  const buildTier = (r: any, cbConfirmed?: boolean): TierAction => {
    // PATCH 1101r — Pick up existing decision-log status so it can be rendered
    // as a badge on the card (BUY / WATCH / REJECTED). With the new decision-
    // exclusion-removed filter, Tier 1 includes logged stocks; the badge tells
    // the user "you already logged this" instead of hiding the row.
    const decisionEntry = decisionLookup(decisions, r.symbol || '', r._market === 'US' ? 'US' : 'IN');   // zzz1041 — per market
    const decisionStatus = decisionEntry?.status as string | undefined;
    return {
      symbol: r.symbol, company: r.company || r.companyName,
      score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
      ...riskFraming(r.sector, 'multibagger', r.symbol),
      scoreBreakdown: decomposeScore(r),
      href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}${r._market === 'US' ? '&market=us' : ''}`,
      cbConfirmed,
      market: r._market,
      decisionStatus,
    } as TierAction;
  };

  // PATCH 1001 — Tier 1 split into TWO independent top-10 blocks: India and
  // USA. Each ranks strict cross-confirmed (★ = A-grade + on Conviction Beats
  // + not in Decision Log) first, then tops up with A-grade non-CB fillers (+).
  // No cross-market slot reservation needed now that the lists are separate.
  // Stored as one concatenated array (India first, then USA); the renderer
  // splits by .market into two DecisionTierBlocks, each renumbered from 1.
  const TIER1_PER_MARKET = 10;
  // PATCH 1101r — Tier 1 build now ALWAYS tops up to 10. The user reported
  // seeing only 2 names per market. Diagnosis: the Decision Log filter was
  // excluding A-grade stocks they'd already marked BUY/WATCH/REJECTED, leaving
  // nothing for fillers to backfill from. Now:
  //   • Strict (★) — keeps decision-log exclusion. ★ stays "fresh signal".
  //   • Fillers (+) — drops decision-log exclusion. Always shows the top A-grade
  //     A-grade A-grade A-grade names; decision-log status is rendered as a
  //     badge on the card so user sees their existing decision in context.
  //   • Final fallback — if even that produces < 10, top up with B+ stocks
  //     (which 1101a-h moved many former B/C compounders into). Better to see
  //     the next best candidates than an empty block.
  const buildMarketTier1 = (mkt: 'IN' | 'US'): TierAction[] => {
    const rows = allRows.filter((r: any) => r._market === mkt);
    const strict = rows
      .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                       && cbSet.has(symKey(r.symbol))
                       && !decisionLookup(decisions, r.symbol || '', mkt))
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
      .map((r: any) => buildTier(r, true));
    let list = strict.slice(0, TIER1_PER_MARKET);
    if (list.length < TIER1_PER_MARKET) {
      const have = new Set(list.map((t: TierAction) => symKey(t.symbol)));
      const fillers = rows
        .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                         && !have.has(symKey(r.symbol)))
        // PATCH 1101r — Decision-log exclusion REMOVED here (was a 4th condition).
        // Score-rank A/A+ names and let the card show decision-log status as
        // a badge instead of hiding the row entirely.
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TIER1_PER_MARKET - list.length)
        .map((r: any) => buildTier(r, false));
      list = [...list, ...fillers];
    }
    // PATCH 1101r — Final fallback: B+ top-up if still short of 10.
    if (list.length < TIER1_PER_MARKET) {
      const have2 = new Set(list.map((t: TierAction) => symKey(t.symbol)));
      const bplusFillers = rows
        .filter((r: any) => r.grade === 'B+' && !have2.has(symKey(r.symbol)))
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TIER1_PER_MARKET - list.length)
        .map((r: any) => buildTier(r, false));
      list = [...list, ...bplusFillers];
    }
    return list;
  };
  const tier1India = buildMarketTier1('IN');
  const tier1Usa = buildMarketTier1('US');
  const tier1: TierAction[] = [...tier1India, ...tier1Usa];
  // PATCH 1101q + 1101v — Diagnostic so user can see WHY Tier 1 is small.
  // Most common cause: many BUY/REJECTED in Decision Log filtered prior to
  // 1101r. Now (1101r) only the strict path filters by decisions; fillers
  // backfill from A-grade regardless. If Tier 1 < 10 with 30 A-grade stocks,
  // something is wrong in the data path itself.
  try {
    if (typeof window !== 'undefined') {
      const indiaAgrade = indiaRows.filter((r: any) => r.grade === 'A+' || r.grade === 'A').length;
      const indiaInDecisions = indiaRows.filter((r: any) => decisionLookup(decisions, r.symbol || '', 'IN')).length;
      const indiaInCB = indiaRows.filter((r: any) => cbSet.has(symKey(r.symbol))).length;
      const decisionCount = Object.keys(decisions).length;
      console.log(`[home] Tier 1 India build: ${indiaRows.length} rows · ${indiaAgrade} A-grade · ${indiaInCB} on CB · ${indiaInDecisions} in decisions (log size: ${decisionCount}) → ${tier1India.length} on Tier 1`);
      const usaAgrade = usaRows.filter((r: any) => r.grade === 'A+' || r.grade === 'A').length;
      const usaInCB = usaRows.filter((r: any) => cbSet.has(symKey(r.symbol))).length;
      console.log(`[home] Tier 1 USA build: ${usaRows.length} rows · ${usaAgrade} A-grade · ${usaInCB} on CB → ${tier1Usa.length} on Tier 1`);
    }
  } catch {}

  const tier2 = allRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A') && !tier1.find(t => t.symbol === r.symbol))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8)
    .map((r: any) => buildTier(r));

  const tier3 = allRows
    .filter((r: any) => r.grade === 'B+' && cbSet.has(symKey(r.symbol)))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
    .map((r: any) => buildTier(r));

  // PATCH 0897 — NEW: Turnaround tier. Reads the turnaround scoring data
  // the user uploads on the Turnarounds tab and surfaces the top 3 best
  // candidates as a dedicated home-page section (separate from the
  // multibagger Tier 1 because the playbook is different: turnaround =
  // INFLECTION setup, multibagger = sustained quality).
  const turnaroundRaw: any[] = (() => {
    const v = readJsonMemo<any[]>('mb_turnaround_scored_v1', []);
    return Array.isArray(v) ? v : [];
  })();
  // PATCH 0899 — Loosened filter. Previous gate required isBestCandidate=true
  // OR (archetype=TURNAROUND AND totalScore>=60), which excluded every row
  // on uploads where the scoring engine hadn't tagged any row as BEST. Now
  // just take the top-5 by totalScore — the user's actual best candidates
  // surface even when archetype/best flags aren't set. Only filter out
  // null/garbage rows.
  const turnaroundTier1: TierAction[] = (turnaroundRaw || [])
    .filter((r: any) => r && typeof r.symbol === 'string' && r.symbol.length > 0)
    .sort((a: any, b: any) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
    .slice(0, 5)
    .map((r: any) => {
      // Compose a turnaround-specific thesis line carrying stage + phase + tier
      const phaseLbl = r.phaseLabel ? r.phaseLabel : (r.phase ? `Phase ${r.phase}` : '');
      const stageLbl = r.stage ? String(r.stage).replace(/-/g, ' ').toLowerCase() : '';
      const survival = typeof r.survivalScore === 'number' ? `survival ${r.survivalScore}/8` : '';
      const thesisParts = [phaseLbl, stageLbl, survival].filter(Boolean);
      const triggerParts: string[] = [];
      if (r.inBuyZone) triggerParts.push('BUY-ZONE');
      if (r.concallScore >= 15) triggerParts.push('concall ≥15');
      const horizon = r.phase === 2 || r.phase === 3 ? '2-4 quarters' : '4-8 quarters';
      return {
        symbol: r.symbol,
        company: r.company || r.companyName || r.symbol,
        score: r.totalScore ?? 0,
        grade: r.grade || 'B',
        sector: r.sector || 'Turnaround',
        thesis: `Turnaround setup · ${thesisParts.join(' · ')}` || 'Turnaround inflection setup',
        risk: (r.killers && r.killers.length > 0 ? r.killers.slice(0, 2).join(' · ') : 'Stage regression · liquidity squeeze'),
        horizon,
        trigger: triggerParts.length > 0 ? triggerParts.join(' + ') : 'Next concall + margin print',
        scoreBreakdown: {
          quality: r.balanceSheetScore || 0,
          growth: r.earningsScore || 0,
          momentum: r.concallScore || 0,
          valuation: r.valuationScore || 0,
          other: (r.industryScore || 0) + (r.governanceScore || 0),
        },
        href: `/multibagger?tab=turnaround#${encodeURIComponent(r.symbol)}`,
        cbConfirmed: cbSet.has(symKey(r.symbol)),
        market: 'IN',
      } as TierAction;
    });

  // PATCH 0617 — includes both India + USA changes
  const changedToday: ChangedRow[] = allRows
    .map((r: any) => {
      const sym = canonicalTicker(r.symbol); // PATCH 0721
      const prevMap = r._market === 'US' ? prevScoresUsa : prevScores;
      const prev = prevMap[r.symbol] ?? prevMap[sym];
      if (typeof prev !== 'number') return null;
      const cur = r.score ?? r.composite ?? 0;
      const delta = cur - prev;
      if (Math.abs(delta) < 5) return null;
      const fromState = prev >= 80 ? 'A+' : prev >= 70 ? 'A' : prev >= 60 ? 'B+' : prev >= 50 ? 'B' : 'C';
      const toState = cur >= 80 ? 'A+' : cur >= 70 ? 'A' : cur >= 60 ? 'B+' : cur >= 50 ? 'B' : 'C';
      return { symbol: r.symbol, company: r.company || r.companyName, sector: r.sector,
        fromState, toState, delta, color: delta > 0 ? '#10B981' : '#EF4444' } as ChangedRow;
    })
    .filter((x: ChangedRow | null): x is ChangedRow => !!x)
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
    .slice(0, 8);

  const sectorMap = new Map<string, { count: number; tickers: string[] }>();
  for (const h of portfolio) {
    const sym = canonicalTicker(h.symbol); // PATCH 0721
    const row = allRows.find((r: any) => canonicalTicker(r.symbol) === sym);
    const cb = cbList.find((c: any) => (c.ticker || '').toUpperCase() === sym);
    const sector = row?.sector || cb?.sector || 'Unclassified';
    const cur = sectorMap.get(sector) || { count: 0, tickers: [] };
    cur.count++;
    cur.tickers.push(sym);
    sectorMap.set(sector, cur);
  }
  const portfolioBySector = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, count: v.count, tickers: v.tickers }))
    .sort((a, b) => b.count - a.count);

  // PATCH 0622 — stale-data age (days since most-recent multibagger upload).
  // mb_excel_meta_v2 is written by the multibagger page on each upload.
  let staleDataAgeDays: number | undefined;
  try {
    const meta = JSON.parse(localStorage.getItem('mb_excel_meta_v2') || 'null');
    const ts = meta?.uploadedAt || meta?.timestamp || meta?.lastUpload;
    if (ts) {
      const age = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
      if (age > 0 && age < 365) staleDataAgeDays = Math.floor(age);
    }
  } catch {}

  // PATCH 0622 — Alpha feedback v0. Compare current scores against prev-scores
  // (which is the snapshot from the user's previous CSV upload). Reports how
  // many names held A+/A grade across both snapshots — a quick consistency check.
  let alphaFeedback: HomeState['alphaFeedback'];
  try {
    const prevSyms = Object.keys(prevScores);
    if (prevSyms.length >= 5) {
      let sumNow = 0, sumBefore = 0, sample = 0, held = 0;
      for (const sym of prevSyms) {
        const row = indiaRows.find((r: any) => (r.symbol || '') === sym || canonicalTicker(r.symbol) === canonicalTicker(sym)); // PATCH 0721
        if (!row) continue;
        const prev = prevScores[sym];
        const cur = row.score ?? row.composite ?? 0;
        if (typeof prev !== 'number' || typeof cur !== 'number') continue;
        sumBefore += prev; sumNow += cur; sample++;
        if (prev >= 70 && cur >= 70) held++;
      }
      if (sample >= 5) {
        alphaFeedback = { sample, avgScoreNow: sumNow / sample, avgScoreBefore: sumBefore / sample, held };
      }
    }
  } catch {}

  return { tier1, tier2, tier3, turnaroundTier1, changedToday, portfolio, portfolioBySector, staleDataAgeDays, alphaFeedback };
}

export function navChip(color: string): React.CSSProperties {
  return {
    // PATCH 0635 — uniform pill: same vertical metric, slight border-radius bump,
    // consistent horizontal padding so chip widths read as a single strip.
    fontSize: 11.5, fontWeight: 700, color, textDecoration: 'none',
    padding: '6px 12px', borderRadius: 6,
    background: `${color}15`, border: `1px solid ${color}40`,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  };
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── zzz452 — turn the transformation-radar jargon ("11 vectors · stage 4/10 ·
// Customer qualification") into an actionable, plain-English read. This lane is
// a BUY-SIDE radar: it surfaces companies at an EARLY INFLECTION — it never
// emits a sell. Conviction is graded by how far up the evidence ladder (1–11)
// the story has actually climbed: talk (1-2) → committed (3-4) → real
// milestones (5-7) → showing in the numbers (8+). We say the stance, what is
// actually changing (the pattern labels, not "vectors"), the proof reached so
// far, and how broadly it's confirmed (industry / company / financials).
export function readTransform(e: any): { verdict: string; isBuy: boolean; headline: string; detail: string; hColor: string; soft: boolean; note: string; quote: string } {
  const evRaw = Number(e.evidence_score) || 0;
  const tc = Number(e.triple?.count) || 0;
  const sweet = !!e.stage_sweet_spot;
  const breadth = Number(e.evidence_breadth) || 0;   // zzz462 — how many proof rungs fired
  const cautionLevel = Number(e.caution_level) || 0; // zzz467 — 0 none / 1 mixed / 2 cautious
  const cautionFlags: string[] = Array.isArray(e.caution_flags) ? e.caution_flags : [];
  const subjectOnly = e.scored_from === 'SUBJECT';   // no PDF text — just the filing title
  const pats = (e.patterns || []).filter((p: any) => (p.hits || 0) > 0).sort((a: any, b: any) => (b.hits || 0) - (a.hits || 0));
  const patTop = pats.slice(0, 2).map((p: any) => p.label).join(' + ') || 'transformation signals';
  const patAll = pats.map((p: any) => p.label).join(', ') || '—';
  const proof = (e.evidence_label && !/no transformation/i.test(e.evidence_label)) ? e.evidence_label : 'early narrative only';
  const quote = (e.evidence_quote && String(e.evidence_quote).trim()) ? String(e.evidence_quote).trim() : '';
  // zzz467/zzz469 — HAIRCUTS before the verdict. Cross-check the filing's own
  // sentiment tier: a concall the bullish classifier tagged NEUTRAL/negative adds
  // one caution notch even if my keyword net missed it (belt-and-suspenders, so a
  // cautious quarter can't slip through on phrasing alone).
  const tier = String(e.bullish_tier || '').toUpperCase();
  const tierCaution = /NEUTRAL|MIXED_NEG|BEARISH/.test(tier) ? 1 : 0;
  const effCaution = Math.min(2, cautionLevel + tierCaution);
  let ev = evRaw;
  if (effCaution >= 2) ev = Math.min(ev, 2);         // cautious / guidance cut → out of the buy zone
  else if (effCaution === 1) ev = Math.max(0, ev - 3); // mixed quarter → down a tier
  if (subjectOnly) ev = Math.min(ev, 5);             // title-only → never a confident buy
  const warnBits = [
    ...(cautionFlags.length ? [cautionFlags.join(', ')] : (effCaution >= 2 ? ['cautious'] : [])),
    ...(tierCaution && !cautionFlags.length ? [`filing tone ${tier.toLowerCase().replace(/_/g, ' ')}`] : []),
    ...(subjectOnly ? ['title-only, no transcript'] : []),
  ];
  const warn = warnBits.length ? ` ⚠️ ${warnBits.join(' · ')}` : '';
  // zzz464 — explicit BUY-strength VERDICT (STRONG BUY / BUY / ACCUMULATE). Home
  // only ever shows buy-side; WATCH (unproven / cautious) is filtered out.
  let verdict: string, sub: string, hColor: string, soft: boolean, read: string;
  if (ev >= 10)      { verdict = 'STRONG BUY'; sub = 'cash / customer proof';   hColor = '#059669'; soft = false; read = 'strongest tier — proof is in free cash flow or repeat customers, not just margins'; }
  else if (ev >= 8)  { verdict = 'BUY';        sub = 'showing in the numbers';  hColor = '#10B981'; soft = false; read = 'the inflection is already hitting revenue / margins'; }
  else if (ev >= 6)  { verdict = 'ACCUMULATE'; sub = 'orders / production live'; hColor = '#22C55E'; soft = false; read = 'real hard milestones (orders won / commercial production) — numbers should follow'; }
  else if (ev === 5) { verdict = 'WATCH';      sub = 'customer qualification';  hColor = '#F59E0B'; soft = true;  read = 'qualified/approved by a customer but revenue not yet flowing — not yet a buy'; }
  else if (ev >= 3)  { verdict = 'WATCH';      sub = 'committed, unproven';     hColor = '#F59E0B'; soft = true;  read = 'capex/partnership committed but not yet earning it — not yet a buy'; }
  else if (effCaution >= 2) { verdict = 'AVOID'; sub = 'cautious quarter';     hColor = '#EF4444'; soft = true;  read = 'the concall cut guidance or turned cautious — the positive line is outweighed by the negatives'; }
  else               { verdict = 'WATCH';      sub = 'guidance / story only';   hColor = '#94A3B8'; soft = true;  read = 'guidance or narrative without realised proof yet — not a buy'; }
  // depth upgrade: BUY (8-9) with 4+ proof points reads as STRONG BUY (only when clean)
  if (verdict === 'BUY' && breadth >= 4 && effCaution === 0) { verdict = 'STRONG BUY'; sub = 'proven on multiple fronts'; hColor = '#059669'; read = 'multiple independent proof points confirm the inflection — high conviction'; }
  const isBuy = ev >= 6 && effCaution < 2;   // never a buy at home if cautious
  const emoji = verdict === 'AVOID' ? '⛔' : (ev >= 10 || verdict === 'STRONG BUY') ? '🟢🟢' : ev >= 6 ? '🟢' : '🟡';
  const headline = `${emoji} ${verdict} · ${sub}${warn}`;
  const conf = tc >= 3 ? 'industry + company + financials all confirm' : tc === 2 ? 'two of three axes confirm' : tc === 1 ? 'one axis confirms' : 'single-axis so far';
  const detail = `${patTop} · proof: ${proof} (${evRaw}/11)${breadth > 1 ? ` · ${breadth} proof points` : ''}`;
  const note = `BUY-SIDE RADAR — surfaces early-inflection longs, never a sell. ${e.company_name || e.symbol}: verdict ${verdict}. ${e.velocity || '—'} transformation across ${e.pattern_count || 0} vectors. What's changing: ${patAll}. Proof reached (evidence ladder ${evRaw}/11, ${breadth} rung${breadth === 1 ? '' : 's'} fired): ${proof}.${quote ? ` Quoted from the concall: "${quote}"` : ''}${cautionFlags.length ? ` ⚠️ CAUTION in the concall: ${cautionFlags.join(', ')} — this downgrades the read.` : ''}${subjectOnly ? ' ⚠️ Scored from the filing TITLE only (no transcript) — unverified.' : ''} Confirmation: ${conf}${sweet ? ' · stage-3–7 sweet spot' : ''}. Read: ${read}. Verify against the transcript before acting — a deterministic keyword read, not a recommendation.`;
  return { verdict, isBuy, headline, detail, hColor, soft, note, quote };
}
