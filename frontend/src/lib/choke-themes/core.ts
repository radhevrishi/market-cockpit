// zzz1174 → zzz1183 — CHOKE-POINT THEMES, v2 (owner + ChatGPT review, 26 Oct 2026).
// The question is no longer "which sectors have good stories" but: WHICH COMPANY can turn a hard-to-replace product into
// much higher earnings and cash, and WHAT EVIDENCE shows that turn is beginning? So:
//   · a theme is a narrow, named bottleneck with its mechanism — necessity, supply constraint, value capture — and what could
//     remove it; only qualifying themes are shown (no quota; fewer when the evidence is thin);
//   · every candidate company carries an exposure class (DIRECT / ENABLER / PROXY / SPECULATIVE), a company J-stage
//     (J0 narrative … J5 weakening) judged on OPERATING evidence, its exact product, the inflection evidence, the next
//     milestone, the invalidation condition and the funding / valuation concern;
//   · price history is CONTEXT only (a past rally does not finish a J-curve; a fall does not make one early);
//   · scenarios are calculated HERE from the AI's stated assumptions and the stock screener's current P/E:
//       multiple = (1 + EPS growth)^years × (1 − dilution) × exit P/E ÷ current P/E   (no dividends; diluted)
//     and "not estimated" when the current P/E is missing, negative or not representative;
//   · "What changed" is computed from the stored runs (theme / candidate / J-stage differences), not written by the model.
// Written by the AI ONLY on the owner's click; otherwise the last successful run is shown. Pure (no imports).

export type ChokeRegion = 'US' | 'IN';
export type Exposure = 'DIRECT' | 'ENABLER' | 'PROXY' | 'SPECULATIVE';
export type JStage = 'J0' | 'J1' | 'J2' | 'J3' | 'J4' | 'J5';
export const J_WORD: Record<JStage, string> = {
  J0: 'J0 · narrative', J1: 'J1 · preparing', J2: 'J2 · early inflection', J3: 'J3 · confirmed inflection', J4: 'J4 · established', J5: 'J5 · weakening',
};
export const J_WHY: Record<JStage, string> = {
  J0: 'Announcements, prototypes, planned plants — commercial conversion unproven',
  J1: 'Qualification, commissioning or first orders — revenue conversion still limited',
  J2: 'Commercial execution started; revenue / utilisation / margins improving — durability to be confirmed',
  J3: 'Several periods or verifiable milestones show sustained improvement',
  J4: 'Growth continues but the inflection is already established — judge runway and valuation',
  J5: 'Milestones failing, demand weakening or the thesis losing support',
};
export const EXPOSURE_WHY: Record<Exposure, string> = {
  DIRECT: 'Sells the bottleneck product or service', ENABLER: 'Supplies a necessary input to the bottleneck',
  PROXY: 'Benefits indirectly from related spending', SPECULATIVE: 'Connection plausible but commercially unproven',
};

/** Stock-screener figures laid over a candidate (never written by the model). */
export interface CandFacts { cap: number | null; revQ: number | null; revA: number | null; epsQ: number | null; opm: number | null; pe: number | null; fcfm: number | null; de: number | null; p1y: number | null; p5y: number | null }
export interface ScenarioIn { years: number; epsCagr: { bear: number; base: number; bull: number }; exitPe: { bear: number; base: number; bull: number }; dilutionPct: number; basis: string }
export interface ScenarioOut { bear: number; base: number; bull: number; currentPe: number }
export interface ChokeCandidate {
  name: string; ticker: string; exposure: Exposure; jstage: JStage;
  product: string; inflection: string; milestone: string; invalidation: string; concern: string;
  scenario: ScenarioIn | null;
  // laid over by the server
  facts?: CandFacts | null; found?: boolean | null; multiples?: ScenarioOut | null; scenarioNote?: string | null;
  dataCheck?: 'CONFIRMS' | 'MIXED' | 'CONTRADICTS' | 'NO_DATA'; secondary?: string[]; sizeNote?: string | null;
}
export interface ChokeTheme {
  name: string; emoji: string; keywords?: string[];
  why: string; necessity: string; constraint: string; valueCapture: string; breakers: string; unknowns: string;
  evidence: string | null;
  candidates: ChokeCandidate[]; reference: ChokeCandidate[];
  // laid over by the server
  qualifies?: boolean; rankScore?: number;
  // v1 fields kept so an old stored run still renders
  leaders?: any[]; smallMid?: any[]; bear?: string; bull?: string; signals?: string; notPricedIn?: string; stage?: string; jcurve?: string;
}
export interface ChokePlaybook { strongest: string[]; confirm: string[]; milestones: string[]; disconfirming: string[]; valuation: string[] }
export interface ChokeRegionView { region: ChokeRegion; themes: ChokeTheme[]; playbook: ChokePlaybook }
export interface ChokeChange { region: ChokeRegion; kind: 'ADDED' | 'DROPPED' | 'CHANGED'; what: string; from: string | null; to: string | null }
export interface ChokeReport {
  version?: 2;
  regions: ChokeRegionView[]; changes: Array<ChokeChange | string>;
  generatedAt: string; model: string | null; newsUsed: number; asOfNews: string | null;
  marketDataAt?: string | null; prevAt?: string | null;
}

