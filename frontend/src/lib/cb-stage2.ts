// zzz1207 — the owner: "add a Stage 2 yes / no option in the preset in USA and India Conviction Beats; the logic must follow
// stage analysis". The stage is the Stage Analysis page's own weekly state machine (stock screener `twSt`, lib/stage-analysis —
// completed weeks only), laid on each card from the screener snapshot. When a company has no weekly stage yet, the 30-week
// moving-average stage (`stage`) is used and labelled. The stage stored with the results grade is a fallback of last resort
// (it was struck on the filing day and can be stale) and is labelled too. A company with no stage at all passes neither
// "Yes" nor "No" — it is counted as "stage unknown", never guessed. Pure helpers + the remembered choice.
export type Stage2Pick = 'any' | 'yes' | 'no';
export const CB_STAGE2_KEY: Record<'IN' | 'US', string> = { IN: 'mc:cb:preset-stage2:v1:IN', US: 'mc:cb:preset-stage2:v1:US' };
export const STAGE2_PICKS: ReadonlyArray<{ v: Stage2Pick; label: string; title: string }> = [
  { v: 'any', label: 'Any', title: 'Stage not used' },
  { v: 'yes', label: 'Stage 2 ✓', title: 'Only companies in a confirmed Stage 2 uptrend on the weekly chart (Stage Analysis: price above a rising 30-week average after a base breakout, completed weeks only)' },
  { v: 'no', label: 'Not Stage 2', title: 'Only companies NOT in Stage 2 (Stage 1 base, Stage 3 top or Stage 4 downtrend) — e.g. to find bases before the breakout' },
];
export function parseStage2(raw: string | null | undefined): Stage2Pick { return raw === 'yes' || raw === 'no' ? raw : 'any'; }
export function readStage2(m: 'IN' | 'US'): Stage2Pick {
  if (typeof window === 'undefined') return 'any';
  try { return parseStage2(window.localStorage.getItem(CB_STAGE2_KEY[m])); } catch { return 'any'; }
}
export function writeStage2(m: 'IN' | 'US', v: Stage2Pick): void { try { window.localStorage.setItem(CB_STAGE2_KEY[m], v); } catch { /* not kept */ } }

export interface StageView { st: 1 | 2 | 3 | 4 | null; source: 'weekly' | '30-week' | 'at results' | null; health: number | null; weeks: number | null; text: string }
const stOf = (v: unknown): 1 | 2 | 3 | 4 | null => (v === 1 || v === 2 || v === 3 || v === 4 ? v : null);
const HEALTH = ['weakening', 'losing momentum', 'healthy'];
/** The stage of one card: weekly Stage Analysis first, then the 30-week stage, then the stage stored with the grade. */
export function stageOf(e: any): StageView {
  const w = stOf(e?.wst), w30 = stOf(e?.st30), g = stOf(e?.stage);
  const st = w ?? w30 ?? g;
  const source = w != null ? 'weekly' : w30 != null ? '30-week' : g != null ? 'at results' : null;
  const health = w === 2 && typeof e?.wst_h === 'number' ? e.wst_h : null;
  const weeks = w != null && typeof e?.wst_wk === 'number' ? e.wst_wk : null;
  const text = st == null ? 'stage unknown'
    : `Stage ${st}${source === 'weekly' ? '' : ` (${source})`}${weeks != null ? ` · ${weeks} wk` : ''}${health != null ? ` · ${HEALTH[health] || ''}` : ''}`;
  return { st, source, health, weeks, text };
}
export function passesStage2(e: any, pick: Stage2Pick | null | undefined): boolean {
  if (!pick || pick === 'any') return true;
  const { st } = stageOf(e);
  if (st == null) return false;
  return pick === 'yes' ? st === 2 : st !== 2;
}
/** Index from slim stock-screener rows: ticker → weekly stage fields. */
export function stageIndex(rows: ReadonlyArray<any> | null | undefined): Record<string, { wst: number | null; wst_h: number | null; wst_wk: number | null; st30: number | null }> {
  const out: Record<string, { wst: number | null; wst_h: number | null; wst_wk: number | null; st30: number | null }> = {};
  for (const r of rows || []) {
    const t = String(r?.t || '').toUpperCase();
    if (!t) continue;
    const v = { wst: stOf(r.twSt), wst_h: typeof r.twH === 'number' ? r.twH : null, wst_wk: typeof r.twWk === 'number' ? r.twWk : null, st30: stOf(r.stage) };
    if (v.wst != null || v.st30 != null) out[t] = v;
  }
  return out;
}
