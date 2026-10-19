'use client';
// zzz1045b — "Compare with another screen" panel (from the ⋯ menu). Shows the rules both screens share, the rules on the same field
// with a different limit (side by side), the rules only one has, how many companies each keeps on the current snapshot, how many
// each loses to a missing figure, and example companies in one and not the other. Read-only: neither screen is changed.
import { useEffect, useMemo, useState } from 'react';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { fieldOf, filterLabel, type Filter, type Screen } from '@/lib/screener/filters';
import { compareCandidates, compareScreens, rulesInWords } from '@/lib/screener/screen-compare';
import { tvSectorOf } from '@/lib/screener/tv-sectors';

const mk = (m: ScreenMarket) => (m === 'US' ? 'USA' : 'India');

export default function ScreenCompare({ screens, current, currentId, rows, otherRows, exactOnly, hidden, onClose }: {
  screens: readonly Screen[];
  /** the open screen as it is now (unsaved changes included) */
  current: { name: string; market: ScreenMarket; filters: readonly Filter[] };
  currentId: string;
  /** the rows the table uses for the open screen's market */
  rows: readonly ScreenRow[];
  /** the other market's snapshot rows when the page already has them */
  otherRows?: readonly ScreenRow[] | null;
  exactOnly: boolean;
  hidden: readonly string[];
  onClose: () => void;
}) {
  const options = useMemo(() => compareCandidates(screens, currentId, current.market, hidden), [screens, currentId, current.market, hidden]);
  const [otherId, setOtherId] = useState<string>(() => options[0]?.id || '');
  const other = options.find((s) => s.id === otherId) || null;
  const otherMarket = other?.market ?? current.market;
  const crossMarket = !!other && other.market !== current.market;
  const [fetched, setFetched] = useState<{ market: ScreenMarket; rows: ScreenRow[] } | null>(null);
  const [loadErrAt, setLoadErr] = useState<{ market: ScreenMarket; msg: string } | null>(null);
  const loadErr = loadErrAt?.market === otherMarket ? loadErrAt.msg : null;
  const rowsB = !crossMarket ? rows : otherRows?.length ? otherRows : fetched?.market === otherMarket ? fetched.rows : null;

  useEffect(() => {
    if (!crossMarket || otherRows?.length || fetched?.market === otherMarket) return;
    const ctrl = new AbortController();
    fetch(`/api/v1/stock-screener?market=${otherMarket}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok || !j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || 'Could not load the other market'); return j.rows as ScreenRow[]; })
      .then((list) => setFetched({ market: otherMarket, rows: list.map((r) => { const tv = tvSectorOf(otherMarket, r.sec, r.ind, r.t); return tv && tv !== r.tvSec ? { ...r, tvSec: tv } : r; }) }))
      .catch((e) => { if (!ctrl.signal.aborted) setLoadErr({ market: otherMarket, msg: e?.message || 'Could not load the other market' }); });
    return () => ctrl.abort();
  }, [crossMarket, otherMarket, otherRows, fetched]);

  const res = useMemo(() => (other && rowsB ? compareScreens(current, other, rows, rowsB, { exactOnly }) : null), [current, other, rows, rowsB, exactOnly]);
  const lbl = (f: Filter, m: ScreenMarket) => filterLabel(f, m);
  const missingTop = (byField: Array<{ key: string; n: number }>) => byField.slice(0, 3).map((x) => `${fieldOf(x.key)?.label || x.key} ${x.n.toLocaleString('en-US')}`).join(' · ');

  return (
    <div className="mcss-panel" role="region" aria-label="Compare screens" style={{ fontSize: 13 }}>
      <div className="mcss-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <b style={{ color: 'var(--ss-ink)' }}>Compare “{current.name}” with</b>
        <select className="mcss-input" aria-label="Screen to compare with" value={otherId} onChange={(e) => setOtherId(e.target.value)} style={{ maxWidth: 'min(360px, 70vw)' }}>
          {options.map((s) => <option key={s.id} value={s.id}>{s.market === current.market ? '' : `[${mk(s.market)}] `}{s.name}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="mcss-btn sm" onClick={onClose}>Close</button>
      </div>
      <div className="mcss-dim" style={{ fontSize: 12, marginTop: 4 }}>Read-only: neither screen is changed. Counts use the current snapshot{exactOnly ? ' with “Exact figures only”' : ''}; paused rules are left out.</div>
      {crossMarket ? (
        <div className="mcss-warn" role="note" style={{ marginTop: 8 }}>
          ⚠ “{other?.name}” is a {mk(otherMarket)} screen. Money limits are in different units ({current.market === 'US' ? '$ million' : '₹ crore'} vs {otherMarket === 'US' ? '$ million' : '₹ crore'}), and each screen runs on its own market&apos;s companies, so the example lists hold different companies.
        </div>
      ) : null}
      {!other ? <p className="mcss-dim">No other screen to compare with.</p> : !rowsB ? <p className="mcss-dim" aria-busy={!loadErr}>{loadErr || `Loading the ${mk(otherMarket)} snapshot…`}</p> : res ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {([['A', current, res.a], ['B', other, res.b]] as const).map(([tag, s, side]) => (
              <div key={tag} style={{ border: '1px solid var(--ss-rule)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontWeight: 600, color: 'var(--ss-ink)' }}>{tag} · {s.name} <span className="mcss-mk">{s.market === 'US' ? 'US' : 'IN'}</span></div>
                <div><b>{side.matches.toLocaleString('en-US')}</b> of {side.universe.toLocaleString('en-US')} companies match</div>
                <div className="mcss-dim" title="A company that does not have a figure a rule reads fails that rule">
                  {side.missing.companies.toLocaleString('en-US')} lose at least one rule to a missing figure{side.missing.byField.length ? ` (${missingTop(side.missing.byField)})` : ''}
                </div>
              </div>
            ))}
          </div>
          {!res.marketsDiffer ? <div>{res.both.toLocaleString('en-US')} companies are in both results · {res.onlyInACount.toLocaleString('en-US')} only in A · {res.onlyInBCount.toLocaleString('en-US')} only in B</div> : null}

          <div data-compare-words style={{ display: 'grid', gap: 2 }}>
            <div className="mcss-h4" style={{ marginTop: 0 }}>In plain words</div>
            {rulesInWords(res.rules, (f) => lbl(f, current.market)).map((t, i) => <div key={i}>{t}</div>)}
          </div>
          <div>
            <div className="mcss-h4" style={{ marginTop: 0 }}>Rules in both · {res.rules.shared.length}</div>
            {res.rules.shared.length ? <ul className="mcss-checks">{res.rules.shared.map((f, i) => <li key={i}><span aria-hidden className="ok">=</span><span>{lbl(f, current.market)}</span></li>)}</ul> : <div className="mcss-dim">None.</div>}
          </div>
          {res.rules.changed.length ? (
            <div>
              <div className="mcss-h4">Same field, different limit · {res.rules.changed.length}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr><th style={{ textAlign: 'left', fontWeight: 600 }}>A · {current.name}</th><th style={{ textAlign: 'left', fontWeight: 600 }}>B · {other?.name}</th></tr></thead>
                <tbody>{res.rules.changed.map((c, i) => <tr key={i}><td style={{ padding: '3px 8px 3px 0', borderTop: '1px dotted var(--ss-rule)' }}>{lbl(c.a, current.market)}</td><td style={{ padding: '3px 0', borderTop: '1px dotted var(--ss-rule)' }}>{lbl(c.b, otherMarket)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div>
              <div className="mcss-h4">Only in A · {res.rules.onlyA.length}</div>
              {res.rules.onlyA.length ? <ul className="mcss-checks">{res.rules.onlyA.map((f, i) => <li key={i}><span aria-hidden>+</span><span>{lbl(f, current.market)}</span></li>)}</ul> : <div className="mcss-dim">None.</div>}
            </div>
            <div>
              <div className="mcss-h4">Only in B · {res.rules.onlyB.length}</div>
              {res.rules.onlyB.length ? <ul className="mcss-checks">{res.rules.onlyB.map((f, i) => <li key={i}><span aria-hidden>+</span><span>{lbl(f, otherMarket)}</span></li>)}</ul> : <div className="mcss-dim">None.</div>}
            </div>
          </div>
          {res.rules.pausedA || res.rules.pausedB ? <div className="mcss-dim" style={{ fontSize: 12 }}>Paused rules left out: A {res.rules.pausedA}, B {res.rules.pausedB}.</div> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {([['In A, not in B', res.onlyInA, res.onlyInACount], ['In B, not in A', res.onlyInB, res.onlyInBCount]] as const).map(([title, list, total]) => (
              <div key={title}>
                <div className="mcss-h4">{title} · {total.toLocaleString('en-US')}{total > list.length ? ` (largest ${list.length} shown)` : ''}</div>
                {list.length ? <ul className="mcss-checks">{list.map((x) => <li key={x.t}><span aria-hidden>·</span><span><b>{x.t}</b> <span className="mcss-dim">{x.n}</span></span></li>)}</ul> : <div className="mcss-dim">None.</div>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
