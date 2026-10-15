// zzz1055 — FII / DII Flows: how much foreign (FII/FPI) and Indian institutions (DII) bought or sold in the cash market each
// day, buying/selling streaks, the running total, and where foreign money sits by sector (NSDL fortnightly). Updated by the
// app-scheduler job `fii-dii` (lib/fii-dii). Light page, plain words. Helpers live in sibling files (no named exports here).
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CumulativeChart, DailyBars, RollingChart, LEGEND_FII, LEGEND_DII, type HistPoint } from './charts';
import { fmtCr, fmtPct, fmtDate, flowColor, GREEN, RED } from './format';

type Range = '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';
interface SideV { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null }
interface Streak { dir: 'buy' | 'sell' | null; days: number; totalCr: number; since: string | null }
interface SectorLine { sector: string; aucCr: number; sharePct: number; fortnightCr: number; fortnightPctOfAuc: number | null; oneYearCr: number; oneYearPctOfAuc: number | null; reports1y: number }
interface Api {
  ok: boolean; error?: string; available?: boolean;
  today?: { date: string; provisional: boolean; source: 'nse' | 'nsdl'; fii: SideV; dii: SideV | null; combinedNet: number | null; fpiConfirmedNet: number | null; fetchedAt: string | null } | null;
  streaks?: { fii: Streak; dii: Streak; combined: Streak };
  totals?: { fii1m: { sum: number; days: number }; dii1m: { sum: number; days: number } };
  history?: HistPoint[];
  coverage?: { firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number };
  sectors?: { lastReport: string | null; totalAucCr: number; totalFortnightCr: number; totalOneYearCr: number; reports1y: number; lines: SectorLine[] };
}

const C = { bg: '#ffffff', panel: '#f8fafc', line: '#e2e8f0', text: '#0f172a', soft: '#475569', faint: '#94a3b8', accent: '#1d4ed8' };
const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 16 };
const th: React.CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${C.line}`, color: C.soft, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${C.line}`, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const RANGES: Range[] = ['1M', '3M', '6M', '1Y', '3Y', 'ALL'];

function StreakChip({ who, s }: { who: string; s: Streak | undefined }) {
  if (!s || !s.dir || s.days < 1) return null;
  const buy = s.dir === 'buy';
  return (
    <span title={`${who} net ${buy ? 'buying' : 'selling'} since ${fmtDate(s.since)} · total ${fmtCr(s.totalCr, { signed: true })}`}
      style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: buy ? '#ecfdf5' : '#fef2f2', color: buy ? GREEN : RED, border: `1px solid ${buy ? '#a7f3d0' : '#fecaca'}` }}>
      {who} {buy ? 'buying' : 'selling'} {s.days} day{s.days === 1 ? '' : 's'} · {fmtCr(s.totalCr, { signed: true })}
    </span>
  );
}

function SideCard({ title, side, note }: { title: string; side: SideV | null | undefined; note?: string }) {
  const net = side?.net ?? null;
  const share = side?.buySharePct ?? null;
  return (
    <div style={{ ...box, flex: '1 1 240px' }}>
      <div style={{ fontSize: 13, color: C.soft, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: flowColor(net), margin: '6px 0 2px' }}>{fmtCr(net, { signed: true })}</div>
      <div style={{ fontSize: 12, color: C.soft }}>{net == null ? (note || 'No figure for this day') : net >= 0 ? 'Net buyers' : 'Net sellers'}</div>
      {side ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.soft, marginTop: 10 }}>
            <span>Bought {fmtCr(side.buy)}</span><span>Sold {fmtCr(side.sell)}</span>
          </div>
          {share != null ? (
            <div title={`${share}% of what they traded was buying`} style={{ height: 8, background: '#fee2e2', borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
              <div style={{ width: `${share}%`, height: 8, background: '#34d399' }} />
            </div>
          ) : null}
          {share != null ? <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>Buying share {share.toFixed(1)}%</div> : null}
        </>
      ) : null}
    </div>
  );
}

