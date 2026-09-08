// ═══════════════════════════════════════════════════════════════════════════
// THE US EARNINGS CARD — one shared component, two pages.
//
// This file is the card grammar the owner signed off on: five metric tiles
// (REVENUE / EPS·GAAP / EPS·ADJ / OPM / CFO-NI), the secondary tiles, the chips
// (R40, ROCE, SETUP, guidance, EPS beat), the collapsed card that ENDS AT THE
// NARRATIVE, and the expand panel with guidance, the four-period results and
// margin tables, the balance-sheet context and the setup scorecard.
//
// WHY IT LIVES HERE RATHER THAN INSIDE /us-earnings-opportunities/page.tsx
// ────────────────────────────────────────────────────────────────────────
// It used to live inside that page, and US Conviction Beats grew its own,
// smaller card. The two then drifted: the Opportunities card learned about
// `series`, `tile_refs`, `vs_guide` and the yellow IN-LINE rule, and the bench
// card never did — so the same company read differently on two tabs of the same
// app. One component, imported by both, is the only arrangement in which that
// cannot happen again. A field added here appears on both pages at once.
//
// THE PAYLOAD CONTRACT IS src/lib/us-expand-contract.md. Every field is
// optional on every row. Nothing here interpolates, back-fills or rescales: a
// figure the filer did not tag renders as nothing at all.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  fmtUsd, fmtPx, fmtPct, SWING_LABEL, SWING_GOOD,
  type UsGradedRow, type EarningsTier, type SwingKind,
} from '@/lib/us-earnings-core';
import { fmtGuideRange, GUIDE_METRIC_LABEL, type GuidanceFigure } from '@/lib/us-guidance-figures';
import { QUADRANT_META, type EarningsQuadrant } from '@/lib/earnings-grade-shared';
import { fmtKeyMetric, KEY_METRIC_LABEL, type KeyMetric, type KeyMetricId } from '@/lib/us-key-metrics';

/** The neutral third state, used everywhere a comparison can land between two
 *  verdicts. A guided range that BRACKETS the estimate is IN LINE and reads
 *  yellow — never red. */
export const IN_LINE_COLOR = '#FACC15';

export const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '🔥', tagline: 'Explosive growth, clean quality, market confirming' },
  STRONG: { label: 'STRONG', color: '#10B981', icon: '✅', tagline: 'Solid beat with at least one methodology passing' },
  MIXED: { label: 'MIXED', color: '#FACC15', icon: '⚠️', tagline: 'Growth present but with caveats — needs a second look' },
  AVOID: { label: 'AVOID', color: '#EF4444', icon: '⛔', tagline: 'Fails the bar on growth, quality or trend' },
};

// ═══════════════════════════════════════════════════════════════════════════
// THE SECOND AXIS — QUALITY × INFLECTION
//
// "Absolute quality and rate of change are not the same thing." The tier is one
// number and it has to average the two, which is how a company that grew 52%,
// expanded operating margin 31.9pp, doubled backlog and raised guidance — while
// burning cash on a negative return on capital — came out MIXED and was buried.
// The quadrant sits BESIDE the tier and never replaces it: the tier says how
// good the print was, the quadrant says what KIND of company printed it.
//
// WHY THESE COLOURS AND NOT A TRAFFIC LIGHT
// ─────────────────────────────────────────
// The owner's complaint about the old tables, twice: they looked "too dull red
// or green traffic light type". A red/green pair also says the wrong thing
// here, because TURNAROUND ACCELERATOR is neither good nor bad — it is the
// highest-variance quadrant in the market, where both the biggest asymmetric
// wins and most of the permanent losses live. So the four take the card's
// EXISTING chip vocabulary — the same amber the BLOCKBUSTER tier uses, the same
// violet the MULTIBAGGER chip uses, the same cyan the panel's accent rule uses —
// and REJECT is the quiet grey of a row with nothing to say rather than an
// alarm. Two of the owner's suggested glyphs are changed for the same reason:
// 🟢 is literally a traffic light, and a red ⛔ would make the least interesting
// quadrant the loudest thing on the page.
// ═══════════════════════════════════════════════════════════════════════════

// The four quadrants' icon, colour and one-line meaning live in
// `earnings-grade-shared.ts` alongside the scoring, NOT here — that module
// exists precisely because the India and US graders kept drifting apart, and a
// badge that says COMPOUNDER on one tab and something else on the other is the
// same class of drift. Re-exported so this file stays the card's single import.
export { QUADRANT_META };

/** The two axes as one sentence, for the badge tooltip. Stated in words because
 *  "Q 25 · I 88" means nothing to a reader who has not been told what it is. */
export function quadrantTitle(q: EarningsQuadrant, quality: number | null, inflection: number | null): string {
  const m = QUADRANT_META[q];
  const scores = (quality != null && inflection != null)
    ? `Quality ${quality}/100 (returns, cash, margin level, whether it makes money) · `
      + `Inflection ${inflection}/100 (growth, the CHANGE in margin, the direction of the guide). `
    : '';
  return `${scores}${m.tagline} Open the card for the component-by-component breakdown.`;
}

/** A 2px meter. The score pair is the point of the badge, and two bars say
 *  "these are two different axes" in a way that two numbers side by side do
 *  not — it is the same bar the setup scorecard already uses, at chip scale. */
function AxisBar({ v, color }: { v: number; color: string }) {
  return (
    <span aria-hidden style={{
      display: 'block', width: 22, height: 2.5, borderRadius: 2,
      backgroundColor: 'color-mix(in srgb, currentColor 25%, transparent)', overflow: 'hidden',
    }}>
      <span style={{
        display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, v))}%`,
        backgroundColor: color,
      }} />
    </span>
  );
}

/**
 * The quadrant badge: icon, name, and the two scores as a compact pair with a
 * meter behind each. Rendered in the chip row beside the tier, never instead of
 * it. A row whose payload has no quadrant renders nothing at all.
 */
export function QuadrantBadge({ r }: { r: UsGradedRow }) {
  const q = (r as any).quadrant as EarningsQuadrant | undefined;
  if (!q || !QUADRANT_META[q]) return null;
  const m = QUADRANT_META[q];
  const ql = num((r as any).quality_score);
  const inf = num((r as any).inflection_score);
  return (
    <span title={quadrantTitle(q, ql, inf)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
      fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, cursor: 'help',
      border: `1px solid ${m.color}`, color: m.color,
      backgroundColor: `color-mix(in srgb, ${m.color} 12%, transparent)`,
    }}>
      <span>{m.icon} {q}</span>
      {(ql != null || inf != null) && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, paddingLeft: 7,
          borderLeft: `1px solid color-mix(in srgb, ${m.color} 45%, transparent)`,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {ql != null && (
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span>Q {ql}</span><AxisBar v={ql} color={m.color} />
            </span>
          )}
          {ql != null && inf != null && <span style={{ opacity: 0.5 }}>·</span>}
          {inf != null && (
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span>I {inf}</span><AxisBar v={inf} color={m.color} />
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
      padding: '7px 9px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--mc-text-0)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

/** A percentage surprise off a near-zero estimate is noise dressed as signal —
 *  Domo beat a $0.00 consensus by two cents and the arithmetic reads +5,888%.
 *  Below a dime of estimate, state the beat in cents instead. */
export function surpriseText(r: any): string {
  const est = r.eps_estimate as number | null;
  const act = (r.eps_adj ?? r.eps_curr) as number | null;
  const pct = r.eps_surprise_pct as number | null;
  // A NEGATIVE ESTIMATE NEEDS THE CENTS TOO, NOT JUST A NEAR-ZERO ONE.
  //
  // The engine only publishes `eps_surprise_pct` off a base of $0.10 or more —
  // a percentage of a LOSS estimate says the opposite of what it looks like —
  // so for a company the street expected to lose money there is no percentage
  // and this used to fall through and return an empty string. Titan Machinery's
  // −$0.57 consensus left the card with no surprise at all. The condition is
  // therefore the engine's own: no positive base of at least a dime, state the
  // surprise in cents. `act - est` is signed, so guiding or delivering a
  // SMALLER loss is a beat, exactly as it should be.
  if (est != null && act != null && !(est >= 0.1)) {
    const d = act - est;
    return `${d >= 0 ? 'beat by' : 'missed by'} $${Math.abs(d).toFixed(2)}`;
  }
  if (pct == null) return '';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}
export function surpriseChip(r: any): string {
  const t = surpriseText(r);
  return /%$/.test(t) ? `vs est ${t}` : t;
}

export const growthColor = (v: number | null | undefined) =>
  v == null ? 'var(--mc-text-3)' : v >= 25 ? 'var(--mc-bullish)' : v >= 0 ? 'var(--mc-text-0)' : 'var(--mc-bearish)';

/**
 * The value+colour for a growth tile, in one place.
 *
 * A percentage is refused when the prior-year base was zero or negative — a
 * loss of $0.31 turning into $1.59 of profit is not "+613%". That refusal used
 * to leave a bare dash on the card, which threw away the most important fact
 * about the quarter (Semtech's Q2 FY27 read "—" on exactly this). So when the
 * engine names a swing, the swing is printed instead of the percentage: they
 * are mutually exclusive by construction and neither is ever invented.
 *
 * `fallback` is the value shown when there is neither a percentage nor a swing
 * but the level itself is worth showing (the adjusted-EPS tile in a company's
 * first year of coverage prints "$0.71" rather than a dash).
 */
export function swingTile(pct: number | null | undefined, swing: SwingKind, fallback?: string):
  { value: string; color?: string } {
  const p = num(pct);
  if (p != null) return { value: fmtPct(p), color: growthColor(p) };
  if (swing) return { value: SWING_LABEL[swing], color: SWING_GOOD[swing] ? 'var(--mc-bullish)' : 'var(--mc-bearish)' };
  if (fallback) return { value: fallback, color: 'var(--mc-text-0)' };
  return { value: '—', color: 'var(--mc-text-3)' };
}

/**
 * SLOTS — how /us-conviction-beats decorates this card without forking it.
 *
 * The bench has three things to say that a graded tier list does not: its own
 * BUY/WATCH verdict, how the name has drifted since the print, and a way to
 * take it off the bench. Rather than let the bench keep a second, smaller card
 * (which is how the two pages drifted apart in the first place), those arrive
 * as optional slots and everything else on the card stays identical on both
 * tabs by construction.
 */
export function UsEarningsCard({ r, open, onToggle, panelId: pid, extraChips, topRight }: {
  r: UsGradedRow; open: boolean; onToggle: () => void; panelId: string;
  /** Chips prepended to the chip row — the bench's tier, verdict, drift state
   *  and tradeability. They go in the CHIP ROW and not below the narrative on
   *  purpose: the collapsed card ends at the narrative, on both tabs. */
  extraChips?: React.ReactNode;
  /** Absolutely positioned in the card's top-right — the bench's remove ×. */
  topRight?: React.ReactNode;
}) {
  const meta = TIER_META[r.tier];
  const opmD = (r.opm_pct != null && r.opm_prev_pct != null) ? r.opm_pct - r.opm_prev_pct : null;
  // GAAP EPS growth only — never the grading axis, which may be the adjusted
  // basis (see `eps_gaap_yoy_pct` in us-earnings-core).
  const gaapEpsY = (r as any).eps_gaap_yoy_pct !== undefined
    ? ((r as any).eps_gaap_yoy_pct as number | null)
    : (r.eps_prev != null && r.eps_prev > 0 && r.eps_curr != null
        ? ((r.eps_curr - r.eps_prev) / r.eps_prev) * 100 : null);
  const adjEpsCur = num((r as any).eps_adj_curr ?? (r as any).eps_adj);
  const adjEpsPrev = num((r as any).eps_adj_prev);
  const epsEst = num((r as any).eps_estimate);
  const surp = num((r as any).eps_surprise_pct);
  const hasAdjEps = adjEpsCur != null;
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${meta.color}`,
      // A grid item defaults to min-width:auto, which lets a wide child (the
      // panel's tables) push the whole column out. Zero here is what makes the
      // tables scroll inside themselves instead of scrolling the page.
      minWidth: 0, position: 'relative',
    }}>
      {topRight && <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}>{topRight}</div>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingRight: topRight ? 18 : 0 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text-0)' }}>{r.ticker}</span>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.company}
        </span>
        <span style={{ fontWeight: 800, fontSize: 13, color: meta.color }}>{r.composite_score}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 9px' }}>
        {extraChips}
        {/* BESIDE the tier, never instead of it. On the Opportunities tab the
            tier is the section heading above the card; on the bench it is the
            first of `extraChips`. Either way this lands immediately after it. */}
        <QuadrantBadge r={r} />
        {(r as any).prelim && <Chip text="PRELIM · GAAP pending" color="#8B5CF6" />}
        <Chip text={r.quarter} />
        {r.sector && <Chip text={r.sector} />}
        {r.market_cap_musd != null && <Chip text={fmtUsd(r.market_cap_musd)} />}
        {(r as any).eps_surprise_pct != null && (
          <Chip text={`EPS beat ${surpriseChip(r).replace(/^vs est\s*/, '')}`}
            color={(r as any).eps_surprise_pct >= 5 ? '#10B981' : (r as any).eps_surprise_pct <= -5 ? '#EF4444' : undefined} />
        )}
        {(r as any).guidance && (
          <Chip text={`📣 Guidance ${String((r as any).guidance).toLowerCase()}`}
            color={(r as any).guidance === 'RAISED' ? '#10B981' : (r as any).guidance === 'LOWERED' || (r as any).guidance === 'WITHDRAWN' ? '#EF4444' : (r as any).guidance === 'MAINTAINED' ? '#FACC15' : undefined} />
        )}
        {r.is_elite && <Chip text="⭐ ELITE" color="#F59E0B" />}
        {r.multibagger_setup && <Chip text="💎 MULTIBAGGER" color="#8B5CF6" />}
        {num((r as any).rule40?.score) != null && <Rule40Chip r40={(r as any).rule40 as Rule40Like} />}
        {num((r as any).roce?.pct) != null && (
          <Chip text={`ROCE ${(r as any).roce.pct.toFixed(0)}%`}
            color={(r as any).roce.pct >= 20 ? 'var(--mc-bullish)' : (r as any).roce.pct < 8 ? 'var(--mc-bearish)' : undefined} />
        )}
        {num((r as any).setup?.score) != null && (
          <Chip text={`SETUP ${(r as any).setup.score} · ${(r as any).setup.verdict}`}
            color={SETUP_VERDICT_COLOR[(r as any).setup.verdict] || undefined} />
        )}
        {(r.pead_score ?? 0) >= 70 && <Chip text={`🔥 PEAD ${r.pead_score}`} color="#EF4444" />}
      </div>

      <TileRow r={r} gaapEpsY={gaapEpsY} opmD={opmD}
        adjEpsCur={adjEpsCur} adjEpsPrev={adjEpsPrev} epsEst={epsEst} surp={surp} hasAdjEps={hasAdjEps} />

      <SecondaryTiles r={r} />

      {(r as any).eps_adj != null && (
        <div style={{
          marginTop: 7, padding: '5px 8px', borderRadius: 6, backgroundColor: 'var(--mc-bg-1)',
          border: '1px solid var(--mc-bg-4)', fontSize: 11, color: 'var(--mc-text-2)',
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: 0.3 }}>STREET BASIS</span>
          <span>adj. EPS <b style={{ color: 'var(--mc-text-0)' }}>${Number((r as any).eps_adj).toFixed(2)}</b></span>
          {(r as any).eps_estimate != null && <span>vs est ${Number((r as any).eps_estimate).toFixed(2)}</span>}
          {(r as any).eps_surprise_pct != null && (
            <b style={{ color: (r as any).eps_surprise_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
              {surpriseText(r)}
            </b>
          )}
          <span style={{ color: 'var(--mc-text-4)' }}>· adjusted figures exclude one-offs, so they differ from the GAAP tile</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '9px 0 0', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span>Reaction <b style={{ color: r.d1_pct == null ? 'var(--mc-text-3)' : r.d1_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.d1_pct, 1)}</b></span>
        <span>Since <b style={{ color: r.move_pct == null ? 'var(--mc-text-3)' : r.move_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.move_pct, 1)}</b></span>
        <span>PEAD <b style={{ color: 'var(--mc-text-0)' }}>{r.pead_score}</b></span>
        <span>RS <b style={{ color: 'var(--mc-text-0)' }}>{r.rs_rating ?? '—'}</b></span>
        <span>Stage <b style={{ color: r.stage === 4 ? 'var(--mc-bearish)' : r.stage === 2 ? 'var(--mc-bullish)' : 'var(--mc-text-0)' }}>{r.stage ?? '—'}</b></span>
        <span>{fmtPx(r.price)}{r.pe ? ` · P/E ${r.pe}` : ''}</span>
      </div>

      <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginTop: 9, lineHeight: 1.5 }}>
        {r.narrative}
      </div>
      {/* ── THE COLLAPSED CARD ENDS AT THE NARRATIVE ──────────────────────
          Everything that used to sit here — the guided ranges, the press-release
          guidance quotes, the methodology/caveat chips, the PRELIM note and the
          filing links — now lives in the expand panel below. The card was long
          enough that a screen held two of them; the point of a tier list is to
          scan twenty. Nothing was dropped: the panel already rendered the guide
          ranges (GUIDE VS. EXPECTATIONS), the quotes (GUIDANCE LANGUAGE) and the
          filing links (its footer), so those collapsed copies were duplicates and
          are simply gone; the chips and the PRELIM note had no copy there and were
          moved into the panel's METHODOLOGY & CAVEATS section. ─────────────── */}

      {/* ── the expand strip · every card gets one, however sparse the row ── */}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={pid} style={moreStrip(open)}>
        {open
          ? <><ChevronUp className="w-3 h-3" /> LESS</>
          : <><ChevronDown className="w-3 h-3" /> MORE · guidance, trend, context</>}
      </button>
      {open && (
        <div id={pid}>
          <DetailPanel r={r as UsRowX} />
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={pid} style={moreStrip(true)}>
            <ChevronUp className="w-3 h-3" /> LESS
          </button>
        </div>
      )}
    </div>
  );
}

