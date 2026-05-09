// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3.11: LLM Event Extraction (server-side)
// ─────────────────────────────────────────────────────────────────────────────
// Optional Anthropic Haiku-tier extractor — replaces brittle regex
// consequence scoring with structured event extraction. Returns the same
// shape as extractSpecificImpact() in news/route.ts so the rest of the
// pipeline doesn't change.
//
// Gated entirely on ANTHROPIC_API_KEY env var. When the key is missing
// the function returns null and callers fall through to the regex
// path. This keeps the patch deployable WITHOUT new env-var setup —
// you just add the key in Vercel later to unlock the upgrade.
//
// Contract:
//   input:  { title, summary } from RSS article
//   output: {
//     ticker,                // e.g. 'NVDA'
//     event_type,            // 'earnings_beat'/'earnings_miss'/'guidance_raise'/...
//     direction,             // 'positive'/'negative'/'neutral'
//     magnitude_pct,         // 0–100 (extracted %)
//     duration,              // 'one_off'/'this_quarter'/'multi_quarter'/'structural'
//     confidence,            // 0–1 model's own confidence
//     transmission_chain,    // string — "Higher input cost → margin compression → guidance miss"
//     beneficiaries,         // string[] tickers
//     at_risk,               // string[] tickers
//   } | null
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmEventExtraction {
  ticker: string | null;
  event_type: string;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude_pct: number | null;
  duration: 'one_off' | 'this_quarter' | 'multi_quarter' | 'structural' | 'unknown';
  confidence: number;
  transmission_chain: string;
  beneficiaries: string[];
  at_risk: string[];
}

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an institutional equity-market event extractor. Read a news headline + summary and return ONLY a JSON object describing the event's market consequence. No prose.

Rules:
- Be conservative: when in doubt, mark direction='neutral' and confidence < 0.5.
- Direction reflects the event's first-order market impact, not just sentiment.
- Magnitude_pct: extract any percentage figure mentioned (5%, 49%, etc.). Null if none.
- Duration: 'one_off' (stock pop on print), 'this_quarter' (margin print event), 'multi_quarter' (cycle inflection), 'structural' (multi-year regime).
- Beneficiaries / at_risk: list 2–4 tickers ONLY if the event has a clear cross-sector ripple. Empty array otherwise. Use exchange-tagged tickers ('TSM', 'NVDA', 'HDFCBANK', 'INDIGO').
- Transmission chain: 1-sentence "X → Y → Z" causal chain in plain English.
- event_type vocabulary: earnings_beat, earnings_miss, guidance_raise, guidance_cut, rating_upgrade, rating_downgrade, capacity_expansion, capacity_constraint, mna, regulatory_action, capital_action, macro_signal, geopolitical_event, supply_chain_disruption, none.

Return JSON only. Schema:
{ "ticker": string|null, "event_type": string, "direction": "positive"|"negative"|"neutral", "magnitude_pct": number|null, "duration": "one_off"|"this_quarter"|"multi_quarter"|"structural"|"unknown", "confidence": number, "transmission_chain": string, "beneficiaries": string[], "at_risk": string[] }`;

export async function extractWithLlm(title: string, summary: string): Promise<LlmEventExtraction | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return null;        // graceful no-op when key absent
  if (!title || title.length < 8) return null;

  const userText = `Title: ${title}\nSummary: ${summary.slice(0, 600)}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text || '';
    if (!text) return null;
    // Extract JSON — model might wrap in ```json blocks
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    // Light schema validation — reject obviously malformed responses
    if (typeof parsed.event_type !== 'string') return null;
    if (!['positive', 'negative', 'neutral'].includes(parsed.direction)) return null;
    if (typeof parsed.confidence !== 'number') return null;
    return {
      ticker: parsed.ticker ?? null,
      event_type: parsed.event_type,
      direction: parsed.direction,
      magnitude_pct: typeof parsed.magnitude_pct === 'number' ? parsed.magnitude_pct : null,
      duration: parsed.duration ?? 'unknown',
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      transmission_chain: parsed.transmission_chain || '',
      beneficiaries: Array.isArray(parsed.beneficiaries) ? parsed.beneficiaries.slice(0, 4) : [],
      at_risk: Array.isArray(parsed.at_risk) ? parsed.at_risk.slice(0, 4) : [],
    };
  } catch {
    return null;
  }
}

// Cache wrapper — the same article can be re-ingested across cache cycles,
// don't pay for the LLM call every time. Cache by title hash for 24h.
const llmCache = new Map<string, { data: LlmEventExtraction | null; ts: number }>();
const LLM_CACHE_TTL = 24 * 60 * 60 * 1000;

export async function extractWithLlmCached(title: string, summary: string): Promise<LlmEventExtraction | null> {
  const key = title.slice(0, 200);
  const hit = llmCache.get(key);
  if (hit && Date.now() - hit.ts < LLM_CACHE_TTL) return hit.data;
  const data = await extractWithLlm(title, summary);
  llmCache.set(key, { data, ts: Date.now() });
  // Trim cache if it grows beyond 1000 entries
  if (llmCache.size > 1000) {
    const oldest = [...llmCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) llmCache.delete(oldest[0]);
  }
  return data;
}