const CAND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'ticker', 'exposure', 'jstage', 'product', 'inflection', 'milestone', 'invalidation', 'concern', 'scenario'],
  properties: {
    name: { type: 'string', maxLength: 60 },
    ticker: { type: 'string', maxLength: 24, description: 'Exact listed ticker (NSE symbol for India, US ticker for the US). Copy from the company data when the company is there.' },
    exposure: { type: 'string', enum: ['DIRECT', 'ENABLER', 'PROXY', 'SPECULATIVE'] },
    jstage: { type: 'string', enum: ['J0', 'J1', 'J2', 'J3', 'J4', 'J5'], description: 'Company J-stage from OPERATING evidence (orders, qualification, commissioning, revenue, margins), never from the share price.' },
    product: { type: 'string', maxLength: 140, description: 'The exact product / division that is the bottleneck exposure, and its revenue share if disclosed, else "share not separately disclosed".' },
    inflection: { type: 'string', maxLength: 220, description: 'The evidence that the earnings turn is beginning, labelled: "Reported:" for filed figures, "Guidance:" for management targets, "Inference:" for your reading. Use the company data figures given. An MoU, tender, qualification, order, shipment and revenue are NOT the same thing — say which one it is.' },
    milestone: { type: 'string', maxLength: 160, description: 'Next measurable milestone and its expected timing.' },
    invalidation: { type: 'string', maxLength: 160, description: 'What would prove the thesis wrong.' },
    concern: { type: 'string', maxLength: 160, description: 'Funding, dilution, working-capital, governance or valuation concern; "None found in available disclosures" when none (never certify governance as clean).' },
    scenario: {
      type: ['object', 'null'], additionalProperties: false, required: ['years', 'eps_cagr', 'exit_pe', 'dilution_pct', 'basis'],
      description: 'Only for a profitable company with representative earnings; null otherwise. The server calculates the return multiples from these.',
      properties: {
        years: { type: 'integer', minimum: 2, maximum: 7 },
        eps_cagr: { type: 'object', additionalProperties: false, required: ['bear', 'base', 'bull'], properties: { bear: { type: 'number' }, base: { type: 'number' }, bull: { type: 'number' } }, description: 'Diluted EPS growth a year, %, per case.' },
        exit_pe: { type: 'object', additionalProperties: false, required: ['bear', 'base', 'bull'], properties: { bear: { type: 'number' }, base: { type: 'number' }, bull: { type: 'number' } } },
        dilution_pct: { type: 'number', description: 'Total share-count increase over the period, % (0 if none expected).' },
        basis: { type: 'string', maxLength: 200, description: 'What the growth rests on: revenue, margin and capacity assumptions.' },
      },
    },
  },
};

