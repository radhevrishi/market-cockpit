'use client';

// ═══════════════════════════════════════════════════════════════════════════
// ASSET-RICH FILTER — PATCH 1074
//
// "Stocks where the market cap is less than cash, OR less than the land they
// own." Investors call these net-net (Graham), cash-bargain, or asset-bargain
// plays. They sometimes 5–10× when the market re-rates them, and sometimes
// stay value-traps for a decade. This module separates the two.
//
// METHOD — 50-year Indian markets pattern review
//
// HISTORICAL WINNERS (Indian asset-rich plays that compounded 5×+):
//   Bajaj Holdings (post-demerger) — sat on cash + listed investments worth
//     2× market cap; rerated from ~₹600 → ₹6,000+ over 7 years.
//   Maharashtra Scooters — Bajaj associate; market cap < holdings value for
//     years, eventually rerated as Bajaj group dividends compounded.
//   Tata Investment Corp — perma-discount to NAV; slow grind, ~12% CAGR
//     for two decades with low drawdowns.
//   NMDC — iron ore reserves vastly exceed market cap; multibagger across
//     every commodity cycle (2003-08, 2017-21).
//   Coal India — same pattern; coal-reserve-value > market cap repeatedly
//     gave the floor.
//   Cement companies w/ limestone reserves — Heidelberg, ACC at various
//     times — reserve value > market cap triggered eventual deal premiums.
//   ITDC (post-strategic-divestment) — hotel land monetised; multibagger
//     after political block lifted.
//
// HISTORICAL LOSERS (asset-rich on paper, but stock destroyed wealth):
//   Bombay Dyeing — Worli land worth ₹50,000+ Cr at peak; operating losses
//     and family disputes meant no monetisation; stock did 80% drawdowns.
//   Hotels Leelaventure — premium land + brand; debt > land value crushed it.
//   HDIL — owned slum-redevelopment land bank ~3× market cap; bankrupt.
//   DB Realty — same era; land but no monetisation, promoter overhang.
//   McLeod Russel — tea estate land was vast; debt + tea-cycle losses ate it.
//   Public-sector banks pre-recap — book value > market cap, but NPAs kept
//     destroying capital, recap dilution killed compounding.
//   Jet Airways pre-collapse — slots + brand, but operating losses ate cash.
//   Tata Steel (pre-Bhushan-deal) — assets > MCap, but interest cost > EBIT.
//
// WINNER GENE — features common to the multibaggers above
//   1. Operating business profitable (OCF > 0, PBT > 0)
//   2. Low leverage (D/E < 0.5, interest cover > 3×)
//   3. Visible monetisation path: announced buyback / dividend yield > 3% /
//      strategic-stake-sale process / govt divestment scheduled.
//   4. Promoter holding stable or rising, NO pledged shares.
//   5. Sector with structural tailwind (commodity super-cycle / hospitality
//      revival / capex cycle), not in secular decline.
//   6. Management with track-record of unlocking value (Bajaj, Tata trusts).
//   7. Asset quality: cash in liquid mutual funds / listed investments /
//      land in commercial-development-permitted zone (not far rural).
//   8. Current ratio > 1.5 — short-term obligations covered.
//   9. ROCE on operating capital > 12% — operating business compounds the
//      cash, not consumes it.
//  10. Free float ≥ 25% — re-rating needs liquidity.
//
// LOSER GENE — features common to the value traps above
//   1. Operating losses (OCF < 0 for ≥ 2 consecutive years)
//   2. Cash diluted via QIP / rights / pref every 2-3 years
//   3. Promoter pledge > 30% or aggressive selling on every uptick
//   4. Diversification into unrelated businesses with the cash (textile → IT,
//      hotel → solar). The cash is being burnt.
//   5. Sector in structural decline (textile mills, old PSU power, jute)
//   6. Auditor concerns / going-concern flag in last 2 audits
//   7. Land disputes / legal cases pending in Supreme Court or High Court
//   8. Family-controlled w/ no professional management; refused to monetise
//      for > 10 years already.
//   9. Working capital negative or current ratio < 1.
//  10. Free float < 10% — manipulation risk, no re-rating until it grows.
//
// OUTPUT — given a stock, scoreAssetRich() returns:
//   { trigger: 'CASH>MCAP' | 'LAND>MCAP' | 'BOTH' | 'NONE',
//     winnerGenes: string[], loserGenes: string[],
//     score: number 0-100, verdict: 'WINNING' | 'WATCH' | 'LOSING' }
//
// The filter component then surfaces ONLY 'WINNING' by default, with a
// toggle to see 'WATCH' (mixed signals) and an explicit 'show losers'
// debug toggle to study what to avoid.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';

