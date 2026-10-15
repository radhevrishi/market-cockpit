// ═══════════════════════════════════════════════════════════════════════════
// zzz1059 — US Top Movers: the catalyst rules that bring the US WHY up to India's (lib/movers-attribution.ts).
// Pure (no I/O): every input is a list or a document's text, so each rule is tested on fixtures.
//
//   1. INDUSTRY CLUSTERS  — ≥ 2 top movers, or ≥ 3 names in the wider scanner universe, in the same INDUSTRY (TradingView's
//      `industry`, e.g. "Marine Shipping", "Semiconductors") moving the same way ≥ 3%, with the peers' moves not tiny next to
//      this one (India's 0.35× magnitude gate). The broad sector rule stays as the weaker fallback.
//   2. HEADLINE CHECKS    — a headline whose words point the OTHER way to the move ("Sets New 1-Year High" on a stock down 7%)
//      is rejected; among the rest the most CAUSAL one wins (earnings / guidance > deal / FDA > contract / offering / index >
//      analyst action > anything else); analyst actions are labelled "analyst action (Morgan Stanley upgrade)".
//   3. 8-K CONTENT        — what an 8-K actually announced: the press release's headline (EX-99.1, the text between
//      "Exhibit 99.1" and the dateline), else the body's "issued a press release announcing that …" sentence, else the
//      Item 1.01 "entered into … with <counterparty>" sentence. Never invented: null when none of these is stated.
//   4. INSIDER TRADES     — a Form 4's open-market buys / sells, summed ("CEO Jane Doe sold $3.1M").
//   5. EARNINGS DUE       — "earnings due Oct 20 (after the close)" as a weak context line.
// ═══════════════════════════════════════════════════════════════════════════

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── 1. INDUSTRY CLUSTERS ────────────────────────────────────────────────────

export const INDUSTRY_MOVE_MIN_PCT = 3;
/** India's peer-sympathy magnitude gate (movers-attribution PATCH 0884): the peers' median move ≥ 0.35 × this stock's. */
export const INDUSTRY_MAGNITUDE_RATIO = 0.35;

export interface IndustryName { ticker: string; industry?: string | null; chg: number | null | undefined }
export interface IndustryStat { industry: string; n: number; median: number; up: Array<{ t: string; chg: number }>; down: Array<{ t: string; chg: number }> }

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per industry: how many names, the median move, and the names up / down ≥ `minPct` (biggest first). */
export function industryStats(rows: IndustryName[], minPct = INDUSTRY_MOVE_MIN_PCT): Map<string, IndustryStat> {
  const acc = new Map<string, { chgs: number[]; up: Array<{ t: string; chg: number }>; down: Array<{ t: string; chg: number }>; seen: Set<string> }>();
  for (const r of rows) {
    const ind = typeof r.industry === 'string' ? r.industry.trim() : '';
    if (!ind || !r.ticker || !fin(r.chg)) continue;
    const a = acc.get(ind) || { chgs: [], up: [], down: [], seen: new Set<string>() };
    if (a.seen.has(r.ticker)) continue;
    a.seen.add(r.ticker);
    a.chgs.push(r.chg);
    if (r.chg >= minPct) a.up.push({ t: r.ticker, chg: r.chg });
    else if (r.chg <= -minPct) a.down.push({ t: r.ticker, chg: r.chg });
    acc.set(ind, a);
  }
  const out = new Map<string, IndustryStat>();
  for (const [industry, a] of acc) {
    out.set(industry, {
      industry, n: a.chgs.length, median: Math.round(median(a.chgs) * 100) / 100,
      up: a.up.sort((x, y) => y.chg - x.chg), down: a.down.sort((x, y) => x.chg - y.chg),
    });
  }
  return out;
}

export interface IndustryCluster {
  industry: string;
  /** same-direction names ≥ 3%, this one included, biggest first */
  names: Array<{ t: string; chg: number }>;
  /** of them, how many are on the top-movers lists */
  topCount: number;
  n: number;
  median: number;
  confidence: 'MEDIUM' | 'LOW';
  text: string;
}

const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;

