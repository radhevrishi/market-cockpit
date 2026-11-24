'use client';
// Options Ideas — one idea: chart with the structure, the trade plan, the option, and how similar trades did before.
import type { CSSProperties } from 'react';

export type Bar5 = [number, number, number, number, number];
const C = {
  card: { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 12, padding: 16 } as CSSProperties,
  label: { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--mc-text-3)' } as CSSProperties,
  green: '#10B981', red: '#EF4444', amber: '#F59E0B', cyan: 'var(--mc-cyan, #22D3EE)',
};
export const GRADE_COL: Record<string, string> = { A: '#10B981', B: '#F59E0B', C: '#EF4444' };
const money = (m: string, x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${m === 'US' ? '$' : '₹'}${x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x.toFixed(2)}`);
const pct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const ms = (t: number) => (t > 1e11 ? t : t * 1000);

export function GradeBadge({ g, big }: { g: string; big?: boolean }) {
  return <span style={{ display: 'inline-block', minWidth: big ? 34 : 24, textAlign: 'center', padding: big ? '4px 8px' : '1px 6px', borderRadius: 6, fontWeight: 900, fontSize: big ? 18 : 12.5, color: '#fff', background: GRADE_COL[g] || '#64748B' }}>{g}</span>;
}
export function SideBadge({ side }: { side: string }) {
  const call = side === 'CALL';
  return <span style={{ padding: '1px 7px', borderRadius: 6, fontWeight: 800, fontSize: 12, color: call ? C.green : C.red, border: `1px solid ${call ? C.green : C.red}` }}>{call ? '▲ CALL' : '▼ PUT'}</span>;
}

/** small candle chart with the setup's lines and the plan levels */
export function SetupChart({ bars, idea, height = 260 }: { bars: Bar5[]; idea: any; height?: number }) {
  const view = bars.slice(-140);
  if (view.length < 20) return null;
  const s = idea.setup;
  const W = 760, H = height, padR = 70, padT = 10, padB = 18;
  const t0 = ms(view[0][0]), t1 = ms(view[view.length - 1][0]);
  const levels = [s.stop, s.target1, s.target2, s.trigger];
  let lo = Math.min(...view.map((b) => b[3]), ...levels), hi = Math.max(...view.map((b) => b[2]), ...levels);
  const padP = (hi - lo) * 0.04; lo -= padP; hi += padP;
  const n = view.length, cw = (W - padR) / n;
  const x = (i: number) => i * cw + cw / 2;
  const xt = (t: number) => ((ms(t) - t0) / Math.max(1, t1 - t0)) * (x(n - 1) - x(0)) + x(0);
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  const hline = (p: number, col: string, label: string, dash?: string) => (
    <g key={label}>
      <line x1={0} x2={W - padR} y1={y(p)} y2={y(p)} stroke={col} strokeWidth={1.2} strokeDasharray={dash} />
      <text x={W - padR + 4} y={y(p) + 4} fontSize={10.5} fill={col} fontWeight={700}>{label}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--mc-bg-0, transparent)', borderRadius: 8 }}>
      {view.map((b, i) => {
        const up = b[4] >= b[1];
        const col = up ? C.green : C.red;
        return <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={y(b[2])} y2={y(b[3])} stroke={col} strokeWidth={1} />
          <rect x={x(i) - cw * 0.32} width={cw * 0.64} y={y(Math.max(b[1], b[4]))} height={Math.max(1, Math.abs(y(b[1]) - y(b[4])))} fill={col} />
        </g>;
      })}
      {(s.lines || []).map((l: any, k: number) => {
        const [ta, pa] = l.from, [tb, pb] = l.to;
        // clip the line to the visible window (straight in time)
        const xa = xt(ta), xb = xt(tb);
        const at = (xx: number) => pa + ((pb - pa) * (xx - xa)) / ((xb - xa) || 1);
        const X0 = Math.max(0, Math.min(xa, xb)), X1 = Math.min(W - padR, Math.max(xa, xb));
        if (X1 <= X0) return null;
        return <line key={k} x1={X0} x2={X1} y1={y(at(X0))} y2={y(at(X1))} stroke={l.kind === 'trend' ? '#A78BFA' : l.kind === 'rim' ? '#F472B6' : '#60A5FA'} strokeWidth={2} />;
      })}
      {hline(s.target2, C.green, 'T2', '2 4')}
      {hline(s.target1, C.green, 'T1')}
      {hline(s.trigger, '#60A5FA', 'Entry', '4 3')}
      {hline(s.stop, C.red, 'Stop')}
    </svg>
  );
}

function Stat({ k, v, sub, col }: { k: string; v: string; sub?: string; col?: string }) {
  return <div style={{ minWidth: 90 }}>
    <div style={C.label}>{k}</div>
    <div style={{ fontSize: 17, fontWeight: 800, color: col || 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    {sub ? <div style={{ fontSize: 11.5, color: 'var(--mc-text-3)' }}>{sub}</div> : null}
  </div>;
}

export function HistoryLine({ h, compact }: { h: any; compact?: boolean }) {
  if (!h) return <span style={{ color: 'var(--mc-text-3)' }}>too few past trades</span>;
  const col = h.trailR > 0.1 ? C.green : h.trailR < 0 ? C.red : C.amber;
  if (compact) return <span title={`${h.n} past trades · won ${h.winRate}% · ${h.trailR} R a trade · option ${pct(h.optAvgRet)} avg (${h.optWinRate}% made money) · before hold-out ${h.trainR} R, after ${h.testR} R`} style={{ color: col, fontWeight: 700 }}>{h.winRate}% · {h.trailR > 0 ? '+' : ''}{h.trailR}R <span style={{ color: 'var(--mc-text-3)', fontWeight: 400 }}>n{h.n}</span></span>;
  return <span>
    <b style={{ color: col }}>{h.n.toLocaleString('en-US')} past trades: {h.winRate}% reached target 1, {h.trailR > 0 ? '+' : ''}{h.trailR} R a trade</b>
    {' '}(before the hold-out {h.trainR > 0 ? '+' : ''}{h.trainR} R · after {h.testR > 0 ? '+' : ''}{h.testR} R). Options: {pct(h.optAvgRet)} a trade on average, {h.optWinRate}% of trades made money. Median {h.medSessions} sessions to target 1.
  </span>;
}

function OptionBox({ o, m }: { o: any; m: string }) {
  if (!o) return <div style={{ color: 'var(--mc-text-3)', fontSize: 13 }}>No option plan — {m === 'IN' ? 'this company has no NSE stock options (no F&O lot size).' : 'no usable strike was found.'}</div>;
  const row = (label: string, p: any, main?: boolean) => p && (
    <tr key={label} style={{ borderTop: '1px solid var(--mc-border-1)', fontWeight: main ? 700 : 400 }}>
      <td style={{ padding: '5px 6px' }}>{label}</td>
      <td style={{ padding: '5px 6px' }}>{money(m, p.strike)} <span style={{ color: 'var(--mc-text-3)', fontSize: 11.5 }}>{p.moneyness}</span></td>
      <td style={{ padding: '5px 6px' }}>{p.expiry} <span style={{ color: 'var(--mc-text-3)', fontSize: 11.5 }}>{p.dte}d</span></td>
      <td style={{ padding: '5px 6px' }}>{money(m, p.premium)} <span style={{ color: 'var(--mc-text-3)', fontSize: 11.5 }}>{p.premiumSource === 'chain' ? 'live' : 'model'}</span></td>
      <td style={{ padding: '5px 6px' }}>{Math.abs(p.delta).toFixed(2)}</td>
      <td style={{ padding: '5px 6px', color: C.green }}>{pct(p.atTarget1?.retPct)}</td>
      <td style={{ padding: '5px 6px', color: C.green }}>{pct(p.atTarget2?.retPct)}</td>
      <td style={{ padding: '5px 6px', color: C.red }}>{pct(p.atStop?.retPct)}</td>
      <td style={{ padding: '5px 6px' }}>{money(m, p.breakeven)}</td>
    </tr>
  );
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr style={{ color: 'var(--mc-text-3)', fontSize: 11.5, textAlign: 'left' }}>
            <th style={{ padding: '4px 6px' }}>Choice</th><th style={{ padding: '4px 6px' }}>Strike</th><th style={{ padding: '4px 6px' }}>Expiry</th><th style={{ padding: '4px 6px' }}>Premium</th><th style={{ padding: '4px 6px' }}>Delta</th>
            <th style={{ padding: '4px 6px' }}>At T1</th><th style={{ padding: '4px 6px' }}>At T2</th><th style={{ padding: '4px 6px' }}>At stop</th><th style={{ padding: '4px 6px' }}>Breakeven</th>
          </tr></thead>
          <tbody>
            {row(`★ ${o.type} (suggested)`, o, true)}
            {row('Safer (deeper in the money)', o.safer)}
            {row('Aggressive (cheaper)', o.aggressive)}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--mc-text-2)', marginTop: 6 }}>
        Max loss per contract: <b>{money(m, o.maxLossPerContract)}</b> ({o.contractSize} {m === 'US' ? 'shares' : 'shares a lot'}) · IV {o.iv}%
        {o.liquidity ? <> · OI {o.liquidity.oi ?? '—'} · spread {o.liquidity.spreadPct ?? '—'}%</> : null}
      </div>
      {o.notes?.length ? <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12.5, color: 'var(--mc-text-3)' }}>{o.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul> : null}
    </div>
  );
}

export function IdeaCard({ idea, bars }: { idea: any; bars?: Bar5[] | null }) {
  const s = idea.setup, m = idea.market;
  return (
    <div style={{ ...C.card, borderLeft: `4px solid ${GRADE_COL[idea.grade]}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <GradeBadge g={idea.grade} big />
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{idea.ticker} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--mc-text-3)' }}>{idea.name || ''}</span></div>
          <div style={{ fontSize: 13, color: 'var(--mc-text-2)' }}><SideBadge side={s.side} /> &nbsp;{s.label} · quality {s.quality} · {idea.regime}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: GRADE_COL[idea.grade] }}>{idea.verdict}</div>
      </div>
      {idea.caution ? <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid #F59E0B', color: '#F59E0B', fontSize: 13, fontWeight: 600 }}>⚠ {idea.caution}</div> : null}
      {bars?.length ? <div style={{ marginTop: 10 }}><SetupChart bars={bars} idea={idea} /></div> : null}
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12 }}>
        <Stat k="Entry trigger" v={money(m, s.trigger)} sub={s.triggered ? 'already triggered' : 'not yet'} col="#60A5FA" />
        <Stat k="Stop" v={money(m, s.stop)} sub={`${s.riskPct}% risk`} col={C.red} />
        <Stat k="Target 1" v={money(m, s.target1)} sub={`${s.rr1}× the risk`} col={C.green} />
        <Stat k="Target 2" v={money(m, s.target2)} col={C.green} />
        <Stat k="Price" v={money(m, idea.price)} sub={idea.asOf} />
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <div>
          <div style={C.label}>Trade plan</div>
          <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 13.5, lineHeight: 1.5 }}>
            <li><b>Entry:</b> {idea.plan.entry}</li>
            <li><b>Targets:</b> {idea.plan.target}</li>
            <li><b>Stop:</b> {idea.plan.stop}</li>
            <li><b>Manage:</b> {idea.plan.manage}</li>
          </ul>
          <div style={{ fontSize: 13, color: 'var(--mc-text-2)', marginTop: 6 }}><b>Why:</b> {idea.plan.why} {(s.reasons || []).join(' · ')}</div>
        </div>
        <div>
          <div style={C.label}>Checks that mattered in the study</div>
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, fontSize: 13.5, lineHeight: 1.6 }}>
            {idea.checks.map((c: any, i: number) => <li key={i}><span style={{ color: c.ok ? C.green : c.ok === false ? C.red : 'var(--mc-text-3)', fontWeight: 800 }}>{c.ok ? '✓' : c.ok === false ? '✗' : '?'}</span> {c.label}</li>)}
          </ul>
          <div style={{ ...C.label, marginTop: 8 }}>How trades like this did before</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div><b>This setup, same grade:</b> <HistoryLine h={idea.history.setup} /></div>
            <div style={{ marginTop: 4 }}><b>All {s.side === 'CALL' ? 'calls' : 'puts'}, grade {idea.grade}:</b> <HistoryLine h={idea.history.group} /></div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={C.label}>Option</div>
        <OptionBox o={idea.option} m={m} />
      </div>
    </div>
  );
}
