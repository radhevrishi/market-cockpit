// ═══════════════════════════════════════════════════════════════════════════
// LET AI CHOOSE THE THESIS TYPE — pure part.                          (zzz837)
//
// The owner: "lot of confirmations needed — I thought the AI option would be
// there and all details you will get". 60 names sat at CONFIRMATION REQUIRED
// only because their type was an automatic nearest fit, and the fix was a
// picker clicked 60 times. This module is the pure half of the one-click AI
// answer (no network, no clock unless given one):
//
//   aiTypeInputIndia / aiTypeInputUs   the facts AI may see, from a row
//   buildAiTypePrompt                  the prompt (never any market data)
//   validateAiTypeAnswer               strict JSON validator
//   toAiTypeRecord                     the record that is stored
//   aiPattern                          the type as the status engine reads it
//   aiTypePlan / confirmationBreakdown who to ask, and the sub-reasons
//
// RULES. AI runs only on a click. Only A / B / F / G or 'undecided'. Every
// number the AI cites must appear in what it was given, else the answer is
// rejected and the name stays provisional. AI never sees the share price or
// anything derived from it. A user's own choice always wins over AI.
// ═══════════════════════════════════════════════════════════════════════════

import { ABFG_META, manualPattern, type AbfgPattern, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import { thesisFor } from './ledger';
import { VAR_LABEL, type VarKey } from './taxonomy';
import { provisionalInputs } from './provisional-type';
import { usTypeInputs } from '@/lib/us-thesis/us-type';

export const AI_TYPE_PROMPT_VERSION = 'ai-type-v1';
export const AI_TYPES: readonly AbfgPattern[] = ['A', 'B', 'F', 'G'];
export type AiTypeAnswer = AbfgPattern | 'undecided';

export interface AiTypeInput {
  market: 'IN' | 'US';
  symbol: string;
  name: string;
  industry: string;
  description: string;
  figures: Array<{ label: string; value: string }>;
  provisional: { type: AbfgPattern | null; weak: boolean; because: string; checks: Array<{ label: string; state: string }> } | null;
}

export interface AiTypeNotApplicable { check: string; why: string; instead: string }
export interface AiTypeResult {
  type: AiTypeAnswer;
  reason: string;
  justification: string[];
  notApplicable: AiTypeNotApplicable[];
}
/** What is stored, per name, beside the picker's own map. */
export interface AiTypeRecord extends AiTypeResult {
  source: 'ai';
  /** YYYY-MM-DD */
  at: string;
  model: string;
  promptVersion: string;
  /** Set when the model's answer failed validation and was turned into 'undecided'. */
  rejected?: string;
}

// ── what the AI may see ──────────────────────────────────────────────────
const MARKET_WORDS = /\b(share price|stock price|price target|target price|market cap\w*|valuation|p\/e|pe ratio)\b/i;
const ADVICE_WORDS = /\b(buy|sell|accumulate|upside|downside)\b/i;
const clip = (v: unknown, n: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sg = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;

/** Keep only what is safe to send: strings clipped, market-data words dropped. */
export function sanitizeAiTypeInput(raw: any): AiTypeInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const market = raw.market === 'US' ? 'US' : raw.market === 'IN' ? 'IN' : null;
  const symbol = clip(raw.symbol, 24).toUpperCase();
  if (!market || !/^[A-Z0-9&.\-]{1,24}$/.test(symbol)) return null;
  const okLine = (s: string) => !!s && !MARKET_WORDS.test(s);
  const figures = (Array.isArray(raw.figures) ? raw.figures : []).slice(0, 30)
    .map((f: any) => ({ label: clip(f?.label, 80), value: clip(f?.value, 240) }))
    .filter((f: { label: string; value: string }) => f.label && f.value && okLine(`${f.label} ${f.value}`));
  const p = raw.provisional && typeof raw.provisional === 'object' ? raw.provisional : null;
  const pt = p && AI_TYPES.includes(p.type) ? (p.type as AbfgPattern) : null;
  return {
    market, symbol,
    name: clip(raw.name, 120) || symbol,
    industry: okLine(clip(raw.industry, 200)) ? clip(raw.industry, 200) : '',
    description: clip(raw.description, 1500).split(/(?<=[.;·])\s+/).filter((s) => !MARKET_WORDS.test(s)).join(' '),
    figures,
    provisional: p ? {
      type: pt, weak: !!p.weak, because: clip(p.because, 500),
      checks: (Array.isArray(p.checks) ? p.checks : []).slice(0, 24)
        .map((c: any) => ({ label: clip(c?.label, 80), state: clip(c?.state, 160) }))
        .filter((c: { label: string; state: string }) => c.label && okLine(`${c.label} ${c.state}`)),
    } : null,
  };
}

const label = (k: VarKey): string => (k === 'price' ? 'Product realisation (selling terms)' : VAR_LABEL[k]);

/** The checks of each type, by name (weight 2 and above), for the prompt and the validator. */
export function checkLabelsOf(t: AbfgPattern): string[] {
  return thesisFor(t).variables.filter((v) => v.weight >= 2).map((v) => label(v.key));
}

// ── the industry text a row carries ──────────────────────────────────────
function checksOf(row: any): Array<{ label: string; state: string }> {
  const st: any[] = Array.isArray(row?.assessment?.structuralStates) ? row.assessment.structuralStates : [];
  return st.slice(0, 24).map((s) => ({
    label: String(s?.label || s?.key || ''),
    state: `${String(s?.state || 'unknown').replace(/_/g, ' ')}${s?.figure ? ` — ${clip(s.figure, 100)}` : ''}`,
  })).filter((c) => c.label);
}
function provisionalOf(row: any) {
  const p = row?.pattern;
  if (!p) return null;
  return { type: (AI_TYPES.includes(p.pattern) ? p.pattern : null) as AbfgPattern | null, weak: !!p.weak, because: clip(p.because, 500), checks: checksOf(row) };
}

export function aiTypeInputIndia(row: any): AiTypeInput {
  const g = row?.graded && typeof row.graded === 'object' ? row.graded : {};
  const s = row?.summary && typeof row.summary === 'object' ? row.summary : {};
  const inp = provisionalInputs(row?.graded, row?.summary);
  const f: Array<{ label: string; value: string }> = [];
  const add = (l: string, v: string | null) => { if (v) f.push({ label: l, value: v }); };
  if (inp.salesY != null) add('Revenue growth, year on year (%)', sg(inp.salesY));
  if (inp.earnY != null) add('Earnings growth, year on year (%)', sg(inp.earnY));
  if (inp.patCur != null) add('Profit after tax, this period (crore)', String(inp.patCur));
  if (inp.patPrev != null) add('Profit after tax, a year earlier (crore)', String(inp.patPrev));
  const opm = numOrNull(g.opm_pct), opmP = numOrNull(g.opm_prev_pct);
  if (opm != null) add('Operating margin (%)', String(opm));
  if (opmP != null) add('Operating margin a year earlier (%)', String(opmP));
  if (inp.opmChange != null) add('Operating margin change (points)', sg(inp.opmChange));
  if (inp.cfo != null) add('Cash conversion (operating cash flow / profit, times)', String(inp.cfo));
  if (inp.roce != null) add('ROCE (%)', String(inp.roce));
  if (inp.orderG != null) add('Order book / order intake growth, year on year (%)', sg(inp.orderG));
  if (inp.bookToBill != null) add('Book-to-bill (times)', String(inp.bookToBill));
  const ob = s.order_book || {};
  if (ob.closing_value) add('Order book, closing', clip(ob.closing_value, 120));
  if (inp.capacityWords) add('Capacity facts filed', clip(inp.capacityWords, 200));
  const projects: any[] = Array.isArray(s.capex_projects) ? s.capex_projects.slice(0, 3) : [];
  for (const p of projects) {
    const line = [p?.name, p?.capex_amount || p?.amount, p?.capacity_added].filter(Boolean).join(' · ');
    if (line) add('Capex project', clip(line, 200));
  }
  return sanitizeAiTypeInput({
    market: 'IN', symbol: row?.symbol,
    name: g.name || g.company || g.company_name || s.company || row?.symbol,
    industry: [g.industry, g.sector].filter(Boolean).join(' / '),
    description: inp.businessWords,
    figures: f, provisional: provisionalOf(row),
  })!;
}

export function aiTypeInputUs(row: any): AiTypeInput {
  const inp = usTypeInputs(row?.graded ?? null, row?.sec ?? null);
  const s = row?.summary && typeof row.summary === 'object' ? row.summary : {};
  const f: Array<{ label: string; value: string }> = [];
  const add = (l: string, v: string | null) => { if (v) f.push({ label: l, value: v }); };
  if (inp) {
    if (inp.salesY != null) add('Revenue growth, year on year (%)', sg(inp.salesY));
    if (inp.earnY != null) add('Earnings growth, year on year (%)', sg(inp.earnY));
    if (inp.niCur != null) add('Net income, this period (USD million)', String(inp.niCur));
    if (inp.niPrev != null) add('Net income, a year earlier (USD million)', String(inp.niPrev));
    if (inp.opmChange != null) add('Operating margin change (points)', sg(inp.opmChange));
    if (inp.cfoToPat != null) add('Cash conversion (operating cash flow / net income, times)', String(inp.cfoToPat));
    if (inp.rpoY != null) add('Filed backlog (remaining performance obligations) growth, year on year (%)', sg(inp.rpoY));
  }
  const roce = row?.sec?.roce?.pct;
  if (typeof roce === 'number' && Number.isFinite(roce)) add('ROCE (%)', String(roce));
  return sanitizeAiTypeInput({
    market: 'US', symbol: row?.symbol,
    name: row?.sec?.company || row?.graded?.company || row?.graded?.name || row?.symbol,
    industry: inp?.sicDescription || '',
    description: [inp?.sicDescription, s.headline, s.verdict_line].filter(Boolean).join(' · '),
    figures: f, provisional: provisionalOf(row),
  })!;
}

// ── the prompt ───────────────────────────────────────────────────────────
const TYPE_WORDS: Record<AbfgPattern, string> = {
  A: 'earnings and margins improving as volume, capacity or operating leverage builds, and the improvement has runway.',
  B: 'orders booked today become revenue later; the order book or order intake drives the story.',
  F: 'a sudden jump in profit whose cause and repeatability must be checked.',
  G: 'steady, cash-backed compounding with little visible change to point at.',
};
export function aiTypeSystemPrompt(): string {
  const types = AI_TYPES.map((t) => `${t} · ${ABFG_META[t].name}: ${TYPE_WORDS[t]} Its checks: ${checkLabelsOf(t).join('; ')}.`).join('\n');
  return [
    'You classify what kind of business story a listed company is, from the facts given. You choose ONE thesis type, or say you cannot.',
    'Allowed answers: A, B, F, G, or undecided. Nothing else.',
    types,
    'Rules:',
    '- Judge the business, not the provisional label. The provisional type is an automatic guess from thresholds; overrule it when the business says otherwise.',
    '- Use ONLY facts in the input. Never add a number, quote or fact that is not in it. Never compute a new number.',
    '- justification: 2 or 3 short items, each a figure or a phrase copied from the input that supports your choice.',
    '- reason: ONE plain sentence saying what kind of business this is and why the type fits.',
    '- not_applicable: checks of your chosen type that do not exist for this business (for example capacity utilisation for an exchange, IT services, media or retail), each with the alternative to use instead (volume growth, order book, same-store growth, users, take rate, and so on). Use the check names exactly as listed for your chosen type. Empty list if all apply.',
    '- If the facts are too thin or do not clearly point at one type, answer undecided with a reason. Guessing is worse than undecided.',
    '- You are given no market data and must not use any. Give no recommendation.',
  ].join('\n');
}

export function buildAiTypePrompt(input: AiTypeInput): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Company: ${input.name} (${input.symbol}, ${input.market === 'US' ? 'US-listed' : 'India-listed'})`);
  if (input.industry) lines.push(`Industry: ${input.industry}`);
  lines.push(`Business description on file: ${input.description || 'none on file'}`);
  lines.push('Filed figures:');
  if (input.figures.length) for (const f of input.figures) lines.push(`- ${f.label}: ${f.value}`);
  else lines.push('- none on file');
  const p = input.provisional;
  if (p) {
    lines.push(`Provisional automatic type: ${p.type || 'none'}${p.weak ? ' (weak fit)' : ''}. ${p.because}`);
    if (p.checks.length) {
      lines.push('Its check results so far:');
      for (const c of p.checks) lines.push(`- ${c.label}: ${c.state}`);
    }
  } else lines.push('Provisional automatic type: none.');
  return { system: aiTypeSystemPrompt(), user: lines.join('\n') };
}

/** The tool schema the route asks the model to fill. */
export const AI_TYPE_TOOL = {
  name: 'file_thesis_type',
  description: 'File the thesis type for this company, or undecided.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['A', 'B', 'F', 'G', 'undecided'] },
      reason: { type: 'string', description: 'One plain sentence.' },
      justification: { type: 'array', items: { type: 'string' }, description: '2 or 3 figures or quotes taken from the input.' },
      not_applicable: {
        type: 'array',
        // zzz1050: every field listed (instead may be null; an empty list when all checks apply) so OpenAI can enforce it in strict mode
        items: { type: 'object', properties: { check: { type: 'string' }, why: { type: 'string' }, instead: { type: ['string', 'null'] } }, required: ['check', 'why', 'instead'] },
      },
    },
    required: ['type', 'reason', 'justification', 'not_applicable'],
  },
} as const;

/** The whole text the model sees, for the no-price test and the number check. */
export function promptText(input: AiTypeInput): string {
  const p = buildAiTypePrompt(input);
  return `${p.system}\n${p.user}`;
}

// ── numbers ──────────────────────────────────────────────────────────────
/** Every number in a text, sign dropped, thousands separators removed. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text || '').matchAll(/(?<![A-Za-z0-9])[-+−]?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/[,+\-−]/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
const decimalsOf = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Numbers in `text` that do not appear (exactly, or as a rounding) in `source`. */
export function inventedNumbers(text: string, source: string): string[] {
  const have = numbersIn(source);
  const bad: string[] = [];
  for (const m of String(text || '').matchAll(/(?<![A-Za-z0-9])[-+−]?\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/[,+\-−]/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const d = decimalsOf(raw);
    if (!have.some((h) => h === n || round(h, d) === n)) bad.push(m[0]);
  }
  return bad;
}

/** The facts that the model was given, as one text (for the number check). */
export function sourceTextOf(input: AiTypeInput): string {
  const p = input.provisional;
  return [
    input.name, input.industry, input.description,
    ...input.figures.map((f) => `${f.label}: ${f.value}`),
    p?.because || '', ...(p?.checks || []).map((c) => `${c.label}: ${c.state}`),
  ].join('\n');
}

// ── the validator ────────────────────────────────────────────────────────
export type AiTypeValidation = { ok: true; result: AiTypeResult; dropped: string[] } | { ok: false; errors: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Strict: rejects a type outside A/B/F/G/undecided, a missing reason, a
 *  decided answer without 2-3 justifications, and any number (in the reason
 *  or the justification) that is not in the input. */
export function validateAiTypeAnswer(raw: unknown, input: AiTypeInput): AiTypeValidation {
  const errors: string[] = [];
  let o: any = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return { ok: false, errors: ['the answer is not valid JSON'] }; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['the answer is not an object'] };
  const type = typeof o.type === 'string' ? o.type.trim() : '';
  if (!(AI_TYPES as readonly string[]).includes(type) && type !== 'undecided') errors.push(`type "${clip(type, 20)}" is not one of A, B, F, G or undecided`);
  const reason = typeof o.reason === 'string' ? o.reason.replace(/\s+/g, ' ').trim() : '';
  if (!reason) errors.push('no reason given');
  else if (reason.length > 400) errors.push('the reason is longer than one sentence');
  const jRaw: unknown[] = Array.isArray(o.justification) ? o.justification : [];
  const justification = jRaw.map((j) => (typeof j === 'string' ? j.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  if (jRaw.length && justification.length !== jRaw.length) errors.push('justification items must be text');
  if (type !== 'undecided' && (justification.length < 2 || justification.length > 3)) errors.push('a decided type needs 2 or 3 justification items');
  const src = sourceTextOf(input);
  const bad = inventedNumbers([reason, ...justification].join('\n'), src);
  if (bad.length) errors.push(`numbers not in the facts given: ${Array.from(new Set(bad)).slice(0, 4).join(', ')}`);
  if (MARKET_WORDS.test([reason, ...justification].join(' ')) || ADVICE_WORDS.test([reason, ...justification].join(' '))) errors.push('the answer talks about market data or a recommendation');
  if (errors.length) return { ok: false, errors };
  // not_applicable: only checks that belong to the chosen type; anything else is dropped, not trusted.
  const dropped: string[] = [];
  const notApplicable: AiTypeNotApplicable[] = [];
  if (type !== 'undecided' && Array.isArray(o.not_applicable ?? o.notApplicable)) {
    const names = checkLabelsOf(type as AbfgPattern);
    for (const n of (o.not_applicable ?? o.notApplicable) as any[]) {
      const c = typeof n?.check === 'string' ? n.check.trim() : '';
      const hit = names.find((x) => norm(x) === norm(c));
      const why = typeof n?.why === 'string' ? clip(n.why, 200) : '';
      const instead = typeof n?.instead === 'string' ? clip(n.instead, 200) : '';
      if (!hit || !why || inventedNumbers(`${why} ${instead}`, src).length) { dropped.push(c || '(blank)'); continue; }
      notApplicable.push({ check: hit, why, instead });
    }
  }
  return { ok: true, dropped, result: { type: type as AiTypeAnswer, reason, justification, notApplicable } };
}

/** A rejected or unparsable answer becomes 'undecided' — never a guess. */
export function toAiTypeRecord(v: AiTypeValidation, meta: { model: string; at: string }): AiTypeRecord {
  const base = { source: 'ai' as const, at: meta.at.slice(0, 10), model: meta.model, promptVersion: AI_TYPE_PROMPT_VERSION };
  if (v.ok) return { ...base, ...v.result };
  return { ...base, type: 'undecided', reason: 'The AI answer could not be used, so the type stays provisional.', justification: [], notApplicable: [], rejected: v.errors.join('; ') };
}

// ── how the status engine reads it ───────────────────────────────────────
export function isAiTypeRecord(r: any): r is AiTypeRecord {
  return !!r && r.source === 'ai' && (AI_TYPES as readonly string[]).includes(r.type);
}

export function aiTypeLine(rec: { at: string }): string {
  return `type chosen by AI on ${rec.at} — change it with the picker`;
}

/** An AI-chosen type reads as a CONFIRMED type (fit 'manual') so the status
 *  engine judges the name on its evidence. It is labelled as AI's. */
export function aiPattern(p: AbfgPattern, rec: AiTypeRecord): AbfgResult & { source: 'ai'; aiAt: string; aiModel: string } {
  const m = manualPattern(p);
  return {
    ...m,
    because: `Thesis ${aiTypeLine(rec)}. ${rec.reason}`,
    source: 'ai', aiAt: rec.at, aiModel: rec.model,
  };
}

// ── who to ask ───────────────────────────────────────────────────────────
export interface AiTypePlan { names: string[]; undecided: string[]; total: number; label: string }
const pl = (n: number) => (n === 1 ? '' : 's');
export function aiTypeLabel(n: number): string {
  return `✨ Let AI choose types — ${n} name${pl(n)} (uses AI · ${n} call${pl(n)}, only on click)`;
}
export const RESOLVE_ALL_LABEL = '✨ Resolve everything with AI (types + missing details)';
export const RESOLVE_ALL_NOTE = 'AI runs only on click. Types first, then the missing details. One call per name; Stop works.';
export const CARD_AI_TYPE_LABEL = '✨ Let AI choose the type';

/** Provisional (nearest-fit) names with no type of the user's or AI's. */
export function aiTypePlan(rows: any[], types: Record<string, string>, ai: Record<string, AiTypeRecord | undefined>): AiTypePlan {
  const names: string[] = [], undecided: string[] = [];
  for (const r of rows) {
    const k = String(r?.symbol || '').toUpperCase();
    if (!k || r.state === 'loading') continue;
    if (types[k]) continue;
    if (r?.pattern?.fit !== 'nearest') continue;
    if (ai[k]?.type === 'undecided') { undecided.push(r.symbol); continue; }
    names.push(r.symbol);
  }
  return { names, undecided, total: names.length, label: aiTypeLabel(names.length) };
}

// ── CONFIRMATION REQUIRED, split into sub-reasons ────────────────────────
export interface ConfirmationBreakdown { needsType: number; needsEvidence: number; both: number; other: number; total: number; line: string }

/** A name needs a type when its type is still an automatic nearest fit; it
 *  needs evidence when the mechanism evidence is missing or incomplete. */
export function confirmationBreakdown(rows: any[]): ConfirmationBreakdown {
  let t = 0, e = 0, b = 0, o = 0, n = 0;
  for (const r of rows) {
    const a = r?.assessment;
    if (!a || a.status !== 'CONFIRMATION_REQUIRED') continue;
    n++;
    const needsType = r?.pattern?.fit === 'nearest';
    const ev = a.verdict?.evidence;
    const cov = a.verdict?.coverage;
    const needsEvidence = ev === 'INCOMPLETE' || ev === 'UNCHECKED' || ev === 'NOT_CONTRADICTED' || ev === 'PARTIALLY_CONFIRMED' || (cov && cov.confirmed === 0);
    if (needsType && needsEvidence) b++;
    else if (needsType) t++;
    else if (needsEvidence) e++;
    else o++;
  }
  const line = `needs type: ${t} · needs evidence: ${e} · both: ${b}${o ? ` · other: ${o}` : ''}`;
  return { needsType: t, needsEvidence: e, both: b, other: o, total: n, line };
}

export const CONFIRMATION_BANNER = 'Names on a provisional type stay at CONFIRMATION REQUIRED until the type is confirmed. Instead of opening the picker 60 times, let AI choose the types — one click, uses AI only on click; each card says what AI chose and you can change it any time.';
