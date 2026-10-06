'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useEffect } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { CHECKLIST_ITEMS } from './constants2';
import { fmtCap } from './helpers';
import { type EnrichedStock } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — SERENITY CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════════

export function SerenityChecklist({ enriched }: { enriched: EnrichedStock[] }) {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [savedSymbols, setSavedSymbols] = useState<string[]>([]);

  // Auto-computable items from live data — keyed by checklist item id
  // These are evaluated from the enriched universe, then applied to the active symbol
  const autoChecks = useMemo((): Record<string, { pass: boolean; note: string } | null> => {
    if (!activeSymbol) return {};
    const sym = activeSymbol.toUpperCase();
    const stock = enriched.find(s => s.ticker.replace(/\d+$/, '').toUpperCase() === sym || s.ticker.toUpperCase() === sym);
    if (!stock) return {};
    return {
      size_asymmetry: stock.is_small_cap
        ? { pass: true,  note: `Auto: Market cap ${fmtCap(stock.market_cap)} < $2B ✅` }
        : stock.market_cap
          ? { pass: false, note: `Auto: Market cap ${fmtCap(stock.market_cap)} — not small-cap` }
          : null,
      geopolitical: stock.is_non_us
        ? { pass: true, note: `Auto: Non-US listing (${stock.exchange}) — cross-border arb available ✅` }
        : { pass: false, note: `Auto: US-listed — no cross-border arb edge` },
      five_sources: stock.evidence_count >= 5
        ? { pass: true,  note: `Auto: ${stock.evidence_count} live news articles found ✅` }
        : { pass: false, note: `Auto: Only ${stock.evidence_count} live articles — need ≥5 sources` },
      competitors: stock.competitors === '1 public' || stock.competitors === '2–3 public'
        ? { pass: true,  note: `Auto: ${stock.competitors} (from framework data) ✅` }
        : null,
    };
  }, [activeSymbol, enriched]);

  // Load from localStorage
  useEffect(() => {
    try {
      const syms = JSON.parse(localStorage.getItem('bn_checklist_symbols') ?? '[]') as string[];
      setSavedSymbols(syms);
      if (syms.length > 0 && !activeSymbol) {
        setActiveSymbol(syms[0]);
        const saved = JSON.parse(localStorage.getItem(`bn_checks_${syms[0]}`) ?? '{}');
        setChecks(saved);
      }
    } catch {}
  }, []);

  function loadSymbol(sym: string) {
    setActiveSymbol(sym);
    try { setChecks(JSON.parse(localStorage.getItem(`bn_checks_${sym}`) ?? '{}')); } catch { setChecks({}); }
  }

  function addSymbol() {
    const s = symbol.trim().toUpperCase();
    if (!s || savedSymbols.includes(s)) return;
    const next = [...savedSymbols, s];
    setSavedSymbols(next);
    localStorage.setItem('bn_checklist_symbols', JSON.stringify(next));
    loadSymbol(s);
    setSymbol('');
  }

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    if (activeSymbol) localStorage.setItem(`bn_checks_${activeSymbol}`, JSON.stringify(next));
  }

  function removeSymbol(sym: string) {
    const next = savedSymbols.filter(s => s !== sym);
    setSavedSymbols(next);
    localStorage.setItem('bn_checklist_symbols', JSON.stringify(next));
    localStorage.removeItem(`bn_checks_${sym}`);
    if (activeSymbol === sym) { setActiveSymbol(next[0] ?? ''); setChecks({}); }
  }

  const sections = [...new Set(CHECKLIST_ITEMS.map(i => i.section))];
  const completed = CHECKLIST_ITEMS.filter(i => checks[i.id]).length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 16%, transparent)', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', color: 'var(--mc-accent)', fontWeight: '700', margin: '0 0 3px' }}>📋 Serenity Research Checklist — Framework Part V</p>
        <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: 0 }}>Complete ALL items before committing capital. Never commit more than 0.5% of portfolio without at least 5 primary source confirmations. Saved locally on your device.</p>
      </div>

      {/* Add ticker + saved tickers */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addSymbol()}
          placeholder="Add ticker… (e.g. COHR)" maxLength={10}
          style={{ flex: '0 0 160px', padding: '8px 12px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '8px', color: 'var(--mc-text-0)', fontSize: '13px', fontWeight: '600', outline: 'none' }} />
        <button onClick={addSymbol} style={{ padding: '8px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', borderRadius: '8px', color: 'var(--mc-accent)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Add</button>
        {savedSymbols.map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0', borderRadius: '8px', border: `1px solid ${activeSymbol === s ? 'color-mix(in srgb, var(--mc-accent) 38%, transparent)' : 'var(--mc-bg-4)'}`, overflow: 'hidden' }}>
            <button onClick={() => loadSymbol(s)} style={{ padding: '6px 12px', background: activeSymbol === s ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', color: activeSymbol === s ? 'var(--mc-accent)' : 'var(--mc-text-3)', fontSize: '12px', fontWeight: '700' }}>{s}</button>
            <button onClick={() => removeSymbol(s)} style={{ padding: '6px 8px', background: 'none', border: 'none', borderLeft: '1px solid var(--mc-bg-4)', cursor: 'pointer', color: 'var(--mc-text-4)', fontSize: '11px' }}>×</button>
          </div>
        ))}
      </div>

      {activeSymbol ? (
        <>
          {/* Progress bar */}
          <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{activeSymbol} — Research Progress</span>
              <span style={{ fontSize: '13px', fontWeight: '800', color: pct >= 80 ? 'var(--mc-bullish)' : pct >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)' }}>{pct}%</span>
            </div>
            <div style={{ height: '6px', backgroundColor: 'var(--mc-bg-4)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 80 ? 'var(--mc-bullish)' : pct >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)', borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: '6px 0 0' }}>{completed} of {total} items complete — {pct >= 80 ? 'Ready to size position' : pct >= 50 ? 'Making progress — keep going' : 'Do not commit capital yet'}</p>
          </div>

          {/* Checklist sections */}
          {sections.map(sec => (
            <div key={sec} style={{ marginBottom: '16px' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>{sec.toUpperCase()}</p>
              {CHECKLIST_ITEMS.filter(i => i.section === sec).map(item => {
                const auto = autoChecks[item.id];
                const isChecked = auto?.pass || checks[item.id];
                const isAuto = !!auto;
                return (
                  <div key={item.id}>
                    <button onClick={() => !isAuto && toggleCheck(item.id)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', marginBottom: isAuto && auto.note ? '0' : '4px', backgroundColor: isChecked ? 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)' : 'var(--mc-bg-1)', border: `1px solid ${isChecked ? 'color-mix(in srgb, var(--mc-bullish) 16%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: isAuto && auto.note ? '8px 8px 0 0' : '8px', cursor: isAuto ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                      {isChecked ? <CheckSquare className="w-4 h-4" style={{ color: isAuto ? '#06B6D4' : 'var(--mc-bullish)', flexShrink: 0, marginTop: '1px' }} /> : <Square className="w-4 h-4" style={{ color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '1px' }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '12px', color: isChecked ? (isAuto ? '#06B6D4' : 'var(--mc-bullish)') : 'var(--mc-text-2)', lineHeight: '1.4', textDecoration: isChecked ? 'line-through' : 'none', textDecorationColor: isAuto ? '#06B6D460' : 'color-mix(in srgb, var(--mc-bullish) 38%, transparent)' }}>{item.label}</span>
                        {isAuto && <span style={{ fontSize: '9px', color: '#06B6D4', backgroundColor: '#06B6D414', border: '1px solid #06B6D430', padding: '0 5px', borderRadius: '3px', marginLeft: '8px', fontWeight: '600' }}>AUTO</span>}
                      </div>
                    </button>
                    {isAuto && auto.note && (
                      <div style={{ padding: '6px 14px 8px 38px', backgroundColor: '#06B6D408', border: '1px solid #06B6D420', borderTop: 'none', borderRadius: '0 0 8px 8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', color: '#06B6D4' }}>{auto.note}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mc-text-4)' }}>
          <CheckSquare className="w-10 h-10" style={{ margin: '0 auto 12px', color: 'var(--mc-bg-4)' }} />
          <p style={{ fontSize: '13px' }}>Add a ticker above to start tracking your Serenity research checklist.</p>
        </div>
      )}
    </div>
  );
}