export function moreStrip(open: boolean): React.CSSProperties {
  return {
    width: '100%', marginTop: 9, padding: '6px 8px', borderRadius: 6,
    border: `1px solid ${open ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
    backgroundColor: open ? 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)' : 'var(--mc-bg-1)',
    color: 'var(--mc-cyan)', fontSize: 'var(--mc-text-xs)', fontWeight: 800, letterSpacing: 0.3,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MAIN TILE ROW — AND THE RULE THAT A TILE WITH NOTHING TO SAY IS NOT DRAWN
//
// The payload contract (src/lib/us-expand-contract.md) says the UI must render
// what is present and silently omit the rest, "never a placeholder row of
// dashes". The tile row did not honour it: every card drew all five tiles
// whatever the row carried, which produced rows that state nothing at all —
//
//   BKE   REVENUE  —   — → —      an 8-K print whose 10-Q is not on EDGAR yet,
//                                 so the announced quarter has no XBRL revenue
//   BXBL  REVENUE  —   — → —      a filer that tags NO revenue concept at all
//         EPS·GAAP —   EPS not tagged
//   NEXM  REVENUE  —   — → —      pre-revenue explorer: nothing to report
//
// A tile is now drawn only when the row has a current value or a prior value
// for it. Nothing else changes: a tile with a current value and no prior still
// renders (that is information), and no tile is ever invented.
//
// AND $0 IS NOT THE SAME FACT AS "ABSENT".
// T3 Defense reported $4.0M against a prior-year quarter of exactly zero and
// the card read "REVENUE — $0K → $4.0M": a dash because `yoyPct` correctly
// refuses to divide by a zero base, and "$0K" because the money formatter has
// no case for an exact zero. A first dollar of revenue is one of the most
// important things a card can say, so a zero prior is now printed as "$0" and
// the growth cell says "First revenue" instead of refusing to speak. PHGE
// (BiomX), whose prior year is genuinely ABSENT rather than zero, gets the
// level and "no prior base" — a different sentence for a different fact.
// ═══════════════════════════════════════════════════════════════════════════

/** `fmtUsd` renders 0 as "$0K", which reads like a rounding artefact. An exact
 *  zero is a fact and is printed as one. */
function fmtUsdLevel(musd: number | null | undefined): string {
  return musd === 0 ? '$0' : fmtUsd(musd);
}

function TileRow({ r, gaapEpsY, opmD, adjEpsCur, adjEpsPrev, epsEst, surp, hasAdjEps }: {
  r: UsGradedRow; gaapEpsY: number | null; opmD: number | null;
  adjEpsCur: number | null; adjEpsPrev: number | null; epsEst: number | null;
  surp: number | null; hasAdjEps: boolean;
}) {
  const tiles: React.ReactNode[] = [];

  // ── REVENUE ────────────────────────────────────────────────────────────
  const revNow = num(r.revenue_curr_musd);
  const revPrev = num(r.revenue_prev_musd);
  if (revNow != null || revPrev != null) {
    let value: string, color: string | undefined, sub: string;
    if (r.sales_yoy_pct != null) {
      ({ value, color } = swingTile(r.sales_yoy_pct, null));
      sub = `${fmtUsdLevel(revPrev)} → ${fmtUsdLevel(revNow)}`;
    } else if (revPrev === 0 && revNow != null && revNow > 0) {
      // A real zero base. There is no percentage off zero, but there is a fact.
      value = 'First revenue'; color = 'var(--mc-bullish)';
      sub = `$0 → ${fmtUsdLevel(revNow)}`;
    } else if (revNow != null && revPrev == null) {
      value = fmtUsdLevel(revNow); color = 'var(--mc-text-0)';
      sub = 'no prior base';
    } else if (revNow == null && revPrev != null) {
      value = 'Not tagged'; color = 'var(--mc-text-3)';
      sub = `prior ${fmtUsdLevel(revPrev)}`;
    } else {
      ({ value, color } = swingTile(null, null));
      sub = `${fmtUsdLevel(revPrev)} → ${fmtUsdLevel(revNow)}`;
    }
    tiles.push(<Tile key="rev" label="REVENUE" value={value} color={color} sub={sub} />);
  }

  // ── EPS · GAAP ─────────────────────────────────────────────────────────
  // GAAP EPS growth ONLY — `eps_yoy_pct` is the grading axis and falls back to
  // the adjusted basis when the GAAP base was a loss; printing that here would
  // label an adjusted number "GAAP". When the base was a loss there is no
  // percentage, so the swing is named instead.
  // A REFUSAL IS NOT AN ABSENCE. When the year-ago quarter and this one sit on
  // different share counts — a split, usually a reverse split, whose factor the
  // filer's own record does not establish — the engine publishes no prior EPS
  // and no growth rate at all. Saying "no prior base" there would be a lie: the
  // prior base exists, it is just not on this quarter's shares. The dollar
  // tiles beside this one are unaffected, which is why they still show.
  const psBlocked = !!(r as any).eps_compare_blocked;
  if (r.eps_curr != null || r.eps_prev != null) {
    tiles.push(
      <Tile key="eps" label="EPS · GAAP" {...swingTile(gaapEpsY, r.eps_swing)}
        sub={psBlocked
          ? (r.eps_curr != null
              ? `${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)} · share count changed, no comparable prior`
              : 'share count changed · no comparable prior')
          : r.eps_prev != null && r.eps_curr != null
          ? `$${r.eps_prev.toFixed(2)} → ${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)}`
          : r.eps_curr != null ? `${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)} · no prior base`
          : `prior $${r.eps_prev!.toFixed(2)} · not tagged this quarter`} />,
    );
  }

  // ── EPS · ADJ. ─────────────────────────────────────────────────────────
  // The basis the market actually trades. Its own tile so a company whose GAAP
  // line swung out of a loss still has a growth number, and so the two are
  // never confused.
  if (hasAdjEps) {
    tiles.push(
      <Tile key="epsadj" label="EPS · ADJ." {...swingTile(r.eps_adj_yoy_pct ?? null, r.eps_adj_swing ?? null,
        adjEpsCur != null ? `$${adjEpsCur.toFixed(2)}` : '—')}
        sub={adjEpsPrev != null && adjEpsCur != null
          ? `$${adjEpsPrev.toFixed(2)} → $${adjEpsCur.toFixed(2)}`
          : epsEst != null && adjEpsCur != null
          ? `vs est $${epsEst.toFixed(2)}${surp != null ? ` · ${surp >= 0 ? '+' : ''}${surp.toFixed(0)}%` : ''}`
          : 'no prior base'} />,
    );
  }

  // ── OPM ────────────────────────────────────────────────────────────────
  if (r.opm_pct != null || r.opm_prev_pct != null) {
    tiles.push(
      <Tile key="opm" label="OPM" value={r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : 'Not tagged'}
        color={r.opm_pct == null ? 'var(--mc-text-3)' : opmD == null ? undefined : opmD >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp YoY`
          : r.opm_prev_pct != null ? `prior ${r.opm_prev_pct.toFixed(1)}%` : 'no prior margin'} />,
    );
  }

  // ── CFO / NI ───────────────────────────────────────────────────────────
  if (r.cfo_to_pat_ratio != null || r.cfo_curr_musd != null) {
    tiles.push(
      <Tile key="cfo" label="CFO/NI" value={r.cfo_to_pat_ratio != null ? r.cfo_to_pat_ratio.toFixed(2) : '—'}
        color={r.cfo_to_pat_ratio == null ? undefined : r.cfo_to_pat_ratio >= 1 ? 'var(--mc-bullish)' : r.cfo_to_pat_ratio >= 0.5 ? undefined : 'var(--mc-bearish)'}
        sub={r.cfo_curr_musd != null ? `CFO ${fmtUsdLevel(r.cfo_curr_musd)}` : 'net income not comparable'} />,
    );
  }

  if (!tiles.length) return null;
  // The column count follows what actually rendered, so a card with three
  // tiles shows three full-width tiles rather than three tiles and two holes.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`, gap: 6 }}>
      {tiles}
    </div>
  );
}

/**
 * The second row of tiles: the numbers that decide a print for the kind of
 * company being graded, in the same grammar as revenue/EPS/OPM/CFO above.
 *
 * Free cash flow is computed from the filing itself (CFO − capex, both from the
 * cash-flow statement). The rest — ARR, RPO/cRPO, net revenue retention,
 * backlog, adjusted EBITDA — exist only in the press release, so they appear
 * for the companies that report them and are simply absent for the rest; a tile
 * is never invented. At most four are shown, most decision-relevant first.
 */

/**
 * What the number was expected to be, printed under the tile that shows it.
 *
 * An earnings feed writes "Adj Gross Margin: 75.0% (Est. 75%)". That estimate is
 * bought from a consensus vendor; no free source carries a consensus gross
 * margin, EBITDA or free cash flow, and even revenue and EPS are dropped as soon
 * as the feed rolls to the next quarter. What we always have instead, for every
 * metric a company chose to guide, is the range the company itself put its name
 * to a quarter ago — the number management was actually measured against. So
 * the tile shows whichever exists and says which of the two it is.
 *
 * The colour is the same three-state rule as everywhere else: inside the range
 * is IN LINE and reads yellow, not red.
 */
export interface TileRef {
  low: number | null; high: number | null; unit: string;
  basis: 'gaap' | 'adjusted' | null;
  source: 'guide' | 'estimate';
  verdict: 'above' | 'below' | 'in-line' | null;
  actual: number | null;
}
const REF_COLOR: Record<string, string> = {
  above: 'var(--mc-bullish)', below: 'var(--mc-bearish)', 'in-line': IN_LINE_COLOR,
};
const REF_GLYPH: Record<string, string> = { above: '\u25B2', below: '\u25BC', 'in-line': '\u2248' };

export function refFor(r: UsGradedRow, ...keys: string[]): TileRef | null {
  const refs = (r as any).tile_refs as Record<string, TileRef> | undefined;
  if (!refs) return null;
  for (const k of keys) {
    const v = refs[k];
    if (v && (v.low != null || v.high != null)) return v;
  }
  return null;
}

