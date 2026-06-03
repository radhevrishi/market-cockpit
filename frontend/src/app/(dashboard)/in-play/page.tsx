'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

type FeedItem = { id: string; time: number; market: 'IN' | 'US' | 'GLOBAL'; ticker: string | null; headline: string; body: string; source: string; price: number | null; changePct: number | null; kind: 'mover' | 'news' | 'earnings' | 'macro' };

const COL = { line: '#1e2633', txt: '#e6edf3', mut: '#8b98a9', grn: '#10b981', red: '#ef4444', accent: '#22d3ee', amber: '#fbbf24', chip: '#1b2230' };

function pctStr(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function priceStr(mk: string, p: number | null) { if (p == null) return ''; return (mk === 'US' ? '$' : 'Rs ') + p.toLocaleString('en-US'); }
function hhmm(ms: number) { try { return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }); } catch { return ''; } }
function nowStr() { try { return new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }); } catch { return ''; } }
function mapRegion(r: string): 'IN' | 'US' | 'GLOBAL' { const u = (r || '').toUpperCase(); if (u === 'IN' || u === 'INDIA') return 'IN'; if (u === 'US' || u === 'USA') return 'US'; return 'GLOBAL'; }
async function getJSON(url: string): Promise<any> { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
function withTimeout(p: Promise<any>, ms: number): Promise<any> { return Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]); }

function buildNewsMap(news: any): Record<string, string> { const m: Record<string, string> = {}; if (Array.isArray(news)) news.forEach((n: any) => { const tks = (n.transmission && Array.isArray(n.transmission.beneficiaries)) ? n.transmission.beneficiaries : []; const h = n.headline || n.title || ''; tks.forEach((t: string) => { const k = (t || '').toUpperCase(); if (k && !m[k]) m[k] = h; }); }); return m; }
function buildPx(qIN: any, qUS: any): Record<string, any> { const m: Record<string, any> = {}; const add = (q: any, mk: 'IN' | 'US') => { if (!q || !Array.isArray(q.stocks)) return; q.stocks.forEach((s: any) => { const k = (s.ticker || '').toUpperCase(); if (k && !(k in m)) m[k] = { price: (typeof s.price === 'number' ? s.price : null), cp: (typeof s.changePercent === 'number' ? s.changePercent : null), mk: mk }; }); }; add(qIN, 'IN'); add(qUS, 'US'); return m; }

function buildNews(news: any, earn: any): FeedItem[] {
  const out: FeedItem[] = [];
  if (Array.isArray(news)) news.forEach((n: any, i: number) => {
    const tks = (n.transmission && Array.isArray(n.transmission.beneficiaries)) ? n.transmission.beneficiaries : [];
    const t = new Date(n.published_at || n.publishedAt || Date.now()).getTime();
    out.push({ id: 'n' + (n.id || i), time: t, market: mapRegion(n.region || 'GLOBAL'), ticker: tks[0] || null, headline: n.headline || n.title || '', body: n.summary || '', source: n.source_name || n.source || '', price: null, changePct: null, kind: (n.article_type === 'MACRO') ? 'macro' : 'news' });
  });
  if (earn && Array.isArray(earn.results)) earn.results.filter((e: any) => e.quality && e.quality !== 'Upcoming').slice(0, 60).forEach((e: any, i: number) => {
    const t = new Date(e.resultDate || Date.now()).getTime();
    const pm = (typeof e.priceMove === 'number') ? e.priceMove : null;
    out.push({ id: 'e' + (e.ticker || i), time: t, market: 'IN', ticker: e.ticker || null, headline: (e.company || e.ticker || '') + ' reports ' + (e.quarter || '') + ' (' + (e.quality || '') + ')', body: (e.sector || ''), source: 'Earnings', price: null, changePct: pm, kind: 'earnings' });
  });
  return out;
}
function buildMovers(q: any, mk: 'IN' | 'US', catMap: Record<string, string>): FeedItem[] {
  const out: FeedItem[] = []; if (!q) return out;
  const upd = new Date(q.updatedAt || Date.now()).getTime();
  const push = (arr: any[], up: boolean) => { (arr || []).slice(0, 25).forEach((s: any, i: number) => { const cp = (typeof s.changePercent === 'number') ? s.changePercent : null; const k = (s.ticker || '').toUpperCase(); const cat = catMap[k]; const body = cat ? cat : (s.sector && s.sector !== 'Other' ? (s.sector + ' - no confirmed catalyst, liquidity / positioning move') : 'no confirmed catalyst - liquidity / positioning move'); out.push({ id: 'm' + mk + s.ticker, time: upd - i, market: mk, ticker: s.ticker, headline: (s.company || s.ticker), body, source: mk === 'IN' ? 'NSE' : 'US Mkt', price: (typeof s.price === 'number' ? s.price : null), changePct: cp, kind: 'mover' }); }); };
  push(q.gainers, true); push(q.losers, false); return out;
}

