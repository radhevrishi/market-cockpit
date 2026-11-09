// ═══════════════════════════════════════════════════════════════════════════
// zzz1231 — FOUNDER-LED? MOAT? for the Conviction Beats names the Quality
// Preset keeps (India + USA).
//
// The owner (9 Nov 2026): "add founder-led or not … only for preset-on, and
// whether the company has a moat and what moat. You can add AI if required."
//
// Neither fact is in any feed we read, so it is one short AI read per company,
// stored for 180 days (it changes rarely), at most 10 a call and 40 a day
// (CB_FM_DAILY_MAX). The model answers from what it knows about the company
// and must say UNKNOWN when it is not sure — a guess is worse than a blank.
// The card labels it as an AI read. Pure: no fetch, no KV here.
// ═══════════════════════════════════════════════════════════════════════════
import type { MetricCell } from './cb-metric-view';

export type FounderLed = 'FOUNDER_LED' | 'FAMILY_PROMOTER' | 'PROFESSIONAL' | 'UNKNOWN';
export type MoatStrength = 'WIDE' | 'NARROW' | 'NONE' | 'UNKNOWN';
export type MoatKind = 'brand' | 'switching costs' | 'network effects' | 'cost advantage' | 'scale' | 'regulatory licence' | 'patents / IP'
  | 'customer approvals' | 'distribution' | 'process know-how' | 'location / resources';
export const MOAT_KINDS: readonly MoatKind[] = ['brand', 'switching costs', 'network effects', 'cost advantage', 'scale', 'regulatory licence', 'patents / IP',
  'customer approvals', 'distribution', 'process know-how', 'location / resources'];

export interface FounderMoat {
  founder: FounderLed;
  founderWho: string | null;      // e.g. "Rajesh Gupta, co-founder, is MD"
  moat: MoatStrength;
  moatKinds: MoatKind[];
  moatWhy: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  at: string;                      // ISO date of the read
}

export const CB_FM_DAILY_MAX = 40;
export const CB_FM_PER_CALL = 10;
export const CB_FM_TTL_S = 180 * 86_400;
export const cbFmKey = (m: 'IN' | 'US', t: string) => `cb-fm:v1:${m}:${String(t).toUpperCase()}`;
export const cbFmDayKey = (d = new Date()) => `cb-fm:day:v1:${d.toISOString().slice(0, 10)}`;

export const FM_TOOL = {
  name: 'record_founder_and_moat',
  description: 'Record whether the company is run by its founder and whether it has a durable competitive advantage (moat).',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['founder', 'founder_who', 'moat', 'moat_kinds', 'moat_why', 'confidence'],
    properties: {
      founder: { type: 'string', enum: ['FOUNDER_LED', 'FAMILY_PROMOTER', 'PROFESSIONAL', 'UNKNOWN'],
        description: 'FOUNDER_LED = a founder is CEO / MD / executive chair today. FAMILY_PROMOTER = run by the founding family\'s later generation. PROFESSIONAL = run by hired managers. UNKNOWN when not sure.' },
      founder_who: { type: ['string', 'null'], maxLength: 120, description: 'Who, in a few words (name and role), or null.' },
      moat: { type: 'string', enum: ['WIDE', 'NARROW', 'NONE', 'UNKNOWN'] },
      moat_kinds: { type: 'array', maxItems: 3, items: { type: 'string', enum: [...MOAT_KINDS] } },
      moat_why: { type: ['string', 'null'], maxLength: 220, description: 'One plain sentence: what stops a competitor taking this business, or null.' },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    },
  },
} as const;

export const FM_SYSTEM = `You classify a listed company on two points for an investor: (1) is it run by its founder today, (2) does it have a moat — a lasting advantage that stops competitors taking its business or profits.
Rules:
- Answer from what you know about this company. If you are not sure, say UNKNOWN and confidence LOW. Never invent names.
- A moat must be specific and durable: switching costs, long customer approvals (aerospace, pharma, auto OEM), a regulatory licence, a cost advantage from scale or process, a brand that commands a price, network effects, patents, distribution reach. Being a "leader", growing fast or having good margins is NOT by itself a moat.
- Contract manufacturers, traders, commodity producers and project contractors usually have NONE or NARROW.
- Plain simple English, short.`;

