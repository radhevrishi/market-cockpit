// ═══════════════════════════════════════════════════════════════════════════
// zzz1233 — SETTLE "NEEDS VERIFICATION" ON TRANSFORMATIONAL GAINERS.
//
// The owner (7 Nov 2026): "many are not verified and the AI does not do
// anything — make sure all get verified and accepted or rejected based on
// our criteria." A held-back row is now decided, in this order:
//   1. criteria alone (no document needed): a buyback / debt financing, a
//      share issue, or the company being the BUYER is not a business event →
//      REJECTED, with the rule that decided it.
//   2. the company's own filing is read (PDF / SEC document) and an AI check
//      answers: does THIS document show the labelled business event? It must
//      quote a sentence that is really in the document — a quote that is not
//      found turns the answer into REJECTED (not supported).
//   3. a filing that cannot be read → NOT VERIFIABLE (tried again after 3
//      days, at most 3 times); it stays off the ranked board.
// ACCEPTED rows join the board with "✓ verified" and the quote; REJECTED and
// NOT VERIFIABLE rows are listed with the reason. Stored per row id.
// ═══════════════════════════════════════════════════════════════════════════
import { KIND_WORD, evidenceChain, researchNeeded, type TgItem, type TgKind } from './core';

export type VerifyVerdict = 'ACCEPTED' | 'REJECTED' | 'NOT_VERIFIABLE';
export interface TgVerify { verdict: VerifyVerdict; reason: string; kind: TgKind | null; quote: string | null; by: 'rules' | 'ai'; at: string; tries: number }

export const VERIFY_KEY = (id: string) => `transformational:verify:v1:${id}`;
export const VERIFY_DAY_KEY = (d = new Date()) => `transformational:verify:day:v1:${d.toISOString().slice(0, 10)}`;
export const VERIFY_DAILY_MAX = 80;
export const VERIFY_PER_CALL = 15;
const KINDS: TgKind[] = ['ORDERS', 'CAPACITY', 'APPROVAL', 'NEW_BUSINESS', 'STRATEGIC', 'GUIDANCE', 'RESULTS', 'TURNAROUND'];

/** Step 1 — decided by the criteria alone. */
export function ruleVerdict(x: Pick<TgItem, 'needsCheck'>, now = new Date()): TgVerify | null {
  const n = String(x.needsCheck || '');
  const at = now.toISOString().slice(0, 10);
  const rej = (reason: string): TgVerify => ({ verdict: 'REJECTED', reason, kind: null, quote: null, by: 'rules', at, tries: 1 });
  if (/^a buyback or financing/.test(n)) return rej('Not a business event: a buyback or financing changes the share count or the balance sheet, not future earnings from the business.');
  if (/^a share issue|^the text is about raising money/.test(n)) return rej('Not a business event: a share issue raises money (and dilutes) — it is not an order, approval, capacity or deal.');
  if (/^the company is the buyer/.test(n)) return rej('Not a business event: the company is buying (a purchase order it placed), not winning an order.');
  return null;
}

/** Is the quote really in the document (spaces and case ignored)? */
export function quoteInText(quote: string | null | undefined, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹$%.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(String(quote || ''));
  if (q.length < 25) return false;
  const t = norm(text);
  if (t.includes(q)) return true;
  // long quotes: any 12-word run of it
  const w = q.split(' ');
  for (let i = 0; i + 12 <= w.length; i += 4) if (t.includes(w.slice(i, i + 12).join(' '))) return true;
  return false;
}

export const VERIFY_TOOL = {
  name: 'record_verification',
  description: 'Decide whether the company document shows the labelled business event.',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['verdict', 'kind', 'quote', 'reason'],
    properties: {
      verdict: { type: 'string', enum: ['ACCEPTED', 'REJECTED'] },
      kind: { type: ['string', 'null'], enum: [...KINDS, null], description: 'The event type the document really shows (may differ from the label), or null.' },
      quote: { type: ['string', 'null'], maxLength: 400, description: 'One sentence copied EXACTLY from the document that shows the event. Null when rejected.' },
      reason: { type: 'string', maxLength: 240, description: 'One plain sentence: why accepted or rejected.' },
    },
  },
} as const;

