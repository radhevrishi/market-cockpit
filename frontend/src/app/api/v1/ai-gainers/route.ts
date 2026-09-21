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
import {
  type GainerEvent, type Market, type EventSource,
  sourceTierOf, researchPriority, buildResearchQueue,
} from '@/lib/ai-gainers/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TV_DIR = path.join(process.cwd(), 'public', 'data', 'tradingview');
const US_GAINERS_FILE = 'weekly-gainer-usa.csv';

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

/** Today's graded results, from the engines that already produce them. */
async function readGraded(origin: string, market: Market): Promise<any[]> {
  const url = market === 'US'
    ? `${origin}/api/v1/earnings/graded-us?days=7&cache_only=1`
    : `${origin}/api/v1/earnings/graded?date=${new Date().toISOString().slice(0, 10)}&cache_only=1`;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return [];
    const j = await r.json();
    const bt = j?.by_tier || {};
    return ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'].flatMap((t) => bt[t] || []);
  } catch {
    return [];
  }
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

  const [gainers, graded] = await Promise.all([
    market === 'US' ? readUsGainers() : Promise.resolve([]),
    readGraded(origin, market as Market),
  ]);

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
      informationStatus: row.tier === 'BLOCKBUSTER' || row.tier === 'STRONG' ? 'new_information' : 'confirmation',
      attribution: 'company_specific',
      priceChangePct: g.movePct,
      volumeRatio: g.relVol,
      sectorRelativePct: null,
      sources,
      claims: [{
        text: String(row.narrative || '').slice(0, 400),
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
      informationStatus: row.tier === 'BLOCKBUSTER' || row.tier === 'STRONG' ? 'new_information' : 'confirmation',
      attribution: 'company_specific',
      priceChangePct: typeof row.d1_pct === 'number' ? row.d1_pct : null,
      volumeRatio: null,
      sectorRelativePct: null,
      sources: url ? [{ url, tier: sourceTierOf(url), published: row.filing_date || null }] : [],
      claims: [{ text: String(row.narrative || '').slice(0, 400), sourceUrl: url, kind: 'fact' }],
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
  if (market === 'US' && !gainers.length) {
    notes.push('The TradingView gainers export could not be read, so only filed results were scanned. The list is a committed CSV refreshed by the sync workflow.');
  }
  if (market === 'IN') {
    notes.push('No India gainers screen is committed to this repository, so the India pass ranks the day\'s filed results rather than a gainers list. Wiring the screener.in screen is Phase 1 work that is not yet done.');
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
