// zzz1305 — DAILY BEST PICKS: read every source the app already stores, build one candidate per company, score (./score),
// choose (./score selectPicks), render (./render) and send once a day through lib/owner-notify. No AI, no web scraping:
// only stored data plus one internal call (Transformation Radar, cached) and the regime route.
// Each source has its own clock; a failed source adds no points and is named in the email (never a silent crash).
import { kvGet, kvSet } from '@/lib/kv';
import { getUserState } from '@/lib/user-state-store';
import { notifyOwnerOnce, notifyChannels, type NotifyResult } from '@/lib/owner-notify';
import { vaultValue, briefDate } from '@/lib/owner-briefs/common';
import { holdingSymbols } from '@/lib/owner-briefs/run';
import { decisionLookup } from '@/lib/decisions';
import { scoreCandidate, selectPicks, nextSent, sentKey, type Candidate, type Evidence, type MarketRegime, type Mkt, type Scored, type SentMap, type Tech, type Selection, type RegimeKind } from './score';
import { renderEmail, type SourceStatus, type Rendered } from './render';

export const BEST_PICKS_VERSION = 'bp-1';
export const SENT_KEY = 'best-picks:v1:sent';
export const LAST_KEY = 'best-picks:v1:last';
const SITE = (process.env.PUBLIC_SITE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');

const within = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms))]);
const n = (v: unknown): number | null => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
const day = (v: unknown): string | null => { const s = String(v ?? ''); const m = s.match(/^\d{4}-\d{2}-\d{2}/); if (m) return m[0]; const d = Date.parse(s); return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null; };
const bare = (t: unknown) => String(t ?? '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '').trim();
const ageDays = (iso: string | null | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 86_400_000 : Infinity);

export interface RunOpts { dry?: boolean; force?: boolean; base: string; secret: string; now?: Date }
export interface BestPicksOut {
  ok: boolean; dry: boolean; sent: NotifyResult | null; alreadySent: boolean; partial: string | null; quiet: boolean;
  channels: { telegram: boolean; email: boolean };
  counts: Record<string, number>; sources: SourceStatus[];
  rendered?: Rendered; scored?: Array<Pick<Scored, 'market' | 'ticker' | 'company' | 'score' | 'familyCount' | 'vetoes' | 'warnings' | 'excluded' | 'breakdown'> & { list: string }>;
}

/** One source's result + its line for the health table. */
async function source<T>(sources: SourceStatus[], id: string, label: string, ms: number, fn: () => Promise<{ v: T; asOf?: string | null; count?: number | null; staleAfterH?: number; note?: string | null }>): Promise<T | null> {
  try {
    const r = await within(fn(), ms, label);
    const stale = r.staleAfterH != null && r.asOf != null && ageDays(r.asOf, Date.now()) * 24 > r.staleAfterH;
    sources.push({ id, label, state: r.count === 0 ? 'empty' : stale ? 'stale' : 'ok', asOf: r.asOf ? String(r.asOf).replace('T', ' ').slice(0, 16) : null, note: r.note ?? null, count: r.count ?? null });
    return r.v;
  } catch (e: any) {
    sources.push({ id, label, state: 'failed', asOf: null, note: String(e?.message || e).slice(0, 120), count: null });
    return null;
  }
}

/** "revenue FY27 ₹1,200–1,300 → ₹1,400–1,500 Cr (+15%)" from an intel_event changes list. */
function guidanceLine(raw: unknown): string | null {
  const list = Array.isArray(raw) ? raw : [];
  const c: any = list.find((x: any) => x && x.after && (x.after.low != null || x.after.high != null));
  if (!c) return null;
  const rng = (v: any) => { if (!v) return null; const f = (n: any) => (n == null ? null : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })); const lo = f(v.low), hi = f(v.high); const body = lo && hi && lo !== hi ? `${lo}–${hi}` : (lo || hi); if (!body) return null; const u = String(v.unit || '').toLowerCase(); return u === '%' || u === 'pct' || u === 'percent' ? `${body}%` : `${v.currency === 'USD' ? '$' : v.currency === 'INR' ? '₹' : ''}${body}${u && u !== 'absolute' ? ' ' + v.unit : ''}`; };
  const a = rng(c.after); if (!a) return null;
  const b = rng(c.before);
  const pct = typeof c.pct === 'number' && isFinite(c.pct) ? ` (${c.pct > 0 ? '+' : ''}${Math.round(c.pct)}%)` : typeof c.pp === 'number' && isFinite(c.pp) ? ` (${c.pp > 0 ? '+' : ''}${c.pp.toFixed(1)} pts)` : '';
  const metric = String(c.metric || 'guidance').replace(/_/g, ' ').toLowerCase();
  return `${metric}${c.period ? ' ' + c.period : ''} ${b ? `${b} → ` : ''}${a}${pct}`;
}

