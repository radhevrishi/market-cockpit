// zzz914 — the two scheduled owner briefs, server side: read the stored book and research, compose (pure modules), send
// once per day through lib/owner-notify, keep a small state in Redis so tomorrow only reports what is new.
//
// Reads (nothing is fetched from the web here — only what the app already stored):
//   • the owner's book: /api/v1/user-state rows (`mc:conviction-beats:v1`, `mc_portfolio_holdings`, `mc:thesis:v1`)
//   • the graded bench + screener exports (lib/holding-fundamentals — the same rows Portfolio Catalysts reads)
//   • the evidence ledgers (lib/thesis/evidence-store) — thesis statuses the Portfolio Catalysts engine assigned
//   • the guidance archive (Postgres intel_event) and the guidance universe (company guidance statements)
// Paid AI: only the conviction brief, only for NEW names with company text on file, through lib/anthropic-meter (monthly
// cap + meter) with a hard per-run cap (AI_MAX_NAMES, AI_MAX_USD_PER_RUN). The thesis watch uses no AI.
// Logging: counts only. Holdings, tickers and theses are never written to the log.
import { kvGet, kvSet } from '@/lib/kv';
import { getUserState } from '@/lib/user-state-store';
import { loadBench, loadScreener, norm } from '@/lib/holding-fundamentals';
import { mergeCompanyRecord } from '@/lib/company-record';
import { notifyOwner, notifyOwnerOnce, notifyChannels, type NotifyResult } from '@/lib/owner-notify';
import { vaultValue, bareTicker, looksUsListed, briefDate, briefDayKey, num } from './common';
import {
  cbEntriesFrom, enrichEntry, scoreRow, smallMidOnly, rankRows, deltaOf, attachCatalysts, nextState, composeConvictionBrief,
  aiFacts, aiWorthIt, aiCatalystRequest, parseAiCatalyst, AI_MAX_NAMES, AI_MAX_USD_PER_RUN, type CbResearch, type CbState, type Brief,
} from './conviction-brief';
import { assessHolding, composeThesisWatch, type HoldingInput, type WatchState, type HoldingResult, type LedgerView } from './thesis-watch';

export const CB_STATE_KEY = 'owner-brief:conviction:state:v1';
export const TW_STATE_KEY = 'owner-brief:thesis-watch:state:v1';
const STATE_TTL_S = 400 * 86400;
const CHAT_ID = process.env.NEXT_PUBLIC_CHAT_ID || '5057319640';

export interface RunOpts { now?: Date; dry?: boolean; force?: boolean; ai?: boolean }
export interface RunOut {
  ok: boolean; sent: NotifyResult | null; alreadySent: boolean; oneLine: boolean; partial: string | null;
  counts: Record<string, number>; aiCalls?: number; aiUsd?: number; brief?: Brief; channels: { telegram: boolean; email: boolean };
}

const within = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
const fmtSaved = (iso: string | null | undefined) => (iso ? briefDate(new Date(iso)) : 'date unknown');

async function readVault(key: Parameters<typeof getUserState>[0]): Promise<{ value: unknown; updatedAt: string | null } | null> {
  const row = await within(getUserState(key), 8000, 'user-state').catch(() => null);
  if (!row) return null;
  return { value: vaultValue(row.value), updatedAt: row.updatedAt || null };
}

/** Guidance archive rows for the given tickers (Postgres). Empty when Postgres is not set up. */
async function guidanceEvents(tickers: string[], days: number): Promise<any[]> {
  if (!tickers.length) return [];
  const { getPool } = await import('@/lib/db');
  const { ensureSchema } = await import('@/lib/db-migrate');
  if (!getPool() || !(await ensureSchema())) return [];
  const q = await getPool()!.query(
    `SELECT id, ticker, company, event_type, event_date, status, headline, source_url FROM intel_event
      WHERE ticker = ANY($1) AND (event_date IS NULL OR event_date >= (current_date - $2::int)) ORDER BY event_date DESC NULLS LAST, last_seen DESC LIMIT 2000`,
    [tickers, days]);
  return q.rows;
}