export interface AssetRichStock {
  ticker: string;
  company?: string;
  /** Market cap in Cr. */
  marketCapCr?: number;
  /** Net cash on books in Cr (cash + investments − total debt). */
  netCashCr?: number;
  /** Optional land / property + investments fair-value estimate in Cr. */
  landAndInvestmentsCr?: number;
  /** Operating cash flow for the trailing twelve months in Cr. */
  ocfCr?: number;
  /** Debt / equity ratio. */
  de?: number;
  /** Promoter pledged %. */
  pledgePct?: number;
  /** Promoter holding %. */
  promoterHoldingPct?: number;
  /** Free-float %. */
  publicFloatPct?: number;
  /** Current ratio. */
  currentRatio?: number;
  /** Trailing ROCE %. */
  rocePct?: number;
  /** Years of consecutive OCF < 0 (set 0 if all OCF positive). */
  consecOcfNegativeYears?: number;
  /** Dividend yield % (used to confirm cash is being returned). */
  divYieldPct?: number;
  /** True when sector classified as "structural-decline" (textile mills, old
   *  PSU power, jute, etc.). Callers can supply this from their sector lookup. */
  structuralDecline?: boolean;
}

export interface AssetRichVerdict {
  trigger: 'CASH>MCAP' | 'LAND>MCAP' | 'BOTH' | 'NONE';
  winnerGenes: string[];
  loserGenes: string[];
  /** Composite 0-100 (higher = stronger winner profile). */
  score: number;
  verdict: 'WINNING' | 'WATCH' | 'LOSING';
  /** Human-readable summary you can render anywhere. */
  summary: string;
}

function numOr(x: unknown, fallback: number): number {
  return typeof x === 'number' && isFinite(x) ? x : fallback;
}

