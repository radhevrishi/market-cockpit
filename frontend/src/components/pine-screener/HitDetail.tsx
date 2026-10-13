'use client';
// zzz999 — the expandable detail under a result row: why the pattern is listed (the screen's checks), where it stops being valid,
// volume, the scan close against the latest quote (with dates and sources), every other pattern on this company (D / W / M), and
// a button to open the chart.
import React from 'react';
import { PATTERN_META } from '@/lib/chart-patterns';
import { likelihoodWord, type PineHit, type PineQuery } from '@/lib/screener/pine';
import { fmtPrice, type Filter } from '@/lib/screener/filters';
import { explainRow } from '@/lib/screener/research';
import { allPatterns, invalidation, maPosition, patternChecks, stageWord, tagLengthText, tagScanClose, tfWord } from '@/lib/screener/pine-view';
import type { ScreenMarket } from '@/lib/screener/types';
import { C, MaCell, PatternChip, pct } from './pine-ui';

export function HitDetail({ hit, q, market, onOpenChart, width }: { hit: PineHit; q: PineQuery; market: ScreenMarket; onOpenChart: (tf: string) => void; width?: number | null }) {
  const { row: r, best: b } = hit;
  const meta = b ? PATTERN_META[b.id] : null;
  const checks = patternChecks(hit, q);
  const rules = explainRow(r, q.filters.filter((f: Filter) => !f.off), market);
  const inv = b ? invalidation(b) : null;
  const sc = b ? tagScanClose(r, b) : tagScanClose(r, { tf: 'D' });
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
              <li>{b.b === 'U' ? 'Pivot (buy point)' : 'Breakdown level'} <b>{fmtPrice(b.p, market)}</b>; scan close {dd == null ? 'distance unknown' : <b style={{ color: dd >= 0 ? (b.b === 'U' ? C.green : C.red) : C.text }}>{pct(dd)}</b>} {dd != null ? (dd < 0 ? 'short of it' : 'beyond it') : ''}</li>
              {tagLengthText(b) ? <li>{tagLengthText(b)} long{b.dp != null ? `, ${b.dp}% deep` : ''}</li> : null}
              <li>Volume: {vq ? <span style={{ color: C.amber }}>not confirmed (too little usable volume data)</span> : 'enough data to read; nothing flagged'}</li>
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
        </ul>
        <h4 style={{ marginTop: 12 }}>Prices</h4>
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          <li>Scan close {fmtPrice(sc.px ?? r.scanPx, market)}{sc.at ? ` on ${sc.at}` : r.scanAt ? ` on ${r.scanAt}` : ''}{r.scanSrc ? ` (${r.scanSrc})` : ''} — the pattern{sc.tf !== 'D' ? ` (${tfWord(sc.tf)} close)` : ''}, pivot distance and averages use it</li>
          <li>Latest quote {fmtPrice(r.px, market)}{r.pxSrc ? ` (${r.pxSrc}${r.pxAt ? `, ${r.pxAt}` : ''})` : ''}{dq != null ? `, ${pct(dq)} to the pivot` : ''}{r.pxConflict ? <span style={{ color: C.amber }}> — the two sources disagree on the same day</span> : null}</li>
          <li>Against its 21 / 50 / 200-day averages: <MaCell ma={ma} market={market} /></li>
        </ul>
      </section>
      <section>
        <h4>Every pattern on this company</h4>
        <div style={{ display: 'grid', gap: 6 }}>
          {others.map((p) => (
            <div key={p.tf} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, alignItems: 'start' }}>
              <span style={{ color: C.dim, fontSize: 12.5 }}>{tfWord(p.tf)}</span>
              {p.tags == null ? <span className="pnx-note">not scanned yet</span> : p.tags.length
                ? <div className="pnx-chips">{p.tags.map((t) => <PatternChip key={t.id} t={{ ...t, tf: t.tf || p.tf }} market={market} showStage main={!!b && t.id === b.id && (t.tf || p.tf) === (b.tf || 'D')} />)}</div>
                : <span className="pnx-note">none</span>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" className="pnx-btn" data-on="true" onClick={() => onOpenChart(b?.tf || 'D')}>Open {tfWord(b?.tf)} chart</button>
          {b?.tf && b.tf !== 'D' ? <button type="button" className="pnx-btn" onClick={() => onOpenChart('D')}>Open daily chart</button> : null}
        </div>
      </section>
    </div>
  );
}
