// zzz894 — Transformational Contracts: one row per CONTRACT, and only contracts.
//
// The old story key (first six title words + a 5-day bucket) let the same deal through twice when two newsrooms worded it
// differently ("Bondada Engineering secures Rs 13.38 billion contract…" / "Bondada Engineering gains after securing Rs 1,338
// crore…") or when the two copies fell either side of a bucket edge (NHPC–CSPDCL Kamala PPA on 20 and 21 July). Two items are
// now the same contract when, within 15 days, they share a company and either the same money (₹ crore / billion / lakh crore
// and $ million / billion all normalised) or the same capacity (MW / GW), or their titles mostly match.
//
// Headlines that are not a signed commitment — a tender invited, talks, a market-size forecast, a loan or project financing,
// a plan to "set aside" capex, "eyes", "may get" — are left out of the ledger view. Pure, unit-tested.

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'to', 'in', 'on', 'with', 'from', 'by', 'at', 'as', 'after', 'its', 'ltd', 'limited', 'inc', 'corp', 'co', 'rs', 'inr', 'crore', 'cr', 'billion', 'million', 'bn', 'mn', 'usd', 'project', 'projects', 'contract', 'order', 'deal', 'wins', 'win', 'secures', 'secure', 'securing', 'bags', 'bag', 'signs', 'sign', 'ink', 'inks', 'gains', 'awarded', 'award', 'awards', 'worth', 'new']);

const words = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d/.test(w));

/** Money in the title, in ₹ crore (dollars converted at a fixed 85 only to compare two titles with each other). */
export function moneyCr(title: string): number | null {
  const t = String(title || '').replace(/,/g, '');
  let m = /(?:₹|rs\.?|inr)\s*([\d.]+)\s*(lakh\s*crore|lakh-crore|crore|cr\b|billion|bn\b|million|mn\b)/i.exec(t);
  if (m) { const v = parseFloat(m[1]); const u = m[2].toLowerCase(); return /lakh/.test(u) ? v * 100000 : /crore|cr/.test(u) ? v : /billion|bn/.test(u) ? v * 100 : v / 10; }
  m = /\$\s*([\d.]+)\s*(billion|bn\b|b\b|million|mn\b|m\b)/i.exec(t);
  if (m) { const v = parseFloat(m[1]); return /^b/i.test(m[2]) ? v * 8500 : v * 8.5; }
  return null;
}
/** Capacity in the title, in MW. */
export function capacityMw(title: string): number | null {
  const m = /([\d,.]+)\s*(gw|mw)\b/i.exec(String(title || ''));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? (/gw/i.test(m[2]) ? v * 1000 : v) : null;
}

/** Not a signed commitment: tenders, talks, forecasts, financing, intentions. */
export const NOT_A_CONTRACT = /\b(invites? bids?|floats?\b.*\btender|tender for|eyes?|in talks|talks|advances? .* talks|may get|could drive|market to \$|market size|to set aside|plans? to|to lend|lend(?:s|ing)? \$|project financing|secures? .* financing|loan|subordinated debt|explor(?:e|es|ing)|considering|mulls?)\b/i;
export function isNotAContract(title: string): boolean { return NOT_A_CONTRACT.test(String(title || '')); }

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++;
  return A.size + B.size - i ? i / (A.size + B.size - i) : 0;
}
const near = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.02);

export interface DedupItem { title: string; published_at?: string; recorded_at?: string; primary_ticker?: string | null; ticker_symbols?: string[] }
/** True when two ledger items describe the same contract. */
export function sameContract(a: DedupItem, b: DedupItem): boolean {
  const ta = Date.parse(a.published_at || a.recorded_at || ''), tb = Date.parse(b.published_at || b.recorded_at || '');
  if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) > 15 * 86_400_000) return false;
  const wa = words(a.title), wb = words(b.title);
  const j = jaccard(wa, wb);
  if (j >= 0.6) return true;
  const tickA = new Set([a.primary_ticker, ...(a.ticker_symbols || [])].filter(Boolean).map((x) => String(x).toUpperCase()));
  const shareTicker = [b.primary_ticker, ...(b.ticker_symbols || [])].filter(Boolean).some((x) => tickA.has(String(x).toUpperCase()));
  const shareName = wa.slice(0, 2).some((w) => w.length > 3 && wb.slice(0, 3).includes(w));   // the company is usually the first word
  if (!shareTicker && !shareName) return false;
  if (near(moneyCr(a.title), moneyCr(b.title))) return true;
  const ca = capacityMw(a.title), cb = capacityMw(b.title);
  if (near(ca, cb) && j >= 0.25) return true;
  return false;
}

/** Keeps one item per contract (the better-ranked one) and drops non-contracts. Order of the input is kept. */
export function dedupeContracts<T extends DedupItem>(items: T[], rank: (it: T) => number): { items: T[]; duplicates: number; notContracts: number } {
  const out: T[] = []; let duplicates = 0, notContracts = 0;
  for (const it of items) {
    if (isNotAContract(it.title)) { notContracts++; continue; }
    const i = out.findIndex((o) => sameContract(o, it));
    if (i < 0) { out.push(it); continue; }
    duplicates++;
    if (rank(it) > rank(out[i])) out[i] = it;
  }
  return { items: out, duplicates, notContracts };
}
