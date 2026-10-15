'use client';
// zzz1006 — company detail side panel (opened from the company name). It shows the snapshot's own figures for the row — the same
// values, formats and ≈ marks as the table — how the open screen's filters judge it, the review choices, and links to the chart,
// the Pine Screener and the Stock Sheet. The table underneath keeps its scroll position (the panel floats over the page).
// zzz1012 — premium styling (screener tokens), check marks in their own column, j / k hint.
import { useEffect, useRef } from 'react';
import NavLink from '@/components/NavLink';   // zzz1052 — prefetch on hover / focus / press, not on scroll-into-view
import { FIELDS, fieldOf, fmtValue, fmtPrice, type Filter, type NumKey } from '@/lib/screener/filters';
import type { ScreenMarket, ScreenRow } from '@/lib/screener/types';
import { REVIEW_STATES, type ReviewState } from '@/lib/screener/workflow';
import { explainRow, naReason } from '@/lib/screener/research';
import { tvSectorMapping } from '@/lib/screener/tv-sectors';
import { cellText } from '@/lib/screener/column-views';
import { ADD_GROUPS } from './AddFilterPanel';
import { fieldMeta } from '@/lib/screener/field-meta';

export default function CompanyDetail({ row, market, filters, exactOnly, review, onReview, chartHref, onChart, onPine, onClose, position }: {
  row: ScreenRow; market: ScreenMarket; filters: Filter[]; exactOnly: boolean; review: ReviewState; onReview: (s: ReviewState) => void;
  chartHref: string; onChart: (e: React.MouseEvent) => void; onPine: (e: React.MouseEvent) => void; onClose: () => void;
  /** "3 of 16" — the row's place in the result */
  position?: string;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [row.t]);
  const checks = explainRow(row, filters, market, new Date(), exactOnly);
  const map = tvSectorMapping(market, row.sec, row.ind, row.t);
  const val = (k: NumKey) => {
    const v = row[k] as number | null | undefined; const d = fieldOf(k);
    if (v == null) { const na = naReason(row, k); return na ? 'n/a' : null; }
    return `${row.approx?.includes(k) ? '≈' : ''}${cellText(v, d?.unit || 'num', market, k)}`;
  };
  const chg = typeof row.chg === 'number' ? row.chg : null;
  const exch = row.exch?.length ? row.exch.join(' · ') : market === 'IN' ? 'NSE' : 'US';
  return (
    <aside className="mcss-drawer" role="dialog" aria-label={`Company details: ${row.t}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="hd">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="tk">{row.t}</span>
          <span className="mcss-mk" title="Exchange">{exch}</span>
          {position ? <span className="mcss-dim" style={{ fontSize: 12 }}>{position}</span> : null}
          <span style={{ flex: 1 }} />
          <button ref={closeRef} type="button" className="mcss-btn ghost sm" aria-label="Close company details" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ss-ink)', marginTop: 4, fontWeight: 500 }}>{row.n}</div>
        <div className="mcss-dim" style={{ fontSize: 12, marginTop: 2 }} title={`Source: ${[row.sec, row.ind].filter(Boolean).join(' · ') || 'none'}\nTradingView sector ${map.note}`}>
          {row.tvSec || row.sec || 'Sector unknown'}{row.ind ? ` · ${row.ind}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <NavLink href={chartHref} className="mcss-btn primary sm" onClick={onChart}>Open chart</NavLink>
          <a href={`/pine-screener?from=stock&market=${market}`} className="mcss-btn sm" onClick={onPine} title="Opens the Pine Screener limited to this company">Pine Screener</a>
          <a href={`/stock-sheet?ticker=${encodeURIComponent(row.t)}&market=${market}`} className="mcss-btn sm" title="Fundamental analysis on the Stock Sheet">Stock Sheet</a>
        </div>
      </div>
      <div className="bd">
        <div className="mcss-facts">
          <div title={`${fieldMeta('px', market, row).period} · ${fieldMeta('px', market, row).source}`}><div className="k">Price</div><div className="v">{fmtPrice(row.px, market)}</div></div>
          <div><div className="k">Change today</div><div className="v" style={{ color: chg == null || chg === 0 ? undefined : chg > 0 ? 'var(--ss-up)' : 'var(--ss-down)' }}>{chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}</div></div>
          <div title={`${fieldMeta('mc', market, row).period} · ${fieldMeta('mc', market, row).source}`}><div className="k">Market cap</div><div className="v">{fmtValue(row.mc, 'money', market)}</div></div>
        </div>
        <div className="mcss-h4">Review</div>
        <div className="mcss-seg sm" role="radiogroup" aria-label={`Review state for ${row.t}`}>
          {REVIEW_STATES.map((x) => <button key={x.id} type="button" role="radio" aria-checked={x.id === review} onClick={() => onReview(x.id)}>{x.label}</button>)}
        </div>
        {checks.length ? (<>
          <div className="mcss-h4">This screen&apos;s filters · {checks.every((c) => c.pass) ? 'passes every one' : `fails ${checks.filter((c) => !c.pass).length} of ${checks.length}`}</div>
          <ul className="mcss-checks">
            {checks.map((c, i) => (
              <li key={i} style={{ color: c.pass ? 'var(--ss-ink-2)' : 'var(--ss-down)' }}>
                <span aria-hidden className={c.pass ? 'ok' : 'no'}>{c.pass ? '✓' : '✗'}</span><span>{c.label}: <span style={{ color: c.nearMiss ? 'var(--ss-warn)' : 'var(--ss-ink-3)' }}>{c.detail}</span></span>
              </li>
            ))}
          </ul>
        </>) : null}
        {ADD_GROUPS.map((g) => {
          const items = FIELDS.filter((f) => g.of.includes(f.group) && f.markets.includes(market) && f.key !== 'px' && f.key !== 'chg' && f.key !== 'mc').map((f) => ({ f, v: val(f.key) })).filter((x) => x.v != null);
          if (!items.length) return null;
          return (
            <section key={g.label}>
              <div className="mcss-h4">{g.label}</div>
              <div className="mcss-kv">
                {items.map(({ f, v }) => { const m = fieldMeta(f.key, market, row); const ax = !!row.approx?.includes(f.key); return <FragmentKV key={f.key} k={f.label} v={v!} sub={`${m.period} · ${m.source}`} tip={[`Period: ${m.period}`, `Source: ${m.source}`, m.approx ? `${ax ? '≈ for this company — ' : 'How it is worked out: '}${m.approx}` : ax ? '≈ worked out in a rougher way for this company' : ''].filter(Boolean).join('\n')} />; })}
              </div>
            </section>
          );
        })}
        <div className="mcss-dim" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>Press <kbd>j</kbd> / <kbd>k</kbd> for the next / previous company, <kbd>Esc</kbd> to close. Figures from the snapshot{row.q ? `, latest quarter ${row.q}` : ''}; under each figure: its period and source (hover for how it is worked out). ≈ = worked out in a rougher way; n/a = not meaningful for this company.</div>
      </div>
    </aside>
  );
}
/** zzz1045b — a figure with its period and source under the name (full text, with the ≈ reason, on hover). */
function FragmentKV({ k, v, sub, tip }: { k: string; v: string; sub?: string; tip?: string }) {
  return <><span title={tip}>{k}{sub ? <span className="mcss-dim" data-field-meta style={{ display: 'block', fontSize: 11, lineHeight: 1.35 }}>{sub}</span> : null}</span><span className="v" title={tip}>{v}</span></>;
}
