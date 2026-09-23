// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE THREE-LEVEL VIEW.                 (zzz713, Phase 1)
//
// The spec's product principle, in its own words: optimise INFORMATION
// DENSITY PER MINUTE OF USER ATTENTION. Five hundred gainers are not five
// hundred summaries. So this page is built as a funnel you can see through,
// in three levels, and you are meant to stop at the first one that answers
// your question:
//
//   1. MARKET   — the funnel itself. I scanned N, these had a catalyst, these
//                 could matter economically, these deserve your attention.
//                 Ten seconds. Most mornings this is the whole visit.
//   2. SIGNALS  — every event that survived clustering, with its catalyst,
//                 its evidence tier and the quadrant it fell into.
//   3. QUEUE    — the few worth research, each with the SCORE BROKEN OPEN.
//
// WHY THE SCORE IS ALWAYS EXPANDABLE. A single opaque number is how a ranking
// stops being checkable, and an unchecked ranking is indistinguishable from a
// made-up one. Every row can show its components and its penalties, each with
// the reason in words. If the number looks wrong, you can see which axis is
// wrong rather than having to take it or leave it.
//
// WHAT THIS PAGE WILL NOT DO:
//   · It will not sort by percentage gain. A +20% move does not outrank a +5%
//     move — only the MISMATCH between fundamental surprise and price reaction
//     is ranked. The spec says this twice; the API enforces it; the UI offers
//     no control that would undo it.
//   · It will not show a buy signal. A quadrant is a description of a
//     mismatch, not a recommendation, and it is labelled that way on screen.
//   · It will not dress a tier-3 source as evidence. An unverified source is
//     shown as unverified, in the colour of a warning, and scores zero.
//
// HONEST ABOUT PHASE 1: the catalyst here is a FILED RESULT, found by crossing
// the gainers list against the earnings graders. No language model has read
// anything. The page says so at the bottom rather than implying a scan it did
// not do.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readJsonResponse, describeFetchError } from '@/lib/ai-gainers/client-fetch';

type Mkt = 'IN' | 'US';
type Level = 'scanned' | 'market' | 'signals' | 'queue' | 'research';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  // zzz766 — one step brighter than before: --mc-text-4 on the dark panel is
  // under 4:1 contrast and the owner reads this page for minutes at a time.
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-2)', faint: 'var(--mc-text-3)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#F59E0B',
  cyan: 'var(--mc-cyan)', violet: '#A78BFA',
};

interface Comp { key: string; label: string; points: number; max: number; because: string }
interface Row {
  ticker: string; company: string | null; market: Mkt;
  price_change_pct: number | null; volume_ratio: number | null;
  catalyst: string; information_status: string;
  materiality: string; structural_duration: string;
  evidence: Array<{ url: string; tier: 1 | 2 | 3; published?: string | null }>;
  claims: Array<{ text: string; sourceUrl: string; kind: string }>;
  research_priority: number;
  quadrant: 'high_information' | 'potentially_overlooked' | 'momentum_speculative' | 'early_unclear';
  components: Comp[]; penalties: Comp[];
}
interface Session { date: string; state: 'open' | 'pre_open' | 'closed' | 'weekend' | 'holiday'; isToday: boolean; label: string }
interface Payload {
  ok: boolean; market: Mkt; generated_at: string; served_from_cache?: boolean; session?: Session | null;
  funnel: { scanned: number; withCatalyst: number; structural: number; queue: number };
  gainers_scanned: number; graded_available: number;
  notes: string[]; queue: Row[];
  source_list?: {
    file: string | null; url?: string | null; synced_at: string | null; window: string | null;
    rows: number; total_reported?: number | null; pages_read?: number;
    error?: string | null; matched_to_a_filing: number;
    large_cap_min_cr?: number;
    excluded_large_caps?: Array<{ ticker: string; company: string | null; move_pct: number | null; market_cap: number | null }>;
    proxy_cache_age_ms?: number | null;
    // US only (zzz766)
    as_of?: { label: string; stale: boolean; intraday: boolean; synced_et: string; session: string } | null;
    sync_note?: string | null;
    excluded?: Array<{ ticker: string; exchange: string; reason: string; kind: string }>;
  };
  scanned?: Array<{ ticker: string; company: string | null; move_pct: number | null;
    volume_ratio: number | null; matched: boolean; volume?: number | null; price?: number | null; market_cap?: number | null }>;
}

// The quadrant is a DESCRIPTION OF A MISMATCH. Each label says what the
// mismatch is, and none of them says what to do about it.
const QUAD: Record<Row['quadrant'], { name: string; color: string; meaning: string }> = {
  high_information: {
    name: 'High information', color: C.green,
    meaning: 'Material news and a large move. The market has seen it — less of the move is left, but the fact is real.',
  },
  potentially_overlooked: {
    name: 'Possibly overlooked', color: C.cyan,
    meaning: 'Material news, muted price. The reaction may not yet reflect what was filed. This is where research pays.',
  },
  momentum_speculative: {
    name: 'Momentum / speculative', color: C.red,
    meaning: 'A large move with no material catalyst behind it. Most likely technical or sentiment. Scored low on purpose.',
  },
  early_unclear: {
    name: 'Early / unclear', color: C.faint,
    meaning: 'Neither the news nor the move is decisive yet. Not enough to act on, not enough to dismiss.',
  },
};

