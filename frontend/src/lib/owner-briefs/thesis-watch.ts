// zzz914 — PORTFOLIO THESIS WATCH (India, weekday morning), composed by the app. Pure: holdings + stored research in,
// brief out. Unit-tested with made-up tickers only.
//
// It reads NO price and NO market value — the same rule as the thesis engine and Exit Radar: a thesis changes on
// evidence, never on a price move. (A static test checks this file.) It is not a second thesis engine either:
//   • the thesis STATUS comes from the evidence ledger the Portfolio Catalysts engine already wrote (lib/thesis/*);
//   • the owner's own invalidation triggers (`mc:thesis:v1`) are checked with the same rules as the Thesis page
//     (margin / cash / growth on the reported figures; a price trigger is not checked here and is counted);
//   • guidance raised / cut comes from the guidance archive (Postgres intel_event), results from the graded bench.
// Only developments NEW since the last run are reported as changes (state kept in Redis), so a quiet morning sends
// one line instead of a repeat.
import { bareTicker, num, esc, link, emailShell, plainText } from './common';

export type Verdict = 'IMPAIRED' | 'WATCH' | 'STRENGTHENED' | 'INTACT';
export type Leg = 'margin' | 'cash' | 'growth' | 'structural evidence' | 'forward guidance' | 'earnings' | 'governance';

export interface ThesisTriggerLike { id?: string; kind: string; label?: string; threshold?: number | null; note?: string }
export interface ThesisLike { thesis?: string; triggers?: ThesisTriggerLike[] }
export interface LedgerView { period: string | null; status: string | null; because: string | null; readAt: string | null }
export interface GuidanceEventLike { id: string; type: string; date: string | null; headline: string | null; url?: string | null }
export interface ResultLike { filingDate: string; salesYoy: number | null; profitYoy: number | null; url?: string | null }

export interface HoldingInput {
  ticker: string; company?: string | null;
  thesis?: ThesisLike | null;
  /** reported figures (graded bench / bench card / screener): opm_pct, opm_prev_pct, cfo_to_pat_ratio, annual_cfo_pat, net_profit_yoy_pct */
  figures?: any | null;
  ledger?: LedgerView | null;
  guidance?: GuidanceEventLike[];
  result?: ResultLike | null;
}

export interface HoldingState { status: string | null; period: string | null; breaches: string[]; events: string[]; filing: string | null }
export interface WatchState { at: string; holdings: Record<string, HoldingState> }

export interface Change { leg: Leg; what: string; kind: 'impaired' | 'watch' | 'strengthened'; url?: string | null }
export interface HoldingResult {
  ticker: string; company: string; verdict: Verdict; changes: Change[]; stillFlagged: string[];
  action: string; hasThesis: boolean; priceTriggersSkipped: number; noEvidence: boolean;
}

// ── the owner's triggers (same rules as app/(dashboard)/thesis/page.tsx, minus price) ─────────────────────────────
export type TriggerEval = { status: 'ok' | 'breach' | 'manual' | 'unknown' | 'not-checked'; reason: string };
export function evaluateTrigger(t: ThesisTriggerLike, f: any | null | undefined): TriggerEval {
  if (t.kind === 'custom') return { status: 'manual', reason: t.note?.trim() || 'manual check' };
  if (t.kind === 'price') return { status: 'not-checked', reason: 'price triggers are not checked by this brief' };
  if (!f) return { status: 'unknown', reason: 'no reported figures on file' };
  if (t.kind === 'margin') {
    const cur = num(f.opm_pct), prev = num(f.opm_prev_pct);
    if (cur == null || prev == null) return { status: 'unknown', reason: 'no margin data' };
    const thr = num(t.threshold);
    if (cur < prev && (thr == null || cur < thr)) return { status: 'breach', reason: `operating margin ${cur.toFixed(1)}% vs ${prev.toFixed(1)}% before${thr == null ? '' : ` (your floor ${thr}%)`}` };
    return { status: 'ok', reason: `operating margin ${cur.toFixed(1)}%` };
  }
  if (t.kind === 'cash') {
    const thr = num(t.threshold) ?? 0.6;
    let r = num(f.cfo_to_pat_ratio);
    if (r == null && Array.isArray(f.annual_cfo_pat) && f.annual_cfo_pat.length) r = num(f.annual_cfo_pat[f.annual_cfo_pat.length - 1]);
    if (r == null) return { status: 'unknown', reason: 'no cash-conversion data' };
    return r < thr ? { status: 'breach', reason: `cash from operations / profit ${r.toFixed(2)}, below your floor ${thr}` } : { status: 'ok', reason: `CFO/PAT ${r.toFixed(2)}` };
  }
  if (t.kind === 'growth') {
    const thr = num(t.threshold) ?? 0;
    const g = num(f.net_profit_yoy_pct);
    if (g == null) return { status: 'unknown', reason: 'no profit-growth data' };
    return g < thr ? { status: 'breach', reason: `profit ${g >= 0 ? '+' : ''}${g.toFixed(1)}% year on year, below your floor ${thr}%` } : { status: 'ok', reason: `profit ${g.toFixed(1)}% YoY` };
  }
  return { status: 'unknown', reason: '' };
}
const legOfTrigger = (k: string): Leg => (k === 'margin' ? 'margin' : k === 'cash' ? 'cash' : 'growth');
const trigKey = (t: ThesisTriggerLike) => String(t.id || `${t.kind}:${t.label ?? ''}:${t.threshold ?? ''}`);

