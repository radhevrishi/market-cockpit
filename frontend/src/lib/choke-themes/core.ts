// zzz1174 — CHOKE-POINT THEMES (owner, 26 Oct 2026): the 6–8 strongest 10-year choke-point themes for the US and for India,
// each with Why / Leaders / Asymmetry and a per-country Investor Playbook. Written by the AI ONLY when the owner clicks
// "Update with AI" on the News page; otherwise the last run is shown as it was. Pure types + formatting (no imports).

export type ChokeRegion = 'US' | 'IN';
export interface ChokeLeader { name: string; ticker: string; note: string | null; /** zzz1175 — market cap from the stock screener ($ M US / ₹ Cr India), when known */ cap?: number | null; /** zzz1176 — false = the ticker is not in the stock screener (wrong, renamed or foreign) */ found?: boolean | null; /** zzz1178 — 1-year share move % (stock screener) */ p1y?: number | null }
export type ChokeStage = 'EARLY' | 'BUILDING' | 'CROWDED';
export type JCurve = 'PRE_INFLECTION' | 'INFLECTING' | 'MID_RUN' | 'LATE';
export interface ChokeTheme { name: string; emoji: string; keywords?: string[]; jcurve?: JCurve; /** zzz1180 — the data check: median 5-year / 1-year share move of the theme's companies, and whether it already ran */ ran5y?: number | null; ran1y?: number | null; alreadyRan?: boolean; stage?: ChokeStage; notPricedIn?: string; signals?: string; why: string; leaders: ChokeLeader[]; smallMid: ChokeLeader[]; bear: string; bull: string; evidence: string | null }
export interface ChokePlaybook { dominant: string[]; accumulation: string; smallMid: string }
export interface ChokeRegionView { region: ChokeRegion; themes: ChokeTheme[]; playbook: ChokePlaybook }
export interface ChokeReport {
  regions: ChokeRegionView[]; changes: string[];
  generatedAt: string; model: string | null; newsUsed: number; asOfNews: string | null;
}

export const CHOKE_TOOL = {
  name: 'record_choke_point_themes',
  description: 'Record the strongest 10-year choke-point themes for the US and for India, with leaders, asymmetry and an investor playbook per country.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['regions', 'changes'],
    properties: {
      regions: {
        type: 'array', minItems: 2, maxItems: 2,
        items: {
          type: 'object', additionalProperties: false, required: ['region', 'themes', 'playbook'],
          properties: {
            region: { type: 'string', enum: ['US', 'IN'] },
            themes: {
              type: 'array', minItems: 6, maxItems: 8,
              items: {
                type: 'object', additionalProperties: false, required: ['name', 'emoji', 'jcurve', 'stage', 'not_priced_in', 'signals', 'keywords', 'why', 'leaders', 'small_mid', 'bear', 'bull', 'evidence'],
                properties: {
                  name: { type: 'string', maxLength: 90, description: 'Short theme name, at most 8 words.' },
                  emoji: { type: 'string', maxLength: 12, description: 'One to three emoji for the theme.' },
                  jcurve: { type: 'string', enum: ['PRE_INFLECTION', 'INFLECTING', 'MID_RUN', 'LATE'], description: 'Where the theme sits on the J-curve. Only PRE_INFLECTION or INFLECTING are wanted.' },
                  stage: { type: 'string', enum: ['EARLY', 'BUILDING', 'CROWDED'], description: 'EARLY = inflection starting, not yet consensus, shares have not run; BUILDING = proven and accelerating, partly priced; CROWDED = consensus and largely priced (include at most one CROWDED theme, and only for a real new bottleneck).' },
                  not_priced_in: { type: 'string', maxLength: 260, description: 'What the market is still missing or under-pricing — why this is not yet a consensus trade.' },
                  signals: { type: 'string', maxLength: 260, description: 'The hard inflection signals to watch or already visible (pricing turning, supply sold out, lead times, utilisation, inventory drawdown, revenue acceleration in the industry data given).' },
                  keywords: { type: 'array', minItems: 4, maxItems: 12, items: { type: 'string', maxLength: 40 }, description: 'Short search terms that find this theme in news headlines (e.g. "HBM", "high bandwidth memory", "NAND", "DRAM prices"). Lower case is fine.' },
                  why: { type: 'string', maxLength: 420, description: '2–3 lines: the structural driver (macro, geopolitics, technology, policy) and where the choke point is.' },
                  leaders: {
                    type: 'array', minItems: 2, maxItems: 4,
                    items: {
                      type: 'object', additionalProperties: false, required: ['name', 'ticker', 'note'],
                      properties: {
                        name: { type: 'string', maxLength: 60 },
                        ticker: { type: 'string', maxLength: 24, description: 'Exchange ticker; add the exchange for non-home listings, e.g. "LYC, ASX".' },
                        note: { type: ['string', 'null'], maxLength: 120, description: 'Why it is the choke point (one short phrase), or null.' },
                      },
                    },
                  },
                  small_mid: {
                    type: 'array', minItems: 0, maxItems: 3,
                    description: 'SMALL & MID-CAP choke-point companies in this theme: US under $10B market cap, India under ₹25,000 crore. Same governance filter. Empty when none qualify — never pad.',
                    items: {
                      type: 'object', additionalProperties: false, required: ['name', 'ticker', 'note'],
                      properties: {
                        name: { type: 'string', maxLength: 60 },
                        ticker: { type: 'string', maxLength: 24, description: 'Exchange ticker; add the exchange for non-home listings, e.g. "LYC, ASX".' },
                        note: { type: ['string', 'null'], maxLength: 120, description: 'Why it is the choke point (one short phrase), or null.' },
                      },
                    },
                  },
                  bear: { type: 'string', maxLength: 200, description: 'Bear case, -60% to -90%, and what causes it.' },
                  bull: { type: 'string', maxLength: 220, description: 'Bull case and what drives it: 5x–20x for the small & mid caps; for the mega-cap leaders say the realistic multiple (often 2–3x).' },
                  evidence: { type: ['string', 'null'], maxLength: 200, description: 'A recent development from the news list given that supports the theme, or null.' },
                },
              },
            },
            playbook: {
              type: 'object', additionalProperties: false, required: ['dominant', 'accumulation', 'small_mid'],
              properties: {
                dominant: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', maxLength: 140 }, description: 'The 3–5 themes most likely to dominate the next bull cycle, each with a short reason.' },
                small_mid: { type: 'string', maxLength: 400, description: 'The small & mid-cap names to accumulate first and why (higher volatility: smaller tranches, deeper drawdowns).' },
                accumulation: { type: 'string', maxLength: 600, description: 'Accumulation plan assuming a 2–3 year bear market: tranches at -30%, -50%, -70%, which themes first, position sizing.' },
              },
            },
          },
        },
      },
      changes: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 200 }, description: 'What changed versus the previous run, one short line each, starting "US:" or "India:" and then "Added", "Dropped" or "Changed" — e.g. "India: Dropped Rail EPC — shares up 6x in 5 years, J-curve done". Empty on a first run.' },
    },
  },
} as const;

