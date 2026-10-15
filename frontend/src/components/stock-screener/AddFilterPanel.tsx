'use client';
// zzz1006 — "+ Add filter": a searchable panel grouped Growth / Valuation / Quality / Technicals / Company, plus the list and
// comparison rules. It offers exactly the fields the screener already has for the market; picking one adds the same default filter
// as before (the page's pick()).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FIELDS, type FieldGroup } from '@/lib/screener/filters';
import type { ScreenMarket } from '@/lib/screener/types';
import { listKeys, usePopover } from './screener-ui';

/** The rules that are not a single figure. */
export const RULE_ITEMS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: 'sector', label: 'Sector', hint: "TradingView's sectors" },
  { key: 'exch', label: 'Exchange', hint: 'NASDAQ / NYSE / AMEX or NSE / BSE' },
  { key: 'cmp', label: 'One figure against another', hint: 'e.g. SMA 50 ≥ SMA 200' },
  { key: 'near', label: 'Within a % range above another', hint: 'e.g. price 0–10% above EMA 10' },
  { key: 'pattern', label: 'Chart pattern', hint: 'bullish / bearish, daily / weekly / monthly, stage, shape score' },
];
/** Presentation groups over the field groups the screener defines. */
export const ADD_GROUPS: ReadonlyArray<{ label: string; of: FieldGroup[] }> = [
  { label: 'Growth', of: ['Growth'] },
  { label: 'Valuation', of: ['Valuation'] },
  { label: 'Quality', of: ['Margins & returns', 'Balance sheet'] },
  { label: 'Technicals', of: ['Price & volume', 'Moving averages', 'Momentum'] },
  { label: 'Trader setups', of: ['Trader setups'] },   // zzz1020
  { label: 'Volume & accumulation', of: ['Volume & accumulation'] },   // zzz1046a
  { label: 'Company', of: ['Company'] },
];

export default function AddFilterPanel({ market, onPick }: { market: ScreenMarket; onPick: (key: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const needle = q.trim().toLocaleLowerCase();
  const has = (s: string) => !needle || s.toLocaleLowerCase().includes(needle);
  const groups = useMemo(() => ADD_GROUPS.map((g) => ({ label: g.label, fields: FIELDS.filter((f) => g.of.includes(f.group) && f.markets.includes(market) && has(`${f.label} ${f.group} ${g.label}`)) }))
    .filter((g) => g.fields.length), [market, needle]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rules = RULE_ITEMS.filter((r) => has(`${r.label} ${r.hint}`));
  const pick = (k: string) => { setOpen(false); setQ(''); onPick(k); };
  // zzz1012 — keep the panel inside the window (the button can sit at the right end of the chip row): the offset is worked out on
  // the click, before the panel renders, and the search box is focused without scrolling (autoFocus scrolled the page sideways)
  const [shift, setShift] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toggle = () => {
    if (!open && typeof window !== 'undefined') {
      const r = ref.current?.getBoundingClientRect();
      const w = Math.min(560, window.innerWidth * 0.92);
      setShift(r ? Math.min(0, window.innerWidth - 12 - (r.left + w)) : 0);
    }
    setOpen((v) => !v);
  };
  useEffect(() => { if (open) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="mcss-chip mcss-add" aria-label="Add a filter" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}
        style={{ padding: '0 10px', cursor: 'pointer', fontWeight: 650, alignItems: 'center', fontFamily: 'inherit' }}>+ Add filter</button>
      {open ? (
        <div className="mcss-pop" role="dialog" aria-label="Add a filter" style={{ width: 'min(560px, 92vw)', left: shift }}>
          <input ref={inputRef} className="mcss-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Find a figure — e.g. “margin”, “EPS”, “SMA”" aria-label="Find a filter"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLElement>('.mcss-item')?.focus(); }
              if (e.key === 'Enter') { const first = listRef.current?.querySelector<HTMLElement>('.mcss-item'); first?.click(); }
            }} />
          <div ref={listRef} onKeyDown={(e) => listKeys(e)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 8, marginTop: 4 }}>
            {rules.length ? (
              <div role="group" aria-label="Lists and comparisons">
                <div className="mcss-grp">Lists and comparisons</div>
                {rules.map((r) => <button key={r.key} type="button" className="mcss-item" data-filter-key={r.key} title={r.hint} onClick={() => pick(r.key)}>{r.label}</button>)}
              </div>
            ) : null}
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <div className="mcss-grp">{g.label}</div>
                {g.fields.map((f) => (
                  <button key={f.key} type="button" className="mcss-item" data-filter-key={f.key} onClick={() => pick(f.key)}
                    title={[f.approxNote?.[market] ? `≈ ${f.approxNote[market]}` : '', f.sparse?.[market] ? `Few companies have this: ${f.sparse[market]}` : ''].filter(Boolean).join('\n') || undefined}>
                    {f.label}{f.approxNote?.[market] ? <span className="end">≈</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {!rules.length && !groups.length ? <div className="mcss-dim" style={{ padding: 10 }}>No figure matches “{q}”.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
