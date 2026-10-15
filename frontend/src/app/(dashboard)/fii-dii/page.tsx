// zzz1055 — FII / DII Flows: how much foreign (FII/FPI) and Indian institutions (DII) bought or sold in the cash market each
// day, buying/selling streaks, the running total, and where foreign money sits by sector (NSDL fortnightly). Updated by the
// app-scheduler job `fii-dii` (lib/fii-dii). Light page, plain words. Helpers live in sibling files (no named exports here).
// zzz1060 — graphics everywhere: buy/sell split bars, green/red running total with a Nifty panel, monthly totals, the sector
// board (share bar, diverging fortnight / 1-year bars, sparklines), heatmap and rotation call-outs, plus FII futures
// positioning, DII absorption, FII-vs-market, streak history, FPI shares-vs-bonds and a rule-written "What it means today".
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CumulativeChart, DailyBars, RollingChart, MonthlyBars, LEGEND_FII, LEGEND_DII, type HistPoint, type MonthBar } from './charts';
import { SectorBoard, SectorHeatmap, RotationCallouts, SECTOR_CSS, type SectorLineV, type GridV, type RotationV } from './sectors';
import {
  SummaryBox, PositioningPanel, AbsorptionPanel, MarketPanel, StreakPanel, AssetMixPanel,
  type PositioningV, type AbsorptionV, type MarketV, type StreakHistoryV, type AssetMonthV,
} from './panels';
import { fmtCr, fmtDate, flowColor, GREEN, RED } from './format';

type Range = '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';
interface SideV { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null }
interface Streak { dir: 'buy' | 'sell' | null; days: number; totalCr: number; since: string | null }
interface Api {
  ok: boolean; error?: string; available?: boolean;
  today?: {
    date: string; provisional: boolean; source: 'nse' | 'nsdl'; fii: SideV; dii: SideV | null; combinedNet: number | null;
    combinedBuy?: number | null; combinedSell?: number | null; combinedBuySharePct?: number | null; absorbPct?: number | null;
    fpiConfirmedNet: number | null; fetchedAt: string | null;
  } | null;
  streaks?: { fii: Streak; dii: Streak; combined: Streak };
  totals?: { fii1m: { sum: number; days: number }; dii1m: { sum: number; days: number } };
  history?: HistPoint[];
  coverage?: { firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number };
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
  status?: { daily: { cursor: string | null; done: boolean } | null; sectors: { done: boolean } | null; oi: { cursor: string | null; done: boolean } | null; oiLatest: string | null; niftyLatest: string | null } | null;
}

const C = { bg: '#ffffff', panel: '#f8fafc', line: '#e2e8f0', text: '#0f172a', soft: '#475569', faint: '#94a3b8', accent: '#1d4ed8' };
const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 16 };
const RANGES: Range[] = ['1M', '3M', '6M', '1Y', '3Y', 'ALL'];

