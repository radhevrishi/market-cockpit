'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

type FeedItem = { id: string; time: number; market: 'IN' | 'US' | 'GLOBAL'; ticker: string | null; headline: string; body: string; source: string; changePct: number | null; kind: 'news' | 'mover' | 'earnings' | 'macro' };

const COL = { card: '#11151f', line: '#1e2633', txt: '#e6edf3', mut: '#8b98a9', grn: '#10b981', red: '#ef4444', accent: '#22d3ee', amber: '#fbbf24', chip: '#1b2230' };

function pctStr(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function hhmm(ms: number) { try { return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }); } catch { return ''; } }
function nowStr() { try { return new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }); } catch { return ''; } }
function mapRegion(r: string): 'IN' | 'US' | 'GLOBAL' { const u = (r || '').toUpperCase(); if (u === 'IN' || u === 'INDIA') return 'IN'; if (u === 'US' || u === 'USA') return 'US'; return 'GLOBAL'; }
async function getJSON(url: string): Promise<any> { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
function withTimeout(p: Promise<any>, ms: number): Promise<any> { return Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]); }

function buildNews(news: any, earn: any): FeedItem[] {
  const out: FeedItem[] = [];
  if (Array.isArray(news)) news.forEach((n: any, i: number) => {
    const tks = (n.transmission && Array.isArray(n.transmission.beneficiaries)) ? n.transmission.beneficiaries : [];
    const t = new Date(n.published_at || n.publishedAt || Date.now()).getTime();
    out.push({ id: 'n' + (n.id || i), time: t, market: mapRegion(n.region || 'GLOBAL'), ticker: tks[0] || null, headline: n.headline || n.title || '', body: n.summary || '', source: n.source_name || n.source || '', changePct: null, kind: (n.article_type === 'MACRO') ? 'macro' : 'news' });
  });
  if (earn && Array.isArray(earn.results)) earn.results.filter((e: any) => e.quality && e.quality !== 'Upcoming').slice(0, 50).forEach((e: any, i: number) => {
    const t = new Date(e.resultDate || Date.now()).getTime();
    const pm = (typeof e.priceMove === 'number') ? e.priceMove : null;
    out.push({ id: 'e' + (e.ticker || i), time: t, market: 'IN', ticker: e.ticker || null, headline: (e.company || e.ticker || '') + ' - ' + (e.quarter || '') + ' ' + (e.quality || ''), body: (e.sector || '') + (pm != null ? (' - move ' + pm.toFixed(1) + '%') : ''), source: 'Earnings', changePct: pm, kind: 'earnings' });
  });
  return out;
}
function buildMovers(q: any, mk: 'IN' | 'US'): FeedItem[] {
  const out: FeedItem[] = []; if (!q) return out;
  const upd = new Date(q.updatedAt || Date.now()).getTime();
  const cur = mk === 'IN' ? 'Rs ' : 'USD ';
  const push = (arr: any[]) => { (arr || []).slice(0, 20).forEach((s: any) => { const cp = (typeof s.changePercent === 'number') ? s.changePercent : null; out.push({ id: 'm' + mk + s.ticker, time: upd, market: mk, ticker: s.ticker, headline: (s.company || s.ticker) + '  ' + ((cp != null && cp >= 0) ? 'UP' : 'DN') + ' ' + (cp != null ? pctStr(cp) : ''), body: (s.sector || '') + (s.price != null ? (' - ' + cur + s.price) : ''), source: mk === 'IN' ? 'NSE' : 'US Mkt', changePct: cp, kind: 'mover' }); }); };
  push(q.gainers); push(q.losers); return out;
}

