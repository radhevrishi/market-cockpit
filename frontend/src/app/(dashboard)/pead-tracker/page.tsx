'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PEAD DRIFT TRACKER — post-earnings-announcement-drift scoreboard.
//
// A self-scoring feedback loop over the conviction bench: strong earnings beats
// tend to keep drifting up for weeks (PEAD). This page asks "does our PEAD
// score / tier actually predict drift?" using the earnings we've already
// graded. Drift is measured from real close_30d price history only — never
// fabricated — and names lacking price history are surfaced, not hidden.
//
// Pure presentation. Reads getConvictionList() from localStorage (client-side).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { getConvictionList, type ConvictionEntry } from '@/lib/conviction-beats';
import { peadLabel } from '@/lib/pead-score';
import {
  toDriftRow,
  sortRows,
  buildScoreboard,
  type DriftRow,
  type SortKey,
  type Agg,
  type PeadBucketKey,
} from '@/lib/pead-drift';

// ─── Token palette (CSS variables only — never hardcode hex) ────────────────
const C = {
  bg0: 'var(--mc-bg-0)',
  bg1: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  bg4: 'var(--mc-bg-4)',
  t0: 'var(--mc-text-0)',
  t1: 'var(--mc-text-1)',
  t2: 'var(--mc-text-2)',
  t3: 'var(--mc-text-3)',
  t4: 'var(--mc-text-4)',
  b1: 'var(--mc-border-1)',
  b2: 'var(--mc-border-2)',
  b3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)',
  bear: 'var(--mc-bearish)',
  warn: 'var(--mc-warn)',
  err: 'var(--mc-err)',
  info: 'var(--mc-info)',
  accent: 'var(--mc-accent)',
  cyan: 'var(--mc-cyan)',
  saffron: 'var(--mc-saffron)',
  persist: 'var(--mc-state-persistent)',
} as const;

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const TNUM = 'tabular-nums' as const;

// Sign color for a drift / return value.
function signColor(v: number | null | undefined): string {
  if (v == null) return C.t3;
  if (v > 0.0001) return C.bull;
  if (v < -0.0001) return C.bear;
  return C.t2;
}

