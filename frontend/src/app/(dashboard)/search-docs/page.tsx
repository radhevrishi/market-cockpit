// zzz1051 — Document search: one box over every stored call transcript, investor presentation and results release
// (India + US). Reads /api/v1/search. Light page on purpose (prints well). No named exports (Next.js page rule).
'use client';

import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react';

interface Hit {
  id: number; docId: string; market: string; ticker: string | null; company: string | null; kind: string | null; title: string | null; url: string | null;
  filedAt: string | null; quarter: string | null; speaker: string | null; page: number | null; section: string | null; level: string | null;
  snippet: string; text: string; matched: 'keyword' | 'meaning' | 'both'; keywordRank: number | null; meaningRank: number | null; score: number; rerankScore?: number;
}
interface SearchRes {
  ok: boolean; q: string; mode: string; modeWhy: string; stems: string[]; results: Hit[];
  counts: { keyword: number; keywordLoose: number; meaning: number }; notes: string[]; rerank?: { used: boolean; usd: number; why?: string }; error?: string;
}
interface Cov {
  ok: boolean; why?: string; mode: string; modeWhy: string; storeDocs: number; indexedDocs: number; docsWithPassages: number;
  byLevel: Record<string, number>; byMarket: Record<string, number>; passages: number; embedded: number; newest: string | null; oldest: string | null;
  spend: { embedToday: number; embedCap: number; rerankToday: number; rerankCap: number }; lastRun: any;
}

const C = {
  bg: '#ffffff', panel: '#f8fafc', line: '#e2e8f0', text: '#0f172a', soft: '#475569', faint: '#94a3b8',
  blue: '#1d4ed8', green: '#047857', amber: '#b45309', purple: '#6d28d9', mark: '#fef08a',
};
const KIND_LABEL: Record<string, string> = {
  TRANSCRIPT: 'Call transcript', PRESENTATION: 'Investor presentation', RESULTS_RELEASE: 'Results release', AGM_SPEECH: 'AGM / chairman speech', OTHER_COMPANY_DOC: 'Other company document',
};
const LEVEL_LABEL: Record<string, string> = { full: 'whole document', passages: 'guidance excerpts only', quotes: 'guidance quotes only' };
const EXAMPLES = ['who guided margin expansion this quarter', 'capacity utilisation above 80%', 'order book growth defence', 'raised full year guidance', 'data centre demand for transformers'];
const PRESETS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '100', label: 'Latest results season (100 days)', days: 100 },
  { id: '200', label: 'Last two seasons (200 days)', days: 200 },
  { id: '365', label: 'Last year', days: 365 },
  { id: 'all', label: 'All dates', days: null },
];

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.map((x: any) => String(typeof x === 'string' ? x : x?.symbol || x?.ticker || '').toUpperCase().replace(/^(NSE|BSE):/, '').trim()).filter(Boolean);
  } catch { return []; }
}
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const money = (x: number) => `$${(x || 0).toFixed(x < 0.1 ? 4 : 2)}`;

