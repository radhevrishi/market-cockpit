'use client';

// ═══════════════════════════════════════════════════════════════════════════
// DAILY ACTION COCKPIT
// One ranked "what needs a decision today" list, assembled from signals the
// app already computes — nothing new is scraped, it's pure routing:
//   • Thesis breaches (sell-discipline)        → /thesis
//   • Your holdings that just reported          → /earnings-opportunities
//   • Your holdings reporting soon (calendar)   → /earnings-hub
//   • Theme rotation ADD / TRIM flips           → /multibagger?tab=theme-rotation
//   • Valuations that say BUY / got cheaper      → /valuation-calc
//   • New conviction ideas on your bench         → /watchlists?tab=conviction
// Everything degrades gracefully: each source is independent and try/caught,
// so one dead feed never blanks the board.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import NavLink from '@/components/NavLink';   // zzz1052 — prefetch on hover / focus / press, not on scroll-into-view
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { getTechBuyZone } from '@/lib/tech-entries';
import { diffNew, markSeen, getDismissed, dismiss, clearDismissed } from '@/lib/seen-store';
import { logSignals } from '@/lib/signal-log'; // zzz524 — feed the Signal Scoreboard
import { getEngineViews, openPassport } from '@/lib/engines'; // zzz525 — conflicts panel
import { computeVerdict } from '@/lib/verdict';
import { getConvictionList } from '@/lib/conviction-beats';
import { getUsConvictionList } from '@/lib/conviction-beats-us';
import { maEntry, MA_LABEL } from '@/lib/ma-entries';
import { listAutoValuations } from '@/lib/auto-valuation-store';
import { getThesisList } from '@/lib/thesis-store';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)', panel: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)', border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text0: 'var(--mc-text-0)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)',
  cyan: 'var(--mc-cyan)', accent: 'var(--mc-accent)', saffron: 'var(--mc-saffron)', purple: 'var(--mc-state-persistent)',
};
const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

type Sev = 'act' | 'watch' | 'info';
interface Signal {
  id: string;
  sev: Sev;
  priority: number;       // higher = surfaces first within its band
  icon: string;
  kind: string;           // short label, e.g. "REPORTED", "THESIS", "THEME"
  ticker?: string;
  title: string;
  detail: string;
  href: string;
  /** zzz1300 — table fields: company name, one-line note, today's move, held or bench */
  name?: string;
  note?: string;
  chg?: number | null;
  held?: boolean;
  group?: string;          // rows with the same group sit in one table
  market?: 'IN' | 'US';
}

const SEV_META: Record<Sev, { label: string; color: string; blurb: string }> = {
  act:   { label: 'ACT',   color: 'var(--mc-bearish)', blurb: 'Decisions your book is asking for now' },
  watch: { label: 'WATCH', color: 'var(--mc-warn)',    blurb: 'On the radar — not urgent, but moving' },
  info:  { label: 'FYI',   color: 'var(--mc-cyan)',    blurb: 'Fresh ideas & context' },
};

const norm = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
const daysBetween = (iso: string) => {
  const t = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : '')).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86_400_000);
};
const fmtN = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

// Build a live price + sector map from the two bulk quote feeds.
async function fetchQuoteMap(): Promise<Record<string, { price?: number; chg?: number; sector?: string; region: 'IN' | 'US' }>> {
  const out: Record<string, { price?: number; chg?: number; sector?: string; region: 'IN' | 'US' }> = {};
  const grab = async (market: 'india' | 'us', region: 'IN' | 'US') => {
    try {
      const r = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const rows: any[] = j?.stocks || j?.quotes || j?.data || j?.results || (Array.isArray(j) ? j : []);
      for (const row of rows) {
        const sym = norm(row?.ticker || row?.symbol || '');
        if (!sym || out[sym]) continue; // india wins collisions (grabbed first)
        out[sym] = {
          price: Number(row?.price ?? row?.ltp ?? row?.lastPrice ?? row?.regularMarketPrice) || undefined,
          chg: Number(row?.changePercent ?? row?.pChange ?? row?.change_pct) || undefined,
          sector: row?.sector || undefined,
          region,
        };
      }
    } catch { /* feed down — skip */ }
  };
  await grab('india', 'IN');
  await grab('us', 'US');
  return out;
}

