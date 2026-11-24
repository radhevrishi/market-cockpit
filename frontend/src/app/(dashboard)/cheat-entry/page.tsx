'use client';

// ════════════════════════════════════════════════════════════════════════════
// 🥷 CHEAT ENTRY (zzz522, logic overhaul zzz523) — the timing desk.
// ────────────────────────────────────────────────────────────────────────────
// Every other engine answers WHAT to buy: the India/USA Multibagger rankings
// (fundamental composite + grade), the India/USA Technicals universe (your
// curated TradingView lists), and the Conviction Beats bench (BB/STRONG
// earnings winners). This tab answers WHEN: it merges those into one elite
// universe and ranks the names sitting ON a rising moving average — the add
// point where the stop is nearest and the risk smallest.
//
// zzz523 logic fixes (from first live session):
//   1. Board renders INSTANTLY from synced data, then re-scores when live
//      quotes land. Quotes get a 25s budget + one retry — the full-universe
//      build is ~25s on a cold serverless cache, and the old 12s abort meant
//      "live prices for 0 symbols" right after every deploy.
//   2. Setup = the NEAREST qualifying pivot (with a mild preference for deeper
//      MAs), not a fixed 200→50→21 priority — so a name resting exactly on its
//      21-EMA is called a 21-EMA rest even if it's also within 5% of the 50.
//   3. The stop belongs to the pivot you are buying: risk = drop to 2% under
//      THAT MA (floor 0.3%). No more "50DMA pullback, risk→200DMA 36%".
//   4. Quality gate: a name the Multibagger engine graded < 45 is OFF the
//      board (unless the Conviction bench vouches) — "good" has to mean good.
//   5. Support being TESTED (price 1-3% under the pivot) scores a touch lower
//      than support HELD; very late-stage names (>50% above the 200DMA) give
//      back a few setup points.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { getConvictionList } from '@/lib/conviction-beats';
import { openPassport, getEngineViews } from '@/lib/engines';     // zzz524 — click a ticker → Stock Passport
import { suggestSize, fmtMoney } from '@/lib/sizing';             // zzz1302 — position size per row (from the old Bounce Desk)
import { logSignals } from '@/lib/signal-log';    // zzz524 — feed the Signal Scoreboard
import Sparkline from '@/components/Sparkline';    // zzz536 — inline price trend
import { cheatSetup, type CheatSetupKind, type CheatStopMa } from '@/lib/cheat-entry-setup';   // zzz1061

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', bg3: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)', border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)', cyan: 'var(--mc-cyan)', accent: 'var(--mc-accent)',
};

const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES', 'JUNIORBEES', 'SETFNIF50']);

type Market = 'IND' | 'USA';
type SetupKind = CheatSetupKind;
type StopMa = CheatStopMa;

interface Candidate {
  symbol: string; market: Market;
  company: string; sector: string;
  livePrice: number; priceIsLive: boolean; dayChg: number | null; chgSrc: 'live' | 'close' | null;
  d21: number | null; d50: number | null; d200: number | null;
  setup: SetupKind; setupLabel: string; atSupportNow: boolean; testingSupport: boolean;
  stopMa: StopMa | null; riskPct: number | null;
  fundoScore: number | null; fundoGrade: string | null;
  benchTier: 'BLOCKBUSTER' | 'STRONG' | null;
  sources: string[];
  setupScore: number; qualityScore: number; score: number;
  rs: number | null;
  // zzz1302 — the Bounce Desk's oversold read, now on the same row
  bounce: boolean; bounceScore: number; bounceWhy: string[]; bounceBlock: string | null;
}

type RegimeKind = 'BULL' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'RECOVERY' | 'UNKNOWN';
interface RegimeSide { kind: RegimeKind; note?: string; drawdownPct?: number }
type Regimes = { IND: RegimeSide | null; USA: RegimeSide | null };
type Lens = 'best' | 'support' | 'bounce' | 'both' | 'retest' | 'all';
/** zzz1304 — a breakout (or cup rim) retest found on the chart: from the stored Options Ideas scan or the row's chart read */
interface Retest { grade: string; label: string; trigger: number; stop: number; target1: number; riskPct: number; triggered: boolean; why: string }

interface LiveQuote { price: number; chg: number | null; company?: string }
// zzz1303 — the stock-screener snapshot (slim answer): averages, price, today's change, RS, name, industry for names the browser's
// Technicals lists do not carry and for prices the live feed missed
interface SnapRow { px: number | null; chg: number | null; ema21: number | null; sma50: number | null; sma200: number | null; rs: number | null; n?: string; ind?: string }
type Snap = Map<string, SnapRow>;   // key `${market}:${symbol}`
/** Names a company's ticker table carries after the company name ("Class A Shares Representing …", "Common Stock") */
const cleanName = (n: string) => n.replace(/\s+(Class [A-Z]\b.*|Common Stock.*|Ordinary Shares.*|American Depositary.*|Shares Representing.*)$/i, '').replace(/,?\s+(Inc|Ltd|Limited|Corp|Corporation|PLC|LLC)\.?$/i, '').trim();
/** Price with sensible decimals ($2.14 not $2, $1,612 not $1.6k) */
const fmtPx = (v: number, m: Market) => `${m === 'USA' ? '$' : '₹'}${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v >= 100 ? v.toFixed(1) : v.toFixed(2)}`;

const norm = (s: any) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
const num = (v: any): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const readJSON = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

const SETUP_META: Record<SetupKind, { label: string; color: string; blurb: string }> = {
  AT_200:   { label: '🛡 200DMA retest',  color: 'var(--mc-cyan)',    blurb: 'Deepest institutional add point — long-term trend line holding underneath.' },
  AT_50:    { label: '🎯 50DMA pullback', color: 'var(--mc-bullish)', blurb: 'The classic cheat: quality name resting on its intermediate trend.' },
  DRIFT:    { label: '· drifting',        color: 'var(--mc-text-4)',  blurb: 'Between pivots — wait for it to come into a moving average.' },
  EXTENDED: { label: '⏳ extended',       color: 'var(--mc-bearish)', blurb: 'Too far above the 50DMA — chasing, not cheating. Let it come back.' },
};