function Highlight({ text, stems }: { text: string; stems: string[] }) {
  if (!stems.length) return <>{text}</>;
  const re = new RegExp(`(\\b(?:${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\w%-]*)`, 'gi');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <mark key={i} style={{ background: C.mark, color: C.text, padding: '0 1px', borderRadius: 2 }}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

function Chip({ children, color, title }: { children: ReactNode; color: string; title?: string }) {
  return <span title={title} style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}55`, background: `${color}10`, borderRadius: 999, padding: '1px 8px', marginRight: 6 }}>{children}</span>;
}

const MATCH_INFO: Record<Hit['matched'], { label: string; color: string; title: string }> = {
  both: { label: 'words + meaning', color: C.green, title: 'Found both by its exact words and by meaning' },
  keyword: { label: 'exact words', color: C.blue, title: 'Contains the words you searched for' },
  meaning: { label: 'similar meaning', color: C.purple, title: 'Says something close to your question in other words' },
};

export default function DocumentSearchPage() {
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<'' | 'IN' | 'US'>('');
  const [preset, setPreset] = useState('100');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [tickersText, setTickersText] = useState('');
  const [scope, setScope] = useState<'all' | 'watchlist' | 'holdings'>('all');
  const [rerank, setRerank] = useState(false);
  const [res, setRes] = useState<SearchRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cov, setCov] = useState<Cov | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetch('/api/v1/search?coverage=1', { cache: 'no-store' }).then((r) => r.json()).then(setCov).catch(() => setCov(null));
  }, [res]);

  const scopeTickers = useMemo(() => {
    if (typeof window === 'undefined' || scope === 'all') return [] as string[];
    return scope === 'watchlist' ? readList('mc_watchlist_tickers') : readList('mc_portfolio_holdings');
  }, [scope]);

  const run = async (query = q) => {
    const text = query.trim();
    if (text.length < 2) return;
    setLoading(true); setErr(null); setOpen({});
    const sp = new URLSearchParams({ q: text, limit: '50' });
    if (market) sp.set('market', market);
    const p = PRESETS.find((x) => x.id === preset);
    if (preset === 'custom') { if (from) sp.set('from', from); if (to) sp.set('to', to); }
    else if (p?.days) sp.set('from', isoDaysAgo(p.days));
    if (kinds.length) sp.set('kinds', kinds.join(','));
    const typed = tickersText.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const tick = Array.from(new Set([...typed, ...scopeTickers]));
    if (scope !== 'all' && !scopeTickers.length) { setErr(`Your ${scope === 'watchlist' ? 'watchlist' : 'holdings list'} is empty on this device.`); setLoading(false); return; }
    if (tick.length) sp.set('tickers', tick.slice(0, 500).join(','));
    if (rerank) sp.set('rerank', '1');
    try {
      const r = await fetch(`/api/v1/search?${sp.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok && !j?.results) throw new Error(j?.error || j?.modeWhy || `HTTP ${r.status}`);
      setRes(j);
    } catch (e: any) { setErr(String(e?.message || e)); setRes(null); }
    setLoading(false);
  };

  // group passages by company, in the order of each company's best passage
  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of res?.results || []) {
      const k = `${h.market}:${h.ticker || h.company || h.docId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(h);
    }
    return Array.from(m.values());
  }, [res]);

  const box: CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 };
  const label: CSSProperties = { fontSize: 12, color: C.soft, fontWeight: 600, display: 'block', marginBottom: 4 };
  const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, color: C.text, background: C.bg };

  return (
    <div style={{ background: C.panel, color: C.text, minHeight: '100%', padding: '18px 16px 40px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Document search</h1>
        <p style={{ margin: '0 0 14px', color: C.soft, fontSize: 14 }}>
          Ask a question in plain words. It searches every call transcript, investor presentation and results release the app has collected,
          for India and the US, and shows the passages that answer it — with the company, the document, the date and a link to the original.
        </p>

        <div style={{ ...box, marginBottom: 12 }}>
          <form onSubmit={(e) => { e.preventDefault(); run(); }} style={{ display: 'flex', gap: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. who guided margin expansion this quarter" style={{ ...input, fontSize: 15, padding: '10px 12px' }} aria-label="Search question" />
            <button type="submit" disabled={loading || q.trim().length < 2} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '0 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => { setQ(x); run(x); }} style={{ fontSize: 12, color: C.blue, background: '#eff6ff', border: `1px solid #bfdbfe`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>{x}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 14 }}>
            <div>
              <span style={label}>Market</span>
              <select value={market} onChange={(e) => setMarket(e.target.value as any)} style={input}>
                <option value="">India and US</option><option value="IN">India</option><option value="US">US</option>
              </select>
            </div>
            <div>
              <span style={label}>Dates</span>
              <select value={preset} onChange={(e) => setPreset(e.target.value)} style={input}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">Choose dates…</option>
              </select>
              {preset === 'custom' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} aria-label="From" />
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} aria-label="To" />
                </div>
              )}
            </div>
            <div>
              <span style={label}>Companies</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as any)} style={input}>
                <option value="all">All companies</option><option value="watchlist">My watchlist only</option><option value="holdings">My holdings only</option>
              </select>
              <input value={tickersText} onChange={(e) => setTickersText(e.target.value)} placeholder="or type tickers: KAYNES, AXON" style={{ ...input, marginTop: 6 }} aria-label="Tickers" />
            </div>
            <div>
              <span style={label}>Document type</span>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <label key={k} style={{ display: 'block', fontSize: 13, color: C.text }}>
                  <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((s) => (e.target.checked ? [...s, k] : s.filter((x) => x !== k)))} /> {l}
                </label>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, color: C.soft }}>
            <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} />
            Let AI re-order the top 30 passages by how directly they answer (small cost, daily limit {cov ? money(cov.spend.rerankCap) : '…'})
          </label>
        </div>

        {cov && (
          <div style={{ ...box, marginBottom: 12, fontSize: 12.5, color: C.soft, lineHeight: 1.6 }}>
            {cov.ok ? (
              <>
                <b style={{ color: C.text }}>What is searched:</b> {cov.docsWithPassages.toLocaleString()} documents indexed
                {cov.storeDocs ? <> (the collectors hold {cov.storeDocs.toLocaleString()} right now)</> : null}
                {' · '}{cov.passages.toLocaleString()} passages
                {cov.newest ? <> · {cov.oldest} to {cov.newest}</> : null}
                {Object.keys(cov.byMarket).length ? <> · {Object.entries(cov.byMarket).map(([m, n]) => `${m === 'IN' ? 'India' : 'US'} ${n.toLocaleString()}`).join(', ')}</> : null}
                <br />
                <b style={{ color: C.text }}>How much of each document:</b>{' '}
                {['full', 'passages', 'quotes'].filter((l) => cov.byLevel[l]).map((l) => `${(cov.byLevel[l] || 0).toLocaleString()} ${LEVEL_LABEL[l]}`).join(' · ') || 'nothing yet'}
                <br />
                <b style={{ color: C.text }}>Meaning search:</b>{' '}
                {cov.mode === 'off' ? <span style={{ color: C.amber }}>off — {cov.modeWhy}</span>
                  : <>{cov.mode === 'pgvector' ? 'on (database index)' : 'on (scored in the app)'} · {cov.embedded.toLocaleString()} of {cov.passages.toLocaleString()} passages ready</>}
                {' · '}AI spend today: indexing {money(cov.spend.embedToday)} of {money(cov.spend.embedCap)}, re-ordering {money(cov.spend.rerankToday)} of {money(cov.spend.rerankCap)}
              </>
            ) : <span style={{ color: C.amber }}>The search index is not available: {cov.why || cov.modeWhy}</span>}
          </div>
        )}

        {err && <div style={{ ...box, borderColor: '#fecaca', color: '#b91c1c', marginBottom: 12 }}>{err}</div>}

        {res && (
          <div style={{ fontSize: 13, color: C.soft, margin: '4px 2px 10px' }}>
            {res.results.length ? <>{res.results.length} passages from {groups.length} companies.</> : <>No passages found.</>}
            {' '}Exact-word matches: {res.counts.keyword}{res.counts.keywordLoose ? ` (+${res.counts.keywordLoose} with only some of the words)` : ''}; similar-meaning matches: {res.counts.meaning}.
            {res.rerank?.used ? ` Re-ordered by AI (${money(res.rerank.usd)}).` : ''}
            {res.notes.map((n, i) => <div key={i} style={{ color: C.amber }}>{n}</div>)}
          </div>
        )}

        {groups.map((g) => {
          const h0 = g[0];
          return (
            <div key={`${h0.market}:${h0.ticker || h0.docId}`} style={{ ...box, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{h0.company || h0.ticker}</span>
                {h0.ticker && <span style={{ fontSize: 13, color: C.soft, fontFamily: 'ui-monospace, monospace' }}>{h0.ticker}</span>}
                <Chip color={C.soft}>{h0.market === 'IN' ? 'India' : 'US'}</Chip>
                <span style={{ fontSize: 12, color: C.faint }}>{g.length} passage{g.length > 1 ? 's' : ''}</span>
              </div>
              {g.map((h) => {
                const mi = MATCH_INFO[h.matched];
                const isOpen = !!open[h.id];
                return (
                  <div key={h.id} style={{ borderTop: `1px solid ${C.line}`, padding: '9px 0' }}>
                    <div style={{ fontSize: 12, color: C.soft, marginBottom: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <b style={{ color: C.text }}>{KIND_LABEL[h.kind || ''] || 'Document'}</b>
                      {h.filedAt && <span>· filed {h.filedAt}</span>}
                      {h.quarter && <span>· {h.quarter}</span>}
                      {h.speaker && <span>· {h.speaker}</span>}
                      {h.page != null && <span>· page {h.page}</span>}
                      {h.section && <span title={h.section}>· {h.section.length > 40 ? h.section.slice(0, 40) + '…' : h.section}</span>}
                      <span style={{ marginLeft: 6 }}><Chip color={mi.color} title={mi.title}>{mi.label}</Chip></span>
                      {h.rerankScore != null && <Chip color={h.rerankScore >= 2 ? C.green : C.faint} title="AI score: 3 = answers it directly, 0 = not about it">AI {h.rerankScore}/3</Chip>}
                      {h.level && h.level !== 'full' && <Chip color={C.amber} title="Only part of this document is in the index">{LEVEL_LABEL[h.level] || h.level}</Chip>}
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: C.text }}>
                      <Highlight text={isOpen ? h.text : h.snippet} stems={res?.stems || []} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 12.5, display: 'flex', gap: 14 }}>
                      {h.text.length > h.snippet.length && (
                        <button onClick={() => setOpen((o) => ({ ...o, [h.id]: !isOpen }))} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', padding: 0, fontSize: 12.5 }}>
                          {isOpen ? 'Show less' : 'Show the whole passage'}
                        </button>
                      )}
                      {h.url && <a href={h.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>Open the original document ↗</a>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        <p style={{ fontSize: 12, color: C.faint, marginTop: 18 }}>
          How it works: each document is cut into passages of about 300–500 words (a speaker’s answer stays together). A passage is found by its exact words,
          by meaning (an AI “fingerprint” of the passage, so “margins will expand” matches “margin improvement”), or both; the two lists are merged.
          Passages are the companies’ own words — check the original before acting on them.
        </p>
      </div>
    </div>
  );
}
