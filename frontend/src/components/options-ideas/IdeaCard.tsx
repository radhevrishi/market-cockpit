'use client';
// Options Ideas — one idea: chart with the structure, the trade plan, the option, and how similar trades did before.
import { useEffect, useState, type CSSProperties } from 'react';
import { createAlertApi } from '@/lib/alerts/client';

export type Bar5 = [number, number, number, number, number];
const C = {
  card: { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 12, padding: 16 } as CSSProperties,
  label: { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--mc-text-3)' } as CSSProperties,
  green: '#10B981', red: '#EF4444', amber: '#F59E0B', cyan: 'var(--mc-cyan, #22D3EE)',
};
export const GRADE_COL: Record<string, string> = { 'A+': '#A855F7', A: '#10B981', B: '#F59E0B', C: '#EF4444' };
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
  // the price range shows the bars, entry, stop and target 1; target 2 only when it is not far beyond (else an arrow marks it)
  const pLo = Math.min(...view.map((b) => b[3])), pHi = Math.max(...view.map((b) => b[2]));
  const core = [s.stop, s.target1, s.trigger];
  let lo = Math.min(pLo, ...core), hi = Math.max(pHi, ...core);
  const span0 = hi - lo;
  const t2In = s.target2 >= lo - span0 * 0.25 && s.target2 <= hi + span0 * 0.25;
  if (t2In) { lo = Math.min(lo, s.target2); hi = Math.max(hi, s.target2); }
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
      {t2In ? hline(s.target2, C.green, 'T2', '2 4') : <text x={W - padR + 4} y={s.target2 > hi ? padT + 10 : H - padB} fontSize={10.5} fill={C.green} fontWeight={700}>{s.target2 > hi ? '↑' : '↓'} T2</text>}
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
      {o.spread ? <div style={{ fontSize: 13, marginTop: 8, padding: '6px 8px', border: '1px dashed var(--mc-border-1)', borderRadius: 8 }}>
        <b>Cheaper: {o.type === 'CALL' ? 'bull call' : 'bear put'} spread</b> — buy {money(m, o.spread.buy)}, sell {money(m, o.spread.sell)} (same expiry). Cost {money(m, o.spread.debit)} ({money(m, o.spread.maxLossPerContract)} a contract, max value {money(m, o.spread.maxValue)}).
        At T1 <span style={{ color: C.green }}>{pct(o.spread.retT1Pct)}</span> · at stop <span style={{ color: C.red }}>{pct(o.spread.retStopPct)}</span> · breakeven {money(m, o.spread.breakeven)}.
        <span style={{ color: 'var(--mc-text-3)' }}> In the study the plain option earned more on average (+22% vs +5–7%); the spread risks less money per trade.</span>
      </div> : null}
      {o.sellPut ? <div style={{ fontSize: 13, marginTop: 6, padding: '6px 8px', border: '1px dashed var(--mc-border-1)', borderRadius: 8 }}>
        <b>Income instead: sell a put</b> — {money(m, o.sellPut.strike)} put, {o.sellPut.expiry} ({o.sellPut.dte}d), collect about {money(m, o.sellPut.premium)} ({o.sellPut.returnIfExpiresPct}% of the cash set aside, {money(m, o.sellPut.cashNeeded)} a contract). If the stock ends below {money(m, o.sellPut.strike)} you buy it at an effective {money(m, o.sellPut.breakeven)}.
        <span style={{ color: 'var(--mc-text-3)' }}> Only for stocks you want to own. Study: +0.6% of the strike a month, profitable 60% of the time.</span>
      </div> : null}
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
      {idea.ctx ? <CtxChips idea={idea} /> : null}
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
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Sizer idea={idea} />
        <AlertButtons idea={idea} />
      </div>
    </div>
  );
}