export function scoreAssetRich(s: AssetRichStock): AssetRichVerdict {
  const mc = numOr(s.marketCapCr, 0);
  const netCash = numOr(s.netCashCr, 0);
  const land = numOr(s.landAndInvestmentsCr, 0);
  const cashBeatsMcap = mc > 0 && netCash > mc;
  const landBeatsMcap = mc > 0 && land > mc;

  let trigger: AssetRichVerdict['trigger'] = 'NONE';
  if (cashBeatsMcap && landBeatsMcap) trigger = 'BOTH';
  else if (cashBeatsMcap) trigger = 'CASH>MCAP';
  else if (landBeatsMcap) trigger = 'LAND>MCAP';

  const winnerGenes: string[] = [];
  const loserGenes: string[] = [];

  // ── WINNER tests ──────────────────────────────────────────────────
  if (numOr(s.ocfCr, 0) > 0) winnerGenes.push('Operating cash flow positive');
  if (s.de != null && s.de < 0.5) winnerGenes.push('Low leverage (D/E < 0.5)');
  if (numOr(s.pledgePct, 0) === 0) winnerGenes.push('Zero promoter pledge');
  if (numOr(s.promoterHoldingPct, 0) >= 50) winnerGenes.push('Promoter holding ≥ 50%');
  if (numOr(s.divYieldPct, 0) >= 3) winnerGenes.push('Dividend yield ≥ 3% (cash being returned)');
  if (s.currentRatio != null && s.currentRatio > 1.5) winnerGenes.push('Current ratio > 1.5');
  if (numOr(s.rocePct, 0) >= 12) winnerGenes.push('Operating ROCE ≥ 12%');
  if (numOr(s.publicFloatPct, 0) >= 25) winnerGenes.push('Free float ≥ 25% (re-rating possible)');

  // ── LOSER tests ───────────────────────────────────────────────────
  if (numOr(s.consecOcfNegativeYears, 0) >= 2) loserGenes.push('OCF negative ≥ 2 years (cash being burnt)');
  if (numOr(s.pledgePct, 0) > 30) loserGenes.push('Promoter pledge > 30% (forced-sale risk)');
  if (numOr(s.de, 0) > 1.5) loserGenes.push('Highly leveraged (D/E > 1.5)');
  if (s.currentRatio != null && s.currentRatio < 1) loserGenes.push('Current ratio < 1 (short-term squeeze)');
  if (numOr(s.publicFloatPct, 100) < 10) loserGenes.push('Free float < 10% (manipulation risk)');
  if (s.structuralDecline === true) loserGenes.push('Sector in structural decline');
  if (numOr(s.rocePct, 0) < 5 && numOr(s.consecOcfNegativeYears, 0) >= 1) {
    loserGenes.push('Operating ROCE < 5% and bleeding cash');
  }

  // ── Composite score ──────────────────────────────────────────────
  // Start at trigger weight; add 8 per winner gene; subtract 12 per loser gene.
  const triggerBoost = trigger === 'BOTH' ? 30 : trigger === 'CASH>MCAP' ? 25 : trigger === 'LAND>MCAP' ? 20 : 0;
  const winnerScore = winnerGenes.length * 8;
  const loserPenalty = loserGenes.length * 12;
  const raw = triggerBoost + winnerScore - loserPenalty;
  const score = Math.max(0, Math.min(100, raw));

  // ── Verdict ──────────────────────────────────────────────────────
  let verdict: AssetRichVerdict['verdict'] = 'WATCH';
  if (loserGenes.length >= 2) verdict = 'LOSING';
  else if (trigger !== 'NONE' && winnerGenes.length >= 5 && loserGenes.length === 0) verdict = 'WINNING';
  else if (trigger !== 'NONE' && winnerGenes.length >= 3 && loserGenes.length <= 1) verdict = 'WINNING';

  const summary =
    trigger === 'NONE'
      ? 'Market cap exceeds both cash and land — not an asset-rich play.'
      : verdict === 'WINNING'
        ? `${trigger} with ${winnerGenes.length} winner gene${winnerGenes.length === 1 ? '' : 's'} and minimal loser signals — the asset cushion is real and the operating business compounds it.`
        : verdict === 'LOSING'
          ? `${trigger} on paper, but ${loserGenes.length} loser gene${loserGenes.length === 1 ? '' : 's'} present — historically these traps stay traps. Avoid.`
          : `${trigger} with mixed signals (${winnerGenes.length} winner, ${loserGenes.length} loser). Watch for catalyst before sizing.`;

  return { trigger, winnerGenes, loserGenes, score, verdict, summary };
}

// ═════════════════════════════════════════════════════════════════════════
// FILTER COMPONENT — wraps a stock list and filters by verdict
// ═════════════════════════════════════════════════════════════════════════

export interface AssetRichFilterProps {
  /** Universe of stocks to filter. */
  universe: AssetRichStock[];
  /** Render each filtered row. */
  renderRow: (s: AssetRichStock & { verdict: AssetRichVerdict }) => React.ReactNode;
}

