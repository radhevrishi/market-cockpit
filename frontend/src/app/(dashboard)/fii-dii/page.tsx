// zzz1055 — FII / DII Flows: how much foreign (FII/FPI) and Indian institutions (DII) bought or sold in the cash market each
// day, buying/selling streaks, the running total, and where foreign money sits by sector (NSDL fortnightly). Updated by the
// app-scheduler job `fii-dii` (lib/fii-dii). Light page, plain words. Helpers live in sibling files (no named exports here).
// zzz1060 — graphics everywhere: buy/sell split bars, green/red running total with a Nifty panel, monthly totals, the sector
// board (share bar, diverging fortnight / 1-year bars, sparklines), heatmap and rotation call-outs, plus FII futures
// positioning, DII absorption, FII-vs-market, streak history, FPI shares-vs-bonds and a rule-written "What it means today".
// zzz1067 — one FII series at a time (NSDL final or NSE provisional, picked by a labelled switch), the headline always says
// which number it shows, partial periods / missing sessions are labelled, a rejected source file shows an error badge while
// the last verified figures stay, buttons say what is pressed (aria-pressed), the charts have a text summary, and the colours
// come from the app's light / dark tokens (white stays the default).
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CumulativeChart, DailyBars, RollingChart, MonthlyBars, LEGEND_FII, LEGEND_DII, type HistPoint, type MonthBar } from './charts';
import { SectorBoard, SectorHeatmap, RotationCallouts, SECTOR_CSS, type SectorLineV, type GridV, type RotationV } from './sectors';
import {
  SummaryBox, PositioningPanel, AbsorptionPanel, MarketPanel, StreakPanel, AssetMixPanel,
  type PositioningV, type AbsorptionV, type MarketV, type StreakHistoryV, type AssetMonthV,
} from './panels';
import { fmtCr, fmtDate, flowColor, GREEN, RED, FD, tint } from './format';

type Range = '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';
type Basis = 'nsdl' | 'nse';
interface SideV { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null }
interface Streak { dir: 'buy' | 'sell' | null; days: number; totalCr: number; since: string | null; continuous?: boolean | null; missing?: number }
interface PeriodSum { sum: number; days: number; expected?: number | null }
interface Quarantine { at: string; problems: string[]; via?: string; report?: string }
interface Api {
  ok: boolean; error?: string; available?: boolean;
  today?: {
    date: string; provisional: boolean; source: 'nse' | 'nsdl'; fii: SideV; dii: SideV | null; combinedNet: number | null;
    combinedBuy?: number | null; combinedSell?: number | null; combinedBuySharePct?: number | null; absorbPct?: number | null;
    fpiConfirmedNet: number | null; fiiLabel?: string; fetchedAt: string | null;
  } | null;
  streaks?: { fii: Streak; fiiFinal?: Streak; dii: Streak; combined: Streak };
  totals?: { fii1m: PeriodSum; dii1m: PeriodSum; from?: string | null };
  basis?: Basis; basisAuto?: boolean; basisLabel?: string;
  history?: HistPoint[];
  rollingAvailable?: { need: number; fii: number; dii: number };
  coverage?: { firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number; firstFinalDate?: string | null };
  sectors?: { lastReport: string | null; totalAucCr: number; totalFortnightCr: number; totalOneYearCr: number; reports1y: number; lines: SectorLineV[] };
  sectorGrid?: GridV;
  rotation?: RotationV | null;
  monthly?: MonthBar[];
  positioning?: PositioningV | null;
  absorption?: AbsorptionV[];
  streakHistory?: StreakHistoryV | null;
  market?: MarketV | null;
  assetMix?: AssetMonthV[];
  summary?: string[];
  status?: {
    daily: { cursor: string | null; done: boolean } | null; sectors: { done: boolean } | null; oi: { cursor: string | null; done: boolean } | null;
    oiLatest: string | null; niftyLatest: string | null; nseQuarantine?: Quarantine | null; sectorQuarantine?: Quarantine | null;
  } | null;
}

const C = { bg: FD.card, panel: FD.page, line: FD.line, text: FD.text, soft: FD.soft, faint: FD.faint, accent: FD.accent };
const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, minWidth: 0 };
const RANGES: Range[] = ['1M', '3M', '6M', '1Y', '3Y', 'ALL'];
const BASIS_SHORT: Record<Basis, string> = { nsdl: 'NSDL final', nse: 'NSE provisional' };