const TIER: Record<number, { label: string; color: string }> = {
  1: { label: 'Primary filing', color: C.green },
  2: { label: 'Reputable secondary', color: C.amber },
  3: { label: 'Unverified — alert only', color: C.red },
};

const pretty = (s: string) => String(s || '').replace(/_/g, ' ');

const pct = (v: number | null) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—');

const MKT_KEY = 'mc:ai-gainers:market';

export default function AiGainersPage() {
  const [market, setMarketState] = useState<Mkt>('US');
  // ?market=IN deep-links straight to India; otherwise the last choice.
  useEffect(() => {
    let m: string | null = null;
    try { m = new URLSearchParams(window.location.search).get('market'); } catch { m = null; }
    if (!m) { try { m = window.localStorage.getItem(MKT_KEY); } catch { m = null; } }
    if (m && m.toUpperCase() === 'IN') setMarketState('IN');
  }, []);
  const setMarket = useCallback((m: Mkt) => {
    setMarketState(m);
    try { window.localStorage.setItem(MKT_KEY, m); } catch { /* per-viewer convenience only */ }
  }, []);
  const [level, setLevel] = useState<Level>('market');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // ── THE CATALYST SWEEP.                                         (zzz741)
  // Runs on a click (zzz767 — it spends model reads): every name on the board is researched
  // in ~40s chunks and persisted server-side, so a reload resumes rather than
  // restarts. Coverage is a fraction and it is printed.
  const [research, setResearch] = useState<ResearchPayload | null>(null);
  const [sweeping, setSweeping] = useState(false);
  // Every load and every sweep carries a generation number. Switching market
  // bumps it, so a slow answer for the OLD market can never land on the new
  // one — and a sweep still finishing for the old market no longer blocks
  // the new market's sweep from starting. (zzz766)
  const genRef = useRef(0);
  const sweepGenRef = useRef(-1);

  const sweep = useCallback(async (m: Mkt, scanned: Payload['scanned'], gen: number) => {
    if (sweepGenRef.current === gen) return;          // this generation is already sweeping
    sweepGenRef.current = gen;
    setSweeping(true);
    try {
      const rows = (scanned || []).map((g) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, volume: g.volume ?? null, price: g.price ?? null, market_cap: g.market_cap ?? null, perf: (g as any).perf ?? null }));
      for (let i = 0; i < 40 && genRef.current === gen; i++) {
        let r: Response;
        try {
          r = await fetch('/api/v1/ai-gainers/research', {
            method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ market: m, rows: i === 0 ? rows : [], budget_ms: 40_000 }),
            signal: AbortSignal.timeout(75_000),
          });
        } catch (e) { throw new Error(describeFetchError(e, 'The research service')); }
        const res = await readJsonResponse<ResearchPayload & { researched_now?: number }>(r, 'The research service');
        if (!res.ok || !res.json) throw new Error(res.error || 'The research service did not answer.');
        if (genRef.current !== gen) return;
        setResearch(res.json);
        if (!res.json.remaining || res.json.researched_now === 0) break;
      }
    } catch (e: any) {
      if (genRef.current !== gen) return;
      const msg = String(e?.message || e);
      setResearch((cur) => cur ? { ...cur, error: msg } : { ok: false, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, error: msg });
    } finally {
      if (sweepGenRef.current === gen) sweepGenRef.current = -1;
      if (genRef.current === gen) setSweeping(false);
    }
  }, []);

  const load = useCallback(async (m: Mkt, fresh = false) => {
    const gen = ++genRef.current;
    setLoading(true); setErr(null);
    try {
      let r: Response;
      try {
        r = await fetch(`/api/v1/ai-gainers?market=${m}&limit=15${fresh ? '&fresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
      } catch (e) { throw new Error(describeFetchError(e, 'The gainers scan')); }
      const res = await readJsonResponse<Payload>(r, 'The gainers scan');
      if (!res.ok || !res.json) throw new Error(res.error || 'The gainers scan did not answer.');
      if (genRef.current !== gen) return;
      const j = res.json;
      setData(j);
      // What is already researched for this session shows immediately; the
      // sweep then fills the rest. A "Rescan" does not re-research.
      try {
        const rr = await fetch(`/api/v1/ai-gainers/research?market=${m}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        const rres = await readJsonResponse<ResearchPayload>(rr, 'The research service');
        if (rres.ok && rres.json && genRef.current === gen) setResearch(rres.json);
      } catch { /* the research button will answer */ }
      // The sweep spends model reads, so it runs only on a click — opening
      // the page is free. What was already researched today shows above. (zzz767)
    } catch (e: any) {
      if (genRef.current !== gen) return;
      setErr(String(e?.message || 'The gainers pipeline did not answer.'));
      setData(null);
    } finally { if (genRef.current === gen) setLoading(false); }
  }, [sweep]);

  // A market switch clears the previous market's board at once: showing US
  // rows under the India chip while India loads is a wrong answer, not a
  // loading state. (zzz766)
  useEffect(() => { setData(null); setResearch(null); setSweeping(false); load(market); }, [market, load]);

  // The queue is what the API already ranked. The Signals level shows the same
  // events unfiltered; nothing is re-sorted here, because a sort control in
  // the UI is exactly how "never rank by price" gets quietly undone.
  const rows = data?.queue || [];
  const structural = useMemo(
    () => rows.filter((r) => r.structural_duration === 'long' || r.structural_duration === 'medium'),
    [rows],
  );
  // The funnel says "N deserve your attention" and the button says "Show me
  // the N" — so the queue shows all N the API ranked, not a silent first 8
  // (limit is 15). (zzz766)
  const top = rows;

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>AI Daily Gainers</h1>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 780 }}>
          Not a list of what went up. A list of what <b style={{ color: C.text }}>happened</b>, ranked by whether it is
          worth your research time — never by the size of the move. A big move with nothing behind it scores lower than
          a small move with a filing behind it.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['US', 'IN'] as Mkt[]).map((m) => (
          <Chip key={m} on={market === m} onClick={() => setMarket(m)}>{m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}</Chip>
        ))}
        <span style={{ width: 10 }} />
        {(['scanned', 'market', 'signals', 'queue', 'research'] as Level[]).map((l) => (
          <Chip key={l} on={level === l} onClick={() => setLevel(l)} color={C.violet}>
            {l === 'scanned' ? '0 · Scanned'
              : l === 'market' ? '1 · Market'
                : l === 'signals' ? '2 · Signals'
                  : l === 'queue' ? '3 · Research queue'
                    : `4 · Catalyst research${research ? ` ${research.coverage.researched}/${research.coverage.total}` : ''}`}
          </Chip>
        ))}
        {sweeping && research && (
          <span style={{ fontSize: 12, color: C.cyan, fontWeight: 700 }}>
            Researching {research.coverage.researched}/{research.coverage.total}…
          </span>
        )}
        {data && !sweeping && (() => {
          const scannedN = (data.scanned || []).length;
          const total = research?.coverage.total || 0;
          const pending = total ? (research?.remaining ?? 0) : scannedN;
          if (!scannedN || (total && pending <= 0)) return null;
          return (
            <button onClick={() => sweep(market, data.scanned || [], genRef.current)}
              title="Reads the filings behind each move with the AI model. Runs only when you click."
              style={{ fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 999,
                border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer' }}>
              ▶ Research catalysts · {pending} {total ? 'remaining' : 'names'} (uses AI)
            </button>
          );
        })()}
        <button onClick={() => load(market, true)} disabled={loading}
          style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
            border: `1px solid ${C.border}`, background: C.bg, color: C.dim, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Scanning…' : '↻ Rescan'}
        </button>
      </div>

      {market === 'IN' && data?.session && <SessionBanner s={data.session} generatedAt={data.generated_at} cached={!!data.served_from_cache} />}

      {loading && !data && (
        <div style={{ fontSize: 13, color: C.dim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
          Scanning the {market === 'IN' ? 'India (screener.in)' : 'US'} gainers list and matching it to filings… this can take up to a minute on a cold start.
        </div>
      )}
      {err && (
        <div role="alert" style={{ fontSize: 13, color: C.text, lineHeight: 1.55, background: C.bg,
          border: `1px solid ${C.amber}`, borderRadius: 10, padding: '12px 14px' }}>
          <b style={{ color: C.amber }}>The gainers scan did not complete.</b> {err}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => load(market)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry</button>
          </div>
        </div>
      )}

      {data && level === 'scanned' && <ScannedLevel data={data} />}

      {level === 'research' && (
        <ResearchLevel research={research} sweeping={sweeping} market={market}
          onResume={() => data && sweep(market, data.scanned || [], genRef.current)} />
      )}

      {data && level === 'market' && (
        <MarketLevel data={data} structural={structural.length} research={research} onDrill={() => setLevel('queue')} />
      )}

      {data && level === 'queue' && (
        <ResearchLevel research={research} sweeping={sweeping} market={market} scoredOnly
          onResume={() => data && sweep(market, data.scanned || [], genRef.current)} />
      )}

      {data && level !== 'market' && level !== 'scanned' && level !== 'research' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {level === 'queue' && (
            <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>
              <b style={{ color: C.dim }}>Filed results behind today's gainers — context.</b> A result filed weeks ago explains a re-rating, not today's print; it is scored as confirmation and ranks below a dated catalyst.
            </div>
          )}
          {(level === 'queue' ? top : rows).length === 0 && (
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
              No confirmed catalyst. Nothing cleared the filter for this market in this session — that is a real answer,
              not an empty page: no gainer in the scan had a filed catalyst behind it.
            </div>
          )}
          {(level === 'queue' ? top : rows).map((r) => (
            <EventCard key={r.ticker} r={r} compact={level === 'signals'}
              open={!!open[r.ticker]} onToggle={() => setOpen((o) => ({ ...o, [r.ticker]: !o[r.ticker] }))} />
          ))}
        </div>
      )}

      {data && (
        <div style={{ marginTop: 6, paddingTop: 9, borderTop: `1px solid ${C.border}`,
          fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          {data.notes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}
    </div>
  );
}

/** LEVEL 0 — every row that was read, so "34 gainers scanned" can be checked
 *  rather than believed. The owner asked for this by name. (zzz721) */
// ── Catalyst research payload + view ─────────────────────────────── (zzz741)
interface Finding {
  ticker: string; company: string | null; movePct: number | null; marketCap: number | null; turnover: number | null;
  status: string; category: string | null; stage: string | null; headline: string | null; evidenceQuote: string | null;
  sourceUrl: string | null; sourceDate: string | null; ageDays: number | null; valueStated: number | null; valuePctMcap: number | null;
  net: number | null; components: { freshness: number; materiality: number; transmission: number; persistence: number; sourceMult: number; pricedIn: number } | null;
  verdict: string | null; returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null; history: number } | null;
  bandPrint: boolean; bandLevel: number | null; listingDays: number | null; routine: string[]; filingsInWindow: number; windowDays: number;
  holding: boolean; notes: string[]; modelRead: boolean; sources: string[];
}
interface ResearchPayload {
  ok: boolean; coverage: { researched: number; total: number; pct: number; byStatus: Record<string, number> };
  findings: Record<string, Finding>; remaining: number; model_reads?: number; errors?: string[]; error?: string; updated_at?: string;
  date?: string; session?: Session | null; excluded_large_caps?: string[]; large_cap_min_cr?: number | null;
}

const VERDICT: Record<string, { label: string; color: string }> = {
  // Labels describe the CATALYST against the price history — never an
  // instruction to buy or sell. (zzz766: the old ROOM label read as price advice.)
  FIRE: { label: '🔥 investigate', color: C.green }, ROOM: { label: '🟢 not yet priced in', color: C.green },
  PRICED: { label: '🟡 largely priced', color: C.amber }, WEAK: { label: '🟠 weak', color: C.amber },
  NONE: { label: '🔴 nothing exploitable', color: C.red }, THIN: { label: '⚪ thin (<1% of mcap)', color: C.faint },
};

function money(v: number | null | undefined, m: Mkt): string {
  if (v == null || !Number.isFinite(v)) return '—';
  // US: $M below a billion, $B above (zzz766 US) — "$2,083M" read as noise.
  if (m === 'US') { const a = Math.abs(v); return a >= 1000 ? `$${(v / 1000).toFixed(a >= 100_000 ? 0 : 1)}B` : `$${a >= 100 ? Math.round(v) : v.toFixed(1)}M`; }
  return `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)} Cr`;
}

const istTime = (iso: string | null | undefined) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST`;
};
/** A US timestamp in New York time, with IST beside it — a bare browser-local
 *  "23/09/2026, 05:52:58" named no zone. (zzz767) */
const etTime = (iso: string | null | undefined) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const et = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${et} ET · ${istTime(iso)}`;
};

/** Which session the India board describes, stated before anything else: a
 *  screen read after midnight or on a weekend is the LAST session's move. */
function SessionBanner({ s, generatedAt, cached }: { s: Session; generatedAt: string; cached: boolean }) {
  const col = s.isToday ? C.cyan : C.amber;
  return (
    <div style={{ fontSize: 13, color: C.text, background: C.bg, border: `1px solid ${col}`, borderLeft: `4px solid ${col}`,
      borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
      <b style={{ color: col }}>Session: {s.label}.</b>{' '}
      <span style={{ color: C.dim }}>
        {s.state === 'open' ? 'Moves are intraday and will change until 15:30 IST.' : !s.isToday ? 'These are not today\'s moves.' : 'Closing moves.'}
        {' '}Scan built {istTime(generatedAt)}{cached ? ' (cached — press Rescan for a fresh read)' : ''}.
      </span>
    </div>
  );
}

function ResearchLevel({ research, sweeping, market, onResume, scoredOnly }: { research: ResearchPayload | null; sweeping: boolean; market: Mkt; onResume: () => void; scoredOnly?: boolean }) {
  if (!research) return <div style={{ fontSize: 13, color: C.dim }}>{sweeping ? 'Researching…' : 'No catalyst research for this session yet. Click “▶ Research catalysts” above — it runs only when you click, because it uses AI reads.'}</div>;
  const all = Object.values(research.findings || {});
  const cov = research.coverage;
  const scored = all.filter((f) => f.status === 'catalyst').sort((a, b) => (b.net ?? -1) - (a.net ?? -1));
  const rejected = all.filter((f) => f.status === 'denied' || f.status === 'negative');
  const bands = all.filter((f) => f.bandPrint && f.status !== 'catalyst').sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const listings = all.filter((f) => f.status === 'listing_artifact');
  const unexplained = all.filter((f) => (f.status === 'none' || f.status === 'routine_only') && !f.bandPrint).sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const UNEXPLAINED_SHOWN = 80;
  const failed = all.filter((f) => f.status === 'source_failed');
  const holdings = all.filter((f) => f.holding);
  const th: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: C.faint, textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: C.dim, padding: '6px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };
  const turnoverLabel = market === 'IN' ? 'Avg value/day (1W)' : 'Traded';
  // The US move is the 1-WEEK export column; calling it "1d" was false. (zzz766)
  const mv = market === 'US' ? '1W' : '1d';
  const Wrap = ({ children }: { children: React.ReactNode }) => <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>{children}</table></div>;
  const Name = ({ f }: { f: Finding }) => (
    <span><TickerLink ticker={f.ticker} market={market} />{f.holding && <span title="In your book" style={{ marginLeft: 5, fontSize: 12, fontWeight: 800, color: C.cyan }}>📗</span>}
      {f.company && <div style={{ fontSize: 12, color: C.faint }}>{f.company}</div>}</span>
  );
  const Src = ({ f }: { f: Finding }) => f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" title={f.sourceUrl} style={{ color: C.cyan, textDecoration: 'none', fontSize: 12, whiteSpace: 'nowrap' }}>↗ filing · {f.sourceDate ? f.sourceDate.slice(0, 10) : 'undated'}</a> : <span style={{ color: C.faint }}>—</span>;
  const Section = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, padding: '10px 12px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: C.faint, marginTop: 2, marginBottom: 6, lineHeight: 1.5 }}>{sub}</div>}
      {children}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
        <b style={{ color: C.text }}>Catalyst coverage {cov.researched}/{cov.total} ({cov.pct}%)</b>
        {research.date && <span style={{ color: C.faint }}> · session {research.date}</span>}
        {' '}· {scored.length} carry a catalyst · {rejected.length} denied/negative · {bands.length} band prints · {listings.length} listing artifacts · {unexplained.length} with no confirmed catalyst
        {failed.length > 0 && <> · <span style={{ color: C.amber }}>{failed.length} source failed</span></>}
        {research.model_reads != null && <> · {research.model_reads} documents model-read</>}
        {sweeping ? <span style={{ color: C.cyan }}> · researching…</span>
          : research.remaining > 0 ? <button onClick={onResume} style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer' }}>Resume · {research.remaining} remaining</button> : null}
        {research.error && (
          <div role="alert" style={{ color: C.amber, marginTop: 4 }}>
            {research.error}{' '}
            {!sweeping && <button onClick={onResume} style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry research</button>}
          </div>
        )}
        {market === 'IN' && research.excluded_large_caps && research.excluded_large_caps.length > 0 && (
          <div style={{ fontSize: 12, color: C.faint }}>Excluded as large caps (≥ ₹{(research.large_cap_min_cr ?? 100000).toLocaleString('en-IN')} Cr): {research.excluded_large_caps.join(', ')}.</div>
        )}
        <div style={{ fontSize: 12, color: C.faint }}>
          Every name is swept against its exchange filings of the last 21 days and a year of price history; a name with nothing is an explicit <i>none</i>, never a silence.
          {market === 'IN' ? ' Source: the five most recent announcements per company on screener.in (in AGM season that can be eight days of paperwork) — the finding says how many filings were in the window.' : ' Source: SEC EDGAR submissions, classified by form and 8-K item. Offerings (424B, S-1/S-3, Item 3.02, Form D) are flagged as dilution, never as a catalyst; Item 2.02/10-Q are results; Item 1.01/7.01/8.01 are read before they are called anything. Forms 3/4/144 are excluded. Universe: US-listed small/mid caps ($50M–$10B); the move is the 1-week export column.'}
        </div>
      </div>

      {holdings.length > 0 && (
        <Section title="Your book on the board" sub="Position reviews, not ideas.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Finding</th><th style={th}>Source</th></tr></thead>
            <tbody>{holdings.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={td}>{f.headline || pretty(f.status)}{f.notes.length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.join(' ')}</div>}</td><td style={td}><Src f={f} /></td></tr>)}</tbody></Wrap>
        </Section>
      )}

      <Section title={`Scored — ${scored.length} name${scored.length === 1 ? '' : 's'} carry a catalyst`}
        sub="NET = (0.30 freshness + 0.30 materiality + 0.25 transmission + 0.15 persistence) × source × (1 − priced-in). Materiality is value ÷ market cap where a value is stated; an item under 1% of market cap cannot rank above THIN. A stock that is down has not priced its catalyst.">
        {scored.length === 0 ? <div style={{ fontSize: 13, color: C.dim }}>No confirmed catalyst: nothing on the board carries a dated, sourced catalyst{cov.researched < cov.total ? ' yet' : ''}. An empty top of the table is a valid result.</div> : (
          <Wrap><thead><tr><th style={th}>#</th><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Catalyst (dated, sourced)</th><th style={th}>Stage</th><th style={th}>Size</th><th style={th}>Fresh</th><th style={th}>Trans</th><th style={th}>Priced</th><th style={th}>NET</th><th style={th}>Verdict</th></tr></thead>
            <tbody>{scored.map((f, i) => {
              const v = VERDICT[f.verdict || 'NONE'];
              return (<tr key={f.ticker}>
                <td style={td}>{i + 1}</td><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td>
                <td style={{ ...td, minWidth: 260 }}>
                  <span style={{ color: C.text }}>{f.headline}</span>
                  <div style={{ fontSize: 12, color: C.faint }}>{pretty(String(f.category || ''))} · <Src f={f} />{f.modelRead ? ' · quote verified' : ' · summary only'}</div>
                  {f.evidenceQuote && <div style={{ fontSize: 12, color: C.dim, fontStyle: 'italic', marginTop: 2 }}>“{f.evidenceQuote.slice(0, 220)}{f.evidenceQuote.length > 220 ? '…' : ''}”</div>}
                  {f.notes.length > 0 && <div style={{ fontSize: 12, color: C.amber, marginTop: 2 }}>{f.notes.join(' ')}</div>}
                </td>
                <td style={td}>{f.stage || '—'}</td>
                <td style={td}>{f.valueStated != null ? <>{money(f.valueStated, market)}{f.valuePctMcap != null && <div style={{ fontSize: 12, color: C.faint }}>{f.valuePctMcap.toFixed(1)}% of mcap</div>}</> : <span style={{ color: C.faint }}>no value stated</span>}</td>
                <td style={td}>{f.components?.freshness ?? '—'}</td><td style={td}>{f.components?.transmission ?? '—'}</td>
                <td style={td}>{f.components?.pricedIn ?? '—'}{f.returns && <div style={{ fontSize: 12, color: C.faint }}>{pct(f.returns.m1)} 1M · {pct(f.returns.m3)} 3M</div>}</td>
                <td style={{ ...td, fontWeight: 800, color: C.text }}>{typeof f.net === 'number' ? f.net.toFixed(1) : '—'}</td>
                <td style={{ ...td, color: v.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{v.label}</td>
              </tr>);
            })}</tbody></Wrap>
        )}
      </Section>

      {!scoredOnly && (rejected.length > 0 || bands.length > 0 || listings.length > 0) && (
        <Section title="Denied, negative, or moving on nothing" sub="Rejected catalysts are findings, not omissions. A company formally denying a catalyst while the stock moves is more actionable than most confirmed ones.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Finding</th><th style={th}>Source</th></tr></thead>
            <tbody>
              {rejected.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={{ ...td, minWidth: 300 }}><b style={{ color: f.status === 'denied' ? C.amber : C.red }}>{f.status.toUpperCase()}.</b> <span style={{ color: C.text }}>{f.headline}</span>{f.notes.length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.join(' ')}</div>}</td><td style={td}><Src f={f} /></td></tr>)}
              {bands.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={{ ...td, minWidth: 300 }}><b style={{ color: C.amber }}>BAND PRINT {f.bandLevel}%.</b> {f.turnover != null ? `${money(f.turnover, market)} ${market === 'IN' ? 'avg/day (1W)' : 'traded'} · ` : ''}{f.marketCap != null ? `mcap ${money(f.marketCap, market)} · ` : ''}{f.headline}<div style={{ fontSize: 12, color: C.faint }}>{f.notes.filter((n) => !/band print/i.test(n)).join(' ')}</div></td><td style={td}><Src f={f} /></td></tr>)}
              {listings.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={{ ...td, minWidth: 300 }}><b style={{ color: C.faint }}>LISTING ARTIFACT.</b> {f.headline}</td><td style={td}><Src f={f} /></td></tr>)}
            </tbody></Wrap>
        </Section>
      )}

      {!scoredOnly && unexplained.length > 0 && (
        <Section title={`No confirmed catalyst — ${unexplained.length} move${unexplained.length === 1 ? '' : 's'}`} sub="Name, move, and what the filings actually show for the window. Nothing here is a catalyst; an unclassified filing is worth opening yourself.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Mcap</th><th style={th}>{turnoverLabel}</th><th style={th}>Filings in window</th><th style={th}>1M / 3M</th></tr></thead>
            <tbody>{unexplained.slice(0, UNEXPLAINED_SHOWN).map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={td}>{money(f.marketCap, market)}</td><td style={td}>{money(f.turnover, market)}</td><td style={{ ...td, minWidth: 260 }}>{f.filingsInWindow === 0 ? <span>{f.headline || `no filing in ${f.windowDays} days`}</span> : <span>{f.headline}</span>}{f.sourceUrl && <> · <Src f={f} /></>}{f.notes.length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.join(' ')}</div>}</td><td style={td}>{f.returns ? `${pct(f.returns.m1)} / ${pct(f.returns.m3)}` : '—'}</td></tr>)}</tbody></Wrap>
          {unexplained.length > UNEXPLAINED_SHOWN && <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>+{unexplained.length - UNEXPLAINED_SHOWN} more not shown (smallest moves).</div>}
        </Section>
      )}

      {!scoredOnly && failed.length > 0 && (
        <Section title={`Source failed — ${failed.length}`} sub="The filing source could not be reached for these. That is not 'nothing filed'.">
          <div style={{ fontSize: 13, color: C.dim }}>{failed.map((f) => f.ticker).join(' · ')}</div>
        </Section>
      )}
      {!scoredOnly && research.errors && research.errors.length > 0 && (
        <div style={{ fontSize: 12, color: C.faint }}>Last errors: {research.errors.join(' | ')}</div>
      )}
    </div>
  );
}

