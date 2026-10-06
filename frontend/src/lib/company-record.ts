// zzz892 — ONE RECORD PER COMPANY. Every tab used to assemble its own picture of a company from its own cache; the same
// name could show one set of figures on Conviction Beats and another on Guidance Upgrades. This builds the single server
// record they all read: identity, latest graded results, active guidance (the universe), guidance events and AI
// extractions (the Postgres record of truth), and India technicals — each section stamped with its source and age, and
// each missing section saying why. Public company data only; the owner's holdings are never part of it.
//
// The merge (`mergeCompanyRecord`) is pure and unit-tested; `getCompanyRecord` does the reads (Redis + Postgres) in parallel,
// each bounded by a timeout so one slow store cannot stall the record.
import { kvGet } from './kv';

export type SectionState = 'OK' | 'NOT_FOUND' | 'UNAVAILABLE';
export interface Section<T> { state: SectionState; source: string; asOf: string | null; data: T | null; note?: string }
export interface CompanyRecord {
  ticker: string; market: 'IN' | 'US' | null; company: string | null; builtAt: string;
  results: Section<Record<string, unknown>>;
  guidance: Section<Array<Record<string, unknown>>>;
  events: Section<Array<Record<string, unknown>>>;
  extractions: Section<Array<Record<string, unknown>>>;
  technicals: Section<Record<string, unknown>>;
  summary: string[];
}