export const CHOKE_TOOL = {
  name: 'record_choke_point_themes',
  description: 'Record the evidence-backed choke-point themes for the US and for India, each with candidate companies on an operating J-curve.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['regions'],
    properties: {
      regions: {
        type: 'array', minItems: 2, maxItems: 2,
        items: {
          type: 'object', additionalProperties: false, required: ['region', 'themes', 'playbook'],
          properties: {
            region: { type: 'string', enum: ['US', 'IN'] },
            themes: {
              type: 'array', minItems: 1, maxItems: 8, description: 'Only themes that qualify — fewer is fine. No filler.',
              items: {
                type: 'object', additionalProperties: false,
                required: ['name', 'emoji', 'keywords', 'why', 'necessity', 'constraint', 'value_capture', 'breakers', 'unknowns', 'evidence', 'candidates', 'reference'],
                properties: {
                  name: { type: 'string', maxLength: 90, description: 'The SPECIFIC bottleneck (e.g. "High-density power delivery for AI racks"), not a broad sector.' },
                  emoji: { type: 'string', maxLength: 12 },
                  keywords: { type: 'array', minItems: 4, maxItems: 12, items: { type: 'string', maxLength: 40 }, description: 'Short search terms that find this bottleneck in news headlines.' },
                  why: { type: 'string', maxLength: 320, description: 'The structural driver in 2 short sentences.' },
                  necessity: { type: 'string', maxLength: 200, description: 'Why customers cannot do without it.' },
                  constraint: { type: 'string', maxLength: 200, description: 'The supply constraint: few qualified suppliers, long qualification, certification, IP, scarce skills…' },
                  value_capture: { type: 'string', maxLength: 200, description: 'How suppliers keep the benefit: pricing, recurring revenue, utilisation, mix, switching costs.' },
                  breakers: { type: 'string', maxLength: 200, description: 'What could remove the bottleneck: new capacity, substitution, insourcing, redesign, more qualified suppliers, regulation.' },
                  unknowns: { type: 'string', maxLength: 200, description: 'The important unknowns / evidence gaps.' },
                  evidence: { type: ['string', 'null'], maxLength: 200, description: 'A recent development from the news list that is about THIS bottleneck, or null.' },
                  candidates: { type: 'array', minItems: 0, maxItems: 6, items: CAND_SCHEMA, description: 'Small & mid-cap discovery candidates (US $300M–$10B, India ₹500–25,000 crore), DIRECT and ENABLER first, J2 / J3 first. Empty when none qualify — say so in unknowns.' },
                  reference: { type: 'array', minItems: 0, maxItems: 3, items: CAND_SCHEMA, description: 'Large reference leaders (above the discovery band), kept separate.' },
                },
              },
            },
            playbook: {
              type: 'object', additionalProperties: false, required: ['strongest', 'confirm', 'milestones', 'disconfirming', 'valuation'],
              properties: {
                strongest: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 }, description: 'The strongest evidence-backed themes / candidates and why.' },
                confirm: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 }, description: 'Candidates that need further confirmation, and what would confirm them.' },
                milestones: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 160 }, description: 'Upcoming milestones to watch (company + event + timing).' },
                disconfirming: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 }, description: 'Evidence that would weaken the theses.' },
                valuation: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 }, description: 'Valuation conditions to monitor and evidence-based conditions for staged entry (never "buy because it fell").' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const CHOKE_SYSTEM = `You are an expert equity analyst. Research the US and India SEPARATELY. The question is NOT "which sectors have good long-term stories". It is:
"Which specific small or mid-cap company can convert a hard-to-replace product or capability into materially higher earnings and cash, and what evidence shows the conversion is beginning?"
Horizons: the bottleneck may last 10+ years; the company thesis is about 3–7 years; the inflection evidence is recent results and milestones over the next 2–8 quarters.

A THEME qualifies only when you can show the mechanism: necessity (customers need it) + supply constraint (few qualified suppliers, long qualification, certification, IP, scarce skills, specialist production) + value capture (pricing, recurring revenue, utilisation, mix, switching costs). "Large market", "government spending", "China+1", "AI exposure" and "import substitution" are leads, not conclusions. Name the specific bottleneck, not a broad sector. Say what could remove it. Show only qualifying themes — 1 to 8; fewer is better than filler. Broad solar, rail or defence exposure does not qualify by itself; a specific qualified supplier inside a mature sector can.

CROSS-BORDER DEMAND SHIFTS are a major source of real J-curves — look for them actively: Europe+1 (Europe moving supply away from China / Russia), European rearmament (ammunition, explosives, forgings, propellants, components), US reshoring and tariffs, China+1, the India–EU / India–UK trade agreements, Western energy-security and grid build-outs buying from India. The narrative alone is not evidence; a specific supplier with QUALIFIED foreign customers, signed export orders and export revenue rising in its own figures is — those are often small and mid caps at J1–J3 in sectors that look mature at home.

CANDIDATES: prefer DIRECT and ENABLER exposure, J2 / J3 first; J1 only as an early watch; never promote J0 because the market is large. Judge the J-stage on OPERATING evidence only — orders, qualification, commissioning, utilisation, revenue, margins, cash. Share prices are market context: a past rally does not end a J-curve (a new division can start its own), and a fall does not make a company early. Use the company data given (stock-screener figures) and the recent news; never invent customers, contracts, capacity, market share or dates. An MoU, a tender, a qualification, an order, a shipment and recognised revenue are different events — say which one. Planned capacity is not usable capacity. A big order still needs margin, funding and execution. If something is not disclosed, write "Not disclosed".
Governance: exclude companies with known auditor resignations or qualifications, regulator enforcement, pledge problems, promoter or board disputes or chronic dilution; separate allegations from findings; never call governance clean — write what you checked against.
SCENARIOS: only for a profitable company whose current earnings are representative; give EPS growth a year and exit P/E for bear / base / bull and the expected dilution — the system calculates the return; never assume 5–20x because a company is small. Otherwise scenario = null.
PLAYBOOK per country: strongest evidence-backed ideas, what needs confirmation, upcoming milestones, disconfirming evidence, valuation conditions. Never recommend buying because a price fell.
Plain, simple English. Short sentences. Label facts "Reported:", targets "Guidance:", your reading "Inference:". This is research, not advice.`;