async function universeRecords(): Promise<any[] | null> {
  const s = await import('@/lib/guidance-universe-service');
  const b = await s.getUniverseBundle(Date.now());
  return [...(b.build.defaultRecords ?? []), ...(b.build.reviewQueue ?? [])] as any[];
}

/** Pure: the stored research for one ticker from the archive rows and the universe. */
export function researchFor(t: string, events: any[], universe: any[] | null): CbResearch {
  const rec = mergeCompanyRecord(t, { universe, events, errors: {} });
  const evs = (rec.events.data || []) as any[];
  const isType = (e: any, ...ts: string[]) => ts.includes(String(e?.event_type || '').toUpperCase());
  const raise = evs.find((e) => isType(e, 'GUIDANCE_RAISED'));
  const cut = evs.find((e) => isType(e, 'GUIDANCE_LOWERED', 'WITHDRAWAL'));
  const d = (e: any) => (e?.event_date ? String(e.event_date instanceof Date ? e.event_date.toISOString() : e.event_date).slice(0, 10) : '');
  const g = ((rec.guidance.data || []) as any[])[0] || null;
  const newest = evs.find((e) => e?.headline) || null;
  return {
    guidanceRaised: !!raise && (!cut || d(raise) >= d(cut)),
    guidanceLowered: !!cut && (!raise || d(cut) > d(raise)),
    guidanceStatement: g?.statement ? String(g.statement) : null,
    guidanceUrl: g?.sourceUrl || null,
    eventHeadline: newest?.headline ? String(newest.headline) : null,
    eventDate: newest ? d(newest) || null : null,
  };
}

async function send(key: string, b: Brief, force: boolean): Promise<{ sent: NotifyResult | null; alreadySent: boolean }> {
  const msg = { subject: b.subject, text: b.text, html: b.html, topic: 'PORTFOLIO' as const };
  if (force) return { sent: await notifyOwner(msg), alreadySent: false };
  const r = await notifyOwnerOnce(key, msg);
  return { sent: r, alreadySent: r === null };
}
const delivered = (r: NotifyResult | null) => !!r && (r.telegram === 'sent' || r.email === 'sent');

// ── conviction catalyst brief ───────────────────────────────────────────────

async function aiCatalysts(targets: Array<{ ticker: string; company: string; facts: string[] }>): Promise<{ lines: Record<string, string>; calls: number; usd: number; note: string | null }> {
  const lines: Record<string, string> = {};
  const meter = await import('@/lib/anthropic-meter');
  if (!targets.length) return { lines, calls: 0, usd: 0, note: null };
  if (!meter.modelConfigured()) return { lines, calls: 0, usd: 0, note: 'Catalyst lines are rule-based (no AI key set).' };
  const { fenceDoc } = await import('@/lib/ai-fence');
  const model = meter.activeModel('claude-haiku-4-5-20251001');
  let usd = 0, calls = 0, note: string | null = null;
  for (const t of targets.slice(0, AI_MAX_NAMES)) {
    if (usd >= AI_MAX_USD_PER_RUN) { note = 'AI per-run cap reached; remaining new names use rule-based lines.'; break; }
    try {
      const r = await meter.anthropicMessages('owner-brief-catalyst', aiCatalystRequest(model, t.company, fenceDoc(t.facts.join('\n'))), { signal: AbortSignal.timeout(30_000) });
      calls++;
      const j: any = await r.json().catch(() => null);
      if (r.status === 402) { note = 'Monthly AI cap reached; new names use rule-based lines.'; break; }
      usd += meter.costOf(model, j?.usage);
      if (!r.ok) continue;
      const line = parseAiCatalyst(j);
      if (line && !/^no forward catalyst stated/i.test(line)) lines[t.ticker] = line;
    } catch { /* one failed line falls back to the rules */ }
  }
  return { lines, calls, usd, note: note || (calls ? `${Object.keys(lines).length} catalyst line(s) for new names written by AI from stored company guidance.` : null) };
}

