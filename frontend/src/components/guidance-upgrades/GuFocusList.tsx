'use client';
// zzz880 — FOCUS LIST at the top of the guidance page: the companies to look at first, ranked, one plain line each.
import React, { useEffect, useMemo, useState } from 'react';
import { R, tint } from './gu-tokens';
import { pillStyle } from './GuPanel';
import { useGuUniverse, universeStatusLine } from './useGuUniverse';
import { setHeldKeys } from '@/lib/gu-held-store';
import { ageText } from '@/lib/gu-client-cache';
import { buildFocusList, holdInconsistentGrowth, focusGrowthHorizon, type FocusVerdict } from '@/lib/gu-focus';
import { INDIA_LARGE_CAPS } from '@/lib/india-large-caps';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import type { FocusRow } from '@/lib/gu-focus';
import { skyGoldScore, guidanceOfRow, type SkyScore } from '@/lib/gu-skygold-score';
import { useSkyGoldFacts, SkyScoreCell, SkyBreakdownRow } from './GuSkyGold';
import { fairValue, fvGrowthOf, fvStatus, type FvResult } from '@/lib/gu-fair-value';
import { sortByReported, reportedLabel } from '@/lib/gu-focus-sort';
import { FvCells, FV_HEAD, FV_COLS } from './GuFairValue';
import { opportunityScore, type Opportunity } from '@/lib/gu-opportunity';
import { OppCells, OppHead, OppBreakdownRow, OPP_COLS } from './GuOpportunity';

/** zzz1142 (evening verification E1) — every header and cell carries its column's NAME (`data-c`), and Compact hides columns by name
 *  (price, EPS estimate, source), never by position: a "no fair value" cell spanning two columns shifted the positions, so Compact hid
 *  the Opportunity score and left the EPS estimate under the Opportunity heading. */
