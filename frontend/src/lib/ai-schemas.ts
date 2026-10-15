// ═══════════════════════════════════════════════════════════════════════════
// AI ANSWER SCHEMAS — one place for the shapes the models must fill.  (zzz1050)
//
// Every model call that wants a structured answer asks for it through a FORCED
// TOOL whose input_schema is one of the schemas below (or one defined beside
// its caller and checked by the zzz1050 test). The meter (lib/anthropic-meter)
// then lets the PROVIDER enforce the shape:
//
//   • OpenAI  — the tool becomes a function with `strict: true` (Structured
//               Outputs): the answer is guaranteed to parse and to match the
//               schema. Strict mode needs every property listed in `required`
//               and `additionalProperties: false` on every object (optional
//               fields are written as nullable), and it accepts only a subset
//               of JSON-Schema keywords — `toStrictSchema` drops the others
//               (maxLength etc.); the caller's own validator still checks them.
//   • Anthropic — a single forced tool (`tool_choice: {type:'tool', name}`).
//
// A schema guarantees the SHAPE of an answer, never its truth: every caller
// keeps its own post-parse validation, and the guidance extractor keeps its
// quote-must-be-in-the-document check (the hallucination guard).
//
// Pure module (no I/O): tests import it freely.
// ═══════════════════════════════════════════════════════════════════════════

export type JsonSchema = Record<string, any>;
export interface ToolDef { name: string; description: string; input_schema: JsonSchema }

// ── strict-mode checks ──────────────────────────────────────────────────────

/** Keywords OpenAI strict mode accepts. Anything else is dropped by toStrictSchema (and must be re-checked by the caller). */
const STRICT_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'anyOf', '$defs', '$ref',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'pattern',
]);

const typesOf = (s: JsonSchema): string[] => (Array.isArray(s?.type) ? s.type : s?.type ? [s.type] : []);

/**
 * Why a schema is NOT strict-valid ([] = valid): every object node must set additionalProperties: false and list EVERY property in
 * `required`; recursed through properties, items, anyOf and $defs. The root must be an object.
 */
export function strictProblems(schema: JsonSchema, path = '$', root = true): string[] {
  const out: string[] = [];
  if (!schema || typeof schema !== 'object') return [`${path}: not a schema`];
  if (root && !typesOf(schema).includes('object')) out.push(`${path}: root must be an object`);
  if (typesOf(schema).includes('object')) {
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    if (schema.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const req: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const k of Object.keys(props)) if (!req.includes(k)) out.push(`${path}.${k}: must be in required (make it nullable instead of optional)`);
    for (const k of req) if (!(k in props)) out.push(`${path}: required lists unknown property ${k}`);
    for (const [k, v] of Object.entries(props)) out.push(...strictProblems(v as JsonSchema, `${path}.${k}`, false));
  }
  if (schema.items) out.push(...strictProblems(schema.items, `${path}[]`, false));
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((s: JsonSchema, i: number) => out.push(...strictProblems(s, `${path}|${i}`, false)));
  if (schema.$defs && typeof schema.$defs === 'object') for (const [k, v] of Object.entries(schema.$defs)) out.push(...strictProblems(v as JsonSchema, `${path}#${k}`, false));
  return out;
}

export const isStrictSchema = (schema: JsonSchema): boolean => strictProblems(schema).length === 0;

/** A copy with only the keywords strict mode accepts. Property NAMES are kept whatever they are (they are not keywords). */
export function stripToStrictKeywords(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!STRICT_KEYWORDS.has(k)) continue;
    if (k === 'properties' || k === '$defs') out[k] = Object.fromEntries(Object.entries(v as JsonSchema).map(([pk, pv]) => [pk, stripToStrictKeywords(pv as JsonSchema)]));
    else if (k === 'items') out[k] = stripToStrictKeywords(v as JsonSchema);
    else if (k === 'anyOf') out[k] = (v as JsonSchema[]).map(stripToStrictKeywords);
    else out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

/**
 * A copy where every object node that does not say otherwise gets additionalProperties: false. Safe: no caller reads keys its schema
 * does not name. It does NOT make optional properties required — a schema with an optional property stays non-strict (and is sent as before).
 */
export function sealObjects(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out: JsonSchema = { ...schema };
  if (typesOf(out).includes('object') && out.additionalProperties === undefined) out.additionalProperties = false;
  if (out.properties && typeof out.properties === 'object') out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, sealObjects(v as JsonSchema)]));
  if (out.items) out.items = sealObjects(out.items);
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(sealObjects);
  if (out.$defs && typeof out.$defs === 'object') out.$defs = Object.fromEntries(Object.entries(out.$defs).map(([k, v]) => [k, sealObjects(v as JsonSchema)]));
  return out;
}

