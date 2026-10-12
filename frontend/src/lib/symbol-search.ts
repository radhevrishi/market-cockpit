// zzz986 — symbol search for the chart page: type a ticker fragment or any word of a company name ("uni" → Unicommerce,
// Uniparts, Universal Cables …) and get ranked matches from the full US + India lists. Pure: the list comes from
// /api/v1/symbol-list (built from the stock-screener snapshots), the ranking runs in the browser.

export type SymbolMarket = 'US' | 'IN';

/** One listed company. t ticker, n name, m market, x exchange (NSE / BSE / NASDAQ / NYSE / AMEX), c market cap in $ million (rough, for ranking). */
export interface SymbolItem { t: string; n: string; m: SymbolMarket; x?: string; c?: number }

/** Compact wire form [t, n, m, x, c] — keeps the list small. */
export type SymbolTuple = [string, string, SymbolMarket, string?, number?];

export const toTuple = (s: SymbolItem): SymbolTuple => {
  const out: SymbolTuple = [s.t, s.n, s.m];
  if (s.x || s.c != null) out.push(s.x || '');
  if (s.c != null) out.push(s.c);
  return out;
};
export const fromTuple = (a: unknown): SymbolItem | null => {
  if (!Array.isArray(a) || typeof a[0] !== 'string' || !a[0] || (a[2] !== 'US' && a[2] !== 'IN')) return null;
  return { t: a[0], n: typeof a[1] === 'string' ? a[1] : a[0], m: a[2], x: typeof a[3] === 'string' && a[3] ? a[3] : undefined, c: typeof a[4] === 'number' && Number.isFinite(a[4]) ? a[4] : undefined };
};

/** ₹ crore → $ million at a rough rate; only used to order matches, never shown. */
export const croreToUsdM = (cr: number, usdInr = 90): number => (cr * 10) / usdInr;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tickerKey = (s: string) => s.toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|NYSEARCA|BATS):/, '').replace(/\.(NS|BO)$/, '').replace(/\s+/g, '');

interface Indexed { s: SymbolItem; tk: string; name: string; words: string[] }
export interface SymbolIndex { items: Indexed[] }

export function buildSymbolIndex(list: readonly SymbolItem[]): SymbolIndex {
  const seen = new Set<string>();
  const items: Indexed[] = [];
  for (const s of list) {
    if (!s?.t) continue;
    const key = `${s.m}:${s.t.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = norm(s.n || '');
    items.push({ s, tk: s.t.toUpperCase(), name, words: name.split(' ').filter(Boolean) });
  }
  return { items };
}

/**
 * Rank: 0 exact ticker · 1 ticker prefix or the name's first word starts with it (or the whole name does, for several words)
 * · 2 a later name word starts with it · 3 ticker contains it · 4 name contains it. Within a tier: the market picked in the
 * box first when `prefer` is given, then bigger companies first, then ticker A–Z. Returns at most `limit` items.
 */
export function searchSymbols(index: SymbolIndex, raw: string, limit = 15, prefer?: SymbolMarket): SymbolItem[] {
  const qt = tickerKey(raw);
  const qn = norm(raw.replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/i, ''));
  if (!qt && !qn) return [];
  const multi = qn.includes(' ');
  const hits: { s: SymbolItem; tier: number }[] = [];
  for (const it of index.items) {
    let tier = 9;
    if (qt && it.tk === qt) tier = 0;
    else if (qt && it.tk.startsWith(qt)) tier = 1;
    else if (qn && (multi ? it.name.startsWith(qn) : it.words[0]?.startsWith(qn))) tier = 1;
    else if (qn && !multi && it.words.some((w, i) => i > 0 && w.startsWith(qn))) tier = 2;
    else if (qn && multi && it.name.includes(` ${qn}`)) tier = 2;
    else if (qt.length >= 2 && it.tk.includes(qt)) tier = 3;
    else if (qn.length >= 3 && it.name.includes(qn)) tier = 4;
    if (tier < 9) hits.push({ s: it.s, tier });
  }
  hits.sort((a, b) => a.tier - b.tier
    || (prefer ? (a.s.m === prefer ? 0 : 1) - (b.s.m === prefer ? 0 : 1) : 0)
    || (b.s.c ?? -1) - (a.s.c ?? -1)
    || a.s.t.localeCompare(b.s.t));
  return hits.slice(0, limit).map((h) => h.s);
}