export async function runConvictionBrief(o: RunOpts = {}): Promise<RunOut> {
  const now = o.now || new Date();
  const dateLabel = briefDate(now);
  const channels = notifyChannels('PORTFOLIO');
  const base = { channels } as const;
  const book = await readVault('mc:conviction-beats:v1');
  const entries = book ? cbEntriesFrom(book.value) : [];
  if (!book || !entries.length) {
    const partial = book ? 'your conviction list on the server is empty.' : 'could not read your conviction list from the server (/api/v1/user-state). Open the app once so the browser copy syncs.';
    const b = composeConvictionBrief({ rows: [], delta: { added: [], dropped: [], moved: [], newFlags: [], firstRun: true }, largeLeftOut: 0, when: now, dateLabel, source: 'none', prevAt: null, partial });
    if (o.dry) return { ...base, ok: false, sent: null, alreadySent: false, oneLine: false, partial, counts: { names: 0 }, brief: b };
    const s = await send(`conviction-catalyst-brief:${briefDayKey(now)}`, b, !!o.force);
    return { ...base, ok: false, ...s, oneLine: false, partial, counts: { names: 0 } };
  }

  const [bench, screener] = await Promise.all([loadBench('IN').catch(() => new Map()), loadScreener().catch(() => new Map())]);
  const tickers = entries.map((e) => bareTicker(e.ticker));
  let readNote: string[] = [];
  const [events, universe] = await Promise.all([
    within(guidanceEvents(tickers, 200), 10_000, 'guidance archive').catch((e) => { readNote.push(`guidance archive unavailable (${String(e?.message || e).slice(0, 60)})`); return [] as any[]; }),
    within(universeRecords(), 12_000, 'guidance universe').catch(() => { readNote.push('guidance universe unavailable'); return null; }),
  ]);

  const research: Record<string, CbResearch> = {};
  const scored = entries.map((e) => {
    const t = bareTicker(e.ticker);
    const { entry, filled } = enrichEntry(e, bench.get(norm(t)), screener.get(norm(t)));
    research[t] = researchFor(t, events, universe);
    return scoreRow(entry, research[t], filled);
  });
  const { kept, largeLeftOut } = smallMidOnly(scored);
  const ranked = rankRows(kept);
  const prev = await kvGet<CbState>(CB_STATE_KEY).catch(() => null);
  const delta = deltaOf(ranked, prev);

  let ai = { lines: {} as Record<string, string>, calls: 0, usd: 0, note: null as string | null };
  if (o.ai !== false && !o.dry) {
    const targets = ranked.filter((r) => delta.added.includes(r.ticker) && aiWorthIt(research[r.ticker] || {}))
      .map((r) => ({ ticker: r.ticker, company: r.company, facts: aiFacts(research[r.ticker] || {}, r.info) }));
    ai = await aiCatalysts(delta.firstRun ? [] : targets);   // first run: baseline only, no AI spend on the whole list
  }
  const rows = attachCatalysts(ranked, research, prev, ai.lines, delta.added);
  const source = `your conviction list (server copy, saved ${fmtSaved(book.updatedAt)})${readNote.length ? `; ${readNote.join('; ')}` : ''}`;
  const b = composeConvictionBrief({ rows, delta, largeLeftOut, when: now, dateLabel, source, prevAt: prev?.at || null, aiNote: ai.note });
  const counts = { names: rows.length, sharp: rows.filter((r) => r.bucket === 'SHARP').length, gate: rows.filter((r) => r.bucket === 'GATE').length, catalyst: rows.filter((r) => r.bucket === 'CATALYST').length, added: delta.added.length, dropped: delta.dropped.length, largeLeftOut };
  if (o.dry) return { ...base, ok: true, sent: null, alreadySent: false, oneLine: b.oneLine, partial: null, counts, brief: b };
  const s = await send(`conviction-catalyst-brief:${briefDayKey(now)}`, b, !!o.force);
  // the state moves only when the brief went out, so a failed send re-reports the same news next time
  if (delivered(s.sent)) await kvSet(CB_STATE_KEY, nextState(rows, now), STATE_TTL_S).catch(() => undefined);
  return { ...base, ok: delivered(s.sent) || s.alreadySent, ...s, oneLine: b.oneLine, partial: null, counts, aiCalls: ai.calls, aiUsd: Math.round(ai.usd * 10000) / 10000 };
}

