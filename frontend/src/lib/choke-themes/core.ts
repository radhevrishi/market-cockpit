// zzz1174 — CHOKE-POINT THEMES (owner, 26 Oct 2026): the 6–8 strongest 10-year choke-point themes for the US and for India,
// each with Why / Leaders / Asymmetry and a per-country Investor Playbook. Written by the AI ONLY when the owner clicks
// "Update with AI" on the News page; otherwise the last run is shown as it was. Pure types + formatting (no imports).

export type ChokeRegion = 'US' | 'IN';
export interface ChokeLeader { name: string; ticker: string; note: string | null; /** zzz1175 — market cap from the stock screener ($ M US / ₹ Cr India), when known */ cap?: number | null }
export interface ChokeTheme { name: string; emoji: string; why: string; leaders: ChokeLeader[]; smallMid: ChokeLeader[]; bear: string; bull: string; evidence: string | null }
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
                type: 'object', additionalProperties: false, required: ['name', 'emoji', 'why', 'leaders', 'small_mid', 'bear', 'bull', 'evidence'],
                properties: {
                  name: { type: 'string', maxLength: 70 },
                  emoji: { type: 'string', maxLength: 12, description: 'One to three emoji for the theme.' },
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
                  bull: { type: 'string', maxLength: 200, description: 'Bull case, 5x–20x, and what drives it.' },
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
      changes: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 }, description: 'What changed versus the previous run (themes added / dropped / leaders swapped, and why). Empty on a first run.' },
    },
  },
} as const;

export const CHOKE_SYSTEM = `You are an expert equity analyst. Identify the 6–8 strongest high-growth, choke-point investment themes for the next 10+ years, for the US and for India SEPARATELY — their structural drivers differ.

Rules:
- Only themes that are mission-critical, monopoly-driven or policy-backed. Exclude weak or themeless sectors (housing, staples, generic emerging-market exposure).
- Leaders: 2–4 true choke-point companies per theme. Exclude any company with audit issues, auditor resignations, promoter-family disputes, board conflicts, regulator actions on governance, or weak governance credibility. Only clean balance sheets, trustworthy management, proven execution. If you are unsure about a company's governance, leave it out.
- Small & mid caps: for EVERY theme also give 1–3 small or mid-cap choke-point companies (US under $10B market cap, India under ₹25,000 crore), same governance filter; an empty list when none truly qualify. The playbook names which small & mid caps to accumulate first.
- Asymmetry: a bear case of -60% to -90% (what causes it) and a bull case of 5x–20x (what drives it). Be honest — a large company rarely does 20x.
- India: NSE tickers. US: US tickers; a non-US company only when it is the real choke point (give its exchange).
- Use the recent news list to keep the view current: tie a theme to a real recent development where one exists (field "evidence"); never invent news, figures or events.
- Compare with the previous run when one is given: keep what still holds, change what the news changed, and list the changes.
- Investor Playbook per country: the 3–5 themes most likely to dominate the next bull cycle, and an accumulation plan assuming a 2–3 year bear market, buying in tranches at -30%, -50%, -70%.
- Plain, simple English. Short sentences. This is research, not advice.`;

/** The report as plain text, in the owner's exact format (for copying). */
export function chokeAsText(r: ChokeReport): string {
  const out: string[] = [];
  for (const g of r.regions) {
    out.push(g.region === 'US' ? '🇺🇸 UNITED STATES' : '🇮🇳 INDIA', '');
    for (const t of g.themes) {
      out.push(`🔥 ${t.name} ${t.emoji}`.trim());
      out.push(`Why: ${t.why}`);
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
      name: str(t?.name, 70), emoji: str(t?.emoji, 12), why: str(t?.why, 420),
      leaders: people(t?.leaders, 4), smallMid: people(t?.small_mid, 3),
      bear: str(t?.bear, 200), bull: str(t?.bull, 200), evidence: t?.evidence ? str(t.evidence, 200) : null,
    })).filter((t: ChokeTheme) => t.name && t.why && t.leaders.length >= 1).slice(0, 8);
    if (themes.length < 4) return null;
    const pb = g.playbook || {};
    regions.push({ region: code, themes, playbook: { dominant: (Array.isArray(pb.dominant) ? pb.dominant : []).map((x: any) => str(x, 140)).filter(Boolean).slice(0, 5), accumulation: str(pb.accumulation, 600), smallMid: str(pb.small_mid, 400) } });
  }
  return { regions, changes: (Array.isArray(d?.changes) ? d.changes : []).map((x: any) => str(x, 180)).filter(Boolean).slice(0, 6) };
}

export const SMALL_MID_MAX: Record<ChokeRegion, number> = { US: 10_000, IN: 25_000 };   // $ M / ₹ Cr
const homeTicker = (t: string, region: ChokeRegion) => { const m = /^([A-Z0-9&.-]+)(?:\s*[,(]\s*([A-Za-z]+))?/.exec(t.trim().toUpperCase()); if (!m) return null; if (m[2] && !(region === 'US' ? /^(NYSE|NASDAQ|US)$/ : /^(NSE|BSE|IN)$/).test(m[2])) return null; return m[1].replace(/\.NS$|\.BO$/, ''); };

/** Stock-screener market caps on every leader; a "small & mid" name that is in fact large is dropped (the AI's size guess is checked). Pure. */
export function withCaps(r: Pick<ChokeReport, 'regions'>, caps: Record<ChokeRegion, Map<string, number>>): void {
  for (const g of r.regions) {
    const cap = (l: ChokeLeader) => { const t = homeTicker(l.ticker, g.region); const v = t ? caps[g.region]?.get(t) : undefined; l.cap = v ?? null; return l; };
    for (const t of g.themes) {
      t.leaders.forEach(cap);
      t.smallMid = t.smallMid.map(cap).filter((l) => l.cap == null || l.cap <= SMALL_MID_MAX[g.region]);
    }
  }
}

export const fmtChokeCap = (v: number | null | undefined, region: ChokeRegion): string | null => (v == null ? null : region === 'IN' ? `₹${Math.round(v).toLocaleString('en-IN')} Cr` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}B` : `$${Math.round(v)}M`);
