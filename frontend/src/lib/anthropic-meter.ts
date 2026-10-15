// ═══════════════════════════════════════════════════════════════════════════
// THE MODEL METER — one wrapper, two providers.                (zzz747, zzz750)
//
// Every model call in this codebase goes through `anthropicMessages()`. The
// name is historical: the callers speak Anthropic's Messages shape (system,
// messages, tools with input_schema, forced tool_choice) and read Anthropic's
// response shape (content blocks, usage, stop_reason). zzz750 adds OpenAI as
// a provider BEHIND that shape: the request is translated to Chat Completions
// on the way out and the answer translated back on the way in, so the eight
// callers, their prompts, tool schemas, quote gates and tests are untouched.
//
//   AI_PROVIDER=openai | anthropic   (default: openai when OPENAI_API_KEY is
//                                     set, else anthropic)
//   OPENAI_MODEL                     (default gpt-5-mini; every caller's
//                                     Claude model id maps to this one)
//   OPENAI_REASONING_EFFORT          (default minimal — these are extraction
//                                     calls, not essays)
//
// It does three things the raw fetch did not:
//
//   1. RECORDS what each call actually cost, from the API's own `usage`
//      block (input/output/cache tokens) priced with the table below — not an
//      estimate from character counts. Spend is kept per calendar month, per
//      feature, in KV, so /system-status can show "this month: $X, of which
//      gainers $a, catalysts $b, …".
//
//   2. ENFORCES a monthly cap. `ANTHROPIC_MONTHLY_CAP_USD` (default 60). At
//      the cap, calls are refused BEFORE they reach the API with a synthetic
//      HTTP 402 whose body carries a plain-English message; every caller
//      already surfaces "HTTP <status>: <message>", so the refusal reads on
//      the card as "Monthly Anthropic cap reached ($60.00 of $60) — raise
//      ANTHROPIC_MONTHLY_CAP_USD in Railway to continue". Nothing crashes,
//      nothing silently degrades: a capped call is a labelled failure.
//
//   3. Reads the key from the environment in ONE place. No caller handles
//      the key any more (Rule 7).
//
// Accounting is best-effort: the ledger is read-modify-write over KV, spread
// across 8 shards to keep concurrent calls from overwriting each other. A
// lost update under-counts by one call; it never over-counts. If KV is down
// the call still proceeds (the cap is a budget guard, not a kill switch) and
// the miss is counted in `unrecorded`.
//
// Pricing is per million tokens in USD, from Anthropic's public price list.
// Update the table when prices change; the version tag makes old months'
// figures comparable.
// ═══════════════════════════════════════════════════════════════════════════

import { withUntrustedRule } from './ai-fence';
import { kvGet, kvSet, isRedisAvailable, kvIncrByFloat } from '@/lib/kv';

// zzz978b — a key pasted with a space, a line break or quote marks around it is rejected by the provider as invalid.
// Clean both keys once, before anything reads them. The value itself is never logged.
export function cleanKeyValue(v: string | undefined): string | undefined {
  if (typeof v !== 'string') return v;
  const c = v.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim().replace(/^(?:ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*/i, '').trim();
  return c;
}
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const) {
  const v = process.env[k];
  const c = cleanKeyValue(v);
  if (v && c !== v) process.env[k] = c;
}
/** What the Anthropic key looks like, without revealing it: its length and whether it has the usual sk-ant- start. */
export function anthropicKeyShape(): string {
  const k = process.env.ANTHROPIC_API_KEY || '';
  if (!k) return 'no key set';
  return `${k.length} characters, ${/^sk-ant-/.test(k) ? 'starts with sk-ant- as an Anthropic key should' : 'does NOT start with sk-ant- (not an Anthropic API key?)'}`;
}

