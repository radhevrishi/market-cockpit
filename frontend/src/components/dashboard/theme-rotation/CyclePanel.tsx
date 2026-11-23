'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME CYCLE & LEADERSHIP TRANSITION  (zzz1289) — top of Theme Rotation.
//   1. Market regime (full-history benchmark) + a one-glance summary.
//   2. Drawdown & resilience map: every 15%+ fall — last boom's leaders (red), benchmark (grey), fell least (green),
//      all over the SAME peak → trough window, with what happened next.
//   3. What history says — counted from those falls, not asserted.
//   4. Next-cycle watchlist (research priority, not buy signals) with evidence for / against, milestone, invalidation.
//   5. Potential leadership transitions between related themes (relative strength only — never "money moved").
//   6. Current correction map: every theme over the benchmark's high → low → today.
// All calculations live in src/lib/theme-cycle/*.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import type { Market, Payload } from '@/lib/theme-rotation/types';
import type { ThemeView } from '@/lib/theme-rotation/view-model';
import type { EpisodeRow, HistoryLessons, RegimeRead } from '@/lib/theme-cycle/core';
import { usePerf, BestCompanies } from '@/components/market-leadership/PerfTabs';
import { classifyCycle, cycleSummary, leadershipTransitions, watchlistOrder, STATE_LABEL, STATE_HELP, WATCH_STATES, type CycleRead, type CycleState } from '@/lib/theme-cycle/classify';
import { previousStates, saveStates } from '@/lib/theme-cycle/memory';
import { card } from './ui';
import { T, tint } from './tokens';

interface CycleHistory {
  ok: boolean; market: Market; benchName: string; lastDay: string; firstDay: string; builtAt: string;
  regime: RegimeRead | null; episodes: EpisodeRow[]; lessons: HistoryLessons; minDepth: number;
  coverage: { sectors: number; missing: string[] }; error?: string;
}

const pct = (f: number | null | undefined, dp = 0) => (typeof f === 'number' && isFinite(f) ? `${f > 0 ? '+' : f < 0 ? '−' : ''}${Math.abs(f * 100).toFixed(dp)}%` : '—');
const pts = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : '—');
const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const fmtMon = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

const STATE_COLOR: Record<CycleState, string> = {
  CONFIRMED_LEADER: T.up, EMERGING_LEADER: T.up, EARLY_ROTATION: T.accent, STABILISING: T.info, DEFENSIVE: T.flat,
  FAILED_TRANSITION: T.alarm, BROKEN: T.down, NOT_READY: T.warn, NEUTRAL: T.absent,
};
const DIM_META = { up: { g: '▲', c: T.up, w: 'improving' }, partial: { g: '◐', c: T.info, w: 'partly' }, down: { g: '▼', c: T.down, w: 'weakening' }, flat: { g: '●', c: T.flat, w: 'steady' }, unknown: { g: '○', c: T.absent, w: 'no data' } } as const;