/**
 * The industry-cluster WHY for one mover, or null. Qualifies when ≥ 2 names on the top-movers lists, or ≥ 3 names in the
 * universe, sit in the same industry and moved the same way ≥ 3% — and the OTHER names' median move is at least 0.35× this
 * one's (a 30% faller is not explained by peers down 3%). MEDIUM when ≥ 3 names cluster and the whole industry's median
 * points the same way by ≥ 1%; LOW otherwise.
 */
export function industryCluster(
  m: { ticker: string; chg: number; industry: string | null | undefined },
  stats: Map<string, IndustryStat>,
  topTickers: Set<string>,
  minPct = INDUSTRY_MOVE_MIN_PCT,
): IndustryCluster | null {
  const ind = typeof m.industry === 'string' ? m.industry.trim() : '';
  if (!ind || !fin(m.chg) || Math.abs(m.chg) < minPct) return null;
  const st = stats.get(ind);
  if (!st) return null;
  const up = m.chg > 0;
  const same = (up ? st.up : st.down).slice();
  if (!same.some((x) => x.t === m.ticker)) same.push({ t: m.ticker, chg: m.chg });
  // the names on the top-movers lists first (they are what the reader sees), then the rest of the industry; biggest first
  same.sort((a, b) => Number(topTickers.has(b.t)) - Number(topTickers.has(a.t)) || Math.abs(b.chg) - Math.abs(a.chg));
  const topCount = same.filter((x) => topTickers.has(x.t)).length;
  const share = st.n > 0 ? same.length / st.n : 0;
  // the industry as a whole moving the OTHER way (ATEN −6% while IT services rose +3.3%) is not an industry move
  if (Math.sign(st.median) === -Math.sign(m.chg) && Math.abs(st.median) >= 1) return null;
  const medSame = Math.sign(st.median) === Math.sign(m.chg) && Math.abs(st.median) >= 0.5;
  if (!(topCount >= 2 || (same.length >= 3 && (medSame || share >= 0.2)))) return null;
  const peers = same.filter((x) => x.t !== m.ticker).map((x) => Math.abs(x.chg));
  if (!peers.length || median(peers) < INDUSTRY_MAGNITUDE_RATIO * Math.abs(m.chg)) return null;
  const shown = same.slice(0, 4);
  const lo = Math.min(...shown.map((x) => Math.abs(x.chg))), hi = Math.max(...shown.map((x) => Math.abs(x.chg)));
  const range = Math.round(lo) === Math.round(hi) ? `${Math.round(hi)}%` : `${Math.round(lo)}–${Math.round(hi)}%`;
  const medOk = Math.sign(st.median) === Math.sign(m.chg) && Math.abs(st.median) >= 1;
  const confidence: IndustryCluster['confidence'] = same.length >= 3 && medOk ? 'MEDIUM' : 'LOW';
  const dir = up ? 'up' : 'down';
  const med = st.n >= 3 ? `industry median ${signed(st.median)}` : '';
  // a few names: "FRO, DHT, ECO all down 6–7%"; a whole-industry move: "106 of 174 names up ≥3% — biggest APPN, MNTN … (10–14%)"
  const text = same.length <= 4
    ? `industry move — ${ind}: ${shown.map((x) => x.t).join(', ')} ${shown.length > 1 ? 'all ' : ''}${dir} ${range}${st.n >= 3 ? ` (${same.length} of ${st.n} names ≥${minPct}%; ${med})` : ''}`
    : `industry move — ${ind}: ${same.length} of ${st.n} names ${dir} ≥${minPct}%${med ? ` (${med})` : ''} · ${shown.map((x) => x.t).join(', ')} ${dir} ${range}`;
  return { industry: ind, names: same, topCount, n: st.n, median: st.median, confidence, text };
}

// ── 2. HEADLINES ────────────────────────────────────────────────────────────

