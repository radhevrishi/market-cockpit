'use client';
// 🎯 Options Ideas (zzz1301) — calls and puts from price structure only (trendlines, breakout + retest, cups), graded with a
// historical study of ~44,400 past setups (2017–2026) (lib/options-ideas). Tabs: Scanner · Analyse a company · My lists · Track record ·
// How it works. Nothing here is a buy or sell order.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { IdeaCard, GradeBadge, SideBadge, HistoryLine, GRADE_COL, StructureChart, type Bar5 } from '@/components/options-ideas/IdeaCard';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { MarketPanel } from '@/components/options-ideas/MarketPanel';
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getUsConvictionList } from '@/lib/conviction-beats-us';

type Mkt = 'US' | 'IN';
type Tab = 'scan' | 'one' | 'lists' | 'record' | 'how';
const TABS: Array<[Tab, string]> = [['scan', 'Scanner'], ['one', 'Analyse a company'], ['lists', 'My lists'], ['record', 'Track record'], ['how', 'How it works']];
const card: CSSProperties = { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 12, padding: 16 };
const th: CSSProperties = { padding: '7px 8px', textAlign: 'left', fontSize: 11.5, color: 'var(--mc-text-3)', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer' };
const td: CSSProperties = { padding: '7px 8px', borderTop: '1px solid var(--mc-border-1)', fontSize: 13.5, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' };
const money = (m: string, x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${m === 'US' ? '$' : '₹'}${x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x.toFixed(2)}`);
const chip = (on: boolean): CSSProperties => ({ padding: '5px 11px', borderRadius: 8, border: `1px solid ${on ? 'var(--mc-cyan, #22D3EE)' : 'var(--mc-border-1)'}`, background: on ? 'rgba(34,211,238,0.12)' : 'transparent', color: on ? 'var(--mc-text-0)' : 'var(--mc-text-2)', fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const LS_MKT = 'mc:options-ideas:market:v1';

function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(init);
  useEffect(() => { try { const r = localStorage.getItem(key); if (r) setV(JSON.parse(r)); } catch { /* */ } }, [key]);
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* */ } }];
}

function IdeasTable({ ideas, onOpen, open }: { ideas: any[]; onOpen: (k: string) => void; open: string | null }) {
  const [sort, setSort] = useState<{ k: string; d: number }>({ k: 'grade', d: 1 });
  const val = (i: any, k: string): number | string => {
    switch (k) {
      case 'grade': return (({ 'A+': 0, A: 1, B: 2, C: 3 } as any)[i.grade] ?? 4) * 1000 - i.setup.quality;
      case 'ticker': return i.ticker;
      case 'cap': return ({ small: 0, mid: 1, large: 2 } as any)[i.cap ?? 'large'] ?? 3;
      case 'rr': return -i.setup.rr1;
      case 'risk': return i.setup.riskPct;
      case 'hist': return -(i.history.setup?.trailR ?? i.history.group?.trailR ?? -9);
      case 'opt': return -(i.option?.atTarget1?.retPct ?? -999);
      case 'q': return -i.setup.quality;
      case 'adr': return -(i.ctx?.adr ?? 0);
      default: return 0;
    }
  };
  const rows = [...ideas].sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * sort.d; });
  const H = ({ k, children }: { k: string; children: any }) => <th style={th} onClick={() => setSort({ k, d: sort.k === k ? -sort.d : 1 })}>{children}{sort.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <H k="grade">Grade</H><H k="ticker">Company</H><H k="cap">Size</H><th style={th}>Setup</th><th style={th}>Entry → stop</th><th style={th}>Targets</th>
          <H k="rr">R:R</H><H k="risk">Risk</H><H k="adr">ADR%</H><H k="opt">Option (suggested)</H><H k="hist">Trades like this before</H><H k="q">Quality</H>
        </tr></thead>
        <tbody>
          {rows.map((i) => {
            const k = `${i.market}|${i.ticker}|${i.setup.id}`;
            return [
              <tr key={k} onClick={() => onOpen(k)} style={{ cursor: 'pointer', background: open === k ? 'rgba(34,211,238,0.06)' : undefined }}>
                <td style={td}><GradeBadge g={i.grade} />{i.caution ? <span title={i.caution} style={{ color: '#F59E0B', marginLeft: 4 }}>⚠</span> : null}</td>
                <td style={td}><b>{i.ticker}</b><div style={{ fontSize: 11.5, color: 'var(--mc-text-3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name || ''}</div></td>
                <td style={td}>{i.cap ?? '—'}</td>
                <td style={td}><SideBadge side={i.setup.side} /><div style={{ fontSize: 12.5, marginTop: 2 }}>{i.setup.label}</div></td>
                <td style={td}>{money(i.market, i.setup.trigger)}{i.setup.triggered ? ' ✓' : ''} → <span style={{ color: '#EF4444' }}>{money(i.market, i.setup.stop)}</span></td>
                <td style={td}><span style={{ color: '#10B981' }}>{money(i.market, i.setup.target1)}</span> / {money(i.market, i.setup.target2)}</td>
                <td style={td}>{i.setup.rr1}</td>
                <td style={td}>{i.setup.riskPct}%</td>
                <td style={{ ...td, color: (i.ctx?.adr ?? 0) >= 5.5 ? '#EF4444' : (i.ctx?.adr ?? 0) >= 3.5 ? '#F59E0B' : (i.ctx?.adr ?? 0) < 2 ? '#10B981' : undefined }} title="Average daily range, 20 sessions (TradingView formula). ≥ 5.5% = wild mover, < 2% = calm">{i.ctx?.adr != null ? i.ctx.adr.toFixed(1) : '—'}</td>
                <td style={td}>{i.option ? <>{money(i.market, i.option.strike)} {i.option.expiry?.slice(5)} · {money(i.market, i.option.premium)}{i.option.premiumSource === 'chain' ? '' : '*'}<div style={{ fontSize: 11.5, color: '#10B981' }}>at T1 {i.option.atTarget1.retPct > 0 ? '+' : ''}{i.option.atTarget1.retPct}%</div></> : '—'}</td>
                <td style={td}><HistoryLine h={i.history.setup ?? i.history.group} compact /></td>
                <td style={td}>{i.setup.quality}</td>
              </tr>,
              open === k ? <tr key={k + ':d'}><td colSpan={12} style={{ padding: 10 }}><IdeaDetail idea={i} /></td></tr> : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** opened row: fetch the company again with bars + live chain */
function IdeaDetail({ idea }: { idea: any }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/v1/options-ideas?market=${idea.market}&ticker=${encodeURIComponent(idea.ticker)}`).then((x) => x.json()).then((j) => { if (!off) setR(j); }).catch(() => { if (!off) setR({ ok: false }); });
    return () => { off = true; };
  }, [idea.market, idea.ticker]);
  const live = r?.ideas?.find((x: any) => x.setup.id === idea.setup.id);
  return <div>
    {!r ? <div style={{ fontSize: 12.5, color: 'var(--mc-text-3)', marginBottom: 6 }}>Loading today’s chart and the live option chain…</div>
      : !live ? <div style={{ fontSize: 12.5, color: '#F59E0B', marginBottom: 6 }}>The setup is no longer present on the latest bars — showing the scan’s copy.</div> : null}
    <IdeaCard idea={live ?? idea} bars={(r?.bars as Bar5[]) ?? null} />
  </div>;
}

