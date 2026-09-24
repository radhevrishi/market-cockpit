// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — EVIDENCE INPUTS  (zzz795)
//
// Turns the app's existing feeds into per-theme evidence:
//   · ticker sanitising (a bench key like "SUDARSCHEM@Q1-2027" is a ticker plus
//     a period tag, not a company called that);
//   · theme membership — which themes a ticker belongs to;
//   · catalyst classification for exchange filings and news headlines, keeping
//     only material, dated items (orders, rating actions, capacity, guidance,
//     approvals, regulatory setbacks, deals, buybacks) and dropping the rest.
// Pure functions only.
// ═══════════════════════════════════════════════════════════════════════════

import type { CatalystInput, CatalystKind, PrintInput } from './types';
import { detectRatingAction } from '@/lib/rating-agency-detector';
import { classifyFiling as filingTypeOf } from '@/lib/concall-bullish';

/** Upper-case, exchange prefix/suffix and period tags removed. '' if not a ticker. */
export function sanitizeTicker(raw: unknown): string {
  let s = String(raw ?? '').toUpperCase().trim();
  if (!s) return '';
  s = s.replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|NYSEARCA|NYSEAMERICAN|OTC)\s*:\s*/, '');
  s = s.split('@')[0].split('#')[0].split('|')[0];
  s = s.replace(/\.(NS|BO|NSE|BSE)$/, '').replace(/\s+/g, '');
  if (!/^[A-Z0-9][A-Z0-9&.\-]{0,19}$/.test(s)) return '';
  return s;
}

/** ticker → theme ids, from each theme's declared constituents. */
export function membershipFrom(themeMembers: Record<string, string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [themeId, syms] of Object.entries(themeMembers)) {
    for (const raw of syms) {
      const t = sanitizeTicker(raw); if (!t) continue;
      if (!m.has(t)) m.set(t, new Set());
      m.get(t)!.add(themeId);
    }
  }
  return m;
}

/**
 * Themes a ticker counts toward. Declared constituents first (a name can sit
 * in several themes); otherwise the classifier's single best theme.
 */
export function themesForTicker(ticker: string, membership: Map<string, Set<string>>, classified: string | null): string[] {
  const t = sanitizeTicker(ticker);
  const m = membership.get(t);
  if (m && m.size) return [...m];
  return classified ? [classified] : [];
}

/** Group bench prints by theme. Returns ticker-level de-duplicated lists. */
export function printsByTheme(prints: PrintInput[], themeOf: (p: PrintInput) => string[]): Record<string, PrintInput[]> {
  const out: Record<string, PrintInput[]> = {};
  const seen = new Set<string>();
  for (const p of prints) {
    const tk = sanitizeTicker(p.ticker); if (!tk || !p.filingDate) continue;
    const key = `${tk}|${p.filingDate.slice(0, 10)}`;
    if (seen.has(key)) continue; seen.add(key);
    for (const th of themeOf({ ...p, ticker: tk })) (out[th] ||= []).push({ ...p, ticker: tk });
  }
  return out;
}

// ── CATALYSTS FROM EXCHANGE FILINGS (India live feed) ───────────────────────
export interface FilingLite { symbol?: string; subject?: string; filing_type?: string; filing_datetime?: string; source_url?: string; attachment_urls?: string[]; attachment_url?: string | null }

export function classifyFiling(f: FilingLite): CatalystInput | null {
  const ticker = sanitizeTicker(f.symbol);
  const subject = String(f.subject || '').trim();
  const date = String(f.filing_datetime || '');
  if (!ticker || !subject || !date || !Number.isFinite(new Date(date).getTime())) return null;
  const url = (f.attachment_urls && f.attachment_urls[0]) || f.attachment_url || f.source_url || null;
  // The fast cached path returns raw filings with no type; classify the subject.
  const type = f.filing_type || filingTypeOf(subject);
  const mk = (kind: CatalystKind, tone: CatalystInput['tone']): CatalystInput => ({ ticker, kind, tone, title: subject.slice(0, 160), date, url, source: 'filing' });
  switch (type) {
    case 'ORDER_RECEIPT': return mk('order', 'pos');
    case 'CAPEX_ANNOUNCE': return mk('capacity', 'pos');
    case 'BUYBACK_ANNOUNCE': return mk('buyback', 'pos');
    case 'MA_EVENT': return mk('deal', 'neutral');
    case 'RATING_ACTION': {
      const a = detectRatingAction(subject);
      if (!a) {
        // Exchange subjects often omit the agency name but still say which way.
        if (/\bupgrad/i.test(subject) || /outlook[^.]{0,20}positive/i.test(subject)) return mk('rating-up', 'pos');
        if (/\bdowngrad/i.test(subject) || /outlook[^.]{0,20}negative/i.test(subject)) return mk('rating-down', 'neg');
        return null;                             // direction unknown → noise
      }
      if (a.kind === 'UPGRADE' || a.kind === 'OUTLOOK_UP') return mk('rating-up', 'pos');
      if (a.kind === 'DOWNGRADE' || a.kind === 'OUTLOOK_DOWN') return mk('rating-down', 'neg');
      return null;                               // affirmed / assigned / withdrawn
    }
    case 'USFDA_EVENT': {
      if (/\b483\b|warning letter|import alert|\bOAI\b|official action indicated/i.test(subject)) return mk('regulatory-negative', 'neg');
      if (/approv|\bEIR\b|\bVAI\b|clearance|tentative approval/i.test(subject)) return mk('approval', 'pos');
      return null;
    }
    default: return null;
  }
}

