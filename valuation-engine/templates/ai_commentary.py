"""
Natural-language investment commentary.

Produces a buy-side-style writeup from the engine's structured output —
strengths, risks, what the market is pricing in, valuation summary.
No external LLM dependency; template-driven.
"""
from __future__ import annotations

from valuation.dcf import DcfResult
from valuation.inputs import ValuationInputs
from valuation.quality import QualityScore
from valuation.relative import RelativeResult
from valuation.reverse_dcf import ReverseDcfResult
from valuation.return_decomposition import ReturnDecomposition
from valuation.sector_logic import classify_business, BUSINESS_TYPE_LABELS


def generate_commentary(
    inp: ValuationInputs,
    dcf: DcfResult | None,
    rel: RelativeResult,
    quality: QualityScore,
    reverse: ReverseDcfResult | None,
    rd: ReturnDecomposition | None,
    flags: list,
) -> str:
    """Return a multi-paragraph natural-language commentary."""
    bt = classify_business(inp.sector)
    btlbl = BUSINESS_TYPE_LABELS.get(bt, bt)
    lines: list[str] = []

    # ── Lead ────────────────────────────────────────────────────────────
    lead = f"**{inp.company}** — {btlbl}, ₹{inp.market_cap_cr:,.0f} Cr market cap, CMP ₹{inp.cmp:,.0f}."
    lines.append(lead)

    # ── Valuation summary ───────────────────────────────────────────────
    if dcf:
        ps = dcf.intrinsic_per_share
        mos = (ps - inp.cmp) / inp.cmp * 100 if inp.cmp else 0
        verdict = 'undervalued' if mos > 15 else 'overvalued' if mos < -15 else 'fairly valued'
        lines.append(
            f"The **{dcf.model} DCF** prints an intrinsic value of **₹{ps:,.0f}/share** "
            f"({mos:+.0f}% vs CMP) using a {dcf.wacc_used*100:.1f}% discount rate and "
            f"{dcf.growth_path[0]*100:.0f}% year-1 growth fading to terminal "
            f"{dcf.growth_path[-1]*100:.1f}%. Verdict: **{verdict}**."
        )

    if rel.fair_price_consensus:
        lines.append(
            f"Relative valuation across {len(rel.methods_applied)} sector-appropriate multiples "
            f"({', '.join(rel.methods_applied)}) converges on **₹{rel.fair_price_consensus:,.0f}/share** "
            f"({(rel.fair_price_consensus - inp.cmp) / inp.cmp * 100:+.0f}% vs CMP)."
        )

    # ── What the market is pricing in ───────────────────────────────────
    if reverse:
        if reverse.verdict == 'STRETCHED':
            lines.append(
                f"⚠ **Reverse DCF**: the market is pricing in **{reverse.implied_growth_pct:.0f}%** FCF growth, "
                f"vs realized {reverse.realistic_growth_pct:.0f}% historical. {reverse.gap_pct:+.0f}pp gap — "
                f"priced for perfection. Any execution miss likely triggers material de-rating."
            )
        elif reverse.verdict == 'CONSERVATIVE':
            lines.append(
                f"💡 **Reverse DCF**: market is pricing in only {reverse.implied_growth_pct:.0f}% FCF growth, "
                f"below realized {reverse.realistic_growth_pct:.0f}%. Asymmetric setup if growth continues."
            )
        else:
            lines.append(
                f"**Reverse DCF**: implied growth {reverse.implied_growth_pct:.0f}% is in line with "
                f"historical {reverse.realistic_growth_pct:.0f}% — market expectations look reasonable."
            )

    # ── Quality assessment ──────────────────────────────────────────────
    qtier = 'high-quality' if quality.composite > 70 else 'average-quality' if quality.composite > 50 else 'below-average-quality'
    lines.append(
        f"**Quality score: {quality.composite:.0f}/100** — {qtier}. "
        f"Profitability {quality.profitability:.0f} · Capital allocation {quality.capital_allocation:.0f} · "
        f"Balance sheet {quality.balance_sheet:.0f} · Moat {quality.moat:.0f} · Governance {quality.governance:.0f}."
    )

    # ── Return waterfall ────────────────────────────────────────────────
    if rd:
        lines.append(
            f"**Expected 5y CAGR ≈ {rd.expected_5y_cagr_pct:.0f}%** decomposed as: "
            f"EPS growth {rd.eps_growth_pct:.0f}% + multiple re-rating {rd.rerating_pct:+.0f}% + "
            f"dividend yield {rd.dividend_yield_pct:.1f}%."
        )

    # ── Risk callouts ───────────────────────────────────────────────────
    critical = [f for f in flags if f.severity == 'CRITICAL']
    high = [f for f in flags if f.severity == 'HIGH']
    if critical:
        lines.append(f"🚨 **Critical risks ({len(critical)})**: " + '; '.join(f.label for f in critical) + '.')
    if high:
        lines.append(f"⚠ **High-severity flags ({len(high)})**: " + '; '.join(f.label for f in high) + '.')

    return '\n\n'.join(lines)
