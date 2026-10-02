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
import type { RadarFeedEvent, RadarFeedHints, RadarFeedItem, FeedHoldBackReason } from './multibagger-radar-feed-types';
import {
  assignInformationOrigins, classifyFeedHoldBack, dealRolesFor, isBareFormText, secChainFamily, secFilingInfoFor, secFormOfItem, securityResolutionFor, cikFromTitle,
} from './special-sit-security';
import { buildFeedCountModel, type FeedCountModel } from './special-sit-qa';
import { normName } from './special-sit-numbers';
import {
  NOT_IDENTIFIED, MONEY_NAME_DEAL_RE, canonicalEventKey, classifyForm10, contentHints, decodeHtmlEntities, eventFamily, identifySubject, is13e3Text, isForm10Title, isFundRepurchaseOffer, isSecSource,
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
    // zzz854: SC 13E3 is a going-private transaction (a buyout / merger), not a tender.
    if (/13E-?3/i.test(secForm)) return 'MERGER';
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

const SUBTYPE_EVENT: Record<string, { eventType: string; category: string }> = {
  THIRD_PARTY_TENDER: { eventType: 'TENDER_OFFER', category: 'MA' },
  TARGET_RECOMMENDATION: { eventType: 'MERGER_RECOMMENDATION', category: 'MA' },
  ISSUER_TENDER: { eventType: 'BUYBACK_TENDER', category: 'CAP' },
  GOING_PRIVATE: { eventType: 'GOING_PRIVATE', category: 'MA' },
};
const HOLDBACK_EXCLUSION: Record<FeedHoldBackReason, string> = {
  FUND_REPURCHASE_OFFER: 'FUND_REPURCHASE',
  PARTNERSHIP_UNIT_REPURCHASE: 'PARTNERSHIP_UNITS',
  DEBT_TENDER: 'DEBT_SECURITY',
  ROUTINE_ISSUER_TENDER: 'ROUTINE_TENDER',
  ISSUER_TENDER_TERMS_NOT_READ: 'TERMS_NOT_READ',
  EXCLUDED_FROM_EQUITY_RADAR: 'NO_COMPANY_MECHANISM',
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  AI_CONTRADICTED: 'AI_CONTRADICTED',
};
const ACQ_WORDS_RE = /\b(acquir\w*|acquisition|buy(?:s|ing)? (?:a |the |an )?(?:\d+(?:\.\d+)?\s?% )?(?:stake|majority|controlling)|stake (?:buy|purchase|increase)|buyout|takeover|remaining stake)\b/i;
const RANGE_PCT_RE = /\b\d{1,3}(?:\.\d+)?\s?[–—-]\s?\d{1,3}(?:\.\d+)?\s?%/g;
const normT = (x: string): string => clean(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Every source item behind an event: the filings list (the route puts the primary in it), else the primary, plus folded amendments. One entry per link / headline. */
function eventItems(ev: RadarFeedEvent): RadarFeedItem[] {
  const pf = ev.primary_filing;
  const base: RadarFeedItem[] = Array.isArray(ev.filings) && ev.filings.length ? ev.filings.slice() : (pf ? [pf] : []);
  const extra = Array.isArray(ev.amendments) ? ev.amendments : [];
  const seen = new Set<string>();
  const out: RadarFeedItem[] = [];
  for (const f of [...base, ...extra]) {
    if (!f) continue;
    const k = `${f.link || ''}|${normT(f.title || '')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

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
  const items = eventItems(ev);
  const filings = Array.isArray(ev.filings) ? ev.filings : [];

  // zzz854: SEC form context folded over every listing / amendment of the filing.
  const secFiling = secSource ? secFilingInfoFor([pf, ...items], description || '') : null;
  const secRows = items.map((f) => ({ f, p: parseSecFilingTitle(clean(f.title)) })).filter((x) => x.p);
  const subjectName = sec ? (sec.role === 'filed by' ? (secRows.find((x) => x.p!.role === 'subject' || x.p!.role === 'issuer')?.p!.company || sec.company) : sec.company) : null;

  // Identity. SEC filers never carry a symbol; otherwise only the feed ticker or the headline subject.
  const feedTicker = clean((ev.tickers || [])[0]) || null;
  const explicit = sec ? (subjectName || sec.company) : (ev.target_name && !isForm10Title(title) && !/^\s*[A-Z0-9/-]+\s+-\s+/.test(title) ? clean(ev.target_name) : '');
  const id = identifySubject({ title, feedTicker, isSec: secSource, explicitName: explicit || null });
  const idTicker = id.ticker;
  // A ticker given by the feed itself (no name in the headline subject or target_name) is shown as the name, as before.
  let fundRepurchase = isFundRepurchaseOffer({ title, description: rawDescription, source: pf.source, company: sec ? explicit : explicit || id.company, eventType: ev.event_type });
  const company = feedTicker && idTicker === feedTicker && id.tickerSource === 'feed' && !explicit ? idTicker : (id.company && id.company !== NOT_IDENTIFIED ? id.company : (idTicker || NOT_IDENTIFIED));

  // Entity resolution (zzz852). The card ticker is set only when the entity state is RESOLVED.
  const nameForEntity = company === idTicker && !explicit ? (id.company && id.company !== NOT_IDENTIFIED ? id.company : company) : company;
  const knownExch = id.tickerSource === 'suffix' ? (/\.BO\b/.test(title) ? 'BSE' : 'NSE') : id.tickerSource === 'master' ? 'NSE' : null;
  const subjCik = secFiling?.subjectCik || cikFromTitle(title);
  const entityInput = {
    name: nameForEntity, text: `${title} ${description || ''}`, cik: subjCik, knownTicker: idTicker, knownTickerBasis: id.tickerSource ? `headline / feed (${id.tickerSource})` : null,
    knownExchange: knownExch, viaParent: id.viaParent || null, isFundRepurchase: fundRepurchase, isSecFiling: secSource,
  };
  let entity = resolveEntity(entityInput, opts?.entityDeps);

  // zzz854: held back from Special Situations (pooled vehicles, partnership units, debt / routine / unread issuer tenders). One reason per item.
  const relatedText = items.filter((f) => normT(f.title || '') !== normT(title)).map((f) => `${clean(f.title)} ${clean(f.description)}`).join(' ');
  const holdBack = classifyFeedHoldBack({ title, description: rawDescription, source: pf.source, link: pf.link, company: sec ? explicit : (explicit || nameForEntity), eventType: ev.event_type, relatedText, listed: entity.state === 'RESOLVED' || entity.state === 'RESOLVED_MULTIPLE', secForm: secFiling?.form || null });
  // A reason the route already decided (QA exclusion, verification gate) applies when the feed classifier has none.
  const routeReason = typeof ev.quarantine_reason === 'string' && ev.quarantine_reason in HOLDBACK_EXCLUSION ? ev.quarantine_reason as FeedHoldBackReason : null;
  const holdReason: FeedHoldBackReason | null = holdBack ? holdBack.reason : routeReason;
  const holdLabel = holdBack ? holdBack.label : routeReason ? FEED_QUARANTINE_LABEL[routeReason] : undefined;
  if (holdReason === 'FUND_REPURCHASE_OFFER' && !fundRepurchase) { fundRepurchase = true; entity = resolveEntity({ ...entityInput, isFundRepurchase: true }, opts?.entityDeps); }
  const ticker = entity.state === 'RESOLVED' && entity.ticker ? entity.ticker : null;
  const tickerLabel = tickerLabelFor(entity, nameForEntity !== NOT_IDENTIFIED);
  const usLookup = opts?.entityDeps?.usLookup || null;
  const security = securityResolutionFor(entity, {
    name: nameForEntity, cik: subjCik, isSec: secSource, region: ev.region || pf.region, usLookupLoaded: !!usLookup,
    nseLookup: opts?.entityDeps?.nseLookup, usByName: usLookup ? (n) => usLookup.byName(n) : undefined, heldBackReason: holdReason,
  });

  // Event typing. A registration is never a spin-off; a merger is never a demerger; a loan is financing.
  let eventType = ev.event_type;
  let category = ev.category || pf.category;
  const subtype = secFiling ? secFiling.subtype : null;
  if (holdReason === 'FUND_REPURCHASE_OFFER') { eventType = 'FUND_REPURCHASE_OFFER'; category = undefined; }
  else if (holdReason) { eventType = holdReason; category = undefined; }
  else if (form10 === 'REGISTRATION') { eventType = 'FORM10_REGISTRATION'; category = undefined; }
  else if (hints.isPriceArticle) { eventType = 'PRICE_ARTICLE'; category = undefined; }
  else if (hints.isPreview) { eventType = 'RESULTS_PREVIEW'; category = undefined; }
  else if (hints.isAnalystTarget) { eventType = 'ANALYST_TARGET'; category = undefined; }
  else if (hints.isOpinion) { eventType = 'OPINION'; category = undefined; }
  else if (hints.isNonCorporate) { eventType = 'NON_CORPORATE'; category = undefined; }
  else if (subtype && SUBTYPE_EVENT[subtype]) { eventType = SUBTYPE_EVENT[subtype].eventType; category = SUBTYPE_EVENT[subtype].category as typeof category; }
  else if (sub === 'MERGER' && /demerg|spin|hive|split/i.test(`${eventType} ${category || ''}`)) { eventType = 'MERGER_DEFINITIVE'; category = 'MA' as typeof category; }
  else if (sub === 'FINANCING') { eventType = 'FINANCING_LOAN'; category = undefined; }
  else if (sub === 'GUIDANCE_PLAN') { eventType = 'GUIDANCE_PLAN'; category = undefined; }

  // zzz854: information origins. Syndicated / rewritten copies, party listings and amendments share one origin.
  const originItems = items.length ? items : [pf];
  const origins = assignInformationOrigins(originItems.map((f) => ({ title: clean(f.title), source: clean(f.source), link: f.link, description: clean(f.description), pub_date: f.pub_date })), { subject: nameForEntity });
  const { perItem, ...sourceOrigins } = origins;
  const region = ev.region || pf.region || 'GLOBAL';
  const tier = holdReason || hints.isPriceArticle || hints.isPreview || hints.isAnalystTarget || hints.isOpinion || hints.isNonCorporate || form10 === 'REGISTRATION' ? 'NOISE' : ev.tier;

  const nonEvent = hints.isPriceArticle || hints.isPreview || hints.isAnalystTarget || hints.isOpinion || hints.isNonCorporate || form10 === 'REGISTRATION' || !!holdReason;
  const secForm = sec?.form || secFiling?.form || (secSource ? (`${title} ${pf.source || ''}`.match(/\bSC\s*(?:TO-[TI]|13E-?3|14D-?9)\b/i) || [null])[0] : null);
  const edgarNoEcon = !!secForm && EDGAR_NO_ECONOMICS_RE.test(secForm);
  let hKind = headlineKind(title, ev.event_type, secForm, nonEvent);
  // '<X>'s Rs 900 cr <Name> bet' with acquisition wording in the text is an acquisition, not a new product.
  if (hKind === 'OTHER' && !nonEvent && !secForm && (MONEY_NAME_DEAL_RE.test(title) || /\bbet\b/i.test(title)) && ACQ_WORDS_RE.test(`${title} ${description || ''}`)) hKind = 'ACQUISITION';
  const secondary = secondaryFactsFor(title, hKind);
  // The only text is the EDGAR form title: the filing exists, its terms were not read.
  const formTitleOnly = secSource && items.concat([pf]).every((f) => !!secFormOfItem({ title: clean(f.title), source: f.source, link: f.link }) && isBareFormText(clean(f.title), clean(f.description), parseSecFilingTitle(clean(f.title))?.company || null));
  // EDGAR terms come from the description only, never from the form title; a bare title has no terms at all.
  const termsText = secSource ? (formTitleOnly ? '' : clean(description || '').split(title).join(' ')) : `${title}. ${description || ''}`;
  const bodyText = `${title}. ${description || ''}`;
  let owned = extractOwnedNumbers(title, description, hKind, nameForEntity);
  // Form names carry no economics: any figure in an EDGAR tender / going-private filing text is context, never earnings.
  if (edgarNoEcon) owned = owned.map((o) => ({ ...o, entityRole: o.entityRole === 'parent' ? 'unknown' : o.entityRole, countsAsParentEarnings: false }));
  const edgarSpans = edgarNoEcon ? Array.from(new Set((bodyText.match(NUM_SPAN_RE) || []).map((x) => x.trim()))) : [];
  const terms = termsText ? extractDealTerms(termsText, hKind === 'EARNINGS' || hKind === 'OTHER' ? 'OTHER' : hKind, { title }) : null;
  // A field whose value only repeats the headline / form title is not a term.
  const dropped: string[] = [];
  if (terms) {
    const nt = normT(title);
    for (const [k, v] of Object.entries(terms.fields)) {
      const nv = normT(v);
      if (!nv || (nt && (nv === nt || nv.includes(nt))) || parseSecFilingTitle(clean(v))) { delete terms.fields[k]; terms.missing.push(k); dropped.push(k); }
    }
    terms.statedConditions = terms.statedConditions.filter((c) => { const nc = normT(c); return !(nt && (nc === nt || nc.includes(nt))) && !parseSecFilingTitle(clean(c)); });
  }
  const dealTerms = !terms || terms.kind === 'OTHER' || (!Object.keys(terms.fields).length && !terms.statedConditions.length) ? undefined : terms;
  const subjectRowCompany = subjectName || (sec ? sec.company : '');
  const filerCompany = (() => {
    for (const f of [pf, ...items]) { const p = parseSecFilingTitle(clean(f?.title)); if (p && /filed by/i.test(p.role || '') && p.company !== subjectRowCompany) return p.company; }
    return null;
  })();
  const sourceSubject = deriveSourceSubject({ title, company: nameForEntity, filerCompany, secRole: sec?.role || null, secForm: sec?.form || null });
  const filerRows = secFiling?.filerCik && usLookup?.byCik ? usLookup.byCik(secFiling.filerCik) : [];
  const filerTickers = Array.from(new Set(filerRows.map((r) => r.ticker)));
  const dealRoles = dealRolesFor({ secFiling, subject: secFiling ? (subjectRowCompany || null) : null, filer: filerCompany, sourceSubject, acquirerTicker: filerTickers.length === 1 ? filerTickers[0] : null });

  // The feed's why_tradable is a per-event-type playbook template: its figures ('typical 20-40% premium') are never evidence.
  const ff = ev.why_tradable;
  const ffText = ff ? [ff.what_happened, ff.what_matters, ff.what_to_watch, ff.what_breaks_thesis].filter(Boolean).join(' ') : '';
  const sourceText = `${title} ${rawDescription || ''}`;
  const templateSpans = ffText ? Array.from(new Set([...(ffText.match(RANGE_PCT_RE) || []), ...(ffText.match(/\b\d{1,3}(?:\.\d+)?\s?%/g) || []), ...(ffText.match(NUM_SPAN_RE) || [])].map((x) => x.trim()))).filter((x) => !sourceText.includes(x)) : [];

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
    // zzz856: a company document matched to the event by the verifier's locator (exchange announcement / EDGAR filing) counts
    // as the primary source once it was read (AI-confirmed) or its own text states the terms; the card can link it.
    primarySource: ev.primary_source === true || !!(ev as any).primaryDocument?.url,
    primaryDocument: (ev as any).primaryDocument || undefined,
    // zzz854: independence by information origin, never by outlet count. Syndicated copies, party listings and amendments are one origin.
    independentSources: Math.max(sourceOrigins.independentOrigins, 1),
    independentOrigins: Math.max(sourceOrigins.independentOrigins, 1),
    sourceOrigins,
    sources: filings.length ? filings.map((f) => {
      const idx = originItems.indexOf(f);
      const o = idx >= 0 ? perItem[idx] : null;
      return { label: clean(f.source) || undefined, url: f.link || null, title: clean(f.title) || undefined, publishedAt: f.pub_date || null, ...(o ? { originId: o.originId, copyKind: o.copyKind } : {}) };
    }) : undefined,
    publishedAt: pf.pub_date || undefined,
    url: pf.link || undefined,
    ageHours: finiteOrUndef(ev.age_hours) ?? finiteOrUndef(pf.age_hours),
    feedTier: tier,
    // A playbook template's what_matters / what_breaks_thesis are type priors, never facts about this event: not passed on.
    feedFacts: ff && ev.why_tradable_kind === 'PLAYBOOK' ? { what_happened: ff.what_happened, what_to_watch: ff.what_to_watch } : ev.why_tradable,
    feedFactsAreTemplate: ff ? true : undefined,
    isPriceArticle: hints.isPriceArticle,
    isPreview: hints.isPreview,
    isAnalystTarget: hints.isAnalystTarget,
    isOpinion: hints.isOpinion,
    isNonCorporate: hints.isNonCorporate,
    isRegistration: form10 === 'REGISTRATION',
    subtypeHint: form10 === 'SPIN' ? 'SPIN' : sub,
    // Price-reaction wording ('hits all-time high') is context only; it is listed so no stage can read it as evidence.
    nonEarningsNumbers: Array.from(new Set([...nonEarningsNumberSpans(`${title} ${rawDescription || ''}`), ...priceReactionSpans(`${title} ${rawDescription || ''}`), ...boilerplate, ...edgarSpans, ...templateSpans])),
    tickerResolved: !!ticker,
    isFundRepurchaseOffer: fundRepurchase,
    feedQuarantineReason: holdReason,
    feedQuarantineLabel: holdLabel,
    groupName: id.group === true,
    tickerNote: ticker ? (id.viaParent ? `via parent ${id.viaParent}` : undefined) : (id.group ? 'No listed ticker (group)' : undefined),
    tickerVia: id.viaParent || undefined,
    isLegalBoilerplateAmount: is13e3,
    ownedNumbers: owned,
    entity,
    dealTerms,
    dealTermsDropped: dropped.length ? dropped : undefined,
    sourceSubject,
    tickerLabel,
    securityState: security.state,
    securityLabel: security.label,
    security,
    secFiling,
    eventSubtype: subtype,
    eventSubtypeLabel: secFiling ? secFiling.subtypeLabel : undefined,
    dealRoles,
    formTitleOnly: formTitleOnly || undefined,
    evidenceCeiling: formTitleOnly ? 'FILING_EXISTS_TERMS_NOT_READ' : null,
    eventHeadlineKind: hKind,
    secondaryFacts: secondary.length ? secondary : undefined,
    excludedFromEquityRadar: holdReason ? true : undefined,
    exclusionReason: holdReason ? HOLDBACK_EXCLUSION[holdReason] : undefined,
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
const evScore = (e: RadarFeedEvent): number => (/^\s*[A-Z0-9 -]+\/A\s+-\s+/i.test(clean(e.primary_filing?.title)) ? -2 : 0) + (e.primary_source ? 10 : 0) + srcRank(e.primary_filing) * 2 + Math.min((e.filings || []).length, 5) * 0.1 + (/\bmay\b|could|likely|plans?\b|proposal|questions?|report/i.test(e.primary_filing?.title || '') ? -1 : 0) + (/\(Subject\)\s*$/i.test(clean(e.primary_filing?.title)) ? 3 : 0) + (/\(Filed by\)\s*$/i.test(clean(e.primary_filing?.title)) ? -3 : 0) + (/^will\b|\?\s*$|what .* say/i.test(clean(e.primary_filing?.title)) ? -3 : 0);

/**
 * zzz854: SEC chain key. An original filing and its /A amendments (and a 14D9 answering a TO-T) for the same subject are ONE event.
 * Key = chain family + subject CIK (or normalised subject name when no CIK). Form 10 chains need a CIK.
 */
export function secChainKey(ev: RadarFeedEvent): string | null {
  const rows = [ev.primary_filing, ...(ev.filings || []), ...(ev.amendments || [])].filter(Boolean);
  for (const f of rows) {
    const p = parseSecFilingTitle(clean(f.title));
    if (!p) continue;
    const fam = secChainFamily(p.form);
    if (!fam) return null;
    if (p.role === 'filed by' && rows.some((x) => /\(Subject\)|\(Issuer\)/i.test(clean(x.title)))) continue;
    const cik = cikFromTitle(f.title);
    if (fam === 'F10' && !cik) return null;
    const subj = cik || normName(p.company).join(' ');
    return subj ? `${fam}|${subj}` : null;
  }
  return null;
}

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
    const chain = secChainKey(ev);
    // zzz854: a held-back event (route reason / verification gate) never merges into a shown one, or the reverse.
    const sameHold = (k: RadarFeedEvent) => (k.quarantine_reason || null) === (ev.quarantine_reason || null);
    const hit = (h.isRegistration || isForm10Title(t)) ? (chain ? kept.find((k) => sameHold(k) && (k.region || k.primary_filing?.region || 'GLOBAL') === reg && secChainKey(k) === chain) : undefined) : kept.find((k) => {
      if (!sameHold(k)) return false;
      if ((k.region || k.primary_filing?.region || 'GLOBAL') !== reg) return false;
      // same SEC chain (original + amendments of one deal for one subject) = one event
      if (chain && secChainKey(k) === chain) return true;
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
export function splitRadarInputs(events: ReadonlyArray<RadarFeedEvent> | null | undefined, opts?: AdapterOptions): { inputs: RadarInputWithHints[]; heldBackInputs: RadarInputWithHints[]; heldBack: HeldBackSummary; mergedDuplicates: number; canonicalEvents: number } {
  const seen = new Set<string>();
  const uniq: RadarFeedEvent[] = [];
  for (const ev of events || []) {
    if (!ev || !ev.event_id || seen.has(ev.event_id)) continue;
    if (!clean(ev.primary_filing?.title)) continue;
    seen.add(ev.event_id);
    uniq.push(ev);
  }
  const deduped = dedupeFeedEvents(uniq);
  const mapped = deduped.events.map((e) => eventToRadarInput(e, opts));
  const inputs: RadarInputWithHints[] = [];
  const heldBackInputs: RadarInputWithHints[] = [];
  for (const i of mapped) (i.feedQuarantineReason ? heldBackInputs : inputs).push(i);
  const heldBack = summariseHeldBack(heldBackInputs.map((i) => ({ reason: i.feedQuarantineReason as FeedQuarantineReason, name: i.company })));
  return { inputs, heldBackInputs, heldBack, mergedDuplicates: deduped.merged, canonicalEvents: uniq.length };
}

/**
 * zzz854: one count model for the whole Special Situations page, derived from ONE filtered set (this adapter's split).
 * Pass the route's raw RSS item count and (optionally) its raw coverage buckets and the radar's section counts; see
 * buildFeedCountModel in special-sit-qa.ts for the equations.
 */
export function feedCountModelFromEvents(events: ReadonlyArray<RadarFeedEvent> | null | undefined, opts?: AdapterOptions & {
  rawItemCount?: number;
  rawCoverage?: Record<string, number>;
  coverageBucketOf?: (eventType: string, category?: string) => string | null;
  radarSections?: Record<string, number>;
  radarExcluded?: number;
}): FeedCountModel {
  const split = splitRadarInputs(events, opts);
  return buildFeedCountModel({
    rawItemCount: opts?.rawItemCount, canonicalEvents: split.canonicalEvents, mergedDuplicates: split.mergedDuplicates,
    shown: split.inputs, heldBack: split.heldBackInputs, rawCoverage: opts?.rawCoverage, coverageBucketOf: opts?.coverageBucketOf,
    radarSections: opts?.radarSections, radarExcluded: opts?.radarExcluded,
  });
}

// ─── zzz854 wave 2: verification-gated payload assembly (used by the Special Situations feed route) ──
export interface GatedFeedArgs<E extends RadarFeedEvent = RadarFeedEvent> {
  /** shown: primary-verified or AI-confirmed */
  kept: ReadonlyArray<E>;
  /** already held back by the route (classifier / QA exclusion) */
  held: ReadonlyArray<E>;
  /** not verified yet / AI-contradicted (verification gate) */
  awaiting: ReadonlyArray<E>;
  contradicted?: ReadonlyArray<E>;
  rawItemCount?: number;
  rawCoverage?: Record<string, number>;
  coverageBucketOf?: (eventType: string, category?: string) => string | null;
  entityDeps?: EntityDeps;
}
export interface GatedFeed<E> {
  /** kept + every held item, held ones flagged (quarantine_reason, tier NOISE, category HELD_BACK; originals kept in *_before_hold) */
  events: E[];
  countModel: FeedCountModel;
  heldBack: HeldBackSummary;
  /** header tiers of the SHOWN set (same set as the chips, coverage and radar) */
  byTier: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', number>;
}

const holdFlag = <E extends RadarFeedEvent>(e: E, reason: FeedHoldBackReason | null): E => {
  const r = reason || (typeof e.quarantine_reason === 'string' && e.quarantine_reason in HOLDBACK_EXCLUSION ? e.quarantine_reason as FeedHoldBackReason : 'EXCLUDED_FROM_EQUITY_RADAR');
  const x = e as any;
  return { ...e, quarantine_reason: r, tier: 'NOISE', category: 'HELD_BACK', tier_before_hold: x.tier_before_hold ?? e.tier ?? null, category_before_hold: x.category_before_hold ?? e.category ?? null } as E;
};

/**
 * One filtered set for the whole page. Shown = `kept` after the adapter's own dedupe and hold-back; everything else is held
 * back with a reason (route classifier, QA exclusion, AWAITING_VERIFICATION, AI_CONTRADICTED). QA 'DUPLICATE' exclusions are
 * the same event seen twice: they are counted as merged duplicates, never as a second card or a held-back item.
 * E1: canonical = shown + held back + merged duplicates holds by construction.
 */
export function assembleGatedFeed<E extends RadarFeedEvent>(a: GatedFeedArgs<E>): GatedFeed<E> {
  const dupes = a.held.filter((e) => e.exclusion_reason === 'DUPLICATE' && !e.quarantine_reason);
  const held = a.held.filter((e) => !dupes.includes(e)).map((e) => holdFlag(e, null));
  const awaiting = a.awaiting.map((e) => holdFlag(e, 'AWAITING_VERIFICATION'));
  const contradicted = (a.contradicted || []).map((e) => holdFlag(e, 'AI_CONTRADICTED'));
  const events = [...a.kept, ...held, ...awaiting, ...contradicted] as E[];
  const split = splitRadarInputs(events, { entityDeps: a.entityDeps });
  const countModel = buildFeedCountModel({
    rawItemCount: a.rawItemCount, canonicalEvents: split.canonicalEvents + dupes.length, mergedDuplicates: split.mergedDuplicates + dupes.length,
    shown: split.inputs, heldBack: split.heldBackInputs, rawCoverage: a.rawCoverage, coverageBucketOf: a.coverageBucketOf,
  });
  const byTier: GatedFeed<E>['byTier'] = { TIER_1: 0, TIER_2: 0, WATCHLIST: 0, NOISE: 0 };
  for (const [k, v] of Object.entries(countModel.shown_by_tier)) byTier[(k in byTier ? k : 'NOISE') as keyof typeof byTier] += v;
  // An event the adapter held back (e.g. a cached payload built before a classifier change) is flagged in the list too, so the
  // page never renders a card the counts call held back.
  const idx = new Map(events.map((e, i) => [e.event_id, i]));
  for (const h of split.heldBackInputs) { const i = idx.get(h.id); if (i != null && !events[i].quarantine_reason && h.feedQuarantineReason) events[i] = holdFlag(events[i], h.feedQuarantineReason); }
  return { events, countModel, heldBack: split.heldBack, byTier };
}
