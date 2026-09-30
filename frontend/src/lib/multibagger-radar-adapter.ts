// zzz841 — feed event -> RadarInput. Pure. Field mapping only: no ranking, no
// price, no score is read from the feed event (catalyst_score is ignored).

import type { RadarInput } from './multibagger-radar';
import type { RadarFeedEvent } from './multibagger-radar-feed-types';

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** A company name from the headline when nothing better exists: the text before the first separator, capped. */
export function companyFromTitle(title: string): string {
  const t = clean(title);
  if (!t) return 'Unnamed company';
  const head = t.split(/\s[-–—|:]\s|:\s|\s(?:to|announces|acquires|receives|signs|files|completes|approves)\s/i)[0].trim();
  const out = head.length >= 2 ? head : t;
  return out.length > 60 ? `${out.slice(0, 57).trimEnd()}...` : out;
}

const finiteOrUndef = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);

export function eventToRadarInput(ev: RadarFeedEvent): RadarInput {
  const pf = ev.primary_filing || ({} as RadarFeedEvent['primary_filing']);
  const ticker = clean((ev.tickers || [])[0]) || null;
  const title = clean(pf.title);
  const company = clean(ev.target_name) || ticker || companyFromTitle(title);
  const filings = Array.isArray(ev.filings) ? ev.filings.length : 0;
  const region = ev.region || pf.region || 'GLOBAL';
  return {
    id: ev.event_id,
    ticker,
    company,
    region,
    title,
    description: clean(pf.description) || undefined,
    eventType: ev.event_type,
    category: ev.category || pf.category,
    sourceLabel: clean(pf.source) || undefined,
    primarySource: ev.primary_source === true,
    independentSources: Math.max(filings, 1),
    publishedAt: pf.pub_date || undefined,
    url: pf.link || undefined,
    ageHours: finiteOrUndef(ev.age_hours) ?? finiteOrUndef(pf.age_hours),
    feedTier: ev.tier,
    feedFacts: ev.why_tradable,
  } as RadarInput;
}

/** Maps every event (dropping only exact duplicate event ids and events with no headline). */
export function eventsToRadarInputs(events: ReadonlyArray<RadarFeedEvent> | null | undefined): RadarInput[] {
  const seen = new Set<string>();
  const out: RadarInput[] = [];
  for (const ev of events || []) {
    if (!ev || !ev.event_id || seen.has(ev.event_id)) continue;
    if (!clean(ev.primary_filing?.title)) continue;
    seen.add(ev.event_id);
    out.push(eventToRadarInput(ev));
  }
  return out;
}
