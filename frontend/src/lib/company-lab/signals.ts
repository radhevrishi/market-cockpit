// ═══════════════════════════════════════════════════════════════════════════
// COMPANY LAB — red-flag and positive COMBINATIONS, reinvestment, EV/FCF, market-implied growth (zzz1297). Pure.
//
// A single weak figure is noise; some combinations are not. Four red flags (reject unless the reason is proven away)
// and two positives (advance to business and valuation work), from the owner's checklist:
//   R1 cash stress      negative FCF + weak CFO/PAT (< 0.8×) + High cash squeeze
//   R2 paper earnings   strong EPS growth (25%+ or loss → profit) + heavy dilution (10%+ in 3 yrs) + weak CFO/PAT
//   R3 bought growth    accelerating sales + falling gross margin (−1.5 pts or worse; operating margin when gross is not reported)
//   R4 fragile momentum high Rule of 40 (40+) or RS (80+) + poor balance sheet (debt ÷ equity > 1 or High squeeze)
//   P1 cash integrity   positive FCF + CFO/PAT ≥ 1.0× + debt ÷ equity ≤ 0.5 + dilution ≤ 5% in 3 yrs
//   P2 operating inflection  gross AND operating margin expanding + accelerating sales + EPS growing
// A missing figure never fires a flag (no guessing) and never earns a positive.
//
// Reinvestment: extra profit ÷ extra capital (equity + debt) over up to three years — a PROFIT-based stand-in for
// incremental ROCE (EBIT is not in our yearly data). Market-implied growth: the yearly FCF growth for 10 years (then
// 3% / 5% for ever, discounted at 10% USA / 12% India) that today's enterprise value pays for.
// ═══════════════════════════════════════════════════════════════════════════

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

export interface SignalInput {
  fcf: number | null; cfoPat: number | null; squeeze: string | null;
  epsG: number | null; epsSwing?: string | null; dilution: number | null;
  accel: string | null; gmChg: number | null; omChg: number | null;
  r40: number | null; rs: number | null; de: number | null;
}
export interface Signal { id: string; kind: 'red' | 'good'; label: string; why: string; response: string }

export function labSignals(x: SignalInput): Signal[] {
  const out: Signal[] = [];
  const weakCash = fin(x.cfoPat) && x.cfoPat < 0.8;
  if (fin(x.fcf) && x.fcf < 0 && weakCash && x.squeeze === 'High')
    out.push({ id: 'R1', kind: 'red', label: 'Cash stress', why: `negative free cash flow, CFO/PAT ${x.cfoPat}×, cash squeeze High`, response: 'Funding, receivable or inventory stress. Reject unless a clear cash-conversion path is proven.' });
  const strongEps = (fin(x.epsG) && x.epsG >= 25) || x.epsSwing === 'loss-to-profit';
  if (strongEps && fin(x.dilution) && x.dilution >= 10 && weakCash)
    out.push({ id: 'R2', kind: 'red', label: 'Paper earnings', why: `EPS ${x.epsSwing === 'loss-to-profit' ? 'turned to profit' : `+${Math.round(x.epsG!)}%`}, shares +${x.dilution}% in 3 yrs, CFO/PAT ${x.cfoPat}×`, response: 'Work out cash per share before trusting the headline earnings.' });
  const marginDrop = fin(x.gmChg) ? (x.gmChg <= -1.5 ? `gross margin ${r1(x.gmChg)} pts` : null) : fin(x.omChg) && x.omChg <= -2 ? `operating margin ${r1(x.omChg)} pts (gross margin not reported)` : null;
  if (x.accel === 'accelerating' && marginDrop)
    out.push({ id: 'R3', kind: 'red', label: 'Bought growth', why: `sales speeding up while ${marginDrop} vs a year ago`, response: 'Check price / mix, input costs, or low-margin volume chasing.' });
  const hot = (fin(x.r40) && x.r40 >= 40) || (fin(x.rs) && x.rs >= 80);
  const weakBs = (fin(x.de) && x.de > 1) || x.squeeze === 'High';
  if (hot && weakBs)
    out.push({ id: 'R4', kind: 'red', label: 'Fragile momentum', why: `${fin(x.r40) && x.r40 >= 40 ? `Rule of 40 ${Math.round(x.r40)}` : `RS ${x.rs}`} with ${fin(x.de) && x.de > 1 ? `debt ÷ equity ${x.de}×` : 'a High cash squeeze'}`, response: 'Growth and price strength are not safety; liquidity risk can dominate.' });
  if (fin(x.fcf) && x.fcf > 0 && fin(x.cfoPat) && x.cfoPat >= 1 && fin(x.de) && x.de <= 0.5 && fin(x.dilution) && x.dilution <= 5)
    out.push({ id: 'P1', kind: 'good', label: 'Cash integrity', why: `FCF positive, CFO/PAT ${x.cfoPat}×, debt ÷ equity ${x.de}×, shares ${x.dilution > 0 ? '+' : ''}${x.dilution}% in 3 yrs`, response: 'High financial integrity — move on to business durability and valuation.' });
  const epsUp = (fin(x.epsG) && x.epsG > 0) || x.epsSwing === 'loss-to-profit';
  if (fin(x.gmChg) && x.gmChg > 0 && fin(x.omChg) && x.omChg > 0 && x.accel === 'accelerating' && epsUp)
    out.push({ id: 'P2', kind: 'good', label: 'Operating inflection', why: `gross +${r1(x.gmChg)} pts, operating +${r1(x.omChg)} pts, sales speeding up, EPS growing`, response: 'A coherent operating turn — check it is organic and repeatable, and not a low base.' });
  return out;
}