/** Columns Compact hides, by name (see the CSS in gu-tokens). */
export const COMPACT_HIDDEN = ['price', 'eps', 'source'];
export const COLS_A = ['rank', 'company', 'raised', 'reported', 'price', 'fair', 'upside', 'eps', 'opp', 'sky', 'verdict'];
export const COLS_B = ['rank', 'company', 'growth', 'source', 'reported', 'price', 'fair', 'upside', 'eps', 'opp', 'sky', 'verdict'];
function FocusTable({ title, sub, head, colIds, empty, children, tableId }: { title: string; sub: string; head: React.ReactNode[]; colIds: string[]; empty: string; children: React.ReactNode; tableId?: 'A' | 'B' }) {
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 800, color: R.dim, borderBottom: `1px solid ${tint(R.grey, 40)}`, whiteSpace: 'nowrap' };
  const has = React.Children.toArray(children).length > 0;   // zzz906: toArray drops false / null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <b style={{ fontSize: 14 }}>{title}</b>
      <span style={{ fontSize: 12, color: R.dim }}>{sub}</span>
      {has ? (
        <div className="gu-scroll" role="region" aria-label={`${title} — scroll sideways for more columns`} tabIndex={0}>
          <table className="gu-focus-table" data-t={tableId} style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{head.map((h, i) => <th key={i} data-c={colIds[i]} style={th}>{h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : <span style={{ fontSize: 13, color: R.dim }}>{empty}</span>}
    </div>
  );
}
function CompanyCell({ r, td }: { r: FocusRow; td: React.CSSProperties }) {
  return (
    <td style={td} className="gu-co">
      <b>{r.company}</b>
      <div style={{ fontSize: 11.5, color: R.dim }}>{FLAG[r.market]} {r.ticker || ''}{r.capText ? ` · ${r.capText}` : ' · size not known'}</div>
    </td>
  );
}
function VerdictCell({ r, td, fv }: { r: FocusRow; td: React.CSSProperties; fv?: FvResult | null }) {
  // zzz934: the verdict is about the GUIDANCE; the price is a separate question — said in one line when the price already runs far ahead
  const st = fv?.ok && fv.base ? fvStatus(fv.base.upsidePct) : null;
  return (
    <td style={td}>
      <b style={{ color: VERDICT_COLOR[r.verdict], whiteSpace: 'nowrap' }}>{r.verdict}</b>
      <div style={{ fontSize: 11.5, color: R.dim }}>{r.why}</div>
      {st && (st.key === 'far-above' || st.key === 'above') ? <div style={{ fontSize: 11, color: R.amber, fontWeight: 700 }}>Guidance strong, but the price is {st.key === 'far-above' ? 'far ' : ''}above model fair value</div> : null}
    </td>
  );
}

const VERDICT_COLOR: Record<FocusVerdict, string> = { 'TOP FOCUS': R.green, 'STRONG RAISE': R.green, 'HIGH GROWTH': R.cyan, RAISED: R.violet, WATCH: R.grey };
const FLAG = { IN: '🇮🇳', US: '🇺🇸' } as const;
type Mk = 'ALL' | 'IN' | 'US';
const FOCUS_STEP = 20;
type SortBy = 'rank' | 'score' | 'opp' | 'new' | 'old';   // zzz927: 'new' / 'old' = by the date the news was reported
const skyKey = (r: FocusRow) => (r.ticker ? `${r.market}:${r.ticker.toUpperCase()}` : null);
/** zzz923: rows by score (a higher score first; no score last), the focus rank breaking ties */
function bySky(rows: FocusRow[], scores: Map<string, SkyScore | null>): FocusRow[] {
  const v = (r: FocusRow) => scores.get(r.key)?.score ?? -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => v(b.r) - v(a.r) || a.i - b.i).map((x) => x.r);
}
/** zzz929: rows by Opportunity score (a higher score first; no score last), the focus rank breaking ties */
function byOpp(rows: FocusRow[], opps: Map<string, Opportunity | null>): FocusRow[] {
  const v = (r: FocusRow) => opps.get(r.key)?.score ?? -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => v(b.r) - v(a.r) || a.i - b.i).map((x) => x.r);
}
function ScoreHead({ sort, onSort }: { sort: SortBy; onSort: () => void }) {
  return (
    <button type="button" onClick={onSort} aria-pressed={sort === 'score'} title="Sort by the Next Sky Gold score; click again for the focus order"
      style={{ all: 'unset', cursor: 'pointer', color: sort === 'score' ? R.green : R.dim, fontWeight: 800 }}>
      Sky Gold score {sort === 'score' ? '▼' : '⇅'}
    </button>
  );
}
/** zzz927: the "Reported" column header: click sorts newest first, click again oldest first (the "#" header goes back to the focus order). */
function DateHead({ sort, onSort }: { sort: SortBy; onSort: () => void }) {
  const on = sort === 'new' || sort === 'old';
  return (
    <button type="button" onClick={onSort} aria-pressed={on} title="Sort by the date the news was reported; click again to flip newest / oldest"
      style={{ all: 'unset', cursor: 'pointer', color: on ? R.green : R.dim, fontWeight: 800 }}>
      Reported {sort === 'new' ? '▼' : sort === 'old' ? '▲' : '⇅'}
    </button>
  );
}
function RankHead({ sort, onReset }: { sort: SortBy; onReset: () => void }) {
  return sort === 'rank'
    ? <>#</>
    : <button type="button" onClick={onReset} title="Back to the focus order" style={{ all: 'unset', cursor: 'pointer', color: R.green, fontWeight: 800 }}>#↺</button>;
}
function MoreRow({ shown, total, open, onToggle, cols }: { shown: number; total: number; open: boolean; onToggle: () => void; cols: number }) {
  if (total <= FOCUS_STEP) return null;
  return (
    <tr><td colSpan={cols} style={{ padding: '8px', textAlign: 'center' }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ fontSize: 13, fontWeight: 800, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${R.green}`, background: 'transparent', color: R.green }}>
        {open ? `− Show the top ${FOCUS_STEP} only` : `+ Show all ${total} (${total - shown} more)`}
      </button>
    </td></tr>
  );
}

export function GuFocusList({ events, window, onOpen, caps }: { events: readonly GuidanceEvent[]; window: string; onOpen: (id: string) => void; caps?: { IN?: Record<string, number>; US?: Record<string, number> } | null }) {
  // zzz1137 (retest layout) — Compact columns by default (Price, EPS estimate and the long Source title move out; all still on hover /
  // in the detail); "All columns" brings them back. Remembered in this browser.
  const [cols, setCols0] = useState<'compact' | 'all'>('compact');
  useEffect(() => { try { const v = localStorage.getItem('mc:gu-focus-cols:v1'); if (v === 'all' || v === 'compact') setCols0(v); } catch { /* blocked */ } }, []);
  const hiddenIn = (ids: readonly string[]) => (cols === 'compact' ? ids.filter((c) => COMPACT_HIDDEN.includes(c)).length : 0);
  const setCols = (v: 'compact' | 'all') => { setCols0(v); try { localStorage.setItem('mc:gu-focus-cols:v1', v); } catch { /* blocked */ } };
  const uni = useGuUniverse({ market: 'ALL', view: 'active' });
  const { data } = uni;
  const uniLine = universeStatusLine(uni, ageText);   // zzz1113 (G07)
  const [mk, setMk] = useState<Mk>('ALL');
  const [horizon, setHorizon] = useState<'ALL' | 'ANNUAL' | 'MULTI_YEAR_CAGR'>('ALL');
  // zzz880: small & mid caps by default (India under ₹30,000 Cr, US under $30B); a name whose size is not known stays, labelled
  const [smid, setSmid] = useState(true);
  // zzz923: the screener.in market cap read for the score fills an India size the graded results do not have (graded caps win)
  // the names to read figures for: the listed rows sized by the graded caps only (so reading figures never changes what is asked)
  const skySig = useMemo(() => buildFocusList(data?.summary?.highGrowthGroups, events, new Date(), Infinity, { caps, indiaLarge: INDIA_LARGE_CAPS })
    .filter((r) => (!smid || r.size !== 'LARGE') && ((r.raised && !r.smallRaise) || r.growth)).map(skyKey).filter(Boolean).sort().join(','), [data, events, caps, smid]);
  const skyKeys = useMemo(() => (skySig ? skySig.split(',') : []), [skySig]);
  // zzz925: India company names go with the request, so a BSE-only company (BMW Industries, filed as "BMW") is found on screener.in by name
  const skyNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of buildFocusList(data?.summary?.highGrowthGroups, events, new Date(), Infinity)) if (r.market === 'IN' && r.ticker) m[`IN:${r.ticker.toUpperCase()}`] = r.company;
    return m;
  }, [data, events]);
  const { facts, caps: skyCaps, loading: skyLoading, failed: skyFailed } = useSkyGoldFacts(skyKeys, skyNames);
  // zzz925: the market caps read for the score fill sizes the graded results do not have — India from screener.in, USA from Nasdaq
  // (graded caps win). Before this, almost every US row said "size not known" and large caps stayed in "Small & mid only".
  const capsAll = useMemo(() => {
    const inCaps: Record<string, number> = { ...skyCaps.IN };
    for (const [k, f] of Object.entries(facts)) if (k.startsWith('IN:') && f?.mcap && f.mcap > 0) inCaps[k.slice(3)] = f.mcap;
    return { IN: { ...inCaps, ...(caps?.IN || {}) }, US: { ...skyCaps.US, ...(caps?.US || {}) } };
  }, [facts, caps, skyCaps]);
  const built = useMemo(() => buildFocusList(focusGrowthHorizon(data?.summary?.highGrowthGroups, horizon), events, new Date(), Infinity, { caps: capsAll, indiaLarge: INDIA_LARGE_CAPS }), [data, events, capsAll, horizon]);   // zzz906: no cut-off before filtering (a small raise like Yasho fell outside the old top 80)
  // zzz925: a growth worked out from company numbers must agree with the revenue the company reports (Pinnacle West "+189%" was divided
  // by a part-year base): such a growth is held back for review and listed under the tables, never ranked
  const { rows: everyone, held } = useMemo(() => holdInconsistentGrowth(built, (r) => (r.ticker ? facts[`${r.market}:${r.ticker.toUpperCase()}`]?.salesBase : null)), [built, facts]);
  const all = useMemo(() => (smid ? everyone.filter((r) => r.size !== 'LARGE') : everyone), [everyone, smid]);
  const largeHidden = everyone.length - all.length;
  const heldShown = held.filter((h) => (mk === 'ALL' || h.market === mk));
  // zzz1116 (G04) — the same held decision applies to the other rankings on the page
  useEffect(() => { setHeldKeys(held.map((h) => h.key)); }, [held]);
  const inMk = useMemo(() => all.filter((r) => mk === 'ALL' || r.market === mk), [all, mk]);
  // zzz881: two lists, no empty columns — (A) companies that RAISED guidance, (B) companies guiding 30%+ growth with no raise yet.
  // A small raise (under 5%, or only EPS from a small base) is kept out of (A) and counted, never shown as a strong signal.
  // zzz906: the first 20 of each ranked list; "+ Show all" opens the rest (owner request, 6 Oct)
  const [allA, setAllA] = useState(false);
  const [allB, setAllB] = useState(false);
  const raisedAll = useMemo(() => inMk.filter((r) => r.raised && !r.smallRaise), [inMk]);
  const growthAll = useMemo(() => inMk.filter((r) => !(r.raised && !r.smallRaise) && r.growth), [inMk]);
  // zzz923: the Next Sky Gold score, for every name in the two focus tables (one batched fetch for those names only)
  const listed = useMemo(() => all.filter((r) => (r.raised && !r.smallRaise) || r.growth), [all]);
  const scores = useMemo(() => {
    const m = new Map<string, SkyScore | null>();
    for (const r of listed) {
      const k = skyKey(r);
      if (k && !(k in facts) && !skyFailed) { m.set(r.key, null); continue; }   // figures not read yet
      m.set(r.key, skyGoldScore(guidanceOfRow(r), k ? facts[k] ?? null : null));
    }
    return m;
  }, [listed, facts, skyFailed]);
  // zzz927: fair value per listed row (the auto-valuation method on the figures read for the score; no model call, no extra request)
  const fvs = useMemo(() => {
    const m = new Map<string, FvResult | null>();
    for (const r of listed) {
      const k = skyKey(r);
      if (k && !(k in facts) && !skyFailed) { m.set(r.key, null); continue; }
      const f = k ? facts[k] ?? null : null;
      m.set(r.key, f ? fairValue(f, fvGrowthOf(r), r.company) : { ok: false, reason: 'company figures not found', currency: r.market === 'US' ? '$' : '₹', price: null, base: null, bear: null, bull: null, checks: [], methods: [], sectorLabel: '', sectorKnown: false, basis: null, growth: null, inputs: [] });
    }
    return m;
  }, [listed, facts, skyFailed]);
  // zzz929: the Opportunity score (separate from Sky Gold), from the same figures, the fair value and the Sky Gold facts; no extra request
  const opps = useMemo(() => {
    const m = new Map<string, Opportunity | null>();
    for (const r of listed) {
      const k = skyKey(r);
      if (k && !(k in facts) && !skyFailed) { m.set(r.key, null); continue; }
      m.set(r.key, opportunityScore(r, k ? facts[k] ?? null : null, fvs.get(r.key) ?? null));
    }
    return m;
  }, [listed, facts, fvs, skyFailed]);
  const [sortA, setSortA] = useState<SortBy>('rank');
  const [sortB, setSortB] = useState<SortBy>('rank');
  const [openSky, setOpenSky] = useState<string | null>(null);
  const raisedSorted = sortA === 'score' ? bySky(raisedAll, scores) : sortA === 'opp' ? byOpp(raisedAll, opps) : sortA === 'new' || sortA === 'old' ? sortByReported(raisedAll, (r) => r.raiseDate, sortA) : raisedAll;
  const growthSorted = sortB === 'score' ? bySky(growthAll, scores) : sortB === 'opp' ? byOpp(growthAll, opps) : sortB === 'new' || sortB === 'old' ? sortByReported(growthAll, (r) => r.growthDate, sortB) : growthAll;
  const fvCell = (r: FocusRow) => <FvCells fv={fvs.get(r.key) ?? null} waiting={skyLoading || (!skyFailed && !!skyKey(r))} td={td} />;
  const raisedRows = allA ? raisedSorted : raisedSorted.slice(0, FOCUS_STEP);
  const growthRows = allB ? growthSorted : growthSorted.slice(0, FOCUS_STEP);
  const [openOpp, setOpenOpp] = useState<string | null>(null);
  const oppCell = (r: FocusRow) => <OppCells o={opps.get(r.key) ?? null} waiting={skyLoading || (!skyFailed && !!skyKey(r))} open={openOpp === r.key} onToggle={() => setOpenOpp((v) => (v === r.key ? null : r.key))} td={td} />;
  const oppOpen = (r: FocusRow, cols: number) => { const o = openOpp === r.key ? opps.get(r.key) : null; return o ? <OppBreakdownRow key={`${r.key}-opp`} o={o} cols={cols} /> : null; };
  const skyCell = (r: FocusRow) => <SkyScoreCell s={scores.get(r.key) ?? null} waiting={skyLoading || (!skyFailed && !!skyKey(r))} open={openSky === r.key} onToggle={() => setOpenSky((v) => (v === r.key ? null : r.key))} td={td} />;
  // zzz1047f — no rows of dashes: while a company's figures are being read, or when none could be read, the price / fair value /
  // EPS / opportunity / score columns become ONE quiet cell saying so (the owner: "don't show blanks")
  const figuresCells = (r: FocusRow) => {
    const k = skyKey(r);
    const waiting = !!k && !(k in facts) && !skyFailed;
    const none = !k || (k in facts && facts[k] == null) || (skyFailed && !(k in facts));
    if (waiting || none) {
      return (
        <td colSpan={FV_COLS + OPP_COLS + 1 - (cols === 'compact' ? 2 : 0)} data-c="figures" data-figures={waiting ? 'reading' : 'none'} style={{ ...td, color: R.dim, fontSize: 12, fontStyle: 'italic' }}>
          {waiting ? 'Reading company figures…' : r.market === 'IN' ? 'Company figures not on screener.in yet — the guidance above still counts' : 'Company figures not in the SEC filings yet — the guidance above still counts'}
        </td>
      );
    }
    return <>{fvCell(r)}{oppCell(r)}{skyCell(r)}</>;
  };
  const skyOpen = (r: FocusRow, cols: number) => {
    const s = openSky === r.key ? scores.get(r.key) : null;
    const k = skyKey(r);
    return s ? <SkyBreakdownRow key={`${r.key}-sky`} s={s} facts={k ? facts[k] ?? null : null} cols={cols} /> : null;
  };
  const smallRaises = inMk.filter((r) => r.raised && r.smallRaise).length;
  const top = inMk.filter((r) => r.verdict === 'TOP FOCUS').length;
  const td: React.CSSProperties = { textAlign: 'left', padding: '8px', fontSize: 13, borderBottom: `1px solid ${tint(R.grey, 18)}`, verticalAlign: 'top' };
  return (
    <section data-gu-focus aria-label="Focus list" className={cols === 'compact' ? 'gu-cols-compact' : undefined} style={{ border: `2px solid ${tint(R.green, 55)}`, borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>🎯 Focus list — the companies to look at first</b>
        <span style={{ fontSize: 12.5, color: R.dim }}>
          {all.length ? `${top} with both a guidance raise and 30%+ growth guided · ${inMk.length} eligible names · ${raisedAll.length + growthAll.length} in these tables` : 'Loading…'}
        </span>
        <span role="group" aria-label="Market" style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={pillStyle(smid, R.amber)} aria-pressed={smid} onClick={() => setSmid((v) => !v)}
            title="India under ₹30,000 Cr, USA under $30B. A company whose size is not known is kept and says so.">
            {smid ? `Small & mid only${largeHidden ? ` (${largeHidden} large hidden)` : ''}` : 'All sizes'}
          </button>
          {(['ALL', 'IN', 'US'] as Mk[]).map((k) => (
            <button key={k} type="button" style={pillStyle(mk === k, R.green)} aria-pressed={mk === k} onClick={() => setMk(k)}>
              {k === 'ALL' ? 'All' : k === 'IN' ? 'India' : 'USA'} ({k === 'ALL' ? all.length : all.filter((r) => r.market === k).length})
            </button>
          ))}
        </span>
      </div>
      <div role="group" aria-label="Growth horizon" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: R.dim }}>Growth horizon:</span>
        {(['ALL', 'ANNUAL', 'MULTI_YEAR_CAGR'] as const).map((h) => <button key={h} type="button" aria-pressed={horizon === h} style={pillStyle(horizon === h, R.cyan)} onClick={() => setHorizon(h)}>{h === 'ALL' ? 'All horizons' : h === 'ANNUAL' ? 'Annual' : 'Multi-year CAGR'}</button>)}
        <span style={{ fontSize: 11.5, color: R.dim }}>Filters growth targets; guidance raises remain visible.</span>
        <span role="group" aria-label="Columns" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ fontSize: 11.5, color: R.dim }}>Columns:</span>
          {(['compact', 'all'] as const).map((v) => <button key={v} type="button" aria-pressed={cols === v} onClick={() => setCols(v)} style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${cols === v ? R.green : R.border}`, background: 'transparent', color: cols === v ? R.green : R.text }}>{v === 'compact' ? 'Compact' : 'All columns'}</button>)}
        </span>
      </div>
      {/* zzz930: owner asked for the explanations to stay collapsed until opened */}
      <details style={{ fontSize: 12, color: R.dim }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: R.text }}>How the ranking, scores, fair value and dates work</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: R.dim }}>
          Default rank uses an additive guidance signal score: guided growth (up to 100 points), raise size (up to 60), a bonus for both a meaningful raise and growth (60), recent raises (up to 20), and verified growth or a raise (10). Ties use company name. It is not a ranking by business quality or expected return; Opportunity and Sky Gold have separate sorts.
        </div>
        <div style={{ fontSize: 12, color: R.dim }}>
          <b>Sky Gold score</b> (from the “Identify Next SKY GOLD” framework): is the big plan backed by the business today? 7 main checks — a clear target from the company, sales already growing 20%+, the target reachable from the current pace, margins steady, ROCE 20%+, cash following profit, debt under control. Each main check missed holds the score down: 80+ (STRONG) needs 6 of 7 met with real figures and 65+ (GOOD) needs 5 of 7 (with 4 met the score stays at 62 or below, with 3 at 52); a growth worked out from company numbers counts as only half a clear target; supporting checks (raise, specific plan, profit faster than sales, own cash, orders, estimates, valuation, small base) add points; red flags (guidance cut, slower-paying customers, new shares, promoters selling, other income) take points off. A figure not known never counts as met; too few figures shows “not enough data”. Click a score for every check. Bands: 80+ STRONG · 65–79 GOOD · 50–64 MIXED · under 50 WEAK.
        </div>
        <div style={{ fontSize: 12, color: R.dim }}>
          <b>Reported</b> is the date of the announcement or document the row comes from — click its header to sort newest or oldest first. <b>Fair value</b> uses the same method as the Auto-Valuation page on the company's own public figures: next-year sales or profit grown at the guided growth, times the sector's usual multiples (P/E, EV/EBITDA, P/S blended), with a bear and a bull case on hover. It needs no AI. A dash means a figure is missing or looks wrong (reason on hover); banks, lenders and insurers show a dash because they are valued on book value. “check” means upside above +150%, methods that disagree, or growth that was capped. An estimate, not advice.
        </div>
        <div style={{ fontSize: 12, color: R.dim }}>
          <b>Opportunity</b> is a separate score from Sky Gold: Sky Gold asks whether the business can carry the plan; Opportunity asks how much the guidance changes profit and how supportive the setup is. It is built from six parts — implied EPS growth, raise quality (broad improvement, operating leverage, revenue only, or low quality), whether the guided growth is feasible from here, fair-value upside (only when not marked “check”), how long the guidance runs, and, for USA names, guided growth against the analyst EPS estimate (India has no such source, so nothing is shown). <b>Implied EPS</b> is the profit growth the guidance points to with the share count unchanged; a “~” means a rough estimate (sales growth at today's margin). A part that is not known earns nothing, and a high score needs most parts known and strong. Click the score for every part, the old → new change, and the growth still needed in the rest of the year. Public figures only, no AI.
        </div>
        </div>
      </details>
      {skyFailed && <div style={{ fontSize: 12, color: R.amber }}>The company figures could not be read just now (the server may be restarting) — trying again automatically; scores use the guidance checks until then.</div>}
      {uniLine && (
        <div role={uniLine.tone === 'info' ? 'status' : 'alert'} style={{ fontSize: 12.5, color: uniLine.tone === 'error' ? R.red : uniLine.tone === 'warn' ? R.amber : R.dim, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{uniLine.text}{uniLine.tone !== 'info' ? ' The raises below come from the event feed and are not affected.' : ''}</span>
          {uniLine.tone !== 'info' && <button type="button" onClick={uni.retry} style={{ fontSize: 12, padding: '2px 10px', borderRadius: 6, border: `1px solid ${R.border}`, background: 'transparent', color: R.text, cursor: 'pointer' }}>Retry</button>}
        </div>
      )}
      {raisedAll.length + growthAll.length === 0 ? (
        <div style={{ fontSize: 13, color: R.dim }}>{uni.state === 'loading' ? 'Reading the guidance data…' : uni.state === 'error' && !events.length ? 'Nothing to show until the guidance data loads (see above).' : 'No names for this market in the current data.'}</div>
      ) : (<>
        <FocusTable tableId="A" title={`A. Raised their guidance (${raisedAll.length})`} sub={`Old and new figures both read from the company's own filing, ${window} window.${smallRaises ? ` ${smallRaises} small raise${smallRaises === 1 ? '' : 's'} (under 5%, or only EPS from a small base) left out.` : ''}`}
          head={[<RankHead key="n" sort={sortA} onReset={() => setSortA('rank')} />, 'Company', 'What was raised (old → new)', <DateHead key="d" sort={sortA} onSort={() => setSortA((v) => (v === 'new' ? 'old' : 'new'))} />, ...FV_HEAD, 'EPS estimate (fixed shares)', <OppHead key="o" sort={sortA} onSort={() => setSortA((v) => (v === 'opp' ? 'rank' : 'opp'))} />, <ScoreHead key="s" sort={sortA} onSort={() => setSortA((v) => (v === 'score' ? 'rank' : 'score'))} />, 'Verdict']} colIds={COLS_A} empty="No raise of 5% or more in this window for this market.">
          {raisedRows.map((r, i) => (<React.Fragment key={r.key}>
            <tr>
              <td style={{ ...td, color: R.dim }}>{i + 1}</td>
              <CompanyCell r={r} td={td} />
              <td style={td}>
                <button type="button" onClick={() => r.eventId && onOpen(r.eventId)} title="Open the full check" style={{ all: 'unset', cursor: r.eventId ? 'pointer' : 'default', color: R.text }}>
                  {r.raised}
                  <div style={{ fontSize: 11.5, color: R.dim }}>announced {r.raiseDate}{r.growth ? <> · also guides <b style={{ color: R.green }}>{r.growth}</b> ({r.growthPeriod})</> : ''}</div>
                </button>
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }} data-reported>{reportedLabel(r.raiseDate)}</td>
              {figuresCells(r)}
              <VerdictCell r={r} td={td} fv={fvs.get(r.key) ?? null} />
            </tr>
            {skyOpen(r, COLS_A.length - hiddenIn(COLS_A))}
            {oppOpen(r, COLS_A.length - hiddenIn(COLS_A))}
          </React.Fragment>))}
          {raisedAll.length > FOCUS_STEP && <MoreRow shown={raisedRows.length} total={raisedAll.length} open={allA} onToggle={() => setAllA((v) => !v)} cols={COLS_A.length - hiddenIn(COLS_A)} />}
        </FocusTable>
        <FocusTable tableId="B" title={`B. Guiding 30%+ growth — no qualifying raise in this window (${growthAll.length})`} sub="Active guidance with 30%+ growth and no raise qualifying for table A in the selected window. This can include first guidance, repeats, older raises, or a small raise."
          head={[<RankHead key="n" sort={sortB} onReset={() => setSortB('rank')} />, 'Company', 'Growth guided', 'Source', <DateHead key="d" sort={sortB} onSort={() => setSortB((v) => (v === 'new' ? 'old' : 'new'))} />, ...FV_HEAD, 'EPS estimate (fixed shares)', <OppHead key="o" sort={sortB} onSort={() => setSortB((v) => (v === 'opp' ? 'rank' : 'opp'))} />, <ScoreHead key="s" sort={sortB} onSort={() => setSortB((v) => (v === 'score' ? 'rank' : 'score'))} />, 'Verdict']} colIds={COLS_B} empty="No 30%+ growth guidance for this market.">
          {growthRows.map((r, i) => (<React.Fragment key={r.key}>
            <tr>
              <td style={{ ...td, color: R.dim }}>{i + 1}</td>
              <CompanyCell r={r} td={td} />
              <td style={td}><b style={{ color: r.growthTrust === 'derived' ? R.amber : R.green }}>{r.growth}</b><div style={{ fontSize: 11.5, color: R.dim }}>{r.growthPeriod || ''}{r.growthTrust === 'derived' ? <b style={{ color: R.amber }}> · worked out by us from company numbers — not a stated target</b> : ' · stated by company'}</div></td>
              <td data-c="source" style={{ ...td, fontSize: 12 }}>
                {r.growthSourceUrl && /^https?:\/\//i.test(r.growthSourceUrl) ? <a href={r.growthSourceUrl} target="_blank" rel="noopener noreferrer">{r.growthSource || 'Company document'}</a> : r.growthSource || 'Company document'}
                <div style={{ fontSize: 11.5, color: r.growthFreshness === 'STALE' ? R.amber : R.dim }}>{r.growthTrust === 'derived' ? 'Derived from company figures' : 'Source verified'}{r.growthFreshness === 'STALE' ? ' · recheck required' : ''}</div>
                <div style={{ fontSize: 11, color: R.dim }}>{typeof r.growthVerifiedDaysAgo === 'number' && Number.isFinite(r.growthVerifiedDaysAgo) && r.growthVerifiedDaysAgo >= 0 ? `Last verified ${r.growthVerifiedDaysAgo} days ago` : 'Verification age unavailable'}</div>
                <div style={{ fontSize: 11.5, color: R.dim }}>{r.raised ? `small raise ${r.raiseDate}` : ''}</div>
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }} data-reported>{reportedLabel(r.growthDate)}</td>
              {figuresCells(r)}
              <VerdictCell r={r} td={td} fv={fvs.get(r.key) ?? null} />
            </tr>
            {skyOpen(r, COLS_B.length - hiddenIn(COLS_B))}
            {oppOpen(r, COLS_B.length - hiddenIn(COLS_B))}
          </React.Fragment>))}
          {growthAll.length > FOCUS_STEP && <MoreRow shown={growthRows.length} total={growthAll.length} open={allB} onToggle={() => setAllB((v) => !v)} cols={COLS_B.length - hiddenIn(COLS_B)} />}
        </FocusTable>
        {heldShown.length > 0 && (
          <div data-gu-held style={{ fontSize: 12, color: R.dim, display: 'grid', gap: 2 }}>
            <b style={{ color: R.amber }}>Held back for review ({heldShown.length}) — a growth worked out from company numbers that does not match the revenue the company reports:</b>
            {heldShown.map((h) => <span key={h.key}>{FLAG[h.market]} <b>{h.company}</b> ({h.growth}): {h.reason}.</span>)}
          </div>
        )}
        {(() => {
          // zzz1115 (G02) — growths that are most likely one business, kept out of these tables (still in the universe browser)
          const sh = (data?.summary?.highGrowthGroups?.scopeHeld || []).filter((h) => mk === 'ALL' || h.market === mk);
          return sh.length > 0 && (
            <div style={{ fontSize: 12.5, color: R.dim, display: 'grid', gap: 3 }}>
              <b style={{ color: R.amber }}>Not used as company growth ({sh.length}) — most likely one business or segment:</b>
              {sh.map((h, i) => <span key={`${h.entityKey}-${i}`}>{FLAG[h.market as 'IN' | 'US'] || ''} <b>{h.company}</b> ({h.text}): {h.reason}.</span>)}
            </div>
          );
        })()}
      </>)}
    </section>
  );
}