const IMPAIRED_STATUS = new Set(['BROKEN']);
const WATCH_STATUS = new Set(['WEAKENING', 'NEGATIVE_EXPECTATION_GAP']);
const STRONG_STATUS = new Set(['STRENGTHENING', 'POSITIVE_EXPECTATION_GAP']);
const word = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const RANK: Record<Verdict, number> = { IMPAIRED: 0, WATCH: 1, STRENGTHENED: 2, INTACT: 3 };

/** Pure: one holding's verdict from what is NEW since `prev`. */
export function assessHolding(h: HoldingInput, prev: HoldingState | null | undefined): { result: HoldingResult; state: HoldingState } {
  const ticker = bareTicker(h.ticker);
  const changes: Change[] = []; const still: string[] = [];
  const triggers = Array.isArray(h.thesis?.triggers) ? h.thesis!.triggers! : [];
  const breaches: string[] = [];
  let priceSkipped = 0;
  for (const t of triggers) {
    const ev = evaluateTrigger(t, h.figures);
    if (ev.status === 'not-checked') priceSkipped++;
    if (ev.status !== 'breach') continue;
    const k = trigKey(t); breaches.push(k);
    const quote = t.label ? `“${t.label}”` : `your ${t.kind} trigger`;
    if (prev?.breaches?.includes(k)) still.push(`${quote} still breached`);
    else changes.push({ leg: legOfTrigger(t.kind), kind: 'impaired', what: `Your invalidation trigger ${quote} is breached: ${ev.reason}.` });
  }

  const L = h.ledger || null;
  const st = L?.status ? String(L.status).toUpperCase() : null;
  const statusMoved = !!st && (st !== (prev?.status ?? null) || (L?.period ?? null) !== (prev?.period ?? null));
  if (st && statusMoved) {
    const because = L?.because ? ` — ${L.because}` : '';
    const at = L?.period ? ` (${L.period})` : '';
    if (IMPAIRED_STATUS.has(st)) changes.push({ leg: 'structural evidence', kind: 'impaired', what: `Thesis engine marks it ${word(st)}${at}${because}.` });
    else if (WATCH_STATUS.has(st)) changes.push({ leg: 'structural evidence', kind: 'watch', what: `Thesis engine marks it ${word(st)}${at}${because}.` });
    else if (STRONG_STATUS.has(st)) changes.push({ leg: 'structural evidence', kind: 'strengthened', what: `Thesis engine marks it ${word(st)}${at}${because}.` });
  } else if (st && IMPAIRED_STATUS.has(st)) still.push(`thesis engine: ${word(st)}`);

  const seen = new Set(prev?.events || []);
  const events = [...(prev?.events || [])];
  for (const g of h.guidance || []) {
    if (!g?.id || seen.has(g.id)) continue;
    events.push(g.id); seen.add(g.id);
    const ty = String(g.type || '').toUpperCase();
    const head = g.headline ? `: ${g.headline}` : '';
    const when = g.date ? ` (${String(g.date).slice(0, 10)})` : '';
    if (ty === 'GUIDANCE_RAISED') changes.push({ leg: 'forward guidance', kind: 'strengthened', what: `Guidance raised${when}${head}.`, url: g.url });
    else if (ty === 'GUIDANCE_LOWERED' || ty === 'WITHDRAWAL') changes.push({ leg: 'forward guidance', kind: 'watch', what: `Guidance ${ty === 'WITHDRAWAL' ? 'withdrawn' : 'cut'}${when}${head}.`, url: g.url });
  }

  const r = h.result || null;
  let filing = prev?.filing ?? null;
  if (r?.filingDate && (!filing || r.filingDate > filing)) {
    filing = r.filingDate;
    const pg = r.profitYoy, sg = r.salesYoy;
    const fig = [sg != null ? `sales ${sg >= 0 ? '+' : ''}${sg.toFixed(0)}%` : null, pg != null ? `profit ${pg >= 0 ? '+' : ''}${pg.toFixed(0)}%` : null].filter(Boolean).join(', ');
    if (pg != null && pg < 0) changes.push({ leg: 'earnings', kind: 'watch', what: `Result filed ${r.filingDate}: ${fig || 'figures not on file'}. Profit fell year on year.`, url: r.url });
  }

  const kinds = changes.map((c) => c.kind);
  let verdict: Verdict = kinds.includes('impaired') ? 'IMPAIRED' : kinds.includes('watch') ? 'WATCH' : kinds.includes('strengthened') ? 'STRENGTHENED' : 'INTACT';
  // a thesis already broken / a trigger already breached stays flagged, even with nothing new
  if (verdict === 'INTACT' && still.length) verdict = 'IMPAIRED';
  const ownTrigger = changes.some((c) => c.kind === 'impaired' && c.what.startsWith('Your invalidation trigger'));
  const action = verdict === 'IMPAIRED' ? (ownTrigger ? 'exit-watch: your own invalidation trigger is breached — re-read why you own it' : changes.length ? 're-underwrite: check the evidence behind the change' : 'already flagged — re-underwrite if not done')
    : verdict === 'WATCH' ? 're-check at the next result'
      : verdict === 'STRENGTHENED' ? 'consider adding — only after re-reading the thesis'
        : 'no action';
  const noEvidence = !L?.status && !h.figures;
  return {
    result: { ticker, company: String(h.company || ticker), verdict, changes, stillFlagged: still, action, hasThesis: !!(h.thesis && (h.thesis.thesis || triggers.length)), priceTriggersSkipped: priceSkipped, noEvidence },
    state: { status: st, period: L?.period ?? null, breaches, events: events.slice(-60), filing },
  };
}

