// ═══════════════════════════════════════════════════════════════════════════
// zzz1234 — RUN A SCREENER.IN QUERY ON OUR OWN DATA. Pure.
//
// A screener.in screen is a query like
//   Market Capitalization > 500 AND
//   Sales growth 3Years > 15 AND (Return on capital employed > 20 OR OPM > 18)
// The owner pastes it once on /screener-screens; it then runs on the columns
// lib/screener/screenerin-columns.ts works out for every company. Supported:
// AND / OR, brackets, > < >= <= = !=, numbers, + − × ÷ between columns.
// A column we do not have makes that condition FAIL for every company (as
// screener.in leaves out companies with no value) and is reported by name so
// the owner sees why a screen is empty.
// zzz1238 — also: "20%" (the % sign is dropped), coalesce(a, b), "Is not SME"
// (always true here: our India list is main-board NSE only) and "Is SME"
// (always false). Pledged percentage has no data here: a condition that uses
// it PASSES and is reported as "assumed", so a pledge gate does not empty a
// screen — the owner checks pledges himself.
// ═══════════════════════════════════════════════════════════════════════════
import { SCREENERIN_COLUMNS, SCREENERIN_QUERY_COLUMNS, type ScreenerInRow } from './screenerin-columns';

const ALIASES: Record<string, string> = {
  'market cap': 'Market Capitalization', 'mcap': 'Market Capitalization', 'current price': 'Current Price', 'price': 'Current Price',
  'pe': 'Price to Earning', 'p/e': 'Price to Earning', 'price to earnings': 'Price to Earning', 'roce': 'Return on capital employed',
  'debt to equity ratio': 'Debt to equity', 'promoter holding': 'Promoter holding', 'peg': 'PEG Ratio', 'opm latest year': 'OPM last year',
  'return over 3 months': 'Return over 3months', 'return over 1 year': 'Return over 1year', 'average roce 3years': 'Average return on capital employed 3Years',
  'ev/ebitda': 'EVEBITDA', 'ev to ebitda': 'EVEBITDA', 'price to book': 'Price to book value', 'dma200': 'DMA 200', 'dma50': 'DMA 50',
  'net profit preceding quarter': 'Profit after tax preceding quarter',
  'price to earnings ratio': 'Price to Earning', 'opm last quarter': 'OPM latest quarter', 'ebitda latest quarter': 'EBIDT latest quarter',
  'profit growth 3 years': 'Profit growth 3Years', 'sales growth 3 years': 'Sales growth 3Years', 'eps growth 3 years': 'EPS growth 3Years',
  'operating cash flow 3 years': 'Operating cash flow 3years', 'cash equivalent': 'Cash Equivalents', 'cash and equivalents': 'Cash Equivalents',
  'net block 3 years back': 'Net block 3Years back', 'debt 3 years back': 'Debt 3Years back', 'roe': 'Return on equity',
};
/** No data here — a condition using one of these passes and is reported as assumed. */
export const ASSUMED_PASS = new Set(['Pledged percentage']);
// longest names first, so "Sales growth 3Years" wins over "Sales growth"
const NAMES = [...[...SCREENERIN_COLUMNS, ...SCREENERIN_QUERY_COLUMNS].map((c) => [c.toLowerCase(), c] as const), ...Object.entries(ALIASES)].sort((a, b) => b[0].length - a[0].length);

type Tok = { k: 'num'; v: number } | { k: 'col'; v: string } | { k: 'op'; v: string } | { k: 'cmp'; v: string } | { k: 'and' } | { k: 'or' } | { k: '(' } | { k: ')' } | { k: 'bad'; v: string } | { k: 'bool'; v: boolean } | { k: 'fn'; v: 'coalesce' } | { k: ',' };

export function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let s = q.replace(/\r/g, ' ').trim();
  while (s.length) {
    s = s.replace(/^\s+/, '');
    if (!s) break;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(>=|<=|!=|<>|>|<|=)/))) { out.push({ k: 'cmp', v: m[1] === '<>' ? '!=' : m[1] }); s = s.slice(m[1].length); continue; }
    if ((m = s.match(/^is\s+not\s+sme\b/i))) { out.push({ k: 'bool', v: true }); s = s.slice(m[0].length); continue; }
    if ((m = s.match(/^is\s+sme\b/i))) { out.push({ k: 'bool', v: false }); s = s.slice(m[0].length); continue; }
    if ((m = s.match(/^coalesce\s*(?=\()/i))) { out.push({ k: 'fn', v: 'coalesce' }); s = s.slice(m[0].length); continue; }
    if (s[0] === ',') { out.push({ k: ',' }); s = s.slice(1); continue; }
    if (s[0] === '%') { s = s.slice(1); continue; }   // "20 %" = 20
    if ((m = s.match(/^(AND|OR)\b/i))) { out.push({ k: m[1].toUpperCase() === 'AND' ? 'and' : 'or' } as Tok); s = s.slice(m[1].length); continue; }
    if ((m = s.match(/^-?(\d+(\.\d*)?|\.\d+)/)) && !(out.length && ['num', 'col', ')'].includes(out[out.length - 1].k) && s[0] === '-')) { out.push({ k: 'num', v: parseFloat(m[0]) }); s = s.slice(m[0].length); continue; }
    if (s[0] === '(' || s[0] === ')') { out.push({ k: s[0] } as Tok); s = s.slice(1); continue; }
    if ('+-*/'.includes(s[0])) { out.push({ k: 'op', v: s[0] }); s = s.slice(1); continue; }
    const low = s.toLowerCase();
    const hit = NAMES.find(([n]) => low.startsWith(n) && !/[a-z0-9]/i.test(low[n.length] || ' '));
    if (hit) { out.push({ k: 'col', v: hit[1] }); s = s.slice(hit[0].length); continue; }
    // an unknown name: take words up to the next operator / comparison / AND / OR
    m = s.match(/^[^<>=!()+*/,]+?(?=\s*(>=|<=|!=|<>|>|<|=|\)|\(|\+|\*|\/|,|\bAND\b|\bOR\b|$))/i);
    const w = (m ? m[0] : s.split(/\s+/)[0]).trim();
    out.push({ k: 'bad', v: w }); s = s.slice(Math.max(1, (m ? m[0] : w).length));
  }
  return out;
}