/** a raise of under 5% (or under 1 point) is a small step, not a re-rating. */
function smallRaise(raw: unknown): boolean {
  const c: any = (Array.isArray(raw) ? raw : []).find((x: any) => x && x.after);
  if (!c) return false;
  if (typeof c.pct === 'number' && isFinite(c.pct)) return Math.abs(c.pct) < 5;
  if (typeof c.pp === 'number' && isFinite(c.pp)) return Math.abs(c.pp) < 1;
  return false;
}

function regimeOf(raw: any): RegimeKind { const k = String(raw?.kind || '').toUpperCase(); return (['BULL', 'RECOVERY', 'PULLBACK', 'CORRECTION', 'BEAR'] as string[]).includes(k) ? k as RegimeKind : 'UNKNOWN'; }

export async function runBestPicks(o: RunOpts): Promise<BestPicksOut> {
  const t0 = Date.now();
  const now = o.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const sources: SourceStatus[] = [];
  const channels = notifyChannels('BRIEF');
  const hdr = { 'x-cron-secret': o.secret };

  // ── 1. market regime + panel (Tier 2) ──────────────────────────────────────
  const [regRaw, panel] = await Promise.all([
    source(sources, 'regime', 'Market regime (India + USA)', 20_000, async () => {
      const r = await fetch(`${o.base}/api/market/regime`, { headers: hdr, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return { v: j, asOf: j?.asOf ?? null, staleAfterH: 48 };
    }),
    source(sources, 'panel', 'VIX / breadth panel', 25_000, async () => {
      const { marketPanel } = await import('@/lib/options-ideas/market-panel');
      const p = await marketPanel();
      return { v: p, asOf: p[0]?.readAt ?? null, count: p.length };
    }),
  ]);
  const regimes: Record<Mkt, MarketRegime | null> = { IN: null, US: null };
  for (const m of ['IN', 'US'] as Mkt[]) {
    const r = m === 'IN' ? regRaw?.india : regRaw?.usa;
    const p = (panel || []).find((x: any) => x.market === m);
    if (!r && !p) continue;
    regimes[m] = {
      kind: r ? regimeOf(r) : 'UNKNOWN', note: r?.note ?? null, drawdownPct: n(r?.drawdownPct),
      vix: n(p?.vix?.last), vixBand: p?.vix?.band ?? null, above50: n(p?.breadth?.above50), above200: n(p?.breadth?.above200),
      indexName: p?.index?.name ?? null, indexChg: n(p?.index?.chg1d),
    };
  }

  // ── 2. trend / size data (Tier 2) ──────────────────────────────────────────
  const snaps: Record<Mkt, Map<string, Tech>> = { IN: new Map(), US: new Map() };
  await Promise.all((['IN', 'US'] as Mkt[]).map((m) => source(sources, `snap-${m}`, `Stock screener snapshot ${m === 'IN' ? 'India' : 'USA'}`, 30_000, async () => {
    const { getSnapshot } = await import('@/lib/screener/snapshot-cache');
    const { rsRanks } = await import('@/lib/screener/rs-rank');
    const s = await getSnapshot(m);
    if (!s) throw new Error('no snapshot built');
    const rs = rsRanks(s.rows);
    for (const r of s.rows as any[]) {
      const t = bare(r.t); if (!t) continue;
      const px = n(r.px ?? r.scanPx); const vol = n(r.avgVol30);
      snaps[m].set(t, {
        px, chg: n(r.chg), mc: n(r.mc), sma50: n(r.sma50), sma200: n(r.sma200), ema21: n(r.ema21),
        stage: n(r.twSt), health: n(r.twH), rs: rs.get(String(r.t).toUpperCase()) ?? null, p3m: n(r.perf3M), p1y: n(r.perf1Y),
        traded: px != null && vol != null ? (m === 'IN' ? px * vol / 1e7 : px * vol / 1e6) : null,
        r40: n(r.r40), roce: n(r.roceFY), de: n(r.de), name: r.n ?? null, industry: r.ind ?? r.sec ?? null,
      });
    }
    return { v: true, asOf: s.builtAt, count: s.rows.length, staleAfterH: 96 };
  })));

  // ── 3. catalysts (Tier 1) ──────────────────────────────────────────────────
  const cands = new Map<string, Candidate>();
  const cand = (m: Mkt, t0: unknown, company?: unknown): Candidate | null => {
    const t = bare(t0); if (!t || /^\d+$/.test(t) && m === 'US') return null;
    const k = `${m}:${t}`;
    let c = cands.get(k);
    if (!c) { c = { market: m, ticker: t, company: String(company || '') || t, evidence: [], tech: null, held: false, rejectedOn: null, resultsOn: null, guidanceCut: null }; cands.set(k, c); }
    else if ((!c.company || c.company === t) && company) c.company = String(company);
    return c;
  };
  const add = (c: Candidate | null, e: Evidence) => { if (c && !c.evidence.some((x) => x.id === e.id)) c.evidence.push(e); };

  // 3a. earnings — the server Conviction benches (BLOCKBUSTER / STRONG graded results)
  await Promise.all(([['IN', 'bench:server:v1', 'Earnings Ops India'], ['US', 'bench:us:server:v1', 'Earnings Ops USA']] as Array<[Mkt, string, string]>).map(([m, key, label]) =>
    source(sources, `earnings-${m}`, label, 15_000, async () => {
      const doc = await kvGet<any>(key);
      const rows: any[] = Array.isArray(doc?.entries) ? doc.entries : [];
      let k = 0;
      for (const r of rows) {
        const tier = String(r?.tier || '').toUpperCase();
        if (tier !== 'BLOCKBUSTER' && tier !== 'STRONG') continue;
        const d = day(r.filing_date) || day(r.seen_date);
        if (!d || ageDays(d, now.getTime()) > 45) continue;
        const sales = n(r.sales_yoy_pct ?? r.revenue_yoy_pct ?? r.revenue_yoy), pat = n(r.net_profit_yoy_pct ?? r.net_income_yoy_pct ?? r.eps_yoy_pct);
        const figs = [sales != null ? `sales ${sales >= 0 ? '+' : ''}${Math.round(sales)}%` : '', pat != null ? `profit ${pat >= 0 ? '+' : ''}${Math.round(pat)}%` : ''].filter(Boolean).join(', ');
        add(cand(m, String(r.ticker).split('@')[0], r.company), { family: 'EARNINGS', tool: 'Earnings Ops', points: tier === 'BLOCKBUSTER' ? 25 : 18, line: `${tier}${r.quarter ? ` ${r.quarter}` : ''} result${figs ? ` — ${figs}` : ''}`, date: d, id: `eo:${m}:${bare(r.ticker)}:${d}`, url: r.pdf_url || r.source_url || null });
        k++;
      }
      return { v: true, asOf: doc?.updatedAt ?? null, count: k, staleAfterH: 72 };
    })));

  // 3b. guidance — verified raises / cuts from the guidance archive (Postgres intel_event)
  await source(sources, 'guidance', 'Guidance Upgrades (archive)', 15_000, async () => {
    const { getPool } = await import('@/lib/db');
    const { ensureSchema } = await import('@/lib/db-migrate');
    if (!getPool() || !(await ensureSchema())) throw new Error('database not available');
    const q = await getPool()!.query(
      `SELECT id, market, ticker, company, event_type, event_date, status, verification, headline, changes, source_url, last_seen FROM intel_event
        WHERE ticker IS NOT NULL AND event_type IN ('GUIDANCE_FORMAL_UPGRADE','GUIDANCE_DOWNGRADE') AND status = 'CARD'
          AND COALESCE(event_date, last_seen::date) >= (current_date - 45) ORDER BY event_date DESC NULLS LAST LIMIT 1500`);
    let newest: string | null = null;
    for (const r of q.rows as any[]) {
      const m: Mkt = String(r.market).toUpperCase() === 'US' ? 'US' : 'IN';
      const d = day(r.event_date) || day(r.last_seen);
      if (d && (!newest || d > newest)) newest = d;
      const c = cand(m, r.ticker, r.company);
      if (!c) continue;
      if (r.event_type === 'GUIDANCE_DOWNGRADE') { if (!c.guidanceCut || (d && d > c.guidanceCut)) c.guidanceCut = d; continue; }
      const verified = String(r.verification || '').toUpperCase() === 'VERIFIED';
      const gl = guidanceLine(r.changes); const vague = !gl || /^other\b|^guidance\b/i.test(gl);
      add(c, { family: 'GUIDANCE', tool: 'Guidance Upgrades', points: vague ? 8 : smallRaise(r.changes) ? 10 : verified ? 20 : 12, line: vague ? `guidance raised (measure not clear — check the filing)` : `${verified ? 'verified ' : ''}guidance raise — ${gl}`, date: d, id: `gu:${r.id}`, url: r.source_url || null });
    }
    // a raise newer than the cut wins
    for (const c of cands.values()) if (c.guidanceCut && c.evidence.some((e) => e.family === 'GUIDANCE' && e.date && e.date > c.guidanceCut!)) c.guidanceCut = null;
    return { v: true, asOf: newest, count: q.rowCount ?? 0 };
  });

  // 3c. business events — Transformational Gainers board (orders, capacity, approvals, new business, deals, turnarounds)
  await source(sources, 'events', 'Transformational Gainers', 25_000, async () => {
    const { loadReviewed } = await import('@/lib/transformational/reviewed');
    const { loadVerifies } = await import('@/lib/transformational/verify-server');
    const { applyVerify } = await import('@/lib/transformational/verify');
    const { buildBoard, chanceOf, bestHeadline, RESULTS_RELEASE_RE } = await import('@/lib/transformational/core');
    const raw = await loadReviewed(52);
    const vs = await loadVerifies(raw.filter((x) => x.needsCheck).map((x) => x.id));
    const board = buildBoard(raw.map((x) => applyVerify(x, vs.get(x.id))), today, 45);
    let k = 0;
    for (const x of board.items) {
      if (x.kind === 'RESULTS' || x.kind === 'GUIDANCE') continue;   // counted by the earnings / guidance families
      const hl = bestHeadline(x);
      // a results release or a bare "Announcement under Regulation 30" is not a separate business event
      if (RESULTS_RELEASE_RE.test(hl) || /\b(?:consolidated|standalone) (?:revenue|results)\b/i.test(hl) || /^\s*announcement under reg/i.test(hl)) continue;
      const ch = chanceOf(x);
      if (ch.label !== 'HIGH' && ch.label !== 'MEDIUM') continue;
      add(cand(x.market as Mkt, x.ticker, x.company), { family: 'EVENT', tool: 'Transformational Gainers', points: ch.label === 'HIGH' ? 20 : 12, line: `${hl.slice(0, 130)} (multibagger chance ${ch.label.toLowerCase()})`, date: x.eventDate || x.sessionDate, id: `tg:${x.id}`, url: x.sourceUrl });
      k++;
    }
    return { v: true, asOf: board.to, count: k };
  });

  // 3d. Transformation Radar (India concalls / presentations) — confirmed and watch tiers
  await source(sources, 'radar', 'Transformation Radar', 40_000, async () => {
    const r = await fetch(`${o.base}/api/v1/concall-intel/transformation-screener?days=45&limit=3000`, { headers: hdr, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j?.building) throw new Error('scan still building');
    let k = 0, newest: string | null = null;
    for (const e of (Array.isArray(j?.entries) ? j.entries : [])) {
      const tr = e?.insight?.transformation;
      if (!tr || (tr.tier !== 'CONFIRMED' && tr.tier !== 'WATCH')) continue;
      const d = day(e.filing_datetime);
      if (d && (!newest || d > newest)) newest = d;
      add(cand('IN', e.symbol, e.company_name), { family: 'RADAR', tool: 'Transformation Radar', points: tr.tier === 'CONFIRMED' ? 20 : 10, line: `${tr.tier === 'CONFIRMED' ? 'confirmed' : 'possible'} business change — ${String(tr.thesis?.whatChanges || e.evidence_label || '').slice(0, 120)}`, date: d, id: `radar:${bare(e.symbol)}:${d}`, url: e.source_url || null });
      k++;
    }
    return { v: true, asOf: newest, count: k };
  });

  // ── 4. chart setups for the catalyst names (Tier 2): the Options Ideas daily scans (call side only) ──
  await Promise.all((['IN', 'US'] as Mkt[]).map((m) => source(sources, `setups-${m}`, `Options Ideas scan ${m === 'IN' ? 'India' : 'USA'}`, 15_000, async () => {
    const { readScan } = await import('@/lib/options-ideas/server');
    const s = await readScan(m);
    if (!s) throw new Error('no stored scan');
    let k = 0;
    for (const i of s.ideas || []) {
      // zzz1307 — a VCP breakout counts at grade B too (no replay history yet, so it cannot reach A)
      const vcp = i.setup?.id === 'vcp_breakout' && i.grade === 'B';
      if (i.setup?.side !== 'CALL' || (i.grade !== 'A+' && i.grade !== 'A' && !vcp)) continue;
      const c = cands.get(`${m}:${bare(i.ticker)}`);
      if (!c) continue;   // a chart setup alone is never a pick
      add(c, { family: 'SETUP', tool: 'Options Ideas', points: i.grade === 'A+' ? 15 : 10, line: `${i.setup.label} (grade ${i.grade}${vcp ? ', new setup type' : ''}${i.setup.triggered ? ', triggered' : ''})`, date: day(i.asOf) || day(s.builtAt), id: `oi:${m}:${bare(i.ticker)}:${i.setup.id}`, triggered: !!i.setup.triggered, plan: { trigger: i.setup.trigger, stop: i.setup.stop, target1: i.setup.target1 ?? null, riskPct: i.setup.riskPct } });
      k++;
    }
    return { v: true, asOf: s.builtAt, count: k, staleAfterH: 96 };
  })));

  // ── 5. your book: holdings, logbook, results dates ─────────────────────────
  const heldIN = new Set<string>(), heldUS = new Set<string>();
  let decisions: Record<string, any> = {};
  await source(sources, 'book', 'Your book (holdings + logbook)', 15_000, async () => {
    const [h, d, us] = await Promise.all([
      getUserState('mc_portfolio_holdings').catch(() => null),
      getUserState('mc:decisions:v1').catch(() => null),
      import('@/lib/us-book-store').then((x) => x.readUsBook()).catch(() => null),
    ]);
    for (const t of holdingSymbols(vaultValue(h?.value)).india) heldIN.add(bare(t));
    for (const x of us?.book?.holdings || []) if ((x as any).quantity > 0) heldUS.add(bare(x.ticker));
    const dv = vaultValue(d?.value);
    decisions = dv && typeof dv === 'object' ? dv as Record<string, any> : {};
    return { v: true, asOf: h?.updatedAt ?? null, count: heldIN.size + heldUS.size, note: `${heldIN.size} India + ${heldUS.size} USA holdings` };
  });
  const results: Record<Mkt, Map<string, string>> = { IN: new Map(), US: new Map() };
  await Promise.all((['IN', 'US'] as Mkt[]).map((m) => source(sources, `results-${m}`, `Results calendar ${m === 'IN' ? 'India' : 'USA'}`, 20_000, async () => {
    const { nextResultsMap } = await import('@/lib/options-ideas/server');
    results[m] = await nextResultsMap(m, 10);
    return { v: true, count: results[m].size };
  })));

  // ── 6. score, choose ───────────────────────────────────────────────────────
  for (const c of cands.values()) {
    c.tech = snaps[c.market].get(c.ticker) ?? null;
    if (c.tech?.name && (c.company === c.ticker || !c.company)) c.company = c.tech.name;
    c.held = (c.market === 'IN' ? heldIN : heldUS).has(c.ticker);
    const dec = decisionLookup(decisions as any, c.ticker, c.market);
    c.rejectedOn = dec?.status === 'REJECTED' ? String(dec.date || '').slice(0, 10) || today : null;
    c.resultsOn = results[c.market].get(c.ticker) ?? null;
  }
  const scored = [...cands.values()].filter((c) => c.evidence.some((e) => e.family !== 'SETUP')).map((c) => scoreCandidate(c, today));
  const sent = ((await kvGet<SentMap>(SENT_KEY).catch(() => null)) || {}) as SentMap;
  const sel: Selection = selectPicks(scored, regimes, sent, today);

  const failedCore = sources.filter((s) => s.state === 'failed' && /^(snap-|regime)/.test(s.id));
  const blind = failedCore.some((s) => s.id === 'regime') && failedCore.some((s) => s.id.startsWith('snap-'));
  if (blind) { sel.top = []; sel.addOn = []; }
  const failed = sources.filter((s) => s.state === 'failed');
  const partial = failed.length ? failed.map((s) => s.label).join(', ') : null;

  const rendered = renderEmail({ dateLabel: briefDate(now), today, regimes, sel, sources, candidates: scored.length, tookMs: Date.now() - t0, version: BEST_PICKS_VERSION, siteUrl: SITE });
  const listOf = (s: Scored) => sel.top.some((x) => sentKey(x) === sentKey(s)) ? 'TOP' : sel.addOn.some((x) => sentKey(x) === sentKey(s)) ? 'ADD-ON' : sel.stillValid.includes(s) ? 'STILL VALID' : sel.regimeHeld.includes(s) ? 'REGIME HELD' : sel.rewardedWatch.includes(s) ? 'RAN ALREADY' : sel.nearMiss.includes(s) ? 'NEAR MISS' : sel.newCatalysts.includes(s) ? 'NEW CATALYST' : s.excluded ? 'LEFT OUT' : 'NOT SHOWN';
  const scoredOut = [...scored].sort((a, b) => b.score - a.score).map((s) => ({ market: s.market, ticker: s.ticker, company: s.company, score: s.score, familyCount: s.familyCount, vetoes: s.vetoes, warnings: s.warnings, excluded: s.excluded, breakdown: s.breakdown, list: listOf(s) }));
  const counts = { candidates: scored.length, top: sel.top.length, addOn: sel.addOn.length, stillValid: sel.stillValid.length, nearMiss: sel.nearMiss.length, newCatalysts: sel.newCatalysts.length, regimeHeld: sel.regimeHeld.length, rewarded: sel.rewardedWatch.length, excluded: sel.excluded.length, failedSources: failed.length };

  // the last run is kept for the /best-picks page (dry runs included, so a preview shows there too)
  await kvSet(LAST_KEY, { at: now.toISOString(), dry: !!o.dry, subject: rendered.subject, html: rendered.html, counts, sources, scored: scoredOut, regimes }, 30 * 86400).catch(() => undefined);

  if (o.dry) return { ok: true, dry: true, sent: null, alreadySent: false, partial, quiet: rendered.quiet, channels, counts, sources, rendered, scored: scoredOut };

  const key = `best-picks:${today}${o.force ? `:force:${now.getTime()}` : ''}`;
  const res = await notifyOwnerOnce(key, { subject: rendered.subject, text: rendered.text, html: rendered.html, topic: 'BRIEF', idempotencyKey: key }, 10);
  const alreadySent = res === null;
  const delivered = !!res && (res.email === 'sent' || res.telegram === 'sent');
  if (delivered) await kvSet(SENT_KEY, nextSent(sent, sel, today), 120 * 86400).catch(() => undefined);
  return { ok: delivered || alreadySent, dry: false, sent: res, alreadySent, partial, quiet: rendered.quiet, channels, counts, sources };
}
