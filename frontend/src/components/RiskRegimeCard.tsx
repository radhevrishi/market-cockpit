'use client';

// ════════════════════════════════════════════════════════════════════════════
// RiskRegimeCard (…/zzz550) — Rishi's "Risk ON / Risk OFF" playbook, LIVE, for
// BOTH the US (S&P 500) and India (NIFTY 50) markets, shown side by side atop home.
//
//   Risk ON  → index > 200-DMA AND 50-DMA > 200-DMA   (breadth confirms)
//   Risk OFF → index < 200-DMA AND 50-DMA < 200-DMA   → cash / T-bills
//   MIXED    → the two moving-average conditions disagree
//
// Verdict is driven ONLY by the moving-average trend (index vs 200-DMA + 50/200
// cross) — the robust signal. Breadth only CONFIRMS, never flips the verdict.
//
// zzz550 — trustworthy breadth:
//  • India breadth = the REAL market-breadth composite from /api/v1/breadth
//    (NSE basket, 0-100) — the same number the portal shows as "breadth NN/100".
//  • US breadth has no dedicated feed, so it is derived from the live US quote
//    universe ONLY when the sample is big enough (≥ MIN_BREADTH_N names);
//    otherwise it shows "·" (n/a) instead of a misleading ✗ off a tiny sample.
//
// Reads india+usa regime from mc:regime:v1 (above200/sma50/sma200/close). SSR-
// safe, alive-guarded, abortable, theme-tokenised. Educational, not advice.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { getQuoteMap } from '@/lib/quotes-shared';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const REGIME_KEY = 'mc:regime:v1';
const MIN_BREADTH_N = 15; // below this, a universe breadth read is too thin to trust

interface Reg { close: number | null; sma50: number | null; sma200: number | null; above200: boolean | null }
const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function toReg(u: any): Reg | null {
  if (!u) return null;
  return { close: num(u.close), sma50: num(u.sma50), sma200: num(u.sma200), above200: typeof u.above200 === 'boolean' ? u.above200 : null };
}
function readRegimes(): { india: Reg | null; usa: Reg | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const d = JSON.parse(localStorage.getItem(REGIME_KEY) || 'null')?.data;
    if (!d) return null;
    return { india: toReg(d.india), usa: toReg(d.usa) };
  } catch { return null; }
}

type Tri = true | false | null;
const triFrom = (v: number | null, hi = 55, lo = 40): Tri => (v == null ? null : v >= hi ? true : v <= lo ? false : null);

export default function RiskRegimeCard() {
  const [reg, setReg] = useState<{ india: Reg | null; usa: Reg | null } | null>(null);
  const [usBreadth, setUsBreadth] = useState<{ pct: number | null; n: number }>({ pct: null, n: 0 });
  const [indiaComposite, setIndiaComposite] = useState<number | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const cached = readRegimes();
    if (cached) setReg(cached);
    const controllers: AbortController[] = [];
    const withCtl = () => { const c = new AbortController(); controllers.push(c); setTimeout(() => c.abort(), 15000); return c; };

    if (!cached || (!cached.usa && !cached.india)) {
      const c = withCtl();
      (async () => {
        try {
          const r = await fetch('/api/market/regime', { signal: c.signal });
          if (!r.ok) return;
          const j = await r.json();
          if (aliveRef.current) setReg({ india: toReg(j?.india), usa: toReg(j?.usa) });
        } catch { /* static rules */ }
      })();
    }
    // India: REAL breadth composite (0-100) from the portal's breadth engine
    (async () => {
      const c = withCtl();
      try {
        const r = await fetch('/api/v1/breadth', { signal: c.signal });
        if (!r.ok) return;
        const j = await r.json();
        if (aliveRef.current && Number.isFinite(j?.composite)) setIndiaComposite(Number(j.composite));
      } catch { /* leave null → n/a */ }
    })();
    // US: universe breadth from the shared quote feed (gated by sample size)
    (async () => {
      try {
        const qm = await getQuoteMap(['us']);
        if (!aliveRef.current || !qm) return;
        let adv = 0, tot = 0;
        for (const q of qm.values()) {
          if (q.changePercent == null || !Number.isFinite(q.changePercent)) continue;
          tot += 1; if (q.changePercent > 0.05) adv += 1;
        }
        if (aliveRef.current) setUsBreadth({ pct: tot ? (adv / tot) * 100 : null, n: tot });
      } catch { /* n/a */ }
    })();

    const onFocus = () => { const cc = readRegimes(); if (cc && aliveRef.current) setReg(cc); };
    window.addEventListener('focus', onFocus);
    return () => { aliveRef.current = false; controllers.forEach((c) => c.abort()); window.removeEventListener('focus', onFocus); };
  }, []);

  // per-market breadth (Tri + caption)
  const usTri: Tri = usBreadth.n >= MIN_BREADTH_N ? triFrom(usBreadth.pct) : null;
  const usCap = usBreadth.n >= MIN_BREADTH_N && usBreadth.pct != null ? `US breadth ${usBreadth.pct.toFixed(0)}% adv` : null;
  const inTri: Tri = triFrom(indiaComposite);
  const inCap = indiaComposite != null ? `market breadth ${Math.round(indiaComposite)}/100` : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10, marginTop: 4 }}>
      <RegimeBlock flag="🇺🇸" title="US RISK REGIME" idxLong="S&P 500" idxShort="S&P"
        ruleIndex="SPY" secondary="QQQ" reg={reg?.usa ?? null} breadth={usTri} breadthCap={usCap} />
      <RegimeBlock flag="🇮🇳" title="INDIA RISK REGIME" idxLong="NIFTY 50" idxShort="NIFTY"
        ruleIndex="NIFTY" secondary="Nifty Midcap / Smallcap" reg={reg?.india ?? null} breadth={inTri} breadthCap={inCap} />
    </div>
  );
}