const UP_WORDS = /\b(?:new (?:\d{1,2}[- ](?:month|week|year) |all[- ]time |record |52[- ]week |multi[- ]year )?highs?|record high|all[- ]time high|hits? (?:a )?(?:new )?high|soar(?:s|ed|ing)?|surg(?:e|es|ed|ing)|jump(?:s|ed|ing)?|rall(?:y|ies|ied|ying)|spik(?:e|es|ed)|skyrocket(?:s|ed)?|climb(?:s|ed|ing)?|rises?|rose|rising|gain(?:s|ed)?|pops?|popped|upgrade[sd]?|raises? (?:[\w-]+ ){0,3}(?:guidance|outlook|forecast)|raises? (?:price )?target|beats?|tops? estimates|lifts? (?:[\w-]+ ){0,3}(?:guidance|outlook))\b/i;
const DOWN_WORDS = /\b(?:new (?:\d{1,2}[- ](?:month|week|year) |52[- ]week |multi[- ]year )?lows?|hits? (?:a )?(?:new )?low|plung(?:e|es|ed|ing)|tumbl(?:e|es|ed|ing)|sink(?:s|ing)?|sank|slump(?:s|ed)?|slid(?:e|es|ing)?|drop(?:s|ped|ping)?|fall(?:s|ing)?|fell|declin(?:e|es|ed|ing)|crash(?:es|ed)?|tank(?:s|ed)?|downgrade[sd]?|(?:cuts?|lowers?|reduces?|slashes?) (?:[\w-]+ ){0,3}(?:guidance|outlook|forecast)|(?:cuts?|lowers?) (?:price )?target|misses|missed|warns?)\b/i;

/** Which way a headline says the stock (or the news) points: 'up', 'down', or null when it says neither (or both). */
export function headlineDirection(title: string): 'up' | 'down' | null {
  const t = String(title || '');
  // "price target lowered/raised" — the target word order flips
  const tgtUp = /\b(?:price )?target (?:raised|lifted|increased|boosted)\b/i.test(t);
  const tgtDn = /\b(?:price )?target (?:lowered|cut|reduced|trimmed)\b/i.test(t);
  const up = UP_WORDS.test(t) || tgtUp;
  const dn = DOWN_WORDS.test(t) || tgtDn;
  if (up && !dn) return 'up';
  if (dn && !up) return 'down';
  return null;
}

/** True when the headline's direction contradicts the move (a "new high" on a faller, a "plunge" on a riser). */
export const contradictsMove = (title: string, chg: number): boolean => {
  const d = headlineDirection(title);
  return (d === 'up' && chg < 0) || (d === 'down' && chg > 0);
};