// ── assemble the board from localStorage engines + an (optionally empty) live
//    quote map. Pure enough to run twice: instant pass, then the live re-score.
function assemble(live: Map<string, LiveQuote>, regimes: Regimes = { IND: null, USA: null }, snap: Snap = new Map()): { cands: Candidate[]; skipped: number } {
  let decay = new Map<string, string>();
  try { for (const [k, v] of getEngineViews()) if (v.decay?.severity) decay.set(norm(k), v.decay.severity); } catch { decay = new Map(); }
  // 1 · fundamentals (Multibagger rankings)
  const fundo = new Map<string, { score: number | null; grade: string | null; sector?: string; market: Market }>();
  for (const [key, fm] of [['mb_excel_scored_v2', 'IND'], ['mb_usa_scored_v2', 'USA'], ['mb_usa_scored_v1', 'USA']] as [string, Market][]) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const s = norm(r?.symbol); if (!s || EXCLUDE.has(s) || fundo.has(s)) continue;
      fundo.set(s, { score: num(r?.score), grade: r?.grade ? String(r.grade) : null, sector: r?.sector || r?.industry, market: fm });
    }
  }
  // 2 · conviction bench
  const bench = new Map<string, { tier: 'BLOCKBUSTER' | 'STRONG'; company: string; sector?: string }>();
  try {
    for (const e of getConvictionList()) {
      const s = norm(e?.ticker); if (!s || EXCLUDE.has(s)) continue;
      if (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG') bench.set(s, { tier: e.tier, company: e.company || '', sector: (e as any).sector });
    }
  } catch { /* bench unreadable */ }
  // 3 · technicals universe (the MAs)
  interface TechRaw { market: Market; price: number | null; ema21: number | null; sma50: number | null; sma200: number | null; sector?: string; company?: string; rs?: number | null }
  const tech = new Map<string, TechRaw>();
  for (const [key, market] of [['mb_tech_rows_ind_v1', 'IND'], ['mb_tech_rows_usa_v1', 'USA']] as [string, Market][]) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const s = norm(r?.symbol || r?.ticker); if (!s || EXCLUDE.has(s) || tech.has(s)) continue;
      tech.set(s, {
        market, price: num(r?.price), ema21: num(r?.ema21), sma50: num(r?.sma50), sma200: num(r?.sma200),
        sector: r?.sector || r?.industry, company: r?.description || r?.company || r?.name,
        rs: num(r?.rsRating ?? r?.rs_rating ?? r?.rs),
      });
    }
  }

  const universe = new Set<string>([...tech.keys(), ...fundo.keys(), ...bench.keys()]);
  const cands: Candidate[] = [];
  let skipped = 0;
  for (const sym of universe) {
    const t0 = tech.get(sym);
    const f = fundo.get(sym) || null;
    const b = bench.get(sym) || null;
    const mk: Market = t0?.market ?? f?.market ?? 'IND';
    const sr = snap.get(`${mk}:${sym}`);
    // zzz1303 — fill missing averages / price / RS from the screener snapshot, field by field
    const t: TechRaw | undefined = (t0 || sr) ? {
      market: mk,
      price: sr?.px ?? t0?.price ?? null,
      ema21: t0?.ema21 ?? sr?.ema21 ?? null,
      sma50: t0?.sma50 ?? sr?.sma50 ?? null,
      sma200: t0?.sma200 ?? sr?.sma200 ?? null,
      sector: t0?.sector || sr?.ind, company: t0?.company || sr?.n,
      rs: t0?.rs ?? sr?.rs ?? null,
    } : undefined;
    if (!t || t.sma50 == null || t.sma200 == null || t.sma50 <= 0 || t.sma200 <= 0) {
      if (b || (f && (f.score ?? 0) >= 60)) skipped++;
      continue;
    }
    // Quality gate — the portal already graded this name; below 45 it is not
    // "good", so it has no business on a quality-pullback board. The bench
    // (a fresh BLOCKBUSTER/STRONG quarter) can overrule an old bad grade.
    if (f && f.score != null && f.score < 45 && !b) continue;

    const lq = live.get(sym);
    const livePrice = lq?.price ?? t.price ?? null;
    if (livePrice == null || livePrice <= 0) continue;

    // zzz1061 — the setup rules live in lib/cheat-entry-setup.ts (the price alerts use the same rules)
    const cs = cheatSetup(livePrice, t.sma50, t.sma200);
    if (!cs) continue; // clearly below the 200DMA = broken chart, not a dip
    const { d50, d200, setup, setupScore, stopMa, riskPct, testingSupport, atSupportNow } = cs;
    const d21 = t.ema21 != null && t.ema21 > 0 ? (livePrice - t.ema21) / t.ema21 * 100 : null;

    // ── quality (0-40) ───────────────────────────────────────────────────────
    const sources: string[] = [`Tech ${t.market === 'IND' ? '🇮🇳' : '🇺🇸'}`];
    if (f && f.score != null) sources.push(`Fundo ${Math.round(f.score)}${f.grade ? ` (${f.grade})` : ''}`);
    if (b) sources.push(b.tier === 'BLOCKBUSTER' ? 'CB · BB' : 'CB · STRONG');
    let quality = 0;
    quality += f && f.score != null ? Math.min(22, Math.max(0, ((f.score - 20) / 80) * 22)) : 6; // 45→~7, 60→11, 100→22
    quality += b ? (b.tier === 'BLOCKBUSTER' ? 10 : 7) : 0;
    if (t.rs != null && t.rs >= 80) quality += 3;
    const engineCount = 1 + (f && f.score != null ? 1 : 0) + (b ? 1 : 0);
    if (engineCount >= 2) quality += engineCount >= 3 ? 8 : 5;
    quality = Math.min(40, quality);

    // zzz1302 — oversold bounce (rules from the old Bounce Desk / Oversold Bounce Playbook). Needs a live day move for the
    // "hard down day" leg; the 21-EMA and 50-day legs work on synced prices too.
    const dayChg = lq?.chg ?? sr?.chg ?? null;
    const why: string[] = [];
    if (dayChg != null && dayChg <= -3) why.push(`down ${Math.abs(dayChg).toFixed(1)}% today`);
    if (d21 != null && d21 <= -3) why.push(`${Math.abs(d21).toFixed(1)}% under the 21-day EMA`);
    // the 50-day leg needs a real pull-back (under the 21-day EMA), otherwise every 50-day rest would also be "oversold"
    if (d50 != null && d50 <= 1 && d200 != null && d200 >= 0 && (d21 == null || d21 <= -1)) why.push(d50 < 0 ? `${Math.abs(d50).toFixed(1)}% under the 50-day, above the 200-day` : 'back at the 50-day, above the 200-day');
    let block: string | null = null;
    const rk = regimes[t.market]?.kind;
    if (why.length) {
      if (rk === 'BEAR') block = 'market regime is BEAR — oversold readings tend to keep falling, bounce lane closed';
      else if (decay.get(sym) === 'high') block = 'Conviction decay is high — falling knife, not a dip';
      else if (riskPct != null && riskPct > 12) block = `stop too far (${riskPct.toFixed(0)}% to the ${stopMa ?? 'average'}) — wait for it to reach the 50-day`;
    }
    let bScore = 40;
    const depth = Math.min(d21 ?? Infinity, d50 ?? Infinity);
    if (Number.isFinite(depth) && depth < 0) bScore += Math.min(20, Math.abs(depth) * 3);
    if (f?.score != null) bScore += f.score >= 70 ? 15 : f.score >= 60 ? 8 : 0;
    if (b) bScore += b.tier === 'BLOCKBUSTER' ? 12 : 8;
    if (t.rs != null && t.rs >= 80) bScore += 5;
    if (d200 != null && d200 < 0) bScore -= 15;
    if (d200 != null && d200 > 60) bScore -= 10;   // very late-stage: a dip after a huge run is often the top, not a bounce
    bScore = Math.max(0, Math.min(100, Math.round(bScore)));

    cands.push({
      symbol: sym, market: t.market,
      company: cleanName(b?.company || live.get(sym)?.company || t.company || ''),
      sector: String(f?.sector || t.sector || b?.sector || ''),
      livePrice, priceIsLive: !!lq, dayChg,
      chgSrc: lq?.chg != null ? 'live' : sr?.chg != null ? 'close' : null,
      d21, d50, d200,
      setup, setupLabel: SETUP_META[setup].label, atSupportNow, testingSupport,
      stopMa, riskPct,
      fundoScore: f?.score ?? null, fundoGrade: f?.grade ?? null,
      benchTier: b?.tier ?? null, sources,
      setupScore: Math.round(setupScore), qualityScore: Math.round(quality),
      score: Math.round(setupScore + quality),
      rs: t.rs ?? null,
      bounce: why.length > 0 && !block, bounceScore: why.length ? bScore : 0, bounceWhy: why, bounceBlock: block,
    });
  }
  cands.sort((a, b) => b.score - a.score || (a.riskPct ?? 99) - (b.riskPct ?? 99));
  return { cands, skipped };
}

