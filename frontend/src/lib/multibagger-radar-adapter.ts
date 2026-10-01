// zzz841 - feed event -> RadarInput. Pure. Field mapping only: no ranking, no
// price, no score is read from the feed event (catalyst_score is ignored).
// zzz847 - identity and content hygiene: subject-only tickers, cleaned company
// names, decoded entities, SEC Form 10 registrations, price / preview / analyst /
// opinion hints, merger-vs-demerger subtype, and cross-card dedupe.

import type { RadarInput } from './multibagger-radar';
import type { DealKind } from './radar-owned-types';
import { extractOwnedNumbers } from './special-sit-numbers';
import { extractDealTerms } from './special-sit-deal-terms';
import { deriveSourceSubject, resolveEntity, tickerLabelFor, type EntityDeps } from './special-sit-entity';
import type { RadarFeedEvent, RadarFeedHints, RadarFeedItem } from './multibagger-radar-feed-types';
import {
  NOT_IDENTIFIED, canonicalEventKey, classifyForm10, contentHints, decodeHtmlEntities, eventFamily, identifySubject, is13e3Text, isForm10Title, isFundRepurchaseOffer, isSecSource,
  legalBoilerplatePercents, nonEarningsNumberSpans, parseSecFilingTitle, priceReactionSpans, publisherFamily, sameCanonicalEvent, sameEvent, secAccession,
  stripLegalBoilerplatePercents, subjectFromHeadline, subtypeHint, summariseHeldBack, FEED_QUARANTINE_LABEL,
  type FeedQuarantineReason, type HeldBackSummary,
} from './special-sit-feed-quality';

const clean = (s: unknown): string => (typeof s === 'string' ? decodeHtmlEntities(s).replace(/\s+/g, ' ').trim() : '');

/**
 * A company name from the headline when nothing better exists: the subject noun
 * phrase up to the verb. Never a slice of the headline; unresolved gives 'Not identified'.
 */
export function companyFromTitle(title: string): string {
  const t = clean(title);
  if (!t) return 'Unnamed company';
  return subjectFromHeadline(t) || NOT_IDENTIFIED;
}

const finiteOrUndef = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);


export interface AdapterOptions { entityDeps?: EntityDeps }

const DIVIDEND_HEAD_RE = /\b(?:dividend|payout)\b/i;
const SECONDARY_SPLIT_RE = /\s*,\s+|\s+despite\s+|\s+even as\s+|\s+even though\s+|\s+while\s+|\s+though\s+|\s*;\s*|\s+amid\s+|\s+as\s+(?=(?:q[1-4]|net|profit|pat)\b)/i;
const FINANCIAL_CLAUSE_RE = /\b(profit|loss|pat|net income|earnings|revenue|ebitda|margin)\b/i;

/** What the headline itself announces. A dividend headline stays DIVIDEND even when it also mentions a profit change. */
export function headlineKind(title: string, eventType: string | undefined, secForm: string | null, nonEvent: boolean): DealKind | 'EARNINGS' | 'OTHER' {
  if (secForm) {
    if (/TO-I|TO-T|14D-?9/i.test(secForm)) return 'TENDER';
    return 'OTHER';
  }
  if (nonEvent) return 'OTHER';
  if (/\btender offer\b/i.test(title)) return 'TENDER';
  if (/\b(stock split|bonus (?:issue|shares?)|sub-?division of shares?)\b/i.test(title)) return 'SPLIT_BONUS';
  const fam = eventFamily(title, eventType);
  if (fam === 'MERGER') return 'MERGER';
  if (fam === 'SPIN') return 'SPIN_OFF';
  if (fam === 'ACQUISITION') return 'ACQUISITION';
  if (fam === 'BUYBACK') return 'BUYBACK';
  if (fam === 'DIVIDEND' || DIVIDEND_HEAD_RE.test(title)) return 'DIVIDEND';
  if (fam === 'CAPITAL_RAISE') return 'CAPITAL_RAISE';
  if (/\b(tribunal|court|penalty|show[- ]cause)\b/i.test(title)) return 'LEGAL';
  if (/\b(?:q[1-4]|h[12]|fy\s?\d{2,4})\b[^.]{0,60}\b(profit|revenue|results?|earnings|pat|loss)\b|\bnet (?:profit|loss)\b|\bPAT\b/i.test(title)) return 'EARNINGS';
  return 'OTHER';
}