export const CHOKE_SYSTEM = `You are an expert equity analyst. Identify the 6–8 strongest high-growth, choke-point investment themes for the next 10+ years, for the US and for India SEPARATELY — their structural drivers differ.

THE GOAL IS TO BE EARLY, NOT TO LIST CONSENSUS. The owner wants to find the next memory-supercycle-type theme (Micron and SanDisk before their 10x–50x runs) — not themes that already played out. A theme deserves a place when:
- a hard bottleneck is forming: demand is outrunning supply that takes years to add (capacity sold out, lead times stretching, pricing turning up, inventory drawing down);
- the industry data given shows quarterly revenue accelerating above the yearly trend and margins rising — while shares have NOT yet run a lot over 5 years;
- the market still treats it as cyclical, boring or a niche (state what it is missing).
Leave out themes whose main run is behind them — e.g. generic solar modules or panel makers, generic EV makers, generic renewable developers — unless something genuinely NEW (a new bottleneck, a new technology layer) has started; then name exactly that new piece, not the old theme. Rank EARLY themes first, then BUILDING; at most one CROWDED theme.

Rules:
- Only themes that are mission-critical, monopoly-driven or policy-backed. Exclude weak or themeless sectors (housing, staples, generic emerging-market exposure).
- Leaders: 2–4 true choke-point companies per theme. Exclude any company with audit issues, auditor resignations, promoter-family disputes, board conflicts, regulator actions on governance, or weak governance credibility. Only clean balance sheets, trustworthy management, proven execution. If you are unsure about a company's governance, leave it out.
- Small & mid caps: for EVERY theme also give 1–3 small or mid-cap choke-point companies (US under $10B market cap, India under ₹25,000 crore), same governance filter; an empty list when none truly qualify. The playbook names which small & mid caps to accumulate first.
- Asymmetry: a bear case of -60% to -90% (what causes it) and a bull case (what drives it). The 5x–20x upside belongs to the small & mid caps; a company already worth hundreds of billions rarely does more than 2–3x — say so plainly.
- Order themes strongest first. Use correct, current tickers (NSE symbols for India); never list the same company as both a leader and a small & mid pick.
- India: NSE tickers. US: US tickers; a non-US company only when it is the real choke point (give its exchange).
- Use the recent news list to keep the view current: tie a theme to a real recent development where one exists (field "evidence"); never invent news, figures or events.
- J-CURVE TEST — every theme must pass it. Ask: where on the J-curve are its companies? PRE_INFLECTION (the squeeze is forming, earnings have not turned), INFLECTING (earnings just turning up, shares not re-rated yet) — these are what the owner wants. MID_RUN and LATE (earnings already compounding for years, shares already multiplied) are NOT wanted. Use the 5-year share moves in the data: a theme whose leading companies are already up more than 3x in 5 years has already played out — leave it out. In India this rules out the 2021–2024 winners as themes in themselves: railway / PSU EPC, defence PSUs, renewable developers and solar modules, power T&D / transformers, exchanges and depositories — unless a NEW, specific bottleneck whose companies have NOT yet moved has started (name that piece and its companies).
- Judge every theme FROM SCRATCH each run. The previous run is given only so you can list what changed — never keep a theme because it was there before.
- Investor Playbook per country: the 3–5 themes most likely to dominate the next bull cycle, and an accumulation plan assuming a 2–3 year bear market, buying in tranches at -30%, -50%, -70%.
- Plain, simple English. Short sentences. This is research, not advice.`;