export default function CockpitPage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState({ held: 0, bench: 0, theses: 0 });
  const [notify, setNotify] = useState(false);
  const [builtAt, setBuiltAt] = useState<string>('');
  const [mkt, setMkt] = useState<'ALL' | 'IN' | 'US'>('ALL');   // zzz1300 — India / USA / both
  useEffect(() => { try { const v = localStorage.getItem('mc:cockpit:market:v1'); if (v === 'IN' || v === 'US' || v === 'ALL') setMkt(v); } catch { /* */ } }, []);
  const pickMkt = (v: 'ALL' | 'IN' | 'US') => { setMkt(v); try { localStorage.setItem('mc:cockpit:market:v1', v); } catch { /* */ } };

  useEffect(() => { setMounted(true); }, []);

  const runRef = useRef(0);      // zzz531 — newest build wins; a slow concurrent build can't clobber it
  const aliveRef = useRef(true); // zzz531 — no setState after unmount
  const build = useMemo(() => async () => {
    const run = ++runRef.current;
    setLoading(true);
    const sig: Signal[] = [];

    // ── Read local stores ────────────────────────────────────────────────
    let heldMap = new Map<string, any>();
    try { heldMap = getPortfolioMap(); } catch { /* */ }
    const held = new Set(Array.from(heldMap.keys()).map(norm));
    let bench: any[] = [];
    try { bench = getConvictionList(); } catch { /* */ }
    const benchByTicker = new Map<string, any>();
    for (const b of bench) benchByTicker.set(norm(b.ticker), b);
    const benchSet = new Set(benchByTicker.keys());
    const universe = Array.from(new Set([...held, ...benchSet])).filter(Boolean);
    // zzz1300 — USA: holdings (this browser's US rows + the US book) and the US Conviction Beats bench
    const heldUs = new Set<string>();
    for (const [k, h] of heldMap) if ((h as any)?.market === 'US') heldUs.add(norm(k));
    try {
      const j = await fetch('/api/v1/us-book', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      for (const h of j?.book?.holdings || j?.holdings || []) if (h?.ticker && !(Number(h?.quantity ?? h?.shares ?? 1) <= 0)) heldUs.add(norm(h.ticker));
    } catch { /* local only */ }
    for (const t of heldUs) held.add(t);
    let usBench: any[] = [];
    try { usBench = getUsConvictionList(); } catch { /* */ }
    const usBenchBy = new Map<string, any>();
    for (const b of usBench) if (b?.ticker) usBenchBy.set(norm(b.ticker), b);
    const inHeld = [...held].filter((t) => !heldUs.has(t));

    let theses: any[] = [];
    try { theses = getThesisList(); } catch { /* */ }
    let vals: any[] = [];
    try { vals = listAutoValuations(); } catch { /* */ }

    setCounts({ held: held.size, bench: benchSet.size + usBenchBy.size, theses: theses.length });

    // ── Parallel remote fetches (all optional) ───────────────────────────
    const slimRows = async (market: 'IN' | 'US', tickers: string[]): Promise<any[]> => {
      const out: any[] = [];
      for (let i = 0; i < tickers.length; i += 300) {
        const part = tickers.slice(i, i + 300);
        const j = await fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(part.join(','))}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        for (const r of j?.rows || []) out.push(r);
      }
      return out;
    };
    const [quoteMap, grades, rotIN, rotUS, cal, slimIn, slimUs] = await Promise.all([
      fetchQuoteMap(),
      universe.length
        ? fetch(`/api/v1/portfolio/earnings-grades?tickers=${encodeURIComponent(universe.join(','))}`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      fetch('/api/market/theme-rotation?region=india', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/market/theme-rotation?region=us', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      (() => {
        const from = new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
        return fetch(`/api/v1/earnings/calendar?from=${from}&to=${to}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
      })(),
      slimRows('IN', Array.from(new Set([...inHeld, ...benchSet]))),
      slimRows('US', Array.from(new Set([...heldUs, ...usBenchBy.keys()]))),
    ]);

    // ── 1. Thesis breaches (sell-discipline) — highest priority ──────────
    for (const t of theses) {
      const tk = norm(t.ticker);
      const e = benchByTicker.get(tk);
      const reasons: string[] = [];
      for (const trig of (t.triggers || [])) {
        if (trig.kind === 'margin' && e && e.opm_pct != null && e.opm_prev_pct != null && e.opm_pct < e.opm_prev_pct
            && (trig.threshold == null || e.opm_pct < trig.threshold)) {
          reasons.push(`margin ${e.opm_pct.toFixed(1)}% (was ${e.opm_prev_pct.toFixed(1)}%)`);
        }
        if (trig.kind === 'growth' && e && e.net_profit_yoy_pct != null && e.net_profit_yoy_pct < (trig.threshold ?? 0)) {
          reasons.push(`PAT YoY ${e.net_profit_yoy_pct.toFixed(0)}%`);
        }
        if (trig.kind === 'cash' && e) {
          const r = (e.cfo_to_pat_ratio ?? (Array.isArray(e.annual_cfo_pat) && e.annual_cfo_pat.length ? e.annual_cfo_pat[e.annual_cfo_pat.length - 1] : null));
          if (r != null && r < (trig.threshold ?? 0.6)) reasons.push(`CFO/PAT ${r.toFixed(2)}`);
        }
        if (trig.kind === 'price' && trig.threshold != null) {
          const p = quoteMap[tk]?.price;
          if (p != null && p < trig.threshold) reasons.push(`price ${p} < ${trig.threshold}`);
        }
      }
      if (reasons.length) {
        sig.push({
          id: `thesis-${tk}`, sev: 'act', priority: 100, icon: '⚠', kind: 'THESIS',
          ticker: t.ticker, title: `${t.company || t.ticker}: thesis review`,
          detail: `Invalidation trigger hit — ${reasons.join(' · ')}. Decide: hold or trim.`,
          href: '/thesis',
        });
      }
    }

    // ── 2. Your holdings / bench that just reported ──────────────────────
    const gr = grades?.results || {};
    for (const key of Object.keys(gr)) {
      const g = gr[key];
      if (!g || !g.filing_date) continue;
      const tk = norm(g.ticker || key);
      const isHeld = held.has(tk);
      const age = daysBetween(g.filing_date);
      if (age == null || age > 6 || age < 0) continue;       // reported in the last ~week
      const strong = g.tier === 'BLOCKBUSTER' || g.tier === 'STRONG';
      const weak = g.tier === 'AVOID';
      const bits: string[] = [];
      if (g.revenue_yoy != null) bits.push(`Rev ${g.revenue_yoy >= 0 ? '+' : ''}${Math.round(g.revenue_yoy)}%`);
      if (g.pat_yoy != null) bits.push(`PAT ${g.pat_yoy >= 0 ? '+' : ''}${Math.round(g.pat_yoy)}%`);
      sig.push({
        id: `rep-${tk}`,
        sev: isHeld && (strong || weak) ? 'act' : 'watch',
        priority: (isHeld ? 60 : 40) + (g.composite_score ? g.composite_score / 10 : 0),
        icon: strong ? '🟢' : weak ? '🔴' : '🟡',
        kind: 'REPORTED',
        ticker: g.ticker || key, name: g.company || undefined, group: 'Just reported (last 7 days)',
        note: `${g.tier || 'graded'} · ${age === 0 ? 'today' : age + 'd ago'}${bits.length ? ' · ' + bits.join(' · ') : ''}${isHeld ? ' · you hold this' : ''}`,
        title: `${g.company || tk} reported — ${g.tier || 'graded'}${isHeld ? ' · you hold this' : ' · on your bench'}`,
        detail: `${age === 0 ? 'today' : age + 'd ago'} · ${bits.join(' · ') || 'graded'}${g.composite_score ? ` · score ${g.composite_score}` : ''}.`,
        href: `/earnings-opportunities?date=${g.filing_date}`,
      });
    }

    // ── 3. Your holdings reporting soon (calendar, next 14d) ─────────────
    const byDate = cal?.by_date || {};
    const seenSoon = new Set<string>();
    for (const d of Object.keys(byDate)) {
      for (const it of (byDate[d] || [])) {
        const tk = norm(it.symbol || it.ticker || '');
        if (!tk || seenSoon.has(tk)) continue;
        if (!held.has(tk) && !benchSet.has(tk)) continue;
        const inDays = daysBetween(d);
        if (inDays == null || inDays > 0) { /* future date → negative days */ }
        const days = inDays == null ? null : -inDays;
        if (days == null || days < 0) continue;
        seenSoon.add(tk);
        sig.push({
          id: `soon-${tk}`, sev: 'watch', priority: 45 - Math.min(days, 14),
          icon: '📅', kind: 'UPCOMING', ticker: it.symbol || tk, name: it.company || undefined, group: 'Reporting in the next 14 days',
          note: `${days === 0 ? 'today' : 'in ' + days + 'd'} · ${held.has(tk) ? 'you hold this' : 'on your bench'} · ${it.quarter || 'results'} ${d}`,
          title: `${it.company || tk} reports ${days === 0 ? 'today' : 'in ' + days + 'd'}`,
          detail: `${held.has(tk) ? 'You hold this' : 'On your bench'} · ${it.quarter || 'results'} board meeting ${d}. Prep before the print.`,
          href: '/earnings-hub',
        });
      }
    }

    // ── 4. Theme rotation ADD / TRIM ─────────────────────────────────────
    // TRIM signals where you're actually exposed are always shown (they're
    // decisions). "Rotating in" ADD themes are opportunities — there are dozens
    // every day, so we keep only the highest-conviction handful rather than
    // flooding the board (zzz512).
    const themeAdds: Signal[] = [];
    const pushThemes = (rot: any, region: string) => {
      if (!rot?.themes) return;
      const memberHeld = (members: any): string[] => {
        const arr: string[] = Array.isArray(members) ? members.map(norm) : [];
        return arr.filter(m => held.has(m));
      };
      for (const th of rot.themes) {
        if (!th?.ok) continue;
        const yoursIn = memberHeld(th.members);
        if (th.action === 'TRIM' || th.verdict === 'AVOID') {
          if (yoursIn.length) {
            sig.push({
              id: `theme-trim-${region}-${th.id}`, sev: 'act', priority: 70,
              icon: '✂️', kind: 'THEME', market: region === 'india' ? 'IN' : 'US', title: `${th.emoji || ''} ${th.name} is rotating OUT — you're exposed`,
              detail: `${yoursIn.join(', ')} sit in this theme (${th.verdict}). Rotation says trim / tighten stops.`,
              href: `/multibagger?tab=theme-rotation&region=${region}`,
            });
          }
        } else if (th.action === 'ADD' || th.verdict === 'EARLY BUY' || th.verdict === 'BUY') {
          // Held-in-theme opportunities rank above pure new ones.
          themeAdds.push({
            id: `theme-add-${region}-${th.id}`, sev: 'info', priority: (yoursIn.length ? 30 : 20) + (th.conviction ? th.conviction / 10 : 0),
            icon: '➕', kind: 'THEME', market: region === 'india' ? 'IN' : 'US', group: 'Themes rotating in', name: `${th.emoji || ''} ${th.name}`.trim(),
            note: `${region === 'india' ? '🇮🇳 India' : '🇺🇸 USA'} · ${th.verdict} · conviction ${th.conviction ?? '—'}/100${yoursIn.length ? ` · you hold ${yoursIn.join(', ')}` : ''}`,
            title: `${th.emoji || ''} ${th.name} rotating in — ${th.verdict}`,
            detail: `${region === 'india' ? '🇮🇳' : '🇺🇸'} conviction ${th.conviction ?? '—'}/100${yoursIn.length ? ` · you hold ${yoursIn.join(', ')}` : ' · new opportunity'}.`,
            href: `/multibagger?tab=theme-rotation&region=${region}`,
          });
        }
      }
    };
    pushThemes(rotIN, 'india');
    pushThemes(rotUS, 'us');
    themeAdds.sort((a, b) => b.priority - a.priority);
    for (const s of themeAdds.slice(0, 8)) sig.push(s);   // top 8 rotating-in themes only

    // ── 5. Valuation signals (your saved fair values) ────────────────────
    for (const v of vals) {
      const tk = norm(v.ticker);
      const live = quoteMap[tk]?.price;
      const rec = v.recommendation;
      if (rec === 'BUY') {
        const cheaper = (live != null && v.priceAtSave != null && live < v.priceAtSave);
        sig.push({
          id: `val-${tk}`, sev: cheaper ? 'act' : 'watch', priority: cheaper ? 65 : 35,
          icon: '🧮', kind: 'VALUE', ticker: v.ticker,
          title: `${v.company || tk}: your valuation says BUY${cheaper ? ' — and it got cheaper' : ''}`,
          detail: live != null && v.priceAtSave != null
            ? `Now ${live} vs ${v.priceAtSave} when you flagged it (${((live / v.priceAtSave - 1) * 100).toFixed(0)}%).`
            : 'Your saved fair-value rates it a buy. Re-check the entry.',
          href: '/valuation-calc',
        });
      }
    }

    // ── 6. New conviction ideas (added in last 7 days) ───────────────────
    // A whole earnings season can grade hundreds of names in a week, so instead
    // of one card each (which buried the board under 200+ rows), keep only the
    // highest-scoring dozen you don't already own, and add a single roll-up
    // card for the rest (zzz512).
    const newIdeas = bench
      .map(b => ({ b, age: b.added_at ? daysBetween(b.added_at) : null }))
      .filter(({ b, age }) => age != null && age >= 0 && age <= 7 && !held.has(norm(b.ticker)))
      .sort((a, z) => (z.b.composite_score || 0) - (a.b.composite_score || 0));
    for (const { b, age } of newIdeas.slice(0, 12)) {
      const tk = norm(b.ticker);
      sig.push({
        id: `new-${tk}`, sev: 'info', priority: 15 + (b.composite_score ? b.composite_score / 12 : 0),
        icon: '✨', kind: 'NEW IDEA', ticker: b.ticker, name: b.company || undefined, market: 'IN', group: 'New on your India bench (last 7 days)',
        note: `🇮🇳 ${b.tier}${b.composite_score ? ` · score ${b.composite_score}` : ''}${b.sector ? ` · ${b.sector}` : ''} · graded ${age === 0 ? 'today' : age + 'd ago'}`,
        title: `New on your bench: ${b.company || tk} — ${b.tier}`,
        detail: `Graded ${age === 0 ? 'today' : age + 'd ago'}${b.composite_score ? ` · score ${b.composite_score}` : ''}${b.sector ? ` · ${b.sector}` : ''}. Size it or pass.`,
        href: '/watchlists?tab=conviction',
      });
    }
    if (newIdeas.length > 12) {
      sig.push({
        id: 'new-more', sev: 'info', priority: 5,
        icon: '📋', kind: 'NEW IDEAS',
        title: `+${newIdeas.length - 12} more freshly-graded names on your bench`,
        detail: `${newIdeas.length} names graded in the last week. Open Conviction Beats to size the rest, or use Position Sizing for a ranked plan.`,
        href: '/position-sizing',
      });
    }

    // ── 7. Moving-average entries (zzz1300): 21-day EMA, 50-day, 200-day — India + USA, held + bench ──
    const seenEntry = new Set<string>();
    const pushMa = (r: any, market: 'IN' | 'US') => {
      const tk = norm(String(r?.t || ''));
      if (!tk || seenEntry.has(`${market}:${tk}`)) return;
      const e = maEntry(r);
      if (!e) return;
      seenEntry.add(`${market}:${tk}`);
      const isHeld = market === 'US' ? heldUs.has(tk) : held.has(tk) && !heldUs.has(tk);
      // bench names: only clean Stage 2 leaders (RS 70+), so the list stays short enough to act on
      if (!isHeld && !(r?.twSt === 2 && (typeof r?.rs !== 'number' || r.rs >= 70))) { seenEntry.delete(`${market}:${tk}`); return; }
      const name = r?.n || (market === 'US' ? usBenchBy.get(tk)?.company : benchByTicker.get(tk)?.company) || undefined;
      const st = typeof r?.twSt === 'number' ? ` · Stage ${r.twSt}` : '';
      const rs = typeof r?.rs === 'number' ? ` · RS ${r.rs}` : '';
      sig.push({
        id: `ma-${market}-${tk}`, sev: 'watch', priority: (isHeld ? 60 : 40) - Math.abs(e.pct),
        icon: e.kind === 'sma200' ? '🛡' : '🎯', kind: 'ENTRY', ticker: tk, name, market, held: isHeld,
        title: `${name || tk} is ${e.note}${isHeld ? ' (you hold this)' : ''}`,
        detail: `${market === 'US' ? '🇺🇸' : '🇮🇳'} ${e.note}${st}${rs}. ${isHeld ? 'Add on strength or hold.' : 'On your bench — check the chart before starting a position.'}`,
        note: `${market === 'US' ? '🇺🇸' : '🇮🇳'} ${e.note}${st}${rs}`,
        group: MA_LABEL[e.kind],
        href: `/charts?m=${market}&t=${encodeURIComponent(tk)}`,
      });
    };
    for (const r of slimIn || []) pushMa(r, 'IN');
    for (const r of slimUs || []) pushMa(r, 'US');
    // the Technicals tab's own rows, for names the screener snapshot does not carry
    try {
      const bz = getTechBuyZone();
      for (const [tk, info] of bz) {
        const market: 'IN' | 'US' = info.market === 'IND' ? 'IN' : 'US';
        if (seenEntry.has(`${market}:${tk}`)) continue;
        const isHeld = held.has(tk);
        if (!isHeld && !benchSet.has(tk) && !usBenchBy.has(tk)) continue;
        seenEntry.add(`${market}:${tk}`);
        const note = `${market === 'US' ? '🇺🇸' : '🇮🇳'} ${String(info.note || '').replace(/ — Qulla entry/i, '')}`;
        sig.push({
          id: `tech-${tk}`, sev: 'watch', priority: isHeld ? 52 : 38,
          icon: '🎯', kind: 'ENTRY', ticker: tk, market, held: isHeld, name: benchByTicker.get(tk)?.company || usBenchBy.get(tk)?.company || undefined,
          title: `${tk} is at a technical entry${isHeld ? ' (you hold this)' : ''}`, detail: `${note} (from the Technicals tab).`, note,
          group: /21-EMA/i.test(info.note) ? MA_LABEL.ema21 : MA_LABEL.sma50,
          href: `/charts?m=${market}&t=${encodeURIComponent(tk)}`,
        });
      }
    } catch { /* tech rows not loaded */ }

    // ── 7b. New on the US bench (last 7 days) ──
    const usNew = usBench
      .map((b) => ({ b, age: b.filing_date ? daysBetween(b.filing_date) : null }))
      .filter(({ b, age }) => age != null && age >= 0 && age <= 7 && !heldUs.has(norm(b.ticker)) && (b.tier === 'BLOCKBUSTER' || b.tier === 'STRONG'))
      .sort((a, z) => (z.b.composite_score || 0) - (a.b.composite_score || 0));
    for (const { b, age } of usNew.slice(0, 12)) {
      const tk = norm(b.ticker);
      sig.push({
        id: `new-us-${tk}`, sev: 'info', priority: 15 + (b.composite_score ? b.composite_score / 12 : 0),
        icon: '✨', kind: 'NEW IDEA', ticker: b.ticker, name: b.company || undefined, market: 'US', group: 'New on your US bench (last 7 days)',
        title: `New on your US bench: ${b.company || tk} — ${b.tier}`,
        detail: `Reported ${age === 0 ? 'today' : age + 'd ago'}${b.composite_score ? ` · score ${b.composite_score}` : ''}${b.sector ? ` · ${b.sector}` : ''}.`,
        note: `🇺🇸 ${b.tier}${b.composite_score ? ` · score ${b.composite_score}` : ''}${b.sector ? ` · ${b.sector}` : ''} · reported ${age === 0 ? 'today' : age + 'd ago'}`,
        href: '/us-conviction-beats',
      });
    }

    // ── 8. A holding down hard today (needs a look) ──────────────────────
    for (const tk of held) {
      const chg = quoteMap[tk]?.chg;
      if (chg == null || chg > -6) continue;
      sig.push({
        id: `drop-${tk}`, sev: chg <= -9 ? 'act' : 'watch', priority: 55 + Math.min(20, Math.abs(chg)),
        icon: '📉', kind: 'MOVE', ticker: tk, market: quoteMap[tk]?.region === 'US' ? 'US' : 'IN', name: heldMap.get(tk)?.company || heldMap.get(tk)?.name || undefined,
        title: `${tk} is down ${Math.abs(chg).toFixed(1)}% today`,
        detail: `A sharp move on a name you hold. Check the news and your thesis before it becomes an emotional decision.`,
        href: `/news`,
      });
    }

    for (const s of sig) {
      if (!s.ticker) continue;
      const k = norm(s.ticker);
      const q = quoteMap[k];
      if (s.chg == null && q?.chg != null) s.chg = q.chg;
      if (s.held == null) s.held = held.has(k);
      if (s.name) s.name = s.name.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    }

    sig.sort((a, b) => {
      const order = { act: 0, watch: 1, info: 2 };
      if (order[a.sev] !== order[b.sev]) return order[a.sev] - order[b.sev];
      return b.priority - a.priority;
    });

    // zzz514 — drop anything the user dismissed; flag what's new since last visit.
    let shown = sig;
    let freshIds = new Set<string>();
    try {
      const dz = getDismissed('cockpit');
      shown = sig.filter((s) => !dz.has(s.id));
      freshIds = diffNew('cockpit', shown.map((s) => s.id));
      markSeen('cockpit', shown.map((s) => s.id));
    } catch { /* storage unavailable */ }
    if (!aliveRef.current || run !== runRef.current) return; // zzz531 — a newer build superseded this one
    setNewIds(freshIds);
    setSignals(shown);
    // zzz524 — track record: log the top tickered signals so the Signal
    // Scoreboard can grade the Cockpit engine over time.
    try {
      logSignals('cockpit', shown.filter((s) => s.ticker).slice(0, 12).map((s) => ({
        ticker: s.ticker as string, note: `${s.kind}: ${s.title}`.slice(0, 80),
      })));
    } catch { /* never load-bearing */ }
    setBuiltAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    setLoading(false);

    // Morning-briefing notification (once/day, opt-in, needs the app open)
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('mc:cockpit:notify') === '1'
          && 'Notification' in window && Notification.permission === 'granted') {
        const todayKey = new Date().toISOString().slice(0, 10);
        const last = localStorage.getItem('mc:cockpit:notified');
        const hour = new Date().getHours();
        const acts = sig.filter(s => s.sev === 'act').length;
        if (last !== todayKey && hour >= 7) {
          localStorage.setItem('mc:cockpit:notified', todayKey);
          new Notification('Market Cockpit — morning briefing', {
            body: acts ? `${acts} decision${acts > 1 ? 's' : ''} need you today · ${sig.length} signals in all.` : `Quiet day — ${sig.length} signals, nothing urgent.`,
          });
        }
      }
    } catch { /* notifications unavailable */ }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    aliveRef.current = true;
    build();
    setNotify(typeof window !== 'undefined' && localStorage.getItem('mc:cockpit:notify') === '1');
    const onChange = () => build();
    window.addEventListener('conviction-beats:updated', onChange);
    window.addEventListener('thesis:updated', onChange);
    window.addEventListener('mc:auto-val:updated', onChange);
    return () => {
      aliveRef.current = false; // zzz531 — stop any in-flight build from setState-ing after unmount
      window.removeEventListener('conviction-beats:updated', onChange);
      window.removeEventListener('thesis:updated', onChange);
      window.removeEventListener('mc:auto-val:updated', onChange);
    };
  }, [mounted, build]);

  async function toggleNotify() {
    if (typeof window === 'undefined') return;
    if (notify) {
      localStorage.setItem('mc:cockpit:notify', '0');
      setNotify(false);
      return;
    }
    try {
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm === 'granted') {
        localStorage.setItem('mc:cockpit:notify', '1');
        setNotify(true);
      }
    } catch { /* */ }
  }

  const visible = useMemo(() => (mkt === 'ALL' ? signals : signals.filter((s) => !s.market || s.market === mkt)), [signals, mkt]);
  const grouped = useMemo(() => {
    const m: Record<Sev, Signal[]> = { act: [], watch: [], info: [] };
    for (const s of visible) m[s.sev].push(s);
    return m;
  }, [visible]);

  const actN = grouped.act.length;
  const kpi = useMemo(() => {
    const k = (f: (s: Signal) => boolean) => visible.filter(f).length;
    return [
      { n: actN, l: 'need a decision', c: actN > 0 ? C.red : C.muted },
      { n: k((s) => s.kind === 'MOVE'), l: 'holdings moving hard', c: C.red },
      { n: k((s) => s.kind === 'REPORTED'), l: 'just reported', c: C.text0 },
      { n: k((s) => s.kind === 'UPCOMING'), l: 'report in 14 days', c: C.amber },
      { n: k((s) => s.kind === 'ENTRY' && !!s.held), l: 'entries · held', c: C.green },
      { n: k((s) => s.kind === 'ENTRY' && !s.held), l: 'entries · bench', c: C.cyan },
      { n: k((s) => s.kind === 'NEW IDEA'), l: 'new ideas', c: C.saffron },
      { n: counts.held, l: `holdings · ${counts.bench} on bench`, c: C.text },
    ];
  }, [visible, actN, counts]);

  const onDismiss = (id: string) => { try { dismiss('cockpit', id); build(); } catch {} };

  if (!mounted) {
    return <div style={{ background: C.bg, minHeight: '100vh' }} />;
  }

  const btn: CSSProperties = { ...MONO, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${C.border2}`, background: C.card2, color: C.muted };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '16px 20px 64px' }}>
      <div style={{ width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...MONO, fontSize: 11, letterSpacing: '0.22em', color: C.dim, textTransform: 'uppercase', fontWeight: 600 }}>Daily Action Cockpit</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '4px 0 0', color: C.text0, letterSpacing: '-0.01em' }}>
              {loading ? 'Reading your book…' : actN > 0 ? `${actN} decision${actN > 1 ? 's' : ''} need you today` : 'Nothing urgent today'}
            </h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              Decisions first, then what is moving, then fresh ideas. Built from your holdings, bench, theses, results, themes and valuations.
              {builtAt && <span style={{ ...MONO, color: C.dim }}> · built {builtAt}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: `1px solid ${C.border2}`, borderRadius: 6, overflow: 'hidden' }}>
              {([['ALL', 'Both'], ['IN', '🇮🇳 India'], ['US', '🇺🇸 USA']] as const).map(([v, l]) => (
                <button key={v} onClick={() => pickMkt(v)} style={{ ...btn, border: 'none', borderRadius: 0, background: mkt === v ? 'color-mix(in srgb, var(--mc-accent) 18%, transparent)' : C.card2, color: mkt === v ? C.text0 : C.muted }}>{l}</button>
              ))}
            </div>
            <button onClick={toggleNotify} title="Fire a browser notification each morning while the app is open"
              style={{ ...btn, border: `1px solid ${notify ? 'color-mix(in srgb, var(--mc-bullish) 45%, transparent)' : C.border2}`,
                background: notify ? 'color-mix(in srgb, var(--mc-bullish) 12%, transparent)' : C.card2, color: notify ? C.green : C.muted }}>
              {notify ? '🔔 Morning briefing on' : '🔕 Morning briefing off'}
            </button>
            <button onClick={() => build()} title="Rebuild the board" style={btn}>↻ Refresh</button>
            <button onClick={() => { try { clearDismissed('cockpit'); build(); } catch {} }} title="Bring back cards you dismissed" style={{ ...btn, color: C.dim }}>↺ Show dismissed</button>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1, background: C.border, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', margin: '14px 0 16px' }}>
          {kpi.map((x, i) => (
            <div key={i} style={{ background: C.card, padding: '11px 14px' }}>
              <div style={{ ...MONO, fontSize: 24, fontWeight: 800, lineHeight: 1, color: x.n ? x.c : C.dim, fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : x.n}</div>
              <div style={{ fontSize: 10.5, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6, fontWeight: 600 }}>{x.l}</div>
            </div>
          ))}
        </div>

        {loading && (
          <div style={{ ...MONO, fontSize: 13, color: C.muted, padding: '40px 0', textAlign: 'center' }}>Assembling signals from your book…</div>
        )}

        {!loading && signals.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '34px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🛩️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text0, marginTop: 8 }}>Clear skies — nothing needs a decision</div>
            <div style={{ fontSize: 13, color: C.muted, maxWidth: '52ch', margin: '6px auto 0' }}>
              No breached theses, no fresh results on your names, no theme turning against you. Add holdings in <NavLink href="/portfolio" style={{ color: C.accent }}>My Book</NavLink> and theses in <NavLink href="/thesis" style={{ color: C.accent }}>Thesis Tracker</NavLink> to feed the cockpit.
            </div>
          </div>
        )}

        {!loading && signals.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 600px), 1fr))', gap: 18, alignItems: 'start' }}>
            {/* Left: decisions + what is moving */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <Band sev="act" items={grouped.act} newIds={newIds} onDismiss={onDismiss}
                empty="Nothing needs a decision today — no thesis breach, no sharp drop, no theme turning against you." />
              <Band sev="watch" items={grouped.watch} newIds={newIds} onDismiss={onDismiss} />
            </div>
            {/* Right: disagreements + fresh ideas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <ConflictsPanel />
              <Band sev="info" items={grouped.info} newIds={newIds} onDismiss={onDismiss} />
            </div>
          </div>
        )}

        <div style={{ ...MONO, fontSize: 10.5, color: C.dim, marginTop: 28, borderTop: `1px solid ${C.border}`, paddingTop: 12, lineHeight: 1.7 }}>
          Sources: your holdings, Conviction bench, thesis triggers, portfolio earnings grades, theme rotation (India + USA), earnings calendar, saved valuations. Nothing new is downloaded here — the cockpit only sorts signals the other pages already make. ✕ hides a card until something new appears; ↺ brings hidden cards back.
        </div>
      </div>
    </div>
  );
}

// zzz1300 — one band (Act / Watch / FYI): single signals as cards, signals of one kind as a compact table.
function Band({ sev, items, newIds, onDismiss, empty }: { sev: Sev; items: Signal[]; newIds: Set<string>; onDismiss: (id: string) => void; empty?: string }) {
  const meta = SEV_META[sev];
  if (!items.length && !empty) return null;
  const order: string[] = [];
  const groups = new Map<string, Signal[]>();
  const cards: Signal[] = [];
  for (const s of items) {
    if (!s.group) { cards.push(s); continue; }
    if (!groups.has(s.group)) { groups.set(s.group, []); order.push(s.group); }
    groups.get(s.group)!.push(s);
  }
  // a "table" of one or two rows reads better as cards
  for (const g of [...order]) { const rows = groups.get(g)!; if (rows.length <= 2) { cards.push(...rows); groups.delete(g); order.splice(order.indexOf(g), 1); } }
  cards.sort((a, b) => b.priority - a.priority);
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${meta.color}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ ...MONO, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: meta.color }}>{meta.label} · {items.length}</span>
        <span style={{ fontSize: 12, color: C.dim }}>{meta.blurb}</span>
      </div>
      {!items.length && empty && <div style={{ fontSize: 13, color: C.muted, padding: '4px 0 6px' }}>✓ {empty}</div>}
      {cards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: order.length ? 14 : 0 }}>
          {cards.map((s) => <SignalCard key={s.id} s={s} isNew={newIds.has(s.id)} onDismiss={onDismiss} />)}
        </div>
      )}
      {order.map((g) => <GroupTable key={g} title={g} rows={groups.get(g)!} newIds={newIds} onDismiss={onDismiss} />)}
    </section>
  );
}

function ChgCell({ v }: { v?: number | null }) {
  if (v == null || !Number.isFinite(v)) return <span style={{ ...MONO, color: C.dim }}>—</span>;
  return <span style={{ ...MONO, fontWeight: 700, color: v > 0 ? C.green : v < 0 ? C.red : C.muted, fontVariantNumeric: 'tabular-nums' }}>{v > 0 ? '+' : ''}{v.toFixed(1)}%</span>;
}

function SignalCard({ s, isNew, onDismiss }: { s: Signal; isNew: boolean; onDismiss: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', background: C.card2, border: `1px solid ${isNew ? `color-mix(in srgb, ${C.accent} 45%, ${C.border})` : C.border}`, borderLeft: `3px solid ${SEV_META[s.sev].color}`, borderRadius: 8 }}>
      <NavLink href={s.href} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 6px 9px 12px' }}>
          <div style={{ fontSize: 17, lineHeight: 1.2 }}>{s.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ ...MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: C.dim, border: `1px solid ${C.border}`, padding: '1px 6px', borderRadius: 4 }}>{s.kind}</span>
              {isNew && <span style={{ ...MONO, fontSize: 9, fontWeight: 800, color: C.accent }}>NEW</span>}
              {s.ticker && <span style={{ ...MONO, fontSize: 12, fontWeight: 800, color: C.text0 }}>{norm(s.ticker)}</span>}
              {s.held && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>● held</span>}
              {s.chg != null && <ChgCell v={s.chg} />}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text0, marginTop: 3 }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{s.detail}</div>
          </div>
          <div style={{ ...MONO, fontSize: 15, color: C.dim, alignSelf: 'center' }}>›</div>
        </div>
      </NavLink>
      <button onClick={() => onDismiss(s.id)} title="Dismiss — I've handled this"
        style={{ ...MONO, fontSize: 13, color: C.dim, background: 'transparent', border: 'none', borderLeft: `1px solid ${C.border}`, cursor: 'pointer', padding: '0 11px', flexShrink: 0 }}>✕</button>
    </div>
  );
}

function GroupTable({ title, rows, newIds, onDismiss }: { title: string; rows: Signal[]; newIds: Set<string>; onDismiss: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const LIMIT = 10;
  const shown = all ? rows : rows.slice(0, LIMIT);
  const hasTicker = rows.some((r) => r.ticker);
  const cols = hasTicker ? '92px minmax(120px, 1.1fr) minmax(140px, 1.6fr) 62px 26px' : 'minmax(140px, 1fr) minmax(160px, 1.8fr) 26px';
  return (
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 0 6px' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text0 }}>{rows[0]?.icon} {title}</span>
        <span style={{ ...MONO, fontSize: 11, color: C.dim }}>{rows.length}</span>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '6px 10px', background: C.panel, ...MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: C.dim, textTransform: 'uppercase' }}>
          {hasTicker ? <><span>Ticker</span><span>Company</span><span>What</span><span style={{ textAlign: 'right' }}>Today</span><span /></> : <><span>Name</span><span>What</span><span /></>}
        </div>
        {shown.map((r, i) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '7px 10px', fontSize: 12.5, background: i % 2 ? C.card : C.card2, borderTop: `1px solid ${C.border}` }}>
            {hasTicker && (
              <NavLink href={r.href} style={{ ...MONO, fontWeight: 800, color: C.text0, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.title}>
                {r.ticker ? norm(r.ticker) : '—'}{r.held && <span style={{ color: C.green }} title="you hold this"> ●</span>}{newIds.has(r.id) && <span style={{ color: C.accent, fontSize: 9 }}> NEW</span>}
              </NavLink>
            )}
            <NavLink href={r.href} style={{ color: hasTicker ? C.muted : C.text0, fontWeight: hasTicker ? 500 : 700, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.title}>
              {r.name || (r.ticker ? <span style={{ color: C.dim }}>—</span> : r.title)}
            </NavLink>
            <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.detail}>{r.note || r.detail}</span>
            {hasTicker && <span style={{ textAlign: 'right' }}><ChgCell v={r.chg} /></span>}
            <button onClick={() => onDismiss(r.id)} title="Dismiss" style={{ ...MONO, fontSize: 12, color: C.dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>✕</button>
          </div>
        ))}
      </div>
      {rows.length > LIMIT && (
        <button onClick={() => setAll((v) => !v)} style={{ ...MONO, fontSize: 11, color: C.accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 2px' }}>
          {all ? '▲ Show fewer' : `▼ Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// zzz525 — ⚔️ CONFLICTS PANEL. The Cockpit Verdict's disagreement list, on the
// cockpit itself: names you hold or bench where one engine says quality and
// another says decay/rich/broken chart. Conflicts are where judgment earns its
// keep — so they live on the action page, not buried in a drilldown.
// ════════════════════════════════════════════════════════════════════════════
function ConflictsPanel() {
  const [rows, setRows] = useState<Array<{ symbol: string; company: string; conflicts: string[]; kind: string }>>([]);
  useEffect(() => {
    try {
      const out: Array<{ symbol: string; company: string; conflicts: string[]; kind: string }> = [];
      for (const [, v] of getEngineViews()) {
        if (!v.holding && !v.bench) continue;           // only where it matters
        const verdict = computeVerdict(v);
        if (verdict.conflicts.length === 0) continue;
        out.push({ symbol: v.symbol, company: v.company, conflicts: verdict.conflicts, kind: verdict.kind });
      }
      out.sort((a, b) => b.conflicts.length - a.conflicts.length);
      setRows(out.slice(0, 8));
    } catch { setRows([]); }
  }, []);
  if (rows.length === 0) return null;
  return (
    <div style={{ background: 'color-mix(in srgb, var(--mc-warn) 5%, var(--mc-bg-1))', border: '1px solid color-mix(in srgb, var(--mc-warn) 30%, transparent)', borderTop: '3px solid var(--mc-warn)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '0.4px', color: 'var(--mc-warn)' }}>⚔️ ENGINE CONFLICTS · {rows.length}</span>
        <span style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>engines disagree on these — your judgment decides</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.symbol} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span onClick={() => openPassport(r.symbol)} title="Open Stock Passport" style={{ fontWeight: 900, color: 'var(--mc-text-1)', cursor: 'pointer' }}>{r.symbol}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 40%, transparent)', borderRadius: 3, padding: '0 5px' }}>{r.kind}</span>
            <span style={{ color: 'var(--mc-text-3)', fontSize: 12 }}>{r.conflicts[0]}{r.conflicts.length > 1 ? ` (+${r.conflicts.length - 1} more)` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
