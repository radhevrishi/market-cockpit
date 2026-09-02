'use client';

// ════════════════════════════════════════════════════════════════════════════
// RegimeBanner.tsx — compact top-bar widget: one tiny pill per market showing
// the current regime (BULL / PULLBACK / CORRECTION / BEAR / RECOVERY), with a
// click-to-open dropdown carrying full detail and the playbook legend.
// Caches /api/market/regime in localStorage for 20 minutes.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const CACHE_KEY = 'mc:regime:v1';
const CACHE_TTL_MS = 20 * 60 * 1000;

type RegimeKind = 'BULL' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'RECOVERY' | 'UNKNOWN';

interface MarketRegime {
  kind: RegimeKind;
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  drawdownPct: number | null;
  above200: boolean | null;
  sma20Rising: boolean | null;
  asOfTs: number | null;
  note: string;
}

interface RegimePayload { asOf?: string; india: MarketRegime; usa: MarketRegime }

const KIND_COLOR: Record<RegimeKind, string> = {
  BULL: 'var(--mc-bullish)',
  PULLBACK: 'var(--mc-cyan)',
  CORRECTION: 'var(--mc-warn)',
  BEAR: 'var(--mc-bearish)',
  RECOVERY: '#A78BFA',
  UNKNOWN: 'var(--mc-text-4)',
};

const LEGEND = 'BULL buy dips · PULLBACK classic dip-buy · CORRECTION halve size · BEAR bounce lane closed · RECOVERY post-capitulation window';

function readCache(): RegimePayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number' || !parsed.data) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data as RegimePayload;
  } catch { return null; }
}

function writeCache(data: RegimePayload) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { /* full/blocked */ }
}

function Pill({ flag, mr, onClick }: { flag: string; mr: MarketRegime; onClick: () => void }) {
  const c = KIND_COLOR[mr.kind] || KIND_COLOR.UNKNOWN;
  const title = `${mr.drawdownPct != null ? mr.drawdownPct.toFixed(1) : '—'}% off high — ${mr.note || ''}`;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4,
        color: c, cursor: 'pointer', lineHeight: 1.4,
        padding: '2px 7px', borderRadius: 5,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      {flag} {mr.kind}
    </button>
  );
}

function DetailRow({ flag, label, mr }: { flag: string; label: string; mr: MarketRegime }) {
  const c = KIND_COLOR[mr.kind] || KIND_COLOR.UNKNOWN;
  return (
    <div style={{ padding: '5px 0', borderBottom: '1px solid var(--mc-border-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10 }}>{flag}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 900, color: c, letterSpacing: 0.5 }}>{mr.kind}</span>
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-2)', fontWeight: 700, marginTop: 2, lineHeight: 1.45 }}>
        {mr.note || '—'}
      </div>
      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, marginTop: 2 }}>
        drawdown {mr.drawdownPct != null ? `${mr.drawdownPct.toFixed(1)}%` : '—'} · above 200DMA {mr.above200 == null ? '—' : mr.above200 ? 'yes' : 'no'}
      </div>
    </div>
  );
}

export default function RegimeBanner() {
  const [data, setData] = useState<RegimePayload | null>(null);
  const [openDetail, setOpenDetail] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const cached = readCache();
    if (cached) { setData(cached); return; }
    (async () => {
      try {
        const res = await fetch('/api/market/regime');
        if (!res.ok) return;
        const json = (await res.json()) as RegimePayload;
        if (!json || !json.india || !json.usa) return;
        writeCache(json);
        if (alive) setData(json);
      } catch { /* render nothing */ }
    })();
    return () => { alive = false; };
  }, []);

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!openDetail) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenDetail(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openDetail]);

  if (!data) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <Pill flag="🇮🇳" mr={data.india} onClick={() => setOpenDetail((o) => !o)} />
      <Pill flag="🇺🇸" mr={data.usa} onClick={() => setOpenDetail((o) => !o)} />
      {openDetail && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1200,
          width: 270, fontFamily: MONO,
          background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
          borderRadius: 8, padding: '8px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, color: 'var(--mc-text-3)', marginBottom: 2 }}>
            MARKET REGIME
          </div>
          <DetailRow flag="🇮🇳" label="INDIA" mr={data.india} />
          <DetailRow flag="🇺🇸" label="USA" mr={data.usa} />
          <div style={{ fontSize: 8.5, color: 'var(--mc-text-4)', fontWeight: 700, marginTop: 6, lineHeight: 1.5 }}>
            {LEGEND}
          </div>
        </div>
      )}
    </div>
  );
}
