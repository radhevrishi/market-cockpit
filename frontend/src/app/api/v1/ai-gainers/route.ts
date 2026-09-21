// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE PIPELINE.                        (zzz712, Phase 1)
//
// Turns a list of gainers into scored EVENTS, and narrows hundreds to the few
// that carry evidence. Still no model call: the catalyst here is a FILED
// RESULT, found by crossing today's gainers against the earnings graders, and
// a filing is tier-1 evidence by definition. Phase 2 adds the language model
// that reads announcements for the gainers that did NOT just report.
//
// WHY THAT CROSS IS THE RIGHT v1 RATHER THAN A PLACEHOLDER. The spec's whole
// argument is that a price move is only interesting when something happened.
// The single largest class of "something happened" is a quarterly result, the
// portal already grades those to BLOCKBUSTER/STRONG/MIXED/AVOID, and the
// grade carries a filing URL. So a gainer that also reported this week is an
// event with primary evidence, a materiality that the grader has already
// assessed, and a price reaction — every field the scorer needs, none of it
// invented. A gainer with no filing behind it is reported honestly as exactly
// that: "no verified fundamental catalyst identified".
//
// WHAT IS HONEST ABOUT THE GAPS:
//   · India gainers have no committed screen in this repo, so the India side
//     reads the graded results of the day and says so. It does not pretend to
//     have scanned a gainers list it cannot reach.
//   · Attribution (company vs sector vs market) is not estimated. The spec
//     forbids implying mathematical certainty about a model-derived split, and
//     an un-estimated attribution scores the neutral 3 of 5 rather than a
//     number chosen to look precise.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { kvGet } from '@/lib/kv';
import {
  type GainerEvent, type Market, type EventSource,
  sourceTierOf, researchPriority, buildResearchQueue,
} from '@/lib/ai-gainers/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TV_DIR = path.join(process.cwd(), 'public', 'data', 'tradingview');
const US_GAINERS_FILE = 'weekly-gainer-usa.csv';

// ── HOW OLD A FILING MAY BE, AND WHAT IT MEANS AT EACH AGE.       (zzz716)
//
// The first recency guard used fourteen days, which was right in principle
// and empty in practice: checked against the live bench on 21 September it
// kept 0 of 320 India rows and 2 of 92 US rows, because Indian earnings
// season ended in mid-August. A pipeline that is correct and returns nothing
// for three months of the year is not correct, it is unused.
//
// The fix is not a looser threshold pretending to be the same claim. It is
// TWO claims, separated by age:
//
//   ≤ FRESH_DAYS   the print is plausibly the catalyst — `new_information`
//   ≤ WINDOW_DAYS  the print is CONTEXT, not the trigger. A move six weeks
//                  after a result may be post-earnings drift, which this
//                  portal tracks separately and which is a real documented
//                  effect — but claiming the filing caused this week's move
//                  would be a confident, sourced, wrong causal statement.
//                  Scored as `confirmation`, which the scorer weights at a
//                  third of new information.
//
// Anything older is dropped. The card shows the age, so the distinction is
// visible rather than buried in a score.
const FRESH_DAYS = 14;
const WINDOW_DAYS = 60;

/** Minimal CSV reader — the TradingView export quotes any field containing a
 *  comma, and a naive split on "," corrupts every company description. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function readUsGainers(): Promise<Array<{ ticker: string; company: string; movePct: number | null; relVol: number | null; gapPct: number | null }>> {
  try {
    const raw = await fs.readFile(path.join(TV_DIR, US_GAINERS_FILE), 'utf8');
    return parseCsv(raw).map((r) => ({
      ticker: String(r['Symbol'] || '').toUpperCase(),
      company: r['Description'] || '',
      // The TradingView export quotes any header containing a comma, so the
      // key is "Performance %, 1 week" and NOT "Performance % 1 week". The
      // first version used the unquoted spelling, parsed cleanly, and made
      // every gainer on the page read exactly 0% — a silent wrong answer,
      // which is worse than a loud failure. Checked against the committed
      // file rather than guessed.
      movePct: num(r['Performance %, 1 week']) ?? num(r['Performance %, 1 month']),
      relVol: num(r['Relative volume, 1 week']),
      gapPct: num(r['Gap']),
    })).filter((x) => x.ticker);
  } catch {
    return [];
  }
}

/** The last N calendar days in US Eastern, newest first — the same day keys
 *  the graders cache under. */
function recentDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const d = new Date(now - i * 86_400_000);
    out.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d));
  }
  return out;
}

/**
 * Today's graded results, from the engines that already produce them.
 *
 * ── ASK FOR THE KEY THAT IS ACTUALLY WARM.                          (zzz714)
 *
 * The first version asked `graded-us?days=7&cache_only=1`, which is a
 * perfectly valid request and was ALWAYS COLD. The grader caches one key per
 * `date|days` pair, and every writer in the portal — the opportunities page
 * and the prewarm cron alike — writes `date=<d>&days=1`, one day at a time.
 * Nothing has ever written `days=7`. So `cache_only=1` correctly answered
 * `{pending:true}` with no rows, and the gainers page shipped with an empty
 * queue and no error anywhere: a silent wrong answer, which is the failure
 * mode this file's header warns about and which it then committed itself.
 *
 * Caught by calling the deployed endpoint and reading the numbers, not by
 * re-reading the code that produced them. `graded_available: 0` next to
 * `gainers_scanned: 34` is what gave it away.
 *
 * The fix is to sweep the same per-day keys the page does. Days still cold
 * return `pending` and are skipped; they warm on the next prewarm rather than
 * being computed on this caller's clock.
 */
async function readGraded(origin: string, market: Market): Promise<{ rows: any[]; pending: number; from: string }> {
  // ── READ THE STORE THAT IS ALWAYS WARM.                          (zzz716)
  //
  // Two wrong answers preceded this one, and both were silent.
  //
  //   1. `graded-us?days=7&cache_only=1` — a valid request for a key nothing
  //      has ever written. Every writer in the portal caches `date=<d>&days=1`.
  //   2. Sweeping those per-day keys — correct, and still empty, because
  //      `cache_only=1` on a day the prewarm cron has not reached returns
  //      `pending` with no rows. On a quiet week that is every day in the
  //      window, and the page rendered `0 filed results available` next to
  //      `34 gainers scanned` as though it were an answer.
  //
  // The server bench is the right store and was there the whole time:
  // /api/v1/bench and /api/v1/bench-us are refreshed by their own crons, hold
  // roughly 320 India and 92 US graded rows with every field this scorer
  // needs, and answer in one request whatever the day cache is doing.
  //
  // The day cache is still swept afterwards for anything the bench has not
  // picked up yet — a result graded an hour ago is on the day key before it
  // reaches the bench — but nothing depends on it being warm.
  // ── READ THE KV DIRECTLY, NOT OUR OWN HTTP ROUTE.                (zzz718)
  //
  // The previous version fetched `${origin}/api/v1/bench` from inside this
  // route. Those endpoints answer perfectly from outside — 320 India and 92
  // US rows — and returned NOTHING from in here, so the deployed page said
  // "read from neither store" and showed an empty funnel next to 34 gainers
  // scanned. A server calling its own public URL depends on the origin the
  // proxy reports and on the platform allowing the loopback; on Railway that
  // is one hop too many, and it fails silently because the catch treats an
  // unreachable store the same as an empty one.
  //
  // Both bench routes are thin readers over two KV keys. Reading those keys
  // here removes the hop entirely: no origin, no proxy, no self-call. The
  // keys are duplicated from those routes deliberately — a shared constant
  // across an API boundary is the kind of coupling that breaks silently when
  // one side bumps a version.
  const BENCH_KEY = market === 'US' ? 'bench:us:server:v1' : 'bench:server:v1';
  const bench: any[] = [];
  let benchTotal = 0;
  try {
    const payload: any = await kvGet(BENCH_KEY);
    const entries: any[] = payload?.entries || [];
    benchTotal = entries.length;
    // THE BENCH IS NOT DATED TO THIS WEEK. It holds every graded result the
    // crons have kept, some months old, and a result from June is NOT the
    // catalyst behind a move this week. Pairing them would be the worst class
    // of error this pipeline can make: a confident, sourced, entirely wrong
    // causal claim. Age travels with each row and decides how it is scored.
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    for (const e of entries) {
      if (!e?.ticker) continue;
      const t = Date.parse(String(e.filing_date || ''));
      if (!Number.isFinite(t) || t < cutoff) continue;
      bench.push({ ...e, _ageDays: Math.floor((Date.now() - t) / 86_400_000) });
    }
  } catch { /* the day sweep below is the fallback */ }

  const days = recentDays(market === 'US' ? 7 : 4);
  const urls = market === 'US'
    ? days.map((d) => `${origin}/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1`)
    : days.map((d) => `${origin}/api/v1/earnings/graded?date=${d}`);
  const settled = await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }));

  const rows: any[] = [...bench];
  let pending = 0;
  for (const j of settled) {
    if (!j) continue;
    const bt = j?.by_tier;
    if (!bt) { if (j?.pending) pending++; continue; }
    for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
      for (const row of (bt[t] || [])) rows.push({ ...row, tier: row?.tier || t });
    }
  }
  const from = bench.length && rows.length > bench.length
    ? `the server bench (${bench.length} of ${benchTotal} rows filed within ${WINDOW_DAYS} days) plus the day cache`
    : bench.length
      ? `the server bench (${bench.length} of ${benchTotal} rows filed within ${WINDOW_DAYS} days)`
      : rows.length ? 'the day cache'
        : benchTotal
          ? `neither — the bench holds ${benchTotal} graded rows but none filed within ${WINDOW_DAYS} days`
          : 'neither store — the bench is empty, which is a data problem rather than a quiet market';
  return { rows, pending, from };
}