// ── portfolio thesis watch ──────────────────────────────────────────────────

/** Pure: India holding symbols from the stored holdings value (array of {symbol}). */
export function holdingSymbols(value: unknown): { india: string[]; usDropped: number } {
  const arr: any[] = Array.isArray(value) ? value : Array.isArray((value as any)?.holdings) ? (value as any).holdings : [];
  const seen = new Set<string>(); const india: string[] = []; let usDropped = 0;
  for (const h of arr) {
    const raw = typeof h === 'string' ? h : h?.symbol ?? h?.ticker;
    const t = bareTicker(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (looksUsListed(raw) || h?.market === 'US') { usDropped++; continue; }
    india.push(t);
  }
  return { india, usDropped };
}

/** Pure: the latest status the thesis engine stored on a ledger. */
export function ledgerViewOf(l: any): LedgerView | null {
  if (!l || typeof l !== 'object') return null;
  const p = l.latest_period ? l.periods?.[l.latest_period] : null;
  const hist = Array.isArray(l.status_history) ? l.status_history : [];
  const h = hist.length ? hist[hist.length - 1] : null;
  return { period: l.latest_period || h?.reporting_period || null, status: p?.status || h?.status || null, because: p?.status_because || h?.because || null, readAt: l.last_evidence_read_at || null };
}

export async function runThesisWatch(o: RunOpts = {}): Promise<RunOut> {
  const now = o.now || new Date();
  const dateLabel = briefDate(now);
  const channels = notifyChannels('PORTFOLIO');
  const base = { channels } as const;

  // holdings: the server copy of the Portfolio page, then the Telegram portfolio record, then the synced book
  let src = ''; let sym = { india: [] as string[], usDropped: 0 };
  const vault = await readVault('mc_portfolio_holdings');
  if (vault) { sym = holdingSymbols(vault.value); src = `your India book (server copy, saved ${fmtSaved(vault.updatedAt)})`; }
  if (!sym.india.length) {
    const p = await kvGet<any>(`portfolio:${CHAT_ID}`).catch(() => null);
    if (p) { sym = holdingSymbols(p.holdings); src = `your portfolio record (saved ${fmtSaved(p.updatedAt)})`; }
  }
  if (!sym.india.length) {
    const { readBookState } = await import('@/lib/book-store');
    const bs = await readBookState(CHAT_ID).catch(() => null);
    if (bs) { sym = holdingSymbols((bs.tickers || []).filter((t) => t.held).map((t) => ({ symbol: t.ticker, market: t.market }))); src = `the synced book (saved ${fmtSaved(bs.updatedAt)})`; }
  }
  if (!sym.india.length) {
    const partial = 'could not read your India holdings from the server. Open the Portfolio page once so the browser copy syncs.';
    const b = composeThesisWatch({ results: [], dateLabel, source: 'none', prevAt: null, firstRun: false, partial });
    if (o.dry) return { ...base, ok: false, sent: null, alreadySent: false, oneLine: false, partial, counts: { holdings: 0 }, brief: b };
    const s = await send(`portfolio-thesis-watch:${briefDayKey(now)}`, b, !!o.force);
    return { ...base, ok: false, ...s, oneLine: false, partial, counts: { holdings: 0 } };
  }

  const tickers = sym.india;
  const notes: string[] = [];
  const [theses, cbVault, bench, screener, ledgers, events] = await Promise.all([
    readVault('mc:thesis:v1'),
    readVault('mc:conviction-beats:v1'),
    loadBench('IN').catch(() => new Map()),
    loadScreener().catch(() => new Map()),
    within((async () => (await import('@/lib/thesis/evidence-store')).loadLedgers(tickers))(), 20_000, 'evidence ledgers').catch(() => { notes.push('evidence ledgers unavailable'); return {} as Record<string, any>; }),
    within(guidanceEvents(tickers, 120), 10_000, 'guidance archive').catch(() => { notes.push('guidance archive unavailable'); return [] as any[]; }),
  ]);
  const thesisMap: Record<string, any> = {};
  for (const [k, v] of Object.entries((theses?.value as any) || {})) thesisMap[bareTicker(k)] = v;
  const cbMap: Record<string, any> = {};
  for (const e of cbEntriesFrom(cbVault?.value)) cbMap[e.ticker] = e;

  const prev = await kvGet<WatchState>(TW_STATE_KEY).catch(() => null);
  const results: HoldingResult[] = [];
  const nextHoldings: WatchState['holdings'] = {};
  for (const t of tickers) {
    const graded = bench.get(norm(t)) || null;
    const scr = screener.get(norm(t)) || null;
    const { entry: figures } = enrichEntry(cbMap[t] || {}, graded, scr);
    const hasFig = ['opm_pct', 'net_profit_yoy_pct', 'cfo_to_pat_ratio', 'annual_cfo_pat'].some((k) => figures[k] != null);
    const evs = events.filter((e: any) => bareTicker(e?.ticker) === t).map((e: any) => ({
      id: String(e.id), type: String(e.event_type || ''), headline: e.headline ? String(e.headline) : null, url: e.source_url || null,
      date: e.event_date ? String(e.event_date instanceof Date ? e.event_date.toISOString() : e.event_date).slice(0, 10) : null,
    }));
    const result = graded?.filing_date ? { filingDate: String(graded.filing_date).slice(0, 10), salesYoy: num(graded.sales_yoy_pct), profitYoy: num(graded.net_profit_yoy_pct), url: graded.source_url || null } : null;
    const h: HoldingInput = {
      ticker: t, company: thesisMap[t]?.company || cbMap[t]?.company || graded?.company || scr?.company || t,
      thesis: thesisMap[t] || null, figures: hasFig ? figures : null, ledger: ledgerViewOf(ledgers[t]), guidance: evs, result,
    };
    const { result: r, state } = assessHolding(h, prev?.holdings?.[t]);
    results.push(r); nextHoldings[t] = state;
  }
  const source = `${src}${notes.length ? `; ${notes.join('; ')}` : ''}`;
  const b = composeThesisWatch({ results, dateLabel, source, prevAt: prev?.at || null, firstRun: !prev, usDropped: sym.usDropped });
  const counts = {
    holdings: results.length, impaired: results.filter((r) => r.verdict === 'IMPAIRED').length, watch: results.filter((r) => r.verdict === 'WATCH').length,
    strengthened: results.filter((r) => r.verdict === 'STRENGTHENED').length, intact: results.filter((r) => r.verdict === 'INTACT').length,
    withNews: results.filter((r) => r.changes.length).length, usDropped: sym.usDropped,
  };
  if (o.dry) return { ...base, ok: true, sent: null, alreadySent: false, oneLine: b.oneLine, partial: null, counts, brief: b };
  const s = await send(`portfolio-thesis-watch:${briefDayKey(now)}`, b, !!o.force);
  if (delivered(s.sent)) await kvSet(TW_STATE_KEY, { at: now.toISOString(), holdings: nextHoldings } satisfies WatchState, STATE_TTL_S).catch(() => undefined);
  return { ...base, ok: delivered(s.sent) || s.alreadySent, ...s, oneLine: b.oneLine, partial: null, counts };
}
