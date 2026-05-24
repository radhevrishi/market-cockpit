// ═══════════════════════════════════════════════════════════════════════════
// ANTHROPIC LLM ATTRIBUTION LAYER (PATCH 0798, optional, env-gated)
//
// When ANTHROPIC_API_KEY is set in Vercel env vars, this module sends each
// EXTREME mover (≥10%) + its supporting evidence to Claude Haiku for a
// per-row analyst note. Result is cached in KV with a 6h TTL so we don't
// re-bill on every page hit.
//
// When the env var is missing, every function NO-OPS — returns undefined.
// This is deliberate: the existing catalyst-scoring engine produces a
// usable label without LLM help; LLM only adds the "interpretation layer"
// (operating leverage inflection, quality of earnings, etc).
//
// Cost estimate (Claude Haiku):
//   • ~$0.0008 input + $0.004 output per request
//   • ~30 extreme movers per day max
//   • 6h cache: ~4 unique calls per stock per day
//   • Total: ~$0.001 × 30 × 4 = $0.12/day = ~$3.60/month
//
// Wire-up steps (manual, by user):
//   1. Add ANTHROPIC_API_KEY env var in Vercel project settings
//   2. Redeploy
//   3. /api/market/quotes (or a wrapper) calls enrichWithLLM() for extreme movers
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from './kv';

interface LlmInput {
  ticker: string;
  company?: string;
  sector?: string;
  changePercent: number;
  marketCap?: number;
  primaryDriverLocal?: string;     // from catalyst-scoring local engine
  filingsRecent?: Array<{ subject?: string; filing_datetime?: string }>;
  newsHeadlines?: string[];
  earningsTier?: string;
  salesYoY?: number;
  patYoY?: number;
}

export interface LlmAttribution {
  primaryDriver: string;
  secondaryDriver?: string;
  qualityOfEarnings?: 'high' | 'medium' | 'low' | 'na';
  sustainabilityScore?: number;    // 0-100
  analystNote: string;             // 2-3 sentence institutional read
  flags?: string[];                // e.g. ['exceptional gain dominates', 'low free float']
  generatedAt: string;
  model: string;                   // 'claude-haiku-4-5-20251001' etc
}

const KV_TTL = 6 * 60 * 60;        // 6h cache per ticker

function cacheKey(ticker: string, isoDate: string): string {
  return `llm-attrib:v1:${ticker}:${isoDate}`;
}

/**
 * Enrich a mover with Claude-generated attribution. Returns undefined when:
 *  • ANTHROPIC_API_KEY is missing
 *  • The Anthropic API call fails (network / quota)
 *  • Input ticker has no supporting evidence (can't ask LLM with nothing)
 *
 * Caller MUST treat the return as optional and fall back to local scoring.
 */
export async function enrichWithLLM(input: LlmInput): Promise<LlmAttribution | undefined> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return undefined;

  const isoDate = new Date().toISOString().slice(0, 10);
  const ck = cacheKey(input.ticker, isoDate);
  // Try cache first
  try {
    const cached = await kvGet<LlmAttribution>(ck);
    if (cached) return cached;
  } catch {}

  // Need at least some evidence to make a Claude call worthwhile
  const hasEvidence = (input.filingsRecent?.length || 0) > 0
    || (input.newsHeadlines?.length || 0) > 0
    || input.earningsTier
    || typeof input.salesYoY === 'number';
  if (!hasEvidence) return undefined;

  const prompt = buildPrompt(input);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      console.warn(`[llm-attrib] HTTP ${resp.status} for ${input.ticker}`);
      return undefined;
    }
    const json = await resp.json();
    const text = (json?.content?.[0]?.text || '').trim();
    if (!text) return undefined;

    const parsed = parseLlmResponse(text);
    if (!parsed) return undefined;

    const result: LlmAttribution = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      model: 'claude-haiku-4-5-20251001',
    };

    // Cache 6h
    try { await kvSet(ck, result, KV_TTL); } catch {}
    return result;
  } catch (e) {
    console.warn(`[llm-attrib] error for ${input.ticker}: ${(e as Error)?.message || e}`);
    return undefined;
  }
}

const SYSTEM_PROMPT = `You are an institutional equity analyst providing terse attribution notes
for sharp single-day stock moves on Indian (NSE) markets. Output ONLY a JSON object with:
  primaryDriver         (string, ≤8 words)
  secondaryDriver       (string, ≤8 words, optional)
  qualityOfEarnings     ("high"|"medium"|"low"|"na")
  sustainabilityScore   (number 0-100)
  analystNote           (string, ≤200 chars, 2-3 sentence institutional read)
  flags                 (array of short strings, ≤4 items)

Be honest. If evidence is thin, say so in analystNote and downgrade
sustainabilityScore. Distinguish operational earnings from exceptional/one-time gains.
Do not invent data not in the input. Never include speculation about FII/DII flows
or operator activity unless input explicitly mentions them.`;

function buildPrompt(input: LlmInput): string {
  const lines: string[] = [];
  lines.push(`Ticker: ${input.ticker}`);
  if (input.company) lines.push(`Company: ${input.company}`);
  if (input.sector) lines.push(`Sector: ${input.sector}`);
  lines.push(`Day move: ${input.changePercent >= 0 ? '+' : ''}${input.changePercent.toFixed(1)}%`);
  if (typeof input.marketCap === 'number' && input.marketCap > 0) {
    lines.push(`Market cap: ₹${input.marketCap.toFixed(0)} Cr`);
  }
  if (input.primaryDriverLocal) lines.push(`Local engine label: ${input.primaryDriverLocal}`);
  if (input.earningsTier) lines.push(`Earnings tier (local): ${input.earningsTier}`);
  if (typeof input.salesYoY === 'number') lines.push(`Sales YoY: ${input.salesYoY.toFixed(0)}%`);
  if (typeof input.patYoY === 'number') lines.push(`PAT YoY: ${input.patYoY.toFixed(0)}%`);
  if (input.filingsRecent?.length) {
    lines.push('Recent exchange filings:');
    for (const f of input.filingsRecent.slice(0, 5)) {
      lines.push(`  • ${(f.subject || '').slice(0, 140)}`);
    }
  }
  if (input.newsHeadlines?.length) {
    lines.push('Recent news headlines:');
    for (const h of input.newsHeadlines.slice(0, 5)) {
      lines.push(`  • ${h.slice(0, 140)}`);
    }
  }
  lines.push('');
  lines.push('Return JSON only.');
  return lines.join('\n');
}

function parseLlmResponse(text: string): Omit<LlmAttribution, 'generatedAt' | 'model'> | null {
  // Tolerate code fences / leading prose
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.primaryDriver !== 'string') return null;
    if (typeof parsed.analystNote !== 'string') return null;
    return {
      primaryDriver: parsed.primaryDriver,
      secondaryDriver: parsed.secondaryDriver,
      qualityOfEarnings: parsed.qualityOfEarnings,
      sustainabilityScore: typeof parsed.sustainabilityScore === 'number' ? parsed.sustainabilityScore : undefined,
      analystNote: parsed.analystNote,
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 4) : undefined,
    };
  } catch {
    return null;
  }
}
