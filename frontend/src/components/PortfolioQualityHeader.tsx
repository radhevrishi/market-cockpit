'use client';

// ════════════════════════════════════════════════════════════════════════════
// PortfolioQualityHeader.tsx — book-level fundamental quality score
// ────────────────────────────────────────────────────────────────────────────
// Reads the user's holdings from localStorage['mc_portfolio_holdings'], joins
// each to the Conviction bench (by uppercase ticker) to pull fundamentals, and
// rolls the covered names up into a single "book quality" score with a row of
// supporting tiles.
//
// Honest by construction: quality is only measured over holdings that are on
// the Conviction bench — everything else lacks fundamentals here, so it is
// excluded from the medians/percentages and called out in the caption.
//
// SSR-safe: all reads happen inside an effect, guarded on typeof window.
// Refreshes on 'conviction-beats:updated' + 'storage'.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getConvictionList } from '@/lib/conviction-beats';
import type { ConvictionEntry } from '@/lib/conviction-beats';
import { assessDecay } from '@/lib/cb-decay';
import type { DecayInput } from '@/lib/cb-decay';

const C = {
  bg: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)',
  border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)',
  text2: 'var(--mc-text-2)',
  muted: 'var(--mc-text-3)',
  dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)',
  red: 'var(--mc-bearish)',
  amber: 'var(--mc-warn)',
  cyan: 'var(--mc-cyan)',
  accent: 'var(--mc-accent)',
};

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const HOLDINGS_KEY = 'mc_portfolio_holdings';

interface Holding {
  symbol: string;
}

interface Covered {
  symbol: string;
  entry: ConvictionEntry;
}

interface Metrics {
  totalHoldings: number;
  coveredCount: number;
  coveragePct: number;      // % of holdings that are graded (on the bench)
  medianRoce: number | null;
  cashBackedPct: number | null;   // % of covered with CFO/PAT ≥ 0.8
  strongPct: number | null;       // % of covered that are BLOCKBUSTER/STRONG
  deterioratingCount: number;     // held names flagged by assessDecay
  bookQuality: number | null;     // composite 0–100
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function readHoldings(): Holding[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HOLDINGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((h) => h && typeof h.symbol === 'string' && h.symbol.trim())
      .map((h) => ({ symbol: String(h.symbol) }));
  } catch {
    return [];
  }
}

function cfoPatOf(e: ConvictionEntry & { cfo_to_pat_ratio?: number | null }): number | null {
  let v = num(e.cfo_to_pat_ratio);
  if (v == null && Array.isArray(e.annual_cfo_pat) && e.annual_cfo_pat.length) {
    v = num(e.annual_cfo_pat[e.annual_cfo_pat.length - 1]);
  }
  return v;
}

function compute(): Metrics {
  const holdings = readHoldings();
  const bench = getConvictionList();
  const byTicker = new Map<string, ConvictionEntry>();
  for (const e of bench) byTicker.set(String(e.ticker).toUpperCase(), e);

  const covered: Covered[] = [];
  for (const h of holdings) {
    const e = byTicker.get(h.symbol.toUpperCase());
    if (e) covered.push({ symbol: h.symbol, entry: e });
  }

  const totalHoldings = holdings.length;
  const coveredCount = covered.length;
  const coveragePct = totalHoldings ? (coveredCount / totalHoldings) * 100 : 0;

  const roces = covered.map((c) => num(c.entry.roce)).filter((v): v is number => v != null);
  const medianRoce = median(roces);

  const cfoVals = covered.map((c) => cfoPatOf(c.entry)).filter((v): v is number => v != null);
  const cashBackedPct = cfoVals.length ? (cfoVals.filter((v) => v >= 0.8).length / cfoVals.length) * 100 : null;

  const strongCount = covered.filter((c) => c.entry.tier === 'BLOCKBUSTER' || c.entry.tier === 'STRONG').length;
  const strongPct = coveredCount ? (strongCount / coveredCount) * 100 : null;

  const deterioratingCount = covered.filter((c) => assessDecay(c.entry as DecayInput) != null).length;

  // ── composite book quality (0–100) ─────────────────────────────────────────
  // Simple documented blend over the covered book. Each sub-component is
  // normalised to 0–100, then weighted. Components with no data are dropped and
  // the remaining weights renormalised so a thin book is not unfairly punished.
  //   • ROCE quality   30% — median ROCE mapped 0%→0, 25%+→100
  //   • Cash-backed    25% — % of covered with CFO/PAT ≥ 0.8
  //   • Tier strength  20% — % BLOCKBUSTER/STRONG
  //   • Coverage       15% — % of the book that is actually graded
  //   • Health         10% — 100 minus % of covered flagged deteriorating
  const parts: Array<{ w: number; v: number }> = [];
  if (medianRoce != null) parts.push({ w: 0.30, v: Math.max(0, Math.min(100, (medianRoce / 25) * 100)) });
  if (cashBackedPct != null) parts.push({ w: 0.25, v: cashBackedPct });
  if (strongPct != null) parts.push({ w: 0.20, v: strongPct });
  if (coveredCount > 0) parts.push({ w: 0.15, v: coveragePct });
  if (coveredCount > 0) parts.push({ w: 0.10, v: 100 - (deterioratingCount / coveredCount) * 100 });

  let bookQuality: number | null = null;
  if (parts.length) {
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    bookQuality = Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / wsum);
  }

  return {
    totalHoldings,
    coveredCount,
    coveragePct,
    medianRoce,
    cashBackedPct,
    strongPct,
    deterioratingCount,
    bookQuality,
  };
}

