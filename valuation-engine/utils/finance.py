"""
Pure finance math — CAGR, NPV, WACC, CAPM.
No external API calls, no side effects, safe to call in tight loops.
"""
from __future__ import annotations

import math
from typing import Iterable, Optional


def cagr(start: float, end: float, years: float) -> float:
    """Compound annual growth rate. Returns decimal (0.18 = 18%)."""
    if start <= 0 or years <= 0:
        return 0.0
    try:
        return (end / start) ** (1.0 / years) - 1.0
    except (ZeroDivisionError, ValueError):
        return 0.0


def npv(cashflows: Iterable[float], discount_rate: float, first_period: int = 1) -> float:
    """Net present value of cash flows discounted at `discount_rate`."""
    pv = 0.0
    for i, cf in enumerate(cashflows, start=first_period):
        pv += cf / ((1 + discount_rate) ** i)
    return pv


def gordon_terminal(last_fcf: float, growth: float, discount: float) -> float:
    """Gordon Growth terminal value: FCF × (1+g) / (r − g). Capped against math blow-up."""
    if discount - growth < 0.01:
        # Force a minimum 1% spread so we don't divide by ~zero
        return last_fcf * 1.01 / 0.01
    return (last_fcf * (1.0 + growth)) / (discount - growth)


def capm_cost_of_equity(risk_free: float, beta: float, erp: float, country_rp: float = 0.0) -> float:
    """CAPM: r_e = Rf + β × (ERP) + country risk premium."""
    return risk_free + beta * erp + country_rp


def cost_of_debt(interest_coverage: Optional[float], tax_rate: float, base_yield: float = 0.085) -> float:
    """
    Cost of debt = base_yield × spread × (1 − tax).
    Spread approximated from interest coverage (Damodaran method).
    """
    if interest_coverage is None or interest_coverage <= 0:
        spread = 0.05  # high-yield assumption
    elif interest_coverage > 12.5:
        spread = 0.003
    elif interest_coverage > 9.5:
        spread = 0.006
    elif interest_coverage > 6.0:
        spread = 0.010
    elif interest_coverage > 4.0:
        spread = 0.020
    elif interest_coverage > 2.5:
        spread = 0.030
    elif interest_coverage > 1.5:
        spread = 0.040
    else:
        spread = 0.060
    pretax = base_yield + spread
    return pretax * (1.0 - tax_rate)


def wacc_calc(
    cost_of_equity: float, cost_of_debt_after_tax: float,
    equity_value: float, debt_value: float,
) -> float:
    """Weighted average cost of capital."""
    total = equity_value + debt_value
    if total <= 0:
        return cost_of_equity
    we = equity_value / total
    wd = debt_value / total
    return we * cost_of_equity + wd * cost_of_debt_after_tax


def growth_decay(start_growth: float, terminal_growth: float, years: int, decay: str = 'linear') -> list[float]:
    """
    Project growth fading from `start_growth` to `terminal_growth` over N years.
    Linear decay is the institutional default; exponential available.
    """
    if years <= 1:
        return [start_growth]
    out: list[float] = []
    for y in range(1, years + 1):
        if decay == 'exponential':
            f = math.exp(-1.5 * (y - 1) / (years - 1))
        else:  # linear
            f = 1.0 - (y - 1) / (years - 1)
        g = terminal_growth + (start_growth - terminal_growth) * f
        out.append(g)
    return out


def margin_of_safety(intrinsic: float, market: float) -> float:
    """MoS as %: (intrinsic − market) / market × 100."""
    if market <= 0:
        return 0.0
    return (intrinsic - market) / market * 100.0


def clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))