const BROKERS = [
  'Morgan Stanley', 'Goldman Sachs', 'Goldman', 'JPMorgan', 'J.P. Morgan', 'JP Morgan', 'Bank of America', 'BofA Securities', 'BofA', 'Citigroup', 'Citi',
  'Barclays', 'UBS', 'Wells Fargo', 'Deutsche Bank', 'Jefferies', 'Mizuho', 'Piper Sandler', 'KeyBanc', 'Raymond James', 'Needham', 'Oppenheimer',
  'Stifel', 'TD Cowen', 'Cowen', 'Truist', 'Evercore ISI', 'Evercore', 'Bernstein', 'RBC Capital', 'RBC', 'BMO Capital', 'BMO', 'Wedbush', 'Benchmark',
  'H.C. Wainwright', 'HC Wainwright', 'Cantor Fitzgerald', 'Cantor', 'B. Riley', 'B.Riley', 'Craig-Hallum', 'Loop Capital', 'Baird', 'William Blair', 'Northland',
  'Rosenblatt', 'Canaccord Genuity', 'Canaccord', 'Lake Street', 'JMP', 'Citizens', 'Guggenheim', 'Macquarie', 'Morningstar', 'Argus', 'D.A. Davidson', 'DA Davidson',
  'Susquehanna', 'Wolfe Research', 'Wolfe', 'Seaport', 'Telsey', 'Maxim', 'Ladenburg', 'Leerink', 'Chardan', 'Roth Capital', 'Roth', 'Freedom Capital Markets',
  'Freedom Broker', 'Bank of America Securities', 'Scotiabank', 'Redburn', 'HSBC', 'Nomura', 'CICC', 'Daiwa', 'Societe Generale', 'BNP Paribas', 'Exane',
  'Berenberg', 'Kepler', 'Melius', 'Moffett', 'Rothschild', 'Bernstein SocGen', 'Capital One', 'Compass Point', 'Keefe Bruyette', 'KBW', 'Janney', 'Stephens',
  'Hovde', 'Zacks', 'Northcoast', 'Clear Street', 'Alliance Global', 'Ascendiant', 'EF Hutton', 'Brookline', 'Lucid Capital', 'Mizuho Securities',
];
const BROKER_RE = new RegExp(`\\b(${BROKERS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

export interface AnalystAction { firm: string | null; action: string }

/** "Morgan Stanley upgrades X" → { firm: 'Morgan Stanley', action: 'upgrade' }. Null when the headline is not an analyst action. */
export function analystAction(title: string): AnalystAction | null {
  const t = String(title || '');
  let action: string | null = null;
  if (/\bupgrad(?:e|es|ed|ing)\b/i.test(t)) action = 'upgrade';
  else if (/\bdowngrad(?:e|es|ed|ing)\b/i.test(t)) action = 'downgrade';
  else if (/\b(?:initiat(?:e|es|ed|ing)|starts?|launch(?:es|ed)?|resum(?:e|es|ed))\b.{0,30}\bcoverage\b|\bcoverage\b.{0,20}\b(?:initiated|started|resumed)\b|\binitiates?\b.{0,40}\b(?:buy|sell|hold|overweight|underweight|outperform|neutral)\b/i.test(t)) action = 'coverage started';
  else if (/\b(?:price )?target (?:raised|lifted|increased|boosted)\b|\b(?:raises?|lifts?|boosts?|hikes?) (?:[\w.&' -]{0,40} )?(?:price )?target\b/i.test(t)) action = 'target raised';
  else if (/\b(?:price )?target (?:lowered|cut|reduced|trimmed)\b|\b(?:cuts?|lowers?|trims?|reduces?|slashes?) (?:[\w.&' -]{0,40} )?(?:price )?target\b/i.test(t)) action = 'target cut';
  else if (/\b(?:reiterat(?:e|es|ed)|maintain(?:s|ed)?|affirm(?:s|ed)?)\b.{0,40}\b(?:rating|buy|sell|hold|overweight|outperform|neutral|underweight)\b/i.test(t)) action = 'rating reiterated';
  if (!action) return null;
  const firm = BROKER_RE.exec(t)?.[1] || null;
  if (!firm && !/\banalyst|\brating\b|\bprice target\b|\bcoverage\b/i.test(t)) return null;
  return { firm, action };
}

/** Headlines ABOUT an upcoming or old report — a preview, a transcript, a date — are never the reason for today's move. */
export const PREVIEW_OR_TRANSCRIPT = /\b(?:preview|transcript|reports? (?:next week|on (?:mon|tue|wed|thu|fri)\w*|tomorrow)|to report|set to report|scheduled to report|earnings (?:date|call (?:scheduled|date))|ahead of (?:its |q[1-4] )?(?:earnings|results|report)|what to (?:expect|watch)|expects? earnings (?:growth|decline)|est\.\s?\$|earnings? (?:on deck|this week|next week))\b/i;

/** How causal a headline is: lower is better. 9 = nothing causal in the words. */
export function headlineRank(title: string): number {
  const t = String(title || '');
  if (PREVIEW_OR_TRANSCRIPT.test(t)) return 9;
  if (/\b(?:earnings|results|quarter(?:ly)?|q[1-4]\b|eps|revenue|sales|profit|loss|guidance|outlook|forecast|preliminary|pre-?announce)/i.test(t)) return 0;
  if (/\b(?:fda|approv\w*|clearance|pdufa|phase (?:1|2|3|i{1,3})|trial|topline|(?:clinical|trial|topline|interim) data|data readout|crl|complete response|breakthrough designation|orphan)\b/i.test(t)) return 1;
  if (/\b(?:acqui\w+|merger|merge|buyout|take[- ]private|to be acquired|deal|bid|tender offer|divest\w*|spin[- ]?off|strategic (?:review|alternatives)|activist|stake)\b/i.test(t)) return 1;
  if (/\b(?:contract|award\w*|order|partnership|agreement|collaborat\w+|licens\w+|wins?|selected)\b/i.test(t)) return 2;
  if (/\b(?:offering|priced|pricing|private placement|convertible|notes due|dilut\w+|shelf|atm program|buyback|repurchase|dividend|split)\b/i.test(t)) return 2;
  if (/\b(?:s&p (?:500|midcap|smallcap|400|600)|russell (?:1000|2000|3000)|index (?:addition|inclusion|deletion)|to join|added to|removed from|join the)\b/i.test(t)) return 2;
  if (/\b(?:lawsuit|sued|probe|investigation|subpoena|recall|halt|delist|short seller|short report|fraud|ceo (?:resign|depart|exit|steps)|resigns?|layoffs?|restructur\w+|bankruptcy|chapter 11|default)\b/i.test(t)) return 2;
  if (/\b(?:sells?|sold|buys?|bought|insider|selling stockholder|secondary)\b.{0,60}\b(?:shares|stock|stake|\$)/i.test(t)) return 3;
  if (/\b(?:trump|white house|administration|government|federal|pentagon|department of (?:defense|energy|commerce|war)|executive order|tariffs?|sanctions?|ban(?:s|ned)?|subsid\w+|grants?|chips act|policy)\b/i.test(t)) return 3;
  if (analystAction(t)) return 4;
  return 9;
}

export interface HeadlineLite { title: string; url: string; date: string; source: string | null }

/**
 * The headline that best explains the move among those already dated in the window: direction-contradicting ones
 * dropped (counted), then the most causal, then the newest. `ok` is the caller's own filter (price talk, other company…).
 */
export function pickHeadline<T extends HeadlineLite>(items: T[], chg: number, ok: (x: T) => boolean): { pick: T | null; rank: number; contradicted: number } {
  let contradicted = 0;
  const cands: Array<{ x: T; r: number }> = [];
  for (const x of items) {
    if (!x || !x.title || !ok(x)) continue;
    if (contradictsMove(x.title, chg)) { contradicted++; continue; }
    cands.push({ x, r: headlineRank(x.title) });
  }
  cands.sort((a, b) => a.r - b.r || String(b.x.date).localeCompare(String(a.x.date)));
  return { pick: cands[0]?.x ?? null, rank: cands[0]?.r ?? 9, contradicted };
}

/** "analyst action (Morgan Stanley upgrade) — <headline>" when the headline is an analyst action; else null. */
export function analystWhyText(title: string): string | null {
  const a = analystAction(title);
  if (!a) return null;
  return `analyst action (${a.firm ? `${a.firm} ` : ''}${a.action}) — ${title}`;
}

// ── 3. WHAT AN 8-K ANNOUNCED ────────────────────────────────────────────────

const MONTHS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
// "REDWOOD CITY, Calif., October 14, 2026 –", "San Francisco, October 15, 2026 —", "NEW YORK, Oct. 15, 2026 /PRNewswire/ --"
const DATELINE = new RegExp(String.raw`(?:^|\s)(?:[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,3}\s*,\s*(?:[A-Z][A-Za-z.]*\.?(?:\s[A-Z][A-Za-z.]*)?\s*,\s*)?)?(?:${MONTHS})\.?\s+\d{1,2}\s*,\s*\d{4}\b(?:\s*\/[^/]{2,40}\/)?\s*(?:\(\s*[A-Z][A-Za-z .]+\)\s*)?[-–—]{1,2}`);
const HEAD_VERB = /\b(?:announce[sd]?|reports?|reported|provides?|receives?|received|presents?|enters?|entered|completes?|completed|launch(?:es|ed)?|highlights?|secures?|secured|achieves?|unveils?|initiates?|doses?|signs?|signed|expands?|appoints?|names?|prices?|priced|closes?|closed|declares?|updates?|confirms?|issues?|lowers?|raises?|reaffirms?|withdraws?|files?|wins?|awarded|acquires?|agrees?|to acquire|to be acquired|refinanc\w+|resubmission|approval|approves?)\b/i;

const sentenceCase = (s: string): string => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return s;
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upper < 0.7) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
};

const clip = (s: string, n = 170): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.lastIndexOf(' ', n - 2);
  return `${t.slice(0, cut > n * 0.6 ? cut : n - 1)}…`;
};

/** Cut a Title-Case headline before its sub-headline: "… in Tumor Hyperinsulinism Topline results expected mid-December"
 *  → "… in Tumor Hyperinsulinism"; an ALL-CAPS headline ends where mixed case starts. */
function cutSubHeadline(head: string): string {
  const w = head.split(' ');
  const isCaps = (x: string) => /[A-Z]/.test(x) && x === x.toUpperCase();
  if (w.length >= 4 && w.slice(0, 4).every((x) => isCaps(x) || /^[\d$%.,&–—-]+$/.test(x))) {
    let i = 0;
    while (i < w.length && (isCaps(w[i]) || /^[\d$%.,&–—()-]+$/.test(w[i]))) i++;
    return w.slice(0, i).join(' ');
  }
  const SMALL = /^(?:a|an|and|as|at|by|for|from|in|into|of|on|or|over|per|the|to|vs\.?|via|with|its|their|is|are|be)$/;
  const lowerWord = (x: string) => /^[a-z]/.test(x) && !SMALL.test(x);
  for (let i = 4; i + 2 < w.length; i++) {
    if (/^[A-Z]/.test(w[i]) && lowerWord(w[i + 1]) && (lowerWord(w[i + 2]) || SMALL.test(w[i + 2]))) return w.slice(0, i).join(' ');
  }
  return head;
}

/** Drop footnote markers ("revenue 1 is now expected", "EBITDA 2 expected") and bullet glyphs. */
const unfoot = (s: string) => s.replace(/(\b[A-Za-z]{3,})\s\d\s(?=[a-z(])/g, '$1 ').replace(/^[•●▪\s-]+/, '').trim();

/** The first bullet of the release when it states a figure ("Third-quarter revenue is now expected to be $65 million to
 *  $125 million") — the substance a headline like "Provides Update to Third-Quarter Expectations" leaves out. */
function firstFigureBullet(t: string, from: number): string | null {
  const rest = t.slice(from, from + 1_500);
  const b = /•\s*([^•]{20,260}?)(?=\s*•|\s+[A-Z][A-Za-z ]{2,40},\s|$)/.exec(rest);
  if (!b) return null;
  const s = unfoot(b[1]);
  return /\$\s?\d|\d\s?%|\bper share\b/.test(s) ? clip(s, 150) : null;
}

/** The press release's own headline: the text between "Exhibit 99.1" and the dateline — or, for a release with no
 *  dateline (FMC's "News Release … For Release: Immediate … FMC Corporation Provides Update …"), the capitalised run that
 *  holds the headline verb. With the first figure bullet when the headline states no figure. Null when not found. */
export function releaseHeadline(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').slice(0, 6_000);
  const exM = /\bExhibit\s+99\.?\d*\b/gi;
  let start = 0;
  for (let m = exM.exec(t); m && m.index < 400; m = exM.exec(t)) start = m.index + m[0].length;
  const dl = DATELINE.exec(t.slice(start));
  let head: string | null = null;
  let after = 0;
  if (dl && dl.index < 900) {
    head = t.slice(start, start + dl.index).replace(/\b(?:FOR IMMEDIATE RELEASE|PRESS RELEASE|NEWS RELEASE|Investor Contact:?.*$)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    after = start + dl.index;
    if (head.length < 15 || !HEAD_VERB.test(head)) head = null;
  }
  if (!head) {
    // no dateline: the headline verb, the capitalised words before it (the company), up to a bullet / sentence end
    const region = t.slice(start, start + 1_500);
    const toks = region.split(' ');
    let vi = -1;
    for (let j = 1; j < toks.length; j++) if (/^[A-Z]/.test(toks[j]) && HEAD_VERB.test(toks[j])) { vi = j; break; }
    if (vi < 0) return null;
    let k = vi;
    while (k > 0 && vi - k < 6 && /^[A-Z][A-Za-z&.,'’-]*$/.test(toks[k - 1]) && !/[@:]/.test(toks[k - 1])) k--;
    if (k === vi) return null;                                // no subject before the verb: not a headline
    const tail = toks.slice(vi).join(' ').split(/\s•|\.\s|\s[-–—]\s/)[0];
    head = `${toks.slice(k, vi).join(' ')} ${tail}`.trim();
    after = start + toks.slice(0, vi).join(' ').length + 1 + tail.length;
    if (head.length < 15) return null;
  }
  head = cutSubHeadline(sentenceCase(cutSubHeadline(head)));
  const bullet = /\d/.test(head) ? null : firstFigureBullet(t, after);
  return clip(bullet ? `${clip(head, 150)} — ${bullet}` : head, bullet ? 300 : 170);
}

/** "On October 15, 2026, Aquestive … issued a press release announcing that the FDA has acknowledged …" → the announcement. */
export function bodyAnnouncement(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ');
  const sec = t.search(/\bItem\s+(?:7\.01|8\.01|1\.01|2\.02|5\.02)\b/i);
  const body = sec >= 0 ? t.slice(sec, sec + 5_000) : t.slice(0, 8_000);
  const pr = /\b(?:issued|released|published|furnish(?:ed|ing))\s+(?:a|the|its)\s+(?:joint\s+)?press release\s+(?:\([^)]{0,60}\)\s+)?(?:announcing|titled|entitled|that announced|regarding|reporting|relating to|disclosing|to announce|providing|containing|discussing|describing|setting forth|with respect to|concerning|updating)\s*(?:that\s+)?[“"]?([^”"]{15,400}?)(?:[”"]|\.\s|\. ?$|, a copy of which)/i.exec(body);
  if (pr) return clip(pr[1].replace(/^the\s+/i, (m) => m));
  const ann = /\b(?:the Company|the Registrant|[A-Z][A-Za-z&.,' -]{2,60})\s+announced\s+(?:that\s+)?([^.]{15,300})\./.exec(body);
  if (ann && !/\bpress release\b/i.test(ann[1])) return clip(ann[1]);
  const ag = /\bentered into ((?:a|an|the)\s+[^.]{5,120}?(?:Agreement|Amendment|Facility|Contract|License|Indenture|Note|Arrangement))\b[^.]{0,40}?\bwith\s+([^.,(;]{3,80})/i.exec(body);
  if (ag) return clip(`entered into ${ag[1].replace(/\s*\([^)]*\)\s*/g, ' ').trim()} with ${ag[2].replace(/\s*\([^)]*$/, '').trim()}`);
  return null;
}

/** What an 8-K announced, from its documents (EX-99.1 headline first, then the body). Null when neither states it. */
export function eightKAnnouncement(docs: Array<{ role: string; text: string }>): string | null {
  const ex = docs.find((d) => d.role === 'ex99');
  const h = ex ? releaseHeadline(ex.text) : null;
  if (h) return h;
  const body = docs.find((d) => d.role === 'primary');
  const b = body ? bodyAnnouncement(body.text) : null;
  if (b) return b;
  if (ex) {
    // no headline block: the release's lead "today announced …" sentence
    const lead = /\btoday announced\s+(?:that\s+)?([^.]{15,260})\./i.exec(ex.text.replace(/\s+/g, ' '));
    if (lead) return clip(`announced ${lead[1]}`);
  }
  return null;
}

// ── 4. INSIDER TRADES (Form 4) ──────────────────────────────────────────────

export interface Form4Trade { code: string; shares: number; price: number | null; acquired: boolean }
export interface Form4 { owner: string | null; role: string | null; date: string | null; trades: Form4Trade[] }

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*</${name}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
};

/** The ownership XML of one Form 4 → owner, role and the non-derivative trades. Tolerates junk; never throws. */
export function parseForm4Xml(xml: string): Form4 | null {
  const x = String(xml || '');
  if (!/<ownershipDocument/i.test(x)) return null;
  const owner = tag(x, 'rptOwnerName');
  const officer = tag(x, 'officerTitle');
  const isDir = /<isDirector>\s*(?:1|true)\s*<\/isDirector>/i.test(x);
  const isTen = /<isTenPercentOwner>\s*(?:1|true)\s*<\/isTenPercentOwner>/i.test(x);
  const role = officer || (isDir ? 'director' : isTen ? '10% holder' : null);
  const trades: Form4Trade[] = [];
  for (const m of x.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)) {
    const b = m[1];
    const code = (/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i.exec(b)?.[1] || '').toUpperCase();
    const shares = Number(tag(b, 'transactionShares'));
    const priceRaw = tag(b, 'transactionPricePerShare');
    const price = priceRaw != null && priceRaw !== '' ? Number(priceRaw) : null;
    const ad = (tag(b, 'transactionAcquiredDisposedCode') || '').toUpperCase();
    if (!code || !Number.isFinite(shares) || shares <= 0) continue;
    trades.push({ code, shares, price: price != null && Number.isFinite(price) ? price : null, acquired: ad === 'A' });
  }
  return { owner, role, date: tag(x, 'periodOfReport'), trades };
}

export interface InsiderSummary { owner: string | null; role: string | null; side: 'buy' | 'sell'; valueUsd: number; date: string | null }

/** Open-market buys (P) and sells (S) only — grants, option exercises, tax withholding and gifts are not trades. */
export function insiderSummary(f: Form4 | null): InsiderSummary | null {
  if (!f) return null;
  let buy = 0, sell = 0;
  for (const t of f.trades) {
    if (t.price == null || t.price <= 0) continue;
    if (t.code === 'P') buy += t.shares * t.price;
    else if (t.code === 'S') sell += t.shares * t.price;
  }
  if (buy <= 0 && sell <= 0) return null;
  const side = buy >= sell ? 'buy' : 'sell';
  return { owner: f.owner, role: f.role, side, valueUsd: side === 'buy' ? buy : sell, date: f.date };
}

const fmtUsd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const titleName = (s: string) => s.split(/\s+/).map((w) => (w.length > 2 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');

/** Material insider trades (sum per side across the Form 4s in the window): sales ≥ $1M, buys ≥ $100K. */
export function insiderWhyText(trades: InsiderSummary[]): { text: string; side: 'buy' | 'sell'; valueUsd: number } | null {
  const sells = trades.filter((t) => t.side === 'sell'), buys = trades.filter((t) => t.side === 'buy');
  const sv = sells.reduce((a, t) => a + t.valueUsd, 0), bv = buys.reduce((a, t) => a + t.valueUsd, 0);
  const pick = bv >= 100_000 && bv >= sv * 0.25 ? { side: 'buy' as const, list: buys, v: bv } : sv >= 1_000_000 ? { side: 'sell' as const, list: sells, v: sv } : null;
  if (!pick) return null;
  const top = pick.list.slice().sort((a, b) => b.valueUsd - a.valueUsd)[0];
  const who = top.owner ? `${top.role ? `${top.role.replace(/^chief executive officer$/i, 'CEO').replace(/^chief financial officer$/i, 'CFO')} ` : ''}${titleName(top.owner)}` : 'an insider';
  const others = pick.list.length > 1 ? ` (+${pick.list.length - 1} more Form 4${pick.list.length > 2 ? 's' : ''})` : '';
  return { side: pick.side, valueUsd: pick.v, text: `insider ${pick.side === 'buy' ? 'buying' : 'selling'} — ${who} ${pick.side === 'buy' ? 'bought' : 'sold'} ${fmtUsd(pick.v)} on the open market (Form 4)${others}` };
}

/** Form 4 XML url from the filing's primary document url (the rendered "xslF345X05/…xml" sits beside the raw XML). */
export const form4XmlUrl = (url: string): string => String(url || '').replace(/\/xslF345X\d+\//i, '/');

// ── 5. EARNINGS DUE ─────────────────────────────────────────────────────────

/** "earnings due Tue Oct 20 (after the close)" */
export function earningsDueText(date: string, time?: string | null): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const when = time === 'pre-market' ? ' (before the open)' : time === 'after-hours' ? ' (after the close)' : '';
  return `earnings due ${dow} ${mon} ${d.getUTCDate()}${when}`;
}