function RegimeBlock({ flag, title, idxLong, idxShort, ruleIndex, secondary, reg, breadth, breadthCap }: {
  flag: string; title: string; idxLong: string; idxShort: string; ruleIndex: string; secondary: string;
  reg: Reg | null; breadth: Tri; breadthCap: string | null;
}) {
  const above: Tri = reg ? reg.above200 : null;
  const cross: Tri = reg && reg.sma50 != null && reg.sma200 != null ? reg.sma50 > reg.sma200 : null;

  // Verdict = moving-average trend ONLY. Breadth confirms but never flips it.
  let verdict: 'ON' | 'OFF' | 'MIXED' | 'UNKNOWN' = 'UNKNOWN';
  if (above != null && cross != null) verdict = above && cross ? 'ON' : (!above && !cross ? 'OFF' : 'MIXED');
  else if (above != null || cross != null) verdict = 'MIXED';

  const tag = breadth === true ? ' · breadth confirms' : breadth === false ? ' · but breadth thin' : '';
  const V = {
    ON:      { color: 'var(--mc-bullish)', label: 'RISK ON',  sub: 'above 200-DMA + golden cross — stay invested' + tag },
    OFF:     { color: 'var(--mc-bearish)', label: 'RISK OFF', sub: 'below 200-DMA + death cross — move to cash / T-bills' },
    MIXED:   { color: 'var(--mc-warn)',    label: 'MIXED',    sub: 'trend signals disagree — tighten risk, wait for confirmation' },
    UNKNOWN: { color: 'var(--mc-text-4)',  label: '— —',      sub: 'warming up live signals…' },
  }[verdict];

  const ctx = reg && reg.close != null && reg.sma200 != null
    ? `${idxLong} ${fmt(reg.close)} vs 200-DMA ${fmt(reg.sma200)} (${pct(reg.close, reg.sma200)})`
    : null;

  return (
    <div className="mc-lift" style={{
      borderRadius: 12, padding: '13px 15px', fontFamily: MONO, minWidth: 0,
      background: `color-mix(in srgb, ${V.color} 7%, var(--mc-surface, transparent))`,
      border: `1px solid color-mix(in srgb, ${V.color} 34%, var(--mc-border))`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '1px', color: 'var(--mc-text-4)' }}>{flag} {title}</span>
        <span style={{
          fontSize: 14, fontWeight: 900, letterSpacing: '0.5px', color: V.color, padding: '2px 9px', borderRadius: 6,
          border: `1px solid color-mix(in srgb, ${V.color} 45%, transparent)`, background: `color-mix(in srgb, ${V.color} 12%, transparent)`,
        }}>{V.label}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: 'var(--mc-text-3)' }}>{V.sub}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
        <SignalChip label={`${idxShort} > 200`} state={above} />
        <SignalChip label="50 > 200" state={cross} />
        <SignalChip label="breadth" state={breadth} />
      </div>
      {ctx && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-4)' }}>
          {ctx}{breadthCap && <> · {breadthCap}</>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11, alignItems: 'start' }}>
        <RuleColumn title="RISK ON" color="var(--mc-bullish)" rows={[
          { t: `${ruleIndex} > 200-day SMA`, s: above },
          { t: `${secondary} > 200-day SMA`, s: null },
          { t: '50-day SMA > 200-day SMA', s: cross },
          { t: 'Market breadth healthy', s: breadth },
        ]} />
        <RuleColumn title="RISK OFF" color="var(--mc-bearish)" rows={[
          { t: `${ruleIndex} closes below 200-day SMA`, s: above == null ? null : !above },
          { t: 'AND 50-day SMA < 200-day SMA', s: cross == null ? null : !cross },
          { t: 'AND breadth deteriorates', s: breadth == null ? null : !breadth },
          { t: 'Move progressively into cash / T-bills', s: null, action: true },
        ]} />
      </div>
    </div>
  );
}

function SignalChip({ label, state }: { label: string; state: Tri }) {
  const c = state === true ? 'var(--mc-bullish)' : state === false ? 'var(--mc-bearish)' : 'var(--mc-text-4)';
  const mark = state === true ? '✓' : state === false ? '✗' : '·';
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 800, color: c, whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: 5,
      border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`, background: `color-mix(in srgb, ${c} 10%, transparent)`,
    }}>{mark} {label}</span>
  );
}

function RuleColumn({ title, color, rows }: { title: string; color: string; rows: Array<{ t: string; s: Tri; action?: boolean }> }) {
  return (
    <div style={{ borderRadius: 9, padding: '8px 10px', minWidth: 0, height: '100%', border: `1px solid color-mix(in srgb, ${color} 22%, var(--mc-border))`, background: `color-mix(in srgb, ${color} 4%, transparent)` }}>
      <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '0.8px', color, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((r, i) => {
          const mark = r.action ? '→' : r.s === true ? '✓' : r.s === false ? '✗' : '·';
          const markCol = r.action ? color : r.s === true ? 'var(--mc-bullish)' : r.s === false ? 'var(--mc-bearish)' : 'var(--mc-text-4)';
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 10.5 }}>
              <span style={{ color: markCol, fontWeight: 900, width: 9, flexShrink: 0 }}>{mark}</span>
              <span style={{ color: r.action ? color : 'var(--mc-text-2)', fontWeight: r.action ? 800 : 600 }}>{r.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmt(v: number): string { return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(1); }
function pct(a: number, b: number): string { if (!b) return '—'; const p = ((a - b) / b) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`; }
