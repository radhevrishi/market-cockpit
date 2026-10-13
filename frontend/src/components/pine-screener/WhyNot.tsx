'use client';
// zzz1004 — "Why not listed?": type a ticker and see, step by step, whether it is in the data, on the company list, scanned on each
// selected timeframe, every pattern stored on it (also below the thresholds) and the rule that excluded it. Never relaxes a filter.
import React, { useState } from 'react';
import { PATTERN_META } from '@/lib/chart-patterns';
import { whyNotListed, stageWord, tagLengthText, type WhyResult } from '@/lib/screener/pine-view';
import type { PineQuery, PineRun } from '@/lib/screener/pine';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { C, pct } from './pine-ui';

const VERDICT_COL: Record<WhyResult['verdict'], string> = { listed: C.green, provisional: C.amber, excluded: C.red, 'not-in-data': C.dim, 'out-of-scope': C.amber };

export function WhyResultView({ w }: { w: WhyResult }) {
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }} data-why={w.ticker}>
      <b style={{ color: VERDICT_COL[w.verdict] }} data-testid="why-headline">{w.headline}</b>
      <ul style={{ listStyle: 'none', margin: 0, paddingLeft: 0, display: 'grid', gap: 2 }}>
        {w.steps.map((s, i) => <li key={i} style={{ color: s.ok === false ? C.red : C.text1 }}>{s.ok == null ? '·' : s.ok ? '✓' : '✗'} <b>{s.label}</b> <span style={{ color: C.dim }}>{s.detail}</span></li>)}
      </ul>
      {w.patterns.length ? (
        <div>
          <span className="pnx-note">Every stored pattern (D / W / M, also below the thresholds):</span>
          <ul style={{ margin: '2px 0 0 16px', display: 'grid', gap: 2 }}>
            {w.patterns.map((p, i) => (
              <li key={i} style={{ color: p.reasons.length ? C.text1 : C.green }}>
                {PATTERN_META[p.tag.id]?.label || p.tag.id} [{p.tf}] {stageWord(p.tag)}, shape {p.tag.c}{p.tag.d != null ? `, ${pct(p.tag.b === 'U' ? p.tag.d : -p.tag.d)} to pivot` : ''}{tagLengthText(p.tag) ? `, ${tagLengthText(p.tag)}` : ''}
                {' — '}{p.reasons.length ? <span style={{ color: C.red }}>{p.reasons.join('; ')}</span> : 'passes'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function WhyNot({ rows, q, market, list, listName, run }: { rows: readonly ScreenRow[]; q: PineQuery; market: ScreenMarket; list: ReadonlySet<string> | null; listName: string; run: PineRun }) {
  const [txt, setTxt] = useState('');
  const [res, setRes] = useState<WhyResult | null>(null);
  const check = () => { if (txt.trim()) setRes(whyNotListed(txt, { rows, q, market, list, listName, run })); };
  return (
    <details className="pnx-why" style={{ fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 10px' }}>
      <summary style={{ cursor: 'pointer', color: C.text2, fontWeight: 700 }}>Why isn&apos;t a company listed?</summary>
      <form style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }} onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={market === 'IN' ? 'e.g. OMFREIGHT' : 'e.g. PPIH'} aria-label="Ticker to check" className="pnx-in" style={{ width: 160 }} />
        <button type="submit" className="pnx-btn">Check</button>
        <span className="pnx-note">In the data? On the list? Scanned? Which rule excluded it? Nothing is relaxed.</span>
      </form>
      {res ? <WhyResultView w={res} /> : null}
    </details>
  );
}
