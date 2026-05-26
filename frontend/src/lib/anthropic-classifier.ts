// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0931 — Anthropic Haiku catalyst classifier
//
// Replaces regex-based catalyst classification with Claude Haiku LLM calls.
// User feedback: "use this only for best ls" — i.e. only for high-value
// signals, not every classification. Implementation respects that:
//
//   1. KV-cached by content hash (24h TTL). Same headline never hits LLM twice.
//   2. Daily budget cap (default $0.50/day = ~625 Haiku calls). Halts cleanly.
//   3. Falls back to existing regex classifier on any error.
//   4. ONLY called from the live-feed scoring path for TIER_A candidates —
//      not blanket-applied to every news item.
//
// Cost math for the user (Claude Haiku 4.5):
//   - $0.25 per 1M input tokens / $1.25 per 1M output tokens
//   - Typical catalyst classification: ~250 input tokens + 50 output tokens
//   - Cost per call: ~$0.00006 + $0.00006 = $0.00012
//   - At $5 credit budget: ~40K classifications max (way more than user needs)
//
// ════════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet, isRedisAvailable } from './kv';
import { createHash } from 'crypto';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const CACHE_PREFIX = 'haiku-cls:v1:';
const CACHE_TTL_SECONDS = 24 * 3600;  // 24h — catalyst meaning is stable for a single news item
const BUDGET_KEY = 'haiku-cls:budget:v1';
const DEFAULT_DAILY_BUDGET_USD = 0.50;
const APPROX_COST_PER_CALL_USD = 0.00012;

// ─── Output type ───────────────────────────────────────────────────────────
export type CatalystType =
  | 'M&A'          // Acquisition, merger, stake purchase, takeover
  | 'EARNINGS'     // Results, profit, revenue announcement
  | 'GUIDANCE'     // Forward guidance, outlook upgrade/downgrade
  | 'ORDER_WIN'    // New order, contract win, supply agreement
  | 'CAPEX'        // Plant expansion, new facility, investment plan
  | 'LITIGATION'   // Legal dispute, regulatory action
  | 'MANAGEMENT'   // CEO/CXO change, board appointment
  | 'DIVIDEND'     // Dividend declaration, special dividend
  | 'BUYBACK'      // Share buyback program
  | 'RATING'       // Credit rating action (upgrade / downgrade)
  | 'STRUCTURAL'   // Demerger, spinoff, restructuring
  | 'BLOCK_DEAL'   // Bulk/block deal, large stake transaction
  | 'OTHER';       // Doesn't fit above categories

export interface HaikuCatalystResult {
  catalyst_type: CatalystType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  one_line: string;          // Short institutional-grade summary (max ~80 chars)
  entities?: {
    acquirer?: string;
    target?: string;
    stake_pct?: number;
    value_cr?: number;       // Deal value in INR Cr
  };
  source: 'haiku' | 'cache' | 'fallback';
}

// ─── Budget tracking ───────────────────────────────────────────────────────
interface BudgetState {
  date: string;         // YYYY-MM-DD IST
  callsCount: number;
  estimatedCostUsd: number;
}

async function readBudget(): Promise<BudgetState> {
  if (!isRedisAvailable()) {
    return { date: todayIst(), callsCount: 0, estimatedCostUsd: 0 };
  }
  const b = await kvGet<BudgetState>(BUDGET_KEY);
  if (!b || b.date !== todayIst()) {
    return { date: todayIst(), callsCount: 0, estimatedCostUsd: 0 };
  }
  return b;
}

async function bumpBudget(): Promise<BudgetState> {
  const current = await readBudget();
  const next: BudgetState = {
    date: todayIst(),
    callsCount: current.callsCount + 1,
    estimatedCostUsd: current.estimatedCostUsd + APPROX_COST_PER_CALL_USD,
  };
  if (isRedisAvailable()) {
    try { await kvSet(BUDGET_KEY, next, 26 * 3600); } catch {}
  }
  return next;
}