function Chip({ text, col, title }: { text: string; col: string; title?: string }) {
  return <span title={title} style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${col}`, color: col, whiteSpace: 'nowrap' }}>{text}</span>;
}
function CtxChips({ idea }: { idea: any }) {
  const c = idea.ctx, o = idea.option;
  const chips: any[] = [];
  if (c.gapDaysAgo != null) chips.push(<Chip key="g" col={C.green} text={`⚡ Gap up ${c.gapDaysAgo}d ago on 2×+ volume`} title="A results-style gap: open ≥ 5% above the previous close on ≥ 2× the 50-day volume" />);
  if (c.rvol >= 1.3) chips.push(<Chip key="v" col={C.green} text={`Volume ${c.rvol}× normal today`} />);
  chips.push(<Chip key="h" col={c.hvPct >= 70 ? C.amber : c.hvPct <= 30 ? C.green : 'var(--mc-text-3)'} text={`Volatility ${c.hv20}% · ${c.hvPct}th pct of its year`} title="20-day historical volatility against its own last year. ≥ 70th: options are expensive; ≤ 30th: cheap" />);
  if (c.sector) chips.push(<Chip key="s" col={c.sectorRet3m != null && c.indexRet3m != null ? (c.sectorRet3m > c.indexRet3m ? C.green : C.red) : 'var(--mc-text-3)'} text={`${c.sector}: ${c.sectorRet3m != null ? `${c.sectorRet3m > 0 ? '+' : ''}${c.sectorRet3m}%` : '—'} 3m vs index ${c.indexRet3m != null ? `${c.indexRet3m > 0 ? '+' : ''}${c.indexRet3m}%` : '—'}`} />);
  if (c.nextResults) chips.push(<Chip key="r" col={o?.results?.beforeExpiry ? C.red : o?.results?.movedExpiry ? C.amber : 'var(--mc-text-2)'} text={`Results ${c.nextResults}${o?.results?.beforeExpiry ? ' — before expiry ⚠' : o?.results?.movedExpiry ? ' — expiry moved earlier' : ''}`} />);
  else chips.push(<Chip key="r" col="var(--mc-text-3)" text="Results date not found — check it" />);
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{chips}</div>;
}

const SIZER_KEY = 'mc:options-ideas:sizer:v1';
function Sizer({ idea }: { idea: any }) {
  const m = idea.market, o = idea.option;
  const [cfg, setCfg] = useState<{ acct: number; risk: number }>({ acct: m === 'US' ? 50000 : 2000000, risk: 1 });
  useEffect(() => { try { const all = JSON.parse(localStorage.getItem(SIZER_KEY) || '{}'); if (all[m]) setCfg(all[m]); } catch { /* */ } }, [m]);
  const save = (v: { acct: number; risk: number }) => { setCfg(v); try { const all = JSON.parse(localStorage.getItem(SIZER_KEY) || '{}'); all[m] = v; localStorage.setItem(SIZER_KEY, JSON.stringify(all)); } catch { /* */ } };
  const budget = (cfg.acct * cfg.risk) / 100;
  const n = (perC: number | null | undefined) => (perC && perC > 0 ? Math.floor(budget / perC) : 0);
  const streak = Math.round((1 - Math.pow(1 - cfg.risk / 100, 10)) * 1000) / 10;
  const inp: CSSProperties = { width: 110, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'transparent', color: 'var(--mc-text-0)' };
  return (
    <div style={{ border: '1px solid var(--mc-border-1)', borderRadius: 10, padding: 10, fontSize: 13 }}>
      <div style={C.label}>Position size</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <label>Account {m === 'US' ? '$' : '₹'} <input type="number" value={cfg.acct} onChange={(e) => save({ ...cfg, acct: Math.max(0, Number(e.target.value) || 0) })} style={inp} /></label>
        <label>Risk a trade % <input type="number" step="0.25" value={cfg.risk} onChange={(e) => save({ ...cfg, risk: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} style={{ ...inp, width: 64 }} /></label>
      </div>
      {o ? <div style={{ marginTop: 6, lineHeight: 1.6 }}>
        Budget <b>{money(m, budget)}</b> (the whole premium can be lost) →
        {' '}<b>{n(o.maxLossPerContract)}</b> {m === 'US' ? 'contract(s)' : 'lot(s)'} of the suggested option
        {o.spread ? <> · <b>{n(o.spread.maxLossPerContract)}</b> of the spread</> : null}
        {m === 'IN' && o.maxLossPerContract > budget ? <div style={{ color: C.red, fontWeight: 700 }}>⚠ One lot ({money(m, o.maxLossPerContract)}) is more than your risk budget — skip it, use the spread{o.spread && o.spread.maxLossPerContract <= budget ? ' (fits)' : ''}, or trade fewer shares of the stock.</div> : null}
        {m === 'US' && n(o.maxLossPerContract) === 0 ? <div style={{ color: C.red, fontWeight: 700 }}>⚠ One contract is more than your risk budget.</div> : null}
        <div style={{ color: 'var(--mc-text-3)', fontSize: 12 }}>With 1 in 3–4 trades winning, 8–12 losses in a row are normal. At {cfg.risk}% a trade, 10 straight losses cost about {streak}% of the account.</div>
      </div> : <div style={{ color: 'var(--mc-text-3)' }}>No option plan to size.</div>}
    </div>
  );
}

function AlertButtons({ idea }: { idea: any }) {
  const [st, setSt] = useState<string | null>(null);
  const s = idea.setup, call = s.side === 'CALL', m = idea.market;
  const make = async () => {
    setSt('Saving…');
    const base = { target: { kind: 'ticker' as const, id: `${m}:${idea.ticker}`, label: idea.ticker }, interval: 'D' as const, trigger: 'once' as const, session: 'regular' as const, notify: { app: true as const, toast: true, browser: true, telegram: true, email: false, push: true } };
    const days = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const out: string[] = [];
    if (!s.triggered) {
      const r = await createAlertApi({ ...base, name: `${idea.ticker} ${call ? 'call' : 'put'} trigger`, conditions: [{ type: call ? 'price_cross_up' : 'price_cross_down', value: s.trigger }], expiresAt: days(8), message: `Options Ideas: ${idea.ticker} ${s.label} triggered at ${money(m, s.trigger)} — check the plan (stop ${money(m, s.stop)}).` });
      out.push(r.ok ? 'trigger ✓' : `trigger ✗ ${r.error ?? ''}`);
    }
    const r2 = await createAlertApi({ ...base, name: `${idea.ticker} ${call ? 'call' : 'put'} stop`, conditions: [{ type: call ? 'price_cross_down' : 'price_cross_up', value: s.stop }], expiresAt: days(60), message: `Options Ideas: ${idea.ticker} hit the stop ${money(m, s.stop)} — the setup has failed; exit.` });
    out.push(r2.ok ? 'stop ✓' : `stop ✗ ${r2.error ?? ''}`);
    const r3 = await createAlertApi({ ...base, name: `${idea.ticker} ${call ? 'call' : 'put'} target 1`, conditions: [{ type: call ? 'price_cross_up' : 'price_cross_down', value: s.target1 }], expiresAt: days(60), message: `Options Ideas: ${idea.ticker} reached target 1 ${money(m, s.target1)} — take half, stop to entry.` });
    out.push(r3.ok ? 'target ✓' : `target ✗ ${r3.error ?? ''}`);
    setSt(`Alerts: ${out.join(' · ')}`);
  };
  return (
    <div style={{ border: '1px solid var(--mc-border-1)', borderRadius: 10, padding: 10, fontSize: 13 }}>
      <div style={C.label}>Alerts</div>
      <div style={{ marginTop: 4 }}>Get a phone / app alert at the {s.triggered ? '' : 'entry trigger, the '}stop and target 1.</div>
      <button onClick={make} disabled={st === 'Saving…'} style={{ marginTop: 6, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--mc-cyan, #22D3EE)', background: 'transparent', color: 'var(--mc-text-0)', fontWeight: 700, cursor: 'pointer' }}>🔔 Set alerts</button>
      {st ? <div style={{ marginTop: 6, fontSize: 12.5 }}>{st}</div> : null}
    </div>
  );
}

/** zzz1301g — chart of a company with no setup: candles, its trendlines / cup rims, and 3-touch levels */
export function StructureChart({ bars, structure, height = 280 }: { bars: Bar5[]; structure: any; height?: number }) {
  const view = bars.slice(-180);
  if (view.length < 20) return null;
  const W = 760, H = height, padR = 70, padT = 10, padB = 18;
  const t0 = ms(view[0][0]), t1 = ms(view[view.length - 1][0]);
  const pLo = Math.min(...view.map((b) => b[3])), pHi = Math.max(...view.map((b) => b[2]));
  const span = pHi - pLo;
  const levels = (structure?.levels ?? []).filter((l: any) => l.price >= pLo - span * 0.3 && l.price <= pHi + span * 0.3);
  let lo = Math.min(pLo, ...levels.map((l: any) => l.price)), hi = Math.max(pHi, ...levels.map((l: any) => l.price));
  const padP = (hi - lo) * 0.04; lo -= padP; hi += padP;
  const n = view.length, cw = (W - padR) / n;
  const x = (i: number) => i * cw + cw / 2;
  const xt = (t: number) => ((ms(t) - t0) / Math.max(1, t1 - t0)) * (x(n - 1) - x(0)) + x(0);
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8 }}>
      {view.map((b, i) => { const up = b[4] >= b[1], col = up ? C.green : C.red; return <g key={i}>
        <line x1={x(i)} x2={x(i)} y1={y(b[2])} y2={y(b[3])} stroke={col} strokeWidth={1} />
        <rect x={x(i) - cw * 0.32} width={cw * 0.64} y={y(Math.max(b[1], b[4]))} height={Math.max(1, Math.abs(y(b[1]) - y(b[4])))} fill={col} />
      </g>; })}
      {levels.map((l: any, k: number) => <g key={'l' + k}>
        <line x1={0} x2={W - padR} y1={y(l.price)} y2={y(l.price)} stroke={l.kind === 'support' ? '#60A5FA' : '#F59E0B'} strokeWidth={1.2} strokeDasharray="5 4" />
        <text x={W - padR + 4} y={y(l.price) + 4} fontSize={10.5} fontWeight={700} fill={l.kind === 'support' ? '#60A5FA' : '#F59E0B'}>{l.kind === 'support' ? 'S' : 'R'} {l.price >= 1000 ? Math.round(l.price) : l.price.toFixed(1)}</text>
      </g>)}
      {(structure?.lines ?? []).map((l: any, k: number) => {
        const [ta, pa] = l.from, [tb, pb] = l.to; const xa = xt(ta), xb = xt(tb);
        const at = (xx: number) => pa + ((pb - pa) * (xx - xa)) / ((xb - xa) || 1);
        const X0 = Math.max(0, Math.min(xa, xb)), X1 = Math.min(W - padR, Math.max(xa, xb));
        if (X1 <= X0) return null;
        return <line key={k} x1={X0} x2={X1} y1={y(at(X0))} y2={y(at(X1))} stroke={l.kind === 'rim' ? '#F472B6' : '#A78BFA'} strokeWidth={2} />;
      })}
    </svg>
  );
}