/** A ticker that opens its screener.in page (India) — the one place the
 *  owner checks a name by hand. BSE-code tickers resolve there too. */
function TickerLink({ ticker, market }: { ticker: string; market: Mkt }) {
  if (market !== 'IN') return <b style={{ color: C.text }}>{ticker}</b>;
  return (
    <a href={`https://www.screener.in/company/${encodeURIComponent(ticker)}/`} target="_blank" rel="noopener noreferrer"
      title={`Open ${ticker} on screener.in`} style={{ color: C.text, fontWeight: 800, textDecoration: 'none' }}>{ticker}</a>
  );
}

function ScannedLevel({ data }: { data: Payload }) {
  const sl = data.source_list;
  const rows = data.scanned || [];
  const isIN = data.market === 'IN';
  const excluded = sl?.excluded_large_caps || [];
  if (!sl || !rows.length) {
    return (
      <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, background: C.bg,
        border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
        <b style={{ color: C.amber }}>No gainers list was read for this market.</b>{' '}
        {sl?.error || (isIN
          ? (excluded.length ? 'Every name on the screen was a large cap, and this brief is small and mid caps only.' : 'The screener.in screen returned nothing.')
          : 'The TradingView export could not be read.')}
        {' '}This is a failure to read the list, not a day with no gainers — nothing on the other tabs has been
        checked against a gainers list.
      </div>
    );
  }
  // India shows what the screen actually carries (market cap and price);
  // "REL VOL" is a US column and read "—" on every Indian row.
  const cols = isIN ? '96px minmax(120px,1fr) 78px 96px 84px 108px' : '84px 1fr 78px 70px 108px';
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>
          {sl.rows} rows read from{' '}
          {sl.url
            ? <a href={sl.url} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>{sl.file}</a>
            : <code style={{ color: C.cyan }}>{sl.file}</code>}
          {sl.total_reported && sl.total_reported !== sl.rows
            ? <span style={{ color: C.faint, fontWeight: 400 }}> (of {sl.total_reported} reported{excluded.length ? `, ${excluded.length} large cap${excluded.length === 1 ? '' : 's'} excluded` : ''})</span> : null}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>
          Read {isIN ? istTime(sl.synced_at) : etTime(sl.synced_at)}
          {sl.window ? <> · window: <b style={{ color: C.text }}>{sl.window}</b></> : null}
          {' · '}{sl.matched_to_a_filing} of {sl.rows} matched to a filed result.
        </div>
        {sl.error && (
          <div style={{ fontSize: 12, color: C.amber, marginTop: 4 }}>⚠ {sl.error}</div>
        )}
        {isIN && excluded.length > 0 && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
            Excluded as large caps (≥ ₹{(sl.large_cap_min_cr ?? 100000).toLocaleString('en-IN')} Cr — small/mid caps only):{' '}
            {excluded.map((x) => `${x.ticker} ${pct(x.move_pct)} (${money(x.market_cap, 'IN')})`).join(' · ')}
          </div>
        )}
        {data.market === 'US' && (sl.as_of || sl.sync_note) && (
          <div style={{ fontSize: 12, color: sl.as_of?.stale || sl.sync_note ? C.amber : C.dim, marginTop: 4, lineHeight: 1.5 }}>
            {sl.as_of ? <>{sl.as_of.stale ? '⚠ ' : ''}{sl.as_of.label} <span style={{ color: C.faint }}>(synced {sl.as_of.synced_et})</span></> : <>⚠ {sl.sync_note}</>}
          </div>
        )}
        {data.market === 'US' && sl.excluded && sl.excluded.length > 0 && (
          <details style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>
            <summary style={{ cursor: 'pointer' }}>{sl.excluded.length} export row{sl.excluded.length === 1 ? '' : 's'} excluded — not US-listed small/mid-cap gainers</summary>
            <div style={{ marginTop: 3, lineHeight: 1.6 }}>{sl.excluded.map((e) => <div key={`${e.ticker}:${e.exchange}:${e.kind}`}><b style={{ color: C.dim }}>{e.ticker}</b> <span>({e.exchange || '—'})</span> — {e.reason}</div>)}</div>
          </details>
        )}
        {data.market === 'US' && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
            &ldquo;Daily&rdquo; in this tab&rsquo;s name is the cadence of the review, not the window of the move: the
            US screen is a <b>weekly</b> performance export. India reads a genuine 1-day-return screen, live.
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: isIN ? 600 : 480 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols,
            gap: 8, padding: '6px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: C.faint }}>
            <span>TICKER</span><span>COMPANY</span>
            <span style={{ textAlign: 'right' }}>{isIN ? '1D MOVE' : '1W MOVE'}</span>
            {isIN
              ? <><span style={{ textAlign: 'right' }}>MCAP</span><span style={{ textAlign: 'right' }}>PRICE</span></>
              : <span style={{ textAlign: 'right' }}>REL VOL</span>}
            <span>FILED RESULT?</span>
          </div>
          {rows.map((r) => (
            <div key={r.ticker} style={{ display: 'grid', gridTemplateColumns: cols,
              gap: 8, padding: '5px 14px', fontSize: 13, alignItems: 'baseline',
              borderBottom: `1px solid ${C.border}` }}>
              <TickerLink ticker={r.ticker} market={data.market} />
              <span style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.company}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 700,
                color: (r.move_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.move_pct)}</span>
              {isIN
                ? <>
                  <span style={{ textAlign: 'right', color: C.dim }}>{money(r.market_cap ?? null, 'IN')}</span>
                  <span style={{ textAlign: 'right', color: C.dim }}>{typeof r.price === 'number' ? `₹${r.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</span>
                </>
                : <span style={{ textAlign: 'right', color: C.faint }}>
                  {typeof r.volume_ratio === 'number' ? `×${r.volume_ratio.toFixed(1)}` : '—'}
                </span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: r.matched ? C.green : C.faint }}>
                {r.matched ? '✓ filed result' : 'no filed result'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const c = color || C.cyan;
  return (
    <button onClick={onClick} style={{
      fontSize: 12, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? c : C.border}`,
      background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : C.bg,
      color: on ? c : C.dim,
    }}>{children}</button>
  );
}

