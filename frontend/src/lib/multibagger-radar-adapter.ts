// zzz841 - feed event -> RadarInput. Pure. Field mapping only: no ranking, no
// price, no score is read from the feed event (catalyst_score is ignored).
// zzz847 - identity and content hygiene: subject-only tickers, cleaned company
// names, decoded entities, SEC Form 10 registrations, price / preview / analyst /
// opinion hints, merger-vs-demerger subtype, and cross-card dedupe.

import type { RadarInput } from './multibagger-radar';
import type { RadarFeedEvent, RadarFeedHints, RadarFeedItem } from './multibagger-radar-feed-types';
import {
  NOT_IDENTIFIED, classifyForm10, contentHints, decodeHtmlEntities, identifySubject, isForm10Title, isSecSource, nonEarningsNumberSpans,
  parseSecFilingTitle, publisherFamily, sameEvent, subjectFromHeadline, subtypeHint,
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

export type RadarInputWithHints = RadarInput & RadarFeedHints;

export function eventToRadarInput(ev: RadarFeedEvent): RadarInputWithHints {
  const pf = ev.primary_filing || ({} as RadarFeedEvent['primary_filing']);
  const title = clean(pf.title);
  const description = clean(pf.description) || undefined;
  const sec = parseSecFilingTitle(title);
  const secSource = !!sec || isSecSource(pf.source, pf.link);
  const hints = contentHints(title, description);
  const form10 = classifyForm10(title, description);
  const sub = subtypeHint(title);

  // Identity. SEC filers never carry a symbol; otherwise only the feed ticker or the headline subject.
  const feedTicker = clean((ev.tickers || [])[0]) || null;
  const explicit = sec ? sec.company : (ev.target_name && !isForm10Title(title) && !/^\s*[A-Z0-9/-]+\s+-\s+/.test(title) ? clean(ev.target_name) : '');
  const id = identifySubject({ title, feedTicker, isSec: secSource, explicitName: explicit || null });
  const ticker = id.ticker;
  // A ticker given by the feed itself (no name in the headline subject or target_name) is shown as the name, as before.
  const company = feedTicker && ticker === feedTicker && id.tickerSource === 'feed' && !explicit ? ticker : (id.company && id.company !== NOT_IDENTIFIED ? id.company : (ticker || NOT_IDENTIFIED));

  // Event typing. A registration is never a spin-off; a merger is never a demerger; a loan is financing.
  let eventType = ev.event_type;
  let category = ev.category || pf.category;
  if (form10 === 'REGISTRATION') { eventType = 'FORM10_REGISTRATION'; category = undefined; }
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
  const tier = hints.isPriceArticle || hints.isPreview || hints.isAnalystTarget || hints.isOpinion || hints.isNonCorporate || form10 === 'REGISTRATION' ? 'NOISE' : ev.tier;

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
    nonEarningsNumbers: nonEarningsNumberSpans(`${title} ${description || ''}`),
    tickerResolved: !!ticker,
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
const evScore = (e: RadarFeedEvent): number => (e.primary_source ? 10 : 0) + srcRank(e.primary_filing) * 2 + Math.min((e.filings || []).length, 5) * 0.1 + (/\bmay\b|could|likely|plans?\b|proposal|questions?|report/i.test(e.primary_filing?.title || '') ? -1 : 0) + (/^will\b|\?\s*$|what .* say/i.test(clean(e.primary_filing?.title)) ? -3 : 0);

/** Merges the same event shown on several cards. Returns the kept events and the number merged away. */
export function dedupeFeedEvents(events: ReadonlyArray<RadarFeedEvent>): { events: RadarFeedEvent[]; merged: number } {
  const kept: RadarFeedEvent[] = [];
  let merged = 0;
  const extra = new Map<RadarFeedEvent, RadarFeedItem[]>();
  for (const ev of events) {
    const t = clean(ev.primary_filing?.title);
    const reg = (ev.region || ev.primary_filing?.region || 'GLOBAL');
    const h = contentHints(t);
    const hit = (h.isRegistration || isForm10Title(t)) ? undefined : kept.find((k) => (k.region || k.primary_filing?.region || 'GLOBAL') === reg && sameEvent({ title: clean(k.primary_filing?.title), eventType: k.event_type }, { title: t, eventType: ev.event_type }));
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

/** Maps every event (dropping exact duplicate ids, headline-less events and same-event duplicates). */
export function eventsToRadarInputs(events: ReadonlyArray<RadarFeedEvent> | null | undefined): RadarInputWithHints[] {
  const seen = new Set<string>();
  const uniq: RadarFeedEvent[] = [];
  for (const ev of events || []) {
    if (!ev || !ev.event_id || seen.has(ev.event_id)) continue;
    if (!clean(ev.primary_filing?.title)) continue;
    seen.add(ev.event_id);
    uniq.push(ev);
  }
  return dedupeFeedEvents(uniq).events.map(eventToRadarInput);
}