/** "(Est. $92.2B) \u25B2" / "(Guide 74.9\u201375.1%) \u2248" — or nothing. */
export function RefSub({ ref: rf }: { ref: TileRef | null }) {
  if (!rf) return null;
  const one = (v: number): string => {
    if (rf.unit === 'pct') return `${Math.round(v * 10) / 10}%`;
    if (rf.unit === 'usd_share') return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
    const a = Math.abs(v);
    const body = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(0)}M` : `$${Math.round(a).toLocaleString()}`;
    return v < 0 ? `-${body}` : body;
  };
  const lo = rf.low, hi = rf.high;
  // Same rule as `fmtGuideRange`: an en-dash between two signed numbers is
  // unreadable ("-$1.75\u2013-$1.25"), so a range with a sign on either end is
  // joined with the word instead.
  const pair = (a: number, b: number): string => {
    const l = one(a), h = one(b);
    return (/^[-+\u2212]/.test(l) || /^[-+\u2212]/.test(h)) ? `${l} to ${h}` : `${l}\u2013${h}`;
  };
  const body = lo == null ? one(hi as number) : hi == null || hi === lo ? one(lo) : pair(lo, hi);
  const word = rf.source === 'estimate' ? 'Est.' : 'Guide';
  const c = rf.verdict ? REF_COLOR[rf.verdict] : 'var(--mc-text-4)';
  return (
    <span style={{ color: 'var(--mc-text-4)' }}>
      {' \u00b7 '}{word} {body}
      {rf.verdict && <b style={{ color: c }}>{' '}{REF_GLYPH[rf.verdict]}</b>}
    </span>
  );
}

export function SecondaryTiles({ r }: { r: UsGradedRow }) {
  const metrics: KeyMetric[] = ((r as any).key_metrics || []) as KeyMetric[];
  const by = new Map<KeyMetricId, KeyMetric>();
  // A metric whose value is not a finite number is not a metric. Without this
  // guard `fmtKeyMetric` renders the literal string "NaN" into a tile, which
  // reads as a figure rather than as the absence of one.
  for (const m of metrics) if (m && Number.isFinite(m.value) && !by.has(m.id)) by.set(m.id, m);

  const tiles: React.ReactNode[] = [];
  const fcf = (r as any).fcf_curr_musd as number | null | undefined;
  const fcfPrev = (r as any).fcf_prev_musd as number | null | undefined;
  const fcfY = (r as any).fcf_yoy_pct as number | null | undefined;
  // The COMPANY's own free-cash-flow figure wins when it published one: many
  // filers deduct capitalised software or finance-lease payments as well as
  // property capex, so our CFO − capex can differ from the number the market
  // saw. Ours is the fallback, and it says which one is on screen.
  const relFcf = by.get('free_cash_flow');
  if (relFcf) {
    tiles.push(
      <Tile key="fcf" label="FREE CASH FLOW" value={fmtKeyMetric(relFcf)}
        color={relFcf.value >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={<>{relFcf.yoy_pct != null ? `${fmtPct(relFcf.yoy_pct)} YoY · as reported` : 'as reported'}
          <RefSub ref={refFor(r, 'free_cash_flow:adjusted', 'free_cash_flow')} /></>} />,
    );
  } else if (fcf != null) {
    tiles.push(
      <Tile key="fcf" label="FREE CASH FLOW" value={fmtUsd(fcf)}
        color={fcf >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={<>{fcfY != null
            // A four-figure percentage says only that last year's base was
            // near zero — Dollar Tree's "+4,228%" is $15.6M going to $675M.
            // The two figures say it better than the ratio does.
            ? (Math.abs(fcfY) >= 300 && fcfPrev != null
                ? `${fmtUsd(fcfPrev)} → ${fmtUsd(fcf as number)} · low base`
                : `${fmtPct(fcfY)} YoY · CFO − capex`)
            : fcfPrev != null ? `was ${fmtUsd(fcfPrev)}` : 'CFO − capex'}
          <RefSub ref={refFor(r, 'free_cash_flow:adjusted', 'free_cash_flow')} /></>} />,
    );
  }

  const order: Array<[KeyMetricId, string]> = [
    ['arr', 'ARR'], ['rpo', 'RPO'], ['crpo', 'cRPO'], ['nrr', 'NET RETENTION'],
    ['backlog', 'BACKLOG'], ['adj_ebitda', 'ADJ. EBITDA'], ['comparable_sales', 'COMP SALES'],
    ['net_new_arr', 'NET NEW ARR'], ['subscription_revenue', 'SUBSCRIPTION REV'],
    ['operating_margin_adj', 'ADJ. OPM'], ['gross_margin_adj', 'ADJ. GROSS MARGIN'],
    ['customers_100k', 'CUSTOMERS >$100K'],
  ];
  // Which guided line, if any, each reported metric should be measured against.
  // Only pairings that are the SAME measure on the SAME basis — an adjusted
  // gross margin against an adjusted gross-margin guide, never against a GAAP
  // one and never against a different line.
  const REF_KEYS: Partial<Record<KeyMetricId, string[]>> = {
    adj_ebitda: ['ebitda:adjusted'],
    operating_margin_adj: ['operating_margin:adjusted'],
    gross_margin_adj: ['gross_margin:adjusted'],
    comparable_sales: ['comparable_sales'],
    subscription_revenue: ['subscription_revenue'],
  };
  for (const [id, label] of order) {
    if (tiles.length >= 4) break;
    const m = by.get(id);
    if (!m) continue;
    const rf = refFor(r, ...(REF_KEYS[id] || []));
    tiles.push(
      <Tile key={id} label={label} value={fmtKeyMetric(m)}
        color={m.yoy_pct == null ? undefined : m.yoy_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={<>{m.yoy_pct != null ? `${fmtPct(m.yoy_pct)} YoY` : 'reported'}<RefSub ref={rf} /></>} />,
    );
  }
  if (!tiles.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, tiles.length)}, 1fr)`, gap: 6, marginTop: 6 }}>
      {tiles}
    </div>
  );
}

// ── guide vs. the street: a bracketing range is NOT a miss ─────────────────
/** The neutral third state. Same yellow the MIXED tier and the setup bar use. */

interface GuideStance {
  stance: 'above' | 'in-line' | 'below';
  glyph: '▲' | '≈' | '▼';
  color: string;
  /** Mid-sentence phrase: "…the guide is in line with the street." */
  word: string;
}

/**
 * How a guided RANGE stands against the street's point estimate.
 *
 * This used to compare the estimate with the range's MIDPOINT alone, which
 * turned every guide whose midpoint sat a hair under consensus into a red ▼ —
 * Nutanix guiding revenue to $3.18B–$3.23B against a $3.22B estimate was
 * printed as a miss even though the street's number is INSIDE the range the
 * company gave. A company that brackets consensus has guided in line; it has
 * not guided below.
 *
 *   estimate inside [low, high]  → in line          · yellow ≈
 *   estimate below low           → guide above the street · green ▲
 *   estimate above high          → guide below the street · red ▼
 *
 * A point guide (low === high) has no width to sit inside, so it keeps a 0.5%
 * tolerance — the same band `compareToGuide` in us-prior-guidance.ts uses when
 * it measures an actual against a point guide.
 *
 * NEGATIVES ARE ORDERED, NOT SIZED. Every comparison here is a signed one on the
 * number line, never on magnitude, because for an EPS-like metric higher is
 * better whatever the sign: Titan Machinery guided adjusted EPS to −$1.75 to
 * −$1.25 against a −$0.57 estimate, and the estimate sits ABOVE the top of the
 * range, so the guide is below the street (▼) — a deeper loss than the street
 * carried. Comparing magnitudes would have called the same guide ▲, because
 * 1.75 > 0.57. The one place `Math.abs` is used is the point-guide tolerance,
 * which is a width and is correctly unsigned.
 *
 * Returns null whenever either side is missing: nothing is coloured on a
 * comparison that was never made.
 */
export function guideVsStreet(
  low: number | null | undefined,
  high: number | null | undefined,
  est: number | null | undefined,
): GuideStance | null {
  const e = num(est);
  const a0 = num(low);
  const b0 = num(high);
  if (e == null) return null;
  // A one-sided guide ("at least $3.2B") is treated as the point it states.
  const lo = a0 != null && b0 != null ? Math.min(a0, b0) : (a0 ?? b0);
  const hi = a0 != null && b0 != null ? Math.max(a0, b0) : (b0 ?? a0);
  if (lo == null || hi == null) return null;
  const tol = lo === hi ? Math.abs(lo) * 0.005 : 0;
  if (e >= lo - tol && e <= hi + tol) {
    return { stance: 'in-line', glyph: '≈', color: IN_LINE_COLOR, word: 'in line with the street' };
  }
  if (e < lo) return { stance: 'above', glyph: '▲', color: 'var(--mc-bullish)', word: 'above the street' };
  return { stance: 'below', glyph: '▼', color: 'var(--mc-bearish)', word: 'below the street' };
}

/**
 * The guided numbers, grouped by period the way an earnings feed prints them:
 *
 *   Raises FY26 guide   Revenue $5.63B–$5.71B (Est. $5.54B) ▲   from $5.40B–$5.48B
 *                       Adj. EPS $9.83–$10.31 (Est. $9.25) ▲    from $8.65–$9.05
 *
 * Everything except "(Est. …)" is read from the company's own press release;
 * the estimate is the street's consensus for that period.
 */
