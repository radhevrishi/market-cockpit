// zzz975 — the stored AI forward-guidance cache key, shared by its writer (api/v1/haiku/forward-guidance) and the India EO
// guidance line (lib/in-guide-check), which only READS it. Bump a version here and both sides move together.
export const HAIKU_FG_PROMPT_VERSION = 'p1055-balanced-v1';  // PATCH 1055 — balanced bull/bear prompt + hedge penalty
export const HAIKU_FG_PARSER_VERSION = 'p1055-hedge-v1';     // PATCH 1055 — post-process hedging-language penalty
export const haikuFgKey = (ticker: string, period: string): string =>
  `haiku-fg:v3:${HAIKU_FG_PROMPT_VERSION}:${HAIKU_FG_PARSER_VERSION}:${String(ticker).toUpperCase()}:${period}`;

/** 'Q2 FY27' (EO card quarter label) → 'Q2-FY27' (the cache's period); null when it is not a quarter label. */
export function haikuPeriodOf(quarterLabel: string | null | undefined): string | null {
  const m = /^\s*Q([1-4])\s*[- ]?\s*FY\s?'?(?:20)?(\d{2})\s*$/i.exec(String(quarterLabel || ''));
  return m ? `Q${m[1]}-FY${m[2]}` : null;
}