// ── helpers laid over the AI's answer (all pure) ────────────────────────────────────────────────────────────────────────
const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const EXPOSURES: Exposure[] = ['DIRECT', 'ENABLER', 'PROXY', 'SPECULATIVE'];
const JS: JStage[] = ['J0', 'J1', 'J2', 'J3', 'J4', 'J5'];
const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function cleanCand(c: any): ChokeCandidate | null {
  const name = str(c?.name, 60), ticker = str(c?.ticker, 24).toUpperCase();
  if (!name || !ticker) return null;
  const s = c?.scenario;
  const scenario: ScenarioIn | null = s && typeof s === 'object' && s.eps_cagr && s.exit_pe ? {
    years: Math.max(2, Math.min(7, Math.round(numOr(s.years, 5)))),
    epsCagr: { bear: numOr(s.eps_cagr.bear, 0), base: numOr(s.eps_cagr.base, 0), bull: numOr(s.eps_cagr.bull, 0) },
    exitPe: { bear: numOr(s.exit_pe.bear, 0), base: numOr(s.exit_pe.base, 0), bull: numOr(s.exit_pe.bull, 0) },
    dilutionPct: Math.max(0, Math.min(80, numOr(s.dilution_pct, 0))), basis: str(s.basis, 200),
  } : null;
  return {
    name, ticker, exposure: EXPOSURES.includes(c?.exposure) ? c.exposure : 'SPECULATIVE', jstage: JS.includes(c?.jstage) ? c.jstage : 'J0',
    product: str(c?.product, 140) || 'Not disclosed', inflection: str(c?.inflection, 220) || 'Insufficient evidence', milestone: str(c?.milestone, 160) || 'Not disclosed',
    invalidation: str(c?.invalidation, 160) || 'Not stated', concern: str(c?.concern, 160) || 'Not stated', scenario,
  };
}

/** Keeps only well-formed output (both regions, US first; a region may have few themes). Null when the model answered badly. */
export function cleanChoke(d: any): Pick<ChokeReport, 'regions' | 'changes'> | null {
  const regions: ChokeRegionView[] = [];
  for (const code of ['US', 'IN'] as ChokeRegion[]) {
    const g = (Array.isArray(d?.regions) ? d.regions : []).find((x: any) => x?.region === code);
    if (!g) return null;
    const themes: ChokeTheme[] = (Array.isArray(g.themes) ? g.themes : []).map((t: any) => ({
      name: str(t?.name, 90), emoji: str(t?.emoji, 12),
      keywords: (Array.isArray(t?.keywords) ? t.keywords : []).map((k: any) => str(k, 40)).filter(Boolean).slice(0, 12),
      why: str(t?.why, 320), necessity: str(t?.necessity, 200), constraint: str(t?.constraint, 200), valueCapture: str(t?.value_capture, 200),
      breakers: str(t?.breakers, 200), unknowns: str(t?.unknowns, 200), evidence: t?.evidence ? str(t.evidence, 200) : null,
      candidates: (Array.isArray(t?.candidates) ? t.candidates : []).map(cleanCand).filter(Boolean).slice(0, 6) as ChokeCandidate[],
      reference: (Array.isArray(t?.reference) ? t.reference : []).map(cleanCand).filter(Boolean).slice(0, 3) as ChokeCandidate[],
    })).filter((t: ChokeTheme) => t.name && t.why).slice(0, 8);
    const pb = g.playbook || {};
    const list = (a: any, n: number) => (Array.isArray(a) ? a : []).map((x: any) => str(x, 160)).filter(Boolean).slice(0, n);
    regions.push({ region: code, themes, playbook: { strongest: list(pb.strongest, 5), confirm: list(pb.confirm, 5), milestones: list(pb.milestones, 6), disconfirming: list(pb.disconfirming, 5), valuation: list(pb.valuation, 5) } });
  }
  if (!regions.some((g) => g.themes.length)) return null;
  return { regions, changes: [] };
}

