// zzz841 — Thesis ledger + owner portfolio tags. Pure functions plus a thin
// localStorage adapter (SSR-safe, every access in try/catch, validated on read,
// capped, cross-tab aware).
//
// RULES: nothing here accepts a price or a move. A status change needs a
// written reason. Entering the ledger is a human act: addFromRadarItem only
// PRE-FILLS a draft; the UI saves it after the owner has reviewed it.

import {
  EVIDENCE_LABEL, LINK_LABEL, THESIS_STATUS_LABEL,
  type ChangeLogRow, type EvidenceStatus, type FalsePositiveReason, type LedgerEntry, type PortfolioTag, type PostMortem,
  type RadarItem, type ThesisStatus, type ThesisVersion, type CatalystMaturity,
} from './multibagger-radar-types';

export const LEDGER_KEY = 'mc:mb-ledger:v1';
export const TAGS_KEY = 'mc:mb-tags:v1';
export const LEDGER_EVENT = 'mc:mb-ledger:updated';
export const LEDGER_CAP = 200;
export const NOT_ESTABLISHED = 'Not established';

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

const STATUSES = Object.keys(THESIS_STATUS_LABEL) as ThesisStatus[];
export const OWNER_TAGS = ['CORE', 'SATELLITE', 'WATCH'] as const;
export type OwnerTag = (typeof OWNER_TAGS)[number];

export const TEXT_FIELDS = [
  'thesis', 'catalyst', 'whyNow', 'mechanism', 'evidence', 'assumptions', 'whatMustHappen', 'nextProofPoint',
  'whatWouldConfirm', 'whatWouldWeaken', 'whatWouldBreak', 'catalystDuration', 'earningsLink',
  'managementCommentary', 'valuationContext', 'technicalContext',
] as const;
export type LedgerTextField = (typeof TEXT_FIELDS)[number];

export const FIELD_LABEL: Record<LedgerTextField, string> = {
  thesis: 'Thesis', catalyst: 'Catalyst', whyNow: 'Why now', mechanism: 'Mechanism', evidence: 'Evidence',
  assumptions: 'Assumptions', whatMustHappen: 'What must happen', nextProofPoint: 'Next proof point',
  whatWouldConfirm: 'What would confirm it', whatWouldWeaken: 'What would weaken it', whatWouldBreak: 'What would break it',
  catalystDuration: 'Catalyst duration', earningsLink: 'Earnings link', managementCommentary: 'Management commentary',
  valuationContext: 'Valuation context', technicalContext: 'Technical context (timing only)',
};

const isoDay = (now: string | Date): string => {
  const d = typeof now === 'string' ? new Date(now) : now;
  return Number.isNaN(d.getTime()) ? String(now).slice(0, 10) : d.toISOString().slice(0, 10);
};
const nz = (s: unknown): string => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return !t || /^(unknown|n\/a|na|none|null|undefined|-|—|not assessed|not established)$/i.test(t) ? NOT_ESTABLISHED : t;
};
export const slug = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── Pure: build / validate ───────────────────────────────────────────────
export function ledgerIdOf(item: Pick<RadarItem, 'ticker' | 'company' | 'id'>): string {
  return `${slug(item.ticker || item.company || 'UNKNOWN')}::${slug(item.id)}`;
}

// ── Qualified candidates only ────────────────────────────────────────────
export interface Qualification { qualified: boolean; blockers: string[] }
const NEVER_KINDS = new Set(['CORPORATE_ACTION', 'DISPROVED_RUMOUR', 'PRICE_MOVE', 'ANALYST_CHANGE', 'MEDIA_NARRATIVE', 'SECTOR_COMMENTARY']);
const NEVER_CLASSES = new Set(['CORPORATE_ACTION', 'DISPROVED_RUMOUR', 'PRICE_RESPONSE', 'ANALYST', 'NARRATIVE', 'SECTOR_COMMENTARY', 'TECHNICAL']);
const CORP_ACTION_TEXT = /\b(?:dividend|stock split|share split|bonus (?:issue|shares?)|record date|ex-?date|ex-dividend)\b/i;
const blank = (x: unknown): boolean => typeof x !== 'string' || !x.trim() || /^(unknown|n\/a|none|not established|not assessed)$/i.test(x.trim());