function todayIst(): string {
  const now = new Date();
  const istMs = now.getTime() + (now.getTimezoneOffset() + 330) * 60_000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function dailyBudgetUsd(): number {
  const env = process.env.HAIKU_DAILY_BUDGET_USD;
  const parsed = env ? parseFloat(env) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_BUDGET_USD;
}

// ─── Cache helpers ─────────────────────────────────────────────────────────
function cacheKeyFor(headline: string, ticker?: string): string {
  const norm = (headline || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(`${ticker || ''}|${norm}`).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}${hash}`;
}

// ─── Public API ────────────────────────────────────────────────────────────
/**
 * Classify a corporate filing/news headline with Haiku.
 *
 * Returns null if:
 *   - ANTHROPIC_API_KEY is not configured
 *   - Daily budget is exhausted
 *   - Anthropic API errored
 *
 * Caller should fall back to existing regex classifier on null.
 */
export async function classifyCatalyst(
  headline: string,
  ticker?: string
): Promise<HaikuCatalystResult | null> {
  // 1. Cache check
  const ckey = cacheKeyFor(headline, ticker);
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<HaikuCatalystResult>(ckey);
      if (cached) {
        return { ...cached, source: 'cache' };
      }
    } catch {}
  }
  // 2. API key check
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // 3. Budget check
  const budget = await readBudget();
  if (budget.estimatedCostUsd >= dailyBudgetUsd()) {
    console.warn(`[haiku-cls] daily budget exhausted ($${budget.estimatedCostUsd.toFixed(3)} / $${dailyBudgetUsd()})`);
    return null;
  }
  // 4. Call Anthropic
  try {
    const result = await callAnthropic(headline, ticker, apiKey);
    if (!result) return null;
    // Persist cache + bump budget (do not await — fire-and-forget)
    if (isRedisAvailable()) {
      kvSet(ckey, result, CACHE_TTL_SECONDS).catch(() => {});
    }
    bumpBudget().catch(() => {});
    return { ...result, source: 'haiku' };
  } catch (e) {
    console.warn(`[haiku-cls] API call failed:`, (e as Error).message);
    return null;
  }
}

async function callAnthropic(
  headline: string,
  ticker: string | undefined,
  apiKey: string
): Promise<HaikuCatalystResult | null> {
  const systemPrompt = `You are an institutional equity research catalyst classifier for Indian (NSE/BSE) listed companies. Given a single corporate filing or news headline, classify it into ONE category and extract any structured entities present.

Categories (use the exact label):
- M&A: Acquisition, merger, stake purchase, open offer, takeover, control change
- EARNINGS: Quarterly results, profit/loss/revenue announcement
- GUIDANCE: Forward guidance, outlook upgrade/downgrade, management commentary
- ORDER_WIN: New order, contract award, supply agreement, framework agreement, EPC
- CAPEX: Plant expansion, new facility, capacity addition, investment plan
- LITIGATION: Legal dispute, regulatory action, SEBI/NCLT order
- MANAGEMENT: CEO/CXO/CFO change, board appointment or resignation
- DIVIDEND: Dividend declaration, interim dividend, special dividend, record date
- BUYBACK: Share buyback program, tender offer
- RATING: Credit rating action — upgrade, downgrade, outlook revision (CRISIL/CARE/ICRA/Fitch/Moody's)
- STRUCTURAL: Demerger, spinoff, scheme of arrangement, restructuring, hive-off
- BLOCK_DEAL: Bulk/block deal, large stake transaction
- OTHER: Doesn't fit above categories

Confidence: HIGH if the catalyst is unambiguous, MEDIUM if interpretation needed, LOW if speculative.

Output JSON ONLY (no markdown, no commentary). Schema:
{
  "catalyst_type": "M&A|EARNINGS|GUIDANCE|ORDER_WIN|CAPEX|LITIGATION|MANAGEMENT|DIVIDEND|BUYBACK|RATING|STRUCTURAL|BLOCK_DEAL|OTHER",
  "confidence": "HIGH|MEDIUM|LOW",
  "one_line": "Short institutional summary, max 80 chars",
  "entities": {
    "acquirer": "Company name if M&A and acquirer is named",
    "target": "Company name if M&A and target is named",
    "stake_pct": 43.5,
    "value_cr": 1369
  }
}

If a field doesn't apply, OMIT it (don't use null). Keep entities object minimal.`;

  const userPrompt = ticker
    ? `Ticker: ${ticker}\nHeadline: ${headline}`
    : `Headline: ${headline}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    // 8s timeout — Haiku usually responds in <2s. If slower, fall back.
    signal: AbortSignal.timeout(8_000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
  if (!text) return null;
  // Parse JSON. Haiku occasionally wraps in markdown fences — strip if present.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); }
  catch {
    console.warn('[haiku-cls] non-JSON response:', cleaned.slice(0, 200));
    return null;
  }
  // Validate
  const validTypes: CatalystType[] = ['M&A','EARNINGS','GUIDANCE','ORDER_WIN','CAPEX','LITIGATION','MANAGEMENT','DIVIDEND','BUYBACK','RATING','STRUCTURAL','BLOCK_DEAL','OTHER'];
  if (!validTypes.includes(parsed.catalyst_type)) {
    return null;
  }
  if (!['HIGH','MEDIUM','LOW'].includes(parsed.confidence)) {
    return null;
  }
  return {
    catalyst_type: parsed.catalyst_type,
    confidence: parsed.confidence,
    one_line: String(parsed.one_line || '').slice(0, 160),
    entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : undefined,
    source: 'haiku',
  };
}

/** Diagnostic — read current budget state. */
export async function getHaikuBudget(): Promise<BudgetState & { dailyCapUsd: number; remainingUsd: number }> {
  const b = await readBudget();
  const cap = dailyBudgetUsd();
  return { ...b, dailyCapUsd: cap, remainingUsd: Math.max(0, cap - b.estimatedCostUsd) };
}
