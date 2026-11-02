// ═══════════════════════════════════════════════════════════════════════════
// zzz1214 — Transformation Radar: WHO said it, and in what tone.
//
// A concall transcript mixes management answers with analyst questions. The radar used to score the whole text, so an
// analyst's "you mentioned that commercial production is sometime in FY28, if I got it right?" became the company's
// proof (UNIMECH, 2 Nov 2026). This module splits a transcript into speaker turns and gives each speaker a role:
//   MANAGEMENT — named in the call's management list, introduced as CEO / CFO / MD / director, or answering questions
//   ANALYST    — introduced by the moderator ("next question is from the line of …"), or mostly asking questions
//   MODERATOR  — the operator / host
// Only management text is scored. A presentation or results release is the company's own document (COMPANY).
// documentTone() reads the tone of the management text, because the exchange feed's sentiment is often "data pending".
// Pure — no I/O.
// ═══════════════════════════════════════════════════════════════════════════

export type SpeakerRole = 'MANAGEMENT' | 'ANALYST' | 'MODERATOR' | 'UNKNOWN';
export interface Turn { speaker: string; role: SpeakerRole; start: number; end: number }
export interface TranscriptParse {
  /** true when at least 4 speaker turns and at least one management turn were found */
  ok: boolean;
  turns: Turn[];
  roles: Record<string, SpeakerRole>;
  managementText: string;
  analystChars: number;
}

const LABEL_RE = /(^|[.?!"”’)\]]\s|\s)((?:(?:Mr|Ms|Mrs|Dr|Shri)\.?\s)?(?:[A-Z]\.\s?)?[A-Z][A-Za-z'’-]{1,24}(?:\s(?:[A-Z]\.\s?)?[A-Z][A-Za-z'’-]{0,24}){0,3})(?:\s\([^)]{1,60}\))?(?:\s\[\d{1,2}:\d{2}(?::\d{2})?\])?\s?:\s/g;
const NOT_A_SPEAKER = new Set(['subject', 'symbol', 'date', 'note', 'notes', 'source', 'management', 'moderator team', 'participants', 'page', 'scrip code',
  'sub', 'ref', 'website', 'email', 'e-mail', 'tel', 'phone', 'fax', 'cin', 'address', 'time', 'venue', 'agenda', 'disclaimer', 'q', 'a', 'answer', 'question',
  'for', 'to', 'yes', 'no', 'and', 'the', 'thank you', 'okay', 'ok', 'so', 'sir', 'madam', 'revenue', 'ebitda', 'pat', 'total', 'india', 'outlook', 'guidance']);
const MOD_RE = /^(?:moderator|operator|coordinator|host)$/i;
const MGMT_TITLE_RE = /\b(?:managing director|joint managing director|chairman|chairperson|chief executive|ceo|cfo|chief financial|chief operating|coo|whole[- ]time director|executive director|director|founder|promoter|president|vice president|head|company secretary|investor relations|cmd|group cfo)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/^(?:mr|ms|mrs|dr|shri)\.?\s+/, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const firstLast = (s: string) => { const w = norm(s).split(' ').filter(Boolean); return w.length ? `${w[0]} ${w[w.length - 1]}` : ''; };

/** Names listed as management in the header ("MANAGEMENT: MR. A – MD, …") and in the host's introduction. */
function managementNames(text: string): Set<string> {
  const out = new Set<string>();
  const head = text.slice(0, 12_000);
  const block = head.match(/\bmanagement\s*:\s*([\s\S]{0,1500}?)(?:\bmoderator\s*:|\banalysts?\s*:|\bpage \d|\bmoderator\b)/i);
  if (block) {
    for (const m of block[1].matchAll(/(?:MR|MS|MRS|DR|SHRI)\.?\s+([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3})/gi)) out.add(firstLast(m[1]));
  }
  // "led by the Managing Director – Mr. Amit Rambhia; CFO … – Mr. Nitesh Savla"
  for (const s of head.split(/(?<=[.;])\s/)) {
    if (!MGMT_TITLE_RE.test(s) || /\bquestion\b/i.test(s)) continue;
    for (const m of s.matchAll(/\b(?:Mr|Ms|Mrs|Dr|Shri)\.?\s+([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})/g)) out.add(firstLast(m[1]));
  }
  out.delete('');
  return out;
}

/** Names the moderator introduces as questioners ("next question is from the line of X from Y"). */
function analystNames(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:question|questions)\s+(?:is\s+|comes\s+|will\s+be\s+|we\s+have\s+)?(?:from|by)\s+(?:the\s+line\s+of\s+)?(?:Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+)?([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})/g;
  for (const m of text.matchAll(re)) out.add(firstLast(m[1]));
  out.delete('');
  return out;
}

const isQuestion = (s: string) => /\?|\bmy (?:first|second|third|next|last|follow[- ]up)? ?question\b|\bwanted to (?:ask|understand|check)\b|\b(?:can|could) you (?:please )?(?:share|explain|comment|tell|throw|give|help)\b|\bif I got it right\b|\bjust to clarify\b/i.test(s);

export function parseTranscript(text: string): TranscriptParse {
  const t = String(text || '');
  const raw: Array<{ label: string; at: number; bodyAt: number }> = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(t))) {
    const label = m[2].trim();
    const key = norm(label);
    if (!key || NOT_A_SPEAKER.has(key) || key.length < 2 || /^[a-z]$/.test(key)) continue;
    if (/^(?:q[1-4]|h[12]|fy)\b/i.test(label)) continue;
    raw.push({ label, at: m.index + m[1].length, bodyAt: m.index + m[0].length });
  }
  // a label counts as a speaker when it recurs, is the moderator, or is a named participant
  const mg = managementNames(t), an = analystNames(t);
  const count = new Map<string, number>();
  for (const r of raw) count.set(firstLast(r.label), (count.get(firstLast(r.label)) || 0) + 1);
  const isSpeaker = (l: string) => { const k = firstLast(l); return MOD_RE.test(l) || (count.get(k) || 0) >= 2 || mg.has(k) || an.has(k); };
  const labels = raw.filter((r) => isSpeaker(r.label));
  const turns: Turn[] = labels.map((r, i) => ({ speaker: r.label, role: 'UNKNOWN' as SpeakerRole, start: r.bodyAt, end: i + 1 < labels.length ? labels[i + 1].at : t.length }));

  // roles: listed / introduced names first, then question-heavy speakers are analysts
  const roles: Record<string, SpeakerRole> = {};
  const qShare = new Map<string, { q: number; n: number }>();
  for (const tu of turns) {
    const k = firstLast(tu.speaker);
    const s = qShare.get(k) || { q: 0, n: 0 };
    s.n++; if (isQuestion(t.slice(tu.start, Math.min(tu.end, tu.start + 1500)))) s.q++;
    qShare.set(k, s);
  }
  // the host who introduces management ("We have with us …", "hand over the call") is a moderator, not management
  const hostKeys = new Set<string>();
  for (const tu of turns.slice(0, 4)) {
    const body = t.slice(tu.start, Math.min(tu.end, tu.start + 900));
    if (/\b(?:we have (?:the )?pleasure of having|we have with us|on behalf of|i (?:would like to|will now) hand (?:over )?the (?:call|conference))\b/i.test(body) && !mg.has(firstLast(tu.speaker))) hostKeys.add(firstLast(tu.speaker));
  }
  for (const tu of turns) {
    const k = firstLast(tu.speaker);
    if (roles[tu.speaker]) { tu.role = roles[tu.speaker]; continue; }
    const s = qShare.get(k) || { q: 0, n: 1 };
    const role: SpeakerRole = MOD_RE.test(tu.speaker) || (hostKeys.has(k) && s.n <= 3) ? 'MODERATOR'
      : mg.has(k) ? 'MANAGEMENT'
      : an.has(k) ? 'ANALYST'
      : s.q / s.n >= 0.5 ? 'ANALYST'
      : 'MANAGEMENT';
    roles[tu.speaker] = role; tu.role = role;
  }
  const mgmtTurns = turns.filter((x) => x.role === 'MANAGEMENT');
  const managementText = mgmtTurns.map((x) => t.slice(x.start, x.end)).join(' ').trim();
  const analystChars = turns.filter((x) => x.role === 'ANALYST').reduce((n, x) => n + (x.end - x.start), 0);
  return { ok: turns.length >= 4 && mgmtTurns.length >= 1 && managementText.length >= 1500, turns, roles, managementText, analystChars };
}

