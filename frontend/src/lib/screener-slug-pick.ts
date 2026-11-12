// zzz1271 — WHICH company a screener.in search answer stands for. Pure.
//
// The results reader looked a symbol up on screener.in's search when the symbol had no page of its own, and took the FIRST
// result. The search is a fuzzy text search: "SHYAM" (a small BSE-only company with a board meeting on 12 Nov) answered
// Shyam Metalics (SHYAMMETL) and "ARUR" answered Karur Vysya Bank — so both large companies, which had reported on 1 Nov and
// 15 Oct, appeared as new BLOCKBUSTER / STRONG cards "today" under the small companies' symbols. A wrong company's figures
// under a symbol is the worst error this page can make, so the first result is never taken on trust:
//   1. a result whose page IS the symbol (slug = symbol) is the company;
//   2. otherwise only a company WITHOUT an exchange symbol of its own (its page is its BSE code — the case this look-up exists
//      for) can be the answer, and only when its name can be shortened to the symbol (the symbol's letters appear in the name
//      in order, starting with the name's first letter) and it is the ONLY such result;
//   3. anything else = no answer. A result that has its own different symbol (SHYAMMETL for "SHYAM") is another company.
export interface ScreenerSearchHit { url?: unknown; name?: unknown; company_name?: unknown }

const slugOf = (c: ScreenerSearchHit): string => /^\/company\/([^/]+)\//.exec(String(c?.url || ''))?.[1] || '';
const nameOf = (c: ScreenerSearchHit): string => String(c?.name || c?.company_name || '').trim();
const letters = (s: string): string => s.toUpperCase().replace(/&AMP;/g, '&').replace(/[^A-Z0-9]/g, '');

/** The symbol can be read as a shortening of the name: same first letter, and its letters appear in the name in order. */
export function symbolShortensName(symbol: string, name: string): boolean {
  const s = letters(symbol), n = letters(name);
  if (s.length < 2 || !n || s[0] !== n[0]) return false;
  let j = 0;
  for (let i = 0; i < n.length && j < s.length; i++) if (n[i] === s[j]) j++;
  return j === s.length;
}

export function pickScreenerHit(symbol: string, list: ReadonlyArray<ScreenerSearchHit>): { slug: string; name: string } | null {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym || !Array.isArray(list)) return null;
  const exact = list.find((c) => slugOf(c).toUpperCase() === sym);
  if (exact) return { slug: slugOf(exact), name: nameOf(exact) };
  const codeOnly = list.filter((c) => /^\d{5,7}$/.test(slugOf(c)) && symbolShortensName(sym, nameOf(c)));
  return codeOnly.length === 1 ? { slug: slugOf(codeOnly[0]), name: nameOf(codeOnly[0]) } : null;
}
