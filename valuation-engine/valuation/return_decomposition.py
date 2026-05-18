"""
Expected shareholder return decomposition:
    Total CAGR = EPS growth + multiple re-rating + dividend yield

This is the framework Bessembinder / Mauboussin use to attribute the
forward 5-year return. Useful for "what would need to be true" thinking.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from valuation.dcf import run_dcf
from valuation.inputs import ValuationInputs
from valuation.relative import relative_valuation


@dataclass
class ReturnDecomposition:
    eps_growth_pct: float
    rerating_pct: float
    dividend_yield_pct: float
    expected_5y_cagr_pct: float


def expected_return(inp: ValuationInputs) -> Optional[ReturnDecomposition]:
    """Build the 5-year forward return waterfall."""
    if not inp.pe or not inp.eps:
        return None

    # EPS growth ≈ profit_growth_3y or revenue_growth_3y × operating leverage
    eps_g = inp.profit_growth_3y_pct or (inp.revenue_growth_3y_pct or 12.0) * 1.2

    # Re-rating: target P/E from relative model vs current P/E
    rel = relative_valuation(inp)
    if rel.fair_pe and inp.pe > 0:
        rerating_total = (rel.fair_pe / inp.pe) - 1.0
        rerating_5y_pct = ((1 + rerating_total) ** (1 / 5) - 1) * 100
    else:
        rerating_5y_pct = 0.0

    # Dividend yield from PAT × payout (assume 25% default)
    div_yield = 0.0
    if inp._pat_cr and inp.market_cap_cr > 0:
        div_yield = (inp._pat_cr * 0.25) / inp.market_cap_cr * 100

    return ReturnDecomposition(
        eps_growth_pct=eps_g,
        rerating_pct=rerating_5y_pct,
        dividend_yield_pct=div_yield,
        expected_5y_cagr_pct=eps_g + rerating_5y_pct + div_yield,
    )
