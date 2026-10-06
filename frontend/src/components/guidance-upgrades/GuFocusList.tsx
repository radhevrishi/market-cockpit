'use client';
// zzz880 — FOCUS LIST at the top of the guidance page: the companies to look at first, ranked, one plain line each.
import React, { useMemo, useState } from 'react';
import { R, tint } from './gu-tokens';
import { pillStyle } from './GuPanel';
import { useGuUniverse } from './useGuUniverse';
import { buildFocusList, holdInconsistentGrowth, type FocusVerdict } from '@/lib/gu-focus';
import { INDIA_LARGE_CAPS } from '@/lib/india-large-caps';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import type { FocusRow } from '@/lib/gu-focus';
import { skyGoldScore, guidanceOfRow, type SkyScore } from '@/lib/gu-skygold-score';
import { useSkyGoldFacts, SkyScoreCell, SkyBreakdownRow } from './GuSkyGold';

function FocusTable({ title, sub, head, empty, children }: { title: string; sub: string; head: React.ReactNode[]; empty: string; children: React.ReactNode }) {
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 800, color: R.dim, borderBottom: `1px solid ${tint(R.grey, 40)}`, whiteSpace: 'nowrap' };
  const has = React.Children.toArray(children).length > 0;   // zzz906: toArray drops false / null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <b style={{ fontSize: 14 }}>{title}</b>
      <span style={{ fontSize: 12, color: R.dim }}>{sub}</span>
      {has ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : <span style={{ fontSize: 13, color: R.dim }}>{empty}</span>}
    </div>
  );
}
function CompanyCell({ r, td }: { r: FocusRow; td: React.CSSProperties }) {
  return (
    <td style={td}>
      <b>{r.company}</b>
      <div style={{ fontSize: 11.5, color: R.dim }}>{FLAG[r.market]} {r.ticker || ''}{r.capText ? ` · ${r.capText}` : ' · size not known'}</div>
    </td>
  );
}
function VerdictCell({ r, td }: { r: FocusRow; td: React.CSSProperties }) {
  return (
    <td style={td}>
      <b style={{ color: VERDICT_COLOR[r.verdict], whiteSpace: 'nowrap' }}>{r.verdict}</b>
      <div style={{ fontSize: 11.5, color: R.dim }}>{r.why}</div>
    </td>
  );
}

