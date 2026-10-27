// zzz1192 — Conviction Analytics: reads the Conviction Beats bench (India or USA) and answers the allocator's questions —
// which themes are really leading (breadth of filed earnings, margins, quality, price still reasonable, tape agreeing),
// which are crowded, which are only one company's story, and which names inside each theme are the cleanest to research
// first. Pure: no fetch, no storage. Every score is a sum of named parts, so a reader can see why.
//
// Rules a long-time allocator uses, written down:
//  · A theme is a theme only when several independent companies print it. One print is a company story.
//  · Lead with earnings and margins that are broad across the theme; price confirmation is the second witness, not the first.
//  · Pay attention to what is already paid for: a theme whose names have doubled since the print at P/E 80 is crowded.
//  · Quality filters the noise: profit backed by cash, returns on capital, debt that cannot sink the company.
//  · Concentrate in a few leading themes, two or three names each, and cap any one theme — themes turn together.

export type CaMarket = 'IN' | 'US';
export type CaTier = 'BLOCKBUSTER' | 'STRONG' | string;
export type CaMark = 'BUY' | 'WATCH' | 'NEUTRAL' | 'REJECTED' | null;

export interface CaRow {
  ticker: string; company: string; market: CaMarket;
  themeId: string | null; themeName: string; themeEmoji: string; tracked: boolean;
  industry: string | null;
  tier: CaTier; engineScore: number | null;
  salesYoY: number | null; profitYoY: number | null; epsYoY: number | null;
  opm: number | null; opmPrev: number | null;
  pe: number | null; roce: number | null; de: number | null; cashToProfit: number | null;
  mcap: number | null;   // ₹ Cr (IN) / $ M (US)
  filingDate: string | null; sincePrint: number | null; day1: number | null;
  tape: string | null;   // rotation verdict for the theme (BUY / EARLY BUY / HOLD / WATCH / TRIM / AVOID)
  mark: CaMark;
}

export interface CaCompany extends CaRow { score: number; plus: string[]; minus: string[]; peg: number | null; small: boolean }

export type CaStance = 'LEAD' | 'EMERGING' | 'CROWDED' | 'SINGLE' | 'WEAK' | 'NEUTRAL';
export interface CaTheme {
  key: string; name: string; emoji: string; tracked: boolean; tape: string | null;
  n: number; blockbusters: number; fresh30: number; prior: number;
  salesMed: number | null; profitMed: number | null; marginUpShare: number | null; roceMed: number | null;
  cashShare: number | null; peMed: number | null; pegMed: number | null; sinceMed: number | null; capMed: number | null;
  parts: { breadth: number; earnings: number; margins: number; quality: number; value: number; tape: number; freshness: number };
  score: number; stance: CaStance; why: string[];
  companies: CaCompany[];   // best first
  share: number;            // share of all names on the bench
}

export interface CaSummary {
  names: number; themes: number; trackedShare: number; blockbusterShare: number;
  salesMed: number | null; profitMed: number | null; peMed: number | null;
  topThemeShare: number; aligned: number; against: number;
  risks: string[];
}

export const SMALL_MID_CAP: Record<CaMarket, number> = { IN: 25_000, US: 10_000 };

export const STANCE_META: Record<CaStance, { word: string; color: string; hint: string }> = {
  LEAD:     { word: 'Leading',        color: '#16A34A', hint: 'Broad, filed earnings strength, margins rising, quality and price still reasonable — where to concentrate research.' },
  EMERGING: { word: 'Emerging',       color: '#0891B2', hint: 'New prints are arriving and the numbers are good, but breadth is still thin — a starter position at most until a third company confirms.' },
  CROWDED:  { word: 'Crowded',        color: '#D97706', hint: 'The earnings are real, but the shares already moved a lot or trade at rich multiples — much is paid for. Wait for a pause or a new print.' },
  SINGLE:   { word: 'One-company',    color: '#64748B', hint: 'Only one name on the bench — that is a company story, not yet a theme.' },
  WEAK:     { word: 'Weak',           color: '#DC2626', hint: 'Narrow or poor-quality earnings, or the market is selling the theme. Do not add here.' },
  NEUTRAL:  { word: 'Mixed',          color: '#64748B', hint: 'Nothing strong either way.' },
};