/**
 * Pure gate. A radar item may enter the ledger only when ledgerEligible is not false AND: company identified, catalyst
 * identified, evidence available (developing or better), mechanism identified, earnings link near-direct or better (or a
 * strategically structural mechanism), a clear next proof, and no contradiction. Dividend / split / record-date /
 * corporate-action / disproved-rumour items never qualify. Price is not an input. Returns every blocker found.
 */
export function isLedgerQualified(item: RadarItem | null | undefined): Qualification {
  const b: string[] = [];
  if (!item || typeof item !== 'object') return { qualified: false, blockers: ['No radar item supplied.'] };
  const push = (t: string) => { if (!b.includes(t)) b.push(t); };
  if (item.ledgerEligible === false) {
    const given = Array.isArray(item.ledgerBlockers) ? item.ledgerBlockers.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (given.length) given.forEach(push); else push('The radar marked this item as not eligible for the ledger.');
  }
  if (NEVER_KINDS.has(item.kind) || (item.eventClass && NEVER_CLASSES.has(item.eventClass)) || item.bucket === 'CORPORATE_ACTION' || item.bucket === 'NOISE' || item.bucket === 'TECHNICAL') {
    push('Corporate actions, disproved rumours, price, analyst, media and technical items never enter the ledger.');
  }
  if (CORP_ACTION_TEXT.test(item.event || '') && !(item.financialTransmission === 'DIRECT' || item.link === 'DIRECT')) push('A dividend, split or record-date event is not an earnings thesis.');
  if (blank(item.company) || item.company === 'Unnamed company') push('No company is named.');
  if (blank(item.event)) push('No catalyst is identified.');
  const ev = item.evidence?.status;
  if (!(ev === 'CONFIRMED' || ev === 'STRONG' || ev === 'DEVELOPING')) push('Evidence is not yet at developing or better.');
  if (blank(item.mechanism) || item.mechanismStatus === 'NOT_ESTABLISHED' || item.mechanismStatus === 'ASSUMED' && item.mechanismSpecific === false) push('No company-specific mechanism is identified.');
  const link = item.financialTransmission ?? item.link;
  const linkGood = link === 'DIRECT' || link === 'NEAR_DIRECT';
  const structural = (item.bucket === 'MULTIBAGGER' || item.bucket === 'BOTTLENECK') && link === 'INDIRECT' && (ev === 'CONFIRMED' || ev === 'STRONG' || ev === 'DEVELOPING');
  if (!(linkGood || structural)) push('The earnings link is below near-direct and the catalyst is not strategically structural.');
  if (blank(item.proof?.what) || /^monitor\b/i.test(item.proof?.what || '')) push('No clear next proof point.');
  const contradicted = ev === 'DISPROVED' || item.mechanismStatus === 'CONTRADICTED' || item.earningsImpactStatus === 'CONTRADICTED'
    || item.catalystMaturity === 'BROKEN' || item.thesisIntegrity?.action === 'REJECTED'
    || (item.catalystChain || []).some((l) => l.status === 'CONTRADICTED');
  if (contradicted) push('The evidence contradicts the thesis or the classification failed a check.');
  return { qualified: b.length === 0, blockers: b };
}

const evWordOf = (s: string): EvidenceStatus | null => {
  const m = /^\s*(confirmed|strong|developing|hypothesis|disproved)/i.exec(s || '');
  return m ? (m[1].toUpperCase() as EvidenceStatus) : null;
};