export const DISCOVERY_CAP: Record<ChokeRegion, [number, number]> = { US: [300, 10_000], IN: [500, 25_000] };   // $ M / ₹ Cr
export const SMALL_MID_MAX: Record<ChokeRegion, number> = { US: DISCOVERY_CAP.US[1], IN: DISCOVERY_CAP.IN[1] };
export const homeTicker = (t: string, region: ChokeRegion) => { const m = /^([A-Z0-9&.-]+)(?:\s*[,(]\s*([A-Za-z]+))?/.exec(t.trim().toUpperCase()); if (!m) return null; if (m[2] && !(region === 'US' ? /^(NYSE|NASDAQ|US)$/ : /^(NSE|BSE|IN)$/).test(m[2])) return null; return m[1].replace(/\.NS$|\.BO$/, ''); };
export const fmtChokeCap = (v: number | null | undefined, region: ChokeRegion): string | null => (v == null ? null : region === 'IN' ? `₹${Math.round(v).toLocaleString('en-IN')} Cr` : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}T` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}B` : `$${Math.round(v)}M`);

/** multiple = (1 + g)^years × (1 − dilution) × exit P/E ÷ current P/E. Null (with the reason) when the current P/E is missing,
 *  negative or extreme (earnings not representative) or an assumption is out of range. Pure. */
export function scenarioMultiples(s: ScenarioIn | null, currentPe: number | null): { out: ScenarioOut | null; note: string | null } {
  if (!s) return { out: null, note: 'Scenario not estimated — insufficient evidence' };
  if (currentPe == null || !Number.isFinite(currentPe) || currentPe <= 0) return { out: null, note: 'Scenario not estimated — no positive current earnings (P/E not meaningful)' };
  if (currentPe > 150) return { out: null, note: `Scenario not estimated — current P/E ${Math.round(currentPe)} means today's earnings are not representative` };
  const m = (g: number, pe: number) => {
    if (!(pe > 0) || g < -60 || g > 150) return NaN;
    return Math.round(((1 + g / 100) ** s.years) * (1 - s.dilutionPct / 100) * (pe / currentPe) * 100) / 100;
  };
  const out = { bear: m(s.epsCagr.bear, s.exitPe.bear), base: m(s.epsCagr.base, s.exitPe.base), bull: m(s.epsCagr.bull, s.exitPe.bull), currentPe: Math.round(currentPe * 10) / 10 };
  if (![out.bear, out.base, out.bull].every(Number.isFinite)) return { out: null, note: 'Scenario not estimated — assumptions out of range' };
  return { out, note: null };
}

/** Does the stock-screener data back the AI's stage? Revenue accelerating / growing with margins = CONFIRMS; shrinking revenue
 *  for a claimed J2 / J3 = CONTRADICTS. Missing data is NO_DATA (never a positive). Pure. */
export function dataCheck(c: ChokeCandidate): ChokeCandidate['dataCheck'] {
  const f = c.facts;
  if (!f || (f.revQ == null && f.revA == null)) return 'NO_DATA';
  const q = f.revQ ?? f.revA!, a = f.revA ?? f.revQ!;
  const growing = q >= 10 || (q >= 5 && q >= a + 5);
  const shrinking = q < 0 && a < 5;
  if (c.jstage === 'J2' || c.jstage === 'J3') return growing ? 'CONFIRMS' : shrinking ? 'CONTRADICTS' : 'MIXED';
  if (c.jstage === 'J5') return shrinking ? 'CONFIRMS' : 'MIXED';
  return growing ? 'MIXED' : 'NO_DATA';
}