export default function InPlayPage() {
  const [market, setMarket] = useState<'IN' | 'US' | 'ALL'>('US');
  const [view, setView] = useState<'play' | 'head'>('play');
  const [cat, setCat] = useState<string>('ALL');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>('');
  const [asOf, setAsOf] = useState<string>('');
  const inFlight = useRef<boolean>(false);

  useEffect(() => { try { const m = localStorage.getItem('mc:inplay:market'); if (m) setMarket(m as any); const v = localStorage.getItem('mc:inplay:view'); if (v) setView(v as any); const c = localStorage.getItem('mc:inplay:cat'); if (c) setCat(c); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('mc:inplay:market', market); localStorage.setItem('mc:inplay:view', view); localStorage.setItem('mc:inplay:cat', cat); } catch {} }, [market, view, cat]);

  const load = useCallback(async (force: boolean) => {
    if (inFlight.current) return; inFlight.current = true; setErr('');
    const rp = force ? '&refresh=1' : '';
    try {
      // PATCH 1023 — fetch curated In-Play stream (structural alerts + ranked
      // events) and merge into the feed top. The page was rebuilding from raw
      // sources and ignoring the curated /api/v1/news/in-play output.
      const [news, earn, inplayCurated] = await Promise.all([
        getJSON('/api/v1/news?market=all'),
        getJSON('/api/market/earnings'),
        getJSON('/api/v1/news/in-play'),
      ]);
      const curatedItems: FeedItem[] = Array.isArray(inplayCurated)
        ? inplayCurated.map((c: any, i: number) => ({
            id: 'inplay-' + (c.id || i),
            time: new Date(c.published_at || Date.now()).getTime() + (Math.round((c.importance_score || 0) * 1000) * 60_000),
            market: mapRegion(c.region || 'GLOBAL'),
            ticker: c.primary_ticker || (Array.isArray(c.tickers) && c.tickers[0]) || null,
            headline: c.headline || c.title || '',
            body: c.summary || (c.bottleneck_sub_tag ? `Sub-tag: ${c.bottleneck_sub_tag}` : ''),
            source: c.source_name || c.source || 'In-Play',
            price: null,
            changePct: null,
            kind: 'news' as const,
          }))
        : [];
      const newsMap = buildNewsMap(news);
      const baseRaw = buildNews(news, earn);
      // PATCH 1023 — prepend curated In-Play items (structural + ranked events) to base
      const base = curatedItems.concat(baseRaw);
      const p1 = base.slice().sort((a, b) => b.time - a.time);
      setItems(p1.slice(0, 500)); setAsOf(nowStr()); setLoading(false);
      let __mk = 'US'; try { __mk = localStorage.getItem('mc:inplay:market') || 'US'; } catch {}
      const qIN = (__mk === 'IN' || __mk === 'ALL') ? await withTimeout(getJSON('/api/market/quotes?market=india' + rp), 38000) : null;
      const qUS = (__mk === 'US' || __mk === 'ALL') ? await withTimeout(getJSON('/api/market/quotes?market=us' + rp), 38000) : null;
      const px = buildPx(qIN, qUS);
      base.forEach((it) => { if (it.kind === 'news' || it.kind === 'macro') { const k = (it.ticker || '').toUpperCase(); const q = px[k]; if (q) { it.price = q.price; it.changePct = q.cp; if (it.market === 'GLOBAL') it.market = q.mk; } } });
      const mvA = buildMovers(qIN, 'IN', newsMap).concat(buildMovers(qUS, 'US', newsMap));
      const mergedA = mvA.concat(base); mergedA.sort((a, b) => b.time - a.time);
      setItems(mergedA.slice(0, 600)); setAsOf(nowStr());
      if (qIN) {
        const inCat: Record<string, string> = Object.assign({}, newsMap);
        const tickers = Array.from(new Set([].concat((qIN.gainers || []).slice(0, 18), (qIN.losers || []).slice(0, 18)).map((s: any) => s.ticker).filter(Boolean)));
        await withTimeout(Promise.all(tickers.map(async (t: any) => { const r = await getJSON('/api/v1/news-india/' + encodeURIComponent(t)); const art = r && r.articles && r.articles[0]; if (art && art.title) inCat[String(t).toUpperCase()] = art.title; })), 13000);
        const mvB = buildMovers(qIN, 'IN', inCat).concat(buildMovers(qUS, 'US', newsMap));
        const mergedB = mvB.concat(base); mergedB.sort((a, b) => b.time - a.time);
        setItems(mergedB.slice(0, 600)); setAsOf(nowStr());
      }
    } catch (e: any) { setErr('Could not load the feed - retrying on next refresh.'); }
    finally { setLoading(false); inFlight.current = false; }
  }, []);

  useEffect(() => { load(false); }, [load, market]);
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 60000); return () => clearInterval(id); }, [load]);

  const filtered = items.filter((it) => {
    if (market !== 'ALL') { if (market === 'IN' && !(it.market === 'IN' || it.market === 'GLOBAL')) return false; if (market === 'US' && !(it.market === 'US' || it.market === 'GLOBAL')) return false; }
    if (cat === 'STOCKS' && !it.ticker) return false;
    if (cat === 'MOVERS' && it.kind !== 'mover') return false;
    if (cat === 'EARNINGS' && it.kind !== 'earnings') return false;
    if (cat === 'NEWS' && !(it.kind === 'news' || it.kind === 'macro')) return false;
    return true;
  });

  const seg = (active: boolean) => ({ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (active ? COL.accent : COL.line), color: active ? '#06121a' : COL.mut, background: active ? COL.accent : 'transparent' } as any);
  const catChip = (id: string, label: string) => (<button key={id} onClick={() => setCat(id)} style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (cat === id ? COL.amber : COL.line), color: cat === id ? COL.amber : COL.mut, background: 'transparent' }}>{label}</button>);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '14px 16px', color: COL.txt }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.3px' }}>LIVE IN PLAY</div>
          <div style={{ fontSize: 11, color: COL.mut }}>Stock-by-stock catalyst stream - movers and news, each with price and move. India + US.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: COL.mut }}>{asOf ? ('as of ' + asOf) : ''}</span>
          <button onClick={() => load(true)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + COL.amber, color: COL.amber, background: 'transparent' }}>{loading ? '...' : 'Refresh'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMarket('US')} style={seg(market === 'US')}>USA</button>
        <button onClick={() => setMarket('IN')} style={seg(market === 'IN')}>India</button>
        <button onClick={() => setMarket('ALL')} style={seg(market === 'ALL')}>All</button>
        <span style={{ width: 12 }} />
        <button onClick={() => setView('play')} style={seg(view === 'play')}>In Play</button>
        <button onClick={() => setView('head')} style={seg(view === 'head')}>Headlines</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {catChip('ALL', 'All')}{catChip('STOCKS', 'Stocks only')}{catChip('MOVERS', 'Movers')}{catChip('NEWS', 'News')}{catChip('EARNINGS', 'Earnings')}
      </div>
      {err ? <div style={{ marginTop: 10, color: COL.amber, fontSize: 12 }}>{err}</div> : null}
      {loading && items.length === 0 ? <div style={{ marginTop: 16, color: COL.mut, fontSize: 12 }}>Loading live feed...</div> : null}
      <div style={{ marginTop: 12, borderTop: '1px solid ' + COL.line }}>
        {filtered.length === 0 && !loading ? <div style={{ padding: 24, textAlign: 'center', color: COL.mut }}>No items for this filter.</div> : null}
        {filtered.slice(0, 250).map((it) => {
          const cc = it.changePct == null ? COL.mut : (it.changePct >= 0 ? COL.grn : COL.red);
          const tagColor = it.changePct != null ? cc : (it.kind === 'earnings' ? COL.amber : it.kind === 'macro' ? '#a78bfa' : COL.accent);
          const pxlabel = (it.price != null || it.changePct != null) ? (' (' + (it.price != null ? priceStr(it.market === 'GLOBAL' ? 'US' : it.market, it.price) : '') + (it.changePct != null ? (' ' + pctStr(it.changePct)) : '') + ')') : '';
          return (
            <div key={it.id} style={{ display: 'flex', gap: 10, padding: view === 'head' ? '6px 4px' : '9px 4px', borderBottom: '1px solid ' + COL.line }}>
              <div style={{ width: 40, flexShrink: 0, fontSize: 11, color: COL.mut, paddingTop: 2 }}>{hhmm(it.time)}</div>
              <div style={{ width: 92, flexShrink: 0 }}>
                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: COL.chip, color: tagColor, fontSize: 11, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{it.ticker || it.kind.toUpperCase()}</span>
                <span style={{ display: 'block', fontSize: 9, color: COL.mut, marginTop: 2 }}>{it.market}{it.source ? (' - ' + it.source) : ''}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: COL.txt }}>{it.headline}{pxlabel ? <span style={{ color: cc, marginLeft: 4, fontWeight: 700 }}>{pxlabel}</span> : null}</div>
                {view === 'play' && it.body ? <div style={{ fontSize: 12, color: COL.mut, marginTop: 3, lineHeight: 1.45 }}>{it.body}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 10, color: COL.mut, textAlign: 'center', paddingBottom: 20 }}>Stock-by-stock catalyst stream from your own movers + news + earnings engines. Auto-refreshes every 60s.</div>
    </div>
  );
}