// ── CATALYSTS FROM NEWS HEADLINES ──────────────────────────────────────────
const NEWS_RULES: Array<{ kind: CatalystKind; tone: CatalystInput['tone']; re: RegExp }> = [
  { kind: 'guidance-down', tone: 'neg', re: /\b(cuts?|lowers?|slashes?|trims?|reduces?|withdraws?)\b[^.]{0,30}\b(guidance|outlook|forecast)|guidance (cut|lowered)|profit warning|warns? (on|of) (weak|lower|profit|revenue|sales)/i },
  { kind: 'guidance-up', tone: 'pos', re: /\b(raises?|lifts?|boosts?|hikes?|ups|increases?)\b[^.]{0,30}\b(guidance|outlook|forecast)|guidance (raised|hike)/i },
  { kind: 'rating-down', tone: 'neg', re: /\bdowngrade[sd]?\b|\bcuts? (its |the )?(price )?target|outlook[^.]{0,20}\bnegative\b/i },
  { kind: 'rating-up', tone: 'pos', re: /\bupgrade[sd]?\b|\braises? (its |the )?(price )?target|price target (raised|hiked?)|outlook[^.]{0,20}\bpositive\b/i },
  { kind: 'regulatory-negative', tone: 'neg', re: /warning letter|form 483|import alert|\brecall(s|ed)?\b|antitrust (suit|probe)|\bsanction(s|ed)\b/i },
  { kind: 'approval', tone: 'pos', re: /\bfda (approv|clear)|receives?[^.]{0,25}\bapproval\b|\bapproved by\b/i },
  { kind: 'order', tone: 'pos', re: /\b(wins?|won|bags?|secures?|awarded|receives?|lands?)\b[^.]{0,45}\b(order|contract)s?\b|order (win|inflow)|letter of award/i },
  { kind: 'capacity', tone: 'pos', re: /(capacity|plant|facility|factory|\bfab\b)[^.]{0,20}(expansion|addition)|\bnew (plant|facility|factory|fab)\b|\bexpands? (its )?capacity\b|commission(s|ed|ing) (a |its |the )?(new )?(plant|unit|facility|line)/i },
  { kind: 'buyback', tone: 'pos', re: /\bbuy-?back\b|share repurchase/i },
  { kind: 'deal', tone: 'neutral', re: /\bacquir(e|es|ed|ing)\b|\bmerger\b|\btakeover\b|to buy [^.]{0,30}\bstake\b/i },
];

export interface NewsLite { title?: string; headline?: string; ticker_symbols?: string[]; published_at?: string; url?: string; source_url?: string }

/** One catalyst per (ticker, headline) that matches a material rule; else nothing. */
export function classifyNews(a: NewsLite): CatalystInput[] {
  const title = String(a.title || a.headline || '').trim();
  const date = String(a.published_at || '');
  if (!title || !date || !Number.isFinite(new Date(date).getTime())) return [];
  const rule = NEWS_RULES.find((r) => r.re.test(title));
  if (!rule) return [];
  const tickers = [...new Set((a.ticker_symbols || []).map(sanitizeTicker).filter(Boolean))];
  // A headline tagged with many tickers is a sector story, not a company catalyst.
  if (!tickers.length || tickers.length > 3) return [];
  return tickers.map((ticker) => ({ ticker, kind: rule.kind, tone: rule.tone, title: title.slice(0, 160), date, url: a.url || a.source_url || null, source: 'news' as const }));
}

/** Drop repeats: same ticker, same kind, same day — keep the filing over the news. */
export function dedupeCatalysts(items: CatalystInput[]): CatalystInput[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 60);
  const sorted = [...items].sort((a, b) => (a.source === b.source ? b.date.localeCompare(a.date) : a.source === 'filing' ? -1 : 1));
  const seen = new Set<string>();
  const out: CatalystInput[] = [];
  for (const i of sorted) {
    const k1 = `${i.ticker}|${i.kind}|${i.date.slice(0, 10)}`;
    const k2 = `${i.ticker}|${norm(i.title)}`;
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1); seen.add(k2); out.push(i);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function catalystsByTheme(items: CatalystInput[], themesOf: (ticker: string) => string[]): Record<string, CatalystInput[]> {
  const out: Record<string, CatalystInput[]> = {};
  for (const i of items) for (const th of themesOf(i.ticker)) (out[th] ||= []).push(i);
  return out;
}