const STAGE_W: Record<JStage, number> = { J0: 0.2, J1: 0.8, J2: 2.5, J3: 3, J4: 1.4, J5: 0 };
const EXPO_W: Record<Exposure, number> = { DIRECT: 1, ENABLER: 0.9, PROXY: 0.35, SPECULATIVE: 0.2 };
const CHECK_W = { CONFIRMS: 1, MIXED: 0.75, NO_DATA: 0.6, CONTRADICTS: 0.25 } as const;

/** The server's pass over a fresh (or stored) run: stock-screener facts and identity on every candidate, the discovery size
 *  band (a large company moves to the reference leaders), one primary theme per company (others become tags), calculated
 *  scenarios, the data check, and theme ranking by the QUALITY of its qualifying candidates. Pure. */
export function enrich(r: Pick<ChokeReport, 'regions'>, facts: Record<ChokeRegion, Map<string, CandFacts>>): void {
  for (const g of r.regions) {
    const known = (facts[g.region]?.size ?? 0) > 0;
    const primary = new Map<string, { theme: ChokeTheme; c: ChokeCandidate }>();
    const lay = (c: ChokeCandidate) => {
      const t = homeTicker(c.ticker, g.region);
      const f = t ? facts[g.region]?.get(t) ?? null : null;
      c.facts = f; c.found = !t ? null : known ? !!f : null;
      const sm = scenarioMultiples(c.scenario, f?.pe ?? null); c.multiples = sm.out; c.scenarioNote = sm.note;
      c.dataCheck = dataCheck(c);
      return c;
    };
    for (const t of g.themes) {
      t.candidates = (t.candidates || []).map(lay); t.reference = (t.reference || []).map(lay);
      // size band from validated market data: above it → reference leaders; below it → kept, marked
      const [lo, hi] = DISCOVERY_CAP[g.region];
      const big = t.candidates.filter((c) => c.facts?.cap != null && c.facts.cap > hi);
      t.candidates = t.candidates.filter((c) => !big.includes(c));
      for (const c of t.candidates) c.sizeNote = c.facts?.cap != null && c.facts.cap < lo ? 'below the discovery size band — thin liquidity' : null;
      t.reference = [...t.reference, ...big].slice(0, 4);
      // one primary theme per company; later appearances become secondary tags
      t.candidates = t.candidates.filter((c) => {
        const k = (homeTicker(c.ticker, g.region) || c.ticker).toUpperCase();
        const p = primary.get(k);
        if (p) { p.c.secondary = [...new Set([...(p.c.secondary || []), t.name])]; return false; }
        primary.set(k, { theme: t, c });
        return true;
      });
      // rank: quality and breadth of qualifying candidates (DIRECT / ENABLER at J2 / J3, backed by data)
      const score = t.candidates.reduce((s, c) => s + STAGE_W[c.jstage] * EXPO_W[c.exposure] * CHECK_W[c.dataCheck || 'NO_DATA'] * (c.found === false ? 0.3 : 1), 0);
      t.rankScore = Math.round(score * 10) / 10;
      t.qualifies = t.candidates.some((c) => (c.jstage === 'J2' || c.jstage === 'J3') && (c.exposure === 'DIRECT' || c.exposure === 'ENABLER') && c.dataCheck !== 'CONTRADICTS' && c.found !== false);
      t.candidates.sort((a, b) => STAGE_W[b.jstage] * EXPO_W[b.exposure] - STAGE_W[a.jstage] * EXPO_W[a.exposure]);
    }
    g.themes.sort((a, b) => Number(!!b.qualifies) - Number(!!a.qualifies) || (b.rankScore ?? 0) - (a.rankScore ?? 0));
  }
}