export function rankResults(rs: HoldingResult[]): HoldingResult[] {
  return [...rs].sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || b.changes.length - a.changes.length || a.ticker.localeCompare(b.ticker));
}

const VCOLOR: Record<Verdict, string> = { IMPAIRED: '#b91c1c', WATCH: '#b45309', STRENGTHENED: '#047857', INTACT: '#374151' };
const VLABEL: Record<Verdict, string> = { IMPAIRED: 'THESIS CHANGE (IMPAIRED)', WATCH: 'WATCH', STRENGTHENED: 'THESIS CHANGE (STRENGTHENED)', INTACT: 'INTACT' };

export interface WatchBriefInput { results: HoldingResult[]; dateLabel: string; source: string; prevAt: string | null; firstRun: boolean; partial?: string | null; usDropped?: number }
export interface Brief { subject: string; text: string; html: string; oneLine: boolean }

export function composeThesisWatch(x: WatchBriefInput): Brief {
  const subject = `${x.partial ? 'PARTIAL — ' : ''}Portfolio Thesis Watch — ${x.dateLabel}`;
  const rs = rankResults(x.results);
  const n = rs.length;
  const by = (v: Verdict) => rs.filter((r) => r.verdict === v);
  const withNews = rs.filter((r) => r.changes.length);
  const still = rs.filter((r) => !r.changes.length && r.stillFlagged.length);
  const counts = `${by('IMPAIRED').length} impaired, ${by('WATCH').length} watch, ${by('STRENGTHENED').length} strengthened, ${by('INTACT').length} intact`;
  const footer = `review prompts, not investment advice · India book, ${n} holdings · ${x.dateLabel}`;
  const priceSkipped = rs.reduce((a, r) => a + r.priceTriggersSkipped, 0);
  const noThesis = rs.filter((r) => !r.hasThesis).length;
  const noEv = rs.filter((r) => r.noEvidence).map((r) => r.ticker);

  if (!x.partial && !x.firstRun && !withNews.length) {
    const line = `No new thesis drift across ${n} India holdings since ${x.prevAt ? x.prevAt.slice(0, 10) : 'the last run'}.${still.length ? ` Still flagged: ${still.map((r) => r.ticker).join(', ')}.` : ''}`;
    return { subject, text: line, html: emailShell(subject, `<p>${esc(line)}</p><p style="color:#6b7280;font-size:12px">${esc(footer)}</p>`), oneLine: true };
  }
  const take = x.partial ? `Partial brief: ${x.partial}` : `${withNews.length} of ${n} holdings have something new: ${counts}.`;

  const T: string[] = [take, ''];
  if (x.firstRun) T.push('First run: today sets the baseline, so standing states are shown as new.', '');
  const H: string[] = [`<p style="margin:0 0 10px"><b>${esc(take)}</b></p>`];
  if (x.firstRun) H.push('<p style="color:#6b7280;margin:0 0 8px">First run: today sets the baseline, so standing states are shown as new.</p>');

  const changed = withNews.filter((r) => r.verdict !== 'WATCH');
  const watch = withNews.filter((r) => r.verdict === 'WATCH');
  if (changed.length) {
    T.push('CHANGES'); H.push('<h3 style="font-size:15px;margin:12px 0 4px">Changes</h3>');
    for (const r of changed) {
      T.push(`${r.ticker} (${r.company}) — ${VLABEL[r.verdict]}`);
      for (const c of r.changes) T.push(`  - [${c.leg}] ${c.what}`);
      T.push(`  Review: ${r.action}`, '');
      H.push(`<div style="border-left:3px solid ${VCOLOR[r.verdict]};padding:2px 0 2px 8px;margin:0 0 10px"><div><b>${esc(r.ticker)}</b> (${esc(r.company)}) — <span style="color:${VCOLOR[r.verdict]};font-weight:600">${VLABEL[r.verdict]}</span></div><ul style="margin:2px 0;padding-left:18px">`
        + r.changes.map((c) => `<li><i>${esc(c.leg)}</i>: ${esc(c.what)}${c.url ? ` ${link(c.url, 'source')}` : ''}</li>`).join('')
        + `</ul><div style="color:#374151">Review: ${esc(r.action)}</div></div>`);
    }
  }
  if (watch.length) {
    T.push('WATCH'); H.push('<h3 style="font-size:15px;margin:12px 0 4px">Watch</h3><ul style="margin:0 0 10px;padding-left:18px">');
    for (const r of watch) {
      const line = r.changes.map((c) => `[${c.leg}] ${c.what}`).join(' ');
      T.push(`- ${r.ticker}: ${line}`);
      H.push(`<li><b>${esc(r.ticker)}</b>: ${r.changes.map((c) => `<i>${esc(c.leg)}</i>: ${esc(c.what)}${c.url ? ` ${link(c.url, 'source')}` : ''}`).join(' ')}</li>`);
    }
    T.push(''); H.push('</ul>');
  }
  if (still.length) {
    const s = still.map((r) => `${r.ticker} (${r.stillFlagged.join('; ')})`).join(', ');
    T.push(`Still flagged, already reported: ${s}`, ''); H.push(`<p style="margin:0 0 8px"><b>Still flagged, already reported:</b> ${esc(s)}</p>`);
  }
  const intact = by('INTACT').map((r) => r.ticker);
  if (intact.length) { T.push(`Intact (${intact.length}): ${intact.join(', ')}`, ''); H.push(`<p style="margin:0 0 8px;color:#374151"><b>Intact (${intact.length}):</b> ${esc(intact.join(', '))}</p>`); }
  const notes: string[] = [];
  if (noThesis) notes.push(`${noThesis} holding${noThesis === 1 ? " has" : "s have"} no written thesis or triggers yet (Thesis page).`);
  if (priceSkipped) notes.push(`${priceSkipped} price trigger${priceSkipped === 1 ? " is" : "s are"} not checked here — this brief reads no price.`);
  if (noEv.length) notes.push(`No stored evidence or figures yet for: ${noEv.join(', ')}.`);
  if (x.usDropped) notes.push(`${x.usDropped} US-listed name${x.usDropped === 1 ? "" : "s"} left out (India only).`);
  notes.push(`Source: ${x.source}.`);
  T.push(...notes, '', footer);
  H.push(`<p style="color:#4b5563;font-size:12px">${notes.map(esc).join('<br>')}</p><p style="color:#6b7280;font-size:12px">${esc(footer)}</p>`);
  return { subject, text: plainText(T.join('\n')), html: emailShell(subject, H.join('')), oneLine: false };
}