/** Who said a quote: the turn whose text contains it. */
export function speakerOf(quote: string, text: string, p: TranscriptParse): { role: SpeakerRole; speaker: string | null } {
  const q = String(quote || '').replace(/\s+/g, ' ').trim();
  if (!q || !p.turns.length) return { role: 'UNKNOWN', speaker: null };
  const at = text.indexOf(q.slice(0, Math.min(60, q.length)));
  if (at < 0) return { role: 'UNKNOWN', speaker: null };
  const tu = p.turns.find((x) => at >= x.start && at < x.end);
  return tu ? { role: tu.role, speaker: tu.speaker } : { role: 'UNKNOWN', speaker: null };
}

// ── tone of the management text ─────────────────────────────────────────────
export type DocTone = 'POSITIVE' | 'MIXED' | 'NEGATIVE' | 'NEUTRAL';
const POS_RE = /\b(?:record|highest[- ]ever|all[- ]time high|strong(?:er)? (?:growth|demand|quarter|performance|order)|robust|healthy (?:demand|order|growth|pipeline)|margin expansion|margins? (?:expanded|improved)|ahead of (?:plan|schedule|guidance)|raised? (?:our |the )?guidance|upgrad\w+ (?:our |the )?guidance|beat|tailwinds?|accelerat\w+|order (?:inflow|book) (?:at|of) (?:a )?record|ramp(?:ing|ed)? up|commenced commercial production|won (?:a |an |the )?(?:order|contract)|new customers? (?:added|won|onboarded)|visibility|confident)\b/gi;
const NEG_RE = /\b(?:declin\w+|de-?growth|pressure|weak(?:er|ness)?|headwinds?|lower(?:ed)? (?:our |the )?guidance|cut (?:our |the )?guidance|(?:net )?loss(?:es)?|delay(?:ed|s)?|slow(?:down|er)|muted|subdued|challenging|soft(?:er|ness)? demand|destock\w*|inventory correction|write[- ]?(?:off|down)|impairment|disappoint\w*|below (?:our )?expectations)\b/gi;

export function documentTone(text: string): { tone: DocTone; pos: number; neg: number } {
  const t = String(text || '');
  const pos = (t.match(POS_RE) || []).length, neg = (t.match(NEG_RE) || []).length;
  const tone: DocTone = pos + neg < 3 ? 'NEUTRAL'
    : pos >= 2 * neg && pos - neg >= 3 ? 'POSITIVE'
    : neg >= 1.5 * pos && neg - pos >= 2 ? 'NEGATIVE'
    : 'MIXED';
  return { tone, pos, neg };
}

/** The radar's sentiment tier from the document tone, used when the exchange feed has none (DATA PENDING). */
export function tierFromTone(tone: DocTone): string {
  return tone === 'POSITIVE' ? 'BULLISH' : tone === 'MIXED' ? 'MIXED_POSITIVE' : tone === 'NEGATIVE' ? 'MIXED_NEGATIVE' : 'NEUTRAL';
}
