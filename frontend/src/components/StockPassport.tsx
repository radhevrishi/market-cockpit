'use client';

// ════════════════════════════════════════════════════════════════════════════
// StockPassport.tsx — globally-mounted overlay showing everything every
// engine knows about one symbol: cross-engine verdict, first-class conflict
// callouts, per-engine cards, suggested size and deep links. Opened from
// anywhere via openPassport(symbol) / the PASSPORT_EVENT window event.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getEngineView, PASSPORT_EVENT } from '@/lib/engines';
import type { EngineView } from '@/lib/engines';
import { computeVerdict, VERDICT_COLOR } from '@/lib/verdict';
import { suggestSize, fmtMoney } from '@/lib/sizing';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const cardStyle: React.CSSProperties = {
  background: 'var(--mc-bg-2)',
  border: '1px solid var(--mc-border-1)',
  borderRadius: 8,
  padding: '8px 10px',
  fontFamily: MONO,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: 0.6,
  color: 'var(--mc-text-3)',
  marginBottom: 5,
  textTransform: 'uppercase' as const,
};

const rowStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--mc-text-2)',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '1px 0',
};

const linkChipStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--mc-text-2)',
  background: 'var(--mc-bg-3)',
  border: '1px solid var(--mc-border-1)',
  borderRadius: 6,
  padding: '3px 8px',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
};