/** The schema to send in strict mode (sealed, strict keywords only), or null when it is not strict-valid (then it is sent as before, without strict). */
export function toStrictSchema(schema: JsonSchema): JsonSchema | null {
  const sealed = sealObjects(schema);
  if (!isStrictSchema(sealed)) return null;
  return stripToStrictKeywords(sealed);
}

/** FNV-1a fingerprint of anything JSON-serialisable (prompt + schema + output mode). */
export function fingerprint(prefix: string, parts: unknown[]): string {
  const src = JSON.stringify(parts);
  let h = 0x811c9dc5; for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${prefix}-${h.toString(16)}`;
}

/** The output mode every structured call now uses; part of the guidance prompt fingerprint so a mode change re-reads old results. */
export const STRUCTURED_OUTPUT_MODE = 'forced-tool+openai-strict-v1';

const nullable = (t: 'string' | 'number' | 'integer' | 'boolean', extra: JsonSchema = {}): JsonSchema => ({ type: [t, 'null'], ...extra });
const strArray = (maxItems: number): JsonSchema => ({ type: 'array', maxItems, items: { type: 'string' } });

// ── 1. guidance extraction (lib/ai-guidance-extract.ts) ─────────────────────

export const GUIDANCE_METRICS = ['REVENUE', 'REVENUE_GROWTH', 'EBITDA', 'EBITDA_MARGIN', 'PAT', 'EPS', 'ADJ_EPS', 'FCF', 'ORDER_INFLOW', 'VOLUME', 'OTHER'] as const;
export const GUIDANCE_STATUSES = ['NEW', 'RAISED', 'REITERATED', 'LOWERED', 'NARROWED', 'WITHDRAWN', 'UNCLEAR'] as const;
export const GUIDANCE_BASES = ['GAAP', 'ADJUSTED', 'REPORTED', 'UNSTATED'] as const;
export const GUIDANCE_PERIOD_KINDS = ['ANNUAL', 'QUARTER', 'MULTI_YEAR'] as const;
export const GUIDANCE_QUOTE_MAX = 300;
export const GUIDANCE_MAX_ROWS = 40;

export const GUIDANCE_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metric', 'metric_label', 'period', 'period_kind', 'basis', 'currency', 'unit', 'low', 'high', 'growth_pct_low', 'growth_pct_high', 'status', 'prior_low', 'prior_high', 'prior_stated_in', 'prior_actual_period', 'prior_actual_value', 'prior_actual_quote', 'quote', 'speaker', 'confidence'],
  properties: {
    metric: { type: 'string', enum: GUIDANCE_METRICS as unknown as string[] },
    metric_label: { type: 'string', maxLength: 80 },
    period: { type: 'string', maxLength: 24 },
    period_kind: { type: 'string', enum: GUIDANCE_PERIOD_KINDS as unknown as string[] },
    basis: { type: 'string', enum: GUIDANCE_BASES as unknown as string[] },
    currency: { type: ['string', 'null'], maxLength: 8 },
    unit: { type: ['string', 'null'], maxLength: 16 },
    low: { type: ['number', 'null'] },
    high: { type: ['number', 'null'] },
    growth_pct_low: { type: ['number', 'null'] },
    growth_pct_high: { type: ['number', 'null'] },
    status: { type: 'string', enum: GUIDANCE_STATUSES as unknown as string[] },
    prior_low: { type: ['number', 'null'] },
    prior_high: { type: ['number', 'null'] },
    prior_stated_in: { type: ['string', 'null'], maxLength: 60 },
    prior_actual_period: { type: ['string', 'null'], maxLength: 24 },
    prior_actual_value: { type: ['number', 'null'] },
    prior_actual_quote: { type: ['string', 'null'], maxLength: GUIDANCE_QUOTE_MAX },
    quote: { type: 'string', maxLength: GUIDANCE_QUOTE_MAX },
    speaker: { type: ['string', 'null'], maxLength: 80 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const GUIDANCE_TOOL: ToolDef = {
  name: 'file_guidance',
  description: 'File the forward-looking guidance rows the company states in the document.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['unreadable', 'rows'],
    properties: { unreadable: { type: 'boolean' }, rows: { type: 'array', maxItems: GUIDANCE_MAX_ROWS, items: GUIDANCE_ROW_SCHEMA } },
  },
};

// ── 2. AI desk assessment (lib/ai-analyst.ts) ───────────────────────────────

export const ANALYST_TOOL: ToolDef = {
  name: 'file_assessment',
  description: 'File the structured assessment of this company\'s latest quarter.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['change_level', 'change_type', 'structural_score', 'structural_drivers', 'temporary_factors', 'why_now_score', 'why_now', 'bear_case', 'bear_severity', 'key_risks', 'invalidation', 'thesis', 'confidence', 'not_established'],
    properties: {
      change_level: { type: 'integer', minimum: 0, maximum: 5 },
      change_type: { type: 'string', enum: ['NOISE', 'CYCLICAL', 'STRUCTURAL'] },
      structural_score: { type: 'number', minimum: 0, maximum: 100 },
      structural_drivers: strArray(6),
      temporary_factors: strArray(6),
      why_now_score: { type: 'number', minimum: 0, maximum: 100 },
      why_now: strArray(5),
      bear_case: { type: 'string' },
      bear_severity: { type: 'number', minimum: 0, maximum: 100 },
      key_risks: strArray(5),
      invalidation: strArray(4),
      thesis: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      not_established: strArray(5),
    },
  },
};

// ── 3. headline classifier (lib/anthropic-classifier.ts) ────────────────────

export const CATALYST_TYPES = ['M&A', 'EARNINGS', 'GUIDANCE', 'ORDER_WIN', 'CAPEX', 'LITIGATION', 'MANAGEMENT', 'DIVIDEND', 'BUYBACK', 'RATING', 'STRUCTURAL', 'BLOCK_DEAL', 'OTHER'] as const;
export const CLASSIFIER_TOOL: ToolDef = {
  name: 'classify_headline',
  description: 'Classify the catalyst in one headline.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['catalyst_type', 'confidence', 'one_line', 'entities'],
    properties: {
      catalyst_type: { type: 'string', enum: CATALYST_TYPES as unknown as string[] },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
      one_line: { type: 'string', maxLength: 160 },
      entities: {
        type: 'object',
        additionalProperties: false,
        required: ['acquirer', 'target', 'stake_pct', 'value_cr'],
        properties: { acquirer: nullable('string'), target: nullable('string'), stake_pct: nullable('number'), value_cr: nullable('number') },
      },
    },
  },
};

/** The classifier's entities with the nulls left out (the old text answer OMITTED a field that did not apply). undefined when empty. */
export function classifierEntities(e: unknown): Record<string, string | number> | undefined {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
    if (!['acquirer', 'target', 'stake_pct', 'value_cr'].includes(k)) continue;
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── 4. forward-guidance tone (app/api/v1/haiku/forward-guidance) ────────────

export const FORWARD_GUIDANCE_TOOL: ToolDef = {
  name: 'file_forward_guidance',
  description: 'File the forward-guidance reading of the document.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'score', 'confidence', 'rationale', 'quotes', 'numbers', 'catalysts'],
    properties: {
      label: { type: 'string', enum: ['Positive', 'Neutral', 'Negative', 'NoGuidance'] },
      score: { type: 'number', minimum: -1, maximum: 1 },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
      rationale: { type: 'string', maxLength: 400 },
      quotes: strArray(6),
      numbers: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['metric', 'value', 'period'], properties: { metric: { type: 'string' }, value: { type: 'string' }, period: { type: 'string' } } } },
      catalysts: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['event', 'timing'], properties: { event: { type: 'string' }, timing: { type: 'string' } } } },
    },
  },
};

// ── 5. US guidance direction with a web search (lib/us-guide-check.ts) ─────
// Answered through the OpenAI Responses API (text.format json_schema, strict) — a forced tool would stop the search.

export const US_GUIDE_CHECK_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['direction', 'scope', 'what', 'quote', 'source_url'],
  properties: {
    direction: { type: 'string', enum: ['raised', 'lowered', 'mixed', 'cautious', 'maintained', 'none'] },
    scope: { type: 'string', enum: ['company', 'segment'] },
    what: { type: 'string' },
    quote: { type: 'string' },
    source_url: { type: 'string' },
  },
};

/** Every schema defined here, by call site (the zzz1050 test checks each is strict-valid). */
export const AI_SCHEMAS: Record<string, JsonSchema> = {
  'guidance-extract': GUIDANCE_TOOL.input_schema,
  'ai-desk': ANALYST_TOOL.input_schema,
  'headline-classifier': CLASSIFIER_TOOL.input_schema,
  'forward-guidance': FORWARD_GUIDANCE_TOOL.input_schema,
  'us-guide-check': US_GUIDE_CHECK_SCHEMA,
};
