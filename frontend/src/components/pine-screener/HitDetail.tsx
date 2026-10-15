'use client';
// zzz999 — the expandable detail under a result row: why the pattern is listed (the screen's checks), where it stops being valid,
// volume, the scan close against the latest quote (with dates and sources), every other pattern on this company (D / W / M), and
// a button to open the chart.
import React, { useEffect, useState } from 'react';
import { PATTERN_META } from '@/lib/chart-patterns';
import { likelihoodWord, pineFilters, r40Explain, R40_FORMULA, type PineHit, type PineQuery } from '@/lib/screener/pine';
import { fmtPrice, type Filter } from '@/lib/screener/filters';
import { explainRow } from '@/lib/screener/research';
import { allPatterns, analysisOf, conditionState, conflictWords, evidenceRows, geometryPoints, invalidation, latestConditions, lengthTip, maPosition, patternChecks, pivotDerivation, priceSet, sessionLabel, stageWord, tagLengthText, tfWord } from '@/lib/screener/pine-view';
import type { ScreenPatternTag } from '@/lib/screener/pine';
import type { ScreenMarket } from '@/lib/screener/types';
import { C, ConditionBadges, ConditionChip, MaCell, PatternChip, SessionBadge, pct } from './pine-ui';

type GeoState = { status: 'loading' | 'ok' | 'error'; tags: Record<'D' | 'W' | 'M' | 'L', ScreenPatternTag[]> | null; error?: string };
/** zzz1008 — one company's tags WITH their geometry (turning points + evidence), read when the detail opens. */
function useGeometry(market: ScreenMarket, t: string): GeoState {
  const id = `${market}:${t}`;
  const [st, setSt] = useState<GeoState & { id: string }>({ id: '', status: 'loading', tags: null });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/v1/pine-screener?market=${market}&detail=${encodeURIComponent(t)}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (res) => { const j = await res.json().catch(() => null); if (!res.ok || !j?.ok || !j.geometry) throw new Error(j?.error || `HTTP ${res.status}`); return j.geometry; })
      .then((g) => setSt({ id, status: 'ok', tags: g }))
      .catch((e) => { if (!ctrl.signal.aborted) setSt({ id, status: 'error', tags: null, error: String(e?.message || e) }); });
    return () => ctrl.abort();
  }, [market, t, id]);
  // another company's answer (or none yet) reads as loading
  return st.id === id ? st : { status: 'loading', tags: null };
}
/** The detected structure of one tag: its turning points (date, price, role), how the pivot is derived, and the measured evidence. */
export function GeometryView({ tag, market }: { tag: ScreenPatternTag; market: ScreenMarket }) {
  const pts = geometryPoints(tag);
  const ev = evidenceRows(tag);
  const fp = (n: number) => fmtPrice(n, market);
  if (!pts.length) return <div className="pnx-note" data-geometry="missing">The turning points of this reading are not stored (read before scan version 8) — they appear after the next re-read.</div>;
  return (
    <div style={{ display: 'grid', gap: 8 }} data-geometry="ok">
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr><th style={{ textAlign: 'left', padding: '2px 8px 2px 0' }}>Point</th><th style={{ textAlign: 'left', padding: '2px 8px' }}>{tag.tf === 'W' ? 'Week' : tag.tf === 'M' ? 'Month' : 'Date'}</th><th style={{ textAlign: 'right', padding: '2px 0 2px 8px' }}>Price</th></tr></thead>
        <tbody>{pts.map((x, i) => <tr key={i} data-point={x.role}><td style={{ padding: '2px 8px 2px 0' }}>{x.word}</td><td style={{ padding: '2px 8px', color: C.text2 }}>{x.when}</td><td style={{ padding: '2px 0 2px 8px', textAlign: 'right' }}><b>{fp(x.price)}</b></td></tr>)}</tbody>
      </table>
      <div data-derivation><b>{tag.b === 'U' ? 'Pivot' : 'Breakdown level'}:</b> {pivotDerivation(tag, fp)}</div>
      {ev.length ? (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }} data-evidence>
          {/* zzz1028 — ✓ / ✗ = the measured value against the detector's own rule; · = measured and scored, not a rule the shape had to pass */}
          {ev.map((x) => <li key={x.label} data-pass={x.pass == null ? 'info' : x.pass ? 'yes' : 'no'} style={{ color: x.pass === false ? C.red : undefined }}>
            <span aria-label={x.pass == null ? 'scored, not required' : x.pass ? 'passed' : 'failed'}>{x.pass == null ? '·' : x.pass ? '✓' : '✗'}</span> {x.label}: <b>{x.value}</b>{x.rule ? <span style={{ color: C.dim }}> — {x.pass == null ? '' : 'rule '}{x.rule}</span> : null}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function HitDetail({ hit, q, market, onOpenChart, width }: { hit: PineHit; q: PineQuery; market: ScreenMarket; onOpenChart: (tf: string, tag?: ScreenPatternTag | null) => void; width?: number | null }) {
  const { row: r, best: b } = hit;
  const geo = useGeometry(market, r.t);
  const geoKey = b ? ((b as any).lv ? 'L' : (b.tf || 'D')) as 'D' | 'W' | 'M' | 'L' : null;
  const geoTag = b && geoKey && geo.tags ? (geo.tags[geoKey] || []).find((t) => t.id === b.id) || null : null;
  const meta = b ? PATTERN_META[b.id] : null;
  const checks = patternChecks(hit, q);
  const rules = explainRow(r, pineFilters(q).filter((f: Filter) => !f.off), market);   // zzz1007 — + the Rule of 40 control
  const inv = b ? invalidation(b) : null;
  // zzz1004 (PS-02) — the analysis close of the tag's own timeframe, the daily technical close and the latest quote, kept apart
  const ps = priceSet(r, b || { tf: 'D' });
  const an = ps.analysis;
  const conds = latestConditions(r, b);
  const dd = b?.d == null ? null : b.b === 'U' ? b.d : -b.d;
  const dq = b && typeof (b as any).dq === 'number' ? (b.b === 'U' ? (b as any).dq : -(b as any).dq) as number : null;
  const others = allPatterns(r);
  const ma = maPosition(r);
  const vq = b && (b as any).vq === 0;
  return (
    <div className="pnx-detail-grid" style={width ? { width: width - 2 } : undefined}>
      <section>
        <h4>{b && meta ? `${meta.label} on ${tfWord(b.tf)} bars, ${stageWord(b)}` : 'Listed by the screen\'s rules'}</h4>
        {b && meta ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: C.text2 }}>{meta.short}</div>
            <ul>
              <li>Shape score <b>{b.c}</b>/100, {likelihoodWord(b.c)} (how closely the shape fits, not a probability)</li>
              <li>{b.b === 'U' ? 'Pivot (buy point)' : 'Breakdown level'} <b>{fmtPrice(b.p, market)}</b>; {tfWord(an.tf)} analysis close {dd == null ? 'distance unknown' : <b style={{ color: dd >= 0 ? (b.b === 'U' ? C.green : C.red) : C.text }}>{pct(dd)}</b>} {dd != null ? (dd < 0 ? 'short of it' : 'beyond it') : ''}{an.close == null && dd != null ? <span style={{ color: C.dim }}> (stored distance; the {tfWord(an.tf)} close it was measured from is not stored)</span> : null}</li>
              {tagLengthText(b) ? <li title={lengthTip(b)}>{tagLengthText(b)} long{b.dp != null ? `, ${b.dp}% deep` : ''}</li> : null}
              {/* zzz1011 — the historical event and the latest condition, kept apart */}
              <li data-detail="event">Event: <b>{conditionState(r, b).event.label}</b></li>
              <li data-detail="condition">Condition now: <ConditionChip c={conditionState(r, b)} /> <span style={{ color: C.dim }}>{conditionState(r, b).tip}</span></li>
              {conds.length ? <li>Latest quote: <ConditionBadges items={conds} /></li> : null}
              <li>Volume: {vq ? <span style={{ color: C.amber }}>not confirmed (too little usable volume data)</span> : geoTag?.ev?.vr != null ? <>volume at the last turning point {geoTag.ev.vr}× the first (see the structure below)</> : 'enough data to read; nothing flagged'}</li>
              {inv ? <li>Stops being valid: {inv.text}{inv.level != null ? <> (about <b>{fmtPrice(inv.level, market)}</b>)</> : null}</li> : null}
            </ul>
          </div>
        ) : <div className="pnx-note">No pattern matched the screen&apos;s pattern choices; the rules below decided.</div>}
      </section>
      <section>
        <h4>What the screen checked</h4>
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {checks.map((c, i) => <li key={`p${i}`} style={{ color: c.pass ? C.text1 : C.red }}>{c.pass ? '✓' : '✗'} {c.label}</li>)}
          {rules.map((c, i) => <li key={`r${i}`} style={{ color: c.pass ? C.text1 : C.red }}>{c.pass ? '✓' : '✗'} {c.label} <span style={{ color: C.dim }}>{c.detail}</span></li>)}
          {!checks.length && !rules.length ? <li className="pnx-note">No extra rules on this screen.</li> : null}
          {q.r40Min != null || r.revQYoY != null || r.fcfmTTM != null ? (() => { const x = r40Explain(r, q.r40Min); return (
            <li data-detail="r40" title={R40_FORMULA} style={{ color: x.pass === false ? C.red : C.text1 }}>{x.pass == null ? '·' : x.pass ? '✓' : '✗'} Rule of 40 (fundamental, not a chart condition): <span style={{ color: x.state === 'known' ? C.text1 : C.dim }}>{x.text}</span></li>
          ); })() : null}
        </ul>
        <h4 style={{ marginTop: 12 }}>Prices</h4>
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          <li data-price="analysis">{b ? `${tfWord(an.tf).replace(/^./, (c) => c.toUpperCase())} analysis close` : 'Analysis close'}{' '}
            {an.close != null ? <b>{fmtPrice(an.close, market)}</b> : <span style={{ color: C.amber }}>{an.missing}</span>}{an.at ? ` · ${an.tf === 'D' ? 'session' : an.tf === 'W' ? 'week to' : 'month to'} ${an.at}` : ''}
            {' '}<SessionBadge text={sessionLabel(an)} provisional={an.session === 'provisional'} />
            <div className="pnx-note">the pattern, its stage and the distance to the pivot are read on these {tfWord(an.tf)} bars{an.status ? ` · scan ${an.status}${an.v != null ? `, version ${an.v}` : ''}` : ''}{an.src ? ` · ${an.src}${an.basis ? `, ${an.basis}` : ''}` : ''}</div></li>
          <li data-price="daily">Daily technical close {ma.close != null && ma.basis === 'scan' ? fmtPrice(ma.close, market) : ps.daily.close != null ? fmtPrice(ps.daily.close, market) : '—'}{ma.at ? ` on ${ma.at}` : ps.daily.at ? ` on ${ps.daily.at}` : ''}{ma.session === 'provisional' ? <span style={{ color: C.amber }}> (session open — provisional, the unfinished bar)</span> : ' (completed session)'} — the 21 / 50 / 200-day distances below, RSI and performance are measured from THIS close and the averages of the same daily bars: <MaCell ma={ma} market={market} /></li>
          <li data-price="quote">Latest quote {fmtPrice(ps.quote.px, market)}{ps.quote.src ? ` (${ps.quote.src}${ps.quote.at ? `, ${ps.quote.at}` : ''})` : ''}{dq != null ? `, ${pct(dq)} to the pivot` : ''}{r.pxConflict ? <span style={{ color: C.amber }}> — {conflictWords(r)}</span> : null}</li>
        </ul>
      </section>
      <section>
        <h4>Every pattern on this company</h4>
        <div style={{ display: 'grid', gap: 6 }}>
          {others.map((p) => (
            <div key={p.tf} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, alignItems: 'start' }}>
              <span style={{ color: C.dim, fontSize: 12.5 }}>{tfWord(p.tf)}</span>
              {p.tags == null ? <span className="pnx-note">not scanned yet</span> : p.tags.length
                ? <div className="pnx-chips">{p.tags.map((t) => <PatternChip key={t.id} t={{ ...t, tf: t.tf || p.tf }} market={market} when={sessionLabel(analysisOf(r, { tf: p.tf }))} showStage main={!!b && t.id === b.id && (t.tf || p.tf) === (b.tf || 'D')} />)}</div>
                : <span className="pnx-note">none</span>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" className="pnx-btn" data-on="true" onClick={() => onOpenChart(b?.tf || 'D', geoTag ? { ...b!, pts: geoTag.pts } : b)} title="Opens the chart on the pattern's analysis timeframe with the pattern selected and its window fitted">Open {tfWord(b?.tf)} chart</button>
          {b?.tf && b.tf !== 'D' ? <button type="button" className="pnx-btn" onClick={() => onOpenChart('D')}>Open daily chart</button> : null}
        </div>
      </section>
      {b && meta ? (
        <section style={{ gridColumn: '1 / -1' }} data-testid="structure">
          <h4>Detected structure — {meta.label} on {tfWord(b.tf)} bars</h4>
          {geo.status === 'loading' ? <div className="pnx-note" aria-busy="true">Reading the turning points…</div>
            : geo.status === 'error' ? <div className="pnx-note" style={{ color: C.amber }}>The turning points could not be read ({geo.error}).</div>
            : geoTag ? <GeometryView tag={{ ...geoTag, tf: b.tf || 'D' }} market={market} />
            : <div className="pnx-note">This reading is not in the stored geometry (the snapshot changed) — refresh the page.</div>}
        </section>
      ) : null}
    </div>
  );
}