/** "What changed" from the two stored runs: themes added / dropped, candidates added / dropped, J-stage moves. Pure. */
export function diffRuns(prev: Pick<ChokeReport, 'regions'> | null, next: Pick<ChokeReport, 'regions'>): ChokeChange[] {
  if (!prev) return [];
  const out: ChokeChange[] = [];
  for (const g of next.regions) {
    const p = prev.regions.find((x) => x.region === g.region);
    if (!p) continue;
    const pNames = new Set(p.themes.map((t) => t.name)), nNames = new Set(g.themes.map((t) => t.name));
    for (const t of g.themes) if (!pNames.has(t.name)) out.push({ region: g.region, kind: 'ADDED', what: `theme: ${t.name}`, from: null, to: null });
    for (const t of p.themes) if (!nNames.has(t.name)) out.push({ region: g.region, kind: 'DROPPED', what: `theme: ${t.name}`, from: null, to: null });
    const cands = (v: ChokeRegionView) => {
      const m = new Map<string, { stage: string | null; theme: string }>();
      for (const t of v.themes) {
        for (const c of (t.candidates || [])) m.set(c.ticker.toUpperCase(), { stage: c.jstage, theme: t.name });
        for (const c of [...(t.leaders || []), ...(t.smallMid || [])]) if (c?.ticker && !m.has(String(c.ticker).toUpperCase())) m.set(String(c.ticker).toUpperCase(), { stage: null, theme: t.name });
      }
      return m;
    };
    const pc = cands(p), nc = cands(g);
    for (const [k, v] of nc) {
      const o = pc.get(k);
      if (!o) out.push({ region: g.region, kind: 'ADDED', what: `${k} (${v.theme})`, from: null, to: v.stage });
      else if (o.stage && v.stage && o.stage !== v.stage) out.push({ region: g.region, kind: 'CHANGED', what: `${k} J-stage`, from: o.stage, to: v.stage });
    }
    for (const [k, v] of pc) if (!nc.has(k)) out.push({ region: g.region, kind: 'DROPPED', what: `${k} (${v.theme})`, from: v.stage, to: null });
  }
  return out.slice(0, 40);
}

const pctx = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);
/** The report as plain text (for copying). */
export function chokeAsText(r: ChokeReport): string {
  const out: string[] = [];
  for (const g of r.regions) {
    out.push(g.region === 'US' ? '🇺🇸 UNITED STATES' : '🇮🇳 INDIA', '');
    if (!g.themes.length) out.push('No qualifying themes in this run.', '');
    for (const t of g.themes) {
      out.push(`🔥 ${t.name} ${t.emoji}`.trim());
      out.push(`Why: ${t.why}`);
      if (t.necessity) out.push(`Necessity: ${t.necessity}`);
      if (t.constraint) out.push(`Supply constraint: ${t.constraint}`);
      if (t.valueCapture) out.push(`Value capture: ${t.valueCapture}`);
      if (t.breakers) out.push(`What could remove it: ${t.breakers}`);
      for (const c of t.candidates || []) {
        out.push(`  • ${c.name} (${c.ticker}) — ${c.exposure}, ${J_WORD[c.jstage]} — ${c.product}`);
        out.push(`    Evidence: ${c.inflection}`, `    Next: ${c.milestone} · Invalidation: ${c.invalidation} · Concern: ${c.concern}`);
        if (c.multiples) out.push(`    Scenario ${c.scenario?.years}y (calculated): bear ${c.multiples.bear}x · base ${c.multiples.base}x · bull ${c.multiples.bull}x (P/E now ${c.multiples.currentPe}) · ${c.scenario?.basis}`);
        if (c.facts) out.push(`    Data: sales q ${pctx(c.facts.revQ)} / yr ${pctx(c.facts.revA)} · op margin ${c.facts.opm == null ? '—' : `${Math.round(c.facts.opm)}%`} · 1y ${pctx(c.facts.p1y)} · 5y ${pctx(c.facts.p5y)}`);
      }
      if (!(t.candidates || []).length) out.push('  No qualifying small / mid-cap candidates yet.');
      if ((t.reference || []).length) out.push(`  Reference leaders: ${t.reference.map((c) => `${c.name} (${c.ticker})`).join(', ')}`);
      out.push('');
    }
    const pb = g.playbook;
    out.push(`🎯 Investor Playbook — ${g.region === 'US' ? 'US' : 'India'}`);
    const sec = (h: string, a?: string[]) => { if (a?.length) { out.push(h); for (const x of a) out.push(`• ${x}`); } };
    sec('Strongest evidence:', pb.strongest); sec('Needs confirmation:', pb.confirm); sec('Upcoming milestones:', pb.milestones); sec('Would weaken the thesis:', pb.disconfirming); sec('Valuation to watch:', pb.valuation);
    out.push('');
  }
  return out.join('\n').trim();
}
