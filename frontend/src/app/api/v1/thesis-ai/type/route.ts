// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/thesis-ai/type — LET AI CHOOSE ONE NAME'S THESIS TYPE.      (zzz837)
//
// POST { market: 'IN'|'US', input: AiTypeInput, force?: boolean }
//   → { ok, record, applied, why }
//
// Login-protected (PROTECTED_API_PREFIXES). AI runs ONLY because the owner
// clicked a button; the page sends one request per name. The model sees the
// company's business words, its filed figures and the provisional type's check
// results — never a price. Its answer is validated strictly (lib/thesis/
// ai-type): a type outside A/B/F/G, a missing reason, or a number that is not
// in the input turns into 'undecided', never a guess. The record is filed
// beside the picker's own map; the owner's own choice always wins.
//
// The key comes from the environment (lib/anthropic-meter); nothing is logged.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';
import { anthropicMessages, activeModel, modelConfigured, modelKeyName } from '@/lib/anthropic-meter';
import {
  AI_TYPE_TOOL, AI_TYPE_PROMPT_VERSION, buildAiTypePrompt, sanitizeAiTypeInput, validateAiTypeAnswer, toAiTypeRecord, type AiTypeRecord,
} from '@/lib/thesis/ai-type';
import { applyAiRecord, aiTypesKey, typesKey, type AiMap, type TypeMap } from '@/lib/thesis/ai-type-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';
const CALL_TIMEOUT_MS = 45_000;
const CACHE_TTL_S = 24 * 3600;

async function sha(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  // 40 names a minute: three at a time from the page stays well inside it.
  const limited = rateLimitResponse(req, 40, 60_000);
  if (limited) return limited;
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  const market: 'IN' | 'US' = body?.market === 'US' ? 'US' : 'IN';
  const input = sanitizeAiTypeInput({ ...(body?.input || {}), market });
  if (!input) return NextResponse.json({ ok: false, error: 'a valid input (market, symbol, figures) is required' }, { status: 400 });
  if (!modelConfigured()) return NextResponse.json({ ok: false, error: `The AI service is not configured (${modelKeyName()} is not set).` });

  const key = input.symbol;
  const [types, ai] = await Promise.all([
    kvGet<TypeMap>(typesKey(market)).catch(() => null).then((m) => m || {}),
    kvGet<AiMap>(aiTypesKey(market)).catch(() => null).then((m) => m || {}),
  ]);
  // The owner's own choice: no call is made at all.
  if (types[key] && !(ai[key] && ai[key].type !== 'undecided')) {
    return NextResponse.json({ ok: true, skipped: 'user', applied: false, why: 'user', note: 'You already chose this type yourself — AI does not overwrite it.' });
  }

  const prompt = buildAiTypePrompt(input);
  const cacheKey = `thesis-ai-type:${AI_TYPE_PROMPT_VERSION}:${market}:${await sha(prompt.system + prompt.user)}`;
  let record: AiTypeRecord | null = null;
  let cached = false;
  if (body?.force !== true) {
    const hit = await kvGet<AiTypeRecord>(cacheKey).catch(() => null);
    if (hit && hit.source === 'ai') { record = { ...hit, at: new Date().toISOString().slice(0, 10) }; cached = true; }
  }
  if (!record) {
    const model = activeModel(MODEL);
    let answer: unknown = null;
    try {
      const resp = await anthropicMessages('thesis-ai-type', {
        model, max_tokens: 900, temperature: 0, system: prompt.system,
        tools: [AI_TYPE_TOOL as any], tool_choice: { type: 'tool', name: AI_TYPE_TOOL.name },
        messages: [{ role: 'user', content: prompt.user }],
      }, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
      if (!resp.ok) {
        let detail = '';
        try { const j = JSON.parse(await resp.text()); detail = String(j?.error?.message || j?.message || '').slice(0, 200); } catch { /* status only */ }
        return NextResponse.json({ ok: false, error: `The AI service answered HTTP ${resp.status}${detail ? `: ${detail}` : ''}.` });
      }
      const j = await resp.json();
      answer = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === AI_TYPE_TOOL.name)?.input ?? null;
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `The AI service did not answer (${String(e?.message || e).slice(0, 120)}).` });
    }
    // Unusable or invalid → 'undecided' with the reason; never a guess.
    record = toAiTypeRecord(answer == null ? { ok: false, errors: ['the AI answered without filing a result'] } : validateAiTypeAnswer(answer, input), { model, at: new Date().toISOString() });
    await kvSet(cacheKey, record, CACHE_TTL_S).catch(() => undefined);
  }

  // File it beside the picker's map (re-read to avoid overwriting a concurrent user pick).
  const [types2, ai2] = await Promise.all([
    kvGet<TypeMap>(typesKey(market)).catch(() => null).then((m) => m || {}),
    kvGet<AiMap>(aiTypesKey(market)).catch(() => null).then((m) => m || {}),
  ]);
  const r = applyAiRecord(types2, ai2, key, record);
  if (r.applied) {
    await Promise.all([kvSet(typesKey(market), r.types), kvSet(aiTypesKey(market), r.ai)]).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, record, applied: r.applied, why: r.why, cached });
}