/** Pre-fills every ledger field from a radar item. Unknowns become 'Not established'. Owner edits before saving. */
export function addFromRadarItem(item: RadarItem, now: string | Date): LedgerEntry {
  const assumed = (item.chain || []).filter((c) => c.status === 'assumed').map((c) => c.text).filter(Boolean);
  const when = item.proof?.when ? item.proof.when : 'timing not stated';
  const dur = item.duration;
  return {
    id: ledgerIdOf(item),
    ticker: item.ticker || item.company,
    company: item.company,
    thesis: nz(item.whyItMatters),
    dateIdentified: isoDay(now),
    catalyst: nz(item.event),
    whyNow: nz(item.whyItMatters),
    mechanism: nz(item.mechanism),
    evidence: item.evidence ? `${EVIDENCE_LABEL[item.evidence.status]} - ${nz(item.evidence.sourceLabel)}. ${nz(item.evidence.why)}` : NOT_ESTABLISHED,
    assumptions: assumed.length ? assumed.join(' | ') : NOT_ESTABLISHED,
    whatMustHappen: nz(item.proof?.what),
    nextProofPoint: item.proof?.what ? `${item.proof.what} (${when})` : NOT_ESTABLISHED,
    whatWouldConfirm: nz(item.proof?.what),
    whatWouldWeaken: NOT_ESTABLISHED,
    whatWouldBreak: item.breakConditions?.length ? item.breakConditions.join(' | ') : NOT_ESTABLISHED,
    catalystDuration: dur ? `${nz(dur.label)}${dur.evidence ? ` - ${nz(dur.evidence)}` : ''}${dur.basis === 'type' ? ' (by event type)' : ''}` : NOT_ESTABLISHED,
    earningsLink: item.link ? `${LINK_LABEL[item.link]}. ${nz(item.financialImpact)}` : NOT_ESTABLISHED,
    managementCommentary: NOT_ESTABLISHED,
    valuationContext: nz(item.valuationContext),
    technicalContext: nz(item.technical?.note),
    lastReview: null,
    status: 'EARLY',
    history: [],
    fromRadarId: item.id,
    versions: [{
      version: 1, date: isoDay(now), thesis: nz(item.whyItMatters), catalystMaturity: item.catalystMaturity ?? null,
      evidenceStatus: item.evidence?.status ?? null, whatChanged: 'Initial thesis recorded',
      statusChange: { from: null, to: 'EARLY' }, reason: 'Added to the ledger after owner review',
      evidenceRefs: [item.evidence?.sourceLabel, item.sourceUrl].filter((x): x is string => !!x && !!x.trim()),
    }],
    firstDiscovered: item.firstDiscovered ?? isoDay(now),
    firstPrimaryConfirmation: item.firstPrimaryConfirmation ?? null,
    firstFinancialConfirmation: item.firstFinancialConfirmation ?? null,
    firstMaterialEarningsImpact: item.firstMaterialEarningsImpact ?? null,
    upgradeCondition: nz(item.upgradeTrigger),
    downgradeCondition: nz(item.downgradeTrigger),
    postMortem: null,
  };
}