/** Extra profit ÷ extra capital (equity + debt) over up to three years, %. */
export function reinvestment(rows: Array<{ label: string; netIncome: number | null; equity?: number | null; debt: number | null }>): { pct: number | null; text: string } {
  const ok = rows.filter((r) => fin(r.netIncome) && fin(r.equity));
  if (ok.length < 2) return { pct: null, text: 'needs two years of profit and equity' };
  const L = ok[ok.length - 1], F = ok[Math.max(0, ok.length - 4)];
  const cap = (r: typeof L) => (r.equity as number) + (fin(r.debt) ? r.debt : 0);
  const dCap = cap(L) - cap(F), dNi = (L.netIncome as number) - (F.netIncome as number);
  if (!(dCap > 0)) return { pct: null, text: `capital did not grow ${F.label} → ${L.label} (buybacks / losses) — not meaningful` };
  const pct = Math.round((dNi / dCap) * 100);
  return { pct, text: `profit ${dNi >= 0 ? '+' : ''}${r1(dNi)} on ${r1(dCap)} of new capital ${F.label} → ${L.label} = ${pct}% (profit-based stand-in for incremental ROCE)` };
}

/** Enterprise value (market cap + debt − cash) ÷ latest full-year FCF. */
export function evFcf(cap: number | null, debt: number | null, cash: number | null, fcf: number | null): { ev: number | null; multiple: number | null } {
  if (!fin(cap)) return { ev: null, multiple: null };
  const ev = cap + (fin(debt) ? debt : 0) - (fin(cash) ? cash : 0);
  return { ev, multiple: fin(fcf) && fcf > 0 && ev > 0 ? r1(ev / fcf) : null };
}

/** The yearly FCF growth for 10 years that the enterprise value pays for (reverse DCF). */
export function impliedGrowth(ev: number | null, fcf: number | null, market: 'US' | 'IN'): { g: number | null; text: string } {
  if (!fin(ev) || !fin(fcf) || fcf <= 0 || ev <= 0) return { g: null, text: 'needs positive free cash flow' };
  const r = market === 'IN' ? 0.12 : 0.10, tg = market === 'IN' ? 0.05 : 0.03;
  const pv = (g: number) => {
    let v = 0, f = fcf;
    for (let i = 1; i <= 10; i++) { f *= 1 + g; v += f / Math.pow(1 + r, i); }
    return v + (f * (1 + tg)) / (r - tg) / Math.pow(1 + r, 10);
  };
  let lo = -0.5, hi = 1.5;
  if (pv(hi) < ev) return { g: 150, text: `more than 150% a year — the price pays for far more than today's cash flow` };
  if (pv(lo) > ev) return { g: -50, text: 'the price pays for shrinking cash flow' };
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (pv(m) > ev) hi = m; else lo = m; }
  const g = Math.round(lo * 1000) / 10;
  return { g, text: `${g}% a year for 10 years (then ${tg * 100}% for ever, ${r * 100}% discount rate)` };
}