/** LEVEL 1 — the funnel, stated as counts rather than asserted as a number. */
function MarketLevel({ data, structural, onDrill, research }: { data: Payload; structural: number; onDrill: () => void; research: ResearchPayload | null }) {
  const f = data.funnel;
  // The funnel counted catalysts in FILED RESULTS only, while the queue it
  // drills into lists the catalyst sweep — "Show me the 1" opened 8. Both are
  // printed now, each named for what it counted. (zzz767)
  const swept = research && research.coverage.total > 0 ? research : null;
  const sweptScored = swept ? Object.values(swept.findings || {}).filter((x: any) => x.status === 'catalyst').length : null;
  const steps = [
    { n: data.gainers_scanned || f.scanned, l: 'gainers scanned', w: data.market === 'IN' ? 'your screener.in screen, small and mid caps only' : 'the committed screen for this market' },
    { n: data.graded_available, l: 'filed results available', w: 'results the graders have already read' },
    { n: f.withCatalyst, l: 'had a catalyst in a filed result', w: 'a results filing behind the move, after clustering duplicates' },
    { n: sweptScored ?? '—', l: 'carry a catalyst in recent filings', w: swept ? `catalyst research read ${swept.coverage.researched}/${swept.coverage.total} names' recent filings` : 'not researched yet — use “▶ Research catalysts” (runs only on click)' },
    { n: structural, l: 'could matter beyond a quarter', w: 'the effect is medium- or long-lived, not one print' },
    { n: f.queue, l: 'deserve your attention', w: 'ranked by research priority, never by percentage gain' },
  ];
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 10 }}>
        THE FUNNEL · {data.market === 'IN' ? istTime(data.generated_at) : etTime(data.generated_at)}
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0',
          borderTop: i ? `1px solid ${C.border}` : 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: i === steps.length - 1 ? C.cyan : C.text,
            minWidth: 52, textAlign: 'right' }}>{s.n}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text, minWidth: 210 }}>{s.l}</span>
          <span style={{ fontSize: 12, color: C.dim }}>{s.w}</span>
        </div>
      ))}
      <button onClick={onDrill} style={{
        marginTop: 12, fontSize: 12, fontWeight: 700, padding: '5px 13px', borderRadius: 999,
        border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer',
      }}>{sweptScored != null ? `Show me the ${sweptScored} with a catalyst →` : `Show me the ${f.queue} →`}</button>
    </div>
  );
}