/** zzz1303 — every symbol the board looks at, by market (for the snapshot fetch) */
function universeByMarket(): Record<Market, string[]> {
  const out: Record<Market, Set<string>> = { IND: new Set(), USA: new Set() };
  const add = (m: Market, v: any) => { const s = norm(v); if (s && !EXCLUDE.has(s)) out[m].add(s); };
  for (const [key, m] of [['mb_tech_rows_ind_v1', 'IND'], ['mb_tech_rows_usa_v1', 'USA'], ['mb_excel_scored_v2', 'IND'], ['mb_usa_scored_v2', 'USA'], ['mb_usa_scored_v1', 'USA']] as [string, Market][]) {
    const rows = readJSON(key); if (Array.isArray(rows)) for (const r of rows) add(m, r?.symbol || r?.ticker);
  }
  try { for (const e of getConvictionList()) add('IND', e?.ticker); } catch { /* */ }
  return { IND: [...out.IND], USA: [...out.USA] };
}
async function fetchSnapshot(): Promise<Snap> {
  const snap: Snap = new Map();
  const u = universeByMarket();
  const jobs: Array<{ m: Market; t: string[] }> = [];
  for (const m of ['IND', 'USA'] as Market[]) for (let i = 0; i < u[m].length; i += 400) jobs.push({ m, t: u[m].slice(i, i + 400) });
  await Promise.all(jobs.map(async ({ m, t }) => {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch(`/api/v1/stock-screener?market=${m === 'IND' ? 'IN' : 'US'}&tickers=${encodeURIComponent(t.join(','))}`, { signal: ctl.signal });
      clearTimeout(to);
      const j = r.ok ? await r.json() : null;
      for (const x of (Array.isArray(j?.rows) ? j.rows : [])) {
        const sym = norm(x?.t); if (!sym) continue;
        snap.set(`${m}:${sym}`, { px: num(x.px ?? x.scanPx), chg: num(x.chg), ema21: num(x.ema21), sma50: num(x.sma50), sma200: num(x.sma200), rs: num(x.rs), n: x.n, ind: x.ind || x.sec });
      }
    } catch { /* snapshot is a fill-in */ }
  }));
  return snap;
}

// Live quotes with a realistic budget: the full-universe build is ~25s on a
// cold serverless cache. First try 25s; if empty, wait 3s (server keeps
// building after our abort and caches the result) and retry with 20s.
async function fetchLiveQuotes(): Promise<Map<string, LiveQuote>> {
  const live = new Map<string, LiveQuote>();
  const one = async (m: 'india' | 'us', ms: number) => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
      const r = await fetch(`/api/market/quotes?market=${m}&fields=ticker,price,changePercent,company`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const j = await r.json();
      const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
      for (const s of stocks) {
        const sym = norm(s?.ticker); const p = num(s?.price);
        if (sym && p != null && p > 0 && !live.has(sym)) live.set(sym, { price: p, chg: num(s?.changePercent), company: s?.company });
      }
    } catch { /* cold / aborted */ }
  };
  await Promise.all([one('india', 25000), one('us', 25000)]);
  if (live.size === 0) {
    await new Promise((r) => setTimeout(r, 3000));
    await Promise.all([one('india', 20000), one('us', 20000)]);
  }
  return live;
}

