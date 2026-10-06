'use client';
// zzz880 — FOCUS LIST at the top of the guidance page: the companies to look at first, ranked, one plain line each.
import React, { useMemo, useState } from 'react';
import { R, tint } from './gu-tokens';
import { pillStyle } from './GuPanel';
import { useGuUniverse } from './useGuUniverse';
import { buildFocusList, type FocusVerdict } from '@/lib/gu-focus';
import { INDIA_LARGE_CAPS } from '@/lib/india-large-caps';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import type { FocusRow } from '@/lib/gu-focus';

function FocusTable({ title, sub, head, empty, children }: { title: string; sub: string; head: string[]; empty: string; children: React.ReactNode }) {
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 800, color: R.dim, borderBottom: `1px solid ${tint(R.grey, 40)}`, whiteSpace: 'nowrap' };
  const has = React.Children.toArray(children).length > 0;   // zzz906: toArray drops false / null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <b style={{ fontSize: 14 }}>{title}</b>
      <span style={{ fontSize: 12, color: R.dim }}>{sub}</span>
      {has ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
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
  const everyone = useMemo(() => buildFocusList(data?.summary?.highGrowthGroups, events, new Date(), Infinity, { caps, indiaLarge: INDIA_LARGE_CAPS }), [data, events, caps]);   // zzz906: no cut-off before filtering (a small raise like Yasho fell outside the old top 80)
  const all = useMemo(() => (smid ? everyone.filter((r) => r.size !== 'LARGE') : everyone), [everyone, smid]);
  const largeHidden = everyone.length - all.length;
  const inMk = useMemo(() => all.filter((r) => mk === 'ALL' || r.market === mk), [all, mk]);
  // zzz881: two lists, no empty columns — (A) companies that RAISED guidance, (B) companies guiding 30%+ growth with no raise yet.
  // A small raise (under 5%, or only EPS from a small base) is kept out of (A) and counted, never shown as a strong signal.
  // zzz906: the first 20 of each ranked list; "+ Show all" opens the rest (owner request, 6 Oct)
  const [allA, setAllA] = useState(false);
  const [allB, setAllB] = useState(false);
  const raisedAll = useMemo(() => inMk.filter((r) => r.raised && !r.smallRaise), [inMk]);
  const growthAll = useMemo(() => inMk.filter((r) => !(r.raised && !r.smallRaise) && r.growth), [inMk]);
  const raisedRows = allA ? raisedAll : raisedAll.slice(0, FOCUS_STEP);
  const growthRows = allB ? growthAll : growthAll.slice(0, FOCUS_STEP);
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
      {raisedAll.length + growthAll.length === 0 ? (
        <div style={{ fontSize: 13, color: R.dim }}>{all.length ? 'No names for this market in the current data.' : 'Reading the guidance data…'}</div>
      ) : (<>
        <FocusTable title={`A. Raised their guidance (${raisedAll.length})`} sub={`Old and new figures both read from the company's own filing, ${window} window.${smallRaises ? ` ${smallRaises} small raise${smallRaises === 1 ? '' : 's'} (under 5%, or only EPS from a small base) left out.` : ''}`}
          head={['#', 'Company', 'What was raised (old → new)', 'Verdict']} empty="No raise of 5% or more in this window for this market.">
          {raisedRows.map((r, i) => (
            <tr key={r.key}>
              <td style={{ ...td, color: R.dim }}>{i + 1}</td>
              <CompanyCell r={r} td={td} />
              <td style={td}>
                <button type="button" onClick={() => r.eventId && onOpen(r.eventId)} title="Open the full check" style={{ all: 'unset', cursor: r.eventId ? 'pointer' : 'default', color: R.text }}>
                  {r.raised}
                  <div style={{ fontSize: 11.5, color: R.dim }}>announced {r.raiseDate}{r.growth ? <> · also guides <b style={{ color: R.green }}>{r.growth}</b> ({r.growthPeriod})</> : ''}</div>
                </button>
              </td>
              <VerdictCell r={r} td={td} />
            </tr>
          ))}
          {raisedAll.length > FOCUS_STEP && <MoreRow shown={raisedRows.length} total={raisedAll.length} open={allA} onToggle={() => setAllA((v) => !v)} cols={4} />}
        </FocusTable>
        <FocusTable title={`B. Guiding 30%+ growth — no raise yet (${growthAll.length})`} sub="The company's own guidance still in force. First guidance or a repeat, so there is no old figure to compare."
          head={['#', 'Company', 'Growth guided', 'Source', 'Verdict']} empty="No 30%+ growth guidance for this market.">
          {growthRows.map((r, i) => (
            <tr key={r.key}>
              <td style={{ ...td, color: R.dim }}>{i + 1}</td>
              <CompanyCell r={r} td={td} />
              <td style={td}><b style={{ color: R.green }}>{r.growth}</b><div style={{ fontSize: 11.5, color: R.dim }}>{r.growthPeriod || ''}{r.growthTrust === 'derived' ? ' · worked out from company numbers' : ' · stated by company'}</div></td>
              <td style={{ ...td, fontSize: 12 }}>{r.growthSource || 'Company document'}<div style={{ fontSize: 11.5, color: R.dim }}>{r.growthDate || ''}{r.raised ? ` · small raise ${r.raiseDate}` : ''}</div></td>
              <VerdictCell r={r} td={td} />
            </tr>
          ))}
          {growthAll.length > FOCUS_STEP && <MoreRow shown={growthRows.length} total={growthAll.length} open={allB} onToggle={() => setAllB((v) => !v)} cols={5} />}
        </FocusTable>
      </>)}
    </section>
  );
}
