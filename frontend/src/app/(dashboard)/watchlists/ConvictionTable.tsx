'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { newInfoScore, newInfoWord } from '@/lib/cb-new-info';
import { type ConvictionEntry } from '@/lib/conviction-beats';
import { peadScore, peadColor } from '@/lib/pead-score';
import { resolveSector, filingAgeDays, deriveGuidanceLabel, cbIsFinancial, cbComputeQuality, cbCashView, cbVerdictLabel, cbPeadWord } from '@/lib/conviction-filter-india';
import { cbStrengthWord, cbQualityWord, cbQualityBitWord, cbGrowthText, cbCompany, qTrendsState, tierNowLabel, cbIsRemoved } from '@/lib/india-cb-view';
import { openPassport } from '@/lib/engines';
import { __cbFillRunning } from './ConvictionBeatsPanel';
import { sectorColor } from './constants';
import { cbDriftState } from './helpers';

// zzz254 — Mini progress bar for Composite / PEAD scores. Fixed 40px wide.
// Colored by tier band: red < 50, amber 50-70, green >= 70.
export function MiniBar({ value, width = 40, height = 5, invert = false }: { value: number | null | undefined; width?: number; height?: number; invert?: boolean }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(100, value));
  const color = invert
    ? (clamped >= 70 ? 'var(--mc-bearish)' : clamped >= 40 ? '#F59E0B' : 'var(--mc-bullish)')
    : (clamped >= 70 ? 'var(--mc-bullish)' : clamped >= 50 ? '#F59E0B' : 'var(--mc-bearish)');
  return (
    <div style={{ width, height, backgroundColor: 'var(--mc-bg-3)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${clamped}%`, height: '100%', backgroundColor: color }} />
    </div>
  );
}

// zzz254 — Prominent tier badge pill (top-right of card). Filled color, high-contrast.
export function TierPill({ tier }: { tier: string }) {
  const isBB = tier === 'BLOCKBUSTER';
  const bg = isBB ? '#F59E0B' : '#10B981';
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 800, letterSpacing: '0.6px',
      padding: '2px 6px', borderRadius: 3, background: bg, color: '#0B1220',
      fontFamily: 'ui-sans-serif, system-ui', whiteSpace: 'nowrap',
    }}>{isBB ? 'BLOCKBUSTER' : 'STRONG'}</span>
  );
}