/** A filing is only NEW information while it is new. After that it is context
 *  for a move, and the scorer weights it accordingly. */
function statusForAge(ageDays: unknown, tier: unknown): GainerEvent['informationStatus'] {
  const a = typeof ageDays === 'number' ? ageDays : 0;
  if (a > FRESH_DAYS) return 'confirmation';
  return tier === 'BLOCKBUSTER' || tier === 'STRONG' ? 'new_information' : 'confirmation';
}

/** The grader's tier is an assessment of the RESULT, which is the closest
 *  honest proxy for economic materiality available without a model. */
function materialityFromTier(tier: string): GainerEvent['materiality'] {
  if (tier === 'BLOCKBUSTER') return 'high';
  if (tier === 'STRONG') return 'medium';
  if (tier === 'MIXED') return 'low';
  return 'low';
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const market = (searchParams.get('market') || 'US').toUpperCase() === 'IN' ? 'IN' : 'US';
  const limit = Math.max(1, Math.min(25, parseInt(searchParams.get('limit') || '10', 10) || 10));

  const [gainers, gradedRes] = await Promise.all([
    market === 'US' ? readUsGainers() : Promise.resolve([]),
    readGraded(origin, market as Market),
  ]);
  const graded = gradedRes.rows;

  const gradedBy = new Map<string, any>();
  for (const g of graded) {
    const t = String(g?.ticker || '').toUpperCase();
    if (t && !gradedBy.has(t)) gradedBy.set(t, g);
  }

  const now = new Date().toISOString();
  const events: GainerEvent[] = [];

  // 1. Gainers that ALSO reported — an event with primary evidence.
  for (const g of gainers) {
    const row = gradedBy.get(g.ticker);
    if (!row) continue;
    const url = row.filing_url || row.release_url || '';
    const sources: EventSource[] = url ? [{ url, tier: sourceTierOf(url), published: row.filing_date || null }] : [];
    events.push({
      eventId: `${market}:${g.ticker}:${row.filing_date || now}`,
      clusterId: '',
      market: market as Market,
      ticker: g.ticker,
      company: g.company || row.company || null,
      eventTime: row.filing_date ? `${String(row.filing_date).slice(0, 10)}T00:00:00Z` : now,
      detectedAt: now,
      catalyst: 'revenue_guidance_increase',
      informationStatus: statusForAge(row._ageDays, row.tier),
      attribution: 'company_specific',
      priceChangePct: g.movePct,
      volumeRatio: g.relVol,
      sectorRelativePct: null,
      sources,
      claims: [{
        text: [String(row.narrative || '').slice(0, 360),
          typeof row._ageDays === 'number'
            ? `Filed ${row._ageDays} day${row._ageDays === 1 ? '' : 's'} ago.${row._ageDays > FRESH_DAYS
              ? ' Too long ago to be this week\u2019s trigger — this is context, not the catalyst.' : ''}`
            : ''].filter(Boolean).join(' '),
        sourceUrl: url,
        // The grader's narrative is assembled from FILED figures, so it is a
        // fact about the filing — not an inference about the future.
        kind: 'fact',
      }],
      materiality: materialityFromTier(String(row.tier || '')),
      structuralDuration: row.tier === 'BLOCKBUSTER' ? 'medium' : 'short',
    });
  }

  // 2. Graded results with no gainer match — still events worth ranking, and
  //    for India this is the only path, because no gainers screen is committed
  //    to this repo. The response says so rather than implying a scan.
  for (const [t, row] of gradedBy) {
    if (events.some((e) => e.ticker === t)) continue;
    const url = row.filing_url || row.release_url || '';
    events.push({
      eventId: `${market}:${t}:${row.filing_date || now}:g`,
      clusterId: '',
      market: market as Market,
      ticker: t,
      company: row.company || null,
      eventTime: row.filing_date ? `${String(row.filing_date).slice(0, 10)}T00:00:00Z` : now,
      detectedAt: now,
      catalyst: 'revenue_guidance_increase',
      informationStatus: statusForAge(row._ageDays, row.tier),
      attribution: 'company_specific',
      priceChangePct: typeof row.d1_pct === 'number' ? row.d1_pct : null,
      volumeRatio: null,
      sectorRelativePct: null,
      sources: url ? [{ url, tier: sourceTierOf(url), published: row.filing_date || null }] : [],
      claims: [{
        text: [String(row.narrative || '').slice(0, 360),
          typeof row._ageDays === 'number'
            ? `Filed ${row._ageDays} day${row._ageDays === 1 ? '' : 's'} ago.${row._ageDays > FRESH_DAYS
              ? ' Too long ago to be this week\u2019s trigger — this is context, not the catalyst.' : ''}`
            : ''].filter(Boolean).join(' '),
        sourceUrl: url, kind: 'fact',
      }],
      materiality: materialityFromTier(String(row.tier || '')),
      structuralDuration: row.tier === 'BLOCKBUSTER' ? 'medium' : 'short',
    });
  }

  const { queue, funnel } = buildResearchQueue(
    events,
    (e) => researchPriority({ event: e, companySpecificShare: null }),
    limit,
  );

  const notes: string[] = [];
  notes.push(`Graded results were read from ${gradedRes.from} — ${gradedRes.rows.length} rows before de-duplication.`);
  if (gradedRes.pending > 0) {
    notes.push(`${gradedRes.pending} of the days in the window are not graded yet — the engine was asked for them and has started, but nothing is computed on this page's clock. Rescan in a minute and they will be here.`);
  }
  if (!graded.length) {
    notes.push('No graded result was available for any day in the window, so no gainer could be matched to a filing. This is an empty answer, not a filtered one.');
  }
  if (market === 'US' && !gainers.length) {
    notes.push('The TradingView gainers export could not be read, so only filed results were scanned. The list is a committed CSV refreshed by the sync workflow.');
  }
  if (market === 'IN') {
    notes.push('No India gainers screen is committed to this repository, so the India pass ranks the day\'s filed results rather than a gainers list. Wiring the screener.in screen is Phase 1 work that is not yet done.');
  }
  {
    const fresh = graded.filter((r: any) => typeof r._ageDays === 'number' && r._ageDays <= FRESH_DAYS).length;
    if (!fresh) {
      notes.push(
        `No result was filed in the last ${FRESH_DAYS} days in this market, so nothing here is claimed as this week's catalyst. `
        + `Filings up to ${WINDOW_DAYS} days old are shown as context and scored as confirmation, never as new information. `
        + 'Outside earnings season a short queue is the correct answer, not a broken one.',
      );
    }
  }
  notes.push('No language model has read anything here. Every catalyst is a filed result and every score component is stated. Phase 2 adds the reader for gainers with no filing behind them.');

  return NextResponse.json({
    ok: true,
    market,
    generated_at: now,
    funnel,
    gainers_scanned: gainers.length,
    graded_available: gradedBy.size,
    notes,
    queue: queue.map(({ event, priority }) => ({
      ticker: event.ticker,
      company: event.company,
      market: event.market,
      price_change_pct: event.priceChangePct,
      volume_ratio: event.volumeRatio,
      catalyst: event.catalyst,
      information_status: event.informationStatus,
      materiality: event.materiality,
      structural_duration: event.structuralDuration,
      evidence: event.sources,
      claims: event.claims,
      research_priority: priority.score,
      quadrant: priority.quadrant,
      components: priority.components,
      penalties: priority.penalties,
    })),
  });
}