function pctVs(price: number | null, ma: number | null): string | null {
  if (price == null || ma == null || ma <= 0) return null;
  const p = ((price - ma) / ma) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export default function StockPassport() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onOpen = (e: Event) => {
      const s = (e as CustomEvent)?.detail?.symbol;
      if (typeof s === 'string' && s) { setSymbol(s); setOpen(true); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener(PASSPORT_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(PASSPORT_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const view = useMemo<EngineView | null>(() => {
    if (!open || !symbol) return null;
    try { return getEngineView(symbol); } catch { return null; }
  }, [symbol, open]);

  const verdict = useMemo(() => (view ? computeVerdict(view) : null), [view]);

  const size = useMemo(() => {
    if (!verdict || !view?.tech?.price) return null;
    if (verdict.kind !== 'BUY' && verdict.kind !== 'ADD') return null;
    const price = view.tech.price;
    const sma50 = view.tech.sma50;
    let stopPct: number | null = null;
    if (sma50 != null && sma50 > 0 && sma50 < price) {
      stopPct = ((price - sma50) / price) * 100 + 2; // stop just under the 50DMA
    }
    return suggestSize({ price, stopPct: stopPct ?? 8 });
  }, [verdict, view]);

  if (!open) return null;

  const t = view?.tech || null;
  const vColor = verdict ? VERDICT_COLOR[verdict.kind] : 'var(--mc-text-4)';
  const flag = view?.market === 'IND' ? '🇮🇳' : view?.market === 'USA' ? '🇺🇸' : '';

  const upside = (() => {
    const fv = view?.valuation?.fairValue; const px = t?.price;
    if (fv == null || px == null || px <= 0) return null;
    const u = ((fv - px) / px) * 100;
    return `${u >= 0 ? '+' : ''}${u.toFixed(0)}%`;
  })();

  const notCovered: string[] = [];
  if (view) {
    if (!view.fundo) notCovered.push('Multibagger');
    if (!view.bench) notCovered.push('Conviction Bench');
    if (!view.tech) notCovered.push('Technicals');
    if (!(view.valuation && view.valuation.fairValue != null)) notCovered.push('Valuation');
    if (!view.holding) notCovered.push('Your Book');
  }

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, maxHeight: '86vh', overflowY: 'auto',
          background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
          borderRadius: 12, padding: 18, fontFamily: MONO, color: 'var(--mc-text-1)',
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.5 }}>{symbol}</span>
              {flag && <span style={{ fontSize: 15 }}>{flag}</span>}
              {view?.company && (
                <span style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                  {view.company}
                </span>
              )}
            </div>
            {view?.sector && (
              <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, marginTop: 2, letterSpacing: 0.4 }}>{view.sector}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) { setSymbol(query.trim().toUpperCase()); setQuery(''); }
                e.stopPropagation();
              }}
              placeholder="symbol ↵"
              style={{
                width: 90, fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
                background: 'var(--mc-bg-3)', border: '1px solid var(--mc-border-1)',
                borderRadius: 6, padding: '4px 7px', color: 'var(--mc-text-1)', outline: 'none',
              }}
            />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close passport"
              style={{
                fontFamily: MONO, fontSize: 13, fontWeight: 900, cursor: 'pointer',
                background: 'var(--mc-bg-3)', border: '1px solid var(--mc-border-1)',
                borderRadius: 6, padding: '3px 9px', color: 'var(--mc-text-2)',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {!view && (
          <div style={{ marginTop: 16, padding: '14px 12px', background: 'var(--mc-bg-2)', border: '1px dashed var(--mc-border-1)', borderRadius: 8, fontSize: 11.5, color: 'var(--mc-text-3)', fontWeight: 700, lineHeight: 1.5 }}>
            No engine has data on {symbol} yet — sync Technicals / Multibagger or add it to the bench.
          </div>
        )}

        {view && verdict && (
          <>
            {/* ── Verdict ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 15, fontWeight: 900, letterSpacing: 1, color: vColor,
                border: `1px solid color-mix(in srgb, ${vColor} 55%, transparent)`,
                background: `color-mix(in srgb, ${vColor} 12%, transparent)`,
                borderRadius: 8, padding: '4px 14px',
              }}>
                {verdict.kind}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-2)' }}>net {verdict.score}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-text-4)' }}>{verdict.engines} engines</span>
            </div>

            {/* ── Conflicts — first-class ── */}
            {verdict.conflicts.length > 0 && (
              <div style={{
                marginTop: 12, padding: '9px 11px',
                border: '1px solid color-mix(in srgb, var(--mc-warn) 55%, transparent)',
                background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.8, color: 'var(--mc-warn)', marginBottom: 5 }}>
                  ⚔️ CONFLICTS — ENGINES DISAGREE
                </div>
                {verdict.conflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 700, padding: '2px 0', lineHeight: 1.4 }}>
                    • {c}
                  </div>
                ))}
              </div>
            )}

            {/* ── Why chips ── */}
            {verdict.chips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                {verdict.chips.map((c, i) => (
                  <span key={i} style={{
                    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3,
                    color: 'var(--mc-text-2)', background: 'var(--mc-bg-3)',
                    border: '1px solid var(--mc-border-1)', borderRadius: 6, padding: '2px 7px',
                  }}>
                    {c}
                  </span>
                ))}
              </div>
            )}

            {/* ── Engine cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              {view.fundo && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>🚀 Multibagger</div>
                  <div style={rowStyle}><span>Score</span><span style={{ fontWeight: 800, color: 'var(--mc-text-1)' }}>{view.fundo.score != null ? Math.round(view.fundo.score) : '—'}</span></div>
                  <div style={rowStyle}><span>Grade</span><span style={{ fontWeight: 800, color: 'var(--mc-cyan)' }}>{view.fundo.grade || '—'}</span></div>
                </div>
              )}
              {view.bench && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>🏆 Conviction</div>
                  <div style={rowStyle}><span>Tier</span><span style={{ fontWeight: 800, color: 'var(--mc-accent)' }}>{view.bench.tier || '—'}</span></div>
                  <div style={rowStyle}><span>Composite</span><span style={{ fontWeight: 800 }}>{view.bench.score != null ? Math.round(view.bench.score) : '—'}</span></div>
                  <div style={rowStyle}><span>Filing</span><span style={{ color: 'var(--mc-text-3)' }}>{view.bench.filingDate || '—'}</span></div>
                </div>
              )}
              {view.decay && (
                <div style={{
                  ...cardStyle,
                  border: '1px solid color-mix(in srgb, var(--mc-bearish) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--mc-bearish) 7%, transparent)',
                }}>
                  <div style={{ ...cardTitleStyle, color: 'var(--mc-bearish)' }}>⚠️ Decay</div>
                  <div style={rowStyle}><span>Severity</span><span style={{ fontWeight: 900, color: 'var(--mc-bearish)', textTransform: 'uppercase' }}>{view.decay.severity}</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {view.decay.reasons.map((r, i) => (
                      <span key={i} style={{
                        fontSize: 9, fontWeight: 700, color: 'var(--mc-bearish)',
                        border: '1px solid color-mix(in srgb, var(--mc-bearish) 40%, transparent)',
                        borderRadius: 5, padding: '1px 6px',
                      }}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {t && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>📈 Technicals</div>
                  <div style={rowStyle}><span>Price</span><span style={{ fontWeight: 800, color: 'var(--mc-text-1)' }}>{t.price != null ? t.price.toFixed(1) : '—'}</span></div>
                  {pctVs(t.price, t.ema21) && <div style={rowStyle}><span>21EMA</span><span style={{ fontWeight: 700, color: (t.price! >= t.ema21!) ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pctVs(t.price, t.ema21)}</span></div>}
                  {pctVs(t.price, t.sma50) && <div style={rowStyle}><span>50DMA</span><span style={{ fontWeight: 700, color: (t.price! >= t.sma50!) ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pctVs(t.price, t.sma50)}</span></div>}
                  {pctVs(t.price, t.sma200) && <div style={rowStyle}><span>200DMA</span><span style={{ fontWeight: 700, color: (t.price! >= t.sma200!) ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pctVs(t.price, t.sma200)}</span></div>}
                  {t.rs != null && <div style={rowStyle}><span>RS</span><span style={{ fontWeight: 800, color: 'var(--mc-cyan)' }}>{Math.round(t.rs)}</span></div>}
                </div>
              )}
              {view.valuation && view.valuation.fairValue != null && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>🧮 Valuation</div>
                  <div style={rowStyle}><span>Fair value</span><span style={{ fontWeight: 800, color: 'var(--mc-text-1)' }}>{view.valuation.fairValue.toFixed(1)}</span></div>
                  {upside && <div style={rowStyle}><span>Upside</span><span style={{ fontWeight: 800, color: upside.startsWith('+') ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{upside}</span></div>}
                  {view.valuation.savedAt && <div style={rowStyle}><span>Saved</span><span style={{ color: 'var(--mc-text-4)', fontSize: 9.5 }}>{String(view.valuation.savedAt).slice(0, 10)}</span></div>}
                </div>
              )}
              {view.holding && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>💼 Your Book</div>
                  {view.holding.quantity != null && <div style={rowStyle}><span>Qty</span><span style={{ fontWeight: 800 }}>{view.holding.quantity}</span></div>}
                  {view.holding.entryPrice != null && <div style={rowStyle}><span>Entry</span><span style={{ fontWeight: 700 }}>{view.holding.entryPrice.toFixed(1)}</span></div>}
                  {view.holding.pnlPercent != null && <div style={rowStyle}><span>P&L</span><span style={{ fontWeight: 900, color: view.holding.pnlPercent >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{view.holding.pnlPercent >= 0 ? '+' : ''}{view.holding.pnlPercent.toFixed(1)}%</span></div>}
                  {view.holding.weight != null && <div style={rowStyle}><span>Weight</span><span style={{ fontWeight: 700 }}>{view.holding.weight.toFixed(1)}%</span></div>}
                </div>
              )}
            </div>

            {notCovered.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {notCovered.map((n) => (
                  <div key={n} style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, padding: '1px 2px' }}>
                    not covered — {n}
                  </div>
                ))}
              </div>
            )}

            {/* ── Suggested size ── */}
            {size && (
              <div style={{
                marginTop: 12, padding: '9px 11px',
                border: '1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)',
                background: 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)',
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.8, color: 'var(--mc-bullish)', marginBottom: 4 }}>📐 SUGGESTED SIZE</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-text-1)' }}>
                  {size.pctOfPortfolio.toFixed(1)}% of book (≈ {fmtMoney(size.value, view.market)}) · stop {size.stopPrice.toFixed(1)} (−{size.stopPct.toFixed(1)}%)
                </div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--mc-text-4)', marginTop: 3 }}>
                  risk {size.riskPct}%/trade · equity from {size.equitySource}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Footer links ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 11, borderTop: '1px solid var(--mc-border-1)' }}>
          <Link href="/cheat-entry" style={linkChipStyle}>🥷 Cheat Entry</Link>
          <Link href="/multibagger" style={linkChipStyle}>🚀 Multibagger</Link>
          <Link href="/watchlists?tab=conviction" style={linkChipStyle}>🏆 Bench</Link>
          <Link href="/position-sizing" style={linkChipStyle}>📐 Sizing</Link>
          <Link href="/valuation-calc" style={linkChipStyle}>🧮 Valuation</Link>
        </div>
      </div>
    </div>
  );
}