const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export function median(xs: Array<number | null | undefined>): number | null {
  const a = xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const share = (xs: boolean[]): number | null => (xs.length ? xs.filter(Boolean).length / xs.length : null);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const daysBetween = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const TAILWIND = (v: string | null) => v === 'BUY' || v === 'EARLY BUY';
const HEADWIND = (v: string | null) => v === 'AVOID' || v === 'TRIM';
const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;

/** Growth the multiple is paying for: the larger of profit and EPS growth, capped so a tiny base does not make anything look cheap. */
export function pegOf(r: Pick<CaRow, 'pe' | 'profitYoY' | 'epsYoY' | 'salesYoY'>): number | null {
  const pe = fin(r.pe); if (pe == null || pe <= 0) return null;
  const g = Math.min(100, Math.max(fin(r.epsYoY) ?? -1, fin(r.profitYoY) ?? -1, (fin(r.salesYoY) ?? -1) * 0.8));
  return g > 0 ? Math.round((pe / g) * 100) / 100 : null;
}

/** One company's research priority inside the bench (0–100), with every reason. */
export function scoreCompany(r: CaRow): CaCompany {
  const plus: string[] = []; const minus: string[] = [];
  let s = 40;
  if (r.tier === 'BLOCKBUSTER') { s += 14; plus.push('BLOCKBUSTER quarter'); } else if (r.tier === 'STRONG') { s += 8; plus.push('STRONG quarter'); }
  const sg = fin(r.salesYoY); const pg = fin(r.profitYoY) ?? fin(r.epsYoY);
  if (sg != null) { if (sg >= 30) { s += 8; plus.push(`sales ${pct(sg)}`); } else if (sg >= 15) { s += 4; plus.push(`sales ${pct(sg)}`); } else if (sg < 5) { s -= 6; minus.push(`sales only ${pct(sg)} — profit growth without sales growth rarely lasts`); } }
  if (pg != null) { if (pg >= 50) { s += 6; plus.push(`profit ${pct(pg)}`); } else if (pg >= 25) { s += 3; plus.push(`profit ${pct(pg)}`); } }
  const dm = r.opm != null && r.opmPrev != null ? r.opm - r.opmPrev : null;
  if (dm != null) { if (dm >= 3) { s += 7; plus.push(`margin +${dm.toFixed(1)}pt — operating leverage`); } else if (dm <= -3) { s -= 7; minus.push(`margin ${dm.toFixed(1)}pt — growth bought with price or cost`); } }
  const roce = fin(r.roce);
  if (roce != null) { if (roce >= 20) { s += 6; plus.push(`return on capital ${Math.round(roce)}%`); } else if (roce < 10) { s -= 5; minus.push(`return on capital only ${Math.round(roce)}%`); } }
  const c = fin(r.cashToProfit);
  if (c != null) { if (c >= 0.8) { s += 5; plus.push('profit backed by cash'); } else if (c < 0.5) { s -= 8; minus.push(`profit not backed by cash (${c.toFixed(2)})`); } }
  const de = fin(r.de);
  if (de != null) { if (de <= 0.3) { s += 3; plus.push('little debt'); } else if (de > 1.5) { s -= 8; minus.push(`heavy debt (debt ÷ equity ${de.toFixed(1)})`); } }
  const peg = pegOf(r); const pe = fin(r.pe);
  if (peg != null) { if (peg <= 1) { s += 9; plus.push(`P/E ${Math.round(pe!)} for the growth (PEG ${peg.toFixed(1)}) — not yet paid for`); } else if (peg <= 2) { s += 3; plus.push(`PEG ${peg.toFixed(1)}`); } else if (peg > 3) { s -= 7; minus.push(`PEG ${peg.toFixed(1)} — growth already priced`); } }
  if (pe != null && pe > 80) { s -= 5; minus.push(`P/E ${Math.round(pe)}`); }
  if (pe != null && pe <= 0) { s -= 4; minus.push('loss-making on a trailing basis'); }
  const mv = fin(r.sincePrint);
  if (mv != null) {
    if (mv > 80) { s -= 8; minus.push(`already ${pct(mv)} since the results — chasing`); }
    else if (mv >= 0 && mv <= 40) { s += 4; plus.push(`price confirms (${pct(mv)} since results)`); }
    else if (mv < -15) { s -= 6; minus.push(`market disagrees (${pct(mv)} since results)`); }
  }
  if (TAILWIND(r.tape)) { s += 6; plus.push(`theme rated ${r.tape} on the rotation board`); }
  else if (HEADWIND(r.tape)) { s -= 6; minus.push(`theme rated ${r.tape} on the rotation board — tape against`); }
  const small = r.mcap != null && r.mcap <= SMALL_MID_CAP[r.market];
  return { ...r, score: Math.round(clamp(s)), plus, minus, peg, small };
}

/** Group the bench into themes and read each one. `today` = YYYY-MM-DD. */
export function analyseBench(rows: CaRow[], today: string): { themes: CaTheme[]; companies: CaCompany[]; summary: CaSummary } {
  const companies = rows.map(scoreCompany).sort((a, b) => b.score - a.score);
  const groups = new Map<string, CaCompany[]>();
  for (const c of companies) {
    const k = c.themeId ? `t:${c.themeId}` : `i:${(c.industry || 'Unclassified').toLowerCase()}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(c);
  }
  const total = companies.length || 1;
  const themes: CaTheme[] = [];
  for (const [key, cs] of groups) {
    const first = cs[0];
    const n = cs.length;
    const live = cs.filter((c) => c.mark !== 'REJECTED');
    const fresh30 = cs.filter((c) => c.filingDate && daysBetween(today, c.filingDate) <= 30).length;
    const salesMed = median(cs.map((c) => c.salesYoY));
    const profitMed = median(cs.map((c) => c.profitYoY ?? c.epsYoY));
    const marginUpShare = share(cs.filter((c) => c.opm != null && c.opmPrev != null).map((c) => (c.opm as number) - (c.opmPrev as number) > 0));
    const roceMed = median(cs.map((c) => c.roce));
    const cashShare = share(cs.filter((c) => c.cashToProfit != null).map((c) => (c.cashToProfit as number) >= 0.8));
    const peMed = median(cs.map((c) => (c.pe != null && c.pe > 0 ? c.pe : null)));
    const pegMed = median(cs.map((c) => c.peg));
    const sinceMed = median(cs.map((c) => c.sincePrint));
    const capMed = median(cs.map((c) => c.mcap));
    const tape = first.tape;
    // the parts, each 0–100
    const breadth = clamp(n >= 6 ? 100 : n === 5 ? 90 : n === 4 ? 80 : n === 3 ? 65 : n === 2 ? 40 : 15) * (0.8 + 0.2 * (cs.filter((c) => c.tier === 'BLOCKBUSTER').length / n));
    const earnings = clamp(((salesMed ?? 10) / 40) * 50 + ((profitMed ?? 15) / 80) * 50);
    const margins = marginUpShare == null ? 50 : marginUpShare * 100;
    const quality = clamp(((roceMed ?? 15) / 25) * 55 + (cashShare == null ? 0.5 : cashShare) * 45);
    const value = clamp(pegMed == null ? (peMed == null ? 50 : 100 - (peMed - 15) * 1.2) : 100 - (pegMed - 0.8) * 35) * (sinceMed != null && sinceMed > 60 ? 0.7 : 1);
    const tapeP = tape == null ? 50 : TAILWIND(tape) ? 100 : HEADWIND(tape) ? 0 : tape === 'HOLD' ? 60 : 45;
    const freshness = clamp((fresh30 / n) * 100);
    const parts = { breadth: Math.round(breadth), earnings: Math.round(earnings), margins: Math.round(margins), quality: Math.round(quality), value: Math.round(value), tape: Math.round(tapeP), freshness: Math.round(freshness) };
    const score = Math.round(0.22 * breadth + 0.22 * earnings + 0.14 * margins + 0.14 * quality + 0.14 * value + 0.09 * tapeP + 0.05 * freshness);
    const why: string[] = [];
    why.push(`${n} ${n === 1 ? 'company' : 'companies'} printed it${fresh30 ? ` (${fresh30} in the last 30 days)` : ''}`);
    if (salesMed != null || profitMed != null) why.push(`median sales ${salesMed != null ? pct(salesMed) : '—'}, profit ${profitMed != null ? pct(profitMed) : '—'}`);
    if (marginUpShare != null) why.push(`margins up at ${Math.round(marginUpShare * 100)}% of them`);
    if (pegMed != null) why.push(`median PEG ${pegMed.toFixed(1)}`); else if (peMed != null) why.push(`median P/E ${Math.round(peMed)}`);
    if (sinceMed != null) why.push(`median ${pct(sinceMed)} since results`);
    if (tape) why.push(`rotation board: ${tape}`);
    const crowded = (sinceMed != null && sinceMed > 50) || (pegMed != null && pegMed > 3) || (peMed != null && peMed > 70);
    let stance: CaStance;
    if (n === 1) stance = 'SINGLE';
    else if (HEADWIND(tape) || score < 40 || (cashShare != null && cashShare < 0.34 && (roceMed ?? 0) < 12)) stance = 'WEAK';
    else if (crowded) stance = 'CROWDED';
    else if (score >= 62 && n >= 3) stance = 'LEAD';
    else if (score >= 52 && (n === 2 || fresh30 / n >= 0.5)) stance = 'EMERGING';
    else stance = 'NEUTRAL';
    themes.push({
      key, name: first.themeName, emoji: first.themeEmoji, tracked: first.tracked, tape,
      n, blockbusters: cs.filter((c) => c.tier === 'BLOCKBUSTER').length, fresh30, prior: n - fresh30,
      salesMed, profitMed, marginUpShare, roceMed, cashShare, peMed, pegMed, sinceMed, capMed,
      parts, score, stance, why, companies: [...live, ...cs.filter((c) => c.mark === 'REJECTED')], share: n / total,
    });
  }
  const ORDER: Record<CaStance, number> = { LEAD: 0, EMERGING: 1, CROWDED: 2, NEUTRAL: 3, SINGLE: 4, WEAK: 5 };
  themes.sort((a, b) => ORDER[a.stance] - ORDER[b.stance] || b.score - a.score || b.n - a.n);

  const risks: string[] = [];
  const multi = themes.filter((t) => t.n >= 2);
  const top = [...themes].sort((a, b) => b.n - a.n)[0];
  if (top && top.share >= 0.3 && companies.length >= 8) risks.push(`${Math.round(top.share * 100)}% of the bench is one theme (${top.name}) — names in one theme fall together; cap it when sizing.`);
  const chased = companies.filter((c) => (c.sincePrint ?? 0) > 80);
  if (chased.length) risks.push(`${chased.length} ${chased.length === 1 ? 'name has' : 'names have'} run more than 80% since results (${chased.slice(0, 5).map((c) => c.ticker).join(', ')}) — the print is real, the entry is not.`);
  const noCash = companies.filter((c) => c.cashToProfit != null && c.cashToProfit < 0.5);
  if (noCash.length) risks.push(`${noCash.length} ${noCash.length === 1 ? 'name reports' : 'names report'} profit not backed by cash (${noCash.slice(0, 5).map((c) => c.ticker).join(', ')}) — check receivables and inventory before believing the quarter.`);
  const levered = companies.filter((c) => (c.de ?? 0) > 1.5);
  if (levered.length) risks.push(`${levered.length} heavily indebted (${levered.slice(0, 5).map((c) => c.ticker).join(', ')}).`);
  const against = companies.filter((c) => HEADWIND(c.tape));
  if (against.length) risks.push(`${against.length} ${against.length === 1 ? 'name sits' : 'names sit'} in themes the rotation board rates TRIM / AVOID — good quarters nobody is paying for yet.`);
  if (!multi.length && companies.length) risks.push('No theme has two or more names yet — every idea here is a company story; size accordingly.');

  const summary: CaSummary = {
    names: companies.length, themes: themes.length,
    trackedShare: companies.length ? companies.filter((c) => c.tracked).length / companies.length : 0,
    blockbusterShare: companies.length ? companies.filter((c) => c.tier === 'BLOCKBUSTER').length / companies.length : 0,
    salesMed: median(companies.map((c) => c.salesYoY)), profitMed: median(companies.map((c) => c.profitYoY ?? c.epsYoY)), peMed: median(companies.map((c) => (c.pe != null && c.pe > 0 ? c.pe : null))),
    topThemeShare: top ? top.share : 0,
    aligned: companies.filter((c) => TAILWIND(c.tape)).length, against: against.length,
    risks,
  };
  return { themes, companies, summary };
}

/** A research shortlist: the leading / emerging themes, best two or three non-rejected names each, with a theme cap. */
export function shortlist(themes: CaTheme[], opts: { maxThemes?: number; perTheme?: number; smallMidOnly?: boolean } = {}): Array<{ theme: CaTheme; picks: CaCompany[]; cap: number }> {
  const maxThemes = opts.maxThemes ?? 5; const per = opts.perTheme ?? 3;
  const ok = themes.filter((t) => t.stance === 'LEAD' || t.stance === 'EMERGING').slice(0, maxThemes);
  return ok.map((t) => {
    const picks = t.companies.filter((c) => c.mark !== 'REJECTED' && c.score >= 50 && (!opts.smallMidOnly || c.small || c.mcap == null)).slice(0, t.stance === 'LEAD' ? per : Math.min(2, per));
    return { theme: t, picks, cap: t.stance === 'LEAD' ? 25 : 10 };
  }).filter((x) => x.picks.length > 0);
}

/** Two-by-two: earnings strength × price room. */
export function themeQuadrant(t: CaTheme): 'STRONG_ROOM' | 'STRONG_PRICED' | 'SOFT_ROOM' | 'SOFT_PRICED' {
  const strong = (t.parts.earnings + t.parts.margins + t.parts.breadth) / 3 >= 55;
  const room = t.parts.value >= 50;
  return strong ? (room ? 'STRONG_ROOM' : 'STRONG_PRICED') : (room ? 'SOFT_ROOM' : 'SOFT_PRICED');
}
