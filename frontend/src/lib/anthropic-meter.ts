// ═══════════════════════════════════════════════════════════════════════════
// THE ANTHROPIC METER.                                                (zzz747)
//
// Every model call in this codebase goes through `anthropicMessages()`. It
// does three things the raw fetch did not:
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

import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const METER_VERSION = 'v1';

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5':  { input: 1,  output: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
  'claude-sonnet-4-5': { input: 3,  output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-opus-4-1':   { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
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
  const key = Object.keys(PRICING).find((k) => m.startsWith(k));
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
  const v = Number(process.env.ANTHROPIC_MONTHLY_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

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

export async function spendGate(): Promise<GateResult> {
  const cap = monthlyCapUsd();
  let spent = 0;
  try { spent = (await readSpend()).total_usd; } catch { spent = 0; }
  if (spent >= cap) {
    return { allowed: false, spent, cap, message: `Monthly Anthropic cap reached ($${spent.toFixed(2)} of $${cap}) — raise ANTHROPIC_MONTHLY_CAP_USD in Railway to continue` };
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

/**
 * POST /v1/messages, metered and capped. Returns the raw `Response` so every
 * caller keeps its own status / body handling. A capped call returns a
 * synthetic 402 with `{ error: { type: 'spend_cap', message } }`.
 */
export async function anthropicMessages(feature: string, body: MessagesBody, opts: { signal?: AbortSignal; apiKey?: string } = {}): Promise<Response> {
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
