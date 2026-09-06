'use client';

// ════════════════════════════════════════════════════════════════════════════
// RiskRegimeCard (zzz547 / zzz548) — Rishi's "Risk ON / Risk OFF" playbook, LIVE,
// for BOTH the US (SPY/QQQ) and India (NIFTY + small/mid-cap) markets.
//
//   Risk ON  → index > 200-DMA · 50-DMA > 200-DMA · breadth healthy
//   Risk OFF → index < 200-DMA AND 50-DMA < 200-DMA AND breadth deteriorating
//              → move progressively into cash / T-bills
//
// Zero new infrastructure: reads the FULL india+usa regime the RegimeBanner
// already caches (mc:regime:v1 → above200 / sma50 / sma200 / close), and computes
// breadth per market from the SHARED, deduped quote feed (getQuoteMap([mkt])).
// India breadth is naturally small/mid-cap-tilted because that is Rishi's
// universe. SSR-safe, alive-guarded, abortable, theme-tokenised; degrades to the
// static rules when data is cold. Educational, not investment advice.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { getQuoteMap, type Market } from '@/lib/quotes-shared';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const REGIME_KEY = 'mc:regime:v1';

interface Reg { close: number | null; sma50: number | null; sma200: number | null; above200: boolean | null; drawdownPct: number | null }
const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function toReg(u: any): Reg | null {
  if (!u) return null;
  return { close: num(u.close), sma50: num(u.sma50), sma200: num(u.sma200), above200: typeof u.above200 === 'boolean' ? u.above200 : null, drawdownPct: num(u.drawdownPct) };
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

export default function RiskRegimeCard() {
  const [reg, setReg] = useState<{ india: Reg | null; usa: Reg | null } | null>(null);
  const [advPct, setAdvPct] = useState<{ india: number | null; us: number | null }>({ india: null, us: null });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const cached = readRegimes();
    if (cached) setReg(cached);
    let ctl: AbortController | null = null;
    if (!cached || (!cached.usa && !cached.india)) {
      ctl = new AbortController();
      const timer = setTimeout(() => ctl?.abort(), 15000);
      (async () => {
        try {
          const r = await fetch('/api/market/regime', { signal: ctl!.signal });
          if (!r.ok) return;
          const j = await r.json();
          if (aliveRef.current) setReg({ india: toReg(j?.india), usa: toReg(j?.usa) });
        } catch { /* leave null → static rules */ }
        finally { clearTimeout(timer); }
      })();
    }
    // per-market breadth from the shared quote feed
    const breadthFor = async (mkt: Market, key: 'india' | 'us') => {
      try {
        const qm = await getQuoteMap([mkt]);
        if (!aliveRef.current || !qm || qm.size === 0) return;
        let adv = 0, tot = 0;
        for (const q of qm.values()) {
          if (q.changePercent == null || !Number.isFinite(q.changePercent)) continue;
          tot += 1; if (q.changePercent > 0.05) adv += 1;
        }
        if (tot > 0 && aliveRef.current) setAdvPct((p) => ({ ...p, [key]: (adv / tot) * 100 }));
      } catch { /* breadth stays null */ }
    };
    breadthFor('india', 'india');
    breadthFor('us', 'us');
    const onFocus = () => { const c = readRegimes(); if (c && aliveRef.current) setReg(c); };
    window.addEventListener('focus', onFocus);
    return () => { aliveRef.current = false; ctl?.abort(); window.removeEventListener('focus', onFocus); };
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10, marginTop: 4 }}>
      <RegimeBlock
        flag="🇺🇸" title="US RISK REGIME" index="SPY" secondary="QQQ"
        breadthLabel="US breadth"
        reg={reg?.usa ?? null} advPct={advPct.us}
      />
      <RegimeBlock
        flag="🇮🇳" title="INDIA RISK REGIME" index="NIFTY" secondary="Nifty Midcap / Smallcap"
        breadthLabel="small/mid-cap breadth"
        reg={reg?.india ?? null} advPct={advPct.india}
      />
    </div>
  );
}

function RegimeBlock({ flag, title, index, secondary, breadthLabel, reg, advPct }: {
  flag: string; title: string; index: string; secondary: string; breadthLabel: string;
  reg: Reg | null; advPct: number | null;
}) {
  const above: Tri = reg ? reg.above200 : null;
  const cross: Tri = reg && reg.sma50 != null && reg.sma200 != null ? reg.sma50 > reg.sma200 : null;
  const breadth: Tri = advPct == null ? null : advPct >= 55 ? true : advPct <= 40 ? false : null;

  let verdict: 'ON' | 'OFF' | 'MIXED' | 'UNKNOWN' = 'UNKNOWN';
  if (above != null || cross != null) {
    if (above === true && cross === true && breadth !== false) verdict = 'ON';
    else if (above === false && cross === false && breadth === false) verdict = 'OFF';
    else verdict = 'MIXED';
  }
  const V = {
    ON:      { color: 'var(--mc-bullish)', label: 'RISK ON',  sub: 'trend intact — stay invested' },
    OFF:     { color: 'var(--mc-bearish)', label: 'RISK OFF', sub: 'move progressively to cash / T-bills' },
    MIXED:   { color: 'var(--mc-warn)',    label: 'MIXED',    sub: 'signals disagree — tighten risk' },
    UNKNOWN: { color: 'var(--mc-text-4)',  label: '— —',      sub: 'warming up live signals…' },
  }[verdict];

  const ctx = reg && reg.close != null && reg.sma200 != null
    ? `${index} ${fmt(reg.close)} vs 200-DMA ${fmt(reg.sma200)} (${pct(reg.close, reg.sma200)})`
    : null;

  return (
    <div className="mc-lift" style={{
      borderRadius: 12, padding: '13px 15px', fontFamily: MONO,
      background: `color-mix(in srgb, ${V.color} 7%, var(--mc-surface, transparent))`,
      border: `1px solid color-mix(in srgb, ${V.color} 34%, var(--mc-border))`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '1px', color: 'var(--mc-text-4)' }}>{flag} {title}</span>
        <span style={{
          fontSize: 14, fontWeight: 900, letterSpacing: '0.5px', color: V.color, padding: '2px 9px', borderRadius: 6,
          border: `1px solid color-mix(in srgb, ${V.color} 45%, transparent)`, background: `color-mix(in srgb, ${V.color} 12%, transparent)`,
        }}>{V.label}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--mc-text-3)' }}>{V.sub}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
        <SignalChip label={`${index} > 200`} state={above} />
        <SignalChip label="50 > 200" state={cross} />
        <SignalChip label="breadth" state={breadth} />
      </div>
      {ctx && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--mc-text-4)' }}>
          {ctx}{advPct != null && <> · {breadthLabel} {advPct.toFixed(0)}% adv</>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11 }}>
        <RuleColumn title="RISK ON" color="var(--mc-bullish)" rows={[
          { t: `${index} > 200-day SMA`, s: above },
          { t: `${secondary} > 200-day SMA`, s: null },
          { t: '50-day SMA > 200-day SMA', s: cross },
          { t: 'Market breadth healthy', s: breadth },
        ]} />
        <RuleColumn title="RISK OFF" color="var(--mc-bearish)" rows={[
          { t: `${index} closes below 200-day SMA`, s: above == null ? null : !above },
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
    <div style={{ borderRadius: 9, padding: '8px 10px', border: `1px solid color-mix(in srgb, ${color} 22%, var(--mc-border))`, background: `color-mix(in srgb, ${color} 4%, transparent)` }}>
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