function useCycleHistory(region: Market) {
  const [data, setData] = useState<Record<Market, CycleHistory | null>>({ us: null, india: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    if (data[region]?.ok) return;
    (async () => {
      try {
        const r = await fetch(`/api/market/theme-cycle?region=${region}`, { cache: 'no-store', signal: AbortSignal.timeout(100_000) });
        const j = await r.json();
        if (!dead) setData((d) => ({ ...d, [region]: j }));
        if (!j?.ok && !dead) setTimeout(() => setTick((t) => t + 1), 30_000);
      } catch { if (!dead) setTimeout(() => setTick((t) => t + 1), 30_000); }
    })();
    return () => { dead = true; };
  }, [region, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return data[region];
}

// ── 2. drawdown & resilience map ───────────────────────────────────────────
function HistoryChart({ rows, benchName, market }: { rows: EpisodeRow[]; benchName: string; market: Market }) {
  const [open, setOpen] = useState<string | null>(null);
  const vals = rows.flatMap((r) => [r.leadersFall, r.bench.fall, r.least?.fall].filter((x): x is number => typeof x === 'number').map((x) => x * 100));
  const lo = Math.min(-20, Math.floor(Math.min(...vals) / 20) * 20);
  const hi = Math.max(20, Math.ceil(Math.max(...vals) / 20) * 20);
  const W = 1000, L = 230, R = 890, H = 70;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 20) ticks.push(v);
  const height = rows.length * H + 34;
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', minWidth: 720, display: 'block' }} role="img" aria-label={`Past falls of ${benchName}: last boom's leaders, the benchmark and the sector that fell least`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={4} y2={height - 26} stroke={v === 0 ? T.dim : T.border} strokeWidth={v === 0 ? 1.4 : 1} />
              <text x={x(v)} y={height - 8} textAnchor="middle" fontSize={13} fill={T.faint}>{v > 0 ? '+' : ''}{v}%</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y0 = i * H, cy = y0 + 40;
            const red = r.leadersFall != null ? r.leadersFall * 100 : null, grey = r.bench.fall * 100, green = r.least ? r.least.fall * 100 : null;
            const pts2 = [red, grey, green].filter((v): v is number => v != null);
            const thenTxt = r.ongoing
              ? `next? — not a forecast${r.bench.sinceTrough != null ? ` · market ${pct(r.bench.sinceTrough)} from the low` : ''}`
              : r.least?.next12 != null ? `then ${pct(r.least.next12)} in 12m${r.bench.next12 != null ? ` (market ${pct(r.bench.next12)}${r.leastVsBench === 'in line' ? ', in line' : r.leastVsBench === 'behind' ? ', behind' : ', ahead'})` : ''}` : '';
            return (
              <g key={r.peak} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.peak ? null : r.peak)}>
                <rect x={0} y={y0 + 2} width={W} height={H - 4} rx={8} fill={i % 2 === 0 ? tint(T.dim, 7) : 'transparent'} />
                <text x={12} y={y0 + 32} fontSize={15} fontWeight={800} fill={T.text}>{r.name.split(' · ')[0]}{r.ongoing ? ' (now)' : ''}</text>
                <text x={12} y={y0 + 50} fontSize={12} fill={T.faint}>{r.name.split(' · ')[1] || ''} · {fmtMon(r.peak)} → {fmtMon(r.trough)}</text>
                {pts2.length >= 2 ? <line x1={x(Math.min(...pts2))} x2={x(Math.max(...pts2))} y1={cy} y2={cy} stroke={T.border2} strokeWidth={3} /> : null}
                {red != null ? (
                  <g>
                    <circle cx={x(red)} cy={cy} r={7.5} fill={T.down}><title>{`Last boom's leaders (strongest run-up ${fmtMon(r.runUpFrom)} → ${fmtMon(r.peak)}): ${r.leaders.join(', ')} — average ${pct(r.leadersFall)} over the fall${r.leadersNext12 != null ? `; next 12 months ${pct(r.leadersNext12)}` : ''}`}</title></circle>
                    <text x={x(red) + 8} y={cy - 13} textAnchor="end" fontSize={13} fontWeight={800} fill={T.down}>{r.leaders.slice(0, 3).join(', ')} {pct(r.leadersFall)}</text>
                  </g>
                ) : null}
                <circle cx={x(grey)} cy={cy} r={7.5} fill={T.flat}><title>{`${benchName} ${pct(r.bench.fall, 1)} from ${fmtDay(r.peak)} to ${fmtDay(r.trough)}`}</title></circle>
                <text x={x(grey)} y={cy + 24} textAnchor="middle" fontSize={12.5} fill={T.dim}>{benchName.replace(/ 50$/, '')} {pct(r.bench.fall)}</text>
                {green != null && r.least ? (
                  <g>
                    <circle cx={x(green)} cy={cy} r={7.5} fill={T.up}><title>{`Fell least over the same window: ${r.least.name} ${pct(r.least.fall, 1)}${r.least.kind === 'basket' ? ' (basket of large members — no index before 2011)' : ''}`}</title></circle>
                    <text x={x(green) - 8} y={cy - 13} textAnchor="start" fontSize={13} fontWeight={800} fill={T.up}>{r.least.name}{r.least.kind === 'basket' ? '*' : ''} {pct(r.least.fall)}</text>
                    <text x={x(green) + 13} y={cy + 5} fontSize={12} fill={r.ongoing ? T.faint : r.leastVsBench === 'ahead' ? T.up : r.leastVsBench === 'behind' ? T.down : T.dim}>{thenTxt}</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11.5, color: T.dim, marginTop: 4 }}>
        <span><b style={{ color: T.down }}>●</b> Last boom's leaders (average — the 3 sectors with the strongest run-up before the peak)</span>
        <span><b style={{ color: T.flat }}>●</b> {benchName}</span>
        <span><b style={{ color: T.up }}>●</b> Fell least</span>
        <span style={{ color: T.faint }}>Every dot uses the same two dates: {benchName}'s peak and its low. * = basket of large members (no index on file before 2011; chosen with hindsight). Click a row for every sector.</span>
      </div>
      {open ? (() => {
        const r = rows.find((x) => x.peak === open)!;
        const byFall = [...r.sectors].sort((a, b) => b.fall - a.fall);
        return (
          <div style={{ ...card, marginTop: 8, background: T.card2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 6 }}>{r.name} — {fmtDay(r.peak)} → {fmtDay(r.trough)} · {benchName} {pct(r.bench.fall, 1)}{r.bench.next12 != null ? ` · next 12m ${pct(r.bench.next12)}` : ''}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ color: T.faint, textAlign: 'left' }}><th style={{ padding: '3px 6px' }}>#</th><th>Sector</th><th style={{ textAlign: 'right' }}>Run-up before</th><th style={{ textAlign: 'right' }}>In the fall</th><th style={{ textAlign: 'right' }}>vs market</th><th style={{ textAlign: 'right' }}>Next 12 months</th></tr></thead>
                <tbody>
                  {byFall.map((s, i) => (
                    <tr key={s.name} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ padding: '3px 6px', color: T.faint }}>{i + 1}</td>
                      <td>{s.name}{s.kind === 'basket' ? <span style={{ color: T.faint }}> (basket)</span> : null}{r.leaders.includes(s.name) ? <span style={{ color: T.down, fontWeight: 800 }}> · last boom's leader</span> : null}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(s.runUp)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: s.fall > r.bench.fall ? T.up : T.down }}>{pct(s.fall, 1)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pts((s.fall - r.bench.fall) * 100)} pts</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: s.next12 == null ? T.faint : r.bench.next12 != null && s.next12 > r.bench.next12 ? T.up : T.dim }}>{r.ongoing ? 'not yet' : pct(s.next12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })() : null}
      {market === 'india' ? null : null}
    </div>
  );
}

function Lessons({ L, rows }: { L: HistoryLessons; rows: EpisodeRow[] }) {
  if (!L.completed) return null;
  const done = rows.filter((r) => !r.ongoing && r.bench.next12 != null);
  return (
    <div style={{ ...card, background: T.card2, fontSize: 12.5, lineHeight: 1.6, color: T.dim }}>
      <div style={{ fontWeight: 900, color: T.text, marginBottom: 2 }}>What these {L.completed} completed falls say (counted, not assumed)</div>
      <div>• The sector that <b style={{ color: T.up }}>fell least</b> beat the market over the next 12 months in <b>{L.leastAhead} of {L.completed}</b>{L.leastInLine ? ` (${L.leastInLine} in line)` : ''}, and was a top-3 sector in <b>{L.leastTop3}</b>. Falling less is defence — it rarely leads the recovery.</div>
      <div>• Of the next year's top-3 sectors ({L.nextTopTotal} in all), <b>{L.nextTopFromBottomHalf}</b> came from the <b style={{ color: T.down }}>harder-hit half</b> of the fall. Leadership usually comes from damaged areas that start improving.</div>
      <div>• The last boom's leaders beat the market the next year in <b>{L.leadersAhead} of {L.leadersCounted}</b> — old leaders are not automatically finished.</div>
      <div style={{ color: T.faint, marginTop: 2 }}>So the watchlist below looks for themes that were hit and are now improving on several independent measures — not for the ones that fell least. Small sample ({done.length} falls): a tendency, not a rule.</div>
    </div>
  );
}

function DimChips({ r }: { r: CycleRead }) {
  const items: Array<[string, keyof CycleRead['dims']]> = [['MKT', 'market'], ['BRD', 'breadth'], ['ERN', 'earnings'], ['CAT', 'catalysts'], ['VOL', 'flow']];
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map(([lab, k]) => { const m = DIM_META[r.dims[k]]; return <span key={k} title={`${lab === 'MKT' ? 'Relative strength + price structure (one vote)' : lab === 'VOL' ? 'Volume proxy (support only, not counted)' : lab}: ${m.w}`} style={{ fontSize: 10.5, fontWeight: 800, padding: '1px 5px', borderRadius: 4, border: `1px solid ${tint(m.c, 45)}`, color: m.c, background: tint(m.c, 10) }}>{m.g} {lab}</span>; })}
    </span>
  );
}