export type AddResult = { ok: true; entry: LedgerEntry } | { ok: false; blockers: string[] };
/** The only path from a radar item into the ledger. Refuses unqualified items and returns the blockers. */
export function addQualifiedEntry(item: RadarItem, now: string | Date): AddResult {
  const q = isLedgerQualified(item);
  if (!q.qualified) return { ok: false, blockers: q.blockers };
  return { ok: true, entry: addFromRadarItem(item, now) };
}
/** Qualify, then save (existing ids are updated, never duplicated). */
export function saveQualifiedFromRadar(item: RadarItem, now: string | Date, storage: StorageLike | null = defaultStorage()): AddResult & { list?: LedgerEntry[] } {
  const r = addQualifiedEntry(item, now);
  if (!r.ok) return r;
  return { ...r, list: saveEntry(r.entry, storage) };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/** Tolerant validator: returns a clean entry or null. Missing text fields become 'Not established'. */
export function validateEntry(x: unknown): LedgerEntry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = str(o.id).trim();
  const ticker = str(o.ticker).trim();
  if (!id || !ticker) return null;
  const status = STATUSES.includes(o.status as ThesisStatus) ? (o.status as ThesisStatus) : 'EARLY';
  const e: Record<string, unknown> = {
    id, ticker, company: str(o.company).trim() || ticker,
    dateIdentified: str(o.dateIdentified) || '', lastReview: typeof o.lastReview === 'string' ? o.lastReview : null,
    status, fromRadarId: typeof o.fromRadarId === 'string' ? o.fromRadarId : null,
  };
  for (const f of TEXT_FIELDS) e[f] = nz(o[f]);
  const hist = Array.isArray(o.history) ? o.history : [];
  const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  e.firstDiscovered = dateOrNull(o.firstDiscovered) ?? (str(o.dateIdentified) || null);
  e.firstPrimaryConfirmation = dateOrNull(o.firstPrimaryConfirmation);
  e.firstFinancialConfirmation = dateOrNull(o.firstFinancialConfirmation);
  e.firstMaterialEarningsImpact = dateOrNull(o.firstMaterialEarningsImpact);
  e.upgradeCondition = nz(o.upgradeCondition);
  e.downgradeCondition = nz(o.downgradeCondition);
  e.postMortem = validatePostMortem(o.postMortem);
  e.history = hist
    .filter((h) => h && typeof h === 'object' && STATUSES.includes((h as any).from) && STATUSES.includes((h as any).to) && str((h as any).reason).trim())
    .map((h: any) => ({ date: str(h.date), from: h.from as ThesisStatus, to: h.to as ThesisStatus, reason: str(h.reason) }));
  const le = e as unknown as LedgerEntry;
  le.versions = migrateVersions(o.versions, le);
  return le;
}

const MATURITIES: CatalystMaturity[] = ['DISCOVERY', 'VALIDATED', 'DEVELOPING', 'FINANCIALLY_VISIBLE', 'CONFIRMED', 'ACCELERATING', 'MATURE', 'BROKEN'];
const EV_STATUSES: EvidenceStatus[] = ['CONFIRMED', 'STRONG', 'DEVELOPING', 'HYPOTHESIS', 'DISPROVED'];

function validatePostMortem(x: unknown): PostMortem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const pm: PostMortem = {
    originalCatalyst: nz(o.originalCatalyst), evidenceLevel: nz(o.evidenceLevel), expectedMechanism: nz(o.expectedMechanism),
    failurePoint: nz(o.failurePoint), actualOutcome: nz(o.actualOutcome), detectionFailureWhy: nz(o.detectionFailureWhy),
  };
  for (const k of ['misclassified', 'durationOverstated', 'transmissionAssumed', 'expectationsMisread'] as const) if (typeof o[k] === 'boolean') pm[k] = o[k] as boolean;
  if (typeof o.falsePositiveReason === 'string') pm.falsePositiveReason = o.falsePositiveReason as FalsePositiveReason;
  if (typeof o.date === 'string') pm.date = o.date;
  return pm;
}

/** Keeps stored versions (validated, renumbered in order). A legacy entry with none becomes v1 with nothing lost. */
function migrateVersions(raw: unknown, e: LedgerEntry): ThesisVersion[] {
  const out: ThesisVersion[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, any>;
      const sc = o.statusChange && typeof o.statusChange === 'object' ? o.statusChange : {};
      if (!STATUSES.includes(sc.to)) continue;
      out.push({
        version: out.length + 1, date: str(o.date), thesis: nz(o.thesis),
        catalystMaturity: MATURITIES.includes(o.catalystMaturity) ? o.catalystMaturity : null,
        evidenceStatus: EV_STATUSES.includes(o.evidenceStatus) ? o.evidenceStatus : null,
        whatChanged: nz(o.whatChanged), statusChange: { from: STATUSES.includes(sc.from) ? sc.from : null, to: sc.to },
        reason: str(o.reason).trim() || NOT_ESTABLISHED,
        evidenceRefs: Array.isArray(o.evidenceRefs) ? o.evidenceRefs.filter((r: unknown): r is string => typeof r === 'string' && !!r.trim()) : [],
      });
    }
  }
  if (out.length) return out;
  const first = e.history[0];
  return [{
    version: 1, date: e.dateIdentified, thesis: e.thesis, catalystMaturity: null, evidenceStatus: evWordOf(e.evidence),
    whatChanged: 'Initial thesis recorded', statusChange: { from: null, to: first ? first.from : e.status },
    reason: 'Existing ledger entry carried over', evidenceRefs: [],
  }];
}