/** The profit / revenue clause of a corporate-action headline ('Despite Fall In Q1 Net Profit'), kept as a secondary fact. */
export function secondaryFactsFor(title: string, kind: string): string[] {
  if (kind !== 'DIVIDEND' && kind !== 'SPLIT_BONUS' && kind !== 'BUYBACK') return [];
  const parts = title.split(SECONDARY_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => p.replace(/^(?:despite|even as|even though|while|though|amid|as)\s+/i, '')).filter((p) => FINANCIAL_CLAUSE_RE.test(p) && !DIVIDEND_HEAD_RE.test(p)).slice(0, 3);
}

const EDGAR_NO_ECONOMICS_RE = /TO-[TI]|13E-?3|14D-?9/i;
const NUM_SPAN_RE = /(?:rs\.?|inr|\u20b9|us\$|usd|\$|\u20ac|\u00a3)\s?\d[\d,]*(?:\.\d+)?\s?(?:lakh crores?|crores?|cr|million|mn|billion|bn)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|shares|million|billion)\b/gi;

export type RadarInputWithHints = RadarInput & RadarFeedHints;

export function eventToRadarInput(ev: RadarFeedEvent, opts?: AdapterOptions): RadarInputWithHints {
  const pf = ev.primary_filing || ({} as RadarFeedEvent['primary_filing']);
  const title = clean(pf.title);
  const rawDescription = clean(pf.description) || undefined;
  const sec = parseSecFilingTitle(title);
  const secSource = !!sec || isSecSource(pf.source, pf.link);
  // SC 13E-3 text carries legal-boilerplate percentages ('40%'); they are not a deal amount. Strip them from the description
  // (they stay listed in nonEarningsNumbers so no later stage can show them as evidence).
  const is13e3 = secSource && is13e3Text(sec?.form, `${title} ${rawDescription || ''} ${pf.source || ''}`);
  const boilerplate = is13e3 ? legalBoilerplatePercents(`${title} ${rawDescription || ''}`) : [];
  const description = is13e3 && rawDescription ? (stripLegalBoilerplatePercents(rawDescription) || undefined) : rawDescription;
  const hints = contentHints(title, description);
  const form10 = classifyForm10(title, description);
  const sub = subtypeHint(title);

  // Identity. SEC filers never carry a symbol; otherwise only the feed ticker or the headline subject.
  const feedTicker = clean((ev.tickers || [])[0]) || null;
  const explicit = sec ? sec.company : (ev.target_name && !isForm10Title(title) && !/^\s*[A-Z0-9/-]+\s+-\s+/.test(title) ? clean(ev.target_name) : '');
  const id = identifySubject({ title, feedTicker, isSec: secSource, explicitName: explicit || null });
  const idTicker = id.ticker;
  // A ticker given by the feed itself (no name in the headline subject or target_name) is shown as the name, as before.
  const fundRepurchase = isFundRepurchaseOffer({ title, description: rawDescription, source: pf.source, company: sec ? sec.company : explicit || id.company, eventType: ev.event_type });
  const company = feedTicker && idTicker === feedTicker && id.tickerSource === 'feed' && !explicit ? idTicker : (id.company && id.company !== NOT_IDENTIFIED ? id.company : (idTicker || NOT_IDENTIFIED));

  // Event typing. A registration is never a spin-off; a merger is never a demerger; a loan is financing.
  let eventType = ev.event_type;
  let category = ev.category || pf.category;
  if (fundRepurchase) { eventType = 'FUND_REPURCHASE_OFFER'; category = undefined; }
  else if (form10 === 'REGISTRATION') { eventType = 'FORM10_REGISTRATION'; category = undefined; }
  else if (hints.isPriceArticle) { eventType = 'PRICE_ARTICLE'; category = undefined; }
  else if (hints.isPreview) { eventType = 'RESULTS_PREVIEW'; category = undefined; }
  else if (hints.isAnalystTarget) { eventType = 'ANALYST_TARGET'; category = undefined; }
  else if (hints.isOpinion) { eventType = 'OPINION'; category = undefined; }
  else if (hints.isNonCorporate) { eventType = 'NON_CORPORATE'; category = undefined; }
  else if (sub === 'MERGER' && /demerg|spin|hive|split/i.test(`${eventType} ${category || ''}`)) { eventType = 'MERGER_DEFINITIVE'; category = 'MA' as typeof category; }
  else if (sub === 'FINANCING') { eventType = 'FINANCING_LOAN'; category = undefined; }
  else if (sub === 'GUIDANCE_PLAN') { eventType = 'GUIDANCE_PLAN'; category = undefined; }

  const filings = Array.isArray(ev.filings) ? ev.filings : [];
  // One source per publisher family. A copy with no source label counts by its own headline, so distinct
  // unlabelled items stay distinct and identical copies collapse.
  const families = new Set<string>();
  const norm = (x: string) => clean(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const f of filings) families.add(clean(f.source) ? publisherFamily(f.source) : `t:${norm(f.title || '')}`);
  if (!filings.length) families.add(publisherFamily(pf.source));
  const region = ev.region || pf.region || 'GLOBAL';
  const tier = fundRepurchase || hints.isPriceArticle || hints.isPreview || hints.isAnalystTarget || hints.isOpinion || hints.isNonCorporate || form10 === 'REGISTRATION' ? 'NOISE' : ev.tier;

  // Entity resolution (zzz852). The card ticker is set only when the entity state is RESOLVED.
  const nameForEntity = company === idTicker && !explicit ? (id.company && id.company !== NOT_IDENTIFIED ? id.company : company) : company;
  const knownExch = id.tickerSource === 'suffix' ? (/\.BO\b/.test(title) ? 'BSE' : 'NSE') : id.tickerSource === 'master' ? 'NSE' : null;
  const cikM = title.match(/\((\d{10})\)/);
  const entity = resolveEntity({
    name: nameForEntity, text: `${title} ${description || ''}`, cik: cikM ? cikM[1] : null, knownTicker: idTicker, knownTickerBasis: id.tickerSource ? `headline / feed (${id.tickerSource})` : null,
    knownExchange: knownExch, viaParent: id.viaParent || null, isFundRepurchase: fundRepurchase, isSecFiling: secSource,
  }, opts?.entityDeps);
  const ticker = entity.state === 'RESOLVED' && entity.ticker ? entity.ticker : null;
  const tickerLabel = tickerLabelFor(entity, nameForEntity !== NOT_IDENTIFIED);

  const nonEvent = hints.isPriceArticle || hints.isPreview || hints.isAnalystTarget || hints.isOpinion || hints.isNonCorporate || form10 === 'REGISTRATION' || fundRepurchase;
  const secForm = sec?.form || (secSource ? (`${title} ${pf.source || ''}`.match(/\bSC\s*(?:TO-[TI]|13E-?3|14D-?9)\b/i) || [null])[0] : null);
  const edgarNoEcon = !!secForm && EDGAR_NO_ECONOMICS_RE.test(secForm);
  const hKind = headlineKind(title, ev.event_type, secForm, nonEvent);
  const secondary = secondaryFactsFor(title, hKind);
  const bodyText = `${title}. ${description || ''}`;
  let owned = extractOwnedNumbers(title, description, hKind, nameForEntity);
  // Form names carry no economics: any figure in an EDGAR tender / going-private filing text is context, never earnings.
  if (edgarNoEcon) owned = owned.map((o) => ({ ...o, entityRole: o.entityRole === 'parent' ? 'unknown' : o.entityRole, countsAsParentEarnings: false }));
  const edgarSpans = edgarNoEcon ? Array.from(new Set((bodyText.match(NUM_SPAN_RE) || []).map((x) => x.trim()))) : [];
  const terms = extractDealTerms(bodyText, hKind === 'EARNINGS' || hKind === 'OTHER' ? 'OTHER' : hKind);
  const dealTerms = terms.kind === 'OTHER' || (!Object.keys(terms.fields).length && !terms.statedConditions.length) ? undefined : terms;
  const filerCompany = (() => {
    for (const f of [pf, ...filings]) { const p = parseSecFilingTitle(clean(f?.title)); if (p && /filed by/i.test(p.role || '') && p.company !== (sec ? sec.company : '')) return p.company; }
    return null;
  })();
  const sourceSubject = deriveSourceSubject({ title, company: nameForEntity, filerCompany, secRole: sec?.role || null, secForm: sec?.form || null });

  const out = {
    id: ev.event_id,
    ticker,
    company,
    region,
    title,
    description,
    eventType,
    category,
    sourceLabel: clean(pf.source) || undefined,
    primarySource: ev.primary_source === true,
    // Syndicated copies from one publisher family are one source, not many.
    independentSources: Math.max(families.size, 1),
    sources: filings.length ? filings.map((f) => ({ label: clean(f.source) || undefined, url: f.link || null, title: clean(f.title) || undefined, publishedAt: f.pub_date || null })) : undefined,
    publishedAt: pf.pub_date || undefined,
    url: pf.link || undefined,
    ageHours: finiteOrUndef(ev.age_hours) ?? finiteOrUndef(pf.age_hours),
    feedTier: tier,
    feedFacts: ev.why_tradable,
    isPriceArticle: hints.isPriceArticle,
    isPreview: hints.isPreview,
    isAnalystTarget: hints.isAnalystTarget,
    isOpinion: hints.isOpinion,
    isNonCorporate: hints.isNonCorporate,
    isRegistration: form10 === 'REGISTRATION',
    subtypeHint: form10 === 'SPIN' ? 'SPIN' : sub,
    // Price-reaction wording ('hits all-time high') is context only; it is listed so no stage can read it as evidence.
    nonEarningsNumbers: Array.from(new Set([...nonEarningsNumberSpans(`${title} ${rawDescription || ''}`), ...priceReactionSpans(`${title} ${rawDescription || ''}`), ...boilerplate, ...edgarSpans])),
    tickerResolved: !!ticker,
    isFundRepurchaseOffer: fundRepurchase,
    feedQuarantineReason: fundRepurchase ? 'FUND_REPURCHASE_OFFER' : null,
    feedQuarantineLabel: fundRepurchase ? FEED_QUARANTINE_LABEL.FUND_REPURCHASE_OFFER : undefined,
    groupName: id.group === true,
    tickerNote: ticker ? (id.viaParent ? `via parent ${id.viaParent}` : undefined) : (id.group ? 'No listed ticker (group)' : undefined),
    tickerVia: id.viaParent || undefined,
    isLegalBoilerplateAmount: is13e3,
    ownedNumbers: owned,
    entity,
    dealTerms,
    sourceSubject,
    tickerLabel,
    eventHeadlineKind: hKind,
    secondaryFacts: secondary.length ? secondary : undefined,
    excludedFromEquityRadar: fundRepurchase ? true : undefined,
    exclusionReason: fundRepurchase ? 'FUND_REPURCHASE' : undefined,
  } as RadarInputWithHints;
  return out;
}