const VERDICT_COLOR: Record<FocusVerdict, string> = { 'TOP FOCUS': R.green, 'STRONG RAISE': R.green, 'HIGH GROWTH': R.cyan, RAISED: R.violet, WATCH: R.grey };
const FLAG = { IN: '🇮🇳', US: '🇺🇸' } as const;
type Mk = 'ALL' | 'IN' | 'US';
const FOCUS_STEP = 20;
type SortBy = 'rank' | 'score';
const skyKey = (r: FocusRow) => (r.ticker ? `${r.market}:${r.ticker.toUpperCase()}` : null);
/** zzz923: rows by score (a higher score first; no score last), the focus rank breaking ties */
function bySky(rows: FocusRow[], scores: Map<string, SkyScore | null>): FocusRow[] {
  const v = (r: FocusRow) => scores.get(r.key)?.score ?? -1;
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
  const { data } = useGuUniverse({ market: 'ALL', view: 'active' });
  const [mk, setMk] = useState<Mk>('ALL');
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
  const built = useMemo(() => buildFocusList(data?.summary?.highGrowthGroups, events, new Date(), Infinity, { caps: capsAll, indiaLarge: INDIA_LARGE_CAPS }), [data, events, capsAll]);   // zzz906: no cut-off before filtering (a small raise like Yasho fell outside the old top 80)
  // zzz925: a growth worked out from company numbers must agree with the revenue the company reports (Pinnacle West "+189%" was divided
  // by a part-year base): such a growth is held back for review and listed under the tables, never ranked
  const { rows: everyone, held } = useMemo(() => holdInconsistentGrowth(built, (r) => (r.ticker ? facts[`${r.market}:${r.ticker.toUpperCase()}`]?.salesBase : null)), [built, facts]);
  const all = useMemo(() => (smid ? everyone.filter((r) => r.size !== 'LARGE') : everyone), [everyone, smid]);
  const largeHidden = everyone.length - all.length;
  const heldShown = held.filter((h) => (mk === 'ALL' || h.market === mk));
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
  const [sortA, setSortA] = useState<SortBy>('rank');
  const [sortB, setSortB] = useState<SortBy>('rank');
  const [openSky, setOpenSky] = useState<string | null>(null);
  const raisedSorted = sortA === 'score' ? bySky(raisedAll, scores) : raisedAll;
  const growthSorted = sortB === 'score' ? bySky(growthAll, scores) : growthAll;
  const raisedRows = allA ? raisedSorted : raisedSorted.slice(0, FOCUS_STEP);
  const growthRows = allB ? growthSorted : growthSorted.slice(0, FOCUS_STEP);
  const skyCell = (r: FocusRow) => <SkyScoreCell s={scores.get(r.key) ?? null} waiting={skyLoading || (!skyFailed && !!skyKey(r))} open={openSky === r.key} onToggle={() => setOpenSky((v) => (v === r.key ? null : r.key))} td={td} />;
  const skyOpen = (r: FocusRow, cols: number) => {
    const s = openSky === r.key ? scores.get(r.key) : null;
    const k = skyKey(r);
    return s ? <SkyBreakdownRow key={`${r.key}-sky`} s={s} facts={k ? facts[k] ?? null : null} cols={cols} /> : null;
  };
  const smallRaises = inMk.filter((r) => r.raised && r.smallRaise).length;
  const top = all.filter((r) => r.verdict === 'TOP FOCUS').length;
  const td: React.CSSProperties = { textAlign: 'left', padding: '8px', fontSize: 13, borderBottom: `1px solid ${tint(R.grey, 18)}`, verticalAlign: 'top' };
  return (
    <section data-gu-focus aria-label="Focus list" style={{ border: `2px solid ${tint(R.green, 55)}`, borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>🎯 Focus list — the companies to look at first</b>
        <span style={{ fontSize: 12.5, color: R.dim }}>
          {all.length ? `${top} with both a guidance raise and 30%+ growth guided · ${all.length} names in total` : 'Loading…'}
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
      <div style={{ fontSize: 12, color: R.dim }}>
        Ranked by: a guidance raise <b>and</b> 30%+ growth first, then the size of the raise (revenue / profit — an EPS from a tiny base never counts as a big raise), then the growth guided, then how recent. Only figures checked against the company's own documents.
      </div>
      <div style={{ fontSize: 12, color: R.dim }}>
        <b>Sky Gold score</b> (from the “Identify Next SKY GOLD” framework): is the big plan backed by the business today? 7 main checks — a clear target from the company, sales already growing 20%+, the target reachable from the current pace, margins steady, ROCE 20%+, cash following profit, debt under control. Each main check missed holds the score down: 80+ (STRONG) needs 6 of 7 met with real figures and 65+ (GOOD) needs 5 of 7 (with 4 met the score stays at 62 or below, with 3 at 52); a growth worked out from company numbers counts as only half a clear target; supporting checks (raise, specific plan, profit faster than sales, own cash, orders, estimates, valuation, small base) add points; red flags (guidance cut, slower-paying customers, new shares, promoters selling, other income) take points off. A figure not known never counts as met; too few figures shows “not enough data”. Click a score for every check. Bands: 80+ STRONG · 65–79 GOOD · 50–64 MIXED · under 50 WEAK.{skyFailed ? ' The company figures could not be read just now — scores use the guidance checks only.' : ''}
      </div>
      {raisedAll.length + growthAll.length === 0 ? (
        <div style={{ fontSize: 13, color: R.dim }}>{all.length ? 'No names for this market in the current data.' : 'Reading the guidance data…'}</div>
      ) : (<>
        <FocusTable title={`A. Raised their guidance (${raisedAll.length})`} sub={`Old and new figures both read from the company's own filing, ${window} window.${smallRaises ? ` ${smallRaises} small raise${smallRaises === 1 ? '' : 's'} (under 5%, or only EPS from a small base) left out.` : ''}`}
          head={['#', 'Company', 'What was raised (old → new)', <ScoreHead key="s" sort={sortA} onSort={() => setSortA((v) => (v === 'score' ? 'rank' : 'score'))} />, 'Verdict']} empty="No raise of 5% or more in this window for this market.">
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
              {skyCell(r)}
              <VerdictCell r={r} td={td} />
            </tr>
            {skyOpen(r, 5)}
          </React.Fragment>))}
          {raisedAll.length > FOCUS_STEP && <MoreRow shown={raisedRows.length} total={raisedAll.length} open={allA} onToggle={() => setAllA((v) => !v)} cols={5} />}
        </FocusTable>
        <FocusTable title={`B. Guiding 30%+ growth — no raise yet (${growthAll.length})`} sub="The company's own guidance still in force. First guidance or a repeat, so there is no old figure to compare."
          head={['#', 'Company', 'Growth guided', 'Source', <ScoreHead key="s" sort={sortB} onSort={() => setSortB((v) => (v === 'score' ? 'rank' : 'score'))} />, 'Verdict']} empty="No 30%+ growth guidance for this market.">
          {growthRows.map((r, i) => (<React.Fragment key={r.key}>
            <tr>
              <td style={{ ...td, color: R.dim }}>{i + 1}</td>
              <CompanyCell r={r} td={td} />
              <td style={td}><b style={{ color: R.green }}>{r.growth}</b><div style={{ fontSize: 11.5, color: R.dim }}>{r.growthPeriod || ''}{r.growthTrust === 'derived' ? ' · worked out from company numbers' : ' · stated by company'}</div></td>
              <td style={{ ...td, fontSize: 12 }}>{r.growthSource || 'Company document'}<div style={{ fontSize: 11.5, color: R.dim }}>{r.growthDate || ''}{r.raised ? ` · small raise ${r.raiseDate}` : ''}</div></td>
              {skyCell(r)}
              <VerdictCell r={r} td={td} />
            </tr>
            {skyOpen(r, 6)}
          </React.Fragment>))}
          {growthAll.length > FOCUS_STEP && <MoreRow shown={growthRows.length} total={growthAll.length} open={allB} onToggle={() => setAllB((v) => !v)} cols={6} />}
        </FocusTable>
        {heldShown.length > 0 && (
          <div data-gu-held style={{ fontSize: 12, color: R.dim, display: 'grid', gap: 2 }}>
            <b style={{ color: R.amber }}>Held back for review ({heldShown.length}) — a growth worked out from company numbers that does not match the revenue the company reports:</b>
            {heldShown.map((h) => <span key={h.key}>{FLAG[h.market]} <b>{h.company}</b> ({h.growth}): {h.reason}.</span>)}
          </div>
        )}
      </>)}
    </section>
  );
}