// zzz251 — DRIFT PATH mini-chart. zzz254 — expanded with tick-value labels
// below each dot so analyst reads exact %s without hovering.
export function DriftPath({ entry, width = 130, height = 26, showLabels = true }: { entry: any; width?: number; height?: number; showLabels?: boolean }) {
  const raw = [
    { label: 'Gap', v: typeof entry.gap_pct === 'number' && Number.isFinite(entry.gap_pct) ? entry.gap_pct : null },
    { label: 'D1', v: typeof entry.d1_pct === 'number' && Number.isFinite(entry.d1_pct) ? entry.d1_pct : null },
    { label: 'D2', v: typeof entry.d2_pct === 'number' && Number.isFinite(entry.d2_pct) ? entry.d2_pct : null },
    { label: 'Now', v: typeof entry.move_pct === 'number' && Number.isFinite(entry.move_pct) ? entry.move_pct : null },
  ];
  const pts = raw.filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.v as number);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const step = width / (raw.length - 1);
  // Build path only for populated points, but use original index for X positioning
  const coords = raw.map((p, i) => p.v == null ? null : ({
    x: i * step,
    y: height - ((p.v - min) / range) * height,
    v: p.v,
    label: p.label,
  })).filter((c): c is NonNullable<typeof c> => c != null);
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const first = vals[0], last = vals[vals.length - 1];
  const up = last >= first;
  const color = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  const zeroY = height - ((0 - min) / range) * height;
  const tip = pts.map((p) => `${p.label}: ${(p.v as number) >= 0 ? '+' : ''}${(p.v as number).toFixed(1)}%`).join(' · ');
  const labelH = showLabels ? 12 : 0;
  return (
    <svg width={width} height={height + labelH} style={{ display: 'block', overflow: 'visible' }} aria-label="Post-earnings drift trajectory">
      <title>DRIFT PATH: {tip}</title>
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="var(--mc-text-4)" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.4" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2 : 1.5} fill={c.v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
      ))}
      {/* zzz254 — value labels under each dot */}
      {showLabels && raw.map((p, i) => (
        <text key={i} x={i * step} y={height + 10} textAnchor={i === 0 ? 'start' : i === raw.length - 1 ? 'end' : 'middle'}
          style={{ fontSize: 9, fill: p.v == null ? 'var(--mc-text-4)' : (p.v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'), fontFamily: 'ui-monospace, monospace', opacity: 1, fontWeight: 600 }}>
          {p.v == null ? '—' : `${p.v >= 0 ? '+' : ''}${p.v.toFixed(1)}`}
        </text>
      ))}
    </svg>
  );
}

// zzz247 — Institutional table view. Sortable columns for analysts who want to
// scan 42+ rows in 3 seconds. Same filter set, denser layout.
export function ConvictionTable({ entries, onRemove, sort, setSort, renderMark, dimOf }: {
  entries: ConvictionEntry[]; onRemove: (t: string) => void;
  sort: { col: string; dir: 'asc'|'desc' }; setSort: (s: { col: string; dir: 'asc'|'desc' }) => void;
  /** zzz1041 — the Bought · Watchlist · Rejected control for a row (its own column). */
  renderMark?: (e: ConvictionEntry) => React.ReactNode;
  /** zzz1041 — rows shown greyed (marked Rejected). */
  dimOf?: (e: ConvictionEntry) => boolean;
}) {
  const cols: Array<{ key: string; label: string; align?: string; get: (e: any) => any }> = [
    { key: 'tier',      label: 'Tier',    get: (e) => e.tier === 'BLOCKBUSTER' ? 1 : 0 },
    { key: 'ticker',    label: 'Ticker',  get: (e) => e.ticker || '' },
    { key: 'company',   label: 'Company', get: (e) => e.company || '' },
    { key: 'filed',     label: 'Filed',   get: (e) => e.filing_date || '' },
    { key: 'sector',    label: 'Sector',  get: (e) => resolveSector(e) || '' },
    { key: 'mcap',      label: 'MktCap',  align: 'right', get: (e) => e.market_cap_cr ?? 0 },
    { key: 'newinfo',   label: 'New info', align: 'right', get: (e) => newInfoScore(e).score },   // zzz887
    { key: 'composite', label: 'Strength', align: 'right', get: (e) => e.composite_score ?? 0 },
    { key: 'pead',      label: 'Drift',   align: 'right', get: (e) => peadScore(e).score },
    { key: 'sales',     label: 'Sales',   align: 'right', get: (e) => e.sales_yoy_pct ?? -999 },
    { key: 'pat',       label: 'PAT',     align: 'right', get: (e) => e.net_profit_yoy_pct ?? -999 },
    { key: 'eps',       label: 'EPS',     align: 'right', get: (e) => e.eps_yoy_pct ?? -999 },
    { key: 'opm',       label: 'OPM',     align: 'right', get: (e) => e.opm_pct ?? -999 },
    { key: 'pe',        label: 'P/E',     align: 'right', get: (e) => e.pe ?? Infinity },
    { key: 'd1',        label: 'D1',      align: 'right', get: (e) => e.d1_pct ?? -999 },
    { key: 'drift',     label: 'DRIFT',   align: 'right', get: (e) => e.move_pct ?? -999 },
  ];
  const sorted = [...entries].sort((a, b) => {
    const c = cols.find((c) => c.key === sort.col);
    if (!c) return 0;
    const av = c.get(a), bv = c.get(b);
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const onSort = (col: string) => {
    if (sort.col === col) setSort({ col, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col, dir: 'desc' });
  };
  const fmtPct = (v: any) => typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
  const fmtNum = (v: any) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
  const fmtMcap = (v: any) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? (v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${(v/1000).toFixed(1)}k` : `₹${Math.round(v)}`) : '—';
  const pctColor = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? (v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)') : 'var(--mc-text-4)';
  const arrow = (c: string) => sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const th = { fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', cursor: 'pointer', letterSpacing: '0.3px', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, userSelect: 'none' as const };
  const td = { fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as any };
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-sans-serif, system-ui' }}>
        <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--mc-bg-1)', zIndex: 1 }}>
          <tr>
            {cols.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)} style={{ ...th, textAlign: (c.align as any) || 'left' }} title={`Sort by ${c.label}`}>
                {c.label}{arrow(c.key)}
              </th>
            ))}
            {renderMark && <th style={{ ...th, cursor: 'default' }}>Your mark</th>}
            <th style={{ ...th, textAlign: 'center' }}>·</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
            const tierLbl = e.tier === 'BLOCKBUSTER' ? '⭐' : '🟢';
            return (
              <tr key={e.ticker + (e.filing_date || '')} style={{ transition: 'background 0.1s', ...(cbIsRemoved(e) ? { opacity: 0.45 } : {}), ...(dimOf?.(e) ? { opacity: 0.45, filter: 'grayscale(0.85)' } : {}) }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--mc-bg-2)'; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <td style={{ ...td, color: tierColor, fontWeight: 800 }}>{tierLbl}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                  {e.source_url ? (
                    <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-text-2)', textDecoration: 'none', borderBottom: '1px dotted var(--mc-text-4)' }}>{e.ticker}</a>
                  ) : e.ticker}
                </td>
                <td style={{ ...td, color: 'var(--mc-text-1)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cbCompany(e)}{tierNowLabel(e) ? <span style={{ color: '#F59E0B', fontWeight: 700 }}> · {tierNowLabel(e)}</span> : null}</td>
                <td style={{ ...td, color: 'var(--mc-text-3)' }}>{e.filing_date || '—'}</td>
                <td style={{ ...td, color: 'var(--mc-text-3)' }}>{resolveSector(e) || '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--mc-text-3)' }}>{fmtMcap((e as any).market_cap_cr)}</td>
                {(() => { const ni = newInfoScore(e as any); return (
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: ni.score >= 40 ? 'var(--mc-bullish)' : ni.score >= 25 ? 'var(--mc-text-1)' : 'var(--mc-text-4)', cursor: 'help' }}
                    title={`Why this rank: ${ni.why}\n\n${ni.parts.map((p) => `${p.points >= 0 ? '+' : ''}${p.points}  ${p.text}`).join('\n')}`}>
                    {newInfoWord(ni.score)} {ni.score}{ni.price === 'CONFIRMS' ? ' ✓' : ni.price === 'FADED' ? ' ✗' : ''}
                  </td>); })()}
                <td style={{ ...td, textAlign: 'right', color: tierColor, fontWeight: 800 }}>{cbStrengthWord(e.composite_score)}</td>
                <td style={{ ...td, textAlign: 'right', color: peadColor(peadScore(e).score), fontWeight: 700 }}>{cbPeadWord(peadScore(e).score)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.sales_yoy_pct) }}>{cbGrowthText(e.sales_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.net_profit_yoy_pct) }}>{cbGrowthText(e.net_profit_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor(e.eps_yoy_pct) }}>{cbGrowthText(e.eps_yoy_pct)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{typeof (e as any).opm_pct === 'number' ? `${(e as any).opm_pct.toFixed(1)}%` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--mc-text-2)' }}>{fmtNum((e as any).pe) === '—' ? '—' : fmtNum((e as any).pe) + 'x'}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor((e as any).d1_pct) }}>{fmtPct((e as any).d1_pct)}</td>
                <td style={{ ...td, textAlign: 'right', color: pctColor((e as any).move_pct), fontWeight: 700 }}>{fmtPct((e as any).move_pct)}</td>
                {renderMark && <td style={{ ...td, padding: '3px 8px' }}>{renderMark(e)}</td>}
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={() => onRemove(e.ticker)} title="Remove"
                    style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: 0, fontSize: 13 }}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ConvictionRow({ entry, onRemove, density = 'comfy', radarEntry, markSlot, markBadge, dimmed }: { entry: ConvictionEntry; onRemove: (t: string) => void; density?: 'comfy'|'compact'|'ultra'; radarEntry?: any;
  /** zzz1041 — Bought · Watchlist · Rejected control (bottom of the card), its badge (top-right) and the greyed look for Rejected. */
  markSlot?: React.ReactNode; markBadge?: React.ReactNode; dimmed?: boolean }) {
  const tierColor = entry.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  // zzz827 — growth the EO way: '>500% (low base)' instead of '+2810%'.
  const pct = (v: number | null) => cbGrowthText(v);
  // USER-REQ — PEAD chip. zzz827 — shown as a word; no 0–100 number anywhere on the card.
  const pead = peadScore(entry);
  const peadClr = peadColor(pead.score);
  const peadTip = `Post-results drift reading: ${cbPeadWord(pead.score)} — ${pead.drift_phase} phase, ${pead.days_since_filing} day${pead.days_since_filing === 1 ? '' : 's'} since filing. Built from sales, profit and EPS growth, operating leverage and the result's grade, fading with time.`;
  const tierNow = tierNowLabel(entry);
  const company = cbCompany(entry);
  return (
    <div
      onMouseEnter={(ev) => { const t = ev.currentTarget as HTMLElement; t.style.transform = 'translateY(-2px)'; t.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'; t.style.borderColor = tierColor; }}
      onMouseLeave={(ev) => { const t = ev.currentTarget as HTMLElement; t.style.transform = ''; t.style.boxShadow = ''; t.style.borderColor = 'var(--mc-bg-4)'; }}
      style={{
        padding: density === 'ultra' ? '6px 10px' : density === 'compact' ? '8px 12px' : '10px 12px',
        backgroundColor: 'var(--mc-bg-0)',
        border: '1px solid var(--mc-bg-4)', borderLeft: `3px solid ${tierColor}`,
        borderRadius: 8, display: 'flex', flexDirection: 'column', gap: density === 'ultra' ? 3 : density === 'compact' ? 5 : 6,
        transition: 'transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease',
        willChange: 'transform',
        ...(cbIsRemoved(entry) ? { opacity: 0.45, filter: 'grayscale(0.8)' } : {}),   // zzz879
        ...(dimmed ? { opacity: 0.45, filter: 'grayscale(0.85)' } : {}),   // zzz1041 — marked Rejected, shown
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: density === 'ultra' ? 12 : 13, fontWeight: 800, color: 'var(--mc-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {company}
          </div>
          {tierNow && (
            <div data-testid="cb-tier-now" title={cbIsRemoved(entry) ? "This name is not on the server's results list any more: its card was removed when the day was re-graded (for example it was graded on last quarter's numbers before the new results were out). Greyed, not deleted — remove it with ×." : "The grading engine has changed since this name was benched; under the current rules this filing grades below STRONG. It stays on your bench, labelled — remove it with × if you want it gone."}
              style={{ fontSize: 10, fontWeight: 800, color: '#F59E0B' }}>⚠ {tierNow}</div>
          )}
          <div style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--mc-text-3)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', rowGap: 2 }}>
            {entry.source_url ? (
              <a href={entry.source_url} target="_blank" rel="noreferrer" title="Open filing on NSE"
                style={{ fontWeight: 700, color: 'var(--mc-text-2)', textDecoration: 'none', borderBottom: '1px dotted var(--mc-text-4)' }}>{entry.ticker}</a>
            ) : (
              <span style={{ fontWeight: 700 }}>{entry.ticker}</span>
            )}
            {/* zzz525 — one-click Stock Passport (filing link stays untouched) */}
            <span onClick={() => openPassport(entry.ticker)} title="Open Stock Passport"
              style={{ cursor: 'pointer', fontSize: 10, opacity: 0.75 }}>🪪</span>
            <span style={{ color: 'var(--mc-text-4)' }}>·</span>
            <span style={{ whiteSpace: 'nowrap' }}>{entry.filing_date}</span>
            {(() => {
              const sec = resolveSector(entry);
              if (!sec) return null;
              const dotColor = sectorColor(sec);
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span title={sec} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />{sec}</span></>);
            })()}
            {/* zzz249 — compact mktCap: drop "₹" and " Cr" (context is clear on Indian bench) */}
            {typeof (entry as any).market_cap_cr === 'number' && Number.isFinite((entry as any).market_cap_cr) && (() => {
              const c = (entry as any).market_cap_cr as number;
              const s = c >= 100000 ? `${(c/100000).toFixed(2)}L` : c >= 1000 ? `${(c/1000).toFixed(1)}k` : `${Math.round(c)}`;
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span title={`Market cap: ₹${Math.round(c).toLocaleString('en-IN')} Cr`} style={{ whiteSpace: 'nowrap' }}>₹{s} Cr</span></>);
            })()}
            {/* zzz250 — days-since-flagged chip. Color-coded freshness. */}
            {entry.filing_date && (() => {
              const days = filingAgeDays(entry.filing_date); // zzz543 — shared formula (see filingAgeDays)
              if (days === null) return null;
              const col = days <= 3 ? 'var(--mc-bullish)' : days <= 14 ? 'var(--mc-warn)' : 'var(--mc-text-4)';
              return (<><span style={{ color: 'var(--mc-text-4)' }}>·</span><span title={`${days} day${days===1?'':'s'} since filing — freshness matters for post-earnings drift`} style={{ color: col, fontWeight: 700, whiteSpace: 'nowrap' }}>{days}d</span></>);
            })()}
          </div>
        </div>
        {/* zzz254 — right-side stack: TierPill + Composite bar + PEAD bar + × */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {markBadge}
            <TierPill tier={entry.tier} />
            <button onClick={() => onRemove(entry.ticker)} title="Remove from Conviction Beats"
              style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '2px 6px', fontSize: 15, lineHeight: 1, marginLeft: 2 }}>×</button>
          </div>
          <div title="Grade strength — how big and how clean the result was (size of growth, quality, price trend, method checks), in words."
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <MiniBar value={entry.composite_score} width={44} height={5} />
            <span style={{ fontSize: 10.5, fontWeight: 800, color: tierColor, whiteSpace: 'nowrap' }}>strength {cbStrengthWord(entry.composite_score)}</span>
          </div>
          <div title={peadTip} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'help' }}>
            <MiniBar value={pead.score} width={44} height={5} />
            <span style={{ fontSize: 10.5, fontWeight: 800, color: peadClr, whiteSpace: 'nowrap' }}>PEAD {cbPeadWord(pead.score)}</span>
          </div>
        </div>
      </div>
      {/* zzz887 — why this rank: what is NEW in this filing (guidance, acceleration, margin, cash, persistence); price only confirms */}
      {(() => { const ni = newInfoScore(entry as any); return (
        <div title={ni.parts.map((p) => `${p.points >= 0 ? '+' : ''}${p.points}  ${p.text}`).join('\n')} style={{ fontSize: 10.5, color: 'var(--mc-text-3)', lineHeight: 1.35, cursor: 'help' }}>
          <b style={{ color: ni.score >= 40 ? 'var(--mc-bullish)' : 'var(--mc-text-2)' }}>New info: {newInfoWord(ni.score)} ({ni.score})</b> — {ni.why}
        </div>); })()}
      {/* Always-visible DRIFT chip. A BLOCKBUSTER/STRONG bench name fading
          <= -12% since its print is the market fading the beat — the earliest
          sell tell. Renders without any filter toggle and is also armed to
          Book Watch (BENCH_DRIFT). Uses move_pct (no fetch needed). */}
      {(() => {
        const { drifting, movePct } = cbDriftState(entry);
        if (!drifting || movePct == null) return null;
        const critical = movePct <= -20;
        const col = critical ? '#EF4444' : '#F59E0B';
        return (
          <div>
            <span
              title={`DRIFT: ${entry.tier} bench name is ${movePct.toFixed(1)}% below its filing-day price. The market is fading the beat — the earliest sell tell. Armed to Book Watch as BENCH_DRIFT (${critical ? 'critical' : 'warning'}).`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, cursor: 'help',
                background: `${col}1A`, color: col, border: `1px solid ${col}66`, letterSpacing: '0.3px',
              }}
            >⚠ DRIFT {movePct.toFixed(1)}%</span>
          </div>
        );
      })()}
      {/* ── ADDITIVE zzzUP1 — Transformation-radar badge. Rendered when this
          bench name is also on the concall transformation screener. Styled like
          the existing chips (green). */}
      {radarEntry && (() => {
        const tscore = radarEntry.transformation_score;
        const stage = radarEntry.stage != null ? String(radarEntry.stage) : '';
        const label = radarEntry.evidence_label != null ? String(radarEntry.evidence_label) : '';
        const col = '#10B981';
        const tip = `On the concall transformation screener${stage ? ` · stage: ${stage}` : ''}`
          + (radarEntry.stage_sweet_spot ? ' (sweet spot)' : '')
          + (typeof radarEntry.pattern_count === 'number' ? ` · ${radarEntry.pattern_count} patterns` : '')
          + (radarEntry.velocity != null ? ` · velocity ${radarEntry.velocity}` : '')
          + (label ? ` · ${label}` : '');
        return (
          <div>
            <span title={tip}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, cursor: 'help',
                background: `${col}1A`, color: col, border: `1px solid ${col}66`, letterSpacing: '0.3px',
              }}
            >🚀 Radar{typeof tscore === 'number' ? ` · ${tscore >= 70 ? 'strong' : tscore >= 45 ? 'moderate' : 'early'} change` : ''}</span>
          </div>
        );
      })()}
      {/*
       * PATCH 0965 BUG #9 — "Results Pending" badge for unfiled stocks.
       *
       * Root cause: ~20+ companies (HONASA, GPIL, IOC, ABB, BERGEPAINT…)
       * land on the bench with their meta-row (ticker / sector / filing
       * date) populated, but Sales/PAT/EPS are null because Q4 FY26
       * results haven't been filed yet (board meeting announced but
       * actuals not yet published) OR screener.in enrichment hasn't
       * caught up. The previous render showed three lonely "—" cells,
       * which looked indistinguishable from "data is zero". Replace the
       * triple-dash with an explicit "Results Pending" badge with a
       * tooltip explaining the cause.
       */}
      {(() => {
        const allNull =
          (entry.sales_yoy_pct === null || entry.sales_yoy_pct === undefined) &&
          (entry.net_profit_yoy_pct === null || entry.net_profit_yoy_pct === undefined) &&
          (entry.eps_yoy_pct === null || entry.eps_yoy_pct === undefined);
        if (allNull) {
          return (
            <div>
              <span
                title="No Q4 FY26 data reported yet. Will populate when company files results."
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontStyle: 'italic',
                  padding: '2px 7px', borderRadius: 4,
                  backgroundColor: 'rgba(148,163,184,0.15)',
                  border: '1px solid rgba(148,163,184,0.35)',
                  color: 'var(--mc-text-3)', fontWeight: 600, cursor: 'help',
                }}
              >⏳ Results Pending</span>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: '6px 14px', fontSize: 10.5, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span><span style={{ color: 'var(--mc-text-4)' }}>Sales</span> <strong style={{ color: (entry.sales_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.sales_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>PAT</span> <strong style={{ color: (entry.net_profit_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.net_profit_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span><span style={{ color: 'var(--mc-text-4)' }}>EPS</span> <strong style={{ color: (entry.eps_yoy_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pct(entry.eps_yoy_pct)}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            {/* zzz223 — OPM margin chip: latest OPM % + pp delta vs prior year */}
            {typeof (entry as any).opm_pct === 'number' && (() => {
              const o = (entry as any).opm_pct as number;
              const p = (entry as any).opm_prev_pct as number | null | undefined;
              const d = typeof p === 'number' ? o - p : null;
              const col = d == null ? 'var(--mc-text-2)' : d >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              // zzz354 — explicit OPM trend classification
              const cls = d == null ? null : d >= 1 ? '🟢 EXPANDING' : d >= -1 ? '🟡 FLAT' : '🔴 CONTRACTING';
              return (
                <span title={typeof p === 'number' ? `OPM ${o.toFixed(1)}% vs ${p.toFixed(1)}% prior year — ${(d as number) >= 0 ? '+' : ''}${(d as number).toFixed(1)}pp. Trend: ${cls || 'unknown'}` : `OPM ${o.toFixed(1)}% (no prior-year value)`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>OPM</span>{' '}
                  <strong style={{ color: col }}>
                    {o.toFixed(1)}%{d != null ? ` (${d >= 0 ? '+' : ''}${d.toFixed(1)}pp)` : ''}
                  </strong>
                  {cls && <span style={{ marginLeft: 4, fontSize: 9.5, color: 'var(--mc-text-3)' }}>{cls}</span>}
                </span>
              );
            })()}
            {/* zzz304 — CFO/PAT chip. Green >= 0.8 (healthy), amber 0.5-0.8, red < 0.5.
                zzz317 — Explicitly ANNUAL CFO / ANNUAL PAT from Screener's annual
                cash-flow + P&L tables. Screener does not publish quarterly cash
                flow, so this is a multi-year quality signal — a company that
                consistently converts profit to cash over years — NOT a per-
                quarter check on the specific earnings event that triggered the
                BLOCKBUSTER/STRONG grade. Label + tooltip make the annual scope
                explicit so it isn't misread against quarterly PAT growth. */}
            {(() => {
              // zzz827 — ONE CASH FIGURE: same fiscal year CFO ÷ PAT, as the EO
              // engine builds it (cbCashView). The old chip preferred a series
              // value or the stored ratio, which on older rows was last year's
              // cash flow ÷ ONE quarter's profit (e.g. "2.66×"). Unknown → "not
              // checked"; lenders → not meaningful.
              const cv = cbCashView(entry);
              if (cv.state === 'na') {
                return (
                  <span title="Cash conversion (CFO ÷ profit) is not meaningful for lenders / NBFCs / insurers — their operating cash flow is loan growth or premiums. Skipped by the preset.">
                    <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                    <span style={{ color: 'var(--mc-text-4)' }}>CASH</span>{' '}
                    <strong style={{ color: 'var(--mc-text-4)' }}>not meaningful (lender)</strong>
                  </span>
                );
              }
              if (cv.state === 'unknown' || cv.ratio == null) {
                return (
                  <span data-testid="cb-cash-not-checked" title={`${cv.text}. The preset treats this as "not checked" — never a fail. The fill pass fetches the same-year figure.`}>
                    <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                    <span style={{ color: 'var(--mc-text-4)' }}>CASH</span>{' '}
                    <strong style={{ color: 'var(--mc-text-4)' }}>not checked</strong>
                  </span>
                );
              }
              const r = cv.ratio;
              const col = r >= 0.8 ? 'var(--mc-bullish)' : r >= 0.5 ? '#F59E0B' : 'var(--mc-bearish)';
              const tag = r < 0 ? 'operations used cash' : r >= 8 ? 'profit small vs cash' : r >= 1 ? 'cash-backed' : r >= 0.8 ? 'mostly backed' : r >= 0.5 ? 'partly backed' : 'weak cash conversion';
              return (
                <span data-testid="cb-cash" title={`Cash from operations ÷ net profit for the same fiscal year (${cv.basis}): ${r.toFixed(2)}×. Cash flow is published once a year, so this is a full-year figure, not this quarter's.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>·</span>{' '}
                  <span style={{ color: 'var(--mc-text-4)' }}>CASH</span>{' '}
                  <strong style={{ color: col }}>{r.toFixed(2)}×</strong>
                  <span style={{ color: col, opacity: 0.85 }}> {tag}</span>
                  <span style={{ color: 'var(--mc-text-4)', fontSize: 9 }}> ({cv.basis})</span>
                </span>
              );
            })()}
            {/* zzz256 — force P/E + DRIFT onto own row */}
            <span style={{ flexBasis: '100%', height: 0, margin: 0 }} />
            {/* zzz242 — trailing P/E chip. zzz251 — color-code vs SECTOR MEDIAN P/E
                (compares apples to apples). Falls back to absolute bands if no sector peers. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && (() => {
              const pval = (entry as any).pe as number;
              const secMap: Record<string, number> = (typeof window !== 'undefined' && (window as any).__cbSectorPeMed) || {};
              const secMed = (() => { const s = resolveSector(entry); return s ? secMap[s] : null; })();
              let col: string; let tip: string;
              if (secMed != null && secMed > 0) {
                const ratio = pval / secMed;
                if (ratio >= 1.5) { col = 'var(--mc-bearish)'; tip = `P/E ${pval.toFixed(1)}x is ${((ratio - 1) * 100).toFixed(0)}% above sector median (${secMed.toFixed(1)}x) — expensive vs peers.`; }
                else if (ratio >= 1.15) { col = '#F59E0B'; tip = `P/E ${pval.toFixed(1)}x is ${((ratio - 1) * 100).toFixed(0)}% above sector median (${secMed.toFixed(1)}x) — richer than peers.`; }
                else if (ratio >= 0.85) { col = 'var(--mc-text-2)'; tip = `P/E ${pval.toFixed(1)}x is in line with sector median (${secMed.toFixed(1)}x).`; }
                else if (ratio >= 0.65) { col = 'var(--mc-bullish)'; tip = `P/E ${pval.toFixed(1)}x is ${((1 - ratio) * 100).toFixed(0)}% below sector median (${secMed.toFixed(1)}x) — cheaper than peers.`; }
                else { col = 'var(--mc-bullish)'; tip = `P/E ${pval.toFixed(1)}x is ${((1 - ratio) * 100).toFixed(0)}% below sector median (${secMed.toFixed(1)}x) — deep value vs peers.`; }
              } else {
                col = pval > 100 ? 'var(--mc-bearish)' : pval > 60 ? '#F59E0B' : pval > 30 ? 'var(--mc-text-2)' : 'var(--mc-bullish)';
                tip = `Trailing P/E: ${pval.toFixed(1)}x. No sector peers in bench — using absolute band. Red > 100x, Amber 60-100x, Grey 30-60x, Green < 30x.`;
              }
              return (
                <span title={tip}>
                  <span style={{ color: 'var(--mc-text-4)' }}>P/E</span>{' '}
                  <strong style={{ color: col }}>{pval.toFixed(1)}x</strong>
                  {secMed != null && density !== 'ultra' && (
                    <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', marginLeft: 3 }}>(med {secMed.toFixed(1)})</span>
                  )}
                </span>
              );
            })()}
            {/* zzz354 — PEG chip: P/E ÷ EPS growth. <1 undervalued, 1-2 fair, >2 rich, <0 negative-growth guard.
                Uses trailing P/E and latest EPS YoY %. Skips when EPS growth ≤ 0 or missing. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && typeof entry.eps_yoy_pct === 'number' && (entry.eps_yoy_pct as number) > 5 && (() => {
              const pe = (entry as any).pe as number;
              const g = entry.eps_yoy_pct as number;
              // zzz364 (BUG 4) — cap the valuation denominator at 100 so a triple-
              // digit base-effect EPS growth can't manufacture DEEP VALUE. The
              // DISPLAYED EPS-growth number (g) is unchanged; only the denom caps.
              const gVal = Math.min(g, 100);
              const peg = pe / gVal;
              // zzz357/zzz358 — PEG < 0.15 is almost always a low-base optical artifact
              // (GNFC PEG 0.03, SFL PEG 0.04) not genuine deep value. Flag it as BASE EFFECT?.
              const col = peg < 0.15 ? '#F59E0B' : peg < 0.5 ? 'var(--mc-bullish)' : peg < 1 ? 'var(--mc-bullish)' : peg < 2 ? '#F59E0B' : 'var(--mc-bearish)';
              const label = peg < 0.15 ? 'BASE EFFECT?' : peg < 0.5 ? 'DEEP VALUE' : peg < 1 ? 'CHEAP vs growth' : peg < 2 ? 'FAIR' : 'RICH vs growth';
              return (
                <span title={`PEG = P/E (${pe.toFixed(1)}) ÷ EPS YoY % (${g.toFixed(1)}%${gVal !== g ? `, capped at ${gVal.toFixed(0)}% for valuation` : ''}) = ${peg.toFixed(2)}. Traditional PEG: <1 undervalued, 1-2 fair, >2 overvalued. Verdict: ${label}.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>PEG</span>{' '}
                  <strong style={{ color: col }}>{peg.toFixed(2)}</strong>
                  <span style={{ marginLeft: 3, fontSize: 8.5, color: 'var(--mc-text-4)' }}>({label})</span>
                </span>
              );
            })()}
            {/* zzz354 — P/E-vs-growth verdict chip: standalone classifier that works even when
                EPS growth is 0 or negative (which PEG skips). Compares P/E ratio to EPS growth
                rate directly: P/E > 2×growth = OVERVALUED, P/E < 0.5×growth = UNDERVALUED, else FAIR.
                For negative EPS growth (turnaround): always OVERVALUED regardless of P/E. */}
            {typeof (entry as any).pe === 'number' && Number.isFinite((entry as any).pe) && (entry as any).pe > 0 && typeof entry.eps_yoy_pct === 'number' && (() => {
              const pe = (entry as any).pe as number;
              const g = entry.eps_yoy_pct as number;
              // zzz364 (BUG 4) — cap the valuation denominator at 100 (displayed g unchanged).
              const gVal = Math.min(g, 100);
              // zzz364 (BUG 5) — negative ROCE destroys capital; never allow UNDERVALUED.
              const roceV = (entry as any).roce;
              const roceNeg = typeof roceV === 'number' && roceV < 0;
              let verdict: string; let col: string;
              // zzz357 — absolute P/E ceilings override the growth-relative verdict.
              // Fixes NYKAA 351x / CUPID 271x / HITACHI 131x rendering as FAIR when a
              // large EPS-growth base made P/E < 2×growth. No triple-digit multiple is "fair".
              if (pe > 200) { verdict = 'EXTREME'; col = 'var(--mc-bearish)'; }
              else if (pe > 100) { verdict = 'OVERVALUED'; col = 'var(--mc-bearish)'; }
              else if (g <= 0) { verdict = 'NEG-GROWTH'; col = 'var(--mc-bearish)'; }
              else if (pe > 2 * gVal) { verdict = 'OVERVALUED'; col = 'var(--mc-bearish)'; }
              else if (pe < 0.5 * gVal && !roceNeg) { verdict = 'UNDERVALUED'; col = 'var(--mc-bullish)'; }
              else { verdict = 'FAIR'; col = 'var(--mc-text-2)'; }
              return (
                <span title={`P/E-vs-Growth verdict: ${verdict}. P/E ${pe.toFixed(1)}x vs EPS growth ${g.toFixed(1)}%. Rule: P/E>200 = EXTREME, P/E>100 = OVERVALUED, >2×growth = OVERVALUED, <0.5×growth = UNDERVALUED, negative growth = flag.`}>
                  <span style={{ color: 'var(--mc-text-4)' }}>VAL</span>{' '}
                  <strong style={{ color: col, fontSize: 10 }}>{verdict}</strong>
                </span>
              );
            })()}
            {/* zzz230 — Since filing: cumulative % close move from earnings-report
                date to most recent close. Sourced from server-computed move_pct
                on the graded API. Shows how the market has voted since results. */}
            {typeof (entry as any).move_pct === 'number' && Number.isFinite((entry as any).move_pct) && (() => {
              const m = (entry as any).move_pct as number;
              const col = m >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              const arrow = m >= 8 ? '🚀' : m >= 3 ? '📈' : m >= -3 ? '➖' : m >= -8 ? '📉' : '💥';
              return (
                <span title={`DRIFT: cumulative % close change from earnings-day prev close (${entry.filing_date || '?'}) to most recent close. Post-Earnings Announcement Drift = the classic Bernard-Thomas signal — beats persist to +Xd, misses fade.`}>
                  <span style={{ color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>DRIFT {arrow}</span>{' '}
                  <strong style={{ color: col }}>
                    {m >= 0 ? '+' : ''}{m.toFixed(1)}%
                  </strong>
                </span>
              );
            })()}
          </div>
        );
      })()}
      {/* zzz254 — Institutional-quality row: ROCE, ROE, D/E. zzz255 — dropped RS/OCF
          because enrich API doesn't return them (only graded API does). Hidden in ultra. */}
      {/* zzz260 — D/E removed per user request (data unreliable across sources). ROCE + ROE only. */}
      {density !== 'ultra' && (() => {
        const roce = (entry as any).roce, roe = (entry as any).roe;
        const qCol = (v: any, thr: number) => (typeof v === 'number' && Number.isFinite(v) && v >= thr) ? 'var(--mc-bullish)' : (typeof v === 'number' ? '#F59E0B' : 'var(--mc-text-4)');
        // zzz827 — a missing ROCE / ROE says so ("n/a"), never a bare dash.
        const val = (v: any, suffix = '') => (typeof v === 'number' && Number.isFinite(v)) ? (v.toFixed(1) + suffix) : 'n/a';
        return (
          <div style={{ display: 'flex', gap: '6px 14px', fontSize: 10, flexWrap: 'wrap', alignItems: 'baseline', color: 'var(--mc-text-3)', paddingTop: 2, borderTop: '1px dashed var(--mc-bg-3)', marginTop: 2 }}>
            <span title={typeof roce === 'number' ? 'ROCE — return on capital employed. 25% or more = capital-efficient.' : 'ROCE not available yet — not in the source for this name (or not fetched yet). The quality check treats it as not checked, never a fail.'}><span style={{ color: 'var(--mc-text-4)' }}>ROCE</span> <strong style={{ color: qCol(roce, 25) }}>{val(roce, '%')}</strong></span>
            <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
            <span title={typeof roe === 'number' ? 'ROE — return on equity. 18% or more = strong.' : 'ROE not available yet — not in the source for this name (or not fetched yet). Not a fail.'}><span style={{ color: 'var(--mc-text-4)' }}>ROE</span> <strong style={{ color: qCol(roe, 18) }}>{val(roe, '%')}</strong></span>
            {/* zzz360 — promoter-pledge chip. 0% = clean (green); any pledge = red
                governance flag. Guarded on typeof number so unknown pledge omits. */}
            {typeof (entry as any).pledged_pct === 'number' && Number.isFinite((entry as any).pledged_pct) && (() => {
              const p = (entry as any).pledged_pct as number;
              const clean = p === 0;
              const col = clean ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
              return (
                <>
                  <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>
                  <span title={clean
                    ? 'Promoter pledge 0% — no shares pledged. Clean governance signal.'
                    : `Promoter pledge ${p.toFixed(p < 1 ? 2 : 1)}% of promoter holding. Pledged shares = leverage/liquidity risk; forced sale on margin call can cascade the price.`}>
                    <span style={{ color: 'var(--mc-text-4)' }}>PLEDGE</span>{' '}
                    <strong style={{ color: col }}>{clean ? '0%' : p.toFixed(p < 1 ? 2 : 1) + '%'}</strong>
                  </span>
                </>
              );
            })()}
          </div>
        );
      })()}
      {/* zzz355 — SCORES row: composite Earnings Quality Score (0-100) + Overall Verdict pill.
          Quality Score components (max 100):
            - CFO/PAT: >=1 → 30, 0.8-1 → 25, 0.5-0.8 → 15, <0.5 → 0
            - OPM Δ (pp): >3 → 25, 1-3 → 20, 0-1 → 10, <0 → 0
            - PAT/Sales ratio (op-lev sanity): 1-2× → 20, 2-3× → 10, >3× → 0, <1× → 15
            - EPS-PAT gap (dilution proxy): ≤10pp → 15, ≤30pp → 8, >30pp → 0
            - PEG (valuation): <1 → 10, 1-2 → 5
          Overall Verdict combines Quality + PE-vs-growth + red flag count + DRIFT. */}
      {density !== 'ultra' && (() => {
        // zzz362 — computation extracted to module-level cbComputeQuality so the
        // verdict can also drive the filter gate. Rendered output is unchanged
        // (qScore bar, QUALITY number, triangulation chip, verdict pill).
        const { qScore, qCol, bits, verdictLabel, verdictIcon, verdictColor, verdictTip, triLabel, triCol } = cbComputeQuality(entry);

        return (
          <div style={{ display: 'flex', gap: '8px 10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)', fontSize: 10 }}>
            <span title={'Earnings quality, in words. Built from: ' + (bits.map(cbQualityBitWord).join(' · ') || 'no inputs yet')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
              <span style={{ color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>quality</span>
              <span style={{ position: 'relative', width: 44, height: 5, background: 'var(--mc-bg-3)', borderRadius: 2 }}>
                <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: qScore + '%', background: qCol, borderRadius: 2 }} />
              </span>
              <strong style={{ color: qCol, fontWeight: 800 }}>{cbQualityWord(qScore) /* zzz827 — word, never the number */}</strong>
            </span>
            {triLabel && (
              <span title="Growth Triangulation: are Sales+PAT+EPS all coherent? GROWTH TRIPLE = healthy across the board. MARGIN-LED = PAT strong but Sales weak (watch sustainability). VOLUME-ONLY = Sales up but margins compressing." style={{ padding: '1px 6px', borderRadius: 3, background: triCol + '22', color: triCol, fontWeight: 700, border: '1px solid ' + triCol + '55', fontSize: 9.5, letterSpacing: '0.3px' }}>{triLabel}</span>
            )}
            <span title={verdictTip} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 3, cursor: 'help',
              background: verdictColor + '22', color: verdictColor, fontWeight: 800,
              border: '1px solid ' + verdictColor + '66', fontSize: 10.5, letterSpacing: '0.5px',
              marginLeft: 'auto',
            }}>{verdictIcon ? verdictIcon + ' ' : ''}{cbVerdictLabel(verdictLabel) /* zzz827 — neutral label; the key stays for the filter */}</span>
          </div>
        );
      })()}
      {/* zzz358 — INSTITUTIONAL CHIPS row: positive/neutral signal pills (blue-ish).
          Additive to the SCORES + RED FLAGS rows. Every chip is individually
          guarded (typeof === 'number' && Number.isFinite) so an absent field
          simply omits its chip — never crashes. Some Tier-2 fields (ebit_yoy_pct,
          pat_margin_*, finance_cost_curr_cr / ebit_curr_cr, other_income_pct_sales_*,
          effective_tax_rate_*, dep_yoy_pct) don't yet exist on the bench schema —
          those chips no-op until the enrich backend ships them. */}
      {density !== 'ultra' && (() => {
        const e: any = entry;
        const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        const chips: Array<{ icon: string; label: string; tip: string; color: string }> = [];
        const BLUE = '#3B82F6', CYAN = '#06B6D4', GREEN = '#22C55E', AMBER = '#F59E0B', VIOLET = '#A855F7';

        // ── Tier 1 (payload data) ──────────────────────────────────────────
        // 🚀 QoQ ACCEL — sequential sales growth accelerating (quarters_sales, 4Q).
        // Assume chronological oldest→newest; last QoQ growth > prior QoQ growth.
        const qs: any[] | null = Array.isArray(e.quarters_sales) ? e.quarters_sales : null;
        if (qs && qs.length >= 4) {
          const q2 = num(qs[qs.length - 3]), q3 = num(qs[qs.length - 2]), q4 = num(qs[qs.length - 1]), q1 = num(qs[qs.length - 4]);
          if (q1 !== null && q2 !== null && q3 !== null && q4 !== null && q1 > 0 && q2 > 0 && q3 > 0) {
            const lastQoQ = (q4 - q3) / q3, priorQoQ = (q3 - q2) / q2;
            if (lastQoQ > priorQoQ) {
              chips.push({ icon: '🚀', label: 'QoQ ACCEL', color: CYAN,
                tip: `Sequential sales growth accelerating: latest QoQ +${(lastQoQ * 100).toFixed(1)}% > prior QoQ +${(priorQoQ * 100).toFixed(1)}% (quarters_sales 4Q).` });
            }
          }
        }
        // ⚙️ OP-LEV — EBIT YoY exceeds EBITDA YoY by >20pp (operating leverage).
        const ebitY = num(e.ebit_yoy_pct), ebitdaY = num(e.ebitda_yoy_pct);
        if (ebitY !== null && ebitdaY !== null && (ebitY - ebitdaY) > 20) {
          chips.push({ icon: '⚙️', label: 'OP-LEV', color: BLUE,
            tip: `Operating leverage: EBIT +${ebitY.toFixed(1)}% YoY vs EBITDA +${ebitdaY.toFixed(1)}% YoY (${(ebitY - ebitdaY).toFixed(1)}pp gap). Below-EBITDA costs scaling slower than revenue.` });
        }
        // PAT-M ±X.Xpp — PAT margin YoY delta (curr vs prev).
        const patmC = num(e.pat_margin_curr), patmP = num(e.pat_margin_prev);
        if (patmC !== null && patmP !== null) {
          const d = patmC - patmP, sign = d >= 0 ? '+' : '−';
          chips.push({ icon: '', label: `PAT-M ${sign}${Math.abs(d).toFixed(1)}pp`, color: d >= 0 ? GREEN : AMBER,
            tip: `PAT margin ${patmC.toFixed(1)}% vs ${patmP.toFixed(1)}% YoY (${sign}${Math.abs(d).toFixed(1)}pp).` });
        }
        // 💧 WC-STRETCH / WC-TIGHT — receivables/inventory YoY vs sales YoY.
        const salesY = num(e.sales_yoy_pct), recvY = num(e.receivables_yoy_pct), invY = num(e.inventory_yoy_pct);
        if (salesY !== null && (recvY !== null || invY !== null)) {
          const wcMax = Math.max(recvY ?? -Infinity, invY ?? -Infinity);
          const wcMin = Math.min(recvY ?? Infinity, invY ?? Infinity);
          if (Number.isFinite(wcMax) && wcMax > salesY + 15) {
            chips.push({ icon: '💧', label: 'WC-STRETCH', color: AMBER,
              tip: `Working capital stretching: receivables/inventory YoY (${wcMax.toFixed(0)}%) well above sales YoY (${salesY.toFixed(0)}%). Watch cash conversion.` });
          } else if (Number.isFinite(wcMin) && wcMin < salesY - 15) {
            chips.push({ icon: '💧', label: 'WC-TIGHT', color: GREEN,
              tip: `Working capital disciplined: receivables/inventory YoY (${wcMin.toFixed(0)}%) clearly below sales YoY (${salesY.toFixed(0)}%).` });
          }
        }
        // 💰 DEBT-FREE — finance cost < 2% of EBIT.
        const finC = num(e.finance_cost_curr_cr), ebitC = num(e.ebit_curr_cr);
        if (finC !== null && ebitC !== null && ebitC > 0 && finC < 0.02 * ebitC) {
          chips.push({ icon: '💰', label: 'DEBT-FREE', color: GREEN,
            tip: `Finance cost ₹${finC.toFixed(1)} Cr is <2% of EBIT ₹${ebitC.toFixed(1)} Cr — effectively debt-free / negligible interest burden.` });
        }

        // ── Tier 2 (new backend fields, may be null until enrich ships) ─────
        // 📊 OTHER-INC ↓ — other income falling as % of sales (cleaner quality).
        // zzz373 — when the quarterly series exists, derive curr/prev FROM IT so this chip and
        // the Q-TRENDS OTHER-INC pill can never contradict (TIIL showed "OTHER-INC ↓" next to
        // "OTHER-INC 5.0% ▲+3.0" because the scalar came from an older enrich pass).
        const oiSeries = Array.isArray(e.quarters_other_income_pct) ? e.quarters_other_income_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x)) : null;
        const oiC = oiSeries && oiSeries.length >= 2 ? oiSeries[oiSeries.length - 1] : num(e.other_income_pct_sales_curr);
        const oiP = oiSeries && oiSeries.length >= 2 ? oiSeries[oiSeries.length - 2] : num(e.other_income_pct_sales_prev);
        if (oiC !== null && oiP !== null && (oiP - oiC) >= 0.5) {
          chips.push({ icon: '📊', label: 'OTHER-INC ↓', color: BLUE,
            tip: `Other income falling as % of sales (${oiC.toFixed(1)}% vs ${oiP.toFixed(1)}%) — cleaner, more operating-driven earnings.` });
        }
        // ⚠️ TAX-BENEFIT −Xpp — effective tax rate below prev by >5pp (optical EPS boost).
        const taxSeriesChip = Array.isArray(e.quarters_tax_pct) ? e.quarters_tax_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x)) : null;
        const taxC = taxSeriesChip && taxSeriesChip.length >= 2 ? taxSeriesChip[taxSeriesChip.length - 1] : num(e.effective_tax_rate_curr);
        const taxP = taxSeriesChip && taxSeriesChip.length >= 2 ? taxSeriesChip[taxSeriesChip.length - 2] : num(e.effective_tax_rate_prev);
        // zzz372/373 — sanity band: effective tax rates outside [-10, 70] are artifacts of a
        // near-zero / negative PBT denominator (DCW showed −9497%). Skip the chip then.
        const taxSane = (v: number | null): v is number => v !== null && v >= -10 && v <= 70;
        if (taxSane(taxC) && taxSane(taxP) && (taxP - taxC) > 5) {
          chips.push({ icon: '⚠️', label: `TAX-BENEFIT −${(taxP - taxC).toFixed(0)}pp`, color: AMBER,
            tip: `Effective tax rate dropped ${(taxP - taxC).toFixed(1)}pp YoY (${taxP.toFixed(1)}% → ${taxC.toFixed(1)}%). Optical EPS boost — check if one-off.` });
        }
        // 📈 SCALE ✓ — depreciation YoY ÷ sales YoY < 0.3 (operating scale).
        const depY = num(e.dep_yoy_pct);
        if (depY !== null && salesY !== null && salesY > 0 && (depY / salesY) < 0.3) {
          chips.push({ icon: '📈', label: 'SCALE ✓', color: GREEN,
            tip: `Operating scale: depreciation +${depY.toFixed(0)}% YoY growing far slower than sales +${salesY.toFixed(0)}% YoY (ratio ${(depY / salesY).toFixed(2)} <0.3).` });
        }

        // ── Extras ─────────────────────────────────────────────────────────
        // 📊 LOW-BASE — prior-period sales < ₹100 Cr AND sales YoY > 100 (optical growth).
        const priorSales = qs && qs.length >= 4 ? num(qs[0]) : null;
        if (priorSales !== null && priorSales < 100 && salesY !== null && salesY > 100) {
          chips.push({ icon: '📊', label: 'LOW-BASE', color: AMBER,
            tip: `Optical growth off a tiny base: prior-period sales ₹${priorSales.toFixed(0)} Cr with +${salesY.toFixed(0)}% YoY. High % masks small absolute size.` });
        }
        // 💧 CASH-RICH — cfo_to_pat_ratio > 3 (cash flow far exceeds profit).
        // zzz366 — reframed from the old alarmist "CFO-INFLATED" amber flag. A very
        // high CFO/PAT is usually a POSITIVE (strong cash generation, or a heavy-
        // depreciation asset base adding back), and it was sitting contradictorily
        // next to a cash-backed beat. Rendered neutral grey as an informational note,
        // not a red/amber warning, with a caveat to check the driver.
        const cfoR = cbCashView(e).ratio; // zzz827 — same-year ratio only
        // zzz371 (audit) — cap at the same 5x artifact ceiling the top-line uses, so a card
        // can never show "CFO/PAT FY n/m" AND "CASH-RICH 8.7x" at once (TVSSRICHAK).
        if (cfoR !== null && cfoR > 3 && cfoR <= 5 && !cbIsFinancial(e)) { // zzz362 — financials: CFO/PAT not meaningful
          chips.push({ icon: '💧', label: `CASH-RICH ${cfoR.toFixed(1)}×`, color: 'var(--mc-text-4)',
            tip: `CFO/PAT ${cfoR.toFixed(1)}× — operating cash flow far exceeds reported profit. Usually healthy (strong cash conversion or heavy depreciation add-back); occasionally a working-capital release or a depressed-PAT base. Informational, not a red flag.` });
        }
        // ⚠️ ONE-OFF — latest quarter carries a large exceptional/one-off item.
        // zzz363 — |exceptional| ≥ 15% of PBT. Amber when >0 (gain-flattered),
        // grey when <0 (charge-depressed). Signed % of PBT.
        const exPct = num(e.exceptional_pct_pbt);
        if (exPct !== null && Math.abs(exPct) >= 15) {
          const exCol = exPct > 0 ? AMBER : 'var(--mc-text-4)';
          chips.push({ icon: '⚠️', label: `ONE-OFF ${exPct > 0 ? '+' : ''}${exPct.toFixed(0)}% PBT`, color: exCol,
            tip: `Latest quarter includes a large exceptional/one-off item (${exPct > 0 ? '+' : ''}${exPct.toFixed(0)}% of PBT) — the beat may be flattered by a non-recurring gain; check recurring PAT.` });
        }
        // 👑 PREMIUM — ROCE ≥ 30 AND ROE ≥ 25 (compounder tier).
        const roceV = num(e.roce), roeV = num(e.roe);
        if (roceV !== null && roeV !== null && roceV >= 30 && roeV >= 25) {
          chips.push({ icon: '👑', label: 'PREMIUM', color: VIOLET,
            tip: `Compounder tier: ROCE ${roceV.toFixed(0)}% (≥30) and ROE ${roeV.toFixed(0)}% (≥25).` });
        }
        // CFO N/A (Q1) — cfo ratio absent AND Q1-looking filing. zzz359 CFO proxy note.
        const filingMonth = (() => {
          const fd = typeof e.filing_date === 'string' ? e.filing_date : '';
          const m = /^\d{4}-(\d{2})/.exec(fd);
          return m ? parseInt(m[1], 10) : null;
        })();
        const isQ1Filing = String(e.quarter || '').toUpperCase() === 'Q1'
          || (filingMonth !== null && filingMonth >= 4 && filingMonth <= 6);
        void isQ1Filing; // zzz827 — the CASH figure itself now says "not checked" with the reason

        // ⚠ DEGRADED — BLOCKBUSTER tier but genuinely broken (3+ red flags, the
        // same conditions that drive the AVOID verdict). zzz361 — ROCE<15 alone
        // is common among solid cyclicals and over-fired the banner on ~15 cards.
        const tierBB = String(e.tier || '').toUpperCase().includes('BLOCKBUSTER');
        const sYoY = num(e.sales_yoy_pct), pYoY = num(e.net_profit_yoy_pct), epsYoY = num(e.eps_yoy_pct);
        const opmD = (num(e.opm_pct) != null && num(e.opm_prev_pct) != null) ? (num(e.opm_pct)! - num(e.opm_prev_pct)!) : null;
        const drift = num(e.move_pct);
        let rfCount = 0;
        if (cfoR !== null && cfoR < 0.5) rfCount++;
        if (sYoY != null && pYoY != null && sYoY > 5 && pYoY > 5 * sYoY) rfCount++;
        if (epsYoY != null && pYoY != null && Math.abs(pYoY) > 10 && Math.abs(epsYoY - pYoY) > 30) rfCount++;
        if (opmD != null && opmD < -3) rfCount++;
        if (drift != null && drift < -5 && tierBB) rfCount++;
        const degraded = tierBB && (rfCount >= 3 || (drift != null && drift < -12));

        if (chips.length === 0 && !degraded) return null;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)' }}>
            {degraded && (
              <div title={`3+ quality red flags on a BLOCKBUSTER print — headline tier overstates the setup.`}
                style={{ flexBasis: '100%', padding: '2px 8px', borderRadius: 3, background: '#F59E0B22', color: '#F59E0B', fontWeight: 800, border: '1px solid #F59E0B66', fontSize: 9.5, letterSpacing: '0.4px' }}>
                ⚠ DEGRADED — BLOCKBUSTER tier but quality flags present
              </div>
            )}
            {chips.map((c, i) => (
              <span key={i} title={c.tip} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help',
                background: c.color + '18', color: c.color, fontWeight: 700,
                border: '1px solid ' + c.color + '44', fontSize: 9, letterSpacing: '0.2px',
              }}>{c.icon ? c.icon + ' ' : ''}{c.label}</span>
            ))}
          </div>
        );
      })()}
      {/* zzz360 — QUARTER TRENDS + CFO/PAT-annual + CONCLUSIONS. Additive to the
          zzz358 chips block. Every array is guarded (Array.isArray && length>=2,
          last two entries finite) and every scalar via typeof===number &&
          Number.isFinite. Institutional color semantics per metric. Renders
          nothing when no series/scalar is present. */}
      {density !== 'ultra' && !cbIsFinancial(entry) /* zzz374 — investment/holding/NBFC OPM+CFO trends are noise (DHUNINV showed OPM ▲+222, OTHER-INC ▼-139) */ && (() => {
        const e: any = entry;
        // zzz371 (audit) — NEU must be a real hex, not a CSS var(): the pill style
        // appends a hex-alpha suffix (col + '14' / col + '40'), and 'var(--x)14' is
        // invalid CSS, so neutral TAX/OPM pills silently lost their bg + border.
        const GREEN = '#22C55E', AMBER = '#F59E0B', RED = '#EF4444', NEU = '#94A3B8';
        // last two finite values of a chronological (oldest→newest) array
        const lastTwo = (v: any): { latest: number; prev: number } | null => {
          if (!Array.isArray(v) || v.length < 2) return null;
          const latest = v[v.length - 1], prev = v[v.length - 2];
          if (typeof latest !== 'number' || !Number.isFinite(latest)) return null;
          if (typeof prev !== 'number' || !Number.isFinite(prev)) return null;
          return { latest, prev };
        };
        // zzz374 — drop implausible values (a quarter with ~0 sales makes % ratios
        // explode: DHUNINV OPM prev -178% → delta +222). Filter to [lo,hi] FIRST,
        // then take the last two survivors so the pill reflects real quarters.
        const lastTwoBounded = (v: any, lo: number, hi: number): { latest: number; prev: number } | null => {
          if (!Array.isArray(v)) return null;
          const clean = v.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi);
          return lastTwo(clean);
        };
        const seriesStr = (v: any): string => Array.isArray(v)
          ? v.slice(-5).map((x: any) => (typeof x === 'number' && Number.isFinite(x)) ? x.toFixed(1) : '—').join(' → ')
          : '';

        type TP = { key: string; label: string; latest: number; delta: number; col: string; tip: string };
        const tps: TP[] = [];

        // OPM % — rising = good (green), falling = amber/red.
        const opm = lastTwoBounded(e.quarters_opm, -50, 100);
        if (opm) {
          const d = opm.latest - opm.prev;
          const col = d >= 0.1 ? GREEN : d <= -1.5 ? RED : d < 0 ? AMBER : NEU;
          tps.push({ key: 'opm', label: 'OPM', latest: opm.latest, delta: d, col,
            tip: `OPM % by quarter (oldest→newest): ${seriesStr(e.quarters_opm)}. Rising = margin tailwind (good), falling = margin pressure.` });
        }
        // Material Cost % — FALLING = good (green), rising = red (input-cost pressure).
        const mat = lastTwo(e.quarters_material_cost_pct);
        if (mat) {
          const d = mat.latest - mat.prev;
          const col = d < 0 ? GREEN : d > 0 ? RED : NEU;
          tps.push({ key: 'mat', label: 'MAT-COST', latest: mat.latest, delta: d, col,
            tip: `Material cost % of sales by quarter: ${seriesStr(e.quarters_material_cost_pct)}. FALLING = margin tailwind (good); rising = input-cost pressure (red).` });
        }
        // Other Income % — FALLING = good/cleaner (green), rising = amber (quality watch).
        const oi = lastTwoBounded(e.quarters_other_income_pct, -60, 100);
        if (oi) {
          const d = oi.latest - oi.prev;
          const col = d < 0 ? GREEN : d > 0 ? AMBER : NEU;
          tps.push({ key: 'oi', label: 'OTHER-INC', latest: oi.latest, delta: d, col,
            tip: `Other income % by quarter: ${seriesStr(e.quarters_other_income_pct)}. FALLING = cleaner/operating-driven (good); rising = earnings-quality watch (amber).` });
        }
        // Tax % — show latest; sharp DROP (>5pp below prior) = amber "tax-aided"; up = neutral.
        // zzz372 — same sanity band as the TAX-BENEFIT chip: a quarter with ~0 or negative
        // PBT makes tax % explode (DCW −9497%). Drop those points before taking lastTwo.
        const taxSeries = Array.isArray(e.quarters_tax_pct)
          ? e.quarters_tax_pct.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && x >= -10 && x <= 70)
          : null;
        const tax = lastTwo(taxSeries);
        if (tax) {
          const d = tax.latest - tax.prev;
          const taxAided = d < -5;
          const col = taxAided ? AMBER : NEU;
          tps.push({ key: 'tax', label: taxAided ? 'TAX·aided' : 'TAX', latest: tax.latest, delta: d, col,
            tip: `Tax rate % by quarter: ${seriesStr(taxSeries)}. Sharp drop (>5pp below prior) = tax-aided EPS (amber); normalizing up = neutral.` });
        }

        // ── CFO/PAT annual trend pill (annual_cfo_pat) ──────────────────────
        const cfoAnnArr: number[] | null = Array.isArray(e.annual_cfo_pat)
          // zzz372 — |ratio| > 5 is a near-zero-PAT artifact (VIPCLOTHNG showed −7.4 → 2.0 as
          // "▲+9.40"); drop those years so the pill reflects the real trend.
          ? e.annual_cfo_pat.filter((x: any) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 5)
          : null;
        const cfoAnnLatest = cfoAnnArr && cfoAnnArr.length >= 1 ? cfoAnnArr[cfoAnnArr.length - 1] : null;
        let cfoAnnPill: React.ReactNode = null;
        if (cfoAnnArr && cfoAnnArr.length >= 2) {
          const latest = cfoAnnArr[cfoAnnArr.length - 1], prev = cfoAnnArr[cfoAnnArr.length - 2];
          const d = latest - prev, rising = d >= 0;
          const col = (latest >= 1 && rising) ? GREEN : (latest < 0.8 || !rising) ? AMBER : NEU;
          const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '▬';
          cfoAnnPill = (
            <span title={`CFO/PAT annual series (Screener cash-flow is published ANNUALLY, so this is a yearly trend, not quarterly): ${cfoAnnArr.map((x) => x.toFixed(2)).join(' → ')}. Green when ≥1 and rising; amber when <0.8 or falling.`}
              style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help', background: col + '14', border: '1px solid ' + col + '40', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: 'var(--mc-text-4)' }}>CFO/PAT (annual)</span>
              <strong style={{ color: col }}>{latest.toFixed(2)}</strong>
              <span style={{ color: col }}>{arrow}{d >= 0 ? '+' : ''}{d.toFixed(2)}</span>
            </span>
          );
        }

        // ── CONCLUSIONS synthesis ───────────────────────────────────────────
        const concl: string[] = []; const firedTips: string[] = [];
        const opmRising = !!opm && opm.latest > opm.prev;
        const opmFalling = !!opm && opm.latest < opm.prev;
        const matFalling = !!mat && mat.latest < mat.prev;
        const matRising = !!mat && mat.latest > mat.prev;
        const taxDrop = !!tax && (tax.latest - tax.prev) < -5;
        const oiRising = !!oi && (oi.latest - oi.prev) > 1;
        const cfoRatio = cbCashView(e).ratio; // zzz827 — same-year ratio only
        const cfoWeak = cfoRatio != null && cfoRatio < 0.8 && !cbIsFinancial(e); // zzz362 — financials: CFO/PAT not meaningful
        const pledgeNum = (typeof e.pledged_pct === 'number' && Number.isFinite(e.pledged_pct)) ? e.pledged_pct as number : null;
        // zzz363 — large exceptional/one-off gain flattering the beat (signed % of PBT).
        const exPctPbt = (typeof e.exceptional_pct_pbt === 'number' && Number.isFinite(e.exceptional_pct_pbt)) ? e.exceptional_pct_pbt as number : null;
        const oneOffBoost = exPctPbt != null && exPctPbt > 15;
        // margin
        if (opm) {
          if (opmRising && matFalling) { concl.push('Clean margin-led'); firedTips.push('OPM rising + material cost falling'); }
          else if (opmRising && matRising) { concl.push('Margin up despite cost pressure'); firedTips.push('OPM rising but material cost also rising'); }
          else if (opmRising) { concl.push('Margin-led'); firedTips.push('OPM rising'); }
          else if (opmFalling) { concl.push('Margin compressing'); firedTips.push('OPM falling'); }
        }
        // cash — zzz364 (BUG 2b) — financials: CFO/PAT not meaningful, suppress the
        // cash-backed / weak-cash-conversion conclusion clause for lenders/NBFCs.
        let cashWeak = false;
        void cfoAnnLatest;
        if (cfoRatio != null && !cbIsFinancial(e)) { // zzz827 — the same figure the CASH chip shows
          if (cfoRatio >= 1) { concl.push('cash-backed'); firedTips.push('same-year CFO/PAT ≥1'); }
          else if (cfoRatio < 0.5) { concl.push('weak cash conversion'); cashWeak = true; firedTips.push('same-year CFO/PAT <0.5'); }
        }
        // quality flags
        const qbits: string[] = [];
        if (taxDrop) qbits.push('tax');
        if (oiRising) qbits.push('other-income');
        if (cfoWeak) qbits.push('cash');
        if (qbits.length) {
          // zzz361 — when the quality-flags clause is the ONLY one that fired,
          // render it as a proper statement instead of a bare parenthetical.
          concl.push(concl.length === 0
            ? 'Beat quality: low (' + qbits.join('/') + '-aided)'
            : '(low-quality: ' + qbits.join('/') + '-aided)');
          firedTips.push('quality flags: ' + qbits.join(', '));
        }
        // zzz363 — one-off / exceptional item flattering the beat.
        if (oneOffBoost) {
          concl.push('one-off-boosted (+' + exPctPbt!.toFixed(0) + '% PBT)');
          firedTips.push('exceptional item +' + exPctPbt!.toFixed(0) + '% of PBT');
        }
        // pledge
        if (pledgeNum != null) {
          if (pledgeNum > 0) { concl.push('⚠ promoter pledge ' + pledgeNum.toFixed(pledgeNum < 1 ? 2 : 1) + '%'); firedTips.push('promoter pledge ' + pledgeNum + '%'); }
          else { concl.push('no pledge'); }
        }
        const caution = qbits.length > 0 || matRising || cashWeak || opmFalling || oneOffBoost || (pledgeNum != null && pledgeNum > 0);
        let sentence = '';
        if (concl.length) {
          const raw = concl.join(', ');
          sentence = raw.charAt(0).toUpperCase() + raw.slice(1) + (raw.endsWith('.') ? '' : '.');
        }

        if (tps.length === 0 && !cfoAnnPill && concl.length === 0) return null;
        return (
          <>
            {(tps.length > 0 || cfoAnnPill) && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)' }}>
                <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }} title="Quarter-on-quarter trend (latest quarter vs the one before). The OPM Δ in the header row is YEAR-on-year (same quarter last year), so the two can differ.">Q-TRENDS (QoQ)</span>
                {tps.map((t) => {
                  const arrow = t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '▬';
                  return (
                    <span key={t.key} title={t.tip}
                      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '1px 5px', borderRadius: 3, cursor: 'help', background: t.col + '14', border: '1px solid ' + t.col + '40', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--mc-text-4)' }}>{t.label}</span>
                      <strong style={{ color: t.col }}>{t.latest.toFixed(1)}%</strong>
                      <span style={{ color: t.col }}>{arrow}{t.delta >= 0 ? '+' : ''}{t.delta.toFixed(1)}</span>
                    </span>
                  );
                })}
                {cfoAnnPill}
              </div>
            )}
            {concl.length > 0 && (
              <div title={'Signals fired: ' + firedTips.join(' · ')}
                style={{ display: 'flex', alignItems: 'baseline', gap: 5, paddingTop: 3, marginTop: 2, borderTop: '1px dashed var(--mc-bg-3)', fontSize: 9.5, cursor: 'help' }}>
                <span style={{ fontSize: 8.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px' }}>READ</span>
                <span style={{ color: caution ? AMBER : GREEN, fontWeight: 700 }}>{sentence}</span>
              </div>
            )}
          </>
        );
      })()}
      {/* zzz375 — HONEST "no trends" hint. When a NON-financial card has been through
          enrichment (cb_enrich_v current) but Screener still yields no quarterly table,
          show a muted note so the empty gap reads as "Screener can't parse this one",
          NOT "the Fill button is broken / data is missing". */}
      {density !== 'ultra' && (() => {
        const e: any = entry;
        // zzz827 — one pure rule (qTrendsState): "loading…" only while a fill
        // pass is actually running; afterwards the card says "not available".
        const qs = qTrendsState(e, __cbFillRunning);
        if (qs === 'present') return null; // real Q-TRENDS pills already rendered above
        // zzz376 — ALWAYS say WHY the Q-TRENDS strip is absent instead of leaving a
        // blank gap the user reads as a bug. Three honest states:
        const base = { fontSize: 8.5, color: 'var(--mc-text-4)', fontStyle: 'italic' as const, paddingTop: 2 };
        if (qs === 'financial') {
          return (
            <div style={base} title="Q-TRENDS (OPM / Other-Income / Tax / CFO-PAT-annual) measure operating-margin & cash quality. For banks / NBFCs / holding & investment companies those aren't meaningful (their 'operating margin' and 'cash from operations' mix financing flows), so the strip is intentionally omitted — same reason CFO/PAT shows n/m.">
              Q-TRENDS n/a — financial company (margin/tax trends not meaningful)
            </div>
          );
        }
        // zzz376 — three distinct, honest states, colour-coded so GENUINELY-ABSENT
        // (grey) is visually different from a FETCH BUG (amber) the user can retry.
        if (qs === 'no-table') {
          return (
            <div style={base} title="A Screener page DID load for this ticker but it has no quarterly results table — so the trend data is GENUINELY absent, not a fetch error. Nothing to retry. (Header stats like OPM / ROCE / CFO-PAT come from a different source and are unaffected.)">
              Q-TRENDS n/a — genuinely absent (Screener has no quarterly table)
            </div>
          );
        }
        if (qs === 'fetch-failed') {
          return (
            <div style={{ ...base, color: '#F59E0B', fontStyle: 'normal' }} title="Screener could NOT be reached for this ticker (403 / rate-limit / timeout) — so we don't yet know if trends exist. This is a TRANSIENT fetch failure, not missing data. Click ⟳ Fill missing to retry, or reload in a minute.">
              ⚠ Q-TRENDS unavailable — Screener fetch failed (transient · click ⟳ Fill missing to retry)
            </div>
          );
        }
        if (qs === 'loading') {
          return (
            <div style={base} title="Q-TRENDS come from Screener's quarterly table; the fill pass is running now.">
              ⟳ Q-TRENDS loading… (fill pass running)
            </div>
          );
        }
        return (
          <div data-testid="cb-qtrends-na" style={base} title="Q-TRENDS (margin / other income / tax by quarter) are not available for this name yet — not in the source, or not fetched. Nothing here is a fail. Click ⟳ Fill missing to try again.">
            Q-TRENDS not available
          </div>
        );
      })()}
      {/* zzz354 — RED FLAGS row: quality-of-earnings warning badges computed from
          existing bench fields. Only renders when at least one flag is triggered.
          Flags: (1) CFO/PAT < 0.5 = cash conversion broken;
                 (2) PAT growth > 3× Sales growth = margin windfall (not sustainable);
                 (3) EPS growth wildly different from PAT growth = share-count noise;
                 (4) OPM contracted > 3pp = margin deterioration;
                 (5) DRIFT negative post beat = market disbelief. */}
      {density !== 'ultra' && (() => {
        const flags: Array<{icon: string; label: string; tip: string}> = [];
        const cfoR = cbCashView(entry).ratio; // zzz827 — same-year ratio only
        const sales = entry.sales_yoy_pct;
        const pat = entry.net_profit_yoy_pct;
        const eps = entry.eps_yoy_pct;
        const opmD = typeof (entry as any).opm_pct === 'number' && typeof (entry as any).opm_prev_pct === 'number'
          ? ((entry as any).opm_pct - (entry as any).opm_prev_pct) : null;
        const drift = (entry as any).move_pct;
        if (typeof cfoR === 'number' && cfoR > 0 && cfoR < 0.5 && !cbIsFinancial(entry)) { // zzz362/zzz364 (BUG 6) — only genuine weak-but-positive (0<r<0.5); negative/huge are artifacts, financials exempt
          flags.push({icon:'🚩', label:'CASH-CONV', tip:`Cash from operations ${cfoR.toFixed(2)}× profit, same fiscal year — below 0.5 (but positive). Reported profit isn't translating into cash. Investigate receivables/inventory build.`});
        }
        // zzz366 — mirror cbComputeQuality: a cash-confirmed beat (CFO/PAT ≥1.5)
        // has its profit spike validated by real cash, so MARGIN-SPIKE would be a
        // false positive. Suppress the flag here too so the card and the verdict
        // agree (both suppress) instead of showing a red flag the verdict ignored.
        const _cashConfirmed = typeof cfoR === 'number' && cfoR >= 1.5 && cfoR <= 5 && !cbIsFinancial(entry);  // zzz372 — same band as cbComputeQuality (>5 = artifact, not confirmation)
        if (typeof sales === 'number' && typeof pat === 'number' && sales > 5 && pat > 5 * sales && !_cashConfirmed) {
          flags.push({icon:'⚠️', label:'MARGIN-SPIKE', tip:`PAT +${pat.toFixed(0)}% vs Sales +${sales.toFixed(0)}% (${(pat/sales).toFixed(1)}× ratio). Big margin expansion — check if driven by one-off / low base / other income. Rarely sustains.`});
        }
        if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 10 && Math.abs(eps - pat) > 30) {
          flags.push({icon:'⚠️', label:'EPS≠PAT', tip:`EPS ${eps.toFixed(0)}% vs PAT ${pat.toFixed(0)}%. Wide gap suggests share-count change (buyback/dilution/split). Verify EPS number.`});
        }
        if (typeof opmD === 'number' && opmD < -3) {
          flags.push({icon:'🔴', label:'OPM-DROP', tip:`OPM contracted ${opmD.toFixed(1)}pp YoY. Margin deterioration — pricing pressure, cost inflation, or mix shift.`});
        }
        if (typeof drift === 'number' && drift < -5 && ['BLOCKBUSTER','ELITE','STRONG'].includes(String(entry.tier || '').toUpperCase())) {
          flags.push({icon:'📉', label:'MKT-DOUBT', tip:`Stock is ${drift.toFixed(1)}% below filing-day price despite ${entry.tier} print. Market is fading the beat — sustainability suspicion or forward-guidance concern.`});
        }
        if (flags.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 3, marginTop: 2, borderTop: '1px dashed rgba(239,68,68,0.20)' }}>
            {flags.map((f, i) => (
              <span key={i} title={f.tip} style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'help',
                background: 'rgba(239,68,68,0.10)', color: '#F87171', fontWeight: 700,
                border: '1px solid rgba(239,68,68,0.25)', letterSpacing: '0.3px'
              }}>{f.icon} {f.label}</span>
            ))}
          </div>
        );
      })()}
      {/* zzz251 — Peer strip: median PEAD + DRIFT of same-sector bench entries.
          Reads window.__cbAllEntries which we populate once per render pass. */}
      {(() => {
        const mySec = resolveSector(entry);
        if (!mySec) return null;
        const all: any[] = (typeof window !== 'undefined' && (window as any).__cbAllEntries) || [];
        const peers = all.filter((p) => resolveSector(p) === mySec && p.ticker !== entry.ticker);
        if (peers.length < 2) return null;
        const peerPeads = peers.map((p) => peadScore(p).score).filter((n) => Number.isFinite(n));
        const peerDrifts = peers.map((p: any) => p.move_pct).filter((n: any) => typeof n === 'number' && Number.isFinite(n));
        const median = (arr: number[]) => {
          if (arr.length === 0) return null;
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const medPead = median(peerPeads);
        const medDrift = median(peerDrifts);
        const myPead = peadScore(entry).score;
        const myDrift = typeof (entry as any).move_pct === 'number' ? (entry as any).move_pct : null;
        const peadDelta = medPead != null ? myPead - medPead : null;
        const driftDelta = medDrift != null && myDrift != null ? myDrift - medDrift : null;
        return (
          <div title={`Sector peers (${peers.length} in bench): median post-results drift ${medPead != null ? cbPeadWord(medPead) : '—'}, median DRIFT ${medDrift != null ? (medDrift >= 0 ? '+' : '') + medDrift.toFixed(1) + '%' : '—'}. Positive delta = you're beating sector.`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: sectorColor(mySec) }} />
            <span style={{ fontWeight: 700, marginRight: 4 }}>vs {peers.length} {mySec.slice(0, 18)} peer{peers.length === 1 ? '' : 's'}:</span>
            {peadDelta != null && (<span style={{ marginRight: 6 }}>PEAD <strong style={{ color: peadDelta >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{Math.abs(peadDelta) < 5 ? 'in line' : peadDelta > 0 ? 'stronger' : 'weaker'}</strong></span>)}
            {driftDelta != null && (<span>DRIFT <strong style={{ color: driftDelta >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{driftDelta >= 0 ? '+' : ''}{driftDelta.toFixed(1)}%</strong></span>)}
          </div>
        );
      })()}
      {/* zzz251 — DRIFT PATH mini-chart. zzz253 — show pending placeholder for fresh filings. */}
      {(() => {
        const pts = ['gap_pct','d1_pct','d2_pct','move_pct'].filter(k => typeof (entry as any)[k] === 'number' && Number.isFinite((entry as any)[k])).length;
        if (pts >= 2) {
          return (
            <div style={{ marginTop: 4, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
              <DriftPath entry={entry} width={130} height={26} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px', fontWeight: 700 }}>DRIFT PATH</span>
                <span style={{ fontSize: 8, color: 'var(--mc-text-4)', letterSpacing: '0.2px' }}>Gap · D1 · D2 · Now</span>
              </div>
            </div>
          );
        }
        // zzz253 — placeholder for cards without any price data yet (bhavcopy lag)
        return (
          <div title="Bhavcopy for this filing date hasn't published yet. NSE typically publishes daily bhavcopy by 18:00 IST. Chart will populate on next enrichment." style={{ marginTop: 2, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: '0.3px' }}>
            <span>⏳</span>
            <span style={{ fontWeight: 700 }}>DRIFT PATH</span>
            <span style={{ opacity: 0.7 }}>awaiting price data (bhavcopy lag)</span>
          </div>
        );
      })()}
      {/* PATCH 0546 — Always render guidance badge using derived label
          (falls back to YoY-metric heuristic when no explicit field).
          Explicit field shows its signed score; derived label shows the
          deriving signal so user knows it's heuristic. */}
      {(() => {
        const label = deriveGuidanceLabel(entry);
        const isExplicit = !!entry.guidance;
        const cfg: Record<string, { color: string; icon: string }> = {
          'Positive': { color: '#10B981', icon: '📈' },
          'Neutral':  { color: '#94A3B8', icon: '➖' },
          'Negative': { color: '#EF4444', icon: '📉' },
        };
        const c = cfg[label];
        const s = entry.guidance_score;
        const scoreStr = (isExplicit && typeof s === 'number' && label !== 'Neutral')
          ? ` (${s > 0 ? '+' : ''}${s.toFixed(2)})`
          : '';
        const suffix = isExplicit ? '' : ' ~';  // ~ marks metric-derived
        return (
          <div>
            <span title={isExplicit ? 'From concall/PR text' : 'Derived from YoY metrics'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
              padding: '2px 7px', borderRadius: 4,
              backgroundColor: `${c.color}18`, border: `1px solid ${c.color}40`,
              color: c.color, fontWeight: 700,
            }}>
              {c.icon} {label}{scoreStr}{suffix}
            </span>
          </div>
        );
      })()}
      {/* zzz245 — Filing link moved to ticker; bottom-of-card link removed for
          institutional cleanliness. */}
      {markSlot && (
        <div style={{ borderTop: '1px dashed var(--mc-bg-4)', paddingTop: density === 'ultra' ? 3 : 5, marginTop: 1 }}>{markSlot}</div>
      )}
    </div>
  );
}
