'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { isPricedRow, pricedValue } from '@/lib/book-totals';
import { CAP_COLORS } from './constants';
import { normCapBucket } from './helpers';
import { type PortfolioRow } from './types';

export function capBadge(c?: string) {
  const b = normCapBucket(c);
  if (b === 'other') return <span style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>—</span>;
  const col = CAP_COLORS[b];
  const label = b.charAt(0).toUpperCase() + b.slice(1);
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 800, background: `${col}22`, color: col, letterSpacing: '0.3px' }}>{label}</span>;
}

export function PortfolioAnalytics({ rows, onSelectCap, onSelectTier, selectedTier }: { rows: PortfolioRow[]; onSelectCap?: (cap: string) => void; onSelectTier?: (tier: string) => void; selectedTier?: string | null }) {
  const fmtRs = (v: number) => '₹' + Math.round(v || 0).toLocaleString('en-IN');
  const pctTxt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  // zzz378 — only PRICED holdings (cmp>0) count toward current/P&L/day totals. The
  // per-row currentValue falls back to invested when unpriced, so summing all rows
  // silently valued a dead/BSE-only/weekend-missing holding at cost (P&L hidden, book
  // overstated) — and made the Analytics tab disagree with the Summary card.
  const pricedRows = rows.filter(r => (r.cmp || 0) > 0);
  const totalCur = pricedRows.reduce((a, r) => a + pricedValue(r), 0) || 1;
  const totalInv = pricedRows.reduce((a, r) => a + (r.investedValue || 0), 0) || 1;
  const totalPnl = pricedRows.reduce((a, r) => a + (r.pnl || 0), 0);
  const dayPnl = pricedRows.reduce((a, r) => a + (r.dayPnl || 0), 0);

  // Cap allocation (value-weighted % AND counts)
  const capOrder: Array<'large' | 'mid' | 'small' | 'micro' | 'other'> = ['large', 'mid', 'small', 'micro', 'other'];
  const capLabel: Record<string, string> = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap', micro: 'Micro cap', other: 'Unclassified' };
  const capStats = capOrder.map(k => {
    const rs = rows.filter(r => normCapBucket(r.cap) === k);
    const rsP = rs.filter(isPricedRow); // zzz898: unknown prices stay out of value + return
    const value = rsP.reduce((a, r) => a + pricedValue(r), 0);
    const pnl = rsP.reduce((a, r) => a + (r.pnl || 0), 0);
    const inv = rsP.reduce((a, r) => a + (r.investedValue || 0), 0);
    return { k, count: rs.length, value, pnl, retPct: inv > 0 ? (pnl / inv) * 100 : 0, valPct: (value / totalCur) * 100 };
  }).filter(x => x.count > 0);

  // Sector allocation
  const secMap = new Map<string, { value: number; count: number; pnl: number }>();
  for (const r of rows) {
    const sec = r.sector && r.sector !== '—' ? r.sector : 'Unclassified';
    const cur = secMap.get(sec) || { value: 0, count: 0, pnl: 0 };
    cur.value += r.currentValue || 0; cur.count += 1; cur.pnl += r.pnl || 0;
    secMap.set(sec, cur);
  }
  const sectors = [...secMap.entries()].map(([sector, v]) => ({ sector, ...v, valPct: (v.value / totalCur) * 100 })).sort((a, b) => b.value - a.value);

  // Concentration
  const byVal = [...pricedRows].sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
  const top5pct = (byVal.slice(0, 5).reduce((a, r) => a + pricedValue(r), 0) / totalCur) * 100;
  const largest = byVal[0] ? { sym: byVal[0].symbol, pct: (pricedValue(byVal[0]) / totalCur) * 100 } : null;
  const hhi = rows.reduce((a, r) => { const w = pricedValue(r) / totalCur; return a + w * w; }, 0) * 10000; // Herfindahl (0-10000)

  // Performance / risk
  const priced = rows.filter(r => r.cmp > 0);
  const winners = priced.filter(r => (r.pnl || 0) > 0);
  const losers = priced.filter(r => (r.pnl || 0) < 0);
  const best = [...priced].sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0))[0];
  const worst = [...priced].sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0))[0];
  const wtdRet = (totalPnl / totalInv) * 100;

  // Quality overlay — Conviction Beats tier + Multibagger score
  let cbMap: Record<string, any> = {};
  try { cbMap = JSON.parse(typeof window !== 'undefined' ? (localStorage.getItem('mc:conviction-beats:v1') || '{}') : '{}') || {}; } catch {}
  const tierOf = (sym: string) => cbMap[(sym || '').toUpperCase()]?.tier as string | undefined;
  const tierColors: Record<string, string> = { BLOCKBUSTER: '#F59E0B', STRONG: '#10B981', MIXED: '#94A3B8', AVOID: '#EF4444' };
  const tierCounts: Record<string, number> = {};
  let onCB = 0;
  for (const r of rows) { const t = tierOf(r.symbol); if (t) { onCB++; tierCounts[t] = (tierCounts[t] || 0) + 1; } }
  const scored = rows.filter(r => typeof r.score === 'number');
  const avgScore = scored.length ? scored.reduce((a, r) => a + (r.score || 0), 0) / scored.length : null;

  const card: any = { background: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: 12, padding: '16px 18px' };
  const h: any = { fontSize: 12, fontWeight: 800, color: '#60A5FA', letterSpacing: '0.5px', marginBottom: 12, textTransform: 'uppercase' };
  const Bar = ({ label, sub, pct, count, color, valueTxt, pnl }: any) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{label} {count != null && <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 11 }}>· {count}</span>}</span>
        <span style={{ color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%{valueTxt ? <span style={{ color: 'var(--mc-text-4)', marginLeft: 6, fontSize: 11 }}>{valueTxt}</span> : null}{pnl != null ? <span style={{ color: pnl >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', marginLeft: 6, fontSize: 11 }}>{pctTxt(pnl)}</span> : null}</span>
      </div>
      <div style={{ height: 7, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 4 }} />
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Stat = ({ label, value, color, sub }: any) => (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || 'var(--mc-text-0)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  // zzz297 — Earnings tier mix from PortfolioEarningsTab cache.
  // zzz312 — intersect with CURRENT holdings so tickers user later removed
  // (e.g. IONEXCHANG) don't linger in the tier mix from stale cache.
  let etMix: any = null;
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('mc:portfolio-earnings-tab:v1');
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.grades) {
          const currentSet = new Set((rows || []).map((r: any) => String(r.symbol || '').toUpperCase()));
          const bt: any = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [], NONE: [] };
          let tot = 0;
          for (const k in c.grades) {
            if (!currentSet.has(String(k).toUpperCase())) continue;
            const g = c.grades[k];
            const t = (g && g.tier) || 'NONE';
            (bt[t] = bt[t] || []).push({ t: k, s: g && g.composite_score, q: g && g.quarter });
            tot++;
          }
          for (const sym of currentSet) {
            if (!(sym in c.grades)) {
              bt.NONE.push({ t: sym, s: null, q: null });
              tot++;
            }
          }
          etMix = { bt, ts: c.ts, tot };
        }
      }
    }
  } catch {}
  // zzz310 — retuned for solid contrast on the dark portfolio background.
  //   BLOCKBUSTER = gold, STRONG = green, MIXED = amber, AVOID = red, NONE = slate.
  //   MIXED used to be red-on-brown which read as "broken" instead of "caution".
  const etCol: any = {
    BLOCKBUSTER: { fg: '#FCD34D', bg: '#3F2A0A', bd: '#F59E0B', act: 'results very strong' },
    STRONG:      { fg: '#86EFAC', bg: '#052E1A', bd: '#22C55E', act: 'results strong' },
    MIXED:       { fg: '#FDE68A', bg: '#3B2E0A', bd: '#EAB308', act: 'review the thesis' },
    AVOID:       { fg: '#FCA5A5', bg: '#3F0F0F', bd: '#DC2626', act: 'results weak — check the thesis' },
    NONE:        { fg: '#94A3B8', bg: '#1F2937', bd: '#475569', act: '-' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* zzz297 tier mix */}
      {etMix && etMix.tot > 0 && (
        <div style={card}>
          <div style={h}>Earnings tier mix ({etMix.tot} holdings)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 12 }}>
            {['BLOCKBUSTER','STRONG','MIXED','AVOID','NONE'].map((t) => {
              const st = etCol[t]; const list = etMix.bt[t] || []; const p = Math.round((list.length / etMix.tot) * 100);
              const isSel = selectedTier === t;
              const disabled = list.length === 0;
              return (<div key={t}
                onClick={() => { if (!disabled && onSelectTier) onSelectTier(isSel ? '' : t); }}
                title={disabled ? `No ${t} holdings` : (isSel ? `Click again to clear ${t} filter` : `Show only the ${list.length} ${t} holding${list.length === 1 ? '' : 's'} in the Holdings table`)}
                style={{ padding: 10, background: st.bg, border: (isSel ? '2px solid ' : '1px solid ') + st.bd, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, boxShadow: isSel ? `0 0 0 2px ${st.bd}33` : 'none', transition: 'box-shadow 120ms' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: st.fg }}>{t}{isSel && ' ✓'}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: st.fg }}>{list.length}</div>
                <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{p}%</div>
              </div>);
            })}
          </div>
          {['BLOCKBUSTER','STRONG','MIXED','AVOID'].map((t) => {
            const list = (etMix.bt[t] || []).slice().sort((a: any, b: any) => (b.s || 0) - (a.s || 0));
            if (!list.length) return null; const st = etCol[t];
            return (<div key={t} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: st.fg, marginBottom: 4 }}>{t} - {list.length} - {st.act}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {list.map((x: any) => (<span key={x.t} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--mc-bg-2)', color: 'var(--mc-text-2)', border: '1px solid ' + st.bd, borderRadius: 4, fontWeight: 700 }}>{x.t} <span style={{ color: st.fg, marginLeft: 4 }}>{x.s || ''}</span></span>))}
              </div>
            </div>);
          })}
        </div>
      )}

      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Stat label="CURRENT VALUE" value={fmtRs(totalCur)} />
        <Stat label="TOTAL P&L" value={`${fmtRs(Math.abs(totalPnl))} (${pctTxt(wtdRet)})`} color={totalPnl >= 0 ? '#10B981' : '#EF4444'} />
        <Stat label="DAY P&L" value={fmtRs(Math.abs(dayPnl))} color={dayPnl >= 0 ? '#10B981' : '#EF4444'} />
        <Stat label="WINNERS / LOSERS" value={`${winners.length} / ${losers.length}`} sub={`${priced.length} priced`} />
        <Stat label="TOP-5 CONCENTRATION" value={`${top5pct.toFixed(0)}%`} sub={largest ? `largest ${largest.sym} ${largest.pct.toFixed(0)}%` : ''} color={top5pct > 60 ? '#FBBF24' : '#F5F7FA'} />
        <Stat label="DIVERSIFICATION (HHI)" value={Math.round(hhi).toLocaleString('en-IN')} sub={hhi > 2500 ? 'concentrated' : hhi > 1500 ? 'moderate' : 'well spread'} color={hhi > 2500 ? '#FBBF24' : '#34D399'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Cap allocation */}
        <div style={card}>
          <div style={h}>Market-cap allocation</div>
          {capStats.length === 0 ? <div style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>No cap data yet — refresh to pull live quotes.</div> :
            capStats.map(c => (
              <div key={c.k} onClick={() => onSelectCap?.(c.k)} title={`Show the ${c.count} ${capLabel[c.k]} holding${c.count === 1 ? '' : 's'}`} style={{ cursor: 'pointer' }}>
                <Bar label={capLabel[c.k]} count={c.count} pct={c.valPct} color={CAP_COLORS[c.k]} valueTxt={fmtRs(c.value)} pnl={c.retPct} />
              </div>
            ))}
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 4 }}>% = share of current value · count = holdings · last figure = return on that bucket · <span style={{ color: '#60A5FA' }}>click a bar to see those companies</span></div>
        </div>

        {/* Sector allocation */}
        <div style={card}>
          <div style={h}>Sector allocation</div>
          {sectors.slice(0, 10).map(sct => (
            <Bar key={sct.sector} label={sct.sector} count={sct.count} pct={sct.valPct} color="#22D3EE" valueTxt={fmtRs(sct.value)} pnl={sct.value > 0 ? (sct.pnl / (sct.value - sct.pnl || 1)) * 100 : 0} />
          ))}
        </div>

        {/* Performance & risk */}
        <div style={card}>
          <div style={h}>Performance &amp; risk</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Best performer</span><span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{best ? `${best.symbol} ${pctTxt(best.pnlPercent)}` : '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Worst performer</span><span style={{ color: 'var(--mc-bearish)', fontWeight: 700 }}>{worst ? `${worst.symbol} ${pctTxt(worst.pnlPercent)}` : '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Value-weighted return</span><span style={{ color: wtdRet >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{pctTxt(wtdRet)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Invested → Current</span><span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{fmtRs(totalInv)} → {fmtRs(totalCur)}</span></div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 4 }}>Win rate</div>
              <div style={{ height: 8, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: '100%', width: `${priced.length ? (winners.length / priced.length) * 100 : 0}%`, background: 'var(--mc-bullish)' }} />
                <div style={{ height: '100%', flex: 1, background: 'var(--mc-bearish)' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2 }}>{priced.length ? Math.round((winners.length / priced.length) * 100) : 0}% of priced holdings in profit</div>
            </div>
          </div>
        </div>

        {/* Top winners & losers — 10 each */}
        <div style={card}>
          <div style={h}>Top winners &amp; losers</div>
          {(() => {
            const w = [...priced].filter(r => (r.pnl || 0) > 0).sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0)).slice(0, 10);
            const l = [...priced].filter(r => (r.pnl || 0) < 0).sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0)).slice(0, 10);
            const Row = ({ r, up }: any) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
                <span style={{ color: 'var(--mc-text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{r.symbol}</span>
                <span style={{ color: up ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pctTxt(r.pnlPercent || 0)}</span>
              </div>
            );
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>▲ TOP {w.length} WINNERS</div>
                  {w.length ? w.map(r => <Row key={r.symbol} r={r} up />) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>No winners</div>}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>▼ TOP {l.length} LOSERS</div>
                  {l.length ? l.map(r => <Row key={r.symbol} r={r} up={false} />) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>No losers</div>}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Quality overlay */}
        <div style={card}>
          <div style={h}>Quality overlay</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 10 }}>
            <span style={{ color: 'var(--mc-text-3)' }}>On Conviction Beats</span>
            <span style={{ color: 'var(--mc-warn)', fontWeight: 800 }}>{onCB} / {rows.length}</span>
          </div>
          {Object.keys(tierCounts).length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(tierCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <span key={t} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: `${tierColors[t] || 'var(--mc-text-4)'}22`, color: tierColors[t] || 'var(--mc-text-3)' }}>{t} · {n}</span>
              ))}
            </div>
          ) : <div style={{ fontSize: 11.5, color: 'var(--mc-text-4)', marginBottom: 10 }}>None of your holdings are on the Conviction Beats bench yet.</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--mc-text-3)' }}>Avg quality score</span>
            <span style={{ color: avgScore != null ? (avgScore >= 70 ? 'var(--mc-bullish)' : avgScore >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)') : 'var(--mc-text-4)', fontWeight: 800 }}>{avgScore != null ? avgScore.toFixed(0) : '—'} <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 11 }}>({scored.length} scored)</span></span>
          </div>
        </div>
      </div>

      {/* ── PATCH zzz238 — INSTITUTIONAL ANALYTICS ROW ───────────────────
        Twelve additional decision-grade views on top of the base six.
        All derived from data already on PortfolioRow (no new fetches),
        so they light up instantly on any load. Kept in one flat grid
        below the base blocks to preserve the existing layout order.
      */}
      {(() => {
        // Preload helpers used across blocks
        const totalPnlDay = dayPnl;
        const priced2 = priced;
        const effectiveN = hhi > 0 ? Math.round(10000 / hhi) : 0;
        const capBetaMap: Record<string, number> = { large: 0.85, mid: 1.05, small: 1.25, micro: 1.45, other: 1.0 };
        const wtdBeta = rows.reduce((a, r) => {
          const w = pricedValue(r) / totalCur;
          return a + w * (capBetaMap[normCapBucket(r.cap)] ?? 1.0);
        }, 0);
        // Cross-sectional 1D vol proxy (std dev of holdings' 1D change%)
        const chgArr = priced2.map(r => r.changePercent || 0);
        const meanChg = chgArr.length ? chgArr.reduce((a, b) => a + b, 0) / chgArr.length : 0;
        const varChg = chgArr.length ? chgArr.reduce((a, b) => a + (b - meanChg) ** 2, 0) / chgArr.length : 0;
        const stdChg = Math.sqrt(varChg);
        // Sharpe-like ratio: portfolio wtd return / cross-sectional pnl% stddev
        const pnlPctArr = priced2.map(r => r.pnlPercent || 0);
        const meanPnl = pnlPctArr.length ? pnlPctArr.reduce((a, b) => a + b, 0) / pnlPctArr.length : 0;
        const varPnl = pnlPctArr.length ? pnlPctArr.reduce((a, b) => a + (b - meanPnl) ** 2, 0) / pnlPctArr.length : 0;
        const stdPnl = Math.sqrt(varPnl);
        const riskAdjRet = stdPnl > 0 ? wtdRet / stdPnl : null;
        // Dollar attribution — who moved the needle?
        const attrSorted = [...priced2].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
        const topContribs = attrSorted.filter(r => (r.pnl || 0) > 0).slice(0, 10);
        const worstDrags = [...attrSorted].reverse().filter(r => (r.pnl || 0) < 0).slice(0, 10);
        const topSumP = topContribs.reduce((a, r) => a + (r.pnl || 0), 0);
        const dragSumP = worstDrags.reduce((a, r) => a + (r.pnl || 0), 0);
        // Winner dollars vs loser dollars
        const winnerPnl = priced2.filter(r => (r.pnl || 0) > 0).reduce((a, r) => a + (r.pnl || 0), 0);
        const loserPnl = priced2.filter(r => (r.pnl || 0) < 0).reduce((a, r) => a + Math.abs(r.pnl || 0), 0);
        const winLossRatio = loserPnl > 0 ? winnerPnl / loserPnl : (winnerPnl > 0 ? Infinity : 0);
        // Style tilt (heuristic from cap + score buckets)
        let tiltMomentum = 0, tiltQuality = 0, tiltValue = 0, tiltDeep = 0;
        for (const r of rows) {
          const w = pricedValue(r) / totalCur;
          const s = r.score;
          const c = normCapBucket(r.cap);
          if (typeof s === 'number' && s >= 75) tiltMomentum += w;
          else if (typeof s === 'number' && s >= 60) tiltQuality += w;
          else if (c === 'micro') tiltDeep += w;
          else tiltValue += w;
        }
        const styleTotal = tiltMomentum + tiltQuality + tiltValue + tiltDeep;
        // Position size distribution (weight buckets)
        const sizeBuckets: Record<string, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
        for (const r of rows) {
          const w = (pricedValue(r) / totalCur) * 100;
          if (w < 1) sizeBuckets.XS++;
          else if (w < 2) sizeBuckets.S++;
          else if (w < 4) sizeBuckets.M++;
          else if (w < 6) sizeBuckets.L++;
          else sizeBuckets.XL++;
        }
        // Concentration alerts
        const heavyPositions = rows.filter(r => (pricedValue(r) / totalCur) * 100 >= 5).length;
        const heavySectors = sectors.filter(s => s.valPct >= 25).length;
        const heavySector = sectors[0] && sectors[0].valPct >= 25 ? sectors[0] : null;
        // Loser concentration — % of value in loss-making positions
        const loserVal = priced2.filter(r => (r.pnl || 0) < 0).reduce((a, r) => a + pricedValue(r), 0);
        const loserValPct = totalCur > 0 ? (loserVal / totalCur) * 100 : 0;
        // Trim / turnaround candidates
        const trimCands = priced2.filter(r => {
          const w = (pricedValue(r) / totalCur) * 100;
          return w >= 4 && (r.pnlPercent || 0) >= 30;
        }).sort((a, b) => (b.pnl || 0) - (a.pnl || 0)).slice(0, 4);
        const turnCands = priced2.filter(r => {
          const w = (pricedValue(r) / totalCur) * 100;
          return w <= 2 && (r.pnlPercent || 0) <= -5 && (r.pnlPercent || 0) >= -25;
        }).sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0)).slice(0, 4);
        // Sector risk-adjusted return leaders / laggards
        const sectorRet = sectors.map(s => {
          const inv = rows.filter(r => (r.sector || 'Unclassified') === s.sector)
            .reduce((a, r) => a + (r.investedValue || 0), 0);
          const ret = inv > 0 ? (s.pnl / inv) * 100 : 0;
          return { sector: s.sector, ret, valPct: s.valPct, count: s.count };
        }).filter(s => s.sector !== 'Unclassified');
        const bestSector = [...sectorRet].sort((a, b) => b.ret - a.ret)[0];
        const worstSector = [...sectorRet].sort((a, b) => a.ret - b.ret)[0];
        // Diversification score (0-100 composite)
        const divCount = Math.min(1, rows.length / 30);          // 30+ names = full
        const divSector = Math.min(1, sectors.filter(s => s.sector !== 'Unclassified').length / 8);
        const divHHI = Math.max(0, 1 - (hhi - 500) / 2500);       // 500 hhi ≈ ideal, > 3000 = poor
        const divScore = Math.round((divCount * 0.25 + divSector * 0.25 + divHHI * 0.5) * 100);
        // Portfolio velocity (day P&L as % of current value)
        const dayVelocity = totalCur > 0 ? (totalPnlDay / totalCur) * 100 : 0;
        const StyleBar = ({ label, pct, color }: any) => (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--mc-text-2)', fontWeight: 700 }}>{label}</span>
              <span style={{ color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>{(pct * 100).toFixed(0)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, background: color, borderRadius: 4 }} />
            </div>
          </div>
        );
        const KV = ({ label, value, sub, color }: any) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, marginBottom: 6 }}>
            <span style={{ color: 'var(--mc-text-3)' }}>{label}</span>
            <span style={{ textAlign: 'right' }}>
              <span style={{ color: color || 'var(--mc-text-0)', fontWeight: 800 }}>{value}</span>
              {sub && <span style={{ color: 'var(--mc-text-4)', fontSize: 10.5, marginLeft: 6 }}>{sub}</span>}
            </span>
          </div>
        );
        return (
          <>
            {/* Row A — Risk / diversification / P&L attribution */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {/* Risk profile */}
              <div style={card}>
                <div style={h}>Risk profile</div>
                <KV label="Portfolio beta (cap-derived)" value={wtdBeta.toFixed(2)}
                    sub={wtdBeta > 1.2 ? 'aggressive' : wtdBeta > 1.0 ? 'above market' : wtdBeta < 0.9 ? 'defensive' : 'market-like'}
                    color={wtdBeta > 1.3 ? 'var(--mc-warn)' : 'var(--mc-text-0)'} />
                <KV label="Cross-sectional 1D vol" value={`${stdChg.toFixed(2)}%`}
                    sub={stdChg > 3 ? 'high dispersion' : stdChg > 1.5 ? 'moderate' : 'tight cluster'} />
                <KV label="Cross-sectional return vol" value={`${stdPnl.toFixed(1)}%`}
                    sub="spread of holding returns" />
                <KV label="Risk-adjusted return" value={riskAdjRet != null ? riskAdjRet.toFixed(2) : '—'}
                    sub={riskAdjRet != null && riskAdjRet >= 0.5 ? 'strong per unit risk' : riskAdjRet != null && riskAdjRet >= 0 ? 'positive' : 'below 0'}
                    color={riskAdjRet != null && riskAdjRet >= 0.5 ? 'var(--mc-bullish)' : 'var(--mc-text-0)'} />
                <KV label="Effective N (1/HHI)" value={String(effectiveN)}
                    sub={effectiveN >= 25 ? 'well diversified' : effectiveN >= 15 ? 'moderate' : 'concentrated'} />
              </div>
              {/* P&L attribution — top contributors */}
              <div style={card}>
                <div style={h}>P&amp;L attribution — top contributors</div>
                {topContribs.length ? topContribs.map(r => {
                  const share = totalPnl !== 0 ? ((r.pnl || 0) / totalPnl) * 100 : 0;
                  return (
                    <div key={r.symbol} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{r.symbol}</span>
                        <span style={{ color: (r.pnl || 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtRs(Math.abs(r.pnl || 0))} <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 10.5 }}>{share.toFixed(0)}% of total</span>
                        </span>
                      </div>
                      <div style={{ height: 5, background: 'var(--mc-bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, Math.abs(share))}%`, background: 'var(--mc-bullish)', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                }) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>Not enough data yet</div>}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--mc-bg-2)', fontSize: 11, color: 'var(--mc-text-4)' }}>
                  Top {topContribs.length} drove {totalPnl !== 0 ? Math.round((topSumP / totalPnl) * 100) : 0}% of total P&amp;L
                </div>
              </div>
              {/* Loser drag */}
              <div style={card}>
                <div style={h}>Loser drag</div>
                {worstDrags.length ? worstDrags.map(r => {
                  const share = totalPnl !== 0 ? ((r.pnl || 0) / totalPnl) * 100 : 0;
                  return (
                    <div key={r.symbol} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{r.symbol}</span>
                        <span style={{ color: 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          -{fmtRs(Math.abs(r.pnl || 0))} <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 10.5 }}>{pctTxt(r.pnlPercent || 0)}</span>
                        </span>
                      </div>
                    </div>
                  );
                }) : <div style={{ fontSize: 11.5, color: 'var(--mc-text-4)' }}>No losers — clean sheet</div>}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--mc-bg-2)', fontSize: 11, color: 'var(--mc-text-4)' }}>
                  Losers hold {loserValPct.toFixed(0)}% of current value · the {worstDrags.length} shown are dragging {fmtRs(Math.abs(dragSumP))}
                </div>
              </div>
            </div>

            {/* Row B — Style / concentration alerts / diversification */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {/* Style tilt */}
              <div style={card}>
                <div style={h}>Style tilt (heuristic)</div>
                {styleTotal > 0 ? (
                  <>
                    <StyleBar label="Momentum (score ≥ 75)" pct={tiltMomentum} color="#F59E0B" />
                    <StyleBar label="Quality (score 60-74)" pct={tiltQuality} color="#22D3EE" />
                    <StyleBar label="Value (large/mid, low score)" pct={tiltValue} color="#60A5FA" />
                    <StyleBar label="Deep-value (micro-cap, unscored)" pct={tiltDeep} color="#94A3B8" />
                    <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 6 }}>
                      Bucketed from cap × Multibagger/quality score. Recompute after CB sync.
                    </div>
                  </>
                ) : <div style={{ fontSize: 11.5, color: 'var(--mc-text-4)' }}>Style buckets need scored holdings</div>}
              </div>
              {/* Concentration alerts */}
              <div style={card}>
                <div style={h}>Concentration alerts</div>
                <KV label="Positions ≥ 5% weight" value={String(heavyPositions)}
                    sub={heavyPositions >= 3 ? 'watch drift' : 'well-sized'}
                    color={heavyPositions >= 3 ? 'var(--mc-warn)' : 'var(--mc-bullish)'} />
                <KV label="Sectors ≥ 25% weight" value={String(heavySectors)}
                    sub={heavySectors >= 1 ? (heavySector ? `${heavySector.sector} ${heavySector.valPct.toFixed(0)}%` : '') : 'balanced'}
                    color={heavySectors >= 1 ? 'var(--mc-warn)' : 'var(--mc-bullish)'} />
                <KV label="Top-1 position" value={largest ? `${largest.sym} ${largest.pct.toFixed(1)}%` : '—'}
                    sub={largest && largest.pct >= 8 ? 'high single-name risk' : 'moderate'}
                    color={largest && largest.pct >= 8 ? 'var(--mc-warn)' : 'var(--mc-text-0)'} />
                <KV label="HHI" value={Math.round(hhi).toLocaleString('en-IN')}
                    sub={hhi > 2500 ? 'concentrated' : hhi > 1500 ? 'moderate' : 'well spread'} />
                <KV label="Loser-value drag" value={`${loserValPct.toFixed(0)}%`}
                    sub={loserValPct > 20 ? 'high' : loserValPct > 10 ? 'moderate' : 'low'}
                    color={loserValPct > 20 ? 'var(--mc-warn)' : 'var(--mc-text-0)'} />
              </div>
              {/* Diversification score */}
              <div style={card}>
                <div style={h}>Diversification score</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: divScore >= 70 ? 'var(--mc-bullish)' : divScore >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)' }}>{divScore}</div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>out of 100</div>
                </div>
                <div style={{ height: 8, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ height: '100%', width: `${divScore}%`, background: divScore >= 70 ? 'var(--mc-bullish)' : divScore >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>Names ({rows.length}/30 target)</span><span>{Math.round(divCount * 100)}%</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>Sector spread ({sectors.filter(s => s.sector !== 'Unclassified').length}/8)</span><span>{Math.round(divSector * 100)}%</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>HHI ({Math.round(hhi)})</span><span>{Math.round(divHHI * 100)}%</span></div>
                </div>
              </div>
            </div>

            {/* Row C — Sector leaders / actionable signals / position size */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {/* Sector leader / laggard */}
              <div style={card}>
                <div style={h}>Sector leader &amp; laggard</div>
                <KV label="Best sector" value={bestSector ? `${bestSector.sector}` : '—'}
                    sub={bestSector ? `${pctTxt(bestSector.ret)} · ${bestSector.count} holdings · ${bestSector.valPct.toFixed(0)}% weight` : ''}
                    color="var(--mc-bullish)" />
                <KV label="Worst sector" value={worstSector ? `${worstSector.sector}` : '—'}
                    sub={worstSector ? `${pctTxt(worstSector.ret)} · ${worstSector.count} holdings · ${worstSector.valPct.toFixed(0)}% weight` : ''}
                    color="var(--mc-bearish)" />
                <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px dashed var(--mc-bg-2)', fontSize: 11, color: 'var(--mc-text-4)' }}>
                  Sector return = P&amp;L on invested capital in that sector
                </div>
                {sectorRet.length > 2 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Full ranking</div>
                    {[...sectorRet].sort((a, b) => b.ret - a.ret).map(s => (
                      <div key={s.sector} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '1px 0' }}>
                        <span style={{ color: 'var(--mc-text-2)' }}>{s.sector}</span>
                        <span style={{ color: s.ret >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{pctTxt(s.ret)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Trim / turnaround candidates */}
              <div style={card}>
                <div style={h}>Position facts</div>
                <div style={{ fontSize: 10.5, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>▲ LARGE WINNERS — REVIEW SIZE</div>
                {trimCands.length ? trimCands.map(r => (
                  <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
                    <span style={{ color: 'var(--mc-text-2)' }}>{r.symbol}</span>
                    <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{pctTxt(r.pnlPercent || 0)} · {((pricedValue(r) / totalCur) * 100).toFixed(1)}%</span>
                  </div>
                )) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 6 }}>None (weight ≥4% AND return ≥30%)</div>}
                <div style={{ fontSize: 10.5, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.4px', marginTop: 10, marginBottom: 4 }}>▼ SMALL LOSERS — REVIEW THESIS</div>
                {turnCands.length ? turnCands.map(r => (
                  <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
                    <span style={{ color: 'var(--mc-text-2)' }}>{r.symbol}</span>
                    <span style={{ color: 'var(--mc-bearish)', fontWeight: 700 }}>{pctTxt(r.pnlPercent || 0)} · {((pricedValue(r) / totalCur) * 100).toFixed(1)}%</span>
                  </div>
                )) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>None (weight ≤2% AND return between -25% and -5%)</div>}
              </div>
              {/* Position size distribution */}
              <div style={card}>
                <div style={h}>Position size distribution</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { k: 'XL', label: '≥ 6% weight', count: sizeBuckets.XL, color: '#F59E0B' },
                    { k: 'L',  label: '4–6% weight',  count: sizeBuckets.L,  color: '#FBBF24' },
                    { k: 'M',  label: '2–4% weight',  count: sizeBuckets.M,  color: '#22D3EE' },
                    { k: 'S',  label: '1–2% weight',  count: sizeBuckets.S,  color: '#60A5FA' },
                    { k: 'XS', label: '< 1% weight',  count: sizeBuckets.XS, color: '#64748B' },
                  ].map(row => {
                    const pct = rows.length > 0 ? (row.count / rows.length) * 100 : 0;
                    return (
                      <div key={row.k}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                          <span style={{ color: 'var(--mc-text-2)', fontWeight: 700 }}>{row.k} · {row.label}</span>
                          <span style={{ color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>{row.count} <span style={{ color: 'var(--mc-text-4)', fontSize: 10.5 }}>({pct.toFixed(0)}%)</span></span>
                        </div>
                        <div style={{ height: 5, background: 'var(--mc-bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: row.color, borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--mc-text-4)' }}>
                  Ideal: bell centered on 2–4% for a 25-30 name book · lots of XS = death by a thousand cuts
                </div>
              </div>
            </div>

            {/* Row D — Velocity / winner-loser dollars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div style={card}>
                <div style={h}>Portfolio velocity (today)</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: dayVelocity >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{pctTxt(dayVelocity)}</div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>1-day move on current value</div>
                </div>
                <KV label="Day P&L" value={`${totalPnlDay >= 0 ? '+' : ''}${fmtRs(Math.abs(totalPnlDay))}`}
                    color={totalPnlDay >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
                <KV label="Move vs benchmark (Nifty)" value="see index header"
                    sub="beta suggests amplified vs Nifty" />
                <KV label="Beta-adjusted expected 1D" value={`${(wtdBeta * (dayVelocity / (wtdBeta || 1))).toFixed(2)}%`}
                    sub="portfolio × beta reference" />
              </div>
              <div style={card}>
                <div style={h}>Winner vs loser dollars</div>
                <KV label="Winning positions ₹" value={fmtRs(winnerPnl)} color="var(--mc-bullish)" sub={`${winners.length} names`} />
                <KV label="Losing positions ₹" value={fmtRs(loserPnl)} color="var(--mc-bearish)" sub={`${losers.length} names`} />
                <KV label="Win/Loss ratio" value={winLossRatio === Infinity ? '∞' : winLossRatio.toFixed(2)}
                    sub={winLossRatio >= 3 ? 'strong asymmetry' : winLossRatio >= 1.5 ? 'positive' : 'flat'}
                    color={winLossRatio >= 3 ? 'var(--mc-bullish)' : 'var(--mc-text-0)'} />
                <KV label="Median winner return" value={(() => {
                  const arr = priced2.filter(r => (r.pnl || 0) > 0).map(r => r.pnlPercent || 0).sort((a, b) => a - b);
                  return arr.length ? pctTxt(arr[Math.floor(arr.length / 2)]) : '—';
                })()} />
                <KV label="Median loser return" value={(() => {
                  const arr = priced2.filter(r => (r.pnl || 0) < 0).map(r => r.pnlPercent || 0).sort((a, b) => a - b);
                  return arr.length ? pctTxt(arr[Math.floor(arr.length / 2)]) : '—';
                })()} />
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
