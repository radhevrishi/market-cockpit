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

import { useCallback, useEffect, useMemo, useState } from 'react';

type Mkt = 'IN' | 'US';
type Level = 'scanned' | 'market' | 'signals' | 'queue';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
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
interface Payload {
  ok: boolean; market: Mkt; generated_at: string;
  funnel: { scanned: number; withCatalyst: number; structural: number; queue: number };
  gainers_scanned: number; graded_available: number;
  notes: string[]; queue: Row[];
  source_list?: {
    file: string | null; url?: string | null; synced_at: string | null; window: string | null;
    rows: number; total_reported?: number | null; pages_read?: number;
    error?: string | null; matched_to_a_filing: number;
  };
  scanned?: Array<{ ticker: string; company: string | null; move_pct: number | null;
    volume_ratio: number | null; matched: boolean }>;
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

export default function AiGainersPage() {
  const [market, setMarket] = useState<Mkt>('US');
  const [level, setLevel] = useState<Level>('market');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async (m: Mkt) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/ai-gainers?market=${m}&limit=15`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      setErr(e?.message || 'The gainers pipeline did not answer.');
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(market); }, [market, load]);

  // The queue is what the API already ranked. The Signals level shows the same
  // events unfiltered; nothing is re-sorted here, because a sort control in
  // the UI is exactly how "never rank by price" gets quietly undone.
  const rows = data?.queue || [];
  const structural = useMemo(
    () => rows.filter((r) => r.structural_duration === 'long' || r.structural_duration === 'medium'),
    [rows],
  );
  const top = useMemo(() => rows.slice(0, 8), [rows]);

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>AI Daily Gainers</h1>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 780 }}>
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
        {(['scanned', 'market', 'signals', 'queue'] as Level[]).map((l) => (
          <Chip key={l} on={level === l} onClick={() => setLevel(l)} color={C.violet}>
            {l === 'scanned' ? '0 · Scanned'
              : l === 'market' ? '1 · Market'
                : l === 'signals' ? '2 · Signals' : '3 · Research queue'}
          </Chip>
        ))}
        <button onClick={() => load(market)}
          style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
            border: `1px solid ${C.border}`, background: C.bg, color: C.dim, cursor: 'pointer' }}>
          ↻ Rescan
        </button>
      </div>

      {loading && <div style={{ fontSize: 12, color: C.dim }}>Scanning…</div>}
      {err && <div style={{ fontSize: 12, color: C.amber }}>{err}</div>}

      {data && level === 'scanned' && <ScannedLevel data={data} />}

      {data && level === 'market' && (
        <MarketLevel data={data} structural={structural.length} onDrill={() => setLevel('queue')} />
      )}

      {data && level !== 'market' && level !== 'scanned' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(level === 'queue' ? top : rows).length === 0 && (
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
              Nothing cleared the filter for this market today. That is a real answer, not an empty page — no gainer in
              the scan had a filed catalyst behind it.
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
          fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>
          {data.notes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}
    </div>
  );
}

/** LEVEL 0 — every row that was read, so "34 gainers scanned" can be checked
 *  rather than believed. The owner asked for this by name. (zzz721) */
function ScannedLevel({ data }: { data: Payload }) {
  const sl = data.source_list;
  const rows = data.scanned || [];
  if (!sl || !rows.length) {
    return (
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, background: C.bg,
        border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
        <b style={{ color: C.amber }}>No gainers list was read for this market.</b>{' '}
        {sl?.error || (data.market === 'IN'
          ? 'The screener.in screen returned nothing.'
          : 'The TradingView export could not be read.')}
        {' '}This is a failure to read the list, not a day with no gainers — nothing on the other tabs has been
        checked against a gainers list.
      </div>
    );
  }
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11.5, color: C.text, fontWeight: 700 }}>
          {sl.rows} rows read from{' '}
          {sl.url
            ? <a href={sl.url} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>{sl.file}</a>
            : <code style={{ color: C.cyan }}>{sl.file}</code>}
          {sl.total_reported && sl.total_reported !== sl.rows
            ? <span style={{ color: C.faint, fontWeight: 400 }}> (of {sl.total_reported} reported)</span> : null}
        </div>
        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>
          Read {sl.synced_at ? new Date(sl.synced_at).toLocaleString() : 'unknown'}
          {sl.window ? <> · window: <b style={{ color: C.text }}>{sl.window}</b></> : null}
          {' · '}{sl.matched_to_a_filing} of {sl.rows} matched to a filed result.
        </div>
        {sl.error && (
          <div style={{ fontSize: 10.5, color: C.amber, marginTop: 4 }}>⚠ {sl.error}</div>
        )}
        {data.market === 'US' && (
          <div style={{ fontSize: 10, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
            &ldquo;Daily&rdquo; in this tab&rsquo;s name is the cadence of the review, not the window of the move: the
            US screen is a <b>weekly</b> performance export. India reads a genuine 1-day-return screen, live.
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr 78px 70px 92px',
        gap: 8, padding: '6px 14px', borderBottom: `1px solid ${C.border}`,
        fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>
        <span>TICKER</span><span>COMPANY</span>
        <span style={{ textAlign: 'right' }}>{data.market === 'IN' ? '1D MOVE' : '1W MOVE'}</span>
        <span style={{ textAlign: 'right' }}>REL VOL</span><span>FILING?</span>
      </div>
      {rows.map((r) => (
        <div key={r.ticker} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 78px 70px 92px',
          gap: 8, padding: '4px 14px', fontSize: 11, alignItems: 'baseline',
          borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 800, color: C.text }}>{r.ticker}</span>
          <span style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.company}
          </span>
          <span style={{ textAlign: 'right', fontWeight: 700,
            color: (r.move_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.move_pct)}</span>
          <span style={{ textAlign: 'right', color: C.faint }}>
            {typeof r.volume_ratio === 'number' ? `×${r.volume_ratio.toFixed(1)}` : '—'}
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: r.matched ? C.green : C.faint }}>
            {r.matched ? '✓ filed result' : 'no filing'}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const c = color || C.cyan;
  return (
    <button onClick={onClick} style={{
      fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? c : C.border}`,
      background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : C.bg,
      color: on ? c : C.dim,
    }}>{children}</button>
  );
}