export default function OptionsIdeasPage() {
  const [market, setMarket] = useStored<Mkt>(LS_MKT, 'US');
  const [tab, setTab] = useState<Tab>('scan');
  useEffect(() => { try { const t = new URLSearchParams(window.location.search).get('view') as Tab; if (t && TABS.some((x) => x[0] === t)) setTab(t); } catch { /* */ } }, []);
  const go = (t: Tab) => { setTab(t); try { const u = new URL(window.location.href); u.searchParams.set('view', t); window.history.replaceState(null, '', u.toString()); } catch { /* */ } };
  return (
    <div style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>🎯 Options Ideas</h1>
        <span style={{ fontSize: 13, color: 'var(--mc-text-3)' }}>Calls & puts from price structure — trendlines, breakout + retest, cups — graded by how similar trades did before.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['US', 'IN'] as Mkt[]).map((m) => <button key={m} onClick={() => setMarket(m)} style={chip(market === m)}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</button>)}
        </div>
      </div>
      <div style={{ margin: '12px 0' }}><MarketPanel market={market} /></div>
      <div style={{ display: 'flex', gap: 6, margin: '12px 0', flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} onClick={() => go(k)} style={chip(tab === k)}>{l}</button>)}
      </div>
      {tab === 'scan' && <ScanTab market={market} />}
      {tab === 'one' && <OneTab market={market} />}
      {tab === 'lists' && <ListsTab market={market} />}
      {tab === 'record' && <RecordTab market={market} />}
      {tab === 'how' && <HowTab />}
      <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 16 }}>Decision support only, not advice. Options can lose 100% of the premium. Check the live bid / ask, expiry and lot size in your broker before any trade.</div>
    </div>
  );
}

