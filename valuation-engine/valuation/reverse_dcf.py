"""
Reverse DCF — solve for the FCF growth rate the market is implicitly
pricing in at the current market cap. If implied growth ≫ realistic
guidance, the stock is priced for perfection.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from assumptions.sector_defaults import get_sector_assumption
from utils.finance import gordon_terminal
from valuation.dcf import _resolve_wacc
from valuation.inputs import ValuationInputs
from valuation.sector_logic import classify_business


@dataclass
class ReverseDcfResult:
    implied_growth_pct: float          # 5y implied growth at current price
    realistic_growth_pct: float        # historical/guidance growth
    gap_pct: float                     # implied − realistic
    verdict: str                       # STRETCHED / IN_LINE / CONSERVATIVE
    notes: str


def reverse_dcf(inp: ValuationInputs) -> Optional[ReverseDcfResult]:
    if not inp.fcf_cr or inp.fcf_cr <= 0 or not inp.market_cap_cr:
        return None
    wacc, _, _ = _resolve_wacc(inp)
    a = get_sector_assumption(classify_business(inp.sector))
    terminal_g = inp.terminal_growth_override if inp.terminal_growth_override is not None else a.terminal_growth
    target_equity = inp.market_cap_cr
    net_debt = inp._net_debt_cr or 0.0

    def fv_at(g: float) -> float:
        fcf = inp.fcf_cr
        pv = 0.0
        for y in range(1, 6):
            fcf = fcf * (1 + g)
            pv += fcf / ((1 + wacc) ** y)
        tv = gordon_terminal(fcf, terminal_g, wacc)
        pv += tv / ((1 + wacc) ** 5)
        return pv - net_debt

    # Bisection
    lo, hi = -0.10, 0.60
    for _ in range(60):
        mid = (lo + hi) / 2
        if fv_at(mid) < target_equity:
            lo = mid
        else:
            hi = mid
    implied = (lo + hi) / 2

    realistic = (inp.revenue_growth_3y_pct or inp.yoy_sales_growth_pct or 12.0) / 100.0
    gap = (implied - realistic) * 100

    if gap > 5:
        verdict = 'STRETCHED'
    elif gap < -4:
        verdict = 'CONSERVATIVE'
    else:
        verdict = 'IN_LINE'

    return ReverseDcfResult(
        implied_growth_pct=implied * 100,
        realistic_growth_pct=realistic * 100,
        gap_pct=gap,
        verdict=verdict,
        notes=f'Market prices {implied*100:.1f}% FCF growth vs historical {realistic*100:.1f}%',
    )
