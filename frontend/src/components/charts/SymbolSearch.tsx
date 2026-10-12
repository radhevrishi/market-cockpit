'use client';
// zzz986 — the chart page's ticker box with suggestions: type a ticker fragment or any word of a company name and pick from
// US + India matches (ticker, name, market). ↑ / ↓ move, Enter opens, Esc closes. The full list is fetched once per tab
// (/api/v1/symbol-list) and kept in memory + sessionStorage; matching runs in the browser (lib/symbol-search).
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSymbolIndex, fromTuple, searchSymbols, type SymbolIndex, type SymbolItem, type SymbolMarket } from '@/lib/symbol-search';

const SS_KEY = 'mc:symbol-list:v1';   // per-tab convenience only
const SS_MAX_AGE = 12 * 3600_000;
let indexPromise: Promise<SymbolIndex | null> | null = null;

function loadIndex(): Promise<SymbolIndex | null> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const raw = window.sessionStorage.getItem(SS_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { at: number; symbols: unknown[] };
        if (Date.now() - j.at < SS_MAX_AGE && Array.isArray(j.symbols) && j.symbols.length > 1000) {
          return buildSymbolIndex(j.symbols.map(fromTuple).filter((x): x is SymbolItem => !!x));
        }
      }
    } catch { /* storage blocked or bad copy: fetch */ }
    try {
      const r = await fetch('/api/v1/symbol-list', { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as { symbols?: unknown[] };
      const tuples = Array.isArray(j.symbols) ? j.symbols : [];
      if (tuples.length > 1000) { try { window.sessionStorage.setItem(SS_KEY, JSON.stringify({ at: Date.now(), symbols: tuples })); } catch { /* full / blocked */ } }
      return buildSymbolIndex(tuples.map(fromTuple).filter((x): x is SymbolItem => !!x));
    } catch {
      indexPromise = null;   // let a later keystroke try again
      return null;
    }
  })();
  return indexPromise;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  market: SymbolMarket;             // the market picked in the box next to it: its matches come first within a tier
  onPick: (s: SymbolItem) => void;
  onSubmitTyped: () => void;        // Enter with nothing better to open: the old behaviour (open the typed ticker)
  isTypedTicker: (v: string) => boolean;
  inputStyle?: React.CSSProperties;
}

export default function SymbolSearch({ value, onChange, market, onPick, onSubmitTyped, isTypedTicker, inputStyle }: Props) {
  const [index, setIndex] = useState<SymbolIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [term, setTerm] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // debounce the typed text a little so a fast typist does not re-rank on every key
  useEffect(() => { const id = setTimeout(() => setTerm(value), 120); return () => clearTimeout(id); }, [value]);

  const ensureIndex = () => {
    if (index || loading) return;
    setLoading(true);
    loadIndex().then((ix) => { if (ix) setIndex(ix); }).finally(() => setLoading(false));
  };

  const results = useMemo(() => (index && term.trim() ? searchSymbols(index, term, 15, market) : []), [index, term, market]);
  // a new result list starts with nothing highlighted (state adjusted during render, React's documented pattern)
  const [prevResults, setPrevResults] = useState(results);
  if (prevResults !== results) { setPrevResults(results); setActive(-1); }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (s: SymbolItem) => { setOpen(false); setActive(-1); onPick(s); };
  const showList = open && value.trim().length > 0 && (results.length > 0 || loading || !!index);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (results.length) setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setActive(-1); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // results may lag the typed text by the debounce: only trust them when they were ranked for this exact text
      const fresh = term === value ? results : [];
      if (active >= 0 && fresh[active]) return pick(fresh[active]);
      const top = fresh[0];
      const typed = value.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|NYSEARCA|BATS):/, '').replace(/\.(NS|BO)$/, '');
      if (top && top.t.toUpperCase() === typed && !/^(NSE|BSE):|\.(NS|BO)$/i.test(value.trim())) return pick(top);
      if (isTypedTicker(value) || !top) { setOpen(false); onSubmitTyped(); return; }
      pick(top);
    }
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input aria-label="Ticker or company" role="combobox" aria-expanded={showList} aria-autocomplete="list" aria-controls="mc-symbol-suggest"
        aria-activedescendant={active >= 0 ? `mc-sym-${active}` : undefined} autoComplete="off" spellCheck={false}
        value={value} placeholder="Ticker or company, e.g. QQQ"
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); ensureIndex(); }}
        onFocus={() => { ensureIndex(); if (value.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
        style={inputStyle} />
      {showList && (
        <ul id="mc-symbol-suggest" ref={listRef} role="listbox"
          style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60, width: 380, maxWidth: '90vw', maxHeight: 360, overflowY: 'auto',
            margin: 0, padding: 4, listStyle: 'none', borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
          {!index && loading && <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--mc-text-3)' }}>Loading company list…</li>}
          {index && results.length === 0 && <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--mc-text-3)' }}>No match — press Enter to open the typed ticker</li>}
          {results.map((s, i) => (
            <li key={`${s.m}:${s.t}`} id={`mc-sym-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                background: i === active ? 'var(--mc-bg-2, rgba(127,127,127,0.15))' : 'transparent' }}>
              <span style={{ minWidth: 92, fontWeight: 700, fontSize: 13, color: 'var(--mc-text-0)' }}>{s.t}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--mc-text-2, var(--mc-text-1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.n}>{s.n}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--mc-border-1)', color: 'var(--mc-text-3)', whiteSpace: 'nowrap' }}>
                {s.m === 'IN' ? `IN · ${s.x || 'NSE'}` : `US${s.x ? ` · ${s.x}` : ''}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