type Num = (r: ScreenerInRow) => number | null;
type Pred = (r: ScreenerInRow) => boolean;
export interface CompiledQuery { test: Pred; columns: string[]; unknown: string[]; assumed: string[]; error: string | null }

export function compileQuery(q: string): CompiledQuery {
  const toks = tokenize(q);
  let i = 0;
  const columns = new Set<string>(), unknown = new Set<string>(), assumed = new Set<string>();
  let usesAssumed = false;
  const peek = () => toks[i];
  const fail = (msg: string): never => { throw new Error(msg); };
  const atom = (): Num => {
    const t = toks[i++];
    if (!t) fail('the query ends too early');
    if (t.k === 'num') { const v = t.v; return () => v; }
    if (t.k === 'col' && ASSUMED_PASS.has(t.v)) { assumed.add(t.v); usesAssumed = true; return () => null; }
    if (t.k === 'fn') {
      if (toks[i++]?.k !== '(') fail('coalesce needs brackets');
      const parts: Num[] = [sum()];
      while (peek()?.k === ',') { i++; parts.push(sum()); }
      if (toks[i++]?.k !== ')') fail('a bracket is not closed');
      return (r) => { for (const p of parts) { const v = p(r); if (v != null) return v; } return null; };
    }
    if (t.k === 'col') { const c = t.v; columns.add(c); return (r) => { const v = (r as any)[c]; return typeof v === 'number' && Number.isFinite(v) ? v : null; }; }
    if (t.k === 'bad') { unknown.add(t.v); return () => null; }
    if (t.k === '(') { const e = sum(); if (toks[i++]?.k !== ')') fail('a bracket is not closed'); return e; }
    if (t.k === 'op' && t.v === '-') { const a = atom(); return (r) => { const v = a(r); return v == null ? null : -v; }; }
    return fail(`unexpected "${(t as any).v ?? t.k}"`);
  };
  const product = (): Num => {
    let a = atom();
    while (peek()?.k === 'op' && ['*', '/'].includes((peek() as any).v)) {
      const op = (toks[i++] as any).v, b = atom(), x = a;
      a = (r) => { const p = x(r), q2 = b(r); if (p == null || q2 == null) return null; return op === '*' ? p * q2 : q2 === 0 ? null : p / q2; };
    }
    return a;
  };
  const sum = (): Num => {
    let a = product();
    while (peek()?.k === 'op' && ['+', '-'].includes((peek() as any).v)) {
      const op = (toks[i++] as any).v, b = product(), x = a;
      a = (r) => { const p = x(r), q2 = b(r); return p == null || q2 == null ? null : op === '+' ? p + q2 : p - q2; };
    }
    return a;
  };
  const cond = (): Pred => {
    // a bracketed group of conditions, or a comparison
    if (peek()?.k === '(') {
      const save = i;
      i++;
      try { const e = orExpr(); if (toks[i]?.k === ')') { i++; if (peek()?.k !== 'cmp' && peek()?.k !== 'op') return e; } } catch { /* not a group */ }
      i = save;
    }
    if (peek()?.k === 'bool') { const v = (toks[i++] as any).v as boolean; return () => v; }
    const before = usesAssumed; usesAssumed = false;
    const a = sum();
    const c = toks[i++];
    if (!c || c.k !== 'cmp') return fail('each condition needs a comparison (>, <, >=, <=, =)');
    const b = sum();
    const op = c.v;
    const assume = usesAssumed; usesAssumed = before;
    if (assume) return () => true;
    return (r) => {
      const x = a(r), y = b(r);
      if (x == null || y == null) return false;
      return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : op === '<=' ? x <= y : op === '=' ? Math.abs(x - y) < 1e-9 : Math.abs(x - y) >= 1e-9;
    };
  };
  const andExpr = (): Pred => { let a = cond(); while (peek()?.k === 'and') { i++; const b = cond(), x = a; a = (r) => x(r) && b(r); } return a; };
  const orExpr = (): Pred => { let a = andExpr(); while (peek()?.k === 'or') { i++; const b = andExpr(), x = a; a = (r) => x(r) || b(r); } return a; };
  try {
    if (!toks.length) return { test: () => false, columns: [], unknown: [], assumed: [], error: 'empty query' };
    const test = orExpr();
    if (i < toks.length) fail(`could not read from "${(toks[i] as any).v ?? toks[i].k}"`);
    return { test, columns: Array.from(columns), unknown: Array.from(unknown), assumed: Array.from(assumed), error: null };
  } catch (e: any) {
    return { test: () => false, columns: Array.from(columns), unknown: Array.from(unknown), assumed: Array.from(assumed), error: String(e?.message || e) };
  }
}