export function parseLedger(raw: string | null | undefined): LedgerEntry[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: LedgerEntry[] = [];
  for (const x of data) {
    const e = validateEntry(x);
    if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return capLedger(out);
}

/** Keeps the newest LEDGER_CAP entries (by last review, then date identified). */
export function capLedger(list: LedgerEntry[], cap = LEDGER_CAP): LedgerEntry[] {
  if (list.length <= cap) return list;
  const key = (e: LedgerEntry) => e.lastReview || e.dateIdentified || '';
  const keep = new Set([...list].sort((a, b) => key(b).localeCompare(key(a))).slice(0, cap).map((e) => e.id));
  return list.filter((e) => keep.has(e.id));
}

// ── Pure: CRUD on a list ─────────────────────────────────────────────────
export function upsertEntry(list: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  const v = validateEntry(entry);
  if (!v) return list;
  const i = list.findIndex((e) => e.id === v.id);
  const next = i >= 0 ? list.map((e, j) => (j === i ? mergeEdit(e, v) : e)) : [v, ...list];
  return capLedger(next);
}
/** An owner edit never overwrites history: versions, status history, first-dates and the post-mortem of the stored entry are kept. */
function mergeEdit(old: LedgerEntry, edit: LedgerEntry): LedgerEntry {
  const oldVersions = old.versions && old.versions.length ? old.versions : migrateVersions(undefined, old);
  let versions = oldVersions;
  if (edit.thesis !== old.thesis) {
    const last = oldVersions[oldVersions.length - 1];
    versions = [...oldVersions, {
      version: oldVersions.length + 1, date: isoDay(new Date()), thesis: edit.thesis, catalystMaturity: last?.catalystMaturity ?? null, evidenceStatus: last?.evidenceStatus ?? null,
      whatChanged: 'Thesis wording edited by the owner', statusChange: { from: old.status, to: old.status }, reason: 'Owner edit', evidenceRefs: [],
    }];
  }
  return {
    ...edit,
    history: old.history.length >= edit.history.length ? old.history : edit.history,
    versions,
    firstDiscovered: old.firstDiscovered ?? edit.firstDiscovered ?? null,
    firstPrimaryConfirmation: old.firstPrimaryConfirmation ?? edit.firstPrimaryConfirmation ?? null,
    firstFinancialConfirmation: old.firstFinancialConfirmation ?? edit.firstFinancialConfirmation ?? null,
    firstMaterialEarningsImpact: old.firstMaterialEarningsImpact ?? edit.firstMaterialEarningsImpact ?? null,
    postMortem: old.postMortem ?? edit.postMortem ?? null,
    status: old.status,
  };
}
export function deleteEntry(list: LedgerEntry[], id: string): LedgerEntry[] { return list.filter((e) => e.id !== id); }

export type StatusResult = { ok: true; entry: LedgerEntry } | { ok: false; error: string };

export interface VersionUpdate {
  date?: string | Date;
  thesis?: string;
  catalystMaturity?: CatalystMaturity | null;
  evidenceStatus?: EvidenceStatus | null;
  whatChanged: string;
  reason: string;
  evidenceRefs?: string[];
  /** Optional new status. Needs the same written reason. */
  to?: ThesisStatus;
  /** Dates of first confirmations, set once and never moved. */
  firstPrimaryConfirmation?: string | null;
  firstFinancialConfirmation?: string | null;
  firstMaterialEarningsImpact?: string | null;
  postMortem?: Partial<PostMortem>;
}

function makePostMortem(entry: LedgerEntry, reason: string, date: string, pm: Partial<PostMortem> = {}): PostMortem {
  const vs = entry.versions || [];
  const last = vs[vs.length - 1];
  return {
    originalCatalyst: pm.originalCatalyst || (vs[0] ? entry.catalyst : entry.catalyst),
    evidenceLevel: pm.evidenceLevel || (last?.evidenceStatus ? EVIDENCE_LABEL[last.evidenceStatus] : nz(entry.evidence)),
    expectedMechanism: pm.expectedMechanism || entry.mechanism,
    failurePoint: pm.failurePoint || reason,
    actualOutcome: pm.actualOutcome || reason,
    detectionFailureWhy: pm.detectionFailureWhy || NOT_ESTABLISHED,
    ...(pm.misclassified !== undefined ? { misclassified: pm.misclassified } : {}),
    ...(pm.durationOverstated !== undefined ? { durationOverstated: pm.durationOverstated } : {}),
    ...(pm.transmissionAssumed !== undefined ? { transmissionAssumed: pm.transmissionAssumed } : {}),
    ...(pm.expectationsMisread !== undefined ? { expectationsMisread: pm.expectationsMisread } : {}),
    falsePositiveReason: pm.falsePositiveReason ?? null,
    date,
  };
}

/** Appends a thesis version. Earlier versions are never touched. Has no price or move parameter, by design. */
export function appendVersion(entry: LedgerEntry, u: VersionUpdate): StatusResult {
  const r = (u.reason || '').replace(/\s+/g, ' ').trim();
  const what = (u.whatChanged || '').replace(/\s+/g, ' ').trim();
  if (u.to !== undefined && !STATUSES.includes(u.to)) return { ok: false, error: 'Unknown status.' };
  if (r.length < 5) return { ok: false, error: 'A status change needs a written reason (what evidence changed).' };
  if (!what) return { ok: false, error: 'Say what changed.' };
  const date = isoDay(u.date ?? new Date());
  const versions = entry.versions && entry.versions.length ? entry.versions : migrateVersions(undefined, entry);
  const last = versions[versions.length - 1];
  const to = u.to ?? entry.status;
  const thesis = u.thesis ? nz(u.thesis) : (last?.thesis ?? entry.thesis);
  const v: ThesisVersion = {
    version: versions.length + 1, date, thesis,
    catalystMaturity: u.catalystMaturity !== undefined ? u.catalystMaturity : last?.catalystMaturity ?? null,
    evidenceStatus: u.evidenceStatus !== undefined ? u.evidenceStatus : last?.evidenceStatus ?? null,
    whatChanged: what, statusChange: { from: entry.status, to }, reason: r, evidenceRefs: (u.evidenceRefs || []).filter((x) => typeof x === 'string' && x.trim()),
  };
  const next: LedgerEntry = {
    ...entry, thesis, status: to, lastReview: date, versions: [...versions, v],
    history: to !== entry.status ? [...entry.history, { date, from: entry.status, to, reason: r }] : entry.history,
    firstPrimaryConfirmation: entry.firstPrimaryConfirmation ?? u.firstPrimaryConfirmation ?? null,
    firstFinancialConfirmation: entry.firstFinancialConfirmation ?? u.firstFinancialConfirmation ?? null,
    firstMaterialEarningsImpact: entry.firstMaterialEarningsImpact ?? u.firstMaterialEarningsImpact ?? null,
  };
  if (to === 'BROKEN' && !entry.postMortem) next.postMortem = makePostMortem(next, r, date, u.postMortem);
  return { ok: true, entry: next };
}

/** A status change needs a written reason. There is no price or move parameter, by design. Appends a version; BROKEN adds a post-mortem. */
export function applyStatus(entry: LedgerEntry, to: ThesisStatus, reason: string, now: string | Date, extra: { postMortem?: Partial<PostMortem>; evidenceRefs?: string[] } = {}): StatusResult {
  const r = (reason || '').replace(/\s+/g, ' ').trim();
  if (!STATUSES.includes(to)) return { ok: false, error: 'Unknown status.' };
  if (r.length < 5) return { ok: false, error: 'A status change needs a written reason (what evidence changed).' };
  return appendVersion(entry, { date: now, to, whatChanged: `Status ${THESIS_STATUS_LABEL[entry.status].toLowerCase()} to ${THESIS_STATUS_LABEL[to].toLowerCase()}`, reason: r, evidenceRefs: extra.evidenceRefs, postMortem: extra.postMortem });
}

// ── Thesis change log: DATE | CHANGE | EVIDENCE | IMPACT ─────────────────
/** Derived from versions and status history. Only rows with real content; no blank placeholders. */
export function changeLogOf(entry: LedgerEntry): ChangeLogRow[] {
  const rows: ChangeLogRow[] = [];
  const versions = entry.versions && entry.versions.length ? entry.versions : migrateVersions(undefined, entry);
  const seen = new Set<string>();
  versions.forEach((v, i) => {
    const change = v.version === 1 ? `v1: ${v.whatChanged}` : `v${v.version}: ${v.whatChanged}`;
    const bits: string[] = [];
    if (v.evidenceStatus) bits.push(`Evidence ${EVIDENCE_LABEL[v.evidenceStatus].toLowerCase()}`);
    if (v.evidenceRefs.length) bits.push(v.evidenceRefs.join('; '));
    const prev = versions[i - 1];
    const impact: string[] = [];
    if (v.statusChange.from && v.statusChange.from !== v.statusChange.to) impact.push(`Status ${THESIS_STATUS_LABEL[v.statusChange.from].toLowerCase()} to ${THESIS_STATUS_LABEL[v.statusChange.to].toLowerCase()}`);
    else if (!v.statusChange.from) impact.push(`Starting status ${THESIS_STATUS_LABEL[v.statusChange.to].toLowerCase()}`);
    if (prev && v.catalystMaturity && prev.catalystMaturity && v.catalystMaturity !== prev.catalystMaturity) impact.push(`Maturity ${prev.catalystMaturity.toLowerCase().replace(/_/g, ' ')} to ${v.catalystMaturity.toLowerCase().replace(/_/g, ' ')}`);
    const reason = v.reason && v.reason !== NOT_ESTABLISHED ? v.reason : '';
    const evidence = bits.join('. ') || reason;
    const imp = impact.join('. ') || reason;
    if (v.date && v.whatChanged && v.whatChanged !== NOT_ESTABLISHED && evidence && imp) rows.push({ date: v.date, change, evidence, impact: imp });
    seen.add(`${v.date}|${v.statusChange.to}|${v.reason}`);
  });
  for (const h of entry.history) {
    if (seen.has(`${h.date}|${h.to}|${h.reason}`)) continue;
    if (versions.some((v) => v.date === h.date && v.statusChange.to === h.to && v.statusChange.from === h.from)) continue;
    rows.push({ date: h.date, change: `Status ${THESIS_STATUS_LABEL[h.from].toLowerCase()} to ${THESIS_STATUS_LABEL[h.to].toLowerCase()}`, evidence: h.reason, impact: `Now ${THESIS_STATUS_LABEL[h.to].toLowerCase()}` });
  }
  return rows.filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Post-mortems: recurring false-positive patterns ──────────────────────
export interface PatternCount { reason: FalsePositiveReason | 'UNSPECIFIED'; count: number; tickers: string[] }
export interface PostMortemPatterns {
  total: number;
  byReason: PatternCount[];
  flags: { misclassified: number; durationOverstated: number; transmissionAssumed: number; expectationsMisread: number };
}
export function aggregatePostMortems(entries: ReadonlyArray<Pick<LedgerEntry, 'ticker' | 'postMortem'>>): PostMortemPatterns {
  const by = new Map<string, PatternCount>();
  const flags = { misclassified: 0, durationOverstated: 0, transmissionAssumed: 0, expectationsMisread: 0 };
  let total = 0;
  for (const e of entries) {
    const pm = e.postMortem;
    if (!pm) continue;
    total += 1;
    const k = pm.falsePositiveReason || 'UNSPECIFIED';
    const c = by.get(k) || { reason: k as PatternCount['reason'], count: 0, tickers: [] };
    c.count += 1; c.tickers.push(e.ticker); by.set(k, c);
    for (const f of Object.keys(flags) as Array<keyof typeof flags>) if (pm[f] === true) flags[f] += 1;
  }
  return { total, byReason: Array.from(by.values()).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)), flags };
}