/** A toggle button that says whether it is pressed (screen readers) and shows it (colour). */
function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick}
      style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${on ? C.accent : C.line}`, background: on ? tint(FD.accent, 12) : C.bg, color: on ? C.accent : C.soft, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

const streakWords = (s: Streak) => `${s.days} ${s.continuous === true ? `day${s.days === 1 ? '' : 's'} in a row` : `observed day${s.days === 1 ? '' : 's'}`}`;
const streakNote = (s: Streak) => s.continuous === false
  ? ` — ${s.missing} trading session${s.missing === 1 ? ' has' : 's have'} no stored figure inside this run, so it may have been broken`
  : s.continuous == null && s.days > 1 ? ' — the trading calendar for these dates is not known here, so back-to-back is not proven' : '';

function StreakChip({ who, s }: { who: string; s: Streak | undefined }) {
  if (!s || !s.dir || s.days < 1) return null;
  const buy = s.dir === 'buy';
  const c = buy ? GREEN : RED;
  return (
    <span title={`${who} net ${buy ? 'buying' : 'selling'} since ${fmtDate(s.since)} · total ${fmtCr(s.totalCr, { signed: true })} (exact ₹${s.totalCr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr)${streakNote(s)}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: tint(c, 10), color: c, border: `1px solid ${tint(c, 35)}`, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', gap: 2 }} aria-hidden>
        {Array.from({ length: Math.min(s.days, 10) }).map((_, i) => <span key={i} style={{ width: 5, height: 12, borderRadius: 1, background: c, opacity: 0.35 + (0.65 * (i + 1)) / Math.min(s.days, 10) }} />)}
        {s.days > 10 ? <span style={{ fontSize: 10 }}>+</span> : null}
      </span>
      {who} {buy ? 'buying' : 'selling'} {streakWords(s)} · {fmtCr(s.totalCr, { signed: true })}
      {s.continuous === false ? <span style={{ fontSize: 11, fontWeight: 700, color: FD.warn }}>· {s.missing} missing</span> : null}
    </span>
  );
}

/** Bought vs sold as one split bar: green = buying share, red = selling share. */
function SplitBar({ buy, sell, share }: { buy: number | null; sell: number | null; share: number | null }) {
  if (buy == null || sell == null || share == null) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: GREEN, fontWeight: 600 }} title={`₹${buy.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`}>Bought {fmtCr(buy)}</span>
        <span style={{ color: RED, fontWeight: 600 }} title={`₹${sell.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`}>Sold {fmtCr(sell)}</span>
      </div>
      <div role="img" aria-label={`${share.toFixed(1)}% of what they traded was buying, ${(100 - share).toFixed(1)}% selling`} title={`${share.toFixed(1)}% of what they traded was buying`}
        style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, background: C.bg }}>
        <div style={{ width: `${share}%`, background: '#10b981' }} />
        <div style={{ flex: 1, background: '#ef4444' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.faint, marginTop: 3 }}>
        <span>{share.toFixed(1)}% buying</span><span>{(100 - share).toFixed(1)}% selling</span>
      </div>
    </div>
  );
}

function SideCard({ title, label, side, note, extra }: { title: string; label?: string; side: SideV | null | undefined; note?: string; extra?: React.ReactNode }) {
  const net = side?.net ?? null;
  return (
    <div style={{ ...box, flex: '1 1 260px', borderTop: `4px solid ${net == null ? C.line : net >= 0 ? '#10b981' : '#ef4444'}` }}>
      <div style={{ fontSize: 13, color: C.soft, fontWeight: 600 }}>{title}</div>
      {label ? <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.3 }}>{label}</div> : null}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: flowColor(net) }} title={net != null ? `exact: ₹${net.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` : undefined}>{fmtCr(net, { signed: true })}</span>
        {net != null ? <span style={{ fontSize: 12, fontWeight: 700, color: flowColor(net) }}>{net >= 0 ? '▲ NET BUY' : '▼ NET SELL'}</span> : null}
      </div>
      {net != null ? <div style={{ fontSize: 11, color: C.faint }}>exact ₹{net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr</div> : null}
      <div style={{ fontSize: 12, color: C.soft }}>{net == null ? (note || 'No figure for this day') : net >= 0 ? 'Bought more than they sold' : 'Sold more than they bought'}</div>
      {side ? <SplitBar buy={side.buy} sell={side.sell} share={side.buySharePct} /> : null}
      {extra}
    </div>
  );
}