export const normTicker = (t: unknown) => String(t ?? '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE):/, '').replace(/\.(NS|BO)$/, '').trim();
const sec = <T,>(state: SectionState, source: string, data: T | null, asOf: string | null = null, note?: string): Section<T> => ({ state, source, asOf, data, ...(note ? { note } : {}) });

export interface RawReads {
  benchIN?: any; benchUS?: any; universe?: any[] | null; events?: any[] | null; extractions?: any[] | null; tech?: any;
  errors?: Partial<Record<'bench' | 'universe' | 'events' | 'extractions' | 'tech', string>>;
}

/** Pure: the record from whatever each store returned. */
export function mergeCompanyRecord(tickerIn: string, r: RawReads, now = new Date()): CompanyRecord {
  const t = normTicker(tickerIn); const err = r.errors || {};
  const fromBench = (b: any, mk: 'IN' | 'US') => (Array.isArray(b?.entries) ? b.entries.find((e: any) => normTicker(e?.ticker) === t) : null) ? { row: b.entries.find((e: any) => normTicker(e?.ticker) === t), mk, at: b?.updated_at || b?.generatedAt || b?.at || null } : null;
  const hit = fromBench(r.benchIN, 'IN') || fromBench(r.benchUS, 'US');
  const results = hit ? sec('OK', hit.mk === 'IN' ? 'Graded results bench (India)' : 'Graded results bench (USA)', hit.row as Record<string, unknown>, hit.at)
    : err.bench ? sec<Record<string, unknown>>('UNAVAILABLE', 'Graded results bench', null, null, err.bench) : sec<Record<string, unknown>>('NOT_FOUND', 'Graded results bench', null, null, 'Not on the graded bench (no strong result in the window).');
  const uni = (r.universe || []).filter((x: any) => [x?.record?.ticker, ...(x?.tickers || [])].some((k: unknown) => normTicker(k) === t));
  const guidance = uni.length ? sec('OK', 'Guidance universe (active guidance)', uni.map((x: any) => ({ entityKey: x.entityKey, display: x.display, metric: x.metric, period: x.record?.primary?.period ?? null, verification: x.record?.verification ?? null, statement: x.statement ?? null, sourceName: x.sourceName ?? null, sourceUrl: x.sourceUrl ?? null, sourceDate: x.sourceDate ?? null })))
    : err.universe ? sec<Array<Record<string, unknown>>>('UNAVAILABLE', 'Guidance universe', null, null, err.universe) : sec<Array<Record<string, unknown>>>('NOT_FOUND', 'Guidance universe', null, null, 'No active company guidance on file.');
  const evs = (r.events || []).filter((e: any) => normTicker(e?.ticker) === t);
  const events = evs.length ? sec('OK', 'Postgres intel_event (guidance changes, archived hourly)', evs, evs[0]?.last_seen ? new Date(evs[0].last_seen).toISOString() : null)
    : err.events ? sec<Array<Record<string, unknown>>>('UNAVAILABLE', 'Postgres intel_event', null, null, err.events) : sec<Array<Record<string, unknown>>>('NOT_FOUND', 'Postgres intel_event', null, null, 'No archived guidance events.');
  const exs = (r.extractions || []).filter((e: any) => normTicker(e?.ticker) === t);
  const extractions = exs.length ? sec('OK', 'Postgres ai_extraction (company documents read by AI, quote-checked)', exs, exs[0]?.extracted_at ? new Date(exs[0].extracted_at).toISOString() : null)
    : err.extractions ? sec<Array<Record<string, unknown>>>('UNAVAILABLE', 'Postgres ai_extraction', null, null, err.extractions) : sec<Array<Record<string, unknown>>>('NOT_FOUND', 'Postgres ai_extraction', null, null, 'No company document read by AI yet.');
  const tr = r.tech?.symbols?.[t] ?? null;
  const technicals = tr ? sec('OK', 'India technicals (NSE closes, daily)', tr as Record<string, unknown>, r.tech?.generatedAt ?? null)
    : err.tech ? sec<Record<string, unknown>>('UNAVAILABLE', 'India technicals', null, null, err.tech) : sec<Record<string, unknown>>('NOT_FOUND', 'India technicals', null, null, hit?.mk === 'US' ? 'Not collected for US names (US technicals are computed per print).' : 'Not in the technicals store.');
  const market = hit?.mk ?? (uni[0]?.record?.market ?? evs[0]?.market ?? exs[0]?.market ?? (tr ? 'IN' : null));
  const company = (hit?.row?.company as string) || uni[0]?.record?.company || evs[0]?.company || exs[0]?.company || null;
  const summary: string[] = [];
  if (hit) { const row: any = hit.row; summary.push(`Latest graded result: ${row.tier ?? '—'}${row.quarter ? ` (${row.quarter})` : ''}${row.filing_date ? `, filed ${row.filing_date}` : ''}.`); }
  if (uni.length) summary.push(`Active guidance: ${uni.slice(0, 3).map((x: any) => `${x.display ?? ''} ${x.metric ?? ''}`.trim()).join('; ')}.`);
  if (evs.length) summary.push(`${evs.length} archived guidance event${evs.length === 1 ? '' : 's'}; newest ${String(evs[0]?.event_date ?? '').slice(0, 10)} (${evs[0]?.status ?? '—'}).`);
  if (exs.length) summary.push(`${exs.length} company document${exs.length === 1 ? '' : 's'} read by AI.`);
  if (tr) summary.push(`Technicals: stage ${tr.stage ?? '—'}, RS ${tr.rs_rating ?? '—'}, ${tr.pct_from_52w_high != null ? `${tr.pct_from_52w_high}% from 52-week high` : 'no 52-week figure'}.`);
  if (!summary.length) summary.push('Nothing on file for this company in any store.');
  return { ticker: t, market, company, builtAt: now.toISOString(), results, guidance, events, extractions, technicals, summary };
}

const within = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

/** Reads every store in parallel (each with its own timeout) and merges. */
export async function getCompanyRecord(ticker: string): Promise<CompanyRecord> {
  const t = normTicker(ticker);
  const errors: RawReads['errors'] = {};
  const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 160);
  const [benchIN, benchUS, tech, universe, pg] = await Promise.all([
    within(kvGet<any>('bench:server:v1'), 4000, 'bench').catch((e) => { errors.bench = msg(e); return null; }),
    within(kvGet<any>('bench:us:server:v1'), 4000, 'bench').catch((e) => { errors.bench = msg(e); return null; }),
    within(kvGet<any>('india-tech:v1:latest'), 4000, 'technicals').catch((e) => { errors.tech = msg(e); return null; }),
    within((async () => { const s = await import('./guidance-universe-service'); const b = await s.getUniverseBundle(Date.now()); return [...(b.build.defaultRecords ?? []), ...(b.build.reviewQueue ?? [])] as any[]; })(), 8000, 'guidance universe').catch((e) => { errors.universe = msg(e); return null; }),
    within((async () => {
      const { getPool } = await import('./db'); const { ensureSchema } = await import('./db-migrate');
      if (!getPool() || !(await ensureSchema())) throw new Error('Postgres not configured');
      const pool = getPool()!;
      const [ev, ex] = await Promise.all([
        pool.query('SELECT id, market, ticker, company, event_type, event_date, status, verification, materiality, headline, changes, source_name, source_url, source_date, first_seen, last_seen FROM intel_event WHERE ticker = $1 ORDER BY event_date DESC NULLS LAST LIMIT 50', [t]),
        pool.query('SELECT doc_id, market, ticker, company, doc_url, doc_kind, filed_at, extracted_at, model, prompt_version, status, row_count, rows FROM ai_extraction WHERE ticker = $1 ORDER BY extracted_at DESC NULLS LAST LIMIT 20', [t]),
      ]);
      return { events: ev.rows, extractions: ex.rows };
    })(), 6000, 'Postgres').catch((e) => { errors.events = msg(e); errors.extractions = msg(e); return null; }),
  ]);
  return mergeCompanyRecord(t, { benchIN, benchUS, tech, universe, events: pg?.events ?? null, extractions: pg?.extractions ?? null, errors });
}