export function updateStatusIn(list: LedgerEntry[], id: string, to: ThesisStatus, reason: string, now: string | Date, extra: { postMortem?: Partial<PostMortem> } = {}): { list: LedgerEntry[]; error?: string } {
  const e = list.find((x) => x.id === id);
  if (!e) return { list, error: 'Entry not found.' };
  const r = applyStatus(e, to, reason, now, extra);
  if (!r.ok) return { list, error: r.error };
  return { list: list.map((x) => (x.id === id ? r.entry : x)) };
}

// ── Storage adapter ──────────────────────────────────────────────────────
function defaultStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
}
function announce(): void {
  try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(LEDGER_EVENT)); } catch { /* ignore */ }
}

export function loadLedger(storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  if (!storage) return [];
  try { return parseLedger(storage.getItem(LEDGER_KEY)); } catch { return []; }
}
export function saveLedger(list: LedgerEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(LEDGER_KEY, JSON.stringify(capLedger(list))); announce(); return true; } catch { return false; }
}
export function saveEntry(entry: LedgerEntry, storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  const next = upsertEntry(loadLedger(storage), entry);
  saveLedger(next, storage);
  return next;
}
export function removeEntry(id: string, storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  const next = deleteEntry(loadLedger(storage), id);
  saveLedger(next, storage);
  return next;
}
export function updateStatus(id: string, to: ThesisStatus, reason: string, now: string | Date, storage: StorageLike | null = defaultStorage(), extra: { postMortem?: Partial<PostMortem> } = {}): { list: LedgerEntry[]; error?: string } {
  const r = updateStatusIn(loadLedger(storage), id, to, reason, now, extra);
  if (!r.error) saveLedger(r.list, storage);
  return r;
}