export const VERIFY_SYSTEM = `You check one claim against a company's own filing. The claim is that the filing shows a specific BUSINESS EVENT that can change future earnings.
Accept ONLY when the document itself states a completed or binding event of that type for THIS company:
- Orders / contracts: an order, contract, letter of award or supply agreement RECEIVED by the company (not placed by it), ideally with a value.
- Capacity / production: capacity or a plant actually commissioned / production started (not planned, not a board approval to invest).
- Approval / qualification: a regulatory or customer approval actually received.
- New business / segment: a new product line, segment or first commercial sale actually started.
- Strategic deal: an acquisition, merger, JV, licence or strategic investment agreed or completed.
- Guidance raised: management raising its outlook.
- Earnings inflection / turnaround: reported results showing it.
Reject: share issues, buybacks, financing, intimations of meetings, routine updates, plans and intentions, the company buying something, documents that do not mention the event.
The quote must be copied word for word from the document. Plain simple English.`;

export function verifyUserText(x: Pick<TgItem, 'company' | 'ticker' | 'kind' | 'headline' | 'needsCheck'>, doc: string): string {
  return [
    `Company: ${x.company} (${x.ticker})`,
    `Labelled event: ${KIND_WORD[x.kind]}`,
    `Headline we showed: ${x.headline}`,
    `Why it was held back: ${x.needsCheck}`,
    '--- DOCUMENT (the company\'s filing, may be cut) ---',
    doc.slice(0, 14_000),
  ].join('\n');
}

/** The model's answer → a verification, checked against the document. */
export function parseVerifyAnswer(d: any, doc: string, now = new Date(), tries = 1): TgVerify | null {
  if (!d || (d.verdict !== 'ACCEPTED' && d.verdict !== 'REJECTED')) return null;
  const at = now.toISOString().slice(0, 10);
  const kind: TgKind | null = KINDS.includes(d.kind) ? d.kind : null;
  const reason = String(d.reason || '').slice(0, 240) || (d.verdict === 'ACCEPTED' ? 'The filing shows the event.' : 'The filing does not show the event.');
  if (d.verdict === 'ACCEPTED') {
    if (!quoteInText(d.quote, doc)) return { verdict: 'REJECTED', reason: 'Not supported: the AI could not quote a sentence that is really in the filing.', kind, quote: null, by: 'ai', at, tries };
    return { verdict: 'ACCEPTED', reason, kind, quote: String(d.quote).slice(0, 400), by: 'ai', at, tries };
  }
  return { verdict: 'REJECTED', reason, kind, quote: null, by: 'ai', at, tries };
}

/** A stored NOT VERIFIABLE is tried again after 3 days, at most 3 tries. */
export function dueForRetry(v: TgVerify | null | undefined, now = Date.now()): boolean {
  if (!v) return true;
  if (v.verdict !== 'NOT_VERIFIABLE') return false;
  return v.tries < 3 && now - Date.parse(`${v.at}T00:00:00Z`) >= 3 * 86_400_000;
}

/** The board's view of a held-back row after verification. */
export function applyVerify(x: TgItem, v: TgVerify | null | undefined): TgItem & { verify?: TgVerify | null } {
  if (!x.needsCheck || !v) return { ...x, verify: v ?? null };
  if (v.verdict === 'ACCEPTED') {
    const y: TgItem = {
      ...x, needsCheck: null, kind: v.kind || x.kind, quote: v.quote || x.quote, evidence: 'official',
      signals: [...x.signals, `✓ verified from the filing (${v.by === 'ai' ? 'AI check' : 'rules'})`],
    };
    return { ...y, research: researchNeeded(y), chain: evidenceChain(y), verify: v };
  }
  return { ...x, verify: v };
}