/** The report as plain text, in the owner's exact format (for copying). */
export function chokeAsText(r: ChokeReport): string {
  const out: string[] = [];
  for (const g of r.regions) {
    out.push(g.region === 'US' ? '🇺🇸 UNITED STATES' : '🇮🇳 INDIA', '');
    for (const t of g.themes) {
      out.push(`🔥 ${t.name} ${t.emoji}`.trim());
      if (t.stage) out.push(`Stage: ${t.stage}${t.notPricedIn ? ` — not priced in: ${t.notPricedIn}` : ''}`);
      out.push(`Why: ${t.why}`);
      if (t.signals) out.push(`Signals: ${t.signals}`);
      out.push(`Leaders: ${t.leaders.map((l) => `${l.name} (${l.ticker})`).join(', ')}.`);
      if (t.smallMid.length) out.push(`Small & mid caps: ${t.smallMid.map((l) => `${l.name} (${l.ticker})`).join(', ')}.`);
      out.push(`Asymmetry: Bear: ${t.bear} Bull: ${t.bull}`, '');
    }
    out.push(`🎯 Investor Playbook — ${g.region === 'US' ? 'US' : 'India'}`);
    for (const d of g.playbook.dominant) out.push(`• ${d}`);
    if (g.playbook.smallMid) out.push(`Small & mid caps first: ${g.playbook.smallMid}`);
    out.push(`Accumulation: ${g.playbook.accumulation}`, '');
  }
  return out.join('\n').trim();
}

/** Keeps only well-formed output (both regions, US first). Null when the model answered badly. */
export function cleanChoke(d: any): Pick<ChokeReport, 'regions' | 'changes'> | null {
  const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const regions: ChokeRegionView[] = [];
  for (const code of ['US', 'IN'] as ChokeRegion[]) {
    const g = (Array.isArray(d?.regions) ? d.regions : []).find((x: any) => x?.region === code);
    if (!g) return null;
    const people = (a: any, n: number): ChokeLeader[] => (Array.isArray(a) ? a : []).map((l: any) => ({ name: str(l?.name, 60), ticker: str(l?.ticker, 24), note: l?.note ? str(l.note, 120) : null })).filter((l: ChokeLeader) => l.name && l.ticker).slice(0, n);
    const themes: ChokeTheme[] = (Array.isArray(g.themes) ? g.themes : []).map((t: any) => ({
      name: str(t?.name, 90), emoji: str(t?.emoji, 12), why: str(t?.why, 420),
      stage: (['EARLY', 'BUILDING', 'CROWDED'].includes(t?.stage) ? t.stage : undefined) as ChokeStage | undefined,
      jcurve: (['PRE_INFLECTION', 'INFLECTING', 'MID_RUN', 'LATE'].includes(t?.jcurve) ? t.jcurve : undefined) as JCurve | undefined,
      keywords: (Array.isArray(t?.keywords) ? t.keywords : []).map((k: any) => str(k, 40)).filter(Boolean).slice(0, 12),
      notPricedIn: t?.not_priced_in ? str(t.not_priced_in, 260) : undefined, signals: t?.signals ? str(t.signals, 260) : undefined,
      leaders: people(t?.leaders, 4), smallMid: people(t?.small_mid, 3),
      bear: str(t?.bear, 200), bull: str(t?.bull, 200), evidence: t?.evidence ? str(t.evidence, 200) : null,
    })).filter((t: ChokeTheme) => t.name && t.why && t.leaders.length >= 1).slice(0, 8);
    if (themes.length < 4) return null;
    const pb = g.playbook || {};
    regions.push({ region: code, themes, playbook: { dominant: (Array.isArray(pb.dominant) ? pb.dominant : []).map((x: any) => str(x, 140)).filter(Boolean).slice(0, 5), accumulation: str(pb.accumulation, 600), smallMid: str(pb.small_mid, 400) } });
  }
  return { regions, changes: (Array.isArray(d?.changes) ? d.changes : []).map((x: any) => str(x, 200)).filter(Boolean).slice(0, 8) };
}

