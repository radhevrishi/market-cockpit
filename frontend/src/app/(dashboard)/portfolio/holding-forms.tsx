'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { type PortfolioHolding, type StockQuote } from './types';

/* ── Add Holding Modal ─────────────────────────────────────────────── */

export function AddHoldingForm({ onAdd, onCancel, quotes }: { onAdd: (h: PortfolioHolding) => void; onCancel: () => void; quotes: StockQuote[] }) {
  const [symbol, setSymbol] = useState('');
  const [company, setCompany] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    const sym = symbol.trim().toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '');
    if (!sym || !/^[A-Z0-9&-]+$/.test(sym)) { toast.error('Invalid symbol'); return; }
    if (!entryPrice || Number(entryPrice) <= 0) { toast.error('Enter valid entry price'); return; }
    if (!quantity || Number(quantity) <= 0) { toast.error('Enter valid quantity'); return; }

    onAdd({
      symbol: sym,
      entryPrice: Number(entryPrice),
      quantity: Number(quantity),
      weight: 0,
      addedAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    });
  };

  const searchSuggestions = useMemo((): TickerSuggestion[] =>
    quotes.map(q => ({ ticker: q.ticker, company: q.company || q.ticker, sector: q.sector || '—', price: q.price || 0, changePercent: q.changePercent || 0 })),
    [quotes]
  );

  const inputStyle = {
    backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '8px',
    padding: '10px 14px', color: '#F5F7FA', fontSize: '14px', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--mc-text-0)', marginBottom: '16px' }}>Add Holding</div>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>SEARCH STOCK</label>
        <TickerSearch
          onSelect={(ticker, sug) => {
            setSymbol(ticker);
            if (sug) {
              setCompany(sug.company);
              if (sug.price > 0 && !entryPrice) setEntryPrice(sug.price.toFixed(2));
            }
          }}
          quotes={searchSuggestions}
          placeholder="Search by company name or ticker..."
          clearOnSelect={false}
        />
        {symbol && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--mc-bullish)', fontWeight: 600 }}>
            Selected: {symbol} {company && company !== symbol ? `— ${company}` : ''}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>ENTRY PRICE (₹)</label>
          {/* PATCH 0454 P2-29 — inputMode='decimal' so mobile users get the
              numeric keyboard instead of the full keyboard. */}
          <input type="number" inputMode="decimal" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="1250.00" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>QUANTITY</label>
          <input type="number" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>NOTES (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Long-term hold" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--mc-border-2)', backgroundColor: 'transparent', color: 'var(--mc-text-3)', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Cancel</button>
        <button onClick={handleSubmit} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--mc-bullish)', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Add to Portfolio</button>
      </div>
    </div>
  );
}

/* ── Inline Edit Cell ──────────────────────────────────────────────── */

export function EditableCell({ value, onSave, type = 'price' }: { value: number; onSave: (v: number) => void; type?: 'price' | 'qty' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));

  if (!editing) {
    return (
      <span style={{ cursor: 'pointer', borderBottom: '1px dashed var(--mc-text-4)' }} onClick={() => { setVal(String(value)); setEditing(true); }}>
        {type === 'price' ? `₹${value.toFixed(2)}` : String(Math.round(value))}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      {/* PATCH 0454 P2-29 — inputMode='decimal' for mobile keyboard. */}
      <input type="number" inputMode={type === 'qty' ? 'numeric' : 'decimal'} value={val} onChange={e => setVal(e.target.value)}
        style={{ width: '80px', padding: '2px 6px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-info)', borderRadius: '4px', color: 'var(--mc-text-0)', fontSize: '12px', outline: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(Number(val)); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <button onClick={() => { onSave(Number(val)); setEditing(false); }} style={{ background: 'none', border: 'none', color: 'var(--mc-bullish)', cursor: 'pointer', padding: '2px' }}>
        <Check style={{ width: '12px', height: '12px' }} />
      </button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--mc-bearish)', cursor: 'pointer', padding: '2px' }}>
        <X style={{ width: '12px', height: '12px' }} />
      </button>
    </span>
  );
}

/**
 * One row's worth of editing: entry price, quantity and notes together,
 * saved in a single write. Local state so typing never re-renders the
 * whole table, and Escape always gets you out. (zzz756)
 */
export function EditHoldingRow({ row, colSpan, onSave, onCancel }: {
  row: { symbol: string; entryPrice: number; quantity: number; notes?: string };
  colSpan: number;
  onSave: (p: { entryPrice: number; quantity: number; notes: string }) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(String(row.entryPrice ?? ''));
  const [qty, setQty] = useState(String(row.quantity ?? ''));
  const [notes, setNotes] = useState(row.notes ?? '');
  const submit = () => onSave({ entryPrice: Number(price), quantity: Number(qty), notes });
  const field = {
    backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: 6,
    padding: '6px 9px', color: 'var(--mc-text-0)', fontSize: 12, outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };
  const lbl = { fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: 'var(--mc-text-4)', display: 'block', marginBottom: 3 };
  return (
    <tr style={{ backgroundColor: 'rgba(34,211,238,0.05)', borderBottom: '1px solid var(--mc-bg-2)' }}>
      <td colSpan={colSpan} style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') submit(); }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-text-0)', paddingBottom: 7 }}>{row.symbol}</div>
          <div style={{ width: 130 }}>
            <label style={lbl}>ENTRY PRICE (₹)</label>
            <input type="number" inputMode="decimal" value={price} autoFocus
              onChange={(e) => setPrice(e.target.value)} style={field} />
          </div>
          <div style={{ width: 110 }}>
            <label style={lbl}>QUANTITY</label>
            <input type="number" inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>NOTES — WHY YOU OWN IT</label>
            <input type="text" value={notes} placeholder="e.g. capacity doubling, order book 2.4× revenue"
              onChange={(e) => setNotes(e.target.value)} style={field} />
          </div>
          <button onClick={submit} style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid var(--mc-bullish)',
            background: 'rgba(16,185,129,0.12)', color: 'var(--mc-bullish)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
          }}>SAVE</button>
          <button onClick={onCancel} style={{
            padding: '7px 12px', borderRadius: 6, border: '1px solid var(--mc-border-2)',
            background: 'transparent', color: 'var(--mc-text-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
          }}>CANCEL</button>
        </div>
      </td>
    </tr>
  );
}
