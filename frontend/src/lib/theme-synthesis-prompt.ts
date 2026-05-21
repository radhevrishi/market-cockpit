// ═══════════════════════════════════════════════════════════════════════════
// THEME SYNTHESIS PROMPT (PATCH 0631)
//
// The user's canonical prompt for LLM-driven theme synthesis. Used when
// ANTHROPIC_API_KEY is set and a /api/v1/themes/synthesize Vercel route
// is added. Until then, this lives here as the contract for full theme
// dynamism: feed it (a) recent news headlines, (b) this prompt, (c) get
// back fresh CriticalTheme[] arrays.
//
// To wire this up:
//   1. Set ANTHROPIC_API_KEY in Vercel env.
//   2. Create /api/v1/themes/synthesize/route.ts that POSTs to Claude.
//   3. Cron-job calls it once a week, caches result in KV under
//      'themes:synthesized:v1' with 7-day TTL.
//   4. /critical-themes page reads from KV first, falls back to the
//      static lib/critical-themes.ts list.
// ═══════════════════════════════════════════════════════════════════════════

export const THEME_SYNTHESIS_PROMPT = `You are my expert equity analyst.

📌 Task
Identify the 6-8 strongest high-growth, choke-point investment themes for the next 10+ years for BOTH the US and India.

⚖️ Important
Treat US and India separately. Each geography must have its own themes and tailwinds, because structural drivers differ.

📝 Rules
- Only include themes that are mission-critical, monopoly-driven, or policy-backed.
- Exclude weak or themeless sectors (housing, staples, generic EM).
- Exclude any company with audit issues, promoter-family disputes, board conflicts, or weak governance credibility.
- Only include stocks with clean balance sheets, trustworthy management, and proven execution.

📊 Output Requirements
For each geography (US first, then India), output a JSON array of CriticalTheme objects with this shape:
{
  "id": "us-rare-earths",
  "region": "US",
  "name": "Critical Minerals & Rare Earths",
  "emoji": "🌍⚡",
  "why": "2-3 line structural driver (macro, geopolitics, tech, policy)",
  "leaders": [
    { "ticker": "MP", "name": "MP Materials", "exchange": "NYSE", "note": "optional context" }
  ],
  "bearCase": "downside (-60% to -90%)",
  "bullCase": "upside (5×-20×)",
  "priorityRank": 1,
  "searchKeywords": ["rare earth", "critical mineral", "lithium"]
}

🎨 Style Example
🔥 Critical Minerals & Rare Earths 🌍⚡
Why: The US, EU, Japan cannot stay dependent on China for rare earths (95%+ refining controlled). Decoupling is already underway (CHIPS Act, IRA). Whoever controls enrichment, refining & supply chains becomes a strategic choke point.
Leaders: MP Materials (MP), Energy Fuels (UUUU), Lynas (LYC, Aus).
Asymmetry: Crushed in liquidity bear (-70%); policy + supply crunch = 5-10× upside into 2030s.

Return a JSON object: { "us": [CriticalTheme...], "india": [CriticalTheme...] }
`;

/** Stub server-call function. When Anthropic API key is configured, this
 *  POSTs the prompt + recent news context to /api/v1/themes/synthesize
 *  which calls Claude. Returns a fresh theme list. */
export async function synthesizeThemesLive(opts: { newsHeadlines: string[] }): Promise<any | null> {
  try {
    const r = await fetch('/api/v1/themes/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines: opts.newsHeadlines.slice(0, 200), prompt: THEME_SYNTHESIS_PROMPT }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