/** LEVEL 1 — the funnel, stated as counts rather than asserted as a number. */
function MarketLevel({ data, structural, onDrill }: { data: Payload; structural: number; onDrill: () => void }) {
  const f = data.funnel;
  const steps = [
    { n: data.gainers_scanned || f.scanned, l: 'gainers scanned', w: 'the committed screen for this market' },
    { n: data.graded_available, l: 'filed results available', w: 'results the graders have already read' },
    { n: f.withCatalyst, l: 'had a catalyst', w: 'a filing behind the move, after clustering duplicates' },
    { n: structural, l: 'could matter beyond a quarter', w: 'the effect is medium- or long-lived, not one print' },
    { n: f.queue, l: 'deserve your attention', w: 'ranked by research priority, never by percentage gain' },
  ];
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.faint, marginBottom: 10 }}>
        THE FUNNEL · {new Date(data.generated_at).toLocaleString()}
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0',
          borderTop: i ? `1px solid ${C.border}` : 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: i === steps.length - 1 ? C.cyan : C.text,
            minWidth: 52, textAlign: 'right' }}>{s.n}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, minWidth: 210 }}>{s.l}</span>
          <span style={{ fontSize: 11, color: C.dim }}>{s.w}</span>
        </div>
      ))}
      <button onClick={onDrill} style={{
        marginTop: 12, fontSize: 11.5, fontWeight: 700, padding: '5px 13px', borderRadius: 999,
        border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer',
      }}>Show me the {f.queue} →</button>
    </div>
  );
}

function EventCard({ r, compact, open, onToggle }: { r: Row; compact: boolean; open: boolean; onToggle: () => void }) {
  const q = QUAD[r.quadrant] || QUAD.early_unclear;
  const best = r.evidence.length ? Math.min(...r.evidence.map((e) => e.tier)) : 3;
  const t = TIER[best];
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '11px 14px', borderLeft: `3px solid ${q.color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{r.ticker}</span>
        {r.company && <span style={{ fontSize: 11, color: C.dim, maxWidth: 260, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>}
        <span style={{ fontSize: 11.5, fontWeight: 800,
          color: (r.price_change_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.price_change_pct)}</span>
        {typeof r.volume_ratio === 'number' && (
          <span style={{ fontSize: 10, color: C.faint }}>vol ×{r.volume_ratio.toFixed(1)}</span>
        )}
        <Tag color={q.color} title={q.meaning}>{q.name}</Tag>
        <Tag color={t.color} title={
          best === 3 ? 'An unverified source can raise an alert. It can never, alone, produce a research score.'
            : 'Evidence tier is a property of where the source came from, not of how confident the text sounds.'
        }>{t.label}</Tag>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: q.color }}>{r.research_priority}</span>
          <button onClick={onToggle} style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
            border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer' }}>
            {open ? 'Hide the maths' : 'Why this score'}
          </button>
        </span>
      </div>

      <div style={{ marginTop: 6, fontSize: 11.5, color: C.dim, lineHeight: 1.55 }}>
        <b style={{ color: C.text }}>{pretty(r.catalyst)}</b>
        {' · '}{pretty(r.information_status)}
        {' · '}{r.materiality} materiality
        {' · '}{r.structural_duration}-lived
      </div>

      {!compact && r.claims.filter((c) => c.text).map((c, i) => (
        <div key={i} style={{ marginTop: 7, fontSize: 11.5, color: C.text, lineHeight: 1.55,
          paddingLeft: 9, borderLeft: `2px solid ${C.border}` }}>
          {c.text}
          <span style={{ fontSize: 9.5, color: C.faint, marginLeft: 6 }}>
            {c.kind === 'fact' ? 'stated in the filing' : 'inferred — not stated'}
          </span>
        </div>
      ))}

      {!compact && r.evidence.length > 0 && (
        <div style={{ marginTop: 7, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {r.evidence.map((e, i) => (
            <a key={i} href={e.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 10.5, color: TIER[e.tier].color, textDecoration: 'none' }}>
              ↗ source {i + 1} · tier {e.tier}{e.published ? ` · ${String(e.published).slice(0, 10)}` : ''}
            </a>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 5 }}>
            HOW THE {r.research_priority} WAS BUILT
          </div>
          {[...r.components, ...r.penalties].map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
              <span style={{ fontSize: 11, fontWeight: 800, minWidth: 54, textAlign: 'right',
                color: c.points < 0 ? C.red : c.points === 0 ? C.faint : C.text }}>
                {c.points >= 0 ? '+' : ''}{c.points}<span style={{ color: C.faint, fontWeight: 600 }}>/{Math.abs(c.max)}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, minWidth: 168 }}>{c.label}</span>
              <span style={{ fontSize: 10.5, color: C.dim }}>{c.because}</span>
            </div>
          ))}
          <div style={{ marginTop: 7, fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
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
    <span title={title} style={{
      fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
      border: `1px solid ${color}`, background: `${color}18`, color,
    }}>{children}</span>
  );
}