// ── Owner portfolio tags (Core / Satellite / Watch), keyed by upper-case ticker ──
export function parseTags(raw: string | null | undefined): Record<string, OwnerTag> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, OwnerTag> = {};
    for (const [k, v] of Object.entries(o)) if ((OWNER_TAGS as readonly string[]).includes(v as string) && k) out[k.toUpperCase()] = v as OwnerTag;
    return out;
  } catch { return {}; }
}
export function loadTags(storage: StorageLike | null = defaultStorage()): Record<string, OwnerTag> {
  if (!storage) return {};
  try { return parseTags(storage.getItem(TAGS_KEY)); } catch { return {}; }
}
/** tag = null clears it. */
export function setTag(ticker: string, tag: OwnerTag | null, storage: StorageLike | null = defaultStorage()): Record<string, OwnerTag> {
  const cur = loadTags(storage);
  const k = ticker.trim().toUpperCase();
  if (!k) return cur;
  if (tag && (OWNER_TAGS as readonly string[]).includes(tag)) cur[k] = tag; else delete cur[k];
  if (storage) { try { storage.setItem(TAGS_KEY, JSON.stringify(cur)); announce(); } catch { /* ignore */ } }
  return cur;
}

/** The three derived tags. Uses ledger status and evidence only: never a price. Null = nothing to say. */
export function derivedTag(entries: ReadonlyArray<Pick<LedgerEntry, 'status'>>, items: ReadonlyArray<Pick<RadarItem, 'evidence'>>): PortfolioTag | null {
  if (entries.some((e) => e.status === 'BROKEN' || e.status === 'WEAKENING') || items.some((i) => i.evidence.status === 'DISPROVED')) return 'THESIS_AT_RISK';
  if (entries.some((e) => e.status === 'STRENGTHENING') || items.some((i) => i.evidence.status === 'CONFIRMED' || i.evidence.status === 'STRONG')) return 'CATALYST_CONFIRMED';
  if (entries.length > 0 || items.some((i) => i.evidence.status === 'DEVELOPING' || i.evidence.status === 'HYPOTHESIS')) return 'CATALYST_DEVELOPING';
  return null;
}