function EventCard({ r, compact, open, onToggle }: { r: Row; compact: boolean; open: boolean; onToggle: () => void }) {
  const q = QUAD[r.quadrant] || QUAD.early_unclear;
  const best = r.evidence.length ? Math.min(...r.evidence.map((e) => e.tier)) : 3;
  const t = TIER[best] || TIER[3];
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '11px 14px', borderLeft: `3px solid ${q.color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{r.ticker}</span>
        {r.company && <span style={{ fontSize: 12, color: C.dim, maxWidth: 260, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>}
        <span style={{ fontSize: 13, fontWeight: 800,
          color: (r.price_change_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.price_change_pct)}</span>
        {typeof r.volume_ratio === 'number' && (
          <span style={{ fontSize: 12, color: C.faint }}>vol ×{r.volume_ratio.toFixed(1)}</span>
        )}
        <Tag color={q.color} title={q.meaning}>{q.name}</Tag>
        <Tag color={t.color} title={
          best === 3 ? 'An unverified source can raise an alert. It can never, alone, produce a research score.'
            : 'Evidence tier is a property of where the source came from, not of how confident the text sounds.'
        }>{t.label}</Tag>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: q.color }}>{r.research_priority}</span>
          <button onClick={onToggle} style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
            border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer' }}>
            {open ? 'Hide the maths' : 'Why this score'}
          </button>
        </span>
      </div>

      <div style={{ marginTop: 6, fontSize: 13, color: C.dim, lineHeight: 1.55 }}>
        <b style={{ color: C.text }}>{pretty(r.catalyst)}</b>
        {' · '}{pretty(r.information_status)}
        {' · '}{r.materiality} materiality
        {' · '}{r.structural_duration}-lived
      </div>

      {!compact && r.claims.filter((c) => c.text).map((c, i) => (
        <div key={i} style={{ marginTop: 7, fontSize: 13, color: C.text, lineHeight: 1.55,
          paddingLeft: 9, borderLeft: `2px solid ${C.border}` }}>
          {c.text}
          <span style={{ fontSize: 12, color: C.faint, marginLeft: 6 }}>
            {c.kind === 'fact' ? 'stated in the filing' : 'inferred — not stated'}
          </span>
        </div>
      ))}

      {!compact && r.evidence.length > 0 && (
        <div style={{ marginTop: 7, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {r.evidence.map((e, i) => (
            <a key={i} href={e.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: (TIER[e.tier] || TIER[3]).color, textDecoration: 'none' }}>
              ↗ source {i + 1} · tier {e.tier}{e.published ? ` · ${String(e.published).slice(0, 10)}` : ''}
            </a>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 5 }}>
            HOW THE {r.research_priority} WAS BUILT
          </div>
          {[...r.components, ...r.penalties].map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
              <span style={{ fontSize: 12, fontWeight: 800, minWidth: 54, textAlign: 'right',
                color: c.points < 0 ? C.red : c.points === 0 ? C.faint : C.text }}>
                {c.points >= 0 ? '+' : ''}{c.points}<span style={{ color: C.faint, fontWeight: 600 }}>/{Math.abs(c.max)}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text, minWidth: 168 }}>{c.label}</span>
              <span style={{ fontSize: 12, color: C.dim }}>{c.because}</span>
            </div>
          ))}
          <div style={{ marginTop: 7, fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
            {q.meaning} A quadrant describes a mismatch between news and price. It is not a recommendation, and nothing
            on this page is.
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ color, title, children }: { color: string; title?: string; children: React.ReactNode }) {
  return (
    // Appending a hex alpha to the colour produced "var(--mc-bullish)18" — invalid CSS, so every tag
    // built on a theme variable rendered with no fill. (zzz766)
    <span title={title} style={{
      fontSize: 12, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
      border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 12%, transparent)`, color,
    }}>{children}</span>
  );
}