export default function FiiDiiPage() {
  const [range, setRange] = useState<Range>('3M');
  const [nonce, setNonce] = useState(0);
  const [got, setGot] = useState<{ key: string; data: Api } | null>(null);
  const [sort, setSort] = useState<{ by: 'auc' | 'fortnight' | 'oneYear'; desc: boolean }>({ by: 'auc', desc: true });
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
  const hist = data?.history ?? [];
  const sec = data?.sectors;
  const lines = useMemo(() => {
    const key = (l: SectorLine) => (sort.by === 'auc' ? l.aucCr : sort.by === 'fortnight' ? l.fortnightCr : l.oneYearCr);
    return [...(sec?.lines ?? [])].sort((a, b) => (sort.desc ? key(b) - key(a) : key(a) - key(b)));
  }, [sec, sort]);
  const sortBtn = (by: 'auc' | 'fortnight' | 'oneYear', label: string) => (
    <th style={{ ...th, cursor: 'pointer', color: sort.by === by ? C.accent : C.soft }} onClick={() => setSort((s) => ({ by, desc: s.by === by ? !s.desc : true }))}>
      {label}{sort.by === by ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );
  const combined = t?.combinedNet ?? null;
  const cov = data?.coverage;
  const rangeFii = hist.reduce((s, p) => s + (p.fii ?? 0), 0);
  const rangeDii = hist.reduce((s, p) => s + (p.dii ?? 0), 0);
  const rangeHasDii = hist.some((p) => p.dii != null);

  return (
    <div style={{ background: C.panel, color: C.text, minHeight: '100vh', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🏦 FII / DII Flows</h1>
            <div style={{ fontSize: 13, color: C.soft, marginTop: 4 }}>How much foreign investors (FII / FPI) and Indian institutions (DII) bought or sold in Indian shares, day by day.</div>
          </div>
          <button onClick={() => setNonce((n) => n + 1)} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', color: C.accent, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {data && !data.ok ? <div style={{ ...box, color: RED }}>{data.error || 'Could not load.'}</div> : null}
        {data?.ok && !data.available ? (
          <div style={{ ...box, color: C.soft }}>No figures stored yet. The app collects them every weekday evening from about 18:30 IST (NSE), and fills the history from NSDL in small steps — check back after the next run.</div>
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
              <SideCard title="FII / FPI (foreign)" side={t.fii} />
              <SideCard title="DII (Indian institutions)" side={t.dii} note="NSDL does not publish DII figures" />
              <div style={{ ...box, flex: '1 1 240px' }}>
                <div style={{ fontSize: 13, color: C.soft, fontWeight: 600 }}>Combined (FII + DII)</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: flowColor(combined), margin: '6px 0 2px' }}>{fmtCr(combined, { signed: true })}</div>
                <div style={{ fontSize: 12, color: C.soft }}>{combined == null ? 'Needs both figures' : combined >= 0 ? 'Institutions together were net buyers' : 'Institutions together were net sellers'}</div>
                {t.fpiConfirmedNet != null && t.source === 'nse' ? (
                  <div style={{ fontSize: 12, color: C.soft, marginTop: 10 }}>NSDL-confirmed FPI figure: <b style={{ color: flowColor(t.fpiConfirmedNet) }}>{fmtCr(t.fpiConfirmedNet, { signed: true })}</b></div>
                ) : null}
                {data?.totals ? (
                  <div style={{ fontSize: 12, color: C.soft, marginTop: 8 }}>
                    Last month: FII <b style={{ color: flowColor(data.totals.fii1m.sum) }}>{fmtCr(data.totals.fii1m.sum, { signed: true })}</b>
                    {data.totals.dii1m.days ? <> · DII <b style={{ color: flowColor(data.totals.dii1m.sum) }}>{fmtCr(data.totals.dii1m.sum, { signed: true })}</b></> : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <StreakChip who="FII" s={data?.streaks?.fii} />
              <StreakChip who="DII" s={data?.streaks?.dii} />
            </div>
          </div>
        ) : null}

        {data?.available ? (
          <div style={{ ...box }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Foreign money: running total</div>
                <div style={{ fontSize: 12, color: C.soft }}>FII net flow added up day by day over the period. Rising line = foreigners putting money in.</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {RANGES.map((r) => (
                  <button key={r} onClick={() => setRange(r)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${r === range ? C.accent : C.line}`, background: r === range ? '#eff6ff' : C.bg, color: r === range ? C.accent : C.soft, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{r}</button>
                ))}
              </div>
            </div>
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

            {cov ? (
              <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>
                Stored: {cov.days.toLocaleString('en-IN')} trading days, {fmtDate(cov.firstDate)} – {fmtDate(cov.lastDate)}.
                {cov.firstNseDate && cov.firstDate && cov.firstDate < cov.firstNseDate
                  ? ` Before ${fmtDate(cov.firstNseDate)} the FII figures are NSDL's confirmed FPI equity figures (stock-exchange trades); DII figures start ${fmtDate(cov.firstNseDate)}, when this page began saving NSE's daily numbers — no free public source has older DII history.`
                  : !cov.firstNseDate ? ' These are NSDL FII figures only; NSE FII + DII figures are added from the next evening run.' : ''}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ ...box }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Foreign money by sector</div>
              <div style={{ fontSize: 12, color: C.soft }}>NSDL fortnightly report, shares (equity) only, ₹ crore. Click a column to sort.</div>
            </div>
            <div style={{ fontSize: 12, color: C.soft }}>Last report: <b>{fmtDate(sec?.lastReport)}</b>{sec && sec.reports1y && sec.reports1y < 24 ? ` · 1-year figures cover ${sec.reports1y} of 24 fortnights so far` : ''}</div>
          </div>
          {lines.length ? (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>Sector</th>
                    {sortBtn('auc', 'Holding (AUM)')}
                    <th style={th}>Share</th>
                    {sortBtn('fortnight', 'Last fortnight')}
                    {sortBtn('oneYear', '1-year net flow')}
                    <th style={th}>1Y as % of AUM</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.sector}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{l.sector}</td>
                      <td style={td}>{fmtCr(l.aucCr)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ width: 60, height: 6, background: C.line, borderRadius: 3 }}><div style={{ width: `${Math.min(100, l.sharePct * 3)}%`, height: 6, background: C.accent, borderRadius: 3 }} /></div>
                          {l.sharePct.toFixed(1)}%
                        </div>
                      </td>
                      <td style={{ ...td, color: flowColor(l.fortnightCr), fontWeight: 600 }}>{fmtCr(l.fortnightCr, { signed: true })}</td>
                      <td style={{ ...td, color: flowColor(l.oneYearCr), fontWeight: 600 }}>{fmtCr(l.oneYearCr, { signed: true })}</td>
                      <td style={{ ...td, color: flowColor(l.oneYearPctOfAuc) }}>{fmtPct(l.oneYearPctOfAuc, true)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>All sectors</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtCr(sec?.totalAucCr)}</td>
                    <td style={td}>100%</td>
                    <td style={{ ...td, fontWeight: 700, color: flowColor(sec?.totalFortnightCr) }}>{fmtCr(sec?.totalFortnightCr, { signed: true })}</td>
                    <td style={{ ...td, fontWeight: 700, color: flowColor(sec?.totalOneYearCr) }}>{fmtCr(sec?.totalOneYearCr, { signed: true })}</td>
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <div style={{ fontSize: 13, color: C.soft, marginTop: 10 }}>No sector report stored yet — NSDL publishes one around the 1st and the 16th of each month; the app picks it up automatically.</div>}
        </div>

        <div style={{ ...box, background: '#f1f5f9' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>How to read this</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.soft, lineHeight: 1.6 }}>
            <li><b>FII / FPI</b> = foreign investors (funds outside India). <b>DII</b> = Indian institutions: mutual funds, insurers, banks, pension funds. Net = bought minus sold, in ₹ crore (1 crore = 10 million; 1 lakh crore = 1,00,000 crore).</li>
            <li><b>Provisional vs final.</b> NSE publishes the evening figures from what brokers report the same day. NSDL confirms the foreign figure a day later from custodian reports; it also counts other exchanges and new issues, so the two numbers usually differ a little.</li>
            <li><b>One day means little.</b> A single big day can be one index rebalance or block deal. Look at streaks, the 20-day sum and the running total — they show whether money is steadily coming in or going out.</li>
            <li><b>When FIIs sell and DIIs buy</b> (common in recent years), Indian money is absorbing the selling. Example: FII −₹5,000 Cr and DII +₹3,300 Cr means a combined −₹1,700 Cr.</li>
            <li><b>Sector table:</b> “Holding” is what foreigners own in that sector; the 1-year flow as a % of it shows whether they have been adding or cutting. Example: −₹20,000 Cr on a ₹5 L Cr holding = −4%.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
