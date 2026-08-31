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

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { getTechBuyZone } from '@/lib/tech-entries';
import { diffNew, markSeen, getDismissed, dismiss, clearDismissed } from '@/lib/seen-store';
import { getConvictionList } from '@/lib/conviction-beats';
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

  useEffect(() => { setMounted(true); }, []);

  const build = useMemo(() => async () => {
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

    let theses: any[] = [];
    try { theses = getThesisList(); } catch { /* */ }
    let vals: any[] = [];
    try { vals = listAutoValuations(); } catch { /* */ }

    setCounts({ held: held.size, bench: benchSet.size, theses: theses.length });

    // ── Parallel remote fetches (all optional) ───────────────────────────
    const [quoteMap, grades, rotIN, rotUS, cal] = await Promise.all([
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
        ticker: g.ticker || key,
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
          icon: '📅', kind: 'UPCOMING', ticker: it.symbol || tk,
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
              icon: '✂️', kind: 'THEME', title: `${th.emoji || ''} ${th.name} is rotating OUT — you're exposed`,
              detail: `${yoursIn.join(', ')} sit in this theme (${th.verdict}). Rotation says trim / tighten stops.`,
              href: `/multibagger?tab=theme-rotation&region=${region}`,
            });
          }
        } else if (th.action === 'ADD' || th.verdict === 'EARLY BUY' || th.verdict === 'BUY') {
          // Held-in-theme opportunities rank above pure new ones.
          themeAdds.push({
            id: `theme-add-${region}-${th.id}`, sev: 'info', priority: (yoursIn.length ? 30 : 20) + (th.conviction ? th.conviction / 10 : 0),
            icon: '➕', kind: 'THEME',
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
        icon: '✨', kind: 'NEW IDEA', ticker: b.ticker,
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

    // ── 7. Technical buy-zone (your names set up for an entry) ───────────
    try {
      const bz = getTechBuyZone();
      for (const [tk, info] of bz) {
        const isHeld = held.has(tk);
        const isBench = benchSet.has(tk);
        if (!isHeld && !isBench) continue;
        sig.push({
          id: `tech-${tk}`, sev: isHeld ? 'watch' : 'watch', priority: isHeld ? 52 : 48,
          icon: '🎯', kind: 'ENTRY', ticker: tk,
          title: `${benchByTicker.get(tk)?.company || tk} is at a technical entry${isHeld ? ' (you hold this)' : ''}`,
          detail: `${info.market === 'IND' ? '🇮🇳' : '🇺🇸'} ${info.note}. ${isHeld ? 'Add on strength or hold.' : 'On your bench — a clean setup to start a position.'}`,
          href: `/multibagger?tab=technicals-${info.market === 'IND' ? 'ind' : 'usa'}`,
        });
      }
    } catch { /* tech rows not loaded */ }

    // ── 8. A holding down hard today (needs a look) ──────────────────────
    for (const tk of held) {
      const chg = quoteMap[tk]?.chg;
      if (chg == null || chg > -6) continue;
      sig.push({
        id: `drop-${tk}`, sev: chg <= -9 ? 'act' : 'watch', priority: 55 + Math.min(20, Math.abs(chg)),
        icon: '📉', kind: 'MOVE', ticker: tk,
        title: `${tk} is down ${Math.abs(chg).toFixed(1)}% today`,
        detail: `A sharp move on a name you hold. Check the news and your thesis before it becomes an emotional decision.`,
        href: `/news`,
      });
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
    setNewIds(freshIds);
    setSignals(shown);
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
    build();
    setNotify(typeof window !== 'undefined' && localStorage.getItem('mc:cockpit:notify') === '1');
    const onChange = () => build();
    window.addEventListener('conviction-beats:updated', onChange);
    window.addEventListener('thesis:updated', onChange);
    window.addEventListener('mc:auto-val:updated', onChange);
    return () => {
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

  const bands: Sev[] = ['act', 'watch', 'info'];
  const grouped = useMemo(() => {
    const m: Record<Sev, Signal[]> = { act: [], watch: [], info: [] };
    for (const s of signals) m[s.sev].push(s);
    return m;
  }, [signals]);

  const actN = grouped.act.length;

  if (!mounted) {
    return <div style={{ background: C.bg, minHeight: '100vh' }} />;
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '18px 16px 64px' }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...MONO, fontSize: 11, letterSpacing: '0.22em', color: C.dim, textTransform: 'uppercase', fontWeight: 600 }}>Daily Action Cockpit</div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: '4px 0 0', color: C.text0, letterSpacing: '-0.01em' }}>
              What your book needs today
            </h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6, maxWidth: '62ch' }}>
              One ranked list, pulled from every signal you already track — earnings, rotation, valuations, and your own theses. {builtAt && <span style={{ ...MONO, color: C.dim }}>· built {builtAt}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={toggleNotify} title="Fire a browser notification each morning while the app is open"
              style={{ ...MONO, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${notify ? 'color-mix(in srgb, var(--mc-bullish) 45%, transparent)' : C.border2}`,
                background: notify ? 'color-mix(in srgb, var(--mc-bullish) 12%, transparent)' : C.card2,
                color: notify ? C.green : C.muted }}>
              {notify ? '🔔 MORNING BRIEFING ON' : '🔕 MORNING BRIEFING OFF'}
            </button>
            <button onClick={() => build()} title="Rebuild the board"
              style={{ ...MONO, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${C.border2}`, background: C.card2, color: C.muted }}>
              ↻ REFRESH
            </button>
            <button onClick={() => { try { clearDismissed('cockpit'); build(); } catch {} }} title="Restore dismissed cards"
              style={{ ...MONO, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${C.border2}`, background: C.card2, color: C.dim }}>
              ↺ RESET
            </button>
          </div>
        </div>

        {/* Briefing strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: C.border, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', margin: '18px 0 6px' }}>
          {[
            { n: actN, l: 'need action', c: actN > 0 ? C.red : C.muted },
            { n: signals.length, l: 'signals total', c: C.text0 },
            { n: counts.held, l: 'holdings', c: C.cyan },
            { n: counts.bench, l: 'on bench', c: C.saffron },
          ].map((x, i) => (
            <div key={i} style={{ background: C.card, padding: '13px 15px' }}>
              <div style={{ ...MONO, fontSize: 26, fontWeight: 800, lineHeight: 1, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.n}</div>
              <div style={{ fontSize: 10.5, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6, fontWeight: 600 }}>{x.l}</div>
            </div>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ ...MONO, fontSize: 13, color: C.muted, padding: '40px 0', textAlign: 'center' }}>Assembling signals from your book…</div>
        )}

        {/* Empty */}
        {!loading && signals.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '34px 24px', textAlign: 'center', marginTop: 14 }}>
            <div style={{ fontSize: 34 }}>🛩️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text0, marginTop: 8 }}>Clear skies — nothing needs a decision</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6, maxWidth: '52ch', margin: '6px auto 0' }}>
              No breached theses, no fresh prints on your names, no rotation flips against you. Add holdings in <Link href="/portfolio" style={{ color: C.accent }}>My Book</Link> and theses in <Link href="/thesis" style={{ color: C.accent }}>Thesis Tracker</Link> to feed the cockpit.
            </div>
          </div>
        )}

        {/* Bands */}
        {!loading && bands.map(b => grouped[b].length > 0 && (
          <section key={b} style={{ marginTop: 26 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ ...MONO, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: SEV_META[b].color, padding: '2px 8px', borderRadius: 5, background: `color-mix(in srgb, ${SEV_META[b].color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${SEV_META[b].color} 32%, transparent)` }}>
                {SEV_META[b].label} · {grouped[b].length}
              </span>
              <span style={{ fontSize: 12, color: C.dim }}>{SEV_META[b].blurb}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped[b].map(s => (
                <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'stretch', background: C.card, border: `1px solid ${newIds.has(s.id) ? `color-mix(in srgb, ${C.accent} 45%, ${C.border})` : C.border}`, borderLeft: `3px solid ${SEV_META[s.sev].color}`, borderRadius: 10 }}>
                  <Link href={s.href} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 4px 12px 14px' }}>
                      <div style={{ fontSize: 18, lineHeight: 1.2, marginTop: 1 }}>{s.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ ...MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: C.dim, background: C.card2, border: `1px solid ${C.border}`, padding: '1px 6px', borderRadius: 4 }}>{s.kind}</span>
                          {newIds.has(s.id) && <span style={{ ...MONO, fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: C.accent, background: `color-mix(in srgb, ${C.accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${C.accent} 40%, transparent)`, padding: '1px 5px', borderRadius: 4 }}>NEW</span>}
                          {s.ticker && <span style={{ ...MONO, fontSize: 11, fontWeight: 700, color: C.muted }}>{norm(s.ticker)}</span>}
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text0 }}>{s.title}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{s.detail}</div>
                      </div>
                      <div style={{ ...MONO, fontSize: 15, color: C.dim, alignSelf: 'center' }}>›</div>
                    </div>
                  </Link>
                  <button
                    onClick={() => { try { dismiss('cockpit', s.id); build(); } catch {} }}
                    title="Dismiss — I've handled this"
                    style={{ ...MONO, fontSize: 13, color: C.dim, background: 'transparent', border: 'none', borderLeft: `1px solid ${C.border}`, cursor: 'pointer', padding: '0 12px', flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div style={{ ...MONO, fontSize: 10.5, color: C.dim, marginTop: 34, borderTop: `1px solid ${C.border}`, paddingTop: 14, lineHeight: 1.7 }}>
          Sources: your holdings, Conviction bench, thesis triggers, portfolio earnings grades, theme rotation (IN + US), earnings calendar, saved valuations. Nothing is scraped here — the cockpit only routes signals the terminal already produces. Morning briefing fires a browser notification once/day while the app is open.
        </div>
      </div>
    </div>
  );
}