const LENS_META: Record<Lens, { label: string; color: string; hint: string }> = {
  best:    { label: '✅ Best entries', color: 'var(--mc-bullish)', hint: 'On a rising 50- or 200-day average, an oversold dip, or a breakout retest in a trusted name' },
  both:    { label: '⭐ Both signals', color: '#A855F7', hint: 'On support AND oversold — the strongest dip-buy read' },
  support: { label: '🎯 On support', color: 'var(--mc-cyan)', hint: 'Resting on a rising 50- or 200-day average (the old Cheat Entry board)' },
  bounce:  { label: '🌊 Oversold bounce', color: '#A78BFA', hint: 'Hard down day, under the 21-day EMA, or into the 50-day band — above the 200-day (the old Bounce Desk)' },
  retest:  { label: '📐 Breakout + retest', color: '#F59E0B', hint: 'Broke a resistance tested 3+ times (or a cup rim), came back to it and is holding above — the second-chance entry' },
  all:     { label: 'All', color: 'var(--mc-text-3)', hint: 'Every ranked name, extended and drifting included' },
};
const LENSES: Lens[] = ['best', 'both', 'support', 'bounce', 'retest', 'all'];
const PREFS_KEY = 'mc:entry-desk:v1';
const isSupport = (c: Candidate) => c.setup === 'AT_200' || c.setup === 'AT_50';
const inLens = (c: Candidate, l: Lens, rt: Retest | null) =>
  l === 'all' ? true : l === 'support' ? isSupport(c) : l === 'bounce' ? c.bounce : l === 'both' ? isSupport(c) && c.bounce : l === 'retest' ? !!rt : isSupport(c) || c.bounce || !!rt;
const retestFromIdea = (i: any): Retest | null => (i && (i.setup?.id === 'breakout_retest' || i.setup?.id === 'cup_retest' || i.setup?.id === 'vcp_breakout' || i.setup?.id === 'multiyear_breakout'))
  ? { grade: String(i.grade), label: String(i.setup.label), trigger: Number(i.setup.trigger), stop: Number(i.setup.stop), target1: Number(i.setup.target1), riskPct: Number(i.setup.riskPct), triggered: !!i.setup.triggered, why: (i.setup.reasons || []).join(' · ') }
  : null;
/** The stored Options Ideas scans (both markets) → breakout retests by `${market}:${ticker}` */
async function fetchScanRetests(): Promise<Map<string, Retest>> {
  const out = new Map<string, Retest>();
  await Promise.all((['US', 'IN'] as const).map(async (m) => {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(`/api/v1/options-ideas?market=${m}`, { signal: ctl.signal }); clearTimeout(to);
      const j = r.ok ? await r.json() : null;
      for (const i of (Array.isArray(j?.scan?.ideas) ? j.scan.ideas : [])) {
        const rt = retestFromIdea(i); const k = `${m === 'IN' ? 'IND' : 'USA'}:${norm(i.ticker)}`;
        if (rt && !out.has(k)) out.set(k, rt);
      }
    } catch { /* the chart read per row still finds them */ }
  }));
  return out;
}
const REGIME_COL: Record<string, string> = { BULL: 'var(--mc-bullish)', RECOVERY: 'var(--mc-cyan)', PULLBACK: 'var(--mc-warn)', CORRECTION: 'var(--mc-warn)', BEAR: 'var(--mc-bearish)' };
const REGIME_RULE: Record<string, string> = {
  BULL: 'dips are buyable — full size',
  PULLBACK: 'dips are buyable — wait for the average to hold',
  CORRECTION: 'half size, wait for a green day off support',
  BEAR: 'bounce lane closed — only support entries with tight stops',
  RECOVERY: 'post-sell-off window — the best time for bounces',
};