export const METER_VERSION = 'v1';

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5':  { input: 1,    output: 5,    cacheRead: 0.10,  cacheWrite: 1.25 },
  'claude-sonnet-4-5': { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75 },
  'claude-opus-4-1':   { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
  // OpenAI (per M tokens; cached input is billed at the cacheRead rate,
  // there is no cache-write premium). Verify against the pricing page.
  'gpt-5-nano':        { input: 0.05, output: 0.40, cacheRead: 0.005, cacheWrite: 0.05 },
  'gpt-5-mini':        { input: 0.25, output: 2.00, cacheRead: 0.025, cacheWrite: 0.25 },
  'gpt-5':             { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-4.1-nano':      { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  'gpt-4.1-mini':      { input: 0.40, output: 1.60, cacheRead: 0.10,  cacheWrite: 0.40 },
  'gpt-4.1':           { input: 2,    output: 8,    cacheRead: 0.50,  cacheWrite: 2 },
  'gpt-4o-mini':       { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.15 },
  // zzz1051 — document search embeddings (input only)
  'text-embedding-3-small': { input: 0.02, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Price table row for a model id like `claude-haiku-4-5-20251001`. */
export function pricingFor(model: string) {
  const m = String(model || '').toLowerCase();
  const key = Object.keys(PRICING).filter((k) => m.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key] : null;
}

/** Cost of one call in USD from its usage block. 0 when the model is unknown. */
export function costOf(model: string, u: Usage | null | undefined): number {
  const p = pricingFor(model);
  if (!p || !u) return 0;
  const n = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return (
    (n(u.input_tokens) * p.input +
      n(u.output_tokens) * p.output +
      n(u.cache_read_input_tokens) * p.cacheRead +
      n(u.cache_creation_input_tokens) * p.cacheWrite) / 1_000_000
  );
}

export interface FeatureSpend {
  calls: number;
  blocked: number;
  /** Calls the API refused (4xx/5xx) or that did not answer. Not billed. */
  failed: number;
  input_tokens: number;
  output_tokens: number;
  usd: number;
  last_at: string | null;
  last_error: { at: string; status: number; message: string } | null;
}

export interface SpendLedger {
  month: string;
  total_usd: number;
  calls: number;
  blocked: number;
  failed: number;
  unrecorded: number;
  by_feature: Record<string, FeatureSpend>;
  updated_at: string | null;
  /** The most recent refusal from the API, whatever the feature. */
  last_error: { at: string; status: number; message: string; feature: string } | null;
}

export const SHARDS = 8;
export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);
export const shardKey = (month: string, shard: number) => `anthropic:spend:${METER_VERSION}:${month}:${shard}`;

export function emptyLedger(month: string): SpendLedger {
  return { month, total_usd: 0, calls: 0, blocked: 0, failed: 0, unrecorded: 0, by_feature: {}, updated_at: null, last_error: null };
}

const emptyFeature = (): FeatureSpend => ({ calls: 0, blocked: 0, failed: 0, input_tokens: 0, output_tokens: 0, usd: 0, last_at: null, last_error: null });

/** Pure: fold one call into a ledger. `failure` = the API refused or did not answer. */
export function applyCall(l: SpendLedger, feature: string, usd: number, u: Usage | null, at: string, blocked = false, failure?: { status: number; message: string }): SpendLedger {
  const f = l.by_feature[feature] || emptyFeature();
  if (f.failed == null) { f.failed = 0; f.last_error = null; }   // ledgers written before failures were tracked
  if (l.failed == null) { l.failed = 0; l.last_error = null; }
  if (blocked) { f.blocked += 1; l.blocked += 1; }
  else if (failure) {
    f.failed += 1; l.failed += 1;
    f.last_error = { at, status: failure.status, message: failure.message.slice(0, 300) };
    l.last_error = { ...f.last_error, feature };
  } else {
    f.calls += 1; l.calls += 1;
    f.input_tokens += Number(u?.input_tokens || 0) + Number(u?.cache_read_input_tokens || 0) + Number(u?.cache_creation_input_tokens || 0);
    f.output_tokens += Number(u?.output_tokens || 0);
    f.usd += usd; l.total_usd += usd;
  }
  f.last_at = at;
  l.by_feature[feature] = f;
  l.updated_at = at;
  return l;
}

/** Pure: sum shards into one ledger. */
export function mergeLedgers(month: string, parts: Array<SpendLedger | null>): SpendLedger {
  const out = emptyLedger(month);
  for (const p of parts) {
    if (!p) continue;
    out.total_usd += p.total_usd; out.calls += p.calls; out.blocked += p.blocked; out.failed += p.failed || 0; out.unrecorded += p.unrecorded;
    if (p.updated_at && (!out.updated_at || p.updated_at > out.updated_at)) out.updated_at = p.updated_at;
    if (p.last_error && (!out.last_error || p.last_error.at > out.last_error.at)) out.last_error = p.last_error;
    for (const [k, f] of Object.entries(p.by_feature)) {
      const o = out.by_feature[k] || emptyFeature();
      o.calls += f.calls; o.blocked += f.blocked; o.failed += f.failed || 0; o.input_tokens += f.input_tokens; o.output_tokens += f.output_tokens; o.usd += f.usd;
      if (f.last_at && (!o.last_at || f.last_at > o.last_at)) o.last_at = f.last_at;
      if (f.last_error && (!o.last_error || f.last_error.at > o.last_error.at)) o.last_error = f.last_error;
      out.by_feature[k] = o;
    }
  }
  return out;
}

export function monthlyCapUsd(): number {
  const v = Number(process.env.AI_MONTHLY_CAP_USD || process.env.ANTHROPIC_MONTHLY_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export type Provider = 'anthropic' | 'openai';
export function provider(): Provider {
  const p = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (p === 'openai' || p === 'anthropic') return p;
  return process.env.OPENAI_API_KEY ? 'openai' : 'anthropic';
}
export const openaiModel = () => process.env.OPENAI_MODEL || 'gpt-5-mini';
/** True when the active provider has a key. Callers ask THIS, never the env. */
export const modelConfigured = () => (provider() === 'openai' ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY);
/** The env var a human must set for the active provider — for error text. */
export const modelKeyName = () => (provider() === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
/** The model that actually answers a call, for records and cards. */
export const activeModel = (requested = 'claude-haiku-4-5-20251001') => (provider() === 'openai' ? openaiModel() : requested);

const SHARD_TTL_S = 400 * 24 * 3600;   // 13 months: last year's months stay comparable

export async function readSpend(month = monthOf()): Promise<SpendLedger> {
  if (!isRedisAvailable()) return emptyLedger(month);
  const parts = await Promise.all(Array.from({ length: SHARDS }, (_, i) => kvGet<SpendLedger>(shardKey(month, i)).catch(() => null)));
  return mergeLedgers(month, parts);
}

async function record(feature: string, usd: number, u: Usage | null, blocked: boolean, failure?: { status: number; message: string }): Promise<void> {
  if (!isRedisAvailable()) return;
  const month = monthOf();
  const shard = Math.floor(Math.random() * SHARDS);
  const key = shardKey(month, shard);
  // zzz883: an ATOMIC monthly total next to the per-feature shards — the shards can lose an update when two calls land together,
  // the total cannot, and the spend cap reads the larger of the two
  if (usd > 0) await kvIncrByFloat(totalKey(month), usd, SHARD_TTL_S).catch(() => null);
  try {
    const cur = (await kvGet<SpendLedger>(key)) || emptyLedger(month);
    await kvSet(key, applyCall(cur, feature, usd, u, new Date().toISOString(), blocked, failure), SHARD_TTL_S);
  } catch {
    // Counted, not hidden: the next successful write carries the miss.
    try {
      const cur = (await kvGet<SpendLedger>(key)) || emptyLedger(month);
      cur.unrecorded += 1;
      await kvSet(key, cur, SHARD_TTL_S);
    } catch { /* KV is down; the call itself already went through */ }
  }
}

export interface GateResult { allowed: boolean; spent: number; cap: number; message?: string }

const totalKey = (month: string) => `anthropic:spend-total:${METER_VERSION}:${month}`;
let lastSpent: { month: string; usd: number } | null = null;
export async function spendGate(): Promise<GateResult> {
  const cap = monthlyCapUsd();
  let spent = 0;
  const month = monthOf();
  try {
    const [led, tot] = await Promise.all([readSpend(), kvGet<number | string>(totalKey(month)).catch(() => null)]);
    spent = Math.max(led.total_usd, Number(tot) || 0);
    lastSpent = { month, usd: spent };
  } catch {
    // zzz883: a failed read no longer means "$0 spent" — the last known figure this server saw is used
    spent = lastSpent && lastSpent.month === month ? lastSpent.usd : 0;
  }
  if (spent >= cap) {
    return { allowed: false, spent, cap, message: `Monthly AI cap reached ($${spent.toFixed(2)} of $${cap}) — raise AI_MONTHLY_CAP_USD in Railway to continue` };
  }
  return { allowed: true, spent, cap };
}

export interface MessagesBody {
  model: string;
  max_tokens: number;
  system?: string | Array<Record<string, any>>;
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
}

// ── OpenAI translation (pure, tested) ───────────────────────────────────────

function systemText(sys: MessagesBody['system']): string {
  if (!sys) return '';
  if (typeof sys === 'string') return sys;
  return sys.map((b: any) => (typeof b === 'string' ? b : String(b?.text || ''))).join('\n');
}

function contentText(c: any): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b: any) => (typeof b === 'string' ? b : b?.type === 'text' ? String(b.text || '') : '')).join('\n');
  return String(c ?? '');
}

/** Anthropic Messages request → OpenAI Chat Completions request. */
export function toOpenAIRequest(body: MessagesBody, model: string, reasoningEffort = 'low'): Record<string, any> {
  const messages: any[] = [];
  const sys = systemText(body.system);
  if (sys) messages.push({ role: 'system', content: sys });
  for (const m of body.messages) {
    // zzz783: a native PDF `document` block (OCR of a scanned filing) is sent
    // to OpenAI as a Chat Completions `file` part — base64 inline, same bytes.
    const parts = Array.isArray(m.content) ? m.content as any[] : null;
    const pdfs = parts ? parts.filter((c) => c?.type === 'document' && c?.source?.type === 'base64' && /pdf/i.test(String(c?.source?.media_type || ''))) : [];
    if (m.role === 'user' && pdfs.length) {
      const content: any[] = pdfs.map((c, i) => ({ type: 'file', file: { filename: `filing-${i + 1}.pdf`, file_data: `data:application/pdf;base64,${c.source.data}` } }));
      const txt = parts!.filter((c) => c?.type === 'text').map((c) => String(c.text || '')).join('\n');
      if (txt) content.push({ type: 'text', text: txt });
      messages.push({ role: m.role, content });
    } else messages.push({ role: m.role, content: contentText(m.content) });
  }
  const reasoning = /^gpt-5/.test(model) || /^o\d/.test(model);
  // A caller's max_tokens is a budget for the VISIBLE answer. On reasoning
  // models the same budget also pays for hidden reasoning tokens, and the
  // first live call proved it: 2,600 completion tokens = the cap, and the
  // function arguments arrived cut off mid-JSON. So reasoning models get
  // headroom, and extraction runs at minimal effort — the prompts already
  // say exactly what to file.
  const out: Record<string, any> = { model, messages, max_completion_tokens: reasoning ? body.max_tokens * 2 + 4000 : body.max_tokens };
  // gpt-5 models take reasoning_effort and refuse a non-default temperature;
  // older models take temperature and ignore reasoning.
  if (reasoning) out.reasoning_effort = reasoningEffort;
  else if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (body.tools?.length) {
    out.tools = body.tools.map((t: any) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
    const tc = body.tool_choice;
    if (tc?.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } };
    else if (tc?.type === 'any') out.tool_choice = 'required';
    else if (tc?.type === 'none') out.tool_choice = 'none';
  }
  return out;
}

/** OpenAI Chat Completions response → Anthropic Messages response shape. */
export function fromOpenAIResponse(j: any): Record<string, any> {
  const choice = j?.choices?.[0] || {};
  const msg = choice.message || {};
  const content: any[] = [];
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text || '').join('') : '';
  if (text) content.push({ type: 'text', text });
  for (const tc of msg.tool_calls || []) {
    if (tc?.type !== 'function') continue;
    let input: any = null;
    try { input = JSON.parse(tc.function?.arguments || ''); } catch { input = null; }
    // Unparseable arguments are dropped: callers treat "no tool_use block" as
    // "the model answered without filing a result", which is the truth.
    if (input && typeof input === 'object') content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
  }
  const fr = String(choice.finish_reason || '');
  const stop_reason = fr === 'length' ? 'max_tokens' : fr === 'tool_calls' ? 'tool_use' : 'end_turn';
  const u = j?.usage || {};
  const cached = Number(u?.prompt_tokens_details?.cached_tokens || 0);
  const usage: Usage = {
    input_tokens: Math.max(0, Number(u.prompt_tokens || 0) - cached),
    cache_read_input_tokens: cached,
    output_tokens: Number(u.completion_tokens || 0),
  };
  return { id: j?.id, type: 'message', role: 'assistant', model: j?.model, content, stop_reason, usage };
}

/**
 * The model call, metered and capped. Callers send and receive Anthropic's
 * Messages shape whatever the provider. Returns a `Response` so every caller
 * keeps its own status / body handling. A capped call returns a synthetic
 * 402 with `{ error: { type: 'spend_cap', message } }`.
 */
export async function anthropicMessages(feature: string, body: MessagesBody, opts: { signal?: AbortSignal; apiKey?: string; anthropicOnly?: boolean } = {}): Promise<Response> {
  // zzz883: every model call carries the untrusted-data rule in its system prompt
  if (feature !== 'health-probe') body = { ...body, system: withUntrustedRule((body as any).system) as any };
  const prov = provider();
  // anthropicOnly: a request that only the Messages API can carry (a native
  // PDF `document` block for OCR) is never translated to Chat Completions,
  // which would silently drop the document. (zzz765)
  // zzz783: OpenAI now carries the PDF as a `file` part, so an anthropicOnly
  // request goes to OpenAI too when there is no Anthropic key.
  if (prov === 'openai' && (!opts.anthropicOnly || !process.env.ANTHROPIC_API_KEY)) return openaiMessages(feature, body, opts);
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { type: 'no_key', message: 'No ANTHROPIC_API_KEY is configured' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const gate = await spendGate();
  if (!gate.allowed) {
    await record(feature, 0, null, true);
    return new Response(JSON.stringify({ error: { type: 'spend_cap', message: gate.message } }), { status: 402, headers: { 'content-type': 'application/json' } });
  }
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e: any) {
    // No answer at all (timeout, DNS, reset). Recorded as a failure so the
    // data watch can tell "nobody asked" from "everybody asked and was refused".
    await record(feature, 0, null, false, { status: 0, message: String(e?.message || e) });
    throw e;
  }
  if (resp.ok) {
    // The clone is read for accounting; the caller reads the original.
    let usage: Usage | null = null;
    try { const j: any = await resp.clone().json(); usage = j?.usage || null; } catch { usage = null; }
    await record(feature, costOf(body.model, usage), usage, false);
  } else {
    let message = '';
    try { const t = await resp.clone().text(); const je = JSON.parse(t); message = String(je?.error?.message || je?.message || t); } catch { message = `HTTP ${resp.status}`; }
    await record(feature, 0, null, false, { status: resp.status, message });
  }
  return resp;
}

/** OpenAI behind the Anthropic shape. Same gate, same ledger, same failure accounting. */
async function openaiMessages(feature: string, body: MessagesBody, opts: { signal?: AbortSignal } = {}): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { type: 'no_key', message: 'AI_PROVIDER is openai but no OPENAI_API_KEY is configured' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const gate = await spendGate();
  if (!gate.allowed) {
    await record(feature, 0, null, true);
    return new Response(JSON.stringify({ error: { type: 'spend_cap', message: gate.message } }), { status: 402, headers: { 'content-type': 'application/json' } });
  }
  const model = openaiModel();
  const req = toOpenAIRequest(body, model, process.env.OPENAI_REASONING_EFFORT || 'minimal');
  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
  } catch (e: any) {
    await record(feature, 0, null, false, { status: 0, message: String(e?.message || e) });
    throw e;
  }
  if (!resp.ok) {
    // OpenAI's error body is `{ error: { message, type, code } }` — the same
    // shape callers already parse, so it is passed through untouched.
    let message = '';
    try { const t = await resp.clone().text(); const je = JSON.parse(t); message = String(je?.error?.message || je?.message || t); } catch { message = `HTTP ${resp.status}`; }
    await record(feature, 0, null, false, { status: resp.status, message });
    return resp;
  }
  let translated: Record<string, any>;
  try { translated = fromOpenAIResponse(await resp.json()); }
  catch (e: any) {
    await record(feature, 0, null, false, { status: 502, message: `unreadable OpenAI answer: ${String(e?.message || e)}` });
    return new Response(JSON.stringify({ error: { type: 'bad_answer', message: 'OpenAI answered with something that was not JSON' } }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
  await record(feature, costOf(model, translated.usage), translated.usage, false);
  return new Response(JSON.stringify(translated), { status: 200, headers: { 'content-type': 'application/json' } });
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz963 — ONE QUESTION ANSWERED WITH A WEB SEARCH.
//
// Some facts are not in the filing: Park Aerospace cut its GE-program sales
// outlook on the CALL and in the slide deck, while the 8-K release carried no
// guidance at all. The stock fell 11% and the card had no way to know why.
// This asks the model to search (OpenAI Responses `web_search`, or Anthropic's
// `web_search` server tool), under the same monthly cap and ledger, with the
// search fee ($10 per 1,000 searches) added to the token cost.
// ═══════════════════════════════════════════════════════════════════════════
export const WEB_SEARCH_USD = 0.01;
export interface WebResearchResult { ok: boolean; text: string; urls: string[]; usd: number; error?: string }

export async function webResearch(feature: string, system: string, prompt: string, opts: { maxSearches?: number; signal?: AbortSignal } = {}): Promise<WebResearchResult> {
  const gate = await spendGate();
  if (!gate.allowed) { await record(feature, 0, null, true); return { ok: false, text: '', urls: [], usd: 0, error: gate.message || 'spend cap' }; }
  const sys = withUntrustedRule(system) as string;
  const prov = provider();
  try {
    if (prov === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return { ok: false, text: '', urls: [], usd: 0, error: 'no OPENAI_API_KEY' };
      const model = openaiModel();
      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, instructions: sys, input: prompt, tools: [{ type: 'web_search' }], reasoning: { effort: 'low' }, max_output_tokens: 4000 }),
        signal: opts.signal,
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        await record(feature, 0, null, false, { status: resp.status, message: t.slice(0, 300) });
        return { ok: false, text: '', urls: [], usd: 0, error: `HTTP ${resp.status}` };
      }
      const j: any = await resp.json();
      const out: any[] = Array.isArray(j?.output) ? j.output : [];
      const searches = out.filter((o) => o?.type === 'web_search_call').length;
      let text = ''; const urls: string[] = [];
      for (const o of out) if (o?.type === 'message') for (const c of (o.content || [])) {
        if (c?.type === 'output_text') { text += c.text || ''; for (const a of (c.annotations || [])) if (a?.url) urls.push(a.url); }
      }
      const u = j?.usage || {};
      const cached = Number(u?.input_tokens_details?.cached_tokens) || 0;
      const usage: Usage = { input_tokens: Math.max(0, (Number(u.input_tokens) || 0) - cached), output_tokens: Number(u.output_tokens) || 0, cache_read_input_tokens: cached };
      const usd = costOf(model, usage) + searches * WEB_SEARCH_USD;
      await record(feature, usd, usage, false);
      return { ok: true, text, urls: Array.from(new Set(urls)), usd };
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, text: '', urls: [], usd: 0, error: 'no ANTHROPIC_API_KEY' };
    const model = 'claude-haiku-4-5-20251001';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system: sys, messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches ?? 3 }] }),
      signal: opts.signal,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      await record(feature, 0, null, false, { status: resp.status, message: t.slice(0, 300) });
      return { ok: false, text: '', urls: [], usd: 0, error: `HTTP ${resp.status}` };
    }
    const j: any = await resp.json();
    let text = ''; const urls: string[] = [];
    for (const c of (j?.content || [])) {
      if (c?.type === 'text') { text += c.text || ''; for (const ci of (c.citations || [])) if (ci?.url) urls.push(ci.url); }
    }
    const searches = Number(j?.usage?.server_tool_use?.web_search_requests) || 0;
    const usd = costOf(model, j?.usage) + searches * WEB_SEARCH_USD;
    await record(feature, usd, j?.usage || null, false);
    return { ok: true, text, urls: Array.from(new Set(urls)), usd };
  } catch (e: any) {
    await record(feature, 0, null, false, { status: 0, message: String(e?.message || e) });
    return { ok: false, text: '', urls: [], usd: 0, error: String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz1051 — EMBEDDINGS (document search). OpenAI only (text-embedding-3-small); same monthly gate and ledger as every
// other call. The caller (lib/doc-search) keeps its own small DAILY ceiling on top. Never logs the key or the text.
// ═══════════════════════════════════════════════════════════════════════════
export interface EmbeddingsResult { ok: boolean; vectors: number[][]; tokens: number; usd: number; status: number; error?: string }
export const embeddingsConfigured = () => !!process.env.OPENAI_API_KEY;
export async function openaiEmbeddings(feature: string, inputs: string[], opts: { model?: string; dimensions?: number; signal?: AbortSignal } = {}): Promise<EmbeddingsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, vectors: [], tokens: 0, usd: 0, status: 401, error: 'no OPENAI_API_KEY' };
  if (!inputs.length) return { ok: true, vectors: [], tokens: 0, usd: 0, status: 200 };
  const gate = await spendGate();
  if (!gate.allowed) { await record(feature, 0, null, true); return { ok: false, vectors: [], tokens: 0, usd: 0, status: 402, error: gate.message }; }
  const model = opts.model || 'text-embedding-3-small';
  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: inputs, ...(opts.dimensions ? { dimensions: opts.dimensions } : {}), encoding_format: 'float' }),
      signal: opts.signal,
    });
  } catch (e: any) {
    await record(feature, 0, null, false, { status: 0, message: String(e?.message || e) });
    return { ok: false, vectors: [], tokens: 0, usd: 0, status: 0, error: String(e?.message || e).slice(0, 200) };
  }
  if (!resp.ok) {
    let message = '';
    try { const t = await resp.text(); const je = JSON.parse(t); message = String(je?.error?.message || t); } catch { message = `HTTP ${resp.status}`; }
    await record(feature, 0, null, false, { status: resp.status, message });
    return { ok: false, vectors: [], tokens: 0, usd: 0, status: resp.status, error: message.slice(0, 200) };
  }
  const j: any = await resp.json().catch(() => null);
  const data: any[] = Array.isArray(j?.data) ? j.data.slice().sort((a: any, b: any) => Number(a?.index) - Number(b?.index)) : [];
  const tokens = Number(j?.usage?.prompt_tokens ?? j?.usage?.total_tokens) || 0;
  const usage: Usage = { input_tokens: tokens, output_tokens: 0 };
  const usd = costOf(model, usage);
  await record(feature, usd, usage, false);
  const vectors = data.map((d) => (Array.isArray(d?.embedding) ? d.embedding.map(Number) : []));
  if (vectors.length !== inputs.length || vectors.some((v) => !v.length)) return { ok: false, vectors: [], tokens, usd, status: 502, error: 'embeddings answer did not match the inputs' };
  return { ok: true, vectors, tokens, usd, status: 200 };
}