function Section({ title, sub, right, children }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={box} aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h2>
          {sub ? <div style={{ fontSize: 12, color: C.soft }}>{sub}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** "2 of 22 sessions" when a period sum does not cover every trading session in it. */
const coverageTxt = (p: PeriodSum | undefined) => (!p ? '' : p.expected != null ? (p.days < p.expected ? ` (${p.days} of ${p.expected} sessions — partial)` : '') : ` (${p.days} day${p.days === 1 ? '' : 's'} with figures)`);

/** Plain-words text version of the charts (screen readers, and anyone who wants the numbers). */
function ChartSummary({ hist, basisShort }: { hist: HistPoint[]; basisShort: string }) {
  const withFii = hist.filter((p) => p.fii != null);
  if (!withFii.length) return null;
  const lastP = hist[hist.length - 1];
  const best = withFii.reduce((a, b) => (b.fii! > a.fii! ? b : a));
  const worst = withFii.reduce((a, b) => (b.fii! < a.fii! ? b : a));
  const recent = hist.slice(-10).reverse();
  return (
    <details style={{ marginTop: 8, fontSize: 12, color: C.soft }}>
      <summary style={{ cursor: 'pointer', color: C.accent }}>Text summary and the last 10 days as a table</summary>
      <p style={{ margin: '6px 0' }}>
        {fmtDate(hist[0].date)} to {fmtDate(lastP.date)}, FII series {basisShort}: running total {fmtCr(lastP.fiiCum, { signed: true })} over {withFii.length} day{withFii.length === 1 ? '' : 's'} with a figure.
        Biggest buying day {fmtDate(best.date)} ({fmtCr(best.fii, { signed: true })}); biggest selling day {fmtDate(worst.date)} ({fmtCr(worst.fii, { signed: true })}).
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 320 }}>
          <caption style={{ textAlign: 'left', color: C.faint, paddingBottom: 4 }}>Net flow per day, ₹ crore (FII = {basisShort}; DII = NSE provisional)</caption>
          <thead><tr>{['Date', 'FII', 'DII', 'FII running total'].map((h) => <th key={h} scope="col" style={{ textAlign: h === 'Date' ? 'left' : 'right', padding: '2px 8px', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {recent.map((p) => (
              <tr key={p.date}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 500, padding: '2px 8px' }}>{fmtDate(p.date)}</th>
                <td style={{ textAlign: 'right', padding: '2px 8px', color: flowColor(p.fii) }}>{fmtCr(p.fii, { signed: true })}</td>
                <td style={{ textAlign: 'right', padding: '2px 8px', color: flowColor(p.dii) }}>{fmtCr(p.dii, { signed: true })}</td>
                <td style={{ textAlign: 'right', padding: '2px 8px' }}>{fmtCr(p.fiiCum, { signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return !Number.isFinite(m) ? '' : m < 60 ? `${Math.max(m, 0)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default function FiiDiiPage() {
  const [range, setRange] = useState<Range>('3M');
  const [basis, setBasis] = useState<Basis | 'auto'>('auto');
  const [nonce, setNonce] = useState(0);
  const [got, setGot] = useState<{ key: string; data: Api } | null>(null);
  const key = `${range}:${basis}:${nonce}`;
  useEffect(() => {
    let live = true;
    const ctl = new AbortController();
    fetch(`/api/v1/fii-dii?range=${range}${basis === 'auto' ? '' : `&basis=${basis}`}`, { signal: ctl.signal, ...(nonce ? { cache: 'no-store' as RequestCache } : {}) })
      .then((r) => r.json())
      .then((d: Api) => { if (live) setGot({ key, data: d }); })
      .catch((e: any) => { if (live && e?.name !== 'AbortError') setGot({ key, data: { ok: false, error: e?.message || 'Could not load.' } }); });
    return () => { live = false; ctl.abort(); };
  }, [key, range, basis, nonce]);
  // keep showing the last answer while a new range loads
  const data = got?.data ?? null;
  const loading = got?.key !== key;

  const t = data?.today ?? null;
  const hist = useMemo(() => data?.history ?? [], [data]);
  const sec = data?.sectors;
  const combined = t?.combinedNet ?? null;
  const cov = data?.coverage;
  const rangeFii = hist.reduce((s, p) => s + (p.fii ?? 0), 0);
  const rangeDii = hist.reduce((s, p) => s + (p.dii ?? 0), 0);
  const rangeHasDii = hist.some((p) => p.dii != null);
  const hasNifty = hist.filter((p) => p.nifty != null).length >= 2;
  const has20 = hist.some((p) => p.fii20 != null || p.dii20 != null);
  const st = data?.status;
  const filling = st && ((st.daily && !st.daily.done) || (st.oi && !st.oi.done) || (st.sectors && !st.sectors.done));
  const usedBasis: Basis = data?.basis ?? 'nsdl';
  const basisShort = BASIS_SHORT[usedBasis];
  const ra = data?.rollingAvailable;
  const nseQ = st?.nseQuarantine ?? null, secQ = st?.sectorQuarantine ?? null;

  return (
    <div style={{ background: C.panel, color: C.text, minHeight: '100vh', padding: 'clamp(10px, 2.5vw, 20px)', fontFamily: 'system-ui, -apple-system, sans-serif', overflowX: 'hidden' }}>
      <style>{SECTOR_CSS}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🏦 FII / DII Flows</h1>
            <div style={{ fontSize: 13, color: C.soft, marginTop: 4 }}>How much foreign investors (FII / FPI) and Indian institutions (DII) bought or sold in Indian shares, where foreign money is moving by sector, and how foreigners are positioned in futures. Updated automatically every evening.</div>
          </div>
          <button type="button" onClick={() => setNonce((n) => n + 1)} aria-busy={loading} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', color: C.accent, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {data && !data.ok ? <div role="alert" style={{ ...box, color: RED }}>{data.error || 'Could not load.'}</div> : null}
        {nseQ ? (
          <div role="alert" style={{ ...box, borderColor: tint(RED, 45), background: tint(RED, 7), fontSize: 13 }}>
            <b style={{ color: RED }}>⚠ The latest NSE FII/DII file was rejected</b> ({fmtDate(nseQ.at.slice(0, 10))}, {ago(nseQ.at)}): {nseQ.problems.join('; ')}.
            {' '}It was not stored. {t ? `The figures below are the last verified day (${fmtDate(t.date)}).` : ''} The next run tries again.
          </div>
        ) : null}
        {secQ ? (
          <div role="alert" style={{ ...box, borderColor: tint(FD.warn, 45), background: tint(FD.warn, 8), fontSize: 13 }}>
            <b style={{ color: FD.warn }}>⚠ NSDL sector report{secQ.report ? ` of ${fmtDate(secQ.report)}` : ''} was rejected</b>: {secQ.problems.join('; ')}. The sector board shows the last report that added up.
          </div>
        ) : null}
        {data?.ok && !data.available ? (
          <div style={{ ...box, color: C.soft }}>No figures stored yet. The app collects them every weekday evening from about 18:30 IST (NSE), and fills the history from NSDL by itself every hour — check back after the next run.</div>
        ) : null}

        {t ? (
          <div style={{ ...box }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtDate(t.date)}</div>
              {t.source === 'nse' ? (
                <span title="NSE publishes these the same evening from what brokers report. They stay NSE's provisional figures even after NSDL confirms its own (different) figure the next working day."
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: '3px 8px', borderRadius: 4, background: tint(FD.warn, 12), color: FD.warn, border: `1px solid ${tint(FD.warn, 40)}` }}>
                  PROVISIONAL · NSE
                </span>
              ) : <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: tint(FD.accent, 10), color: C.accent }}>NSDL FINAL · FII ONLY</span>}
              {t.source === 'nse' && t.fpiConfirmedNet != null ? (
                <span title="NSDL's confirmed FPI figure for the same day (stock-exchange trades, from custodian reports). It is a separate number from a separate source; the headline keeps NSE's."
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: tint(GREEN, 10), color: GREEN, border: `1px solid ${tint(GREEN, 35)}` }}>
                  NSDL FINAL ARRIVED: {fmtCr(t.fpiConfirmedNet, { signed: true })}
                </span>
              ) : null}
              {combined != null ? (
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 4, color: '#fff', background: combined >= 0 ? '#047857' : '#b91c1c' }}>{combined >= 0 ? 'NET BUY' : 'NET SELL'}</span>
              ) : null}
              <span style={{ fontSize: 12, color: C.faint }}>Source: {t.source === 'nse' ? 'NSE provisional cash-market data (NSE + BSE + MSEI)' : 'NSDL daily FPI report'}{t.fetchedAt ? ` · saved ${ago(t.fetchedAt)}` : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <SideCard title="FII / FPI (foreign)" label={t.source === 'nse' ? 'NSE PROVISIONAL' : 'NSDL FINAL'} side={t.fii}
                extra={<div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                  <StreakChip who={t.source === 'nse' ? 'FII (NSE)' : 'FII (NSDL)'} s={t.source === 'nse' ? data?.streaks?.fii : data?.streaks?.fiiFinal} />
                  {t.source === 'nse' && t.fpiConfirmedNet != null ? <div style={{ fontSize: 12, color: C.soft }}>NSDL final for this day: <b style={{ color: flowColor(t.fpiConfirmedNet) }}>{fmtCr(t.fpiConfirmedNet, { signed: true })}</b> (stock-exchange trades only)</div> : null}
                </div>} />
              <SideCard title="DII (Indian institutions)" label={t.dii ? 'NSE PROVISIONAL' : undefined} side={t.dii} note="NSDL does not publish DII figures"
                extra={<div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StreakChip who="DII" s={data?.streaks?.dii} />
                  {t.absorbPct != null ? <span title="DII net buying ÷ FII net selling that day (both NSE)" style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>absorbed {t.absorbPct}% of FII selling</span> : null}
                </div>} />
              <SideCard title="Combined (FII + DII)" label={combined != null ? 'NSE PROVISIONAL · SAME DAY' : undefined} note="Needs both NSE figures for the same day"
                side={combined != null ? { net: combined, buy: t.combinedBuy ?? null, sell: t.combinedSell ?? null, buySharePct: t.combinedBuySharePct ?? null } : null}
                extra={<>
                  {data?.totals ? (
                    <div style={{ fontSize: 12, color: C.soft, marginTop: 8 }}>
                      Last month{data.totals.from ? ` (from ${fmtDate(data.totals.from, true)})` : ''}: FII <span style={{ color: C.faint }}>({basisShort})</span> <b style={{ color: flowColor(data.totals.fii1m.sum) }}>{fmtCr(data.totals.fii1m.sum, { signed: true })}</b>{coverageTxt(data.totals.fii1m)}
                      {data.totals.dii1m.days ? <> · DII <b style={{ color: flowColor(data.totals.dii1m.sum) }}>{fmtCr(data.totals.dii1m.sum, { signed: true })}</b>{coverageTxt(data.totals.dii1m)}</> : null}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8 }}><StreakChip who="Together" s={data?.streaks?.combined} /></div>
                </>} />
            </div>
          </div>
        ) : null}

        <SummaryBox lines={data?.summary ?? []} date={t?.date ?? null} />

        {data?.available ? (
          <Section title="Foreign money: running total"
            sub={<>FII net flow added up day by day. Green above the line = foreigners have put money in over the period; red below = taken money out.{hasNifty ? ' The Nifty 50 panel underneath shows what the market did on the same days.' : ''}</>}
            right={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', maxWidth: '100%' }}>
                <div role="group" aria-label="Period" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {RANGES.map((r) => <Toggle key={r} on={r === range} onClick={() => setRange(r)}>{r}</Toggle>)}
                </div>
                <div role="group" aria-label="FII series" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: C.faint }}>FII series:</span>
                  <Toggle on={basis === 'auto'} onClick={() => setBasis('auto')} title="NSE provisional when its stored history covers the period, else NSDL final">Auto</Toggle>
                  <Toggle on={basis === 'nsdl'} onClick={() => setBasis('nsdl')} title="NSDL's confirmed FPI equity figures, stock-exchange trades (arrive a working day later)">NSDL final</Toggle>
                  <Toggle on={basis === 'nse'} onClick={() => setBasis('nse')} title="NSE's provisional evening figures — only from the day this app started saving them">NSE provisional</Toggle>
                </div>
              </div>
            }>
            <div style={{ fontSize: 12, color: C.soft, marginBottom: 6, padding: '4px 8px', borderRadius: 6, background: tint(FD.accent, 6), border: `1px solid ${tint(FD.accent, 20)}` }}>
              FII line on these charts: <b>{data.basisLabel || basisShort}</b>{data.basisAuto ? ' (picked automatically)' : ''}. The two sources are never mixed in one line.
              {usedBasis === 'nse' && cov?.firstNseDate ? ` NSE figures start ${fmtDate(cov.firstNseDate)}.` : ''}
              {usedBasis === 'nsdl' ? ' The newest day usually appears a working day later, once NSDL confirms it.' : ''}
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              In this period: FII <b style={{ color: flowColor(rangeFii) }}>{fmtCr(rangeFii, { signed: true })}</b> <span style={{ color: C.faint }}>({hist.filter((p) => p.fii != null).length} days with a figure)</span>
              {rangeHasDii ? <> · DII <b style={{ color: flowColor(rangeDii) }}>{fmtCr(rangeDii, { signed: true })}</b> <span style={{ color: C.faint }}>({hist.filter((p) => p.dii != null).length} days{hist.some((p) => p.dii == null) ? `; DII only from ${fmtDate(cov?.firstNseDate)}` : ''})</span></> : null}
            </div>
            <CumulativeChart pts={hist} />
            <ChartSummary hist={hist} basisShort={basisShort} />

            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '18px 0 0' }}>Each day: FII vs DII</h3>
            <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
              <span style={{ color: LEGEND_FII }}>■</span> FII ({basisShort}) &nbsp; <span style={{ color: LEGEND_DII }}>■</span> DII (NSE provisional) · bars above the line = net buying, below = net selling
            </div>
            <DailyBars pts={hist} />

            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '18px 0 0' }}>20-session rolling net</h3>
            <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
              <span style={{ color: LEGEND_FII }}>━</span> FII ({basisShort}) &nbsp; <span style={{ color: LEGEND_DII }}>━</span> DII · the sum of the last 20 trading sessions. A window with a missing session is left blank, never filled from fewer days.
            </div>
            {has20 ? <RollingChart pts={hist} /> : (
              <div role="status" style={{ fontSize: 13, color: C.soft, padding: '18px 12px', border: `1px dashed ${C.line}`, borderRadius: 8, textAlign: 'center' }}>
                Need 20 sessions in a row; {ra ? `FII ${ra.fii}, DII ${ra.dii}` : 'fewer'} available so far. The line appears once 20 back-to-back sessions are stored.
              </div>
            )}
          </Section>
        ) : null}

        {(data?.market || (data?.absorption?.length ?? 0) > 0) ? (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <MarketPanel m={data?.market} />
            <AbsorptionPanel rows={data?.absorption} />
          </div>
        ) : null}

        {(data?.monthly?.length ?? 0) >= 2 ? (
          <Section title="Month by month" sub={<><span style={{ color: LEGEND_FII }}>■</span> FII ({basisShort}) &nbsp; <span style={{ color: LEGEND_DII }}>■</span> DII · net for each calendar month (₹ crore). Paler bars marked * are partial months (still running, or sessions missing). Hover a month for exact figures.</>}>
            <MonthlyBars months={data!.monthly!} />
          </Section>
        ) : null}

        <PositioningPanel p={data?.positioning} />

        <Section title="Foreign money by sector"
          sub="NSDL fortnightly report, shares (equity) only, ₹ crore. Green bars = foreigners added, red = they cut."
          right={<div style={{ fontSize: 12, color: C.soft }}>Last report: <b>{fmtDate(sec?.lastReport)}</b>{sec && sec.reports1y > 0 && sec.reports1y < 24 ? <> · 1-year figures cover <b>{sec.reports1y} of 24</b> fortnights</> : null}</div>}>
          {sec?.lines.length ? (
            <>
              {data?.rotation ? <div style={{ margin: '8px 0 14px' }}><RotationCallouts rot={data.rotation} reports1y={sec.reports1y} /></div> : null}
              <SectorBoard lines={sec.lines} grid={data?.sectorGrid ?? { dates: [], rows: [], maxAbs: 0, maxAbsPct: 0 }} lastReport={sec.lastReport} reports1y={sec.reports1y}
                total={{ aucCr: sec.totalAucCr, fortnightCr: sec.totalFortnightCr, oneYearCr: sec.totalOneYearCr }} />
              {(data?.sectorGrid?.dates.length ?? 0) >= 2 ? (
                <div style={{ marginTop: 18 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Rotation heatmap</h3>
                  <div style={{ fontSize: 12, color: C.soft }}>Every sector, every fortnight. Rows of green = steady buying; a row turning from green to red = foreigners rotating out. Switch to “% of holding” to compare small and large sectors fairly.</div>
                  <SectorHeatmap grid={data!.sectorGrid!} />
                </div>
              ) : null}
            </>
          ) : <div style={{ fontSize: 13, color: C.soft, marginTop: 10 }}>No sector report stored yet — NSDL publishes one around the 1st and the 16th of each month; the app picks it up automatically.</div>}
        </Section>

        <StreakPanel h={data?.streakHistory} />
        <AssetMixPanel months={data?.assetMix} />

        <div style={{ ...box, background: FD.subtle }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px' }}>How to read this</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.soft, lineHeight: 1.6 }}>
            <li><b>FII / FPI</b> = foreign investors (funds outside India). <b>DII</b> = Indian institutions: mutual funds, insurers, banks, pension funds. Net = bought minus sold, in ₹ crore (1 crore = 10 million; 1 lakh crore = 1,00,000 crore).</li>
            <li><b>Two sources, never mixed.</b> NSE publishes the evening figures from what brokers report the same day (cash market on NSE, BSE and MSEI) — these stay “provisional”. NSDL publishes its own FPI figure a working day later from custodian reports. This page uses NSDL's <i>stock-exchange</i> rows only (shares bought and sold on an exchange — not new issues or other primary-market buying), so both sources cover exchange trades, yet the two numbers still differ a little. For instance (made-up figures), NSE might show −₹5,285 Cr and NSDL −₹5,120 Cr for the same day. The switch above picks which one the charts use.</li>
            <li><b>One day means little.</b> A single big day can be one index rebalance or block deal. Look at streaks, the 20-session sum and the running total — they show whether money is steadily coming in or going out.</li>
            <li><b>Missing days are shown, not hidden.</b> A streak says “in a row” only when the trading calendar proves the days were back-to-back; otherwise it says “observed days”. A period total that does not cover every session says so (e.g. “2 of 22 sessions — partial”).</li>
            <li><b>When FIIs sell and DIIs buy</b> (common in recent years), Indian money is absorbing the selling. Example: FII −₹5,000 Cr and DII +₹3,300 Cr means a combined −₹1,700 Cr and 66% absorbed.</li>
            <li><b>Futures positioning</b> shows what foreigners are betting on, not what they own. Example: 20% long = 20 of every 100 index-futures contracts gain if the market rises. Very low readings mean the bets are crowded on one side.</li>
            <li><b>Sector bars:</b> “Share” is how much of all foreign holdings sits in that sector; the 1-year flow as a % of the holding shows whether they have been adding or cutting. Example: −₹20,000 Cr on a ₹5 L Cr holding = −4%. Until 24 fortnightly reports are stored, the “1 year” figure covers fewer fortnights and says how many.</li>
            <li><b>Shares vs bonds:</b> foreigners selling shares while buying Indian bonds are moving money within India, not leaving it. (That panel uses NSDL's equity figure <i>including</i> primary-market buying.)</li>
          </ul>
        </div>

        {cov ? (
          <div style={{ fontSize: 12, color: C.faint }}>
            Stored: {cov.days.toLocaleString('en-IN')} trading days, {fmtDate(cov.firstDate)} – {fmtDate(cov.lastDate)}.
            {cov.firstNseDate && cov.firstDate && cov.firstDate < cov.firstNseDate
              ? ` NSDL final FII figures go back to ${fmtDate(cov.firstFinalDate ?? cov.firstDate)}. This installation has collected NSE FII and DII history from ${fmtDate(cov.firstNseDate)}; earlier DII coverage has not been integrated.`
              : !cov.firstNseDate ? ' These are NSDL FII figures only; NSE FII + DII figures are added from the next evening run.' : ''}
            {filling ? ` History is still being filled automatically (${[
              st?.daily && !st.daily.done ? `daily flows back to ${fmtDate(st.daily.cursor)}` : null,
              st?.oi && !st.oi.done ? `futures positioning back to ${fmtDate(st.oi.cursor)}` : null,
              st?.sectors && !st.sectors.done ? 'sector reports' : null,
            ].filter(Boolean).join(', ')}) — no action needed.` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}