function StateBadge({ s }: { s: CycleState }) {
  return <span title={STATE_HELP[s]} style={{ fontSize: 11, fontWeight: 900, padding: '2px 7px', borderRadius: 5, color: STATE_COLOR[s], background: tint(STATE_COLOR[s], 14), border: `1px solid ${tint(STATE_COLOR[s], 40)}`, whiteSpace: 'nowrap' }}>{STATE_LABEL[s]}</span>;
}

// ── main panel ─────────────────────────────────────────────────────────────
export function CyclePanel({ region, payload, views, nameOf, onPick, benchName }: {
  region: Market; payload: Payload; views: ThemeView[]; nameOf: (id: string) => string; onPick: (id: string) => void; benchName: string;
}) {
  const hist = useCycleHistory(region);
  // zzz1291 — the companies behind each theme (best first), so a theme name never needs a second search
  const perf = usePerf(region, 0);
  const perfTheme = useMemo(() => new Map((perf.d?.themes || []).map((t) => [t.id, t])), [perf.d]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const prev = useMemo(() => (typeof window === 'undefined' ? new Map<string, CycleState>() : previousStates(region)), [region]);
  const reads = useMemo(() => {
    const m = new Map<string, CycleRead>();
    for (const v of views) m.set(v.row.id, classifyCycle({ row: v.row, L: v.a.layers, flags: v.a.flags, bench: payload.benchmarkRet, ref: payload.cycleRef, previous: prev.get(v.row.id) ?? null }));
    return m;
  }, [views, payload, prev]);
  useEffect(() => { if (reads.size) saveStates(region, reads); }, [reads, region]);
  const rows = useMemo(() => views.map((v) => v.row), [views]);
  const sum = useMemo(() => cycleSummary(rows, reads), [rows, reads]);
  const watch = useMemo(() => [...reads.values()].filter((r) => WATCH_STATES.includes(r.state)).sort(watchlistOrder), [reads]);
  const trans = useMemo(() => leadershipTransitions(rows, reads), [rows, reads]);
  const ref = payload.cycleRef;
  const reg = hist?.ok ? hist.regime : null;
  const byState = useMemo(() => {
    const g = new Map<CycleState, string[]>();
    for (const r of reads.values()) (g.get(r.state) || g.set(r.state, []).get(r.state)!).push(r.id);
    return g;
  }, [reads]);
  const rowById = useMemo(() => new Map(rows.map((t) => [t.id, t])), [rows]);

  const Names = ({ ids, color, n = 4 }: { ids: string[]; color: string; n?: number }) => ids.length ? (
    <span>{ids.slice(0, n).map((id, i) => <React.Fragment key={id}>{i ? ', ' : ''}<button type="button" onClick={() => onPick(id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color, fontWeight: 800, fontSize: 'inherit' }}>{nameOf(id)}</button></React.Fragment>)}{ids.length > n ? <span style={{ color: T.faint }}> +{ids.length - n}</span> : null}</span>
  ) : <span style={{ color: T.faint }}>none</span>;

  const regimeColor = !reg ? T.dim : reg.kind === 'bear' || reg.kind === 'severe' ? T.down : reg.kind === 'correction' ? T.warn : reg.kind === 'recovery' ? T.info : reg.kind === 'pullback' ? T.flat : T.up;
  return (
    <section style={{ ...card, marginBottom: 12, borderColor: tint(T.accent, 35), padding: '12px 14px' }} aria-label="Theme cycle and leadership transition">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.2 }}>Theme Cycle &amp; Leadership Transition</div>
          <div style={{ fontSize: 12, color: T.faint }}>Historical drawdowns · relative resilience · emerging recovery · next-cycle candidates — research priority, not buy signals.</div>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)} style={{ fontSize: 11.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.border2}`, background: 'transparent', color: T.dim, cursor: 'pointer' }}>{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {collapsed ? null : (
        <>
          {/* 1. regime + summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8, marginTop: 10 }}>
            <div style={{ ...card, background: tint(regimeColor, 9), borderColor: tint(regimeColor, 40) }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, color: T.faint, letterSpacing: 0.5 }}>MARKET REGIME · {benchName.toUpperCase()}</div>
              {reg ? (
                <>
                  <div style={{ fontSize: 17, fontWeight: 900, color: regimeColor }}>{reg.label}</div>
                  <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.5 }}>
                    {reg.ddMax >= 0.03 ? <>Fell {pct(-reg.ddMax, 1)} from its high on {fmtDay(reg.peak)} to {fmtDay(reg.trough)}; </> : null}
                    now {reg.ddNow < 0.001 ? 'at its high' : `${pct(-reg.ddNow, 1)} below the high`}{reg.recovered != null && reg.ddMax >= 0.03 ? `, ${Math.round(reg.recovered * 100)}% of the fall won back` : ''} · {reg.sessionsSincePeak} sessions since the high.
                  </div>
                </>
              ) : <div style={{ fontSize: 12.5, color: T.faint }}>{hist && !hist.ok ? 'Building the long history (first build takes up to a minute)…' : 'Loading…'}</div>}
            </div>
            <div style={card}>
              <div style={{ fontSize: 10.5, fontWeight: 900, color: T.faint, letterSpacing: 0.5 }}>THIS FALL{ref ? ` · ${fmtDay(ref.peak)} → ${fmtDay(ref.trough)}` : ''}</div>
              {ref ? (
                <div style={{ fontSize: 12, lineHeight: 1.65 }}>
                  <div><span style={{ color: T.faint }}>Most damaged:</span> <Names ids={sum.mostDamaged} color={T.down} /></div>
                  <div><span style={{ color: T.faint }}>Fell least (defence):</span> <Names ids={sum.fallingLess} color={T.flat} /></div>
                  <div><span style={{ color: T.faint }}>Leading from the low:</span> <Names ids={sum.recoveryLeaders} color={T.info} /></div>
                </div>
              ) : <div style={{ fontSize: 12, color: T.faint }}>No correction of 5%+ in the last nine months — themes are compared on 4 / 12 / 26-week relative strength only.</div>}
            </div>
            <div style={card}>
              <div style={{ fontSize: 10.5, fontWeight: 900, color: T.faint, letterSpacing: 0.5 }}>CYCLE STATES NOW</div>
              <div style={{ fontSize: 12, lineHeight: 1.65 }}>
                <div><span style={{ color: T.faint }}>Next-cycle candidates:</span> <Names ids={sum.candidates} color={T.up} /></div>
                <div><span style={{ color: T.faint }}>Stabilising:</span> <Names ids={sum.stabilising} color={T.info} /></div>
                <div><span style={{ color: T.faint }}>Confirmed leaders:</span> <Names ids={sum.confirmed} color={T.up} n={3} />{sum.failed.length ? <> · <span style={{ color: T.faint }}>failed:</span> <Names ids={sum.failed} color={T.alarm} n={2} /></> : null}</div>
              </div>
            </div>
          </div>

          {/* 2. history chart */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>Drawdown &amp; resilience map — every fall of {Math.round((hist?.minDepth ?? 0.15) * 100)}%+ in {benchName}</div>
            <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 6 }}>Red: the last boom's leaders. Grey: the market. Green: the sector that fell least. Then: what that sector did over the next 12 months.</div>
            {hist?.ok && hist.episodes.length ? <HistoryChart rows={hist.episodes} benchName={hist.benchName} market={region} /> : (
              <div style={{ fontSize: 12.5, color: T.faint, padding: 12 }}>{hist && !hist.ok ? `${hist.error || 'History unavailable.'} Retrying automatically.` : 'Loading long history…'}</div>
            )}
          </div>
          {hist?.ok ? <div style={{ marginTop: 8 }}><Lessons L={hist.lessons} rows={hist.episodes} /></div> : null}

          {/* 4. next-cycle watchlist */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>Next-cycle watchlist <span style={{ fontSize: 11.5, color: T.faint, fontWeight: 600 }}>— potential emerging leadership, not buy signals. Ordered by stage, then how many independent measures are improving.</span></div>
            {watch.length ? (
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: T.faint, textAlign: 'left', fontSize: 11 }}>
                      <th style={{ padding: '4px 6px' }}>#</th><th>Theme</th><th>Stage</th><th>Evidence</th>
                      <th style={{ textAlign: 'right' }} title="Theme minus market, percentage points">vs market 4w / 12w</th>
                      <th style={{ textAlign: 'right' }} title="Over the benchmark's high → low window">In the fall</th>
                      <th style={{ textAlign: 'right' }} title="From the benchmark's low to today">From the low</th>
                      <th>Confidence</th><th>Next confirmation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watch.slice(0, showAll ? 40 : 10).map((r, i) => {
                      const t = rowById.get(r.id)!; const open = openId === r.id;
                      return (
                        <React.Fragment key={r.id}>
                          <tr style={{ borderTop: `1px solid ${T.border}`, cursor: 'pointer', background: open ? tint(T.accent, 6) : undefined }} onClick={() => setOpenId(open ? null : r.id)}>
                            <td style={{ padding: '5px 6px', color: T.faint }}>{i + 1}</td>
                            <td style={{ fontWeight: 800 }}><div style={{ whiteSpace: 'nowrap' }}>{nameOf(r.id)}</div>{perfTheme.get(r.id)?.best.length ? <div style={{ fontSize: 11, color: T.dim, fontWeight: 600 }}>{perfTheme.get(r.id)!.best.slice(0, 3).map((x) => x.t).join(' · ')}</div> : null}</td>
                            <td><StateBadge s={r.state} /></td>
                            <td><DimChips r={r} /></td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><span style={{ color: (r.rel4w ?? 0) >= 0 ? T.up : T.down }}>{pts(r.rel4w)}</span> / <span style={{ color: (r.rel12w ?? 0) >= 0 ? T.up : T.down }}>{pts(r.rel12w)}</span></td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(t.cycle?.fall)}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(t.cycle?.fromTrough)}</td>
                            <td style={{ color: r.confidence === 'High' ? T.up : r.confidence === 'Low' ? T.warn : T.dim, fontWeight: 800 }}>{r.confidence}</td>
                            <td style={{ color: T.dim, minWidth: 220 }}>{r.milestone}</td>
                          </tr>
                          {open ? (
                            <tr><td colSpan={9} style={{ padding: '6px 10px 10px', background: tint(T.accent, 4) }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, fontSize: 12, lineHeight: 1.55 }}>
                                <div><div style={{ fontWeight: 900, color: T.up }}>Evidence for</div>{r.forEvidence.length ? r.forEvidence.map((e) => <div key={e}>• {e}</div>) : <div style={{ color: T.faint }}>—</div>}</div>
                                <div><div style={{ fontWeight: 900, color: T.down }}>Evidence against / missing</div>{r.againstEvidence.length ? r.againstEvidence.map((e) => <div key={e}>• {e}</div>) : <div style={{ color: T.faint }}>—</div>}</div>
                                <div><div style={{ fontWeight: 900 }}>Best companies</div><BestCompanies th={perfTheme.get(r.id)} m={region} max={5} /></div>
                                <div><div style={{ fontWeight: 900 }}>Invalidation</div><div>{r.invalidation}</div><div style={{ marginTop: 6, color: T.faint }}>{STATE_HELP[r.state]}</div>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); onPick(r.id); }} style={{ marginTop: 6, fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 6, border: `1px solid ${T.border2}`, background: 'transparent', color: T.accent, cursor: 'pointer' }}>Open full evidence ↓</button></div>
                              </div>
                            </td></tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {watch.length > 10 ? <button type="button" onClick={() => setShowAll((s) => !s)} style={{ marginTop: 6, fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 6, border: `1px solid ${T.border2}`, background: 'transparent', color: T.dim, cursor: 'pointer' }}>{showAll ? 'Show 10' : `Show all ${watch.length}`}</button> : null}
              </div>
            ) : <div style={{ fontSize: 12.5, color: T.faint, marginTop: 6 }}>No theme is improving on two or more independent measures right now. Nothing qualifies — that is a real answer, not missing data.</div>}
          </div>

          {/* 5. transitions */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>Potential leadership transitions <span style={{ fontSize: 11.5, color: T.faint, fontWeight: 600 }}>— related themes only (same group or moving together). Relative-strength divergence, not fund-flow data.</span></div>
            {trans.length ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                {trans.map((t) => (
                  <div key={`${t.from}-${t.to}`} style={{ ...card, padding: '7px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
                    <div><button type="button" onClick={() => onPick(t.from)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.down, fontWeight: 900, fontSize: 'inherit' }}>{nameOf(t.from)}</button> <span style={{ color: T.faint }}>losing relative strength ({pts(t.fromRel4w)} pts, 4w)</span> → <button type="button" onClick={() => onPick(t.to)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.up, fontWeight: 900, fontSize: 'inherit' }}>{nameOf(t.to)}</button> <span style={{ color: T.faint }}>gaining ({pts(t.toRel4w)} pts)</span> · gap {pts(t.rsGap4w)} pts · {t.basis} · <b style={{ color: t.confidence === 'Medium' ? T.dim : T.warn }}>{t.confidence} confidence</b></div>
                    <div style={{ color: T.dim }}>Breadth above 50-day: {t.breadthFrom ?? '—'}% → {t.breadthTo ?? '—'}% · earnings {DIM_META[t.earningsFrom].w} → {DIM_META[t.earningsTo].w}{t.against.length ? <> · <span style={{ color: T.warn }}>against: {t.against.join('; ')}</span></> : null}</div>
                    <div style={{ color: T.faint }}>Invalidates if: {t.invalidation}</div>
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: 12.5, color: T.faint, marginTop: 6 }}>No related pair shows a clear relative-strength hand-over (at least 4 points over 4 weeks) right now.</div>}
          </div>

          {/* 6. all states */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 900 }}>Every theme by cycle stage ({reads.size})</summary>
            <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
              {(Object.keys(STATE_LABEL) as CycleState[]).filter((s) => byState.get(s)?.length).sort((a, b) => ({ CONFIRMED_LEADER: 0, EMERGING_LEADER: 1, EARLY_ROTATION: 2, STABILISING: 3, DEFENSIVE: 4, FAILED_TRANSITION: 5, NOT_READY: 6, BROKEN: 7, NEUTRAL: 8 } as Record<string, number>)[a] - ({ CONFIRMED_LEADER: 0, EMERGING_LEADER: 1, EARLY_ROTATION: 2, STABILISING: 3, DEFENSIVE: 4, FAILED_TRANSITION: 5, NOT_READY: 6, BROKEN: 7, NEUTRAL: 8 } as Record<string, number>)[b]).map((s) => (
                <div key={s} style={{ fontSize: 12.5, lineHeight: 1.6 }}><StateBadge s={s} /> <span style={{ color: T.faint, fontSize: 11.5 }}>{STATE_HELP[s]}</span><div style={{ marginTop: 2 }}><Names ids={(byState.get(s) || []).sort((a, b) => (rowById.get(b)?.cycle?.relSincePeak ?? -999) - (rowById.get(a)?.cycle?.relSincePeak ?? -999))} color={STATE_COLOR[s]} n={40} /></div></div>
              ))}
            </div>
          </details>

          <div style={{ fontSize: 11, color: T.faint, marginTop: 10, lineHeight: 1.55 }}>
            Method: falls are found on {benchName}'s own daily closes (a fall ends when the old high is regained); every sector and theme is measured over the same two dates. The history uses {hist?.ok ? `${hist.coverage.sectors} sector series` : 'sector series'} (Yahoo daily closes{region === 'india' ? '; most NSE sector indices start in 2010–11, so earlier falls use baskets of large members, marked *' : ''}){hist?.ok && hist.coverage.missing.length ? `; not available: ${hist.coverage.missing.join(', ')}` : ''}. Today's stages use this page's evidence layers — relative strength and price structure count as ONE vote; breadth, earnings and catalysts each count once; the volume proxy and valuation are shown, not counted. A failed transition is recognised from this browser's weekly record. Not investment advice.
            {hist?.ok ? ` History built ${new Date(hist.builtAt).toLocaleString()} (data to ${fmtDay(hist.lastDay)}).` : ''}
          </div>
        </>
      )}
    </section>
  );
}
