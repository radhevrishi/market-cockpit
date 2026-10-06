// zzz883 — writes the engines' output into the Postgres record of truth, so a signal can be explained months later:
//   • every guidance event the page shows (cards + audit list) → intel_event (upsert; first_seen kept, last_seen moved)
//   • every AI extraction record (model, prompt version, quotes) → ai_extraction (insert once per document)
// PROTECTED (service key / login). Called hourly by .github/workflows/refresh-guidance-upgrades.yml after the page is warmed.
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { listExtractResults } from '@/lib/guidance-extract-reader';
import { archiveRowsFromEvents, extractionRow } from '@/lib/intel-archive';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  if (!getPool()) return NextResponse.json({ ok: false, error: 'Postgres not configured (DATABASE_URL)' }, { status: 503 });
  if (!(await ensureSchema())) return NextResponse.json({ ok: false, error: 'migrations failed — see server log' }, { status: 503 });
  const pool = getPool()!;
  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const out = { events: 0, eventsNew: 0, extractions: 0, extractionsNew: 0, errors: [] as string[] };
  // 1. guidance events (the cached 120-day answer; the warm-up step just built it)
  try {
    const r = await fetch(`${base}/api/v1/guidance-upgrades?window=120D&market=ALL`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`guidance-upgrades HTTP ${r.status}`);
    const j = await r.json();
    const rows = archiveRowsFromEvents(Array.isArray(j?.events) ? j.events : []);
    for (const x of rows) {
      const q = await pool.query(
        `INSERT INTO intel_event (id, market, ticker, company, event_type, event_date, status, verification, materiality, confidence, headline, changes, source_name, source_url, source_date, evidence, engine_version, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, verification = EXCLUDED.verification, materiality = EXCLUDED.materiality, headline = EXCLUDED.headline,
           changes = EXCLUDED.changes, evidence = EXCLUDED.evidence, engine_version = EXCLUDED.engine_version, payload = EXCLUDED.payload, last_seen = now()
         RETURNING (xmax = 0) AS inserted`,
        [x.id, x.market, x.ticker, x.company, x.eventType, x.eventDate, x.status, x.verification, x.materiality, x.confidence, x.headline, JSON.stringify(x.changes), x.sourceName, x.sourceUrl, x.sourceDate, x.evidence, x.engineVersion, JSON.stringify(x.payload)]);
      out.events++; if (q.rows[0]?.inserted) out.eventsNew++;
    }
  } catch (e: any) { out.errors.push(`events: ${String(e?.message || e).slice(0, 200)}`); }
  // 2. AI extraction records (immutable once written)
  try {
    const list = await listExtractResults({ market: 'ALL', includeEmpty: true });
    for (const r of list.results) {
      const x = extractionRow(r);
      const q = await pool.query(
        `INSERT INTO ai_extraction (doc_id, market, ticker, company, doc_url, doc_kind, filed_at, extracted_at, model, prompt_version, status, row_count, rows)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) ON CONFLICT (doc_id) DO NOTHING RETURNING doc_id`,
        [x.docId, x.market, x.ticker, x.company, x.docUrl, x.docKind, x.filedAt, x.extractedAt, x.model, x.promptVersion, x.status, x.rowCount, JSON.stringify(x.rows)]);
      out.extractions++; if (q.rowCount) out.extractionsNew++;
      if (Date.now() - t0 > 100_000) { out.errors.push('time budget reached — the rest go next hour'); break; }
    }
  } catch (e: any) { out.errors.push(`extractions: ${String(e?.message || e).slice(0, 200)}`); }
  const totals = (await pool.query(`SELECT (SELECT count(*) FROM intel_event) AS events, (SELECT count(*) FROM ai_extraction) AS extractions`)).rows[0];
  return NextResponse.json({ ok: out.errors.length === 0, ...out, totals: { events: Number(totals.events), extractions: Number(totals.extractions) }, ms: Date.now() - t0 });
}

export async function GET(req: NextRequest) {
  if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'Postgres not available' }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get('ticker') || '').toUpperCase();
  const rows = ticker
    ? (await getPool()!.query('SELECT id, market, ticker, event_type, event_date, status, verification, headline, source_name, source_url, first_seen, last_seen FROM intel_event WHERE ticker = $1 ORDER BY event_date DESC LIMIT 100', [ticker])).rows
    : (await getPool()!.query(`SELECT event_type, market, count(*)::int AS n, max(event_date) AS newest FROM intel_event GROUP BY 1,2 ORDER BY 3 DESC`)).rows;
  return NextResponse.json({ ok: true, rows });
}
