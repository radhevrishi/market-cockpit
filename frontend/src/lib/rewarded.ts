// zzz1259 — "already rewarded": has the share price already paid for the story? Owner (11 Nov): "a lot of these themes are
// already rewarded". One pure rule used by Inflection Radar and Choke-Point Themes. Outside lib/thesis on purpose — the
// thesis engine must never read price; this only DEMOTES a research lead (moved to a folded group with its reason), never
// hides it and never scores it.
//
//   rewarded  = up 40%+ in 3 months AND not just a rebound (the year is up too), or
//               relative-strength rank 90+ together with 25%+ in 3 months (RS alone is the top tenth by construction —
//               those are the leaders the owner wants to find early, so RS only counts with a real recent run).
//   unknown   = no 3-month figure → null, shown as "price history unknown", never silently passed.
export const REWARDED_P3M = 40;
export const REWARDED_RS = 90;
export const REWARDED_RS_P3M = 25;

export interface RewardedIn { p3m?: number | null; p1y?: number | null; rs?: number | null }
export interface RewardedOut { rewarded: boolean | null; why: string[] }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function rewardedWhy(f: RewardedIn | null | undefined): RewardedOut {
  if (!f || !num(f.p3m)) return { rewarded: null, why: [] };
  const why: string[] = [];
  // a rebound is not a reward: +40% in 3 months after a falling year is recovery
  const rebound = num(f.p1y) && f.p1y <= 0;
  if (f.p3m >= REWARDED_P3M && !rebound) why.push(`up ${Math.round(f.p3m)}% in 3 months`);
  if (num(f.rs) && f.rs >= REWARDED_RS && f.p3m >= REWARDED_RS_P3M && !rebound) why.push(`relative strength ${Math.round(f.rs)} with ${Math.round(f.p3m)}% in 3 months`);
  return { rewarded: why.length > 0, why };
}