export function fmUserText(x: { ticker: string; company?: string | null; industry?: string | null; market: 'IN' | 'US' }): string {
  return [
    `Company: ${x.company || x.ticker} (${x.market === 'IN' ? 'NSE' : 'US'}: ${x.ticker})`,
    x.industry ? `Industry: ${x.industry}` : null,
  ].filter(Boolean).join('\n');
}

const FOUNDER = new Set<FounderLed>(['FOUNDER_LED', 'FAMILY_PROMOTER', 'PROFESSIONAL', 'UNKNOWN']);
const MOAT = new Set<MoatStrength>(['WIDE', 'NARROW', 'NONE', 'UNKNOWN']);
const CONF = new Set(['HIGH', 'MEDIUM', 'LOW']);
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** The model's tool answer → a stored read, or null when it does not fit the schema. */
export function parseFmAnswer(d: any, at = new Date().toISOString().slice(0, 10)): FounderMoat | null {
  if (!d || !FOUNDER.has(d.founder) || !MOAT.has(d.moat) || !CONF.has(d.confidence)) return null;
  const kinds = Array.isArray(d.moat_kinds) ? (d.moat_kinds.filter((k: any) => (MOAT_KINDS as readonly string[]).includes(k)) as MoatKind[]).slice(0, 3) : [];
  return {
    founder: d.founder, founderWho: d.founder === 'UNKNOWN' ? null : str(d.founder_who, 120),
    moat: d.moat, moatKinds: d.moat === 'NONE' || d.moat === 'UNKNOWN' ? [] : kinds, moatWhy: str(d.moat_why, 220),
    confidence: d.confidence, at,
  };
}

const AI_NOTE = 'AI read from what the model knows about the company (not from a filing) — check before relying on it.';

export function founderCell(fm: FounderMoat | null | undefined): MetricCell {
  const label = 'FOUNDER';
  if (!fm) return { label, text: '…', tone: 'none', title: 'Not read yet — read by AI for names the Quality Preset keeps (40 a day).' };
  const text = fm.founder === 'FOUNDER_LED' ? 'founder-led' : fm.founder === 'FAMILY_PROMOTER' ? 'family promoter' : fm.founder === 'PROFESSIONAL' ? 'professional mgmt' : 'not known';
  return {
    label, text: `${text}${fm.confidence === 'LOW' && fm.founder !== 'UNKNOWN' ? ' (unsure)' : ''}`,
    tone: fm.founder === 'FOUNDER_LED' ? 'good' : fm.founder === 'UNKNOWN' ? 'none' : 'warn',
    title: `${fm.founderWho ? `${fm.founderWho}. ` : ''}Confidence ${fm.confidence.toLowerCase()} · read ${fm.at}. ${AI_NOTE}`,
  };
}

export function moatCell(fm: FounderMoat | null | undefined): MetricCell {
  const label = 'MOAT';
  if (!fm) return { label, text: '…', tone: 'none', title: 'Not read yet — read by AI for names the Quality Preset keeps (40 a day).' };
  const word = fm.moat === 'WIDE' ? 'wide' : fm.moat === 'NARROW' ? 'narrow' : fm.moat === 'NONE' ? 'none' : 'not known';
  return {
    label, text: `${word}${fm.moatKinds.length ? ` · ${fm.moatKinds.join(', ')}` : ''}`,
    tone: fm.moat === 'WIDE' ? 'good' : fm.moat === 'NARROW' ? 'warn' : fm.moat === 'NONE' ? 'bad' : 'none',
    title: `${fm.moatWhy || 'No reason given.'} Confidence ${fm.confidence.toLowerCase()} · read ${fm.at}. ${AI_NOTE}`,
  };
}
