// zzz837 — where an AI-chosen type lives, beside the picker's own map.
//
// The picker's map (symbol → A/B/F/G) is the one the status engine reads, so an
// AI-chosen type is written there too — but a second map (symbol → record)
// says which of those entries the AI made. An entry with no record is the
// user's own. The user's own choice always wins: the AI never overwrites it,
// and any picker action removes the AI's record for that name.

import { AI_TYPES, type AiTypeRecord } from './ai-type';

export type TypeMap = Record<string, string>;
export type AiMap = Record<string, AiTypeRecord>;

export function isUserChosen(types: TypeMap, ai: AiMap, key: string): boolean {
  const k = key.toUpperCase();
  return !!types[k] && !(ai[k] && (AI_TYPES as readonly string[]).includes(ai[k].type));
}

/** File an AI answer. Returns the new maps; `applied` false when a user's own choice stands. */
export function applyAiRecord(types: TypeMap, ai: AiMap, key: string, rec: AiTypeRecord): { types: TypeMap; ai: AiMap; applied: boolean; why: 'ok' | 'user' } {
  const k = key.toUpperCase();
  if (isUserChosen(types, ai, k)) return { types, ai, applied: false, why: 'user' };
  const t = { ...types }, a = { ...ai };
  a[k] = rec;
  if ((AI_TYPES as readonly string[]).includes(rec.type)) t[k] = rec.type; else delete t[k];
  return { types: t, ai: a, applied: true, why: 'ok' };
}

/** The user's picker: sets or clears the type and removes any AI record for the name. */
export function applyUserType(types: TypeMap, ai: AiMap, key: string, p: string | null): { types: TypeMap; ai: AiMap } {
  const k = key.toUpperCase();
  const t = { ...types }, a = { ...ai };
  if (p) t[k] = p; else delete t[k];
  delete a[k];
  return { types: t, ai: a };
}

/** KV keys — the AI records sit beside each market's picker map. */
export const IN_AI_TYPES_KEY = 'pc-thesis-types-ai:v1';
export const US_AI_TYPES_KEY = 'us-thesis:types-ai:v1';
export const aiTypesKey = (market: 'IN' | 'US') => (market === 'US' ? US_AI_TYPES_KEY : IN_AI_TYPES_KEY);
export const typesKey = (market: 'IN' | 'US') => (market === 'US' ? 'us-thesis:types:v1' : 'pc-thesis-types:v1');