function ScanTab({ market }: { market: Mkt }) {
  const [j, setJ] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [grade, setGrade] = useState<'A+' | 'A' | 'AB'>('A');
  const [hideRes, setHideRes] = useState(true);
  const [adrF, setAdrF] = useState<'all' | 'calm' | 'wild'>('all');
  const [side, setSide] = useState<'all' | 'CALL' | 'PUT'>('all');
  const [cap, setCap] = useState<'all' | 'sm'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { setJ(null); fetch(`/api/v1/options-ideas?market=${market}`).then((r) => r.json()).then(setJ).catch(() => setJ({ ok: false })); }, [market]);
  useEffect(() => { load(); }, [load]);
  const run = async () => {
    setBusy(true); setMsg('Scanning (up to 4 minutes; the full scan runs every evening after the close)…');
    const r = await fetch(`/api/v1/options-ideas?market=${market}&run=1`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setBusy(false); setMsg(r?.ok ? `Scanned ${r.scanned} companies in ${r.tookS}s: ${r.counts.A} grade A, ${r.counts.B} grade B.` : r?.error || 'Scan failed.');
    load();
  };
  const scan = j?.scan;
  const ideas = useMemo(() => (scan?.ideas ?? []).filter((i: any) => (grade === 'A+' ? i.grade === 'A+' : grade === 'A' ? i.grade === 'A+' || i.grade === 'A' : i.grade !== 'C') && (side === 'all' || i.setup.side === side) && (cap === 'all' || i.cap === 'small' || i.cap === 'mid') && !(hideRes && i.option?.results?.beforeExpiry) && (adrF === 'all' || i.ctx?.adr == null || (adrF === 'calm' ? i.ctx.adr < 3.5 : i.ctx.adr >= 3.5))), [scan, grade, side, cap, hideRes, adrF]);
  const throughRes = (scan?.ideas ?? []).filter((i: any) => i.grade !== 'C' && i.option?.results?.beforeExpiry).length;
  // sector heat: trade-grade ideas per sector (3+ = correlated bets)
  const heat = useMemo(() => { const m = new Map<string, number>(); for (const i of (scan?.ideas ?? [])) if ((i.grade === 'A+' || i.grade === 'A') && i.ctx?.sector) m.set(i.ctx.sector, (m.get(i.ctx.sector) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [scan]);
  const g = j?.study?.groups?.[`${market}|CALL|A`], gp = j?.study?.groups?.[`${market}|CALL|A+`];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div><div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Last scan</div><b>{scan ? new Date(scan.builtAt).toLocaleString() : j ? 'none yet' : '…'}</b>{scan ? <span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}> · {scan.scanned} companies</span> : null}</div>
        <div><div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Grade A+ / A / B</div><b style={{ color: GRADE_COL['A+'] }}>{scan?.counts?.['A+'] ?? 0}</b> / <b style={{ color: GRADE_COL.A }}>{scan?.counts?.A ?? '—'}</b> / <b style={{ color: GRADE_COL.B }}>{scan?.counts?.B ?? '—'}</b></div>
        {gp ? <div style={{ fontSize: 13, maxWidth: 560 }}><div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Grade A+ calls in the study ({market === 'US' ? 'USA' : 'India'})</div><HistoryLine h={gp} /></div> : g ? <div style={{ fontSize: 13, maxWidth: 560 }}><div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Grade A calls in the study</div><HistoryLine h={g} /></div> : null}
        <button onClick={run} disabled={busy} style={{ ...chip(false), marginLeft: 'auto' }}>{busy ? 'Scanning…' : '↻ Scan now'}</button>
      </div>
      {scan?.regime ? <div style={{ ...card, padding: '10px 14px', borderLeft: `4px solid ${scan.regime.up ? '#10B981' : '#EF4444'}`, fontSize: 14 }}><b>Market today:</b> {scan.regime.label}</div> : null}
      {msg ? <div style={{ fontSize: 13, color: 'var(--mc-text-2)' }}>{msg}</div> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={chip(grade === 'A+')} onClick={() => setGrade('A+')}>A+ only (best)</button>
        <button style={chip(grade === 'A')} onClick={() => setGrade('A')}>A+ and A</button>
        <button style={chip(grade === 'AB')} onClick={() => setGrade('AB')}>A + B (watch)</button>
        <span style={{ width: 10 }} />
        {(['all', 'CALL', 'PUT'] as const).map((s) => <button key={s} style={chip(side === s)} onClick={() => setSide(s)}>{s === 'all' ? 'Calls + puts' : s === 'CALL' ? 'Calls' : 'Puts'}</button>)}
        <span style={{ width: 10 }} />
        <button style={chip(cap === 'sm')} onClick={() => setCap(cap === 'sm' ? 'all' : 'sm')}>Small + mid caps only</button>
        <button style={chip(adrF !== 'all')} onClick={() => setAdrF(adrF === 'all' ? 'calm' : adrF === 'calm' ? 'wild' : 'all')}>{adrF === 'all' ? 'ADR: all' : adrF === 'calm' ? 'ADR < 3.5% (steadier)' : 'ADR ≥ 3.5% (big movers)'}</button>
        <button style={chip(hideRes)} onClick={() => setHideRes(!hideRes)}>Hide ideas held through results{throughRes ? ` (${throughRes})` : ''}</button>
      </div>
      {heat.length ? <div style={{ fontSize: 13, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><span style={{ color: 'var(--mc-text-3)' }}>Trade ideas by sector:</span>{heat.map(([sec, n]) => <span key={sec} title={n >= 3 ? 'Three or more ideas in one sector move together — take one or two, not all' : ''} style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${n >= 3 ? '#F59E0B' : 'var(--mc-border-1)'}`, color: n >= 3 ? '#F59E0B' : 'var(--mc-text-2)', fontWeight: 700 }}>{sec} {n}{n >= 3 ? ' ⚠ same bet' : ''}</span>)}</div> : null}
      {scan?.chainsAt ? <div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>Option quotes for A+ / A ideas re-read near the close: {new Date(scan.chainsAt).toLocaleString()}</div> : null}
      <div style={card}>
        {!j ? 'Loading…' : !scan ? <div>No scan stored yet for {market === 'US' ? 'the USA' : 'India'}. The scan runs every weekday after the close ({market === 'US' ? '21:52 UTC' : '11:27 UTC'}); press “Scan now” to run a shorter one.</div>
          : !ideas.length ? <div><b>No idea passes these filters.</b> {(() => {
              const all = (scan?.ideas ?? []).filter((i: any) => i.grade !== 'C');
              const byGrade = all.filter((i: any) => (grade === 'A+' ? i.grade === 'A+' : grade === 'A' ? i.grade === 'A+' || i.grade === 'A' : true));
              const parts: string[] = [`${all.length} ideas in the scan`, `${byGrade.length} with the grade filter`];
              if (side !== 'all') parts.push(`side ${side}`);
              if (cap === 'sm') parts.push('small + mid caps only');
              if (adrF !== 'all') parts.push(adrF === 'calm' ? 'ADR < 3.5%' : 'ADR ≥ 3.5%');
              if (hideRes) parts.push('results before expiry hidden');
              const fails = new Map<string, number>();
              for (const i of all) for (const c of i.checks ?? []) if (c.ok === false) fails.set(c.label, (fails.get(c.label) ?? 0) + 1);
              const top = [...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
              return `${parts.join(' · ')}.${top.length && (grade === 'A' || grade === 'A+') ? ` What keeps ideas below grade A today: ${top.map(([l, n]) => `${l.replace(/ — .*$/, '').replace(/\(.*?\)/g, '').trim()} (fails on ${n} of ${all.length})`).join('; ')}.` : ''}`;
            })()} <button onClick={() => { setGrade('AB'); setSide('all'); setCap('all'); setAdrF('all'); setHideRes(false); }} style={{ ...chip(false), marginLeft: 6 }}>Clear filters</button></div>
          : <IdeasTable ideas={ideas} open={open} onOpen={(k) => setOpen(open === k ? null : k)} />}
        {scan && (scan.ideas ?? []).some((i: any) => i.ctx?.adr == null) ? <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 8 }}>This scan was stored before ADR% was added — press “Scan now” to fill it.</div> : null}
        {scan ? <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 8 }}>* model premium (no live chain read for that row). Click a row for the chart, the live option chain and the full plan.</div> : null}
      </div>
    </div>
  );
}

function OneTab({ market }: { market: Mkt }) {
  const [t, setT] = useState('');
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const go = async (tk?: string) => {
    const q = (tk ?? t).trim(); if (!q) return;
    setBusy(true); setR(null);
    const j = await fetch(`/api/v1/options-ideas?market=${market}&ticker=${encodeURIComponent(q)}`).then((x) => x.json()).catch(() => ({ ok: false, error: 'Request failed.' }));
    setBusy(false); setR(j);
  };
  useEffect(() => { try { const q = new URLSearchParams(window.location.search).get('ticker'); if (q) { setT(q); void go(q); } } catch { /* */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={t} onChange={(e) => setT(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} placeholder={market === 'US' ? 'Ticker, e.g. NVDA' : 'NSE symbol, e.g. DIXON'}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-0, transparent)', color: 'var(--mc-text-0)', fontSize: 15, width: 220 }} />
        <button onClick={() => go()} disabled={busy} style={chip(true)}>{busy ? 'Reading…' : 'Analyse'}</button>
        <span style={{ fontSize: 12.5, color: 'var(--mc-text-3)' }}>Reads 2 years of daily bars, finds every structure, grades it and reads the live option chain.</span>
      </div>
      {r && !r.ok ? <div style={{ ...card, color: '#EF4444' }}>{r.error || 'Could not read this company.'}</div> : null}
      {r?.ok && !r.ideas?.length ? <div style={{ ...card, borderLeft: '4px solid #64748B' }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{r.ticker} <span style={{ fontSize: 13, color: 'var(--mc-text-3)', fontWeight: 500 }}>{r.name}</span> <span style={{ fontSize: 13, color: 'var(--mc-text-2)', fontWeight: 600 }}>· {r.price != null ? (market === 'US' ? '$' : '₹') + r.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''} · {r.asOf}</span></div>
        <div style={{ marginTop: 6, fontSize: 15 }}>⛔ <b>No good setup right now.</b> {r.noSetup}</div>
        {r.bars?.length ? <div style={{ marginTop: 10 }}><StructureChart bars={r.bars} structure={r.structure} /></div> : null}
        <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 4 }}>Purple = trendlines (3+ touches) · pink = cup rim · dashed blue S = support level, dashed amber R = resistance level (3+ touches).</div>
        {r.structure?.watch?.length ? <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>What would make it a setup (nearest first)</div>
          <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 13.5, lineHeight: 1.6 }}>{r.structure.watch.map((w: any, i: number) => <li key={i}>{w.what}</li>)}</ul>
        </div> : null}
        {r.structure?.notes?.length ? <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12.5, color: 'var(--mc-text-3)' }}>{r.structure.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul> : null}
      </div> : null}
      {r?.ok && r.regime ? <div style={{ ...card, padding: '10px 14px', borderLeft: `4px solid ${r.regime.up ? '#10B981' : '#EF4444'}`, fontSize: 14 }}><b>Market today:</b> {r.regime.label}</div> : null}
      {r?.ok && r.ideas?.length && r.chainNote ? <div style={{ fontSize: 12.5, color: '#F59E0B' }}>Live option chain not available ({r.chainNote}) — premiums below are model prices.</div> : null}
      {r?.ok && r.ideas?.length ? r.ideas.map((i: any) => <IdeaCard key={i.setup.id} idea={i} bars={r.bars} />) : null}
    </div>
  );
}

function ListsTab({ market }: { market: Mkt }) {
  const [res, setRes] = useState<any[] | null>(null);
  const [prog, setProg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const names = useMemo(() => {
    if (typeof window === 'undefined') return [] as string[];
    const out = new Set<string>();
    try {
      const map = getPortfolioMap();
      for (const [k, h] of map) if (((h as any)?.market === 'US') === (market === 'US')) out.add(String(k).toUpperCase().replace(/^(NSE|BSE):/, ''));
    } catch { /* */ }
    try { if (market === 'IN') for (const t of getConvictionTickers()) out.add(t.toUpperCase()); else for (const e of getUsConvictionList()) if (e?.ticker) out.add(String(e.ticker).toUpperCase()); } catch { /* */ }
    try {
      const w = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]');
      for (const x of Array.isArray(w) ? w : []) { const s = typeof x === 'string' ? x : x?.ticker || x?.symbol; const m = typeof x === 'object' ? x?.market : null; if (s && (!m || (m === 'US') === (market === 'US'))) out.add(String(s).toUpperCase().replace(/^(NSE|BSE):/, '')); }
    } catch { /* */ }
    return [...out].filter(Boolean);
  }, [market]);
  const run = async () => {
    const all: any[] = [];
    setRes([]);
    for (let i = 0; i < names.length; i += 10) {
      setProg(`Reading ${Math.min(i + 10, names.length)} of ${names.length}…`);
      const j = await fetch(`/api/v1/options-ideas?market=${market}&tickers=${encodeURIComponent(names.slice(i, i + 10).join(','))}`).then((x) => x.json()).catch(() => null);
      for (const r of j?.results ?? []) all.push(r);
      setRes([...all]);
    }
    setProg(null);
  };
  const ideas = (res ?? []).flatMap((r) => r.ideas ?? []);
  const none = (res ?? []).filter((r) => r.ok && !r.ideas?.length).map((r) => r.ticker);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>{names.length} companies in your {market === 'US' ? 'US book, US Conviction Beats and watchlist' : 'India holdings, Conviction Beats and watchlist'}.</div>
        <button onClick={run} disabled={!!prog || !names.length} style={chip(true)}>{prog ?? 'Scan my lists'}</button>
      </div>
      {res ? <div style={card}>{ideas.length ? <IdeasTable ideas={ideas} open={open} onOpen={(k) => setOpen(open === k ? null : k)} /> : prog ? 'Reading…' : 'No setups on your lists right now.'}
        {none.length ? <div style={{ fontSize: 12.5, color: 'var(--mc-text-3)', marginTop: 8 }}>No valid setup: {none.join(', ')}</div> : null}</div> : null}
    </div>
  );
}

function RecordTab({ market }: { market: Mkt }) {
  const [j, setJ] = useState<any>(null);
  useEffect(() => { fetch('/api/v1/options-ideas?log=1').then((r) => r.json()).then(setJ).catch(() => setJ({ ok: false })); }, []);
  if (!j) return <div style={card}>Loading…</div>;
  const st = j.study;
  const log: any[] = (j.log ?? []).filter((e: any) => e.market === market).sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
  const closed = log.filter((e) => ['target', 'stop', 'timeout'].includes(e.status));
  const summ = (rows: any[]) => { const n = rows.length; if (!n) return null; const w = rows.filter((e) => (e.r ?? 0) > 0).length; const avg = rows.reduce((a, e) => a + (e.rTrail ?? e.r ?? 0), 0) / n; return { n, win: Math.round((w / n) * 100), avg: Math.round(avg * 100) / 100 }; };
  const sAp = summ(closed.filter((e) => e.grade === 'A+')), sA = summ(closed.filter((e) => e.grade === 'A')), sB = summ(closed.filter((e) => e.grade === 'B'));
  const audit = (() => { const r = closed.filter((e) => e.rTrail != null && e.r != null); if (!r.length) return null; const m = (k: string) => Math.round((r.reduce((a, e: any) => a + e[k], 0) / r.length) * 100) / 100; return { n: r.length, base: m('r'), managed: m('rTrail') }; })();
  const slice = (f: (e: any) => boolean) => summ(closed.filter(f));
  const grp = (k: string) => st?.groups?.[k];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Live track record ({market === 'US' ? 'USA' : 'India'})</div>
        <div style={{ fontSize: 13.5 }}>Every grade A / B idea from the daily scan is logged and followed with the study's rules (fill within 5 sessions, stop or target 1, 40-session limit).</div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap', fontSize: 14 }}>
          <div>Logged: <b>{log.length}</b> · open {log.filter((e) => e.status === 'open').length} · not filled {log.filter((e) => e.status === 'nofill').length}</div>
          <div><GradeBadge g="A+" /> closed {sAp?.n ?? 0}{sAp ? <> · won {sAp.win}% · {sAp.avg > 0 ? '+' : ''}{sAp.avg} R a trade</> : null}</div>
          <div><GradeBadge g="A" /> closed {sA?.n ?? 0}{sA ? <> · won {sA.win}% · {sA.avg > 0 ? '+' : ''}{sA.avg} R a trade</> : null}</div>
          <div><GradeBadge g="B" /> closed {sB?.n ?? 0}{sB ? <> · won {sB.win}% · {sB.avg > 0 ? '+' : ''}{sB.avg} R a trade</> : null}</div>
        </div>
        <div style={{ fontSize: 13, marginTop: 6, color: 'var(--mc-text-2)' }}>
          <b>Stop-to-entry audit:</b> {audit ? <>on {audit.n} closed trades, holding to the first stop / target made {audit.base > 0 ? '+' : ''}{audit.base} R a trade; with the stop moved to the entry at +1R {audit.managed > 0 ? '+' : ''}{audit.managed} R. (Study: +0.22 vs +0.28.)</> : 'needs closed trades.'}
          {' '}<b>By market state:</b> {(['up', 'not up'] as const).map((k) => { const x = slice((e) => (k === 'up') === !!e.regimeUp); return <span key={k}> market {k}: {x ? `${x.n} trades, ${x.avg > 0 ? '+' : ''}${x.avg} R` : '—'} ·</span>; })}
          {' '}<b>With catalyst:</b> {(() => { const x = slice((e) => e.catalyst === true), y = slice((e) => e.catalyst === false); return `${x ? `${x.n} trades ${x.avg} R` : '—'} vs without ${y ? `${y.n} trades ${y.avg} R` : '—'}`; })()}
          {' '}<b>Options expensive (HV ≥ 70th):</b> {(() => { const x = slice((e) => (e.hvPct ?? 0) >= 70); return x ? `${x.n} trades ${x.avg} R` : '—'; })()}
        </div>
        {log.length ? <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Grade</th><th style={th}>Company</th><th style={th}>Setup</th><th style={th}>Entry → stop · T1</th><th style={th}>Option</th><th style={th}>Result</th></tr></thead>
            <tbody>{log.slice(0, 300).map((e) => <tr key={e.key}>
              <td style={td}>{e.date}</td><td style={td}><GradeBadge g={e.grade} /></td><td style={td}><b>{e.ticker}</b></td>
              <td style={td}><SideBadge side={e.side} /> {e.id.replace(/_/g, ' ')}</td>
              <td style={td}>{money(e.market, e.trigger)} → {money(e.market, e.stop)} · {money(e.market, e.target1)}</td>
              <td style={td}>{e.strike ? `${money(e.market, e.strike)} ${e.expiry?.slice(5) ?? ''} @ ${money(e.market, e.premium)}` : '—'}</td>
              <td style={{ ...td, fontWeight: 700, color: e.status === 'target' ? '#10B981' : e.status === 'stop' ? '#EF4444' : 'var(--mc-text-2)' }}>{e.status === 'open' ? 'open' : e.status === 'nofill' ? 'not triggered' : `${e.status} ${e.r != null ? `${e.r > 0 ? '+' : ''}${e.r} R` : ''}${e.rTrail != null ? ` (managed ${e.rTrail > 0 ? '+' : ''}${e.rTrail} R)` : ''}`}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div style={{ fontSize: 13, color: 'var(--mc-text-3)', marginTop: 8 }}>Nothing logged yet — the first ideas are logged by the next evening scan.</div>}
      </div>
      {st ? <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>Historical study — how winners and losers behaved</div>
        <div style={{ fontSize: 12.5, color: 'var(--mc-text-3)' }}>{st.trainedOn.trades.toLocaleString('en-US')} simulated trades · {st.trainedOn.companies} companies · {st.trainedOn.from} → {st.trainedOn.to} · hold-out from {st.trainedOn.testFrom} (rules were set before looking at it)</div>
        <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13.5, lineHeight: 1.6 }}>{st.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Group</th><th style={th}>Trades</th><th style={th}>Reached T1</th><th style={th}>R a trade (managed)</th><th style={th}>Before / after hold-out</th><th style={th}>Option avg</th><th style={th}>Options that made money</th><th style={th}>Median sessions</th></tr></thead>
            <tbody>{(['CALL|A+', 'CALL|A', 'CALL|B', 'CALL|C', 'PUT|B', 'PUT|C']).flatMap((k) => (['US', 'IN'] as Mkt[]).map((m) => [m, k, grp(`${m}|${k}`)] as const)).filter((x) => x[2]).map(([m, k, h]: any) => (
              <tr key={m + k}><td style={td}>{m === 'US' ? '🇺🇸' : '🇮🇳'} {k.split('|')[0] === 'CALL' ? 'Calls' : 'Puts'} grade <GradeBadge g={k.split('|').slice(1).join('|')} /></td><td style={td}>{h.n}</td><td style={td}>{h.winRate}%</td>
                <td style={{ ...td, fontWeight: 800, color: h.trailR > 0.1 ? '#10B981' : h.trailR < 0 ? '#EF4444' : '#F59E0B' }}>{h.trailR > 0 ? '+' : ''}{h.trailR}</td>
                <td style={td}>{h.trainR} / {h.testR}</td><td style={td}>{h.optAvgRet > 0 ? '+' : ''}{h.optAvgRet}%</td><td style={td}>{h.optWinRate}%</td><td style={td}>{h.medSessions}</td></tr>))}</tbody>
          </table>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 12 }}>Recent grade A / A+ examples</div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Date</th><th style={th}>Company</th><th style={th}>Setup</th><th style={th}>Result (managed)</th><th style={th}>Sessions</th><th style={th}>Option</th></tr></thead>
          <tbody>{st.examples.map((e: any, i: number) => <tr key={i}><td style={td}>{e.date}</td><td style={td}>{e.market === 'US' ? '🇺🇸' : '🇮🇳'} <b>{e.ticker}</b></td><td style={td}>{e.id.replace(/_/g, ' ')}</td>
            <td style={{ ...td, fontWeight: 700, color: e.r > 0 ? '#10B981' : '#EF4444' }}>{e.r > 0 ? '+' : ''}{e.r} R</td><td style={td}>{e.sessions}</td><td style={{ ...td, color: (e.optRet ?? 0) > 0 ? '#10B981' : '#EF4444' }}>{e.optRet != null ? `${e.optRet > 0 ? '+' : ''}${e.optRet}%` : '—'}</td></tr>)}</tbody>
        </table></div>
      </div> : null}
    </div>
  );
}

function HowTab() {
  const P = ({ t, children }: { t: string; children: any }) => <div style={{ ...card, fontSize: 14, lineHeight: 1.6 }}><div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>{t}</div>{children}</div>;
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
      <P t="1 · Find the structure">Only price structure is used — no indicator crossings. The portal’s own engines find trendlines and horizontal levels with 3 or more touches, and cup / cup-with-handle bases (an inverse cup is the same detector on the price turned upside down).
        <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li><b>Calls:</b> uptrend support bounce · downtrend line breakout · breakout + retest of a 3-touch level · cup breakout + retest.</li>
          <li><b>Puts:</b> uptrend line breakdown · downtrend line rejection · breakdown + retest · inverse cup breakdown + retest.</li>
        </ul></P>
      <P t="2 · Plan the trade">Each structure gives an entry trigger (a trade beyond the bar that tested the line or level), a stop beyond the structure with an ATR buffer, target 1 (measured move or the next level, at least 1.5× the risk) and target 2. Stops tighter than ½ ATR or wider than 3½ ATR are rejected.</P>
      <P t="3b · What the later replays added">Grade A also needs the stock's <b>sector</b> to be stronger than the index over 3 months (calls in weak sectors lost money after July 2025). <b>A+</b> = grade A plus a fresh catalyst (a results-style gap up on 2× volume in the last 60 sessions, or 1.3× normal volume on the signal day): over 10 years +0.31 R a trade, +0.48 R after July 2025. <b>Fear</b>: when VIX ≥ 25 (India VIX ≥ 20) calls made +0.49 R a trade over 10 years — positive in 8 of 9 years, even with the market below its 200-day — so high fear makes a call grade A. Puts did worst exactly then. Tested and rejected: a time stop, spreads as the default, index puts, a weekly Stage 2 check.</P>
      <P t="3 · Grade it with history">The study followed ~44,400 past setups on 376 liquid companies (Dec 2017 – Nov 2026, including the 2020 crash and the 2022 bear market), using only the bars known each day. The pattern alone was close to a coin toss. What made the difference: a healthy stock (above its 200-day average, stronger than the index over 3 months), a healthy market (index above its 200-day and up over 20 sessions) and a target within 3× the risk. All three = grade A — as long as that setup type itself has paid in those conditions (India downtrend-line breaks did not, so they stop at B). Puts lost money in every condition tried — they are hedge / watch ideas only.</P>
      <P t="4 · Choose the option">Expiry: at least 30 days, and at least 1.6× the time similar trades took to reach target 1. Strike: delta about 0.5 (at the money) — in the study the steadiest; a safer (delta ~0.7) and an aggressive (~0.35) choice are shown too. Prices come from the live chain (Yahoo for the USA, NSE for India) when it can be read, else from Black–Scholes on the stock’s own volatility. Each choice shows its value at target 1, target 2 and the stop.</P>
      <P t="4b · Risk controls">Results date: when results fall before the chosen expiry, the expiry moves earlier if one still leaves 21 days, otherwise the idea is flagged and hidden by default. Volatility: when the stock's 20-day volatility is in the top 30% of its year the option is marked expensive. Position size: enter your account and risk per trade; it gives contracts / lots and warns when one Indian lot is more than your budget. Sector heat: three or more trade ideas in one sector are flagged as one bet. Option quotes for the A+ / A ideas are read again near the close, when bid / ask are real.</P>
      <P t="5 · Manage it">Move the stop to the entry once the stock is up 1× the risk; take half at target 1; let the rest run to target 2; close after 40 sessions or 7 days before expiry. In the study grade A options averaged about +20% a trade but only about 1 in 4 made money — a few big winners pay for many small losses, so size each trade to lose the premium without harm.</P>
      <P t="6 · Keep score">Every grade A / B idea from the daily scan goes into the live track record and is graded with the same rules, so you can see whether it keeps working after the study.</P>
    </div>
  );
}
