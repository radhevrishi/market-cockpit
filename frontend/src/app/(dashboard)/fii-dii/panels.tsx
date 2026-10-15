// zzz1060 — FII / DII page: insight panels beyond the raw flows. Each renders nothing when its data is missing (no empty boxes).
'use client';

import { LongPctChart } from './charts';
import { fmtCr, fmtDate, flowColor, GREEN, RED } from './format';

type Tone = 'very-bearish' | 'bearish' | 'neutral' | 'bullish' | 'very-bullish';
const LINE = '#e2e8f0', SOFT = '#475569', FAINT = '#94a3b8';
const TONE: Record<Tone, { fg: string; bg: string; bd: string }> = {
  'very-bearish': { fg: RED, bg: '#fef2f2', bd: '#fecaca' },
  bearish: { fg: '#c2410c', bg: '#fff7ed', bd: '#fed7aa' },
  neutral: { fg: '#475569', bg: '#f8fafc', bd: LINE },
  bullish: { fg: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0' },
  'very-bullish': { fg: GREEN, bg: '#ecfdf5', bd: '#a7f3d0' },
};
const box: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 };
const H = ({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
    {sub ? <div style={{ fontSize: 12, color: SOFT }}>{sub}</div> : null}
  </div>
);
const Pill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, color: TONE[tone].fg, background: TONE[tone].bg, border: `1px solid ${TONE[tone].bd}` }}>{children}</span>
);