export default function CheatEntryPage() {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [quotesState, setQuotesState] = useState<'loading' | 'live' | 'failed'>('loading');
  const [marketF, setMarketF] = useState<'ALL' | Market>('ALL');
  const [lens, setLens] = useState<Lens>('best');
  const [regimes, setRegimes] = useState<Regimes>({ IND: null, USA: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const [sparks, setSparks] = useState<Map<string, number[]>>(new Map()); // zzz536 — inline price context
  const [ready, setReady] = useState(false);
  const [scanRetests, setScanRetests] = useState<Map<string, Retest>>(new Map());

  // zzz1302 — lens from the address (?lens=bounce — the old /bounce-desk forwards here), market + lens remembered
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (saved?.market === 'IND' || saved?.market === 'USA' || saved?.market === 'ALL') setMarketF(saved.market);
      if (LENSES.includes(saved?.lens)) setLens(saved.lens);
      const q = new URLSearchParams(window.location.search).get('lens');
      if (q && (LENSES as string[]).includes(q)) setLens(q as Lens);
    } catch { /* defaults */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ market: marketF, lens }));
      const u = new URL(window.location.href);
      if (lens === 'best') u.searchParams.delete('lens'); else u.searchParams.set('lens', lens);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch { /* */ }
  }, [marketF, lens, ready]);

  const runRef = useRef(0);       // zzz530 — newest build wins; stale async can't clobber
  const aliveRef = useRef(true);  // zzz530 — no setState after unmount
  const build = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const run = ++runRef.current;
    // regime first (quick) so the bounce gate is right from the first pass
    const regP = (async (): Promise<Regimes> => {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch('/api/market/regime', { signal: ctl.signal }); clearTimeout(to);
        const j = r.ok ? await r.json() : null;
        return { IND: j?.india || null, USA: j?.usa || null };
      } catch { return { IND: null, USA: null }; }
    })();
    const liveP = fetchLiveQuotes();
    const snapP = fetchSnapshot();
    fetchScanRetests().then((m) => { if (aliveRef.current && run === runRef.current) setScanRetests(m); });
    // instant pass — synced prices, board up immediately
    const base = assemble(new Map());
    if (!aliveRef.current || run !== runRef.current) return;
    setCands(base.cands); setSkipped(base.skipped);
    const reg = await regP;
    if (!aliveRef.current || run !== runRef.current) return;
    setRegimes(reg);
    const snap = await snapP;
    if (!aliveRef.current || run !== runRef.current) return;
    const reg1 = assemble(new Map(), reg, snap);
    setCands(reg1.cands); setSkipped(reg1.skipped);
    // live pass — re-score once quotes land
    setQuotesState('loading');
    const live = await liveP;
    if (!aliveRef.current || run !== runRef.current) return; // a newer REFRESH superseded us
    if (live.size > 0) {
      const fresh = assemble(live, reg, snap);
      setCands(fresh.cands); setSkipped(fresh.skipped);
      setLiveCount(live.size); setQuotesState('live');
      // zzz524 — log today's top setups for the scoreboard (both desks' signal names kept)
      try {
        logSignals('cheat-entry', fresh.cands.filter(isSupport).slice(0, 10)
          .map((c) => ({ ticker: c.symbol, note: `${c.setupLabel} score ${c.score}`, priceAt: c.livePrice })));
        logSignals('bounce', fresh.cands.filter((c) => c.bounce).sort((a, b) => b.bounceScore - a.bounceScore).slice(0, 10)
          .map((c) => ({ ticker: c.symbol, note: `bounce ${c.bounceScore}`, priceAt: c.livePrice })));
      } catch { /* never load-bearing */ }
      // zzz536 — decorate the board with sparklines via the existing /api/market/spark route
      try {
        const syms = Array.from(new Set([...fresh.cands.filter(isSupport).slice(0, 30), ...fresh.cands.filter((c) => c.bounce).slice(0, 20)].map((c) => c.symbol))).slice(0, 48);
        if (syms.length) {
          const ctl = new AbortController();
          const to = setTimeout(() => ctl.abort(), 12000);
          const r = await fetch(`/api/market/spark?symbols=${encodeURIComponent(syms.join(','))}`, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(to);
          if (r.ok && aliveRef.current && run === runRef.current) {
            const j = await r.json();
            const m = new Map<string, number[]>();
            for (const row of (Array.isArray(j?.rows) ? j.rows : [])) {
              const sym = String(row?.symbol || '').toUpperCase();
              if (sym && Array.isArray(row?.spark) && row.spark.length >= 3) m.set(sym, row.spark);
            }
            if (aliveRef.current && run === runRef.current) setSparks(m);
          }
        }
      } catch { /* sparks are decorative */ }
    } else {
      setLiveCount(0); setQuotesState('failed');
    }
  }, []);

  useEffect(() => { aliveRef.current = true; build(); return () => { aliveRef.current = false; }; }, [build, refreshTick]);

  const [briefs, setBriefs] = useState<Map<string, any>>(new Map());
  // a row's chart read (fresh) wins over the stored scan; a read that found no retest clears the scan's older one
  const retestOf = useCallback((c: Candidate): Retest | null => {
    const k = `${c.market}:${c.symbol}`; const b = briefs.get(k);
    if (b && b.ok && 'retest' in b) return b.retest ?? null;
    return scanRetests.get(k) ?? null;
  }, [briefs, scanRetests]);
  const inMarket = useMemo(() => (cands || []).filter((c) => marketF === 'ALL' || c.market === marketF), [cands, marketF]);
  const counts = useMemo(() => {
    const o = {} as Record<Lens, number>;
    for (const l of LENSES) o[l] = inMarket.filter((c) => inLens(c, l, retestOf(c))).length;
    return o;
  }, [inMarket, retestOf]);
  const shown = useMemo(() => inMarket.filter((c) => inLens(c, lens, retestOf(c))), [inMarket, lens, retestOf]);
  const blocked = useMemo(() => inMarket.filter((c) => c.bounceBlock).length, [inMarket]);
  const atSupport = useMemo(() => inMarket.filter((c) => c.atSupportNow).length, [inMarket]);

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    padding: '6px 13px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
    border: `1px solid ${active ? color : C.border}`,
    background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
    color: active ? color : C.muted,
  });

  // zzz1301n — chart structure per row (trendlines / breakout + retest / cups, graded like Options Ideas), loaded for the rows shown
  const [sortK, setSortK] = useState<'score' | 'risk' | 'd50' | 'd200' | 'struct' | 'today' | 'bounce'>('score');
  useEffect(() => { setSortK(lens === 'bounce' ? 'bounce' : lens === 'retest' ? 'struct' : 'score'); }, [lens]);
  const top = useMemo(() => {
    const deskScore = (c: Candidate) => (lens === 'bounce' ? c.bounceScore : c.score + (c.bounce && isSupport(c) ? 8 : c.bounce ? 3 : 0) + (retestOf(c) ? 5 : 0));
    return [...shown].sort((a, b) => deskScore(b) - deskScore(a)).slice(0, 80);
  }, [shown, lens, retestOf]);
  // which rows to read the chart for: the rows shown, and in the Breakout + retest view every ranked name in the market (≤ 300,
  // best scores first) — a retest can sit on any name, not only those already on support
  const readList = useMemo(() => (lens === 'retest' ? [...inMarket].sort((a, b) => b.score - a.score).slice(0, 300) : top), [lens, inMarket, top]);
  const [reading, setReading] = useState(0);
  useEffect(() => {
    let off = false;
    const need = readList.filter((c) => !briefs.has(`${c.market}:${c.symbol}`));
    if (!need.length) return;
    (async () => {
      const groups: Array<{ m: 'US' | 'IN'; t: string[] }> = [];
      for (const mk of ['IND', 'USA'] as const) {
        const ts = need.filter((c) => c.market === mk).map((c) => c.symbol);
        for (let i = 0; i < ts.length; i += 12) groups.push({ m: mk === 'IND' ? 'IN' : 'US', t: ts.slice(i, i + 12) });
      }
      let gi = 0;
      setReading(need.length);
      await Promise.all([0, 1, 2].map(async () => {
        while (gi < groups.length && !off) {
          const g = groups[gi++];
          const j = await fetch(`/api/v1/options-ideas?market=${g.m}&structure=1&tickers=${encodeURIComponent(g.t.join(','))}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (off || !j?.briefs) continue;
          setBriefs((prev) => { const m = new Map(prev); for (const b of j.briefs) m.set(`${g.m === 'IN' ? 'IND' : 'USA'}:${b.ticker}`, b); return m; });
          setReading((n) => Math.max(0, n - g.t.length));
        }
      }));
      if (!off) setReading(0);
    })();
    return () => { off = true; };
  }, [readList]); // eslint-disable-line react-hooks/exhaustive-deps

  const structRank = (b: any) => (!b ? 9 : b.best ? ({ 'A+': 0, A: 1, B: 2, C: 4 } as any)[b.best.grade] ?? 5 : b.lines + b.levels > 0 ? 6 : 8);
  const rows = useMemo(() => {
    const r = [...top];
    const key = (c: Candidate): number => {
      const b = briefs.get(`${c.market}:${c.symbol}`);
      const rt = retestOf(c);
      switch (sortK) {
        case 'risk': return c.riskPct ?? 99;
        case 'd50': return Math.abs(c.d50 ?? 99);
        case 'd200': return Math.abs(c.d200 ?? 99);
        case 'struct': return rt ? structRank({ best: { grade: rt.grade } }) - 0.5 : structRank(b);
        case 'today': return c.dayChg ?? 99;
        case 'bounce': return -(c.bounce ? c.bounceScore : c.bounceScore - 200);
        default: return -(c.score + (c.bounce && isSupport(c) ? 8 : c.bounce ? 3 : 0) + (rt ? 5 : 0));
      }
    };
    return r.sort((a, b) => key(a) - key(b));
  }, [top, sortK, briefs, retestOf]);

  const th: React.CSSProperties = { padding: '9px 8px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: C.muted, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 1 };
  const td: React.CSSProperties = { padding: '8px 8px', fontSize: 13.5, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' };
  const H = ({ k, children, title }: { k?: typeof sortK; children: any; title?: string }) => (
    <th style={{ ...th, cursor: k ? 'pointer' : 'default', color: k && sortK === k ? C.cyan : C.muted }} title={title} onClick={() => k && setSortK(k)}>{children}{k && sortK === k ? ' ▼' : ''}</th>
  );
  const pct = (x: number | null, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`);
  const GCOL: Record<string, string> = { 'A+': '#A855F7', A: 'var(--mc-bullish)', B: 'var(--mc-warn)', C: 'var(--mc-bearish)' };
  const markets: Market[] = marketF === 'ALL' ? ['IND', 'USA'] : [marketF];

  return (
    <div style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box' }}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.text }}>🥷 Entry Desk</h1>
        <span style={{ fontSize: 13.5, color: C.muted }}>When to buy a name you already like: on a rising average (smallest stop) or an oversold dip (Cheat Entry + Bounce Desk in one).</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {atSupport > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: C.green, border: `1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)`, borderRadius: 8, padding: '4px 10px' }}>🔥 {atSupport} at support now</span>}
          <span style={{ fontSize: 12, fontWeight: 700, color: quotesState === 'live' ? C.green : quotesState === 'loading' ? C.dim : C.amber }}>
            {quotesState === 'live' ? `● live prices (${liveCount.toLocaleString()})` : quotesState === 'loading' ? '○ fetching live prices…' : '● live prices not reached — using synced prices'}
          </span>
          <button onClick={() => setRefreshTick((x) => x + 1)} style={chip(false, C.cyan)}>↻ Refresh</button>
        </div>
      </div>
      {quotesState === 'failed' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.amber, border: `1px solid color-mix(in srgb, var(--mc-warn) 35%, transparent)`, borderRadius: 8, padding: '6px 10px' }}>
          ⚠ The live quote feed didn&rsquo;t answer in time (common right after a deploy). Distances use your last Technicals-sync prices and the &ldquo;down today&rdquo; bounce check is off. Refresh in ~30 s.
        </div>
      )}

      {/* ── regime strip ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${markets.length}, minmax(0, 1fr))`, gap: 10, marginTop: 12 }}>
        {markets.map((mk) => {
          const r = regimes[mk]; const k = r?.kind || 'UNKNOWN'; const col = REGIME_COL[k] || C.muted;
          return (
            <div key={mk} style={{ border: `1px solid color-mix(in srgb, ${col} 45%, transparent)`, background: `color-mix(in srgb, ${col} 6%, transparent)`, borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 900, fontSize: 14, color: C.text }}>{mk === 'IND' ? '🇮🇳 India' : '🇺🇸 USA'}</span>
              <span style={{ fontWeight: 900, fontSize: 13, color: col }}>{r ? k : 'regime loading…'}</span>
              {r?.drawdownPct != null && <span style={{ fontSize: 12.5, color: C.muted }}>{r.drawdownPct.toFixed(1)}% from high</span>}
              {r && <span style={{ fontSize: 13, color: C.text2 }}>→ {REGIME_RULE[k] || r.note || ''}</span>}
            </div>
          );
        })}
      </div>

      {/* ── lens tiles ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
        {LENSES.map((l) => {
          const m = LENS_META[l]; const on = lens === l;
          return (
            <button key={l} onClick={() => setLens(l)} title={m.hint} style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', border: `1px solid ${on ? m.color : C.border}`, background: on ? `color-mix(in srgb, ${m.color} 12%, transparent)` : C.bg }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: on ? m.color : C.muted }}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: on ? m.color : C.text, lineHeight: 1.2 }}>{cands ? counts[l] : '…'}</div>
              <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.35 }}>{m.hint}</div>
            </button>
          );
        })}
      </div>

      {/* ── filters ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {(['ALL', 'IND', 'USA'] as const).map((m) => (
          <button key={m} onClick={() => setMarketF(m)} style={chip(marketF === m, C.accent)}>{m === 'ALL' ? 'Both markets' : m === 'IND' ? '🇮🇳 India' : '🇺🇸 USA'}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.dim }}>
          {cands ? `${shown.length} names · ${LENS_META[lens].label.replace(/^\S+\s/, '')}` : ''}
          {lens === 'retest' && reading > 0 ? ` · reading ${reading} more charts…` : ''}
          {blocked > 0 ? ` · ${blocked} oversold names refused (bear regime, decay or stop too far)` : ''}
          {skipped > 0 ? ` · ${skipped} quality names without moving-average data (not in the screener snapshot either)` : ''}
        </span>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      {cands == null ? (
        <div style={{ marginTop: 24, fontSize: 13, color: C.muted, fontStyle: 'italic' }}>Building the board…</div>
      ) : cands.length === 0 ? (
        <div style={{ marginTop: 24, fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
          No rankable names yet. The board needs your <Link href="/multibagger?tab=technicals-ind" style={{ color: C.cyan }}>India</Link> /{' '}
          <Link href="/multibagger?tab=technicals-usa" style={{ color: C.cyan }}>USA Technicals</Link> rows (they carry each name&rsquo;s 50 &amp; 200-day averages)
          plus, optionally, the <Link href="/multibagger" style={{ color: C.cyan }}>Multibagger rankings</Link> and{' '}
          <Link href="/watchlists?tab=conviction" style={{ color: C.cyan }}>Conviction bench</Link>.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 20, fontSize: 13.5, color: C.muted, border: `1px dashed ${C.border2}`, borderRadius: 10, padding: 16 }}>
          Nothing in &ldquo;{LENS_META[lens].label}&rdquo; right now{marketF !== 'ALL' ? ` for ${marketF === 'IND' ? 'India' : 'USA'}` : ''}.
          {lens === 'bounce' || lens === 'both' ? ' No trusted name is oversold above its 200-day today — that is normal in a rising market.' : ''}
          {lens === 'retest' ? (reading > 0 ? ` Still reading ${reading} charts — retests appear as they are found.` : ' None of your ranked names is retesting a breakout right now.') : ''}{' '}
          <button onClick={() => setLens('all')} style={chip(false, C.cyan)}>Show all ranked names</button>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, overflow: 'auto', maxHeight: 'calc(100vh - 120px)', border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead><tr>
                <H>#</H><H>Company</H><H k="score" title="Setup (0–60) + quality (0–40); +8 when also oversold">Score</H><H>Entry type</H>
                <H k="bounce" title="Oversold bounce score 0–100 (depth of the dip + quality). Shown only when the name is oversold.">Bounce</H>
                <H k="d50" title="Distance from the 50-day average">vs 50-day</H><H k="d200" title="Distance from the 200-day average">vs 200-day</H>
                <H k="risk" title="Drop to a stop 2% under the average you are buying against">Stop risk</H>
                <H title="Position size that risks your set % of the book at that stop (Position Sizing settings). Halved in a CORRECTION regime.">Size</H>
                <H k="today" title="Today's move — sort to put the biggest falls first">Today</H><H>3-month trend</H>
                <H k="struct" title="Trendlines / breakout + retest / cups on the chart, graded like Options Ideas (A+ best). Sort to put the most interesting charts first.">Chart structure</H>
                <H>Quality</H><H>Sector</H><H>Open</H>
              </tr></thead>
              <tbody>
                {rows.map((c, i) => {
                  const meta = SETUP_META[c.setup];
                  const shownScore = c.score + (c.bounce && isSupport(c) ? 8 : c.bounce ? 3 : 0) + (retestOf(c) ? 5 : 0);
                  const scoreCol = shownScore >= 75 ? C.green : shownScore >= 55 ? C.cyan : shownScore >= 40 ? C.amber : C.muted;
                  const b = briefs.get(`${c.market}:${c.symbol}`);
                  const m = c.market === 'IND' ? 'IN' : 'US';
                  const rk = regimes[c.market]?.kind;
                  const sz = suggestSize({ price: c.livePrice, stopPct: c.riskPct ?? 8 });
                  const szPct = sz ? sz.pctOfPortfolio * (rk === 'CORRECTION' ? 0.5 : 1) : null;
                  const both = c.bounce && isSupport(c);
                  const rt = retestOf(c);
                  return (
                    <tr key={c.symbol + c.market} style={{ background: both ? 'color-mix(in srgb, #A855F7 7%, transparent)' : c.atSupportNow ? 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)' : undefined }}>
                      <td style={{ ...td, color: C.dim, width: 28 }}>{i + 1}</td>
                      <td style={{ ...td, minWidth: 210 }}>
                        <span onClick={() => openPassport(c.symbol)} title="Open Stock Passport" style={{ fontWeight: 900, cursor: 'pointer', color: C.text, fontSize: 14 }}>{c.symbol}</span>
                        <span style={{ marginLeft: 5, fontSize: 11 }}>{c.market === 'IND' ? '🇮🇳' : '🇺🇸'}</span>
                        {both && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 900, color: '#A855F7' }}>⭐ both</span>}
                        {!both && c.atSupportNow && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 900, color: C.green }}>{c.testingSupport ? '🧪 testing support' : '🔥 at support'}</span>}
                        <div style={{ fontSize: 12, color: C.muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 900, fontSize: 15.5, color: scoreCol }} title={`Setup ${c.setupScore}/60 + Quality ${c.qualityScore}/40${c.bounce ? ` + ${isSupport(c) ? 8 : 3} oversold` : ''}${rt ? ' + 5 breakout retest' : ''}`}>{shownScore}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span title={meta.blurb} style={{ fontWeight: 800, color: meta.color }}>{meta.label}</span>
                        {rt && <div title={`${rt.label}: ${rt.why}`} style={{ marginTop: 3, fontSize: 12, fontWeight: 800, color: '#F59E0B' }}>📐 {rt.label} <b style={{ color: '#fff', background: GCOL[rt.grade] || '#64748B', borderRadius: 4, padding: '0 5px', fontSize: 11 }}>{rt.grade}</b>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{rt.triggered ? 'holding above' : 'buy above'} {fmtPx(rt.trigger, c.market)} · stop {fmtPx(rt.stop, c.market)} ({rt.riskPct.toFixed(1)}%) · T1 {fmtPx(rt.target1, c.market)}</div></div>}
                      </td>
                      <td style={{ ...td, minWidth: 150 }}>
                        {c.bounce ? <span title={c.bounceWhy.join(' · ')}><b style={{ color: '#A78BFA', fontSize: 14 }}>🌊 {c.bounceScore}</b><div style={{ fontSize: 11.5, color: C.muted, maxWidth: 240, lineHeight: 1.35 }}>{c.bounceWhy.join(' · ')}</div></span>
                          : c.bounceBlock ? <span title={c.bounceBlock} style={{ fontSize: 12, color: C.red }}>🛑 refused<div style={{ fontSize: 11, color: C.dim, maxWidth: 220 }}>{c.bounceBlock.split(' — ')[0]}</div></span>
                          : <span style={{ color: C.dim }}>—</span>}
                      </td>
                      <td style={{ ...td, color: c.d50 != null && Math.abs(c.d50) <= 3 ? C.green : C.text2 }}>{pct(c.d50)}</td>
                      <td style={{ ...td, color: c.d200 != null && Math.abs(c.d200) <= 4 ? C.cyan : C.text2 }}>{pct(c.d200)}</td>
                      <td style={{ ...td, fontWeight: 800, color: c.riskPct == null ? C.muted : c.riskPct <= 4 ? C.green : c.riskPct <= 8 ? C.amber : C.red }} title={c.stopMa ? `Stop 2% under the ${c.stopMa}` : ''}>{c.riskPct != null ? `${c.riskPct.toFixed(1)}%` : '—'}{c.stopMa ? <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 600 }}> under {c.stopMa}</span> : null}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }} title={sz ? `≈ ${fmtMoney(sz.value * (rk === 'CORRECTION' ? 0.5 : 1), c.market)} · stop ${fmtPx(sz.stopPrice, c.market)}${rk === 'CORRECTION' ? ' · halved: CORRECTION regime' : ''}` : ''}>
                        {szPct != null ? <><b>{szPct.toFixed(1)}%</b>{sz!.pctOfPortfolio >= 14.99 ? <span style={{ fontSize: 10, color: C.dim }} title="Capped at the 15% single-position limit — the stop is tight enough that the risk rule would allow more"> max</span> : null}{rk === 'CORRECTION' ? <span style={{ fontSize: 10.5, color: C.amber }} title="Halved: CORRECTION regime"> ½</span> : null}<div style={{ fontSize: 11, color: C.dim }}>stop {fmtPx(sz!.stopPrice, c.market)}</div></> : '—'}
                      </td>
                      <td style={{ ...td, color: c.dayChg == null ? C.dim : c.dayChg >= 0 ? C.green : C.red }} title={c.chgSrc === 'close' ? 'Last session (screener snapshot) — no live quote for this name' : c.chgSrc === 'live' ? 'Live quote' : 'No price change available'}>{c.dayChg != null ? <>{pct(c.dayChg)}{c.chgSrc === 'close' ? <span style={{ fontSize: 10, color: C.dim }}> close</span> : null}</> : '—'}</td>
                      <td style={td}>{sparks.get(c.symbol) ? <Sparkline data={sparks.get(c.symbol)} width={80} height={22} /> : <span style={{ color: C.dim }}>—</span>}</td>
                      <td style={{ ...td, minWidth: 190 }}>
                        {!b ? <span style={{ color: C.dim, fontSize: 12 }}>reading chart…</span>
                          : !b.ok ? <span style={{ color: C.dim, fontSize: 12 }}>no chart data</span>
                          : b.best ? <span title={`${b.setups} setup(s) found on the chart — open Options Ideas for the full plan`}><b style={{ color: '#fff', background: GCOL[b.best.grade] || '#64748B', borderRadius: 5, padding: '1px 6px', fontSize: 12 }}>{b.best.grade}</b> <span style={{ fontWeight: 700 }}>{b.best.label}</span>{b.setups > 1 ? <span style={{ color: C.dim, fontSize: 11.5 }}> +{b.setups - 1}</span> : null}</span>
                          : b.lines + b.levels > 0 ? <span style={{ fontSize: 12, color: C.text2 }} title={b.nearest || ''}>{b.lines} line{b.lines === 1 ? '' : 's'} · {b.levels} level{b.levels === 1 ? '' : 's'}{b.nearestPct != null ? <span style={{ color: C.dim }}> · nearest {b.nearestPct > 0 ? '+' : ''}{b.nearestPct}%</span> : null}</span>
                          : <span style={{ color: C.dim, fontSize: 12 }}>no clean structure</span>}
                        {b?.ok && b.patterns?.length ? <div style={{ fontSize: 11.5, marginTop: 2, color: C.text2 }} title="Chart patterns read by the same engine as the Charts page (zzz1307)">{b.patterns.map((p: string, i: number) => <span key={i} style={{ marginRight: 6, fontWeight: /^VCP/.test(p) ? 800 : 600, color: /^VCP/.test(p) ? C.green : C.text2 }}>{p}</span>)}</div> : null}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.sources.filter((s) => !s.startsWith('Tech')).map((s, k) => <span key={k} style={{ fontSize: 11, fontWeight: 700, color: C.text2, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{s}</span>)}
                          {c.rs != null && c.rs >= 80 && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, border: `1px solid ${C.border2}`, borderRadius: 5, padding: '1px 6px' }}>RS {Math.round(c.rs)}</span>}
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: C.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sector || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <a href={`/charts?m=${m}&t=${encodeURIComponent(c.symbol)}`} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, fontWeight: 700, textDecoration: 'none' }} title="Open the chart">📈 Chart</a>
                        <a href={`/options-ideas?view=one&ticker=${encodeURIComponent(c.symbol)}`} onClick={() => { try { localStorage.setItem('mc:options-ideas:market:v1', JSON.stringify(m)); } catch { /* */ } }} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, fontWeight: 700, textDecoration: 'none', marginLeft: 10 }} title="Trendlines, setups and the option plan">🎯 Setups</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > 80 && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Top 80 shown of {shown.length} — pick a narrower view or market to see the rest.</div>}
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 12, lineHeight: 1.65 }}>
            <b style={{ color: C.muted }}>Score</b> = setup (0–60) + quality (0–40), +8 when the name is also oversold on support (+3 oversold elsewhere). The setup is the nearest rising average underneath (200-day scores highest, then 50-day); names more than 15% above the 50-day are extended; names graded below 45 by the Multibagger engine are left out unless the Conviction bench vouches.
            <b style={{ color: C.muted }}> Bounce</b> = oversold (down 3%+ today, 3%+ under the 21-day EMA, or back into the 50-day band) while still above the 200-day. Refused in a BEAR regime, when Conviction decay is high, or when the stop is more than 12% away — oversold is not a bottom.
            <b style={{ color: C.muted }}> 📐 Breakout + retest</b> = a resistance tested 3+ times (or a cup rim) broke 4–40 sessions ago, price came back to it and holds above; its own trigger / stop / first target are shown under the entry type (+5 on the score). From the daily Options Ideas scan plus a chart read of each row.
            <b style={{ color: C.muted }}> Stop risk</b> = drop to a stop 2% under that average; <b style={{ color: C.muted }}>Size</b> risks your set % of the book at that stop, halved in a CORRECTION.
            <b style={{ color: C.muted }}> Chart structure</b> = trendlines, 3-touch levels and cups on the daily chart, graded like Options Ideas. Not a recommendation.
          </div>
        </>
      )}
    </div>
  );
}