// ─── dedupe ──────────────────────────────────────────────────────────────────
const srcRank = (f: RadarFeedItem | undefined): number => {
  const s = (f?.source || '').toLowerCase();
  if (/sec|bse|nse|exchange/.test(s)) return 4;
  if (/reuters|bloomberg|et |economic times|business ?line|bl |mint|financial express|capital market/.test(s)) return 3;
  if (/ndtv|moneycontrol|cnbc|marketwatch|yahoo/.test(s)) return 2;
  return 1;
};
const evScore = (e: RadarFeedEvent): number => (e.primary_source ? 10 : 0) + srcRank(e.primary_filing) * 2 + Math.min((e.filings || []).length, 5) * 0.1 + (/\bmay\b|could|likely|plans?\b|proposal|questions?|report/i.test(e.primary_filing?.title || '') ? -1 : 0) + (/\(Subject\)\s*$/i.test(clean(e.primary_filing?.title)) ? 3 : 0) + (/\(Filed by\)\s*$/i.test(clean(e.primary_filing?.title)) ? -3 : 0) + (/^will\b|\?\s*$|what .* say/i.test(clean(e.primary_filing?.title)) ? -3 : 0);

/** Merges the same event shown on several cards. Returns the kept events and the number merged away. */
export function dedupeFeedEvents(events: ReadonlyArray<RadarFeedEvent>): { events: RadarFeedEvent[]; merged: number } {
  const kept: RadarFeedEvent[] = [];
  let merged = 0;
  const extra = new Map<RadarFeedEvent, RadarFeedItem[]>();
  for (const ev of events) {
    const t = clean(ev.primary_filing?.title);
    const reg = (ev.region || ev.primary_filing?.region || 'GLOBAL');
    const h = contentHints(t);
    const acc = secAccession(ev.primary_filing?.link);
    const ck = canonicalEventKey({ title: t, eventType: ev.event_type, pubDate: ev.primary_filing?.pub_date });
    const hit = (h.isRegistration || isForm10Title(t)) ? undefined : kept.find((k) => {
      if ((k.region || k.primary_filing?.region || 'GLOBAL') !== reg) return false;
      // same SEC accession = the same filing listed once per party (subject / filed-by)
      if (acc && secAccession(k.primary_filing?.link) === acc) return true;
      const kt = clean(k.primary_filing?.title);
      return sameCanonicalEvent(canonicalEventKey({ title: kt, eventType: k.event_type, pubDate: k.primary_filing?.pub_date }), ck)
        || sameEvent({ title: kt, eventType: k.event_type }, { title: t, eventType: ev.event_type });
    });
    if (!hit) { kept.push(ev); continue; }
    merged += 1;
    const winner = evScore(ev) > evScore(hit) ? ev : hit;
    const loser = winner === ev ? hit : ev;
    const pool = [...(extra.get(hit) || []), ...(extra.get(ev) || []), loser.primary_filing, ...(loser.filings || [])].filter(Boolean) as RadarFeedItem[];
    if (winner !== hit) kept[kept.indexOf(hit)] = winner;
    extra.delete(hit);
    extra.set(winner, pool);
  }
  const out = kept.map((k) => {
    const more = extra.get(k);
    if (!more || !more.length) return k;
    const seen = new Set<string>();
    const all: RadarFeedItem[] = [];
    for (const f of [...(k.filings && k.filings.length ? k.filings : [k.primary_filing]), ...more]) {
      const key = `${f.link || ''}|${clean(f.title).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(f);
    }
    return { ...k, filings: all, primary_source: k.primary_source || more.some((f) => /sec|bse|nse/i.test(f.source || '')) } as RadarFeedEvent;
  });
  return { events: out, merged };
}

/** Same as before, minus held-back items. Pass `{ includeHeldBack: true }` to keep fund repurchase offers (flagged, never in a thesis bucket). */
export function eventsToRadarInputs(events: ReadonlyArray<RadarFeedEvent> | null | undefined, opts?: { includeHeldBack?: boolean } & AdapterOptions): RadarInputWithHints[] {
  const all = splitRadarInputs(events, opts);
  return opts?.includeHeldBack ? [...all.inputs, ...all.heldBackInputs] : all.inputs;
}

/** Maps every event (dropping exact duplicate ids, headline-less events and same-event duplicates), split into the main list and the held-back list. */
export function splitRadarInputs(events: ReadonlyArray<RadarFeedEvent> | null | undefined, opts?: AdapterOptions): { inputs: RadarInputWithHints[]; heldBackInputs: RadarInputWithHints[]; heldBack: HeldBackSummary } {
  const seen = new Set<string>();
  const uniq: RadarFeedEvent[] = [];
  for (const ev of events || []) {
    if (!ev || !ev.event_id || seen.has(ev.event_id)) continue;
    if (!clean(ev.primary_filing?.title)) continue;
    seen.add(ev.event_id);
    uniq.push(ev);
  }
  const mapped = dedupeFeedEvents(uniq).events.map((e) => eventToRadarInput(e, opts));
  const inputs: RadarInputWithHints[] = [];
  const heldBackInputs: RadarInputWithHints[] = [];
  for (const i of mapped) (i.feedQuarantineReason ? heldBackInputs : inputs).push(i);
  const heldBack = summariseHeldBack(heldBackInputs.map((i) => ({ reason: i.feedQuarantineReason as FeedQuarantineReason, name: i.company })));
  return { inputs, heldBackInputs, heldBack };
}