export function GuideBlock({ figs, label, showSource }: {
  figs: Array<GuidanceFigure & { est?: number | null }>;
  label?: string | null;
  /** Panel-only: print the sentence each figure was parsed out of, so the
   *  number can be checked against the release without leaving the card. */
  showSource?: boolean;
}) {
  const groups = new Map<string, Array<GuidanceFigure & { est?: number | null }>>();
  for (const f of figs) {
    if (!groups.has(f.period_label)) groups.set(f.period_label, []);
    groups.get(f.period_label)!.push(f);
  }
  const verb = label === 'RAISED' ? 'Raises' : label === 'LOWERED' ? 'Cuts' : label === 'MAINTAINED' ? 'Reaffirms' : 'Guides to';
  return (
    <div style={{
      marginTop: 8, borderRadius: 6, border: '1px solid var(--mc-bg-4)',
      backgroundColor: 'var(--mc-bg-1)', padding: '7px 9px',
    }}>
      {Array.from(groups.entries()).map(([period, list]) => (
        <div key={period} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, color: 'var(--mc-text-3)', marginBottom: 3 }}>
            {verb.toUpperCase()} {period.toUpperCase()}{verb === 'Guides to' ? '' : ' GUIDE'}
          </div>
          {list.map((f, i) => {
            const vs = guideVsStreet(f.low, f.high, f.est);
            return (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 11, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--mc-text-3)', minWidth: 96 }}>
                  {f.basis === 'adjusted' ? 'Adj. ' : ''}{GUIDE_METRIC_LABEL[f.metric]}
                </span>
                <b style={{ color: 'var(--mc-text-0)' }}>{fmtGuideRange(f)}</b>
                {f.est != null && (
                  <span style={{ color: 'var(--mc-text-4)' }}>
                    (Est. {fmtGuideRange({ low: f.est, high: f.est, unit: f.unit })})
                  </span>
                )}
                {vs != null ? (
                  <span title={`The guide is ${vs.word}`} style={{ color: vs.color, fontWeight: 800 }}>
                    {vs.glyph}
                    {vs.stance === 'in-line' && (
                      <span style={{ fontWeight: 700, fontSize: 10 }}> in line</span>
                    )}
                  </span>
                ) : f.raised === true ? (
                  // No estimate to compare with — this arrow is about the
                  // company's OWN prior guide, not the street, and says so.
                  <span title="Raised versus the company's prior guide" style={{ color: 'var(--mc-bullish)', fontWeight: 800 }}>▲</span>
                ) : null}
                {f.prior_low != null && (
                  <span style={{ color: 'var(--mc-text-4)' }}>
                    from {fmtGuideRange({ low: f.prior_low, high: f.prior_high, unit: f.unit })}
                  </span>
                )}
                {showSource && f.source && (
                  <span style={{ flexBasis: '100%', fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.4 }}>
                    “{f.source}”
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Chip({ text, color, title, dashed, trailing }: {
  text: string; color?: string;
  /** Native tooltip. Used by any chip whose number carries a caveat. */
  title?: string;
  /** A dashed outline marks a chip whose figure is measured on a weaker basis
   *  than the same chip normally carries — see `Rule40Chip`. */
  dashed?: boolean;
  /** Rendered immediately after the text, inside the pill (a basis badge). */
  trailing?: React.ReactNode;
}) {
  const c = color || 'var(--mc-text-3)';
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
      border: `1px ${dashed ? 'dashed' : 'solid'} ${color ? c : 'var(--mc-bg-4)'}`, color: c,
      backgroundColor: color ? `color-mix(in srgb, ${c} 10%, transparent)` : 'transparent',
      whiteSpace: 'nowrap', cursor: title ? 'help' : undefined,
    }}>{text}{trailing}</span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE OF 40 — AND THE BASIS IT WAS MEASURED ON
//
// `rule40From` in us-earnings-core prefers a TRAILING-TWELVE-MONTH score
// (four quarters of revenue growth plus four quarters of FCF margin) and falls
// back to the single announced quarter when the filer does not yet have four
// clean quarters on EDGAR. That distinction is not decoration: one quarter of
// free cash flow moves with working capital and seasonality, so a
// quarter-basis score is materially noisier than a TTM one and the two are not
// comparable with each other.
//
// It used to be carried as the string "·q" glued onto the number — "R40
// 43.2·q", "R40 249.2·q" — which reads as a rendering artefact or a typo, not
// as a measurement basis. Nobody would ask what it meant; they would assume the
// engine was broken. So the fact is kept and the presentation is rebuilt: a
// superscript Q badge, a dashed chip outline that visually separates the
// weaker measure from the firm one, and a tooltip that says in words why the
// number should be trusted less. Both places the score renders — this card's
// chip row and the Conviction Beats bench table — use the pieces below, so the
// two cannot drift apart again.
// ═══════════════════════════════════════════════════════════════════════════

export interface Rule40Like {
  score: number | null;
  growth_pct: number | null;
  fcf_margin_pct: number | null;
  basis: 'ttm' | 'quarter';
  passes: boolean | null;
}

export const RULE40_QUARTER_NOTE =
  'Quarter basis, not trailing twelve months: the filer does not yet have four clean quarters on EDGAR, '
  + 'so this is one quarter of revenue growth plus that same quarter of free-cash-flow margin. '
  + 'A single quarter of free cash flow swings with working capital and seasonality, so this score is '
  + 'noisier than a TTM one and is not directly comparable with a TTM score.';

/** The tooltip for a Rule-40 figure: what went into it, and on what basis. */
export function rule40Title(r40: Rule40Like): string {
  const parts = `${r40.growth_pct ?? '—'}% revenue growth + ${r40.fcf_margin_pct ?? '—'}% FCF margin`;
  return r40.basis === 'ttm'
    ? `${parts}, trailing twelve months.`
    : `${parts}. ${RULE40_QUARTER_NOTE}`;
}

/** The superscript that marks a quarter-basis figure. Deliberately reads as a
 *  unit marker rather than as punctuation appended to the number. */
export function QuarterBasisBadge({ title }: { title?: string }) {
  return (
    <sup title={title ?? RULE40_QUARTER_NOTE} style={{
      marginLeft: 3, fontSize: 8, fontWeight: 800, letterSpacing: 0.2,
      padding: '0 3px', borderRadius: 3, verticalAlign: 'super', lineHeight: 1,
      backgroundColor: 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)',
      color: 'var(--mc-text-2)', cursor: 'help',
    }}>Q</sup>
  );
}

export function Rule40Chip({ r40 }: { r40: Rule40Like }) {
  const quarter = r40.basis === 'quarter';
  return (
    <Chip
      text={`R40 ${r40.score}`}
      color={r40.passes ? 'var(--mc-bullish)' : undefined}
      dashed={quarter}
      title={rule40Title(r40)}
      trailing={quarter ? <QuarterBasisBadge /> : null}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DETAIL PANEL
//
// One card's full earnings write-up, in the order a reader actually wants it:
// what the quarter did against the two things it was measured on (the street
// and the company's own guide), where the guide moved to, then the numbers
// themselves — four periods side by side with growth and margin deltas — then
// the balance-sheet and capital-return context, then every raw input the
// collapsed card hides.
//
// THE ONE RULE THE WHOLE FILE OBEYS
// ─────────────────────────────────
// Nothing here is interpolated, carried forward or back-filled. A quarter the
// filer did not tag is an em-dash. A growth rate whose base is zero or negative
// is `n/m`, never a number — a swing from −$40m to +$10m is not "+125% growth",
// and printing it as one is the single most common way a screen lies. Every
// section renders only if it has something real to say; a section with nothing
// says so in a sentence rather than showing a grid of dashes.
// ═══════════════════════════════════════════════════════════════════════════

// ── the payload contract (src/lib/us-expand-contract.md) ───────────────────
// Every field is optional and may be null or absent on any row, which is the
// steady state for a PRELIM print, a first-year filer or a company that gives
// no outlook — not an error condition.
export interface UsSeries {
  ends: string[];
  revenue: (number | null)[];
  gross_profit: (number | null)[];
  operating_income: (number | null)[];
  net_income: (number | null)[];
  eps: (number | null)[];
  cfo: (number | null)[];
  fcf: (number | null)[];
}
export interface UsContext {
  cash_musd: number | null;
  cash_incl_st_inv: boolean;
  debt_musd: number | null;
  sbc_musd: number | null;
  buyback_musd: number | null;
  dividends_musd: number | null;
  diluted_shares_m: number | null;
  diluted_shares_yoy_pct: number | null;
  as_of: string | null;
  /** 'release' = the condensed balance sheet printed in the earnings 8-K, so
   *  `as_of` is the quarter just announced; 'xbrl' (or absent) = a filed
   *  10-Q/10-K. See lib/us-pr-balance.ts. */
  source?: 'xbrl' | 'release';
  /** The period the FLOW lines cover (stock comp, buybacks, dividends, share
   *  count) when it is not `as_of` — a release's cash-flow statement is
   *  year-to-date and usually cannot be de-cumulated. */
  flows_as_of?: string | null;
}
export interface GuidedItem {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period: 'quarter' | 'year';
  guide_low: number | null;
  guide_high: number | null;
  guide_mid: number | null;
  unit: string;
  actual: number | null;
  guided_on: string;
  guided_for_label: string | null;
  source_url: string | null;
  compare: {
    verdict: 'beat' | 'missed' | 'in-line' | null;
    delta_pct: number | null;
    delta_abs: number | null;
    text: string | null;
  } | null;
}
export interface VsGuide {
  prior_filing_date: string | null;
  prior_filing_url: string | null;
  for_quarter: GuidedItem[];
  for_year: GuidedItem[];
}
export interface GuideChange {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period_label: string | null;
  prev_low: number | null; prev_high: number | null;
  new_low: number | null; new_high: number | null;
  direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
  delta_pct: number | null;
  unit: string;
}

export type UsRowX = UsGradedRow & {
  series?: UsSeries | null;
  context?: UsContext | null;
  vs_guide?: VsGuide | null;
  guide_change?: GuideChange[] | null;
  guidance?: string | null;
  guidance_figures?: Array<GuidanceFigure & { est?: number | null }> | null;
  guidance_snippets?: string[] | null;
  guidance_url?: string | null;
  guidance_absent_reason?: 'unreadable-format' | 'none-given' | 'release-unavailable' | null;
  guidance_absent_doc_url?: string | null;
  guidance_absent_doc_label?: string | null;
  balance_source?: 'release' | null;
  key_metrics?: KeyMetric[] | null;
  eps_adj?: number | null;
  eps_estimate?: number | null;
  eps_surprise_pct?: number | null;
  eps_basis?: string | null;
  prelim?: boolean;
  prelim_matched?: string[] | null;
  release_url?: string | null;
  is_financial?: boolean;
  /** The second axis. Written by us-earnings-core and overwritten by the
   *  graded-us route once ROCE is known, so the payload's values are final. */
  quality_score?: number | null;
  inflection_score?: number | null;
  quadrant?: EarningsQuadrant | null;
  quadrant_parts?: {
    quality: Array<{ label: string; points: number; of: number }>;
    inflection: Array<{ label: string; points: number; of: number }>;
  } | null;
};

/** Identity that survives the list re-sorting, the per-session merges and a row
 *  moving between tiers when its 10-Q lands. */
export function rowKey(r: UsGradedRow): string {
  return `${r.ticker}|${r.period_end || r.filing_date}`;
}
export function panelId(key: string): string {
  return `us-eo-panel-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

// ── tiny numeric guards ────────────────────────────────────────────────────
export const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

/** A share count, scaled like money. "24285.0M" is a number nobody reads;
 *  NVIDIA has 24.29 billion shares and that is how it should be written. */
const fmtShares = (m: number): string =>
  Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)}B` : `${m.toFixed(1)}M`;

/** Read index `i` of one of the series arrays, tolerating a short or absent
 *  array — the arrays are index-aligned by contract but nothing is guaranteed
 *  to be there. */
const at = (arr: unknown, i: number | null | undefined): number | null =>
  (Array.isArray(arr) && i != null && i >= 0 && i < arr.length) ? num(arr[i]) : null;

const DAY_MS = 86_400_000;
const iso10 = (v: unknown): string => String(v ?? '').slice(0, 10);
export function dayGap(laterIso: string, earlierIso: string): number | null {
  const a = Date.parse(laterIso + 'T00:00:00Z');
  const b = Date.parse(earlierIso + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / DAY_MS);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortEnd(isoDate: string): string {
  const t = Date.parse(iso10(isoDate) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return iso10(isoDate) || '—';
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`;
}

/** Only accept a series that is actually usable: a non-empty array of dates. */
export function normSeries(s: unknown): (UsSeries & { ends: string[] }) | null {
  const o = s as UsSeries | null | undefined;
  if (!o || !Array.isArray(o.ends) || o.ends.length === 0) return null;
  const ends = o.ends.map(iso10);
  if (!ends.every((e) => Number.isFinite(Date.parse(e + 'T00:00:00Z')))) return null;
  return { ...o, ends };
}

/**
 * Find the quarter that sits ~`targetDays` before `refIdx`, BY DATE.
 *
 * Index arithmetic alone is wrong here: filers skip periods (a transition
 * quarter, a restatement, a year where the 10-K's Q4 could not be derived), so
 * "twelve back in the array" is only sometimes three years back in time. We
 * take the closest end date to the target and then refuse it unless the gap is
 * genuinely within tolerance — which is what stops a two-year-ago quarter being
 * labelled and compounded as if it were three.
 */
export function backFrom(ends: string[], refIdx: number, targetDays: number, tolDays: number): number | null {
  let best = -1, bestErr = Infinity;
  for (let i = 0; i < refIdx; i++) {
    const g = dayGap(ends[refIdx], ends[i]);
    if (g == null || g <= 0) continue;
    const err = Math.abs(g - targetDays);
    if (err < bestErr) { bestErr = err; best = i; }
  }
  return (best >= 0 && bestErr <= tolDays) ? best : null;
}

interface PanelCol { idx: number; label: string; sub: string; }

/**
 * The four period columns: the reported quarter, the one before it, the
 * year-ago quarter and the quarter three years back.
 *
 * Only the reported quarter has a fiscal label we can trust — it is the one the
 * filer itself used, read off the release. Nothing lets us name the others
 * (decrementing "Q2 FY27" guesses at a fiscal calendar we have not been told),
 * so they are headed by their period-end date instead.
 */
export function buildCols(s: UsSeries & { ends: string[] }, quarterLabel: string | null | undefined) {
  const ends = s.ends;
  const last = ends.length - 1;
  const mk = (i: number | null): PanelCol | null =>
    i == null ? null : { idx: i, label: shortEnd(ends[i]), sub: ends[i] };
  const cur: PanelCol = { idx: last, label: quarterLabel || shortEnd(ends[last]), sub: ends[last] };
  const prevIdx = backFrom(ends, last, 91, 30);
  const yrIdx = backFrom(ends, last, 365, 45);
  const yr3Idx = backFrom(ends, last, 1095, 60);
  return {
    cur, prev: mk(prevIdx), yr: mk(yrIdx), yr3: mk(yr3Idx),
    yr3GapDays: yr3Idx == null ? null : dayGap(ends[last], ends[yr3Idx]),
  };
}

// ── the arithmetic discipline ──────────────────────────────────────────────
type Cell = { text: string; color?: string; pill?: 'up' | 'down' | 'flat' };

/**
 * A change, set in a tinted chip rather than as coloured text.
 *
 * When every delta in the table is saturated green or red, the table stops
 * distinguishing anything — it reads as a wall of traffic lights and the eye
 * has nowhere to land. A quiet tinted background carries the sign, the number
 * stays legible, and the sparkline beside it does the work of showing which
 * direction actually matters.
 */
export function Pill({ kind, children }: { kind: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  const c = kind === 'up' ? 'var(--mc-bullish)' : kind === 'down' ? 'var(--mc-bearish)' : 'var(--mc-text-3)';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontWeight: 700,
      fontSize: 10.5, lineHeight: 1.5, color: c,
      backgroundColor: 'color-mix(in srgb, currentColor 13%, transparent)',
      fontVariantNumeric: 'tabular-nums',
    }}>{children}</span>
  );
}

const DASH: Cell = { text: '—' };
const NM: Cell = { text: 'n/m', color: 'var(--mc-text-4)' };

/** Inside the tables every sign is a real minus (U+2212), not a hyphen: the
 *  columns are read as a block and `−3720` beside `+950` has to line up. */
const signedPct = (p: number, d = 1) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(d)}%`;
const levelPct = (p: number, d = 1) => `${p < 0 ? '−' : ''}${Math.abs(p).toFixed(d)}%`;

/**
 * Money in a comparison column, one significant step finer than the card's
 * `fmtUsd`: rounding $1.66B to "$1.7B" hides exactly the 6% sequential move the
 * next column claims to report.
 */
export function fmtUsdCell(musd: number | null): string {
  if (musd == null || !Number.isFinite(musd)) return '—';
  const a = Math.abs(musd), sign = musd < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}T`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(2)}B`;
  if (a >= 1) return `${sign}$${a.toFixed(a >= 100 ? 1 : 2)}M`;
  return `${sign}$${(a * 1000).toFixed(0)}K`;
}

/** A growth rate is only meaningful off a positive base. Missing is `—`;
 *  present-but-unusable (zero or negative base) is `n/m`. They are different
 *  facts and the panel never collapses one into the other. */
export function growthCell(cur: number | null, prev: number | null): Cell {
  if (cur == null || prev == null) return DASH;
  if (prev <= 0) return NM;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return DASH;
  return { text: signedPct(pct), pill: pct >= 0 ? 'up' : 'down' };
}

/**
 * 3-year CAGR = (latest / oldest)^(1/3) − 1, and only when
 *   • both ends exist and are strictly positive, and
 *   • the gap really is about three years (±60 days).
 * A company that swung from a loss to a profit has no compound growth rate;
 * neither does one whose oldest comparable is two years old.
 */
export function cagrCell(latest: number | null, oldest: number | null, gapDays: number | null): Cell {
  if (gapDays == null || Math.abs(gapDays - 1095) > 60) return DASH;
  if (latest == null || oldest == null) return DASH;
  if (latest <= 0 || oldest <= 0) return NM;
  const pct = (Math.pow(latest / oldest, 1 / 3) - 1) * 100;
  if (!Number.isFinite(pct)) return DASH;
  return { text: signedPct(pct), pill: pct >= 0 ? 'up' : 'down' };
}

/** A margin needs a positive revenue base; a negative margin is fine to show,
 *  a margin off a zero or negative top line is not a number. */
export function marginPct(v: number | null, rev: number | null): number | null {
  if (v == null || rev == null || rev <= 0) return null;
  const p = (v / rev) * 100;
  return Number.isFinite(p) ? p : null;
}

/** Margin moves are stated in basis points, never in "%" — a margin going from
 *  14% to 20% moved 600 bps, not 6% and not 43%. */
export function bpsCell(now: number | null, then: number | null): Cell {
  if (now == null || then == null) return DASH;
  const n = Math.round((now - then) * 100);
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return { text: '0', pill: 'flat' };
  return { text: `${n > 0 ? '+' : '−'}${Math.abs(n)}`, pill: n > 0 ? 'up' : 'down' };
}

const pctCell = (p: number | null): Cell =>
  p == null ? DASH : { text: levelPct(p), color: p >= 0 ? undefined : 'var(--mc-bearish)' };
const usdCell = (v: number | null): Cell =>
  v == null ? DASH : { text: fmtUsdCell(v), color: v < 0 ? 'var(--mc-bearish)' : undefined };

// ── panel chrome ───────────────────────────────────────────────────────────
/**
 * "Great earnings only lead to great returns when they meet a hungry
 * institutional buyer." The setup score is the engine's attempt at what
 * surrounds the beat, and it is only worth anything if it can be argued with —
 * so every factor shows the input it scored, and the ones with no free US
 * source say so instead of being quietly filled in with something adjacent.
 */
export const SETUP_VERDICT_COLOR: Record<string, string> = {
  'compounder setup': 'var(--mc-bullish)',
  'needs a pullback': '#FACC15',
  'beat already priced': 'var(--mc-bearish)',
  'thin evidence': 'var(--mc-text-3)',
};

export function SetupBlock({ setup }: { setup: any }) {
  if (!setup || !Array.isArray(setup.factors) || !setup.factors.length) return null;
  const total = num(setup.score);
  const bar = (v: number) => v >= 70 ? 'var(--mc-bullish)' : v >= 45 ? '#FACC15' : 'var(--mc-bearish)';
  return (
    <>
      <PanelH note="what surrounds the beat — the separators, each with its input">
        POST-EARNINGS SETUP
      </PanelH>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: total == null ? 'var(--mc-text-3)' : bar(total) }}>
          {total ?? '—'}
        </span>
        {setup.verdict && (
          <span style={{ fontSize: 11, fontWeight: 700, color: SETUP_VERDICT_COLOR[setup.verdict] || 'var(--mc-text-2)' }}>
            {setup.verdict}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
          {setup.factors_scored} of {setup.factors_total} factors had data
          {total == null && ' — too few to score'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {setup.factors.map((f: any) => {
          const s = num(f.score);
          return (
            <div key={f.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(96px, 1.1fr) 44px minmax(0, 2fr)',
              gap: 8, alignItems: 'center', fontSize: 10.5, minWidth: 0,
            }}>
              <span style={{ color: s == null ? 'var(--mc-text-4)' : 'var(--mc-text-2)' }}>{f.label}</span>
              {s == null ? (
                <span style={{ color: 'var(--mc-text-4)', fontSize: 9.5 }}>n/a</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'var(--mc-bg-4)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${Math.round(s)}%`, backgroundColor: bar(s) }} />
                  </span>
                  <b style={{ color: bar(s), fontSize: 9.5, minWidth: 16, textAlign: 'right' }}>{Math.round(s)}</b>
                </span>
              )}
              <span style={{ color: 'var(--mc-text-4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s == null ? (f.unavailable || '—') : f.input}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', marginTop: 5, lineHeight: 1.5 }}>
        Weighted over the factors that had data; a factor with no free US source is left out of the
        weighting rather than scored at a neutral value. Margin is scored on its <b>slope</b>, not its
        level — a good margin that stopped improving scores low on purpose.
      </div>
    </>
  );
}

export function PanelH({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', margin: '12px 0 5px' }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: 'var(--mc-text-3)' }}>{children}</span>
      {note && <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{note}</span>}
    </div>
  );
}
export function Bul({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.55, color: 'var(--mc-text-2)', marginBottom: 3 }}>
      <span style={{ color: 'var(--mc-text-4)', flex: '0 0 auto' }}>•</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
/** The inline highlighted verdict token — one word, coloured, inside the
 *  sentence, exactly the way the write-ups we are competing with do it. */
export function V({ verdict }: { verdict: 'beat' | 'missed' | 'in-line' | null }) {
  if (!verdict) return null;
  // "In line" is a verdict of its own, not a faded miss — the same neutral
  // yellow the guide-vs-street glyph uses, so the two read as one vocabulary.
  const c = verdict === 'beat' ? 'var(--mc-bullish)' : verdict === 'missed' ? 'var(--mc-bearish)' : IN_LINE_COLOR;
  const t = verdict === 'beat' ? 'Beat' : verdict === 'missed' ? 'Missed' : 'In line';
  return <b style={{ color: c }}>{t}</b>;
}
export function Quiet({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>{children}</div>;
}

/** Every table lives in its own horizontal scroller, so a 7-column grid can be
 *  read on a 360px phone without the card — or the page — moving sideways. */
export function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch',
      borderRadius: 6, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)',
    }}>
      {children}
    </div>
  );
}

/**
 * A row's whole history in 80 pixels.
 *
 * Four columns of numbers tell you where a company is; they do not show you
 * that the last three quarters turned up after a flat year, which is the thing
 * a reader is actually looking for — and a wall of red and green deltas makes
 * every row shout equally loudly, so nothing stands out. The sparkline carries
 * the shape and lets the colour recede.
 *
 * Bars for level series (revenue, profit, cash flow), because the comparison is
 * of magnitudes; a baseline is drawn at zero when the series crosses it, so a
 * loss reads as a loss rather than as a short bar. The most recent quarter — the
 * one being graded — is the only one at full strength; everything behind it is
 * faded, which is what makes the trend legible without a legend.
 */
export function Spark({ values, height = 20, width = 84 }: { values: Array<number | null>; height?: number; width?: number }) {
  const pts = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const real = pts.filter((v): v is number => v != null);
  if (real.length < 3) return <span style={{ color: 'var(--mc-text-4)', fontSize: 9 }}>—</span>;
  const hi = Math.max(...real, 0);
  const lo = Math.min(...real, 0);
  const span = hi - lo || 1;
  const n = pts.length;
  const gap = 1;
  const bw = Math.max(1.5, (width - gap * (n - 1)) / n);
  const y0 = height - ((0 - lo) / span) * height;      // the zero line
  const last = pts.reduce<number | null>((acc, v, i) => (v != null ? i : acc), null);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${real.length}-quarter trend`} style={{ display: 'block' }}>
      {lo < 0 && <line x1={0} y1={y0} x2={width} y2={y0} stroke="var(--mc-bg-4)" strokeWidth={1} />}
      {pts.map((v, i) => {
        if (v == null) return null;
        const yv = height - ((v - lo) / span) * height;
        const top = Math.min(yv, y0), h = Math.max(1, Math.abs(y0 - yv));
        const isLast = i === last;
        const good = v >= 0;
        return (
          <rect key={i} x={i * (bw + gap)} y={top} width={bw} height={h} rx={Math.min(1.2, bw / 2)}
            fill={good ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
            opacity={isLast ? 1 : 0.26 + 0.2 * (i / Math.max(1, n - 1))} />
        );
      })}
    </svg>
  );
}

/** The same idea for a margin: a line, because a margin is a level, not a size. */
export function SparkLine({ values, height = 20, width = 84 }: { values: Array<number | null>; height?: number; width?: number }) {
  const pts = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const real = pts.filter((v): v is number => v != null);
  if (real.length < 3) return <span style={{ color: 'var(--mc-text-4)', fontSize: 9 }}>—</span>;
  const hi = Math.max(...real), lo = Math.min(...real);
  const span = hi - lo || 1;
  const n = pts.length;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1);
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  // Break the line where the filer tagged nothing rather than drawing through
  // a quarter that does not exist.
  const segs: string[] = [];
  let cur: string[] = [];
  pts.forEach((v, i) => {
    if (v == null) { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; return; }
    cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length > 1) segs.push(cur.join(' '));
  const lastI = pts.reduce<number | null>((acc, v, i) => (v != null ? i : acc), null);
  const lastV = lastI != null ? pts[lastI] : null;
  const firstV = real[0];
  const up = lastV != null && lastV >= firstV;
  const stroke = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${real.length}-quarter margin trend`} style={{ display: 'block' }}>
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={1.4} opacity={0.7}
        strokeLinecap="round" strokeLinejoin="round" />)}
      {lastI != null && lastV != null && (
        <circle cx={x(lastI)} cy={y(lastV)} r={2.1} fill={stroke} />
      )}
    </svg>
  );
}

interface TableRow { label: string; note?: string; cells: Cell[]; spark?: React.ReactNode }
export function MiniTable({ head, rows }: { head: Array<{ label: string; sub?: string }>; rows: TableRow[] }) {
  const hasSpark = rows.some((r) => r.spark != null);
  const th: React.CSSProperties = {
    padding: '5px 8px', textAlign: 'right', fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
    color: 'var(--mc-text-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--mc-bg-4)',
  };
  const stick: React.CSSProperties = {
    position: 'sticky', left: 0, zIndex: 1, textAlign: 'left',
    backgroundColor: 'var(--mc-bg-1)', boxShadow: '1px 0 0 var(--mc-bg-4)',
  };
  const td: React.CSSProperties = {
    padding: '4px 8px', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap',
    color: 'var(--mc-text-1)', fontVariantNumeric: 'tabular-nums',
  };
  /** The quarter being graded, tinted down its whole column. */
  const curCol: React.CSSProperties = {
    backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)',
    boxShadow: 'inset 2px 0 0 color-mix(in srgb, var(--mc-cyan) 45%, transparent)',
  };
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
      <thead>
        <tr>
          <th style={{ ...th, ...stick }} />
          {head.map((h, i) => (
            // The first column is the quarter being graded. Marking it once,
            // in the header and down the column, means a reader never has to
            // work out which of four near-identical dates is "now".
            <th key={i} style={i === 0 ? { ...th, ...curCol, color: 'var(--mc-text-1)' } : th}>
              {h.label}
              {h.sub && <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--mc-text-4)' }}>{h.sub}</div>}
            </th>
          ))}
          {hasSpark && (
            <th style={{ ...th, textAlign: 'left', paddingLeft: 12 }}>
              TREND
              <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--mc-text-4)' }}>every quarter on file</div>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th style={{ ...td, ...stick, fontWeight: 700, color: 'var(--mc-text-2)' }}>
              {r.label}
              {r.note && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--mc-text-4)' }}> {r.note}</span>}
            </th>
            {r.cells.map((c, j) => (
              <td key={j} style={{
                ...td, color: c.color || 'var(--mc-text-1)',
                ...(j === 0 ? { ...curCol, color: c.color || 'var(--mc-text-0)', fontWeight: 700 } : null),
              }}>
                {c.pill ? <Pill kind={c.pill}>{c.text}</Pill> : c.text}
              </td>
            ))}
            {hasSpark && (
              <td style={{ ...td, textAlign: 'left', paddingLeft: 12, verticalAlign: 'middle' }}>{r.spark ?? null}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── section 1 · results vs expectations ────────────────────────────────────
/**
 * The street bullet. Built only when there is a consensus AND something to pair
 * it with on a stated basis — the estimate is the street's ADJUSTED number, so
 * silently measuring a GAAP actual against it would be exactly the basis-mixing
 * the rest of this card refuses to do. When the engine has already computed a
 * surprise we use its pairing; otherwise we need `eps_adj`.
 */
export function streetBullet(r: UsRowX): React.ReactNode | null {
  const est = num(r.eps_estimate);
  const act = num(r.eps_adj);
  const pct = num(r.eps_surprise_pct);
  if (est == null || (act == null && pct == null)) return null;
  const d = act != null ? act - est : null;
  const verdict: 'beat' | 'missed' | 'in-line' =
    d != null
      ? (Math.abs(d) <= 0.005 ? 'in-line' : d > 0 ? 'beat' : 'missed')
      : (pct == null || Math.abs(pct) < 0.5 ? 'in-line' : pct > 0 ? 'beat' : 'missed');
  const basis = r.eps_basis ? String(r.eps_basis) : (act != null ? 'adjusted' : 'street');
  // Below a dime of estimate a percentage surprise is noise dressed as signal
  // (a two-cent beat on a $0.00 consensus reads as +5,888%), so it is stated in
  // cents only — the same rule the collapsed card's chip uses.
  const nearZero = Math.abs(est) < 0.1;
  const tail = d != null
    ? `$${Math.abs(d).toFixed(2)}${(!nearZero && pct != null) ? ` (${Math.abs(pct).toFixed(0)}%)` : ''}`
    : `${Math.abs(pct as number).toFixed(0)}%`;
  // The minus belongs OUTSIDE the currency symbol. A loss estimate written
  // "$-0.57" reads as a typo and, next to a guided range, produced the same
  // unreadable run of signs the range formatter was fixed for.
  const money = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
  return (
    <Bul>
      <V verdict={verdict} />
      {verdict === 'in-line' ? ' with' : ''} the {money(est)} street EPS estimate
      <span style={{ color: 'var(--mc-text-4)' }}> ({basis} basis)</span>
      {verdict === 'in-line' ? '.' : <> by <b style={{ color: 'var(--mc-text-0)' }}>{tail}</b>.</>}
      {act != null && <span style={{ color: 'var(--mc-text-4)' }}> Reported {money(act)}.</span>}
    </Bul>
  );
}

/**
 * The engine's own sentence about a guide ("beat the midpoint of its own guide
 * by 3.3%"), printed verbatim with its first word — which is always the verdict
 * — lifted into colour. Highlighting the token inside the sentence is what the
 * write-ups we are competing with do, and it avoids the "Beat … beat" stutter
 * that a separate verdict chip in front of the same sentence produces.
 */
export function HiText({ text, verdict }: { text: string; verdict: 'beat' | 'missed' | 'in-line' | null }) {
  const i = text.indexOf(' ');
  const head = i > 0 ? text.slice(0, i) : text;
  const rest = i > 0 ? text.slice(i) : '';
  const c = verdict === 'beat' ? 'var(--mc-bullish)'
    : verdict === 'missed' ? 'var(--mc-bearish)' : IN_LINE_COLOR;
  return <><b style={{ color: c }}>{head}</b>{rest}</>;
}

const GUIDE_LABEL = (metric: string): string =>
  (GUIDE_METRIC_LABEL as Record<string, string>)[metric] || String(metric).replace(/_/g, ' ');
/** Lower-case a metric label for mid-sentence use, but never an acronym:
 *  "Revenue" → "revenue", "EPS" stays "EPS", "EBITDA" stays "EBITDA". */
const midSentence = (s: string): string => /^[A-Z][a-z]+(?: [a-z]+)*$/.test(s) ? s.toLowerCase() : s;

/** One "vs its own guide" bullet. `compare.text` is written by the engine
 *  ("beat the midpoint of its own guide by 3.3%") and is used verbatim — its
 *  first word is the verdict, so it is the token we highlight. */
export function guideBullets(items: GuidedItem[] | undefined | null, scope: string): React.ReactNode[] {
  if (!Array.isArray(items)) return [];
  const out: React.ReactNode[] = [];
  for (const g of items) {
    const txt = g?.compare?.text;
    if (!txt) continue;
    const basis = g.basis === 'adjusted' ? 'adj.' : g.basis === 'gaap' ? 'GAAP' : null;
    out.push(
      <Bul key={`${scope}-${g.metric}-${g.guided_on}`}>
        <b style={{ color: 'var(--mc-text-0)' }}>{GUIDE_LABEL(g.metric)}</b>
        {basis && <span style={{ color: 'var(--mc-text-4)' }}> ({basis})</span>}
        {g.guided_for_label ? <span style={{ color: 'var(--mc-text-4)' }}> · {g.guided_for_label}</span> : null}
        {' — '}<HiText text={txt} verdict={g.compare?.verdict ?? null} />
        {g.guide_low != null && g.guide_high != null && (
          <span style={{ color: 'var(--mc-text-4)' }}>
            {' '}(guided {fmtGuideRange({ low: g.guide_low, high: g.guide_high, unit: guideUnit(g.unit) })}
            {g.actual != null ? `, came in ${fmtGuideRange({ low: g.actual, high: g.actual, unit: guideUnit(g.unit) })}` : ''})
          </span>
        )}
      </Bul>,
    );
  }
  return out;
}

const guideUnit = (u: string | null | undefined): GuidanceFigure['unit'] =>
  u === 'pct' ? 'pct' : u === 'usd_share' ? 'usd_share' : 'usd';

// ── section 2 · guide vs expectations ──────────────────────────────────────
const DIRECTION_VERB: Record<GuideChange['direction'], string> = {
  raised: 'Raised', lowered: 'Lowered', reiterated: 'Reiterated',
  narrowed: 'Narrowed', widened: 'Widened',
};

export function guideChangeBullet(g: GuideChange, est: number | null): React.ReactNode {
  const verb = DIRECTION_VERB[g.direction] || 'Changed';
  const good = g.direction === 'raised' ? true : g.direction === 'lowered' ? false : null;
  const unit = guideUnit(g.unit);
  const period = g.period_label || 'the next period';
  const basis = g.basis === 'adjusted' ? 'adj. ' : g.basis === 'gaap' ? 'GAAP ' : '';
  const dp = num(g.delta_pct);
  const showDelta = dp != null && g.direction !== 'reiterated' && Math.abs(dp) >= 0.05;
  const mid = (num(g.new_low) != null && num(g.new_high) != null)
    ? ((g.new_low as number) + (g.new_high as number)) / 2 : null;
  // The verdict is decided by CONTAINMENT, not by the midpoint: a range that
  // brackets consensus is in line with the street, however its midpoint falls.
  // The midpoint gap is still printed for an out-of-range guide, because that
  // is the size of the surprise — but only off a positive consensus, since a
  // percentage gap measured against a zero or negative estimate is meaningless.
  const vs = guideVsStreet(g.new_low, g.new_high, est);
  const midDiff = (est != null && est > 0 && mid != null) ? ((mid - est) / est) * 100 : null;
  const vsStreet: React.ReactNode = est == null || vs == null ? null : (
    <span style={{ color: 'var(--mc-text-4)' }}>
      {' '}Street had {fmtGuideRange({ low: est, high: est, unit })} —{' '}
      <b style={{ color: vs.color }}>{vs.glyph} {vs.word}</b>
      {vs.stance === 'in-line'
        ? (num(g.new_low) !== num(g.new_high)
          ? ': the estimate sits inside the guided range.'
          : ': the guide and the estimate are the same number to within half a percent.')
        : midDiff != null
          ? <>, midpoint <b style={{ color: vs.color }}>{midDiff >= 0 ? '+' : '−'}{Math.abs(midDiff).toFixed(1)}%</b>{' '}
            {midDiff >= 0 ? 'above' : 'below'} it.</>
          : ' — a percentage gap off a non-positive estimate would be meaningless, so the two are shown side by side only.'}
    </span>
  );
  return (
    <Bul key={`${g.metric}-${g.period_label}-${g.direction}`}>
      <b style={{ color: good == null ? 'var(--mc-text-1)' : good ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{verb}</b>
      {' '}the <b style={{ color: 'var(--mc-text-0)' }}>{period} {basis}{midSentence(GUIDE_LABEL(g.metric))}</b> guide
      {showDelta ? <> by <b style={{ color: 'var(--mc-text-0)' }}>{Math.abs(dp as number).toFixed(1)}%</b></> : null}
      {num(g.new_low) != null && num(g.new_high) != null && (
        <> to <b style={{ color: 'var(--mc-text-0)' }}>{fmtGuideRange({ low: g.new_low, high: g.new_high, unit })}</b></>
      )}
      {/* "…to $21%–22% from $21%–22%" is noise on a reiteration; the prior
          range only earns its space when it actually differs. */}
      {num(g.prev_low) != null && num(g.prev_high) != null
        && !(g.prev_low === g.new_low && g.prev_high === g.new_high) && (
        <span style={{ color: 'var(--mc-text-4)' }}> from {fmtGuideRange({ low: g.prev_low, high: g.prev_high, unit })}</span>
      )}
      .{vsStreet}
    </Bul>
  );
}

/** The street's number for the period/metric a guide change refers to, taken
 *  from the guidance-figure list the engine already matched. Basis must agree
 *  when both sides state one — an adjusted guide is not measured against a GAAP
 *  consensus. */
export function estFor(figs: Array<GuidanceFigure & { est?: number | null }> | null | undefined, g: GuideChange): number | null {
  if (!Array.isArray(figs)) return null;
  const hit = figs.find((f) =>
    f && f.metric === g.metric && f.period_label === g.period_label
    && (g.basis == null || f.basis == null || f.basis === g.basis));
  return hit ? num(hit.est) : null;
}

/**
 * The one honest line that goes where the guidance block would be.
 *
 * Affirm publishes its outlook only inside a shareholder letter filed as a
 * stack of JPEGs — there is no text in it to find — and the card used to show
 * exactly what a company that gave no outlook at all shows: nothing. The reader
 * cannot tell those apart, and they are opposite facts.
 */
export function guidanceAbsentLine(r: UsRowX): React.ReactNode {
  const url = r.guidance_absent_doc_url || null;
  const label = r.guidance_absent_doc_label || 'document';
  switch (r.guidance_absent_reason) {
    case 'unreadable-format':
      return (
        <>
          No outlook shown here because the company published it in a format this engine cannot read — its{' '}
          <b>{label}</b> carries no extractable text (it is filed as images, or as a PDF). The outlook may well be
          in it; open it and read it yourself.
          {url && <> · <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>open the {label} ↗</a></>}
        </>
      );
    case 'none-given':
      return <>The release was readable and states no forward-looking figures: <b>the company gave no outlook</b>.</>;
    case 'release-unavailable':
      return <>The earnings release could not be retrieved from EDGAR, so nothing can be said about an outlook either way.</>;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHOWING THE QUADRANT'S WORK
//
// The badge is a claim. This is the arithmetic behind it: every component that
// actually contributed, the points it earned and the points that were on offer,
// in two columns so the two axes are never read as one score. A component the
// filing did not support is not listed at all — the score is the points earned
// as a share of the points ASSESSABLE (see `quadrantScore`), so listing a
// missing component as "0 of 30" would misdescribe both the number and the
// company. The denominators shown are therefore the real ones.
// ═══════════════════════════════════════════════════════════════════════════

type QPart = { label: string; points: number; of: number };

function QuadrantColumn({ title, note, parts, score, color }: {
  title: string; note: string; parts: QPart[]; score: number | null; color: string;
}) {
  const of = parts.reduce((s, p) => s + p.of, 0);
  const got = parts.reduce((s, p) => s + p.points, 0);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: 'var(--mc-text-3)' }}>{title}</span>
        <b style={{ fontSize: 15, color, fontVariantNumeric: 'tabular-nums' }}>{score ?? '—'}</b>
        <span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>/100</span>
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', lineHeight: 1.45, marginBottom: 5 }}>{note}</div>
      {parts.length === 0 ? (
        <Quiet>
          The filing supported none of this axis&apos;s components, so it was not scored and the row
          leans on the other axis.
        </Quiet>
      ) : (
        <>
          {parts.map((p, i) => {
            const frac = p.of > 0 ? Math.max(0, Math.min(1, p.points / p.of)) : 0;
            return (
              <div key={`${p.label}-${i}`} style={{
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 44px 52px',
                gap: 6, alignItems: 'center', fontSize: 10.5, lineHeight: 1.7, minWidth: 0,
              }}>
                <span style={{ color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.label}
                </span>
                <span style={{ height: 4, borderRadius: 2, backgroundColor: 'var(--mc-bg-4)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${frac * 100}%`, backgroundColor: color }} />
                </span>
                <span style={{
                  textAlign: 'right', color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums', fontSize: 10,
                }}>
                  <b style={{ color: 'var(--mc-text-1)' }}>{p.points}</b> of {p.of}
                </span>
              </div>
            );
          })}
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 44px 52px', gap: 6,
            fontSize: 10, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--mc-bg-4)',
            color: 'var(--mc-text-3)', fontWeight: 700,
          }}>
            <span>assessable total</span><span />
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ color }}>{Math.round(got * 10) / 10}</b> of {of}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function QuadrantBlock({ r }: { r: UsRowX }) {
  const q = r.quadrant as EarningsQuadrant | undefined | null;
  if (!q || !QUADRANT_META[q]) return null;
  const m = QUADRANT_META[q];
  const parts = r.quadrant_parts || null;
  const qp: QPart[] = Array.isArray(parts?.quality) ? parts!.quality : [];
  const ip: QPart[] = Array.isArray(parts?.inflection) ? parts!.inflection : [];
  return (
    <>
      <PanelH note="what the business IS, against what it is BECOMING — two scores, never averaged">
        QUALITY × INFLECTION
      </PanelH>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: m.color }}>{m.icon} {q}</span>
        <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)', lineHeight: 1.5, flex: 1, minWidth: 160 }}>
          {m.tagline}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <QuadrantColumn title="QUALITY" score={num(r.quality_score)} parts={qp} color="#22D3EE"
          note="Return on capital, cash conversion, the LEVEL of margin, whether it makes money at all." />
        <QuadrantColumn title="INFLECTION" score={num(r.inflection_score)} parts={ip} color="#8B5CF6"
          note="Growth, the CHANGE in margin, the direction of the guide, distance travelled toward profit." />
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', marginTop: 6, lineHeight: 1.5 }}>
        Each score is the points earned as a share of the points that were <b>assessable</b>, so a filing with no
        cash-flow statement is judged on what it did report rather than penalised for the gap. A component the
        filing did not support is not listed and is not counted in either total. The quadrant never promotes the
        tier above.
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTUAL → GUIDED → IMPLIED
//
// The owner's concern, verbatim: "'Path to profitability' ≠ profitability.
// Management saying H2 EBITDA positive and >30% gross margin is forward
// evidence, not current financial quality." The panel used to let a guided
// figure and a reported figure sit at the same visual weight, which lets a
// management target read as an achievement. The three are now separated by an
// explicit band each, in that order, and each band states what KIND of number
// is inside it before the first number appears.
//
//   ACTUAL   what the filing reports.        Full weight, cyan, the default.
//   GUIDED   what management SAYS will       Amber, dashed rule, attributed to
//            happen.                         a named source and a stated date.
//   IMPLIED  what the guide implies          Violet, dotted rule; every figure
//            arithmetically IF it is met.    is derived on-screen from numbers
//                                            already on this row.
// ═══════════════════════════════════════════════════════════════════════════

const BAND_STYLE: Record<'actual' | 'guided' | 'implied', {
  color: string; border: string; kicker: string; blurb: string;
}> = {
  actual: {
    color: 'var(--mc-cyan)', border: 'solid', kicker: 'ACTUAL',
    blurb: 'What the filing reports — figures the company has already delivered and filed.',
  },
  guided: {
    color: '#F59E0B', border: 'dashed', kicker: 'GUIDED',
    blurb: 'What MANAGEMENT SAYS WILL HAPPEN. A statement of intent, not a result — '
      + 'nothing below has been earned yet.',
  },
  implied: {
    color: '#8B5CF6', border: 'dotted', kicker: 'IMPLIED',
    blurb: 'What the guide above implies ARITHMETICALLY if it is met exactly. '
      + 'Consequences of management’s own numbers, not a forecast of ours.',
  },
};

/**
 * A band header. Deliberately heavier than a `PanelH`: the whole point is that a
 * reader scrolling the panel cannot cross from a reported number into a promised
 * one without passing a rule that says so.
 */
export function Band({ kind, source }: {
  kind: 'actual' | 'guided' | 'implied';
  /** Who said it and when — required by GUIDED, so a management statement is
   *  never anonymous. Rendered only when the row actually carries it. */
  source?: React.ReactNode;
}) {
  const b = BAND_STYLE[kind];
  return (
    <div style={{
      margin: '16px 0 8px', paddingLeft: 9,
      borderLeft: `3px ${b.border} ${b.color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, color: b.color,
        }}>{b.kicker}</span>
        <span style={{ fontSize: 10, color: 'var(--mc-text-3)', lineHeight: 1.5, flex: 1, minWidth: 180 }}>
          {b.blurb}
        </span>
      </div>
      {source && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.5, marginTop: 3 }}>{source}</div>
      )}
    </div>
  );
}

// ── the implied arithmetic ─────────────────────────────────────────────────
//
// EVERY figure below is computed from data already on the row: a guided range
// from `guidance_figures`, and reported quarters from `series`. Nothing is
// modelled, extrapolated or assumed. Where the guide does not support a
// calculation — no full-year revenue guide, a fiscal quarter we cannot place,
// a prior-year base that is zero or negative, a series with a gap in it — the
// item is simply absent. That is the whole discipline of this section: an
// implied number we cannot derive is not shown, ever.

type Fig = GuidanceFigure & { est?: number | null };

/** The midpoint of a guided range, or the single value of a one-sided guide. */
function figMid(f: Fig): number | null {
  const lo = num(f.low), hi = num(f.high);
  if (lo != null && hi != null) return (lo + hi) / 2;
  return lo ?? hi;
}

/** Guidance figures are stated in ABSOLUTE dollars; `series` is in $M. */
const usdToM = (v: number): number => v / 1e6;

/** The fiscal quarter number a label like "Q3 FY26" states, or null. A label
 *  that does not name a quarter cannot be placed on the calendar, and every
 *  calculation that needs the position is skipped rather than guessed. */
function fiscalQnum(label: string | null | undefined): number | null {
  const m = /\bQ([1-4])\b/i.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
}
/** The fiscal-year token of a label ("FY26" → "26", "Q3 FY26" → "26"). Used
 *  ONLY to check that a full-year guide is for the same year as the reported
 *  quarter — never to derive a calendar. */
function fiscalYtoken(label: string | null | undefined): string | null {
  const m = /\b(?:FY|CY)\s?['’]?(\d{2,4})\b/i.exec(String(label ?? ''));
  return m ? m[1].slice(-2) : null;
}

/**
 * Consecutive reported quarters walking BACK from the newest, matched by DATE.
 *
 * Index arithmetic alone would be wrong: filers skip periods, and "four back in
 * the array" is only sometimes a year. The chain stops the moment the next step
 * cannot be matched within tolerance, so a filer with a hole in its history
 * yields a SHORT chain and the calculations that needed the missing quarter are
 * skipped — never silently computed off the wrong period.
 */
export function quarterChain(ends: string[], want: number): number[] {
  const out: number[] = [];
  let i = ends.length - 1;
  while (i >= 0 && out.length < want) {
    out.push(i);
    if (out.length >= want) break;
    const p = backFrom(ends, i, 91, 30);
    if (p == null) break;
    i = p;
  }
  return out;
}

/** Sum of a series across the given indices — null if ANY of them is missing,
 *  because a partial sum compared against a whole-year guide is a lie. */
function sumAt(arr: unknown, idxs: number[]): number | null {
  let t = 0;
  for (const i of idxs) {
    const v = at(arr, i);
    if (v == null) return null;
    t += v;
  }
  return t;
}

export interface ImpliedItem {
  key: string;
  label: string;
  value: string;
  color?: string;
  /** The derivation, in words, naming both sides of the arithmetic. */
  note: React.ReactNode;
}

/**
 * Everything the guide implies that this row's own numbers can actually
 * establish. Returns [] when the guide supports nothing — the caller renders
 * no section at all in that case.
 */
export function impliedFromGuide(r: UsRowX): ImpliedItem[] {
  const figs: Fig[] = Array.isArray(r.guidance_figures) ? r.guidance_figures : [];
  if (!figs.length) return [];
  const s = normSeries(r.series);
  const out: ImpliedItem[] = [];
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const dirColor = (v: number) => v >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)';

  // The chain of reported quarters behind the guide. Eight is what the
  // rest-of-year comparison needs at most; a shorter chain simply disables the
  // items that would have used its tail.
  const chain = s ? quarterChain(s.ends, 8) : [];
  const revM = (i: number) => (s ? at(s.revenue, i) : null);

  const curQ = fiscalQnum(r.quarter);
  const curY = fiscalYtoken(r.quarter);

  // ── 1 · the NEXT quarter's guide against the quarter it will be compared to
  // Only when the guided quarter is provably the one AFTER the reported one:
  // the fiscal quarter numbers must be adjacent modulo four. Otherwise we do
  // not know which reported quarter is its year-ago base.
  // A REVENUE GUIDE IS NOT ALWAYS A DOLLAR FIGURE. Plenty of filers guide the
  // GROWTH RATE instead ("revenue growth of 34% to 37%"), which the extractor
  // correctly tags as metric `revenue` with unit `pct`. Dividing that 34 into a
  // dollar base would produce a number with no meaning at all, so every revenue
  // figure used below the line must state `usd` — a percentage guide simply
  // yields no implied figure, which is the honest outcome: the growth rate IS
  // the guide, and there is nothing left to imply from it.
  const qRev = figs.find((f) => f.metric === 'revenue' && f.unit === 'usd'
    && f.period === 'quarter' && figMid(f) != null);
  if (qRev && curQ != null && chain.length >= 4) {
    const gq = fiscalQnum(qRev.period_label);
    if (gq != null && ((gq - curQ + 4) % 4) === 1) {
      // Guided Q(n+1); its year-ago comparable is Q(n−3) = the fourth link back.
      const base = revM(chain[3]);
      const mid = usdToM(figMid(qRev) as number);
      if (base != null && base > 0) {
        const g = (mid / base - 1) * 100;
        out.push({
          key: 'q-rev-growth',
          label: `Implied ${qRev.period_label} revenue growth`,
          value: pct(g), color: dirColor(g),
          note: <>Guide midpoint <b>{fmtUsdCell(mid)}</b> against <b>{fmtUsdCell(base)}</b> reported in the
            year-ago quarter ({s!.ends[chain[3]]}).</>,
        });
      }
    }
  }

  // ── 2 · the full-year revenue guide against the last twelve months ACTUAL
  // Stated against the trailing twelve months rather than against "last fiscal
  // year", because the trailing twelve months is a period we can build from the
  // filings themselves — no fiscal calendar has to be assumed for it.
  const yRev = figs.find((f) => f.metric === 'revenue' && f.unit === 'usd'
    && f.period === 'year' && figMid(f) != null);
  const ttm = chain.length >= 4 && s ? sumAt(s.revenue, chain.slice(0, 4)) : null;
  if (yRev && ttm != null && ttm > 0) {
    const mid = usdToM(figMid(yRev) as number);
    const g = (mid / ttm - 1) * 100;
    out.push({
      key: 'fy-rev-vs-ttm',
      label: `Implied ${yRev.period_label} revenue vs. the last twelve months`,
      value: pct(g), color: dirColor(g),
      note: <>Guide midpoint <b>{fmtUsdCell(mid)}</b> against <b>{fmtUsdCell(ttm)}</b> of revenue actually
        reported over the four quarters to {s!.ends[chain[0]]}.</>,
    });
  }

  // ── 3 · what the full-year guide leaves for the REST of the year
  // The single most load-bearing implied figure there is: a company two
  // quarters into its year has already banked part of the guide, and what is
  // left is the part still to be earned. Requires the guide to be for the SAME
  // fiscal year the reported quarter belongs to (otherwise the year-to-date sum
  // is not a component of it) and a chain long enough to build both sides.
  if (yRev && curQ != null && curQ < 4 && s
    && curY != null && fiscalYtoken(yRev.period_label) === curY
    && chain.length >= Math.max(curQ, 4)) {
    const ytd = sumAt(s.revenue, chain.slice(0, curQ));
    const mid = usdToM(figMid(yRev) as number);
    // The same quarters of the PRIOR year: Q(n+1)…Q4 of last year are links
    // curQ…3 of the chain, because link curQ is last year's Q4.
    const priorRest = sumAt(s.revenue, chain.slice(curQ, 4));
    if (ytd != null) {
      const rest = mid - ytd;
      const g = (priorRest != null && priorRest > 0) ? (rest / priorRest - 1) * 100 : null;
      out.push({
        key: 'fy-rest',
        label: `Implied revenue still to come in ${yRev.period_label}`,
        value: fmtUsdCell(rest), color: rest < 0 ? 'var(--mc-bearish)' : undefined,
        note: <>Guide midpoint <b>{fmtUsdCell(mid)}</b> less <b>{fmtUsdCell(ytd)}</b> already reported in
          Q1–Q{curQ}{g != null && <> — <b style={{ color: dirColor(g) }}>{pct(g)}</b> against
          the <b>{fmtUsdCell(priorRest as number)}</b> those same quarters produced a year ago</>}.</>,
      });
      // ── 3b · the exit run-rate, but ONLY when a single quarter is left.
      // With two or more quarters outstanding, annualising the remainder is a
      // guess about how it splits between them — so it is not offered.
      if (curQ === 3 && rest > 0) {
        out.push({
          key: 'exit-runrate',
          label: 'Implied exit run-rate',
          value: `${fmtUsdCell(rest * 4)}/yr`,
          note: <>The one quarter the guide leaves, <b>{fmtUsdCell(rest)}</b>, at an annual rate. A
            consequence of the guide being met exactly — not a forecast, and not a claim about next year.</>,
        });
      }
    }
  }

  // ── 4 · margins the guide implies, by pairing two guided lines
  // Only the SAME period and the SAME basis: an adjusted EBITDA guide over a
  // GAAP revenue guide is not a margin anybody reports.
  const MARGIN_OF: Array<[GuidanceFigure['metric'], string]> = [
    ['operating_income', 'operating margin'], ['ebitda', 'EBITDA margin'],
    ['net_income', 'net margin'], ['free_cash_flow', 'free-cash-flow margin'],
  ];
  for (const [metric, name] of MARGIN_OF) {
    for (const inc of figs) {
      if (inc.metric !== metric) continue;
      const im = figMid(inc);
      if (im == null || inc.unit !== 'usd') continue;
      const rev = figs.find((f) => f.metric === 'revenue' && f.unit === 'usd'
        && f.period_label === inc.period_label && f.basis === inc.basis && figMid(f) != null);
      if (!rev) continue;
      const rm = figMid(rev) as number;
      if (!(rm > 0)) continue;
      const marg = (im / rm) * 100;
      const basisWord = inc.basis === 'adjusted' ? 'adjusted ' : '';
      out.push({
        key: `margin-${metric}-${inc.period_label}`,
        label: `Implied ${inc.period_label} ${basisWord}${name}`,
        value: `${marg.toFixed(1)}%`, color: marg >= 0 ? undefined : 'var(--mc-bearish)',
        note: <>The guided {basisWord}{midSentence(GUIDE_LABEL(metric))} midpoint
          {' '}<b>{fmtUsdCell(usdToM(im))}</b> over the guided revenue midpoint
          {' '}<b>{fmtUsdCell(usdToM(rm))}</b> for the same period.</>,
      });
      break;                                    // one implied margin per metric
    }
  }

  // ── 5 · what the EPS guide implies against the quarter it will be compared to
  // Refused outright when the engine has said the two periods are not on the
  // same share count — an EPS growth rate across a split it could not size is
  // exactly the number `eps_compare_blocked` exists to suppress.
  const qEps = figs.find((f) => f.metric === 'eps' && f.period === 'quarter'
    && f.unit === 'usd_share' && figMid(f) != null);
  if (qEps && curQ != null && chain.length >= 4 && s && !(r as any).eps_compare_blocked) {
    const gq = fiscalQnum(qEps.period_label);
    const base = at(s.eps, chain[3]);
    if (gq != null && ((gq - curQ + 4) % 4) === 1 && base != null && base > 0) {
      const mid = figMid(qEps) as number;
      const g = (mid / base - 1) * 100;
      out.push({
        key: 'q-eps-growth',
        label: `Implied ${qEps.period_label} ${qEps.basis === 'adjusted' ? 'adj. ' : ''}EPS growth`,
        value: pct(g), color: dirColor(g),
        note: <>Guide midpoint <b>${mid.toFixed(2)}</b> against <b>${base.toFixed(2)}</b> reported in the
          year-ago quarter ({s.ends[chain[3]]}).</>,
      });
    }
  }

  return out;
}

export function ImpliedBlock({ items }: { items: ImpliedItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it) => (
        <div key={it.key} style={{
          borderRadius: 6, border: '1px dotted color-mix(in srgb, #8B5CF6 55%, transparent)',
          backgroundColor: 'var(--mc-bg-1)', padding: '6px 9px', minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--mc-text-3)' }}>{it.label}</span>
            <b style={{ fontSize: 14, color: it.color || 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
              {it.value}
            </b>
            <span style={{
              fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, padding: '1px 5px', borderRadius: 3,
              color: '#8B5CF6', backgroundColor: 'color-mix(in srgb, #8B5CF6 14%, transparent)',
            }}>IF THE GUIDE IS MET</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.5, marginTop: 2 }}>{it.note}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export function DetailPanel({ r }: { r: UsRowX }) {
  const s = normSeries(r.series);
  const cols = s ? buildCols(s, r.quarter) : null;
  const ctx = (r.context || null) as UsContext | null;
  const vg = (r.vs_guide || null) as VsGuide | null;
  const changes: GuideChange[] = Array.isArray(r.guide_change) ? r.guide_change : [];
  const figs = Array.isArray(r.guidance_figures) ? r.guidance_figures : [];
  const metrics: KeyMetric[] = (Array.isArray(r.key_metrics) ? r.key_metrics : [])
    .filter((m) => m && Number.isFinite(m.value));
  const snippets: string[] = Array.isArray(r.guidance_snippets) ? r.guidance_snippets : [];
  const tags = (r.tags_used || null) as Record<string, string | null> | null;

  // ── the display columns. A period we could not match by date is not shown at
  // all, rather than shown as a column of dashes.
  const displayCols = cols ? [cols.cur, cols.prev, cols.yr, cols.yr3].filter(Boolean) as PanelCol[] : [];
  const head = displayCols.map((c) => ({ label: c.label, sub: c.sub }));
  const growthHead: Array<{ label: string; sub?: string }> = [];
  if (cols?.prev) growthHead.push({ label: 'QoQ' });
  if (cols?.yr) growthHead.push({ label: 'YoY' });
  if (cols?.yr3) growthHead.push({ label: '3-YR CAGR' });

  const seriesRow = (label: string, arr: unknown, note?: string): TableRow | null => {
    if (!s || !cols) return null;
    const vals = displayCols.map((c) => at(arr, c.idx));
    if (vals.every((v) => v == null)) return null;         // no row of dashes
    const cur = at(arr, cols.cur.idx);
    const cells: Cell[] = vals.map(usdCell);
    if (cols.prev) cells.push(growthCell(cur, at(arr, cols.prev.idx)));
    if (cols.yr) cells.push(growthCell(cur, at(arr, cols.yr.idx)));
    if (cols.yr3) cells.push(cagrCell(cur, at(arr, cols.yr3.idx), cols.yr3GapDays));
    // The whole series behind the four columns, so the shape of the last three
    // years is visible at a glance instead of having to be reconstructed from
    // three growth rates.
    const full = Array.isArray(arr) ? (arr as Array<number | null>).map(num) : [];
    return { label, note, cells, spark: full.length >= 3 ? <Spark values={full} /> : undefined };
  };

  const resultRows: TableRow[] = [];
  if (s && cols) {
    for (const [label, arr] of [
      ['Revenue', s.revenue], ['Gross profit', s.gross_profit],
      ['Operating income', s.operating_income], ['Net income', s.net_income],
      ['Free cash flow', s.fcf],
    ] as Array<[string, unknown]>) {
      const row = seriesRow(label, arr, 'GAAP');
      if (row) resultRows.push(row);
    }
    // Press-release operating metrics that carry a genuinely comparable figure
    // — a dollar value AND the YoY the company itself stated. There is no
    // quarterly history behind them (they exist only in the release), so the
    // periods we cannot fill stay empty and the row says where it came from.
    for (const m of metrics) {
      if (resultRows.length >= 9) break;
      if (!m || m.unit !== 'usd' || num(m.yoy_pct) == null || !Number.isFinite(m.value)) continue;
      if (m.id === 'free_cash_flow' && resultRows.some((x) => x.label === 'Free cash flow')) continue;
      const cells: Cell[] = displayCols.map((c, i) => i === 0 ? { text: fmtKeyMetric(m) } : DASH);
      if (cols.prev) cells.push(DASH);
      if (cols.yr) {
        const y = num(m.yoy_pct) as number;
        cells.push({ text: signedPct(y), pill: y >= 0 ? 'up' : 'down' });
      }
      if (cols.yr3) cells.push(DASH);
      resultRows.push({ label: m.label || KEY_METRIC_LABEL[m.id] || m.id, note: 'rel.', cells });
    }
  }

  // ── margins. Each is a % of the same period's revenue; the deltas are basis
  // points, because a margin move is a percentage-POINT move and calling it "%"
  // is a different (and wrong) number.
  const marginRows: TableRow[] = [];
  if (s && cols) {
    const revAt = (i: number) => at(s.revenue, i);
    const mk = (label: string, arr: unknown): TableRow | null => {
      const vals = displayCols.map((c) => marginPct(at(arr, c.idx), revAt(c.idx)));
      if (vals.every((v) => v == null)) return null;
      const cur = marginPct(at(arr, cols.cur.idx), revAt(cols.cur.idx));
      const cells: Cell[] = vals.map(pctCell);
      if (cols.prev) cells.push(bpsCell(cur, marginPct(at(arr, cols.prev.idx), revAt(cols.prev.idx))));
      if (cols.yr) cells.push(bpsCell(cur, marginPct(at(arr, cols.yr.idx), revAt(cols.yr.idx))));
      if (cols.yr3) cells.push(bpsCell(cur, marginPct(at(arr, cols.yr3.idx), revAt(cols.yr3.idx))));
      // A margin is a level, so its trend is a line, not bars — and it is drawn
      // over every quarter on file so "expanding" or "rolling over" is visible
      // rather than inferred from three basis-point deltas.
      const full = (s.ends || []).map((_, i) => marginPct(at(arr, i), revAt(i)));
      return { label, cells, spark: full.filter((v) => v != null).length >= 3 ? <SparkLine values={full} /> : undefined };
    };
    for (const [label, arr] of [
      ['Gross margin', s.gross_profit], ['Operating margin', s.operating_income],
      ['Net margin', s.net_income], ['FCF margin', s.fcf],
    ] as Array<[string, unknown]>) {
      const row = mk(label, arr);
      if (row) marginRows.push(row);
    }
  }

  // ── 3-yr revenue CAGR, and the same figure one and two quarters ago. The
  // trend in the CAGR is the thing worth reading; a single CAGR is not.
  const cagrTrend = (() => {
    if (!s || !cols) return null;
    const val = (idx: number): number | null => {
      const j = backFrom(s.ends, idx, 1095, 60);
      if (j == null) return null;
      const a = at(s.revenue, idx), b = at(s.revenue, j);
      if (a == null || b == null || a <= 0 || b <= 0) return null;
      const p = (Math.pow(a / b, 1 / 3) - 1) * 100;
      return Number.isFinite(p) ? p : null;
    };
    const now = val(cols.cur.idx);
    if (now == null) return null;
    const pIdx = cols.prev?.idx ?? null;
    const p1 = pIdx != null ? val(pIdx) : null;
    const p2Idx = pIdx != null ? backFrom(s.ends, pIdx, 91, 30) : null;
    const p2 = p2Idx != null ? val(p2Idx) : null;
    return { now, p1, p2 };
  })();

  // ── stock comp as a share of revenue and of free cash flow. Both only off a
  // positive base: SBC "as 210% of a negative FCF" is not a quality signal, it
  // is a sign error.
  const sbc = ctx ? num(ctx.sbc_musd) : null;
  const revNow = num(r.revenue_curr_musd) ?? (s && cols ? at(s.revenue, cols.cur.idx) : null);
  const fcfNow = (s && cols ? at(s.fcf, cols.cur.idx) : null) ?? num(r.fcf_curr_musd);
  const sbcOfRev = (sbc != null && revNow != null && revNow > 0) ? (sbc / revNow) * 100 : null;
  const sbcOfFcf = (sbc != null && fcfNow != null && fcfNow > 0) ? (sbc / fcfNow) * 100 : null;

  const quarterGuideBullets = guideBullets(vg?.for_quarter, 'quarter');
  const yearGuideBullets = guideBullets(vg?.for_year, 'year');
  const street = streetBullet(r);
  const hasResultsVs = !!street || quarterGuideBullets.length > 0 || yearGuideBullets.length > 0;

  const ctxBullets: React.ReactNode[] = [];
  // A PRELIM print's balance sheet is not on EDGAR yet, so what we hold is the
  // PREVIOUS quarter's. Saying so once, at the top, is the difference between
  // a stale number and a dated one.
  const ctxStale = (() => {
    if (!ctx?.as_of || !r.period_end) return false;
    const a = Date.parse(ctx.as_of + 'T00:00:00Z'), b = Date.parse(r.period_end + 'T00:00:00Z');
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 20 * 86_400_000;
  })();
  // The flow lines (stock comp, buybacks, dividends, share count) can come from
  // a different period than the balance sheet: on a PRELIM row whose balance
  // sheet was read out of the release, the release's cash-flow statement is
  // year-to-date and usually cannot be de-cumulated, so those stay on the
  // previous quarter's XBRL. Saying so once is the difference between a dated
  // number and a stale one.
  const flowsStale = !!(ctx?.flows_as_of && ctx.as_of && ctx.flows_as_of !== ctx.as_of);
  if (ctx) {
    if (ctxStale) ctxBullets.push(
      <Bul key="stale"><span style={{ color: 'var(--mc-text-3)' }}>
        Balance sheet and capital returns below are the <b>previous</b> quarter&apos;s, at {ctx.as_of} — this
        quarter&apos;s reach EDGAR with the 10-Q.
      </span></Bul>,
    );
    if (!ctxStale && ctx.source === 'release') ctxBullets.push(
      <Bul key="relbs"><span style={{ color: 'var(--mc-text-3)' }}>
        Balance sheet below is <b>this</b> quarter&apos;s, at {ctx.as_of}, read from the condensed balance sheet in
        the earnings release — every line checked against the release&apos;s own prior-period column, which is
        already on EDGAR.
        {flowsStale && <> Capital returns and the share count are still the previous quarter&apos;s, at {ctx.flows_as_of}:
          the release&apos;s cash-flow statement is year-to-date and cannot be split into the quarter.</>}
      </span></Bul>,
    );
    const cash = num(ctx.cash_musd), debt = num(ctx.debt_musd);
    if (cash != null) {
      ctxBullets.push(
        <Bul key="cash">
          <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(cash)}</b> in cash
          {ctx.cash_incl_st_inv ? ' & equivalents, incl. short-term investments' : ' & equivalents'}
          {debt != null && <> against <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(debt)}</b> of total debt —{' '}
            <b style={{ color: cash - debt >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
              {fmtUsd(Math.abs(cash - debt))} net {cash - debt >= 0 ? 'cash' : 'debt'}
            </b></>}
          .{ctx.as_of && <span style={{ color: 'var(--mc-text-4)' }}> Balance sheet at {ctx.as_of}.</span>}
        </Bul>,
      );
    } else if (debt != null) {
      ctxBullets.push(<Bul key="debt"><b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(debt)}</b> of total debt; no cash line tagged.</Bul>);
    }
    // A zero is not a capital return. "Bought back $0K of stock" is the filer
    // tagging the line at nil, not news; the bullet is dropped instead.
    const bbRaw = num(ctx.buyback_musd), dvRaw = num(ctx.dividends_musd);
    const bb = bbRaw != null && bbRaw > 0 ? bbRaw : null;
    const dv = dvRaw != null && dvRaw > 0 ? dvRaw : null;
    if (bb != null || dv != null) {
      ctxBullets.push(
        <Bul key="return">
          {bb != null && <>Bought back <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(bb)}</b> of stock</>}
          {bb != null && dv != null ? ' and ' : ''}
          {dv != null && <>{bb == null ? 'Paid ' : 'paid '}<b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(dv)}</b> in dividends</>}
          {' '}this quarter.
        </Bul>,
      );
    }
    if (sbc != null) {
      ctxBullets.push(
        <Bul key="sbc">
          Paid out <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(sbc)}</b> in stock comp
          {sbcOfRev != null && <> — <b style={{ color: 'var(--mc-text-0)' }}>{sbcOfRev.toFixed(1)}%</b> of revenue</>}
          {sbcOfFcf != null
            ? <> and <b style={{ color: sbcOfFcf > 100 ? 'var(--mc-bearish)' : 'var(--mc-text-0)' }}>{sbcOfFcf.toFixed(0)}%</b> of free cash flow</>
            : (sbc != null && fcfNow != null && fcfNow <= 0
              ? <span style={{ color: 'var(--mc-text-4)' }}> (share of free cash flow n/m — FCF was not positive)</span>
              : null)}
          .
        </Bul>,
      );
    }
    // Free cash flow PER SHARE. The headline figure can rise while the owner's
    // claim on it falls, because the share count rose faster — which is the
    // whole point of tracking dilution beside stock comp.
    const fcfPs = (fcfNow != null && num(ctx.diluted_shares_m) != null && (ctx.diluted_shares_m as number) > 0)
      ? fcfNow / (ctx.diluted_shares_m as number) : null;
    if (fcfPs != null) {
      ctxBullets.push(
        <Bul key="fcfps">
          Free cash flow of <b style={{ color: fcfPs >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
            ${Math.abs(fcfPs).toFixed(2)}</b> per diluted share this quarter
          {num(ctx.diluted_shares_yoy_pct) != null && (ctx.diluted_shares_yoy_pct as number) > 0.5
            ? <span style={{ color: 'var(--mc-text-4)' }}> — on a share count {fmtPct(ctx.diluted_shares_yoy_pct, 1)} higher than a year ago, so the per-share claim grows more slowly than the total.</span>
            : '.'}
        </Bul>,
      );
    }
    const sh = num(ctx.diluted_shares_m), shY = num(ctx.diluted_shares_yoy_pct);
    if (sh != null || shY != null) {
      ctxBullets.push(
        <Bul key="shares">
          {sh != null && <>Diluted share count <b style={{ color: 'var(--mc-text-0)' }}>{fmtShares(sh)}</b></>}
          {shY != null && <>{sh != null ? ', ' : 'Diluted share count '}
            <b style={{ color: shY <= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(shY, 1)}</b> YoY
            {shY < 0 ? ' (shrinking)' : shY > 0 ? ' (dilution)' : ''}</>}
          .
        </Bul>,
      );
    }
  }
  if (cagrTrend) {
    ctxBullets.push(
      <Bul key="cagr">
        <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.now.toFixed(1)}%</b> 3-yr revenue CAGR
        {cagrTrend.p1 != null && <> vs. <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.p1.toFixed(1)}%</b> last Q</>}
        {cagrTrend.p2 != null && <> &amp; <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.p2.toFixed(1)}%</b> 2 Qs ago</>}
        .
      </Bul>,
    );
  }

  const box: React.CSSProperties = {
    marginTop: 9, padding: '9px 10px', borderRadius: 6,
    backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
    borderLeft: '3px solid var(--mc-cyan)', minWidth: 0, overflow: 'hidden',
  };

  // What the guide implies arithmetically. Computed from `guidance_figures` and
  // `series` only; an empty list means the guide supports no implication we can
  // derive, and the whole IMPLIED band is then absent rather than apologetic.
  const implied = impliedFromGuide(r);

  // The GUIDED band exists only when management actually said something — or
  // when the engine can say WHY it could not read what they said.
  const hasGuided = changes.length > 0 || figs.length > 0 || snippets.length > 0
    || !!r.guidance_absent_reason;
  // The source and date behind every figure in that band. A management
  // statement is never anonymous on this card.
  const guideSrcUrl = r.guidance_url || r.release_url || r.filing_url || null;

  return (
    <div style={box}>
      {/* ── 0 · the second axis, and its arithmetic ── */}
      <QuadrantBlock r={r} />

      {/* ══ ACTUAL ══ */}
      <Band kind="actual" />

      {/* ── 1 · results vs expectations ── */}
      <PanelH note="the street, and the company's own guide from last quarter">RESULTS VS. EXPECTATIONS</PanelH>
      {hasResultsVs ? (
        <>
          {street}
          {quarterGuideBullets}
          {yearGuideBullets}
          {vg?.prior_filing_date && (
            <Quiet>
              Guide read from the {vg.prior_filing_date} release
              {vg.prior_filing_url && <> · <a href={vg.prior_filing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>open it ↗</a></>}
            </Quiet>
          )}
        </>
      ) : (
        <Quiet>
          No street estimate and no prior guide on file for this quarter, so there is nothing to measure the
          print against. The tiles above are the filing&apos;s own numbers versus the year-ago quarter.
        </Quiet>
      )}
      {(r.d1_pct != null || r.move_pct != null) && (
        <Quiet>
          Market&apos;s verdict:{' '}
          <b style={{ color: (r.d1_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.d1_pct, 1)}</b> on the day,{' '}
          <b style={{ color: (r.move_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.move_pct, 1)}</b> since the print.
        </Quiet>
      )}

      {/* ── 3 · results table ── */}
      {resultRows.length > 0 && displayCols.length > 0 && (
        <>
          <PanelH note={`${displayCols.length} period${displayCols.length === 1 ? '' : 's'} matched by period-end date`}>
            RESULTS
          </PanelH>
          <Scroller><MiniTable head={[...head, ...growthHead]} rows={resultRows} /></Scroller>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 4, lineHeight: 1.5 }}>
            GAAP, from the filer&apos;s own XBRL. Rows marked <b>rel.</b> are press-release operating metrics with no
            quarterly history behind them — the YoY is the company&apos;s own. A period the filer did not tag is
            left empty; <b>n/m</b> is a growth rate whose base was zero or negative, which has no meaning.
          </div>
        </>
      )}

      {/* ── 4 · margins ── */}
      {marginRows.length > 0 && displayCols.length > 0 && (
        <>
          <PanelH note="% of revenue · deltas in basis points, not %">MARGINS</PanelH>
          <Scroller>
            <MiniTable
              head={[...head, ...([
                cols?.prev ? { label: 'QoQ BPS Δ' } : null,
                cols?.yr ? { label: 'YoY BPS Δ' } : null,
                cols?.yr3 ? { label: '3-YR BPS Δ' } : null,
              ].filter(Boolean) as Array<{ label: string }>)]}
              rows={marginRows} />
          </Scroller>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 4, lineHeight: 1.5 }}>
            100 bps = 1 percentage point. A margin is only shown where that period&apos;s revenue was positive.
          </div>
        </>
      )}

      {/* ── 5 · key context ── */}
      {ctxBullets.length > 0 && (
        <>
          <PanelH note="balance sheet, capital returned, dilution">KEY CONTEXT</PanelH>
          {ctxBullets}
        </>
      )}

      {/* ── 6 · everything the collapsed card hides ── */}
      {metrics.length > 0 && (
        <>
          <PanelH note="every figure the release stated, not just the four on the card">REPORTED OPERATING METRICS</PanelH>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {metrics.map((m, i) => (
              <div key={`${m.id}-${i}`} style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5, minWidth: 0 }}>
                <span style={{ color: 'var(--mc-text-3)' }}>{m.label || KEY_METRIC_LABEL[m.id] || m.id}</span>{' '}
                <b style={{ color: 'var(--mc-text-0)' }}>{fmtKeyMetric(m)}</b>
                {num(m.yoy_pct) != null && (
                  <b style={{ color: (m.yoy_pct as number) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                    {' '}{fmtPct(m.yoy_pct, 1)} YoY
                  </b>
                )}
                {m.source && <div style={{ fontSize: 9, color: 'var(--mc-text-4)', lineHeight: 1.4 }}>“{m.source}”</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══ GUIDED ══════════════════════════════════════════════════════════
          Everything below this rule is a MANAGEMENT STATEMENT. It is separated
          from the reported figures above by an explicit band, attributed to the
          release it was said in and dated, because "path to profitability" is
          not profitability and a target must never sit at the same visual
          weight as a result.

          The attribution below is attached only when management ACTUALLY said
          something. On a row that reaches this band solely because the engine
          can explain why it found no outlook, "said by management on …" would be
          attributing a statement that was never made. */}
      {hasGuided && (
        <Band kind="guided" source={!(changes.length || figs.length || snippets.length) ? null : (
          <>Said by management{r.filing_date ? <> on <b>{r.filing_date}</b></> : null}, in the earnings
            release for {r.quarter || 'the quarter'}
            {guideSrcUrl && <> · <a href={guideSrcUrl} target="_blank" rel="noreferrer"
              style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>read it ↗</a></>}
            . Nothing here has been earned or filed.</>
        )} />
      )}

      {(changes.length > 0 || figs.length > 0) && (
        <>
          <PanelH note="where the outlook moved, and what the street was carrying">GUIDE VS. EXPECTATIONS</PanelH>
          {changes.length > 0
            ? changes.map((g) => guideChangeBullet(g, estFor(figs, g)))
            : <Quiet>No prior guide to compare against — the figures below are this release&apos;s outlook as given.</Quiet>}
          {figs.length > 0 && <GuideBlock figs={figs} label={r.guidance} showSource />}
        </>
      )}

      {/* WHY there is no outlook. An empty guidance block reads the same whether
          the company gave no outlook or published one in a form this engine
          cannot read. Those are different facts, and this is where the
          difference is said — quietly, as a statement, not as a warning. */}
      {changes.length === 0 && figs.length === 0 && !!r.guidance_absent_reason && (
        <>
          <PanelH note="what the engine could and could not read">OUTLOOK</PanelH>
          <Quiet>{guidanceAbsentLine(r)}</Quiet>
        </>
      )}

      {snippets.length > 0 && (
        <>
          <PanelH note="verbatim, from the press release">GUIDANCE LANGUAGE</PanelH>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {snippets.map((q, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.45, borderLeft: '2px solid var(--mc-bg-4)', paddingLeft: 8 }}>“{q}”</div>
            ))}
          </div>
        </>
      )}

      {/* ══ IMPLIED ═════════════════════════════════════════════════════════
          Arithmetic consequences of the guide above, each derived on screen
          from figures already on this row. An implication the guide does not
          support is absent — the band itself does not render. */}
      {implied.length > 0 && (
        <>
          <Band kind="implied" />
          <ImpliedBlock items={implied} />
          <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', marginTop: 5, lineHeight: 1.5 }}>
            Every figure here is the guided midpoint set against a number this filer has actually reported.
            Ranges are not probabilities: the midpoint is used because it is the number management put its name
            to, and hitting it is an assumption, not an outcome.
          </div>
        </>
      )}

      {/* ── what surrounds the beat ── */}
      <SetupBlock setup={(r as any).setup} />

      {/* ── methodology, caveats and the PRELIM basis ────────────────────────
          Moved here from the collapsed card. These say HOW the grade was built
          and what it is allowed to claim — the kind of thing a reader wants once
          they have decided the name is worth reading, not while scanning a tier. */}
      {(r.methodology_tags.length > 0 || r.caveat_tags.length > 0 || !!r.prelim) && (
        <>
          <PanelH note="how this grade was built, and what it is not allowed to claim">
            METHODOLOGY &amp; CAVEATS
          </PanelH>
          {(r.methodology_tags.length > 0 || r.caveat_tags.length > 0) && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: r.prelim ? 6 : 0 }}>
              {r.methodology_tags.map((t) => <Chip key={`m-${t}`} text={t} color="#10B981" />)}
              {r.caveat_tags.map((t) => <Chip key={`c-${t}`} text={t} color="#EF4444" />)}
            </div>
          )}
          {r.prelim && (
            <Quiet>
              {Array.isArray(r.prelim_matched) && r.prelim_matched.length > 0
                ? <>Figures read from the earnings release ({r.prelim_matched.map((m) => m.replace(/_/g, ' ')).join(', ')}) and
                    checked against last year&apos;s XBRL before display. Cash flow and the full tag set arrive with the 10-Q.</>
                : <>Consensus and the price reaction only — the release&apos;s statement of operations could not be verified
                    against last year&apos;s filing, so no revenue or margin is shown.</>}
            </Quiet>
          )}
        </>
      )}

      {tags && Object.keys(tags).length > 0 && (
        <>
          <PanelH note="which XBRL concept each number was read from">TAGS USED</PanelH>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 9, color: 'var(--mc-text-4)', lineHeight: 1.6 }}>
            {Object.entries(tags).filter(([, v]) => !!v).map(([k, v]) => (
              <span key={k} style={{ whiteSpace: 'nowrap' }}>
                {k.replace(/_/g, ' ')} ← <code style={{ color: 'var(--mc-text-3)' }}>{v}</code>
              </span>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 10 }}>
        {r.filing_url && (
          <a href={r.filing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {r.form} on SEC EDGAR <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {r.release_url && (
          <a href={r.release_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>earnings release ↗</a>
        )}
        {r.guidance_url && r.guidance_url !== r.release_url && (
          <a href={r.guidance_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>guidance release ↗</a>
        )}
        <span style={{ color: 'var(--mc-text-4)' }}>
          {r.period_end ? `Quarter ended ${r.period_end} · ` : ''}filed {r.filing_date}
          {r.prelim ? ' · PRELIM, the 10-Q has not posted yet' : ''}
        </span>
      </div>
    </div>
  );
}