function StreakChip({ who, s }: { who: string; s: Streak | undefined }) {
  if (!s || !s.dir || s.days < 1) return null;
  const buy = s.dir === 'buy';
  return (
    <span title={`${who} net ${buy ? 'buying' : 'selling'} since ${fmtDate(s.since)} · total ${fmtCr(s.totalCr, { signed: true })}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: buy ? '#ecfdf5' : '#fef2f2', color: buy ? GREEN : RED, border: `1px solid ${buy ? '#a7f3d0' : '#fecaca'}` }}>
      <span style={{ display: 'inline-flex', gap: 2 }} aria-hidden>
        {Array.from({ length: Math.min(s.days, 10) }).map((_, i) => <span key={i} style={{ width: 5, height: 12, borderRadius: 1, background: buy ? '#10b981' : '#ef4444', opacity: 0.45 + (0.55 * (i + 1)) / Math.min(s.days, 10) }} />)}
        {s.days > 10 ? <span style={{ fontSize: 10 }}>+</span> : null}
      </span>
      {who} {buy ? 'buying' : 'selling'} {s.days} day{s.days === 1 ? '' : 's'} · {fmtCr(s.totalCr, { signed: true })}
    </span>
  );
}

/** Bought vs sold as one split bar: green = buying share, red = selling share. */
function SplitBar({ buy, sell, share }: { buy: number | null; sell: number | null; share: number | null }) {
  if (buy == null || sell == null || share == null) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: GREEN, fontWeight: 600 }}>Bought {fmtCr(buy)}</span><span style={{ color: RED, fontWeight: 600 }}>Sold {fmtCr(sell)}</span>
      </div>
      <div title={`${share.toFixed(1)}% of what they traded was buying`} style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, background: '#fff' }}>
        <div style={{ width: `${share}%`, background: '#10b981' }} />
        <div style={{ flex: 1, background: '#ef4444' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.faint, marginTop: 3 }}>
        <span>{share.toFixed(1)}% buying</span><span>{(100 - share).toFixed(1)}% selling</span>
      </div>
    </div>
  );
}

function SideCard({ title, side, note, extra }: { title: string; side: SideV | null | undefined; note?: string; extra?: React.ReactNode }) {
  const net = side?.net ?? null;
  return (
    <div style={{ ...box, flex: '1 1 260px', borderTop: `4px solid ${net == null ? C.line : net >= 0 ? '#10b981' : '#ef4444'}` }}>
      <div style={{ fontSize: 13, color: C.soft, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px' }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: flowColor(net) }}>{fmtCr(net, { signed: true })}</span>
        {net != null ? <span style={{ fontSize: 12, fontWeight: 700, color: flowColor(net) }}>{net >= 0 ? '▲ NET BUY' : '▼ NET SELL'}</span> : null}
      </div>
      <div style={{ fontSize: 12, color: C.soft }}>{net == null ? (note || 'No figure for this day') : net >= 0 ? 'Bought more than they sold' : 'Sold more than they bought'}</div>
      {side ? <SplitBar buy={side.buy} sell={side.sell} share={side.buySharePct} /> : null}
      {extra}
    </div>
  );
}

function Section({ title, sub, right, children }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: C.soft }}>{sub}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function FiiDiiPage() {
  const [range, setRange] = useState<Range>('3M');
  const [nonce, setNonce] = useState(0);
  const [got, setGot] = useState<{ key: string; data: Api } | null>(null);
  const key = `${range}:${nonce}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/fii-dii?range=${range}`, nonce ? { cache: 'no-store' } : undefined)
      .then((r) => r.json())
      .then((d: Api) => { if (live) setGot({ key, data: d }); })
      .catch((e: any) => { if (live) setGot({ key, data: { ok: false, error: e?.message || 'Could not load.' } }); });
    return () => { live = false; };
  }, [key, range, nonce]);
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
  const st = data?.status;
  const filling = st && ((st.daily && !st.daily.done) || (st.oi && !st.oi.done) || (st.sectors && !st.sectors.done));

  return (
    <div style={{ background: C.panel, color: C.text, minHeight: '100vh', padding: 'clamp(10px, 2.5vw, 20px)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{SECTOR_CSS}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🏦 FII / DII Flows</h1>
            <div style={{ fontSize: 13, color: C.soft, marginTop: 4 }}>How much foreign investors (FII / FPI) and Indian institutions (DII) bought or sold in Indian shares, where foreign money is moving by sector, and how foreigners are positioned in futures. Updated automatically every evening.</div>
          </div>
          <button onClick={() => setNonce((n) => n + 1)} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', color: C.accent, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {data && !data.ok ? <div style={{ ...box, color: RED }}>{data.error || 'Could not load.'}</div> : null}
        {data?.ok && !data.available ? (
          <div style={{ ...box, color: C.soft }}>No figures stored yet. The app collects them every weekday evening from about 18:30 IST (NSE), and fills the history from NSDL by itself every hour — check back after the next run.</div>
        ) : null}

        {t ? (
          <div style={{ ...box }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtDate(t.date)}</div>
              {t.source === 'nse' ? (
                <span title={t.provisional ? 'NSE publishes these the same evening. NSDL confirms the foreign figure on the next working day.' : 'NSDL has confirmed the foreign (FPI) figure for this day.'}
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: '3px 8px', borderRadius: 4, background: t.provisional ? '#fffbeb' : '#ecfdf5', color: t.provisional ? '#b45309' : GREEN, border: `1px solid ${t.provisional ? '#fde68a' : '#a7f3d0'}` }}>
                  {t.provisional ? 'PROVISIONAL' : 'FPI CONFIRMED'}
                </span>
              ) : <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#eff6ff', color: C.accent }}>NSDL · FII ONLY</span>}
              {combined != null ? (
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 4, color: '#fff', background: combined >= 0 ? GREEN : RED }}>{combined >= 0 ? 'NET BUY' : 'NET SELL'}</span>
              ) : null}
              <span style={{ fontSize: 12, color: C.faint }}>Source: {t.source === 'nse' ? 'NSE provisional cash-market data' : 'NSDL daily FPI report'}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <SideCard title="FII / FPI (foreign)" side={t.fii} extra={<div style={{ marginTop: 10 }}><StreakChip who="FII" s={data?.streaks?.fii} /></div>} />
              <SideCard title="DII (Indian institutions)" side={t.dii} note="NSDL does not publish DII figures"
                extra={<div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StreakChip who="DII" s={data?.streaks?.dii} />
                  {t.absorbPct != null ? <span title="DII net buying ÷ FII net selling that day" style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>absorbed {t.absorbPct}% of FII selling</span> : null}
                </div>} />
              <SideCard title="Combined (FII + DII)" note="Needs both figures"
                side={combined != null ? { net: combined, buy: t.combinedBuy ?? null, sell: t.combinedSell ?? null, buySharePct: t.combinedBuySharePct ?? null } : null}
                extra={<>
                  {t.fpiConfirmedNet != null && t.source === 'nse' ? (
                    <div style={{ fontSize: 12, color: C.soft, marginTop: 10 }}>NSDL-confirmed FPI figure: <b style={{ color: flowColor(t.fpiConfirmedNet) }}>{fmtCr(t.fpiConfirmedNet, { signed: true })}</b></div>
                  ) : null}
                  {data?.totals ? (
                    <div style={{ fontSize: 12, color: C.soft, marginTop: 8 }}>
                      Last month: FII <b style={{ color: flowColor(data.totals.fii1m.sum) }}>{fmtCr(data.totals.fii1m.sum, { signed: true })}</b>
                      {data.totals.dii1m.days ? <> · DII <b style={{ color: flowColor(data.totals.dii1m.sum) }}>{fmtCr(data.totals.dii1m.sum, { signed: true })}</b></> : null}
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
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {RANGES.map((r) => (
                  <button key={r} onClick={() => setRange(r)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${r === range ? C.accent : C.line}`, background: r === range ? '#eff6ff' : C.bg, color: r === range ? C.accent : C.soft, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{r}</button>
                ))}
              </div>
            }>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              In this period: FII <b style={{ color: flowColor(rangeFii) }}>{fmtCr(rangeFii, { signed: true })}</b>
              {rangeHasDii ? <> · DII <b style={{ color: flowColor(rangeDii) }}>{fmtCr(rangeDii, { signed: true })}</b>{hist.some((p) => p.dii == null) ? <span style={{ color: C.faint }}> (DII only from {fmtDate(cov?.firstNseDate)})</span> : null}</> : null}
            </div>
            <CumulativeChart pts={hist} />

            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 18 }}>Each day: FII vs DII</div>
            <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
              <span style={{ color: LEGEND_FII }}>■</span> FII &nbsp; <span style={{ color: LEGEND_DII }}>■</span> DII · bars above the line = net buying, below = net selling
            </div>
            <DailyBars pts={hist} />

            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 18 }}>20-day rolling net</div>
            <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
              <span style={{ color: LEGEND_FII }}>━</span> FII &nbsp; <span style={{ color: LEGEND_DII }}>━</span> DII · the sum of the last 20 trading days — smooths out single noisy days
            </div>
            <RollingChart pts={hist} />
          </Section>
        ) : null}

        {(data?.market || (data?.absorption?.length ?? 0) > 0) ? (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <MarketPanel m={data?.market} />
            <AbsorptionPanel rows={data?.absorption} />
          </div>
        ) : null}

        {(data?.monthly?.length ?? 0) >= 2 ? (
          <Section title="Month by month" sub={<><span style={{ color: LEGEND_FII }}>■</span> FII &nbsp; <span style={{ color: LEGEND_DII }}>■</span> DII · net for each calendar month (₹ crore). Hover a month for exact figures.</>}>
            <MonthlyBars months={data!.monthly!} />
          </Section>
        ) : null}

        <PositioningPanel p={data?.positioning} />

        <Section title="Foreign money by sector"
          sub="NSDL fortnightly report, shares (equity) only, ₹ crore. Green bars = foreigners added, red = they cut."
          right={<div style={{ fontSize: 12, color: C.soft }}>Last report: <b>{fmtDate(sec?.lastReport)}</b></div>}>
          {sec?.lines.length ? (
            <>
              {data?.rotation ? <div style={{ margin: '8px 0 14px' }}><RotationCallouts rot={data.rotation} /></div> : null}
              <SectorBoard lines={sec.lines} grid={data?.sectorGrid ?? { dates: [], rows: [], maxAbs: 0, maxAbsPct: 0 }} lastReport={sec.lastReport} reports1y={sec.reports1y}
                total={{ aucCr: sec.totalAucCr, fortnightCr: sec.totalFortnightCr, oneYearCr: sec.totalOneYearCr }} />
              {(data?.sectorGrid?.dates.length ?? 0) >= 2 ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Rotation heatmap</div>
                  <div style={{ fontSize: 12, color: C.soft }}>Every sector, every fortnight. Rows of green = steady buying; a row turning from green to red = foreigners rotating out. Switch to “% of holding” to compare small and large sectors fairly.</div>
                  <SectorHeatmap grid={data!.sectorGrid!} />
                </div>
              ) : null}
            </>
          ) : <div style={{ fontSize: 13, color: C.soft, marginTop: 10 }}>No sector report stored yet — NSDL publishes one around the 1st and the 16th of each month; the app picks it up automatically.</div>}
        </Section>

        <StreakPanel h={data?.streakHistory} />
        <AssetMixPanel months={data?.assetMix} />

        <div style={{ ...box, background: '#f1f5f9' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>How to read this</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.soft, lineHeight: 1.6 }}>
            <li><b>FII / FPI</b> = foreign investors (funds outside India). <b>DII</b> = Indian institutions: mutual funds, insurers, banks, pension funds. Net = bought minus sold, in ₹ crore (1 crore = 10 million; 1 lakh crore = 1,00,000 crore).</li>
            <li><b>Provisional vs final.</b> NSE publishes the evening figures from what brokers report the same day. NSDL confirms the foreign figure a day later from custodian reports; it also counts other exchanges and new issues, so the two numbers usually differ a little.</li>
            <li><b>One day means little.</b> A single big day can be one index rebalance or block deal. Look at streaks, the 20-day sum and the running total — they show whether money is steadily coming in or going out.</li>
            <li><b>When FIIs sell and DIIs buy</b> (common in recent years), Indian money is absorbing the selling. Example: FII −₹5,000 Cr and DII +₹3,300 Cr means a combined −₹1,700 Cr and 66% absorbed.</li>
            <li><b>Futures positioning</b> shows what foreigners are betting on, not what they own. Example: 20% long = 20 of every 100 index-futures contracts gain if the market rises. Very low readings mean the bets are crowded on one side.</li>
            <li><b>Sector bars:</b> “Share” is how much of all foreign holdings sits in that sector; the 1-year flow as a % of the holding shows whether they have been adding or cutting. Example: −₹20,000 Cr on a ₹5 L Cr holding = −4%.</li>
            <li><b>Shares vs bonds:</b> foreigners selling shares while buying Indian bonds are moving money within India, not leaving it.</li>
          </ul>
        </div>

        {cov ? (
          <div style={{ fontSize: 12, color: C.faint }}>
            Stored: {cov.days.toLocaleString('en-IN')} trading days, {fmtDate(cov.firstDate)} – {fmtDate(cov.lastDate)}.
            {cov.firstNseDate && cov.firstDate && cov.firstDate < cov.firstNseDate
              ? ` Before ${fmtDate(cov.firstNseDate)} the FII figures are NSDL's confirmed FPI equity figures (stock-exchange trades); DII figures start ${fmtDate(cov.firstNseDate)}, when this page began saving NSE's daily numbers — no free public source has older DII history.`
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