const QUALITY_TIP =
  'Book quality (0–100) blends, over holdings on your Conviction bench: ' +
  'median ROCE 30% (0%→0, 25%+→100), % cash-backed CFO/PAT≥0.8 25%, ' +
  '% BLOCKBUSTER/STRONG 20%, bench coverage 15%, and health ' +
  '(100 − % flagged deteriorating) 10%. Missing components are dropped and ' +
  'weights renormalised.';

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`;
}
function fmtRoce(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

function qualityColor(q: number | null): string {
  if (q == null) return C.muted;
  if (q >= 70) return C.green;
  if (q >= 45) return C.amber;
  return C.red;
}

function Tile(props: { label: string; value: string; sub?: string; color?: string; tip?: string }) {
  return (
    <div
      title={props.tip}
      style={{
        flex: '1 1 96px',
        minWidth: 96,
        background: C.bg2,
        border: '1px solid ' + C.border,
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3, color: C.muted, textTransform: 'uppercase' }}>
        {props.label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: props.color || C.text, lineHeight: 1.1 }}>
        {props.value}
      </div>
      {props.sub && <div style={{ fontSize: 8.5, color: C.dim }}>{props.sub}</div>}
    </div>
  );
}

export function PortfolioQualityHeader() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const refresh = () => setM(compute());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener('conviction-beats:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('conviction-beats:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const card: React.CSSProperties = {
    background: C.bg,
    border: '1px solid ' + C.border,
    borderRadius: 8,
    padding: '12px 14px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  };

  if (!m) {
    return (
      <div style={card}>
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Loading book quality…</div>
      </div>
    );
  }

  if (m.totalHoldings === 0) {
    return (
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: C.cyan, textTransform: 'uppercase', marginBottom: 4 }}>
          📊 Book quality
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
          No holdings yet — add positions to your portfolio to grade the book.
        </div>
      </div>
    );
  }

  const qColor = qualityColor(m.bookQuality);

  return (
    <div style={card}>
      {/* ── header row: composite score ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: C.cyan, textTransform: 'uppercase' }}>
            📊 Book quality
          </div>
          <div style={{ fontSize: 9, color: C.dim, marginTop: 1 }}>
            {m.coveredCount}/{m.totalHoldings} holdings graded
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div title={QUALITY_TIP} style={{ textAlign: 'right', cursor: 'help' }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: qColor, lineHeight: 1 }}>
            {m.bookQuality == null ? '—' : m.bookQuality}
            <span style={{ fontSize: 12, color: C.dim, fontWeight: 700 }}> /100</span>
          </div>
          <div style={{ fontSize: 8.5, color: C.dim, letterSpacing: 0.3 }}>composite ⓘ</div>
        </div>
      </div>

      {/* ── tiles ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Tile
          label="Coverage"
          value={fmtPct(m.coveragePct)}
          sub={`${m.coveredCount} on bench`}
          color={C.text}
          tip="Share of your holdings that are on the Conviction bench and therefore graded."
        />
        <Tile
          label="Median ROCE"
          value={fmtRoce(m.medianRoce)}
          sub="covered names"
          color={m.medianRoce != null && m.medianRoce >= 15 ? C.green : C.text}
          tip="Median return on capital employed across covered holdings."
        />
        <Tile
          label="Cash-backed"
          value={fmtPct(m.cashBackedPct)}
          sub="CFO/PAT ≥ 0.8"
          color={m.cashBackedPct != null && m.cashBackedPct >= 60 ? C.green : C.text}
          tip="Share of covered holdings whose cash flow from operations backs at least 80% of reported profit."
        />
        <Tile
          label="Blockbuster / Strong"
          value={fmtPct(m.strongPct)}
          sub="tier mix"
          color={m.strongPct != null && m.strongPct >= 50 ? C.accent : C.text}
          tip="Share of covered holdings graded BLOCKBUSTER or STRONG on the bench."
        />
        <Tile
          label="Deteriorating"
          value={String(m.deterioratingCount)}
          sub="held & decaying"
          color={m.deterioratingCount > 0 ? C.red : C.green}
          tip="Held names currently flagged by the decay watch (margins, cash, growth or drift rolling over)."
        />
      </div>

      {/* ── honest caption ──────────────────────────────────────────────────── */}
      <div style={{ fontSize: 9, color: C.dim, marginTop: 8, lineHeight: 1.4 }}>
        Quality is measured only over the {m.coveredCount} holding{m.coveredCount === 1 ? '' : 's'} on your
        Conviction bench{m.coveredCount < m.totalHoldings ? ` — the other ${m.totalHoldings - m.coveredCount} lack fundamentals here and are excluded.` : '.'}
      </div>
    </div>
  );
}

export default PortfolioQualityHeader;