export function AssetRichFilter({ universe, renderRow }: AssetRichFilterProps) {
  const [mode, setMode] = useState<'WINNING' | 'WATCH' | 'LOSING'>('WINNING');
  const [triggerFilter, setTriggerFilter] = useState<'ANY' | 'CASH>MCAP' | 'LAND>MCAP' | 'BOTH'>('ANY');

  const scored = useMemo(() => {
    return universe
      .map((s) => ({ ...s, verdict: scoreAssetRich(s) }))
      .filter((s) => s.verdict.trigger !== 'NONE')
      .filter((s) => triggerFilter === 'ANY' || s.verdict.trigger === triggerFilter)
      .filter((s) => s.verdict.verdict === mode)
      .sort((a, b) => b.verdict.score - a.verdict.score);
  }, [universe, mode, triggerFilter]);

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-0)',
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
      }}
    >
      <header style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
          🪙 Asset-rich filter (cash &gt; m-cap, land &gt; m-cap)
        </h3>
        <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '4px 0 0 0' }}>
          Re-rates historically only when the operating business is profitable. See PATCH 1074
          header for the 50-year Indian winners/losers list this checklist is built from.
        </p>
      </header>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['WINNING', 'WATCH', 'LOSING'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setMode(v)}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 800,
              borderRadius: 'var(--mc-radius-sm)',
              border: '1px solid',
              cursor: 'pointer',
              ...(v === mode
                ? {
                    background:
                      v === 'WINNING'
                        ? 'var(--mc-bullish)'
                        : v === 'LOSING'
                          ? 'var(--mc-bearish)'
                          : 'var(--mc-warn)',
                    color: 'white',
                    borderColor: 'transparent',
                  }
                : {
                    background: 'transparent',
                    color: 'var(--mc-text-3)',
                    borderColor: 'var(--mc-border-0)',
                  }),
            }}
          >
            {v === 'WINNING' ? '🏆 Winners' : v === 'WATCH' ? '👁 Watch' : '⚠️ Losers (study)'}
          </button>
        ))}
        <select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as any)}
          style={{
            padding: '4px 8px',
            fontSize: 11,
            background: 'var(--mc-bg-3)',
            color: 'var(--mc-text-1)',
            border: '1px solid var(--mc-border-0)',
            borderRadius: 'var(--mc-radius-sm)',
          }}
        >
          <option value="ANY">Any trigger</option>
          <option value="CASH&gt;MCAP">CASH &gt; MCap only</option>
          <option value="LAND&gt;MCAP">LAND &gt; MCap only</option>
          <option value="BOTH">BOTH triggers</option>
        </select>
        <span style={{ color: 'var(--mc-text-4)', fontSize: 11, marginLeft: 'auto', alignSelf: 'center' }}>
          {scored.length} match{scored.length === 1 ? '' : 'es'}
        </span>
      </div>
      <div>{scored.length === 0
        ? <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)', padding: '6px 0' }}>None in this bucket — try a different verdict or trigger.</div>
        : scored.map((s) => renderRow(s))}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// DETAIL CARD — show the gene matches inside a company's detail page
// ═════════════════════════════════════════════════════════════════════════

export interface AssetRichDetailCardProps {
  stock: AssetRichStock;
  /** Optional title override. */
  title?: string;
}

export function AssetRichDetailCard({ stock, title }: AssetRichDetailCardProps) {
  const v = useMemo(() => scoreAssetRich(stock), [stock]);
  const tone =
    v.verdict === 'WINNING' ? 'var(--mc-bullish)' :
    v.verdict === 'LOSING' ? 'var(--mc-bearish)' :
    'var(--mc-warn)';

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: `1px solid ${tone}`,
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
      }}
    >
      <header
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}
      >
        <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
          {title || '🪙 Asset-rich scorecard'}
        </h3>
        <span
          style={{
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 800,
            borderRadius: 'var(--mc-radius-sm)',
            background: tone,
            color: 'white',
            letterSpacing: 0.4,
          }}
        >
          {v.verdict}
        </span>
        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
          trigger: <strong style={{ color: 'var(--mc-text-1)' }}>{v.trigger}</strong>
          {' · '}score: <strong style={{ color: 'var(--mc-text-1)' }}>{v.score}/100</strong>
        </span>
      </header>
      <p style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)', margin: '0 0 10px 0' }}>
        {v.summary}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <GeneList title="🏆 Winner genes present" color="var(--mc-bullish)" items={v.winnerGenes} />
        <GeneList title="⚠️ Loser genes present" color="var(--mc-bearish)" items={v.loserGenes} />
      </div>
    </div>
  );
}

function GeneList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div
      style={{
        border: `1px solid ${color}40`,
        background: `${color}10`,
        borderRadius: 'var(--mc-radius-sm)',
        padding: 8,
      }}
    >
      <div style={{ color, fontWeight: 800, fontSize: 'var(--mc-text-sm)', marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-xs)' }}>None matched.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((it, i) => (
            <li
              key={i}
              style={{
                color: 'var(--mc-text-1)',
                fontSize: 'var(--mc-text-xs)',
                padding: '2px 0',
              }}
            >
              • {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// END asset-rich-filter.tsx
// ═════════════════════════════════════════════════════════════════════════