export default function InPlayPage() {
  const [market, setMarket] = useState<'IN' | 'US' | 'ALL'>('IN');
  const [view, setView] = useState<'play' | 'head'>('play');
  const [cat, setCat] = useState<string>('ALL');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>('');
  const [asOf, setAsOf] = useState<string>('');
  const inFlight = useRef<boolean>(false);

  useEffect(() => { try { const m = localStorage.getItem('mc:inplay:market'); if (m) setMarket(m as any); const v = localStorage.getItem('mc:inplay:view'); if (v) setView(v as any); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('mc:inplay:market', market); localStorage.setItem('mc:inplay:view', view); } catch {} }, [market, view]);

  const load = useCallback(async (force: boolean) => {
    if (inFlight.current) return; inFlight.current = true; setErr('');
    const rp = force ? '&refresh=1' : '';
    try {
      const [news, earn] = await Promise.all([ getJSON('/api/v1/news?market=all'), getJSON('/api/market/earnings') ]);
      const base = buildNews(news, earn); base.sort((a, b) => b.time - a.time);
      setItems(base.slice(0, 400)); setAsOf(nowStr()); setLoading(false);
      const [qIN, qUS] = await Promise.all([
        withTimeout(getJSON('/api/market/quotes?market=india' + rp), 38000),
        withTimeout(getJSON('/api/market/quotes?market=us' + rp), 38000),
      ]);
      const mv = buildMovers(qIN, 'IN').concat(buildMovers(qUS, 'US'));
      if (mv.length) { const merged = base.concat(mv); merged.sort((a, b) => b.time - a.time); setItems(merged.slice(0, 400)); setAsOf(nowStr()); }
    } catch (e: any) { setErr('Could not load the feed - retrying on next refresh.'); }
    finally { setLoading(false); inFlight.current = false; }
  }, []);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 60000); return () => clearInterval(id); }, [load]);

  const filtered = items.filter((it) => {
    if (market !== 'ALL') { if (market === 'IN' && !(it.market === 'IN' || it.market === 'GLOBAL')) return false; if (market === 'US' && !(it.market === 'US' || it.market === 'GLOBAL')) return false; }
    if (cat !== 'ALL') { if (cat === 'MOVERS' && it.kind !== 'mover') return false; if (cat === 'EARNINGS' && it.kind !== 'earnings') return false; if (cat === 'NEWS' && it.kind !== 'news') return false; if (cat === 'MACRO' && it.kind !== 'macro') return false; }
    return true;
  });

  const seg = (active: boolean) => ({ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (active ? COL.accent : COL.line), color: active ? '#06121a' : COL.mut, background: active ? COL.accent : 'transparent' } as any);
  const catChip = (id: string, label: string) => (<button key={id} onClick={() => setCat(id)} style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (cat === id ? COL.amber : COL.line), color: cat === id ? COL.amber : COL.mut, background: 'transparent' }}>{label}</button>);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 16px', color: COL.txt }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.3px' }}>LIVE IN PLAY</div>
          <div style={{ fontSize: 11, color: COL.mut }}>India + US market-moving stream - news, movers and earnings, newest first</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: COL.mut }}>{asOf ? ('as of ' + asOf) : ''}</span>
          <button onClick={() => load(true)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + COL.amber, color: COL.amber, background: 'transparent' }}>{loading ? '...' : 'Refresh'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMarket('IN')} style={seg(market === 'IN')}>India</button>
        <button onClick={() => setMarket('US')} style={seg(market === 'US')}>USA</button>
        <button onClick={() => setMarket('ALL')} style={seg(market === 'ALL')}>All</button>
        <span style={{ width: 12 }} />
        <button onClick={() => setView('play')} style={seg(view === 'play')}>In Play</button>
        <button onClick={() => setView('head')} style={seg(view === 'head')}>Headlines</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {catChip('ALL', 'All')}{catChip('MOVERS', 'Movers')}{catChip('EARNINGS', 'Earnings')}{catChip('NEWS', 'News')}{catChip('MACRO', 'Macro')}
      </div>
      {err ? <div style={{ marginTop: 10, color: COL.amber, fontSize: 12 }}>{err}</div> : null}
      {loading && items.length === 0 ? <div style={{ marginTop: 16, color: COL.mut, fontSize: 12 }}>Loading live feed...</div> : null}
      <div style={{ marginTop: 12, borderTop: '1px solid ' + COL.line }}>
        {filtered.length === 0 && !loading ? <div style={{ padding: 24, textAlign: 'center', color: COL.mut }}>No items for this filter.</div> : null}
        {filtered.map((it) => {
          const cc = it.changePct == null ? COL.mut : (it.changePct >= 0 ? COL.grn : COL.red);
          const tagColor = it.kind === 'mover' ? COL.accent : it.kind === 'earnings' ? COL.amber : it.kind === 'macro' ? '#a78bfa' : COL.txt;
          return (
            <div key={it.id} style={{ display: 'flex', gap: 10, padding: view === 'head' ? '6px 4px' : '10px 4px', borderBottom: '1px solid ' + COL.line }}>
              <div style={{ width: 44, flexShrink: 0, fontSize: 11, color: COL.mut, paddingTop: 2 }}>{hhmm(it.time)}</div>
              <div style={{ width: 92, flexShrink: 0 }}>
                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: COL.chip, color: tagColor, fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{it.ticker || it.kind.toUpperCase()}</span>
                <span style={{ display: 'block', fontSize: 9, color: COL.mut, marginTop: 2 }}>{it.market}{it.source ? (' - ' + it.source) : ''}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: COL.txt }}>{it.headline}{it.changePct != null ? <span style={{ color: cc, marginLeft: 6, fontWeight: 700 }}>{pctStr(it.changePct)}</span> : null}</div>
                {view === 'play' && it.body ? <div style={{ fontSize: 12, color: COL.mut, marginTop: 3, lineHeight: 1.45 }}>{it.body}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 10, color: COL.mut, textAlign: 'center', paddingBottom: 20 }}>Auto-refreshes every 60s while open. Movers may take a few seconds after a fresh deploy while the cache warms.</div>
    </div>
  );
}