// Token color for a PEAD score band (tokens only, no hardcoded hex).
function peadTokenColor(score: number | null): string {
  if (score == null) return C.t3;
  if (score >= 70) return C.bull;
  if (score >= 50) return C.warn;
  return C.t3;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

// ─── Sparkline (inline SVG polyline, no library) ────────────────────────────
function Sparkline({ closes }: { closes: number[] }) {
  const W = 84;
  const H = 22;
  const PAD = 2;
  if (!closes || closes.length < 2) {
    return <span style={{ color: C.t4, fontSize: 11 }}>—</span>;
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const n = closes.length;
  const pts = closes
    .map((c, i) => {
      const x = PAD + (i / (n - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (c - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = closes[n - 1] >= closes[0];
  const stroke = up ? C.bull : C.bear;
  const lastX = PAD + (W - PAD * 2);
  const lastY = PAD + (1 - (closes[n - 1] - min) / span) * (H - PAD * 2);
  return (
    <svg width={W} height={H} style={{ display: 'block' }} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={1.6} fill={stroke} />
    </svg>
  );
}

// ─── Tier chip ──────────────────────────────────────────────────────────────
function TierChip({ tier }: { tier: ConvictionEntry['tier'] }) {
  const isBB = tier === 'BLOCKBUSTER';
  const color = isBB ? C.saffron : C.info;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        color,
        border: `1px solid ${color}`,
        background: C.bg1,
        fontFamily: MONO,
        whiteSpace: 'nowrap',
      }}
    >
      {isBB ? 'BLOCKBUSTER' : 'STRONG'}
    </span>
  );
}

// ─── Stat tile ──────────────────────────────────────────────────────────────
function StatTile({
  label,
  agg,
  accent,
}: {
  label: string;
  agg: Agg;
  accent?: string;
}) {
  const empty = agg.n === 0;
  return (
    <div
      style={{
        background: C.bg2,
        border: `1px solid ${C.b1}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: C.t2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            color: C.t3,
            fontFamily: MONO,
            fontVariantNumeric: TNUM,
          }}
        >
          n={agg.n}
        </span>
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: MONO,
          fontVariantNumeric: TNUM,
          color: empty ? C.t4 : accent ?? signColor(agg.avgDrift),
          lineHeight: 1.1,
        }}
      >
        {empty ? '—' : fmtPct(agg.avgDrift)}
      </div>
      <div
        style={{
          fontSize: 11,
          color: C.t3,
          fontFamily: MONO,
          fontVariantNumeric: TNUM,
        }}
      >
        {empty ? 'no price history' : `hit rate ${agg.hitRate.toFixed(0)}%`}
      </div>
    </div>
  );
}

// ─── Sort control ───────────────────────────────────────────────────────────
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'drift', label: 'Drift' },
  { key: 'pead', label: 'PEAD' },
  { key: 'd1', label: 'Day 1' },
  { key: 'days', label: 'Days' },
];

const WINDOWS: { key: number | null; label: string }[] = [
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
  { key: null, label: 'All' },
];

// ─── Page ────────────────────────────────────────────────────────────────────
export default function PeadTrackerPage() {
  const [entries, setEntries] = useState<ConvictionEntry[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('drift');
  const [windowDays, setWindowDays] = useState<number | null>(null);

  // SSR-safe: read the client-side bench only after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const load = () => {
      try {
        setEntries(getConvictionList());
      } catch {
        setEntries([]);
      }
    };
    load();
    // Re-read if the bench changes elsewhere in the app.
    const onStorage = () => load();
    window.addEventListener('storage', onStorage);
    window.addEventListener('conviction-beats-changed', onStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('conviction-beats-changed', onStorage as EventListener);
    };
  }, []);

  const allRows: DriftRow[] = useMemo(() => {
    if (!entries) return [];
    const now = new Date();
    return entries
      .filter((e) => !!e.filing_date)
      .map((e) => toDriftRow(e, now));
  }, [entries]);

  const windowRows: DriftRow[] = useMemo(() => {
    if (windowDays == null) return allRows;
    return allRows.filter((r) => r.daysSince <= windowDays);
  }, [allRows, windowDays]);

  const sortedRows = useMemo(() => sortRows(windowRows, sortKey), [windowRows, sortKey]);
  const board = useMemo(() => buildScoreboard(windowRows), [windowRows]);

  const loading = entries === null;
  const empty = !loading && allRows.length === 0;

  return (
    <div
      style={{
        background: C.bg0,
        minHeight: '100vh',
        color: C.t0,
        padding: '20px 24px 48px',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              margin: 0,
              color: C.t0,
              letterSpacing: -0.2,
            }}
          >
            PEAD Drift Tracker
          </h1>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.6,
              color: C.cyan,
              fontFamily: MONO,
              border: `1px solid ${C.b2}`,
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            SELF-SCORING
          </span>
        </div>
        <p
          style={{
            fontSize: 12.5,
            color: C.t2,
            margin: '0 0 18px',
            maxWidth: 720,
            lineHeight: 1.5,
          }}
        >
          Post-earnings-announcement drift: strong beats tend to keep drifting for
          weeks. This scoreboard checks whether our PEAD score and tier actually
          predict drift across the earnings already on the conviction bench — drift
          is measured from real price history only, never fabricated.
        </p>

        {/* Controls */}
        {!loading && !empty && (
          <div
            style={{
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 18,
            }}
          >
            <ControlGroup label="Window">
              {WINDOWS.map((w) => (
                <SegBtn
                  key={String(w.key)}
                  active={windowDays === w.key}
                  onClick={() => setWindowDays(w.key)}
                >
                  {w.label}
                </SegBtn>
              ))}
            </ControlGroup>
            <ControlGroup label="Sort">
              {SORTS.map((s) => (
                <SegBtn
                  key={s.key}
                  active={sortKey === s.key}
                  onClick={() => setSortKey(s.key)}
                >
                  {s.label}
                </SegBtn>
              ))}
            </ControlGroup>
            <div
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: C.t3,
                fontFamily: MONO,
                fontVariantNumeric: TNUM,
              }}
            >
              {board.total} graded · {board.overall.n} with drift
              {board.awaiting > 0 && (
                <span style={{ color: C.warn }}>
                  {' '}· {board.awaiting} awaiting price history
                </span>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              color: C.t3,
              fontSize: 13,
              padding: '48px 0',
              textAlign: 'center',
              fontFamily: MONO,
            }}
          >
            Loading conviction bench…
          </div>
        )}

        {/* Empty */}
        {empty && (
          <div
            style={{
              border: `1px dashed ${C.b2}`,
              borderRadius: 10,
              padding: '40px 24px',
              textAlign: 'center',
              background: C.bg1,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: C.t1, marginBottom: 6 }}>
              No graded earnings on your bench yet
            </div>
            <div style={{ fontSize: 12.5, color: C.t3 }}>
              Grade some in Earnings Opportunities to start scoring PEAD drift.
            </div>
          </div>
        )}

        {/* Scoreboard + table */}
        {!loading && !empty && (
          <>
            {/* Aggregate scoreboard */}
            <SectionTitle>Scoreboard</SectionTitle>

            {/* By tier */}
            <SubLabel>Average drift by tier — does higher tier drift more?</SubLabel>
            <div style={tileGrid}>
              <StatTile label="Overall" agg={board.overall} />
              <StatTile
                label="Blockbuster"
                agg={board.byTier.BLOCKBUSTER}
                accent={board.byTier.BLOCKBUSTER.n ? undefined : C.t4}
              />
              <StatTile label="Strong" agg={board.byTier.STRONG} />
            </div>

            {/* By PEAD bucket */}
            <SubLabel>Average drift by PEAD score — does high PEAD pay?</SubLabel>
            <div style={tileGrid}>
              <StatTile label="PEAD ≥ 70" agg={board.byBucket.high} />
              <StatTile label="PEAD 50–69" agg={board.byBucket.mid} />
              <StatTile label="PEAD < 50" agg={board.byBucket.low} />
              <StatTile label="Unscored" agg={board.byBucket.unscored} />
            </div>

            {/* Per-name table */}
            <SectionTitle>Per-name drift</SectionTitle>
            <div
              style={{
                border: `1px solid ${C.b1}`,
                borderRadius: 10,
                overflow: 'hidden',
                overflowX: 'auto',
                background: C.bg1,
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  minWidth: 760,
                }}
              >
                <thead>
                  <tr style={{ background: C.bg3 }}>
                    <Th>Name</Th>
                    <Th>Filed</Th>
                    <Th align="right">Days</Th>
                    <Th>Tier</Th>
                    <Th align="right">PEAD</Th>
                    <Th align="right">Day 1</Th>
                    <Th align="right">Drift</Th>
                    <Th align="center">30d closes</Th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => (
                    <tr
                      key={r.ticker + i}
                      style={{
                        borderTop: `1px solid ${C.b1}`,
                        background: i % 2 ? C.bg1 : C.bg2,
                      }}
                    >
                      {/* Name */}
                      <Td>
                        <div
                          style={{
                            fontWeight: 700,
                            fontFamily: MONO,
                            color: C.t0,
                            fontSize: 12.5,
                          }}
                        >
                          {r.ticker}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: C.t3,
                            maxWidth: 190,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.company}
                        </div>
                      </Td>
                      {/* Filed */}
                      <Td>
                        <span
                          style={{
                            fontFamily: MONO,
                            fontVariantNumeric: TNUM,
                            color: C.t2,
                            fontSize: 11.5,
                          }}
                        >
                          {r.entry.filing_date}
                        </span>
                      </Td>
                      {/* Days */}
                      <Td align="right">
                        <span
                          style={{
                            fontFamily: MONO,
                            fontVariantNumeric: TNUM,
                            color: C.t2,
                          }}
                        >
                          {r.daysSince}d
                        </span>
                      </Td>
                      {/* Tier */}
                      <Td>
                        <TierChip tier={r.tier} />
                      </Td>
                      {/* PEAD */}
                      <Td align="right">
                        {r.peadScore == null ? (
                          <span style={{ color: C.t4, fontFamily: MONO }}>—</span>
                        ) : (
                          <span
                            style={{
                              fontFamily: MONO,
                              fontVariantNumeric: TNUM,
                              fontWeight: 700,
                              color: peadTokenColor(r.peadScore),
                            }}
                            title={peadLabel(r.peadScore)}
                          >
                            {Math.round(r.peadScore)}
                          </span>
                        )}
                      </Td>
                      {/* Day 1 */}
                      <Td align="right">
                        <span
                          style={{
                            fontFamily: MONO,
                            fontVariantNumeric: TNUM,
                            color: signColor(r.d1),
                          }}
                        >
                          {fmtPct(r.d1)}
                        </span>
                      </Td>
                      {/* Drift */}
                      <Td align="right">
                        {r.hasDrift ? (
                          <span
                            style={{
                              fontFamily: MONO,
                              fontVariantNumeric: TNUM,
                              fontWeight: 700,
                              color: signColor(r.drift),
                            }}
                            title={r.driftSource === 'move' ? 'Proxy: cumulative move since filing, net of the day-1 reaction (no 30d close series yet)' : 'From the 30-day close series'}
                          >
                            {r.driftSource === 'move' ? '≈' : ''}{fmtPct(r.drift)}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              color: C.warn,
                              fontFamily: MONO,
                            }}
                            title="No close_30d price history yet"
                          >
                            no data
                          </span>
                        )}
                      </Td>
                      {/* Sparkline */}
                      <Td align="center">
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <Sparkline closes={r.closes} />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Honesty footer */}
            <div
              style={{
                marginTop: 12,
                fontSize: 11,
                color: C.t3,
                lineHeight: 1.5,
                fontFamily: MONO,
              }}
            >
              Drift = last close ÷ first close since filing − 1, from close_30d.
              Only names with ≥2 price points count toward the scoreboard averages;
              {board.awaiting > 0 ? (
                <span style={{ color: C.warn }}>
                  {' '}{board.awaiting} name{board.awaiting === 1 ? '' : 's'} awaiting
                  price history {board.awaiting === 1 ? 'is' : 'are'} excluded.
                </span>
              ) : (
                <span> every graded name has price history in this window.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Small presentational primitives ────────────────────────────────────────
const tileGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
  marginBottom: 18,
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: C.t1,
        margin: '20px 0 10px',
        letterSpacing: 0.2,
      }}
    >
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: C.t3, margin: '0 0 8px', fontStyle: 'italic' }}>
      {children}
    </div>
  );
}

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 10.5,
          color: C.t3,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          border: `1px solid ${C.b1}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 11px',
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: MONO,
        cursor: 'pointer',
        border: 'none',
        background: active ? C.accent : C.bg2,
        color: active ? C.bg0 : C.t2,
        transition: 'background 120ms',
      }}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '9px 12px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: C.t3,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '8px 12px',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}
