// zzz841 — the detail lines under the compact rows (watch, older filings, no catalyst,
// negative evidence, large / technical moves). ONE source for the web page and the PDF,
// both markets. Pure: it reads only fields the view already carries. A missing field is
// left out (never "undefined", never a guess); unknown is never worded as negative; the
// price is never an input; no trade wording.
import type { ResearchItem } from './research-view';

export interface DetailLine {
  /** Small caps label: 'WHY WATCH, NOT QUEUE', 'RESEARCH QUESTION', 'FOUND' ... */
  label: string;
  text: string;
  tone?: 'muted' | 'amber';
  /** Stable hook for tests. */
  key: string;
}

const has = (s: unknown): boolean => { const t = String(s ?? '').trim(); return !!t && !/^(null|undefined|nan)$/i.test(t); };
const clip = (s: string, n: number): string => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/[ ,;:.-]+$/, '')}...` : t; };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ymd = (s: unknown): string | null => (has(s) ? String(s).slice(0, 10) : null);
const pct1 = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

const isPC = (c: unknown): boolean => (c as any)?.kind === 'price_commentary' || (c as any)?.subtype === 'price_commentary';
export const hasHeadlineEvent = (it: ResearchItem): boolean =>
  it.eventClass !== 'NO_CATALYST' && it.eventClass !== 'MARKET_MOVE_ONLY' && it.eventClass !== 'DATA_UNAVAILABLE' && it.eventClass !== 'LISTING';

/** 'SEC' / 'exchange filing' / 'press only' ... from the item's own source fields. */
function headlineSourceWord(it: ResearchItem): string {
  const filing = it.market === 'US' ? 'SEC filing' : 'exchange filing';
  switch (it.sourceExistence) {
    case 'official_filing': return filing;
    case 'both': return `${filing} and press`;
    case 'press_only': return 'press only, not verified in a filing';
    default:
      return it.sourceConfidence === 'VERIFIED_DOCUMENT' || it.sourceConfidence === 'VERIFIED_FILING' ? filing : it.sourceConfidence === 'UNVERIFIED' || it.sourceConfidence === 'SECONDARY_SUMMARY' ? 'press or summary only' : 'source not stated';
  }
}

interface Cat { label: string; category: string; source: string; date: string | null; stated: string[]; quote: string | null }

/** The catalysts of one row: the market's own list when the card has it, else the headline event itself. */
function catalystsOf(it: ResearchItem): Cat[] {
  const out: Cat[] = [];
  const us = it.market === 'US' ? it.usCard : null;
  const inc = it.market === 'IN' ? it.inCard : null;
  if (us && Array.isArray(us.catalysts)) {
    for (const c of us.catalysts) {
      if (isPC(c)) continue;
      out.push({ label: String(c.label || c.category || 'Event'), category: String(c.category || ''), source: c.source === 'SEC' ? 'SEC' : 'press only, not verified in a filing', date: ymd(c.date), stated: (c.figures || []).filter(has).map(String), quote: has(c.sentence) ? String(c.sentence) : null });
    }
  } else if (inc && Array.isArray(inc.catalysts)) {
    for (const c of inc.catalysts) {
      if (c.id === 'price_clarification' || c.id === 'exchange_query' || isPC(c)) continue;
      out.push({ label: String(c.label || c.category || 'Event'), category: String(c.category || ''), source: c.source === 'FILING' ? 'exchange filing' : c.confirmedByFiling ? 'press, also filed' : 'press only, reported not confirmed', date: ymd(c.date), stated: (c.figures || []).filter(has).map(String), quote: has(c.sentence) ? String(c.sentence) : null });
    }
  }
  if (!out.length && hasHeadlineEvent(it) && has(it.headline)) {
    out.push({ label: has(it.eventLabel) ? String(it.eventLabel) : String(it.eventType), category: String(it.eventType || ''), source: headlineSourceWord(it), date: ymd(it.headlineFiledDate) || ymd(it.filedDate), stated: [], quote: has(it.quote) ? String(it.quote) : null });
  }
  return out;
}

/** Compact catalyst lines: at most `max`, then "and N more". */
export function catalystLines(it: ResearchItem, max = 3, quoteChars = 140): DetailLine[] {
  const cs = catalystsOf(it);
  const lines: DetailLine[] = cs.slice(0, max).map((c, i) => {
    const bits = [c.label, c.category && c.category.toLowerCase() !== c.label.toLowerCase() ? c.category : '', c.source, c.date || '', c.stated.length ? `stated: ${c.stated.join(', ')}` : ''].filter(has);
    return { label: i === 0 ? 'CATALYST' : '', text: `${bits.join(' · ')}${c.quote ? ` · "${clip(c.quote, quoteChars)}"` : ''}`, key: 'catalyst' };
  });
  if (cs.length > max) lines.push({ label: '', text: `and ${cs.length - max} more`, tone: 'muted', key: 'catalyst-more' });
  return lines;
}

/** One plain sentence: why this row is on the watch list and not in the queue. Built only from fields the row carries. */
export function whyWatchText(it: ResearchItem): string {
  const r: string[] = [];
  if (it.sourceExistence === 'press_only' || it.evidenceVerification === 'secondary_only') r.push('press only, no official filing found for it');
  else if (it.evidenceVerification === 'document_not_read' || (it.economicsUnknown && (it.sourceExistence === 'official_filing' || it.sourceExistence === 'both'))) r.push('an official filing exists but its document has not been read');
  if (it.evidenceVerification === 'contradicted' || (it.conflicts && it.conflicts.length)) r.push('two sources give different values');
  if (it.economicsUnknown) r.push(`size not established${it.economicsUnknown.missing?.length ? ` (missing: ${it.economicsUnknown.missing.slice(0, 3).join(', ')})` : ''}`);
  else if (it.materiality?.label === 'SMALL') r.push("small against the company's size");
  if (it.flags?.dilution) r.push('an equity raise: supply and dilution, neutral until the terms are read');
  else if (it.direction === 'NEUTRAL') r.push('reads neutral on the facts filed');
  else if (it.direction === 'MIXED') r.push('reads mixed on the facts filed');
  if (it.stageBadge === 'PROPOSED') r.push('still proposed, not firm');
  if (it.catalystFor === 'RECENT') r.push(`filed ${num(it.ageDays) ? `${Math.round(it.ageDays)} days` : 'some days'} before the move`);
  else if (it.catalystFor === 'CONTEXT') r.push('older than the move window');
  const picked = r.slice(0, 3);
  if (!picked.length) return 'ranked below the research queue on the evidence in hand.';
  const s = picked.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function keyUnknownOf(it: ResearchItem): string | null {
  const u = (it.unknowns || []).find(has);
  return u ? String(u) : null;
}

/** WATCH / INVESTIGATE rows (both markets). The score chip is drawn by the caller. */
export function watchLines(it: ResearchItem): DetailLine[] {
  const out: DetailLine[] = [{ label: 'WHY WATCH, NOT QUEUE', text: whyWatchText(it), key: 'why-watch' }];
  if (has(it.researchQuestion)) out.push({ label: 'RESEARCH QUESTION', text: String(it.researchQuestion), key: 'research-question' });
  const ku = keyUnknownOf(it);
  if (ku) out.push({ label: 'KEY UNKNOWN', text: ku, key: 'key-unknown' });
  return [...out, ...catalystLines(it, 3)];
}

/** OLDER FILINGS rows. `withEvent` adds the event + filed date + age line (the PDF and the card list; the web table has those columns). */
export function olderLines(it: ResearchItem, o: { withEvent?: boolean } = {}): DetailLine[] {
  const out: DetailLine[] = [];
  if (o.withEvent) {
    const d = ymd(it.headlineFiledDate) || ymd(it.filedDate);
    out.push({ label: 'EVENT', text: `${has(it.eventLabel) ? it.eventLabel : it.eventType}${d ? ` · filed ${d}` : ' · filed date not disclosed'}${num(it.ageDays) ? ` (${Math.round(it.ageDays)} days ago)` : ''}`, key: 'older-event' });
  }
  out.push({ label: 'CONTEXT', text: "Context only, not this move's catalyst.", tone: 'amber', key: 'older-context' });
  const cl = catalystLines(it, 2, 110);
  return [...out, ...cl];
}

/** The searched-and-found sentence. Nothing when the row has none. */
export function searchedText(it: ResearchItem): string | null {
  const s = it.searched;
  if (s && Array.isArray(s.sources) && s.sources.length) {
    const counts = num(s.filings) || num(s.press) ? ` (${s.filings ?? 0} filing${(s.filings ?? 0) === 1 ? '' : 's'}, ${s.press ?? 0} press item${(s.press ?? 0) === 1 ? '' : 's'})` : '';
    return `Searched ${s.sources.join(', ')}${num(s.lookbackDays) ? `, last ${s.lookbackDays} days` : ''}${counts}.`;
  }
  return null;
}

/** The first press headline seen for the name, or null. Always unverified. */
export function pressLine(it: ResearchItem): string | null {
  const n = it.news;
  if (!n) return null;
  const first = (n.items || []).find((x) => x && has(x.title));
  if (first) return `${has(first.date) ? `${first.date}: ` : ''}${clip(first.title, 160)}`;
  if (n.narrative && has(n.narrative.lead)) return `${n.narrative.label} story, ${n.narrative.days} day${n.narrative.days === 1 ? '' : 's'} (${n.narrative.firstDate} to ${n.narrative.lastDate}): "${clip(n.narrative.lead, 140)}"`;
  return null;
}

export const NOT_NEGATIVE_TEXT = 'Not negative - nothing in the filings or news names one.';

/** NO IDENTIFIED CATALYST rows. The existing SCANNED line (scanNote) stays as it was; this adds what was searched, the plain verdict and any press seen. */
export function noCatalystLines(it: ResearchItem): DetailLine[] {
  const out: DetailLine[] = [];
  const s = searchedText(it);
  if (s) out.push({ label: 'SEARCHED', text: s, tone: 'muted', key: 'searched' });
  else if (!has(it.scanNote) && has(it.catalystStatusSentence)) out.push({ label: 'SEARCHED', text: String(it.catalystStatusSentence), tone: 'muted', key: 'searched' });
  else if (!has(it.scanNote)) out.push({ label: 'SEARCHED', text: 'What was searched is not recorded for this name.', tone: 'muted', key: 'searched' });
  out.push({ label: 'NO CATALYST', text: NOT_NEGATIVE_TEXT, key: 'not-negative' });
  const p = pressLine(it);
  if (p) out.push({ label: 'PRESS (UNVERIFIED)', text: p, tone: 'muted', key: 'press' });
  return out;
}

/** The facts behind a row: the stated change, else the earnings mini's figures. */
export function factsText(it: ResearchItem): string | null {
  if (has(it.whatChanged) && String(it.whatChanged).trim() !== String(it.headline || '').trim()) return clip(String(it.whatChanged), 220);
  const e = it.earnings;
  if (e) {
    const bits: string[] = [];
    if (num(e.revenueYoY)) bits.push(`revenue ${pct1(e.revenueYoY)} YoY`);
    if (num(e.patYoY)) bits.push(`PAT ${pct1(e.patYoY)} YoY`);
    if (num(e.ebitdaYoY)) bits.push(`EBITDA ${pct1(e.ebitdaYoY)} YoY`);
    if (num(e.marginNow)) bits.push(`margin ${num(e.marginPrior) ? `${e.marginPrior.toFixed(1)}% to ` : ''}${e.marginNow.toFixed(1)}%`);
    const head = `${e.quarter ? `${e.quarter}: ` : ''}${bits.join(', ')}`;
    if (bits.length) return head;
    if (has(e.keyChange)) return clip(String(e.keyChange), 220);
  }
  return null;
}

/** NEGATIVE EVIDENCE rows: direction reason, the facts behind it, the research question. */
export function negativeLines(it: ResearchItem): DetailLine[] {
  const out: DetailLine[] = [];
  out.push({ label: 'DIRECTION', text: has(it.directionNote) ? String(it.directionNote) : `${it.direction ? String(it.direction).toLowerCase() : 'negative'} on the facts filed; no further reason stated beyond the headline.`, key: 'direction-reason' });
  const f = factsText(it);
  if (f) out.push({ label: 'FACTS', text: f, key: 'facts' });
  if (has(it.researchQuestion)) out.push({ label: 'RESEARCH QUESTION', text: String(it.researchQuestion), key: 'research-question' });
  const ku = keyUnknownOf(it);
  if (ku) out.push({ label: 'KEY UNKNOWN', text: ku, key: 'key-unknown' });
  return out;
}

/** LARGE / TECHNICAL (price-band) rows: what was searched, the facts, the open question. */
export function technicalLines(it: ResearchItem): DetailLine[] {
  const out: DetailLine[] = [];
  const s = searchedText(it);
  if (s) out.push({ label: 'SEARCHED', text: s, tone: 'muted', key: 'searched' });
  else if (!has(it.scanNote) && has(it.catalystStatusSentence)) out.push({ label: 'SEARCHED', text: String(it.catalystStatusSentence), tone: 'muted', key: 'searched' });
  const facts = [it.flags?.band != null && num(it.flags.band) ? `price band ${it.flags.band}%` : '', 'a large move by itself does not establish demand'].filter(Boolean).join('; ');
  out.push({ label: 'FACTS', text: `${facts.charAt(0).toUpperCase()}${facts.slice(1)}.`, key: 'facts' });
  out.push({ label: 'RESEARCH QUESTION', text: has(it.researchQuestion) ? String(it.researchQuestion) : 'What fundamental event, if any, explains the move?', key: 'research-question' });
  const p = pressLine(it);
  if (p) out.push({ label: 'PRESS (UNVERIFIED)', text: p, tone: 'muted', key: 'press' });
  return out;
}