export function SummaryBox({ lines, date }: { lines: string[]; date: string | null }) {
  if (!lines.length) return null;
  return (
    <div style={{ ...box, borderLeft: '4px solid #1d4ed8', background: '#f8fbff' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8', marginBottom: 6 }}>What it means today{date ? ` · ${fmtDate(date)}` : ''}</div>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: '#0f172a' }}>{lines.join(' ')}</div>
      <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Written by fixed rules from the figures on this page — no AI, no forecast.</div>
    </div>
  );
}

// ── FII futures positioning ──────────────────────────────────────────────────

export interface PositioningV {
  latest: { date: string; longPct: number; ratio: number | null; long: number; short: number; net: number; callNet: number; putNet: number; clientLongPct: number | null };
  verdict: { tone: Tone; label: string; text: string };
  change5: number | null; yearLow: number; yearHigh: number; rankPct: number | null; days: number;
  options: { tone: Tone; text: string };
  series: Array<{ date: string; longPct: number; ratio: number | null }>;
}

function Gauge({ pct }: { pct: number }) {
  // horizontal 0–100 scale with the red (<30) and green (>70) zones and a marker
  return (
    <div style={{ position: 'relative', height: 34, marginTop: 6 }}>
      <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', border: `1px solid ${LINE}` }}>
        <div style={{ width: '30%', background: '#fee2e2' }} /><div style={{ width: '40%', background: '#f8fafc' }} /><div style={{ width: '30%', background: '#dcfce7' }} />
      </div>
      <div style={{ position: 'absolute', top: 2, left: `calc(${Math.max(0, Math.min(100, pct))}% - 2px)`, width: 4, height: 24, background: '#0f172a', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 22, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: FAINT }}>
        <span>0% long</span><span style={{ marginLeft: '22%' }}>30%</span><span>50%</span><span style={{ marginRight: '22%' }}>70%</span><span>100%</span>
      </div>
    </div>
  );
}

export function PositioningPanel({ p }: { p: PositioningV | null | undefined }) {
  if (!p) return null;
  const L = p.latest;
  return (
    <div style={box}>
      <H sub="NSE participant-wise open interest: of all the Nifty / Bank Nifty futures contracts foreign investors hold, how many are bets on a rise (long) vs a fall (short). A classic sentiment gauge.">
        FII bets in index futures
      </H>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: TONE[p.verdict.tone].fg }}>{L.longPct}%</span>
            <span style={{ fontSize: 13, color: SOFT }}>long on {fmtDate(L.date)}</span>
            <Pill tone={p.verdict.tone}>{p.verdict.label}</Pill>
          </div>
          <Gauge pct={L.longPct} />
          <div style={{ fontSize: 13, color: '#0f172a', marginTop: 8, lineHeight: 1.5 }}>{p.verdict.text}</div>
        </div>
        <div style={{ flex: '1 1 240px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['Long ÷ short', L.ratio != null ? L.ratio.toFixed(2) : '—', 'Below 1 = more short bets than long'],
            ['Change in 5 days', p.change5 != null ? `${p.change5 > 0 ? '+' : ''}${p.change5} pts` : '—', 'Points of long % gained or lost over 5 sessions'],
            ['Last-year range', `${p.yearLow}% – ${p.yearHigh}%`, `Over ${p.days} stored sessions`],
            ['Where today sits', p.rankPct != null ? (p.rankPct <= 5 ? 'Bottom 5%' : p.rankPct >= 95 ? 'Top 5%' : `${p.rankPct}% of days lower`) : '—', 'Share of last-year days with a lower long %'],
            ['Contracts long / short', `${L.long.toLocaleString('en-IN')} / ${L.short.toLocaleString('en-IN')}`, 'Index futures contracts'],
            ['Retail (clients) long', L.clientLongPct != null ? `${L.clientLongPct}%` : '—', 'Retail is often on the other side of FIIs'],
          ].map(([k, v, t]) => (
            <div key={k} title={t} style={{ background: '#f8fafc', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ fontSize: 11, color: SOFT }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {p.series.length >= 5 ? <div style={{ marginTop: 12 }}><LongPctChart series={p.series} /></div> : null}
      <div style={{ fontSize: 13, color: '#0f172a', marginTop: 8, padding: '8px 10px', borderRadius: 8, background: TONE[p.options.tone].bg, border: `1px solid ${TONE[p.options.tone].bd}` }}>{p.options.text}</div>
      <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Example: 9% long means for every 100 index-futures contracts FIIs hold, 9 gain if the market rises and 91 gain if it falls. Very one-sided readings have often come before sharp short-covering rallies — history, not a promise.</div>
    </div>
  );
}

// ── DII absorption + FII vs market ───────────────────────────────────────────

export interface AbsorptionV { sessions: number; fii: number; dii: number; ratio: number | null; pct: number | null; tone: Tone; verdict: string }

export function AbsorptionPanel({ rows }: { rows: AbsorptionV[] | undefined }) {
  if (!rows || !rows.length) return null;
  return (
    <div style={{ ...box, flex: '1 1 340px' }}>
      <H sub="Of the money foreigners took out, how much Indian institutions put back in. 100% = fully absorbed.">Domestic absorption</H>
      {rows.map((a) => (
        <div key={a.sessions} style={{ padding: '8px 0', borderTop: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>Last {a.sessions} sessions</b>
            <span style={{ fontSize: 12, color: SOFT }}>FII <b style={{ color: flowColor(a.fii) }}>{fmtCr(a.fii, { signed: true })}</b> · DII <b style={{ color: flowColor(a.dii) }}>{fmtCr(a.dii, { signed: true })}</b></span>
          </div>
          {a.pct != null ? (
            <div title={`DII ${fmtCr(a.dii, { signed: true })} ÷ FII selling ${fmtCr(Math.abs(a.fii))} = ${a.pct}%`} style={{ position: 'relative', height: 12, background: '#fee2e2', borderRadius: 6, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(0, Math.min(100, a.pct))}%`, height: 12, background: '#34d399' }} />
              {a.pct > 100 ? <div style={{ position: 'absolute', right: 4, top: -1, fontSize: 10, color: '#065f46', fontWeight: 700 }}>{a.pct}%</div> : null}
            </div>
          ) : null}
          <div style={{ marginTop: 6 }}><Pill tone={a.tone}>{a.pct != null ? `${a.pct}% absorbed` : 'No selling'}</Pill> <span style={{ fontSize: 13 }}>{a.verdict}</span></div>
        </div>
      ))}
    </div>
  );
}

export interface MarketV { sessions: number; from: string; to: string; fiiCr: number; diiCr: number | null; niftyFrom: number; niftyTo: number; niftyPct: number; tone: Tone; verdict: string }

export function MarketPanel({ m }: { m: MarketV | null | undefined }) {
  if (!m) return null;
  return (
    <div style={{ ...box, flex: '1 1 340px', background: TONE[m.tone].bg, borderColor: TONE[m.tone].bd }}>
      <H sub={`${fmtDate(m.from)} – ${fmtDate(m.to)}`}>FII selling vs the market ({m.sessions} sessions)</H>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['FII net', fmtCr(m.fiiCr, { signed: true }), flowColor(m.fiiCr)],
          ...(m.diiCr != null ? [['DII net', fmtCr(m.diiCr, { signed: true }), flowColor(m.diiCr)]] : []),
          ['Nifty 50', `${m.niftyPct > 0 ? '+' : m.niftyPct < 0 ? '−' : ''}${Math.abs(m.niftyPct)}%`, flowColor(m.niftyPct)],
        ].map(([k, v, c]) => (
          <div key={k} style={{ flex: '1 1 90px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px' }}>
            <div style={{ fontSize: 11, color: SOFT }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: SOFT, marginTop: 6 }}>Nifty {Math.round(m.niftyFrom).toLocaleString('en-IN')} → {Math.round(m.niftyTo).toLocaleString('en-IN')}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: TONE[m.tone].fg }}>{m.verdict}</div>
    </div>
  );
}

// ── streak history ───────────────────────────────────────────────────────────

interface Run { dir: 'buy' | 'sell'; days: number; from: string; to: string; totalCr: number }
export interface StreakHistoryV { current: Run | null; rank: number | null; ofRuns: number; longerLastSeen: string | null; topSell: Run[]; topBuy: Run[]; firstDate: string | null }

function RunBars({ runs, current, dir }: { runs: Run[]; current: Run | null; dir: 'buy' | 'sell' }) {
  if (!runs.length) return null;
  const max = Math.max(...runs.map((r) => r.days), current?.dir === dir ? current.days : 0);
  const c = dir === 'sell' ? '#ef4444' : '#10b981';
  return (
    <div style={{ flex: '1 1 260px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: dir === 'sell' ? RED : GREEN, marginBottom: 4 }}>Longest {dir === 'sell' ? 'selling' : 'buying'} runs</div>
      {runs.map((r) => {
        const isCur = current && r.from === current.from && r.dir === current.dir;
        return (
          <div key={r.from} title={`${fmtDate(r.from)} – ${fmtDate(r.to)} · ${fmtCr(r.totalCr, { signed: true })}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0' }}>
            <span style={{ width: 128, color: isCur ? '#0f172a' : SOFT, fontWeight: isCur ? 700 : 400, whiteSpace: 'nowrap' }}>{isCur ? 'Now · ' : ''}{fmtDate(r.to)}</span>
            <div style={{ flex: 1, height: 10, background: '#f1f5f9', borderRadius: 3 }}>
              <div style={{ width: `${(r.days / max) * 100}%`, height: 10, background: c, opacity: isCur ? 1 : 0.6, borderRadius: 3 }} />
            </div>
            <span style={{ width: 52, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.days} d</span>
          </div>
        );
      })}
    </div>
  );
}

export function StreakPanel({ h }: { h: StreakHistoryV | null | undefined }) {
  if (!h || (!h.topSell.length && !h.topBuy.length)) return null;
  const c = h.current;
  return (
    <div style={box}>
      <H sub={`FII net buying / selling runs in the stored history since ${fmtDate(h.firstDate)}.`}>Streak history</H>
      {c ? (
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          Today&apos;s run: <b style={{ color: c.dir === 'sell' ? RED : GREEN }}>{c.days} day{c.days === 1 ? '' : 's'} of {c.dir === 'sell' ? 'selling' : 'buying'}</b> ({fmtCr(c.totalCr, { signed: true })})
          {h.rank != null ? <> — <b>#{h.rank}</b> of {h.ofRuns} {c.dir === 'sell' ? 'selling' : 'buying'} runs</> : null}
          {h.longerLastSeen && h.rank != null && h.rank > 1 ? <>; a run this long last ended {fmtDate(h.longerLastSeen)}</> : h.rank === 1 ? <>; the longest on record here</> : null}.
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <RunBars runs={h.topSell.some((r) => c && r.from === c.from) || !c || c.dir !== 'sell' ? h.topSell : [...h.topSell.slice(0, 4), c]} current={c} dir="sell" />
        <RunBars runs={h.topBuy.some((r) => c && r.from === c.from) || !c || c.dir !== 'buy' ? h.topBuy : [...h.topBuy.slice(0, 4), c]} current={c} dir="buy" />
      </div>
    </div>
  );
}

// ── FPI equity vs debt ───────────────────────────────────────────────────────

export interface AssetMonthV { month: string; equity: number; debt: number; hybrid: number; days: number }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function AssetMixPanel({ months }: { months: AssetMonthV[] | undefined }) {
  if (!months || !months.length) return null;
  const max = Math.max(1, ...months.flatMap((m) => [Math.abs(m.equity), Math.abs(m.debt), Math.abs(m.hybrid)]));
  const cur = months[months.length - 1];
  const bar = (v: number, label: string) => {
    const f = Math.min(1, Math.abs(v) / max);
    return (
      <div title={`${label}: ${fmtCr(v, { signed: true })}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 50, fontSize: 11, color: SOFT }}>{label}</span>
        <div style={{ position: 'relative', flex: 1, height: 12, minWidth: 80 }}>
          <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: FAINT }} />
          <div style={{ position: 'absolute', top: 1, height: 10, left: v >= 0 ? '50%' : `${50 - f * 50}%`, width: `${f * 50}%`, background: v >= 0 ? '#10b981' : '#ef4444', opacity: 0.4 + 0.6 * Math.sqrt(f), borderRadius: 2 }} />
        </div>
        <span style={{ width: 92, textAlign: 'right', fontSize: 12, fontWeight: 600, color: flowColor(v), fontVariantNumeric: 'tabular-nums' }}>{fmtCr(v, { signed: true })}</span>
      </div>
    );
  };
  return (
    <div style={box}>
      <H sub="NSDL's confirmed FPI figures split by what was bought: shares (incl. IPOs and placements), bonds (debt) and hybrid. Money leaving shares but entering bonds is a rotation, not an exit from India.">
        Foreign money: shares vs bonds
      </H>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        {MON[Number(cur.month.slice(5, 7)) - 1]} {cur.month.slice(0, 4)} so far ({cur.days} days): shares <b style={{ color: flowColor(cur.equity) }}>{fmtCr(cur.equity, { signed: true })}</b>, bonds <b style={{ color: flowColor(cur.debt) }}>{fmtCr(cur.debt, { signed: true })}</b>
        {cur.equity < 0 && cur.debt > 0 ? ' — foreigners are moving money from shares into Indian bonds.' : cur.equity < 0 && cur.debt < 0 ? ' — money is leaving both.' : cur.equity > 0 && cur.debt > 0 ? ' — money is coming into both.' : '.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {[...months].reverse().map((m) => (
          <div key={m.month} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{MON[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)} <span style={{ color: FAINT, fontWeight: 400 }}>· {m.days} days</span></div>
            {bar(m.equity, 'Shares')}
            {bar(m.debt, 'Bonds')}
            {m.hybrid ? bar(m.hybrid, 'Hybrid') : null}
          </div>
        ))}
      </div>
    </div>
  );
}