export const SMALL_MID_MAX: Record<ChokeRegion, number> = { US: 10_000, IN: 25_000 };   // $ M / ₹ Cr
const homeTicker = (t: string, region: ChokeRegion) => { const m = /^([A-Z0-9&.-]+)(?:\s*[,(]\s*([A-Za-z]+))?/.exec(t.trim().toUpperCase()); if (!m) return null; if (m[2] && !(region === 'US' ? /^(NYSE|NASDAQ|US)$/ : /^(NSE|BSE|IN)$/).test(m[2])) return null; return m[1].replace(/\.NS$|\.BO$/, ''); };

/** Stock-screener market caps on every leader; a "small & mid" name that is in fact large is dropped (the AI's size guess is
 *  checked), a small & mid name already listed as a leader is not repeated, and a home ticker the screener does not know is
 *  marked (wrong, renamed or delisted — check it). Pure. */
export function withCaps(r: Pick<ChokeReport, 'regions'>, caps: Record<ChokeRegion, Map<string, number>>, perf?: Record<ChokeRegion, Map<string, number>>): void {
  for (const g of r.regions) {
    const known = (caps[g.region]?.size ?? 0) > 0;
    const cap = (l: ChokeLeader) => {
      const t = homeTicker(l.ticker, g.region); const v = t ? caps[g.region]?.get(t) : undefined;
      l.cap = v ?? null; l.found = !t ? null : known ? v != null : null;   // a foreign listing is not checked
      l.p1y = t ? perf?.[g.region]?.get(t) ?? null : null;
      return l;
    };
    for (const t of g.themes) {
      t.leaders.forEach(cap);
      const lead = new Set(t.leaders.map((l) => l.ticker.toUpperCase()));
      t.smallMid = t.smallMid.map(cap).filter((l) => !lead.has(l.ticker.toUpperCase()) && (l.cap == null || l.cap <= SMALL_MID_MAX[g.region]));
    }
  }
}

export const fmtChokeCap = (v: number | null | undefined, region: ChokeRegion): string | null => (v == null ? null : region === 'IN' ? `₹${Math.round(v).toLocaleString('en-IN')} Cr` : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}T` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}B` : `$${Math.round(v)}M`);

/** zzz1180 — THE J-CURVE DATA CHECK. A theme whose own companies (leaders + small & mid) are already up more than 3x in 5 years
 *  (median, stock screener) has played out — flagged "already ran" and moved to the end; the AI's own J-curve call is shown
 *  beside it. Pure. */
export const RAN_5Y_PCT = 200;   // +200% = 3x
export function jcurveCheck(r: Pick<ChokeReport, 'regions'>, p5y: Record<ChokeRegion, Map<string, number>>, p1y?: Record<ChokeRegion, Map<string, number>>): void {
  const med = (a: number[]) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  for (const g of r.regions) {
    for (const t of g.themes) {
      const tk = [...t.leaders, ...(t.smallMid || [])].map((l) => homeTicker(l.ticker, g.region)).filter((x): x is string => !!x);
      const five = tk.map((x) => p5y[g.region]?.get(x)).filter((v): v is number => typeof v === 'number');
      const one = tk.map((x) => p1y?.[g.region]?.get(x)).filter((v): v is number => typeof v === 'number');
      t.ran5y = five.length ? Math.round(med(five)!) : null;
      t.ran1y = one.length ? Math.round(med(one)!) : null;
      t.alreadyRan = t.ran5y != null && t.ran5y >= RAN_5Y_PCT || t.jcurve === 'LATE';
    }
    // early first: not-yet-run themes keep the AI's order, already-ran themes go last
    g.themes = [...g.themes.filter((t) => !t.alreadyRan), ...g.themes.filter((t) => t.alreadyRan)];
  }
}
