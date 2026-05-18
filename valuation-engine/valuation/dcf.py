"""
FCFF + FCFE Discounted Cash Flow models.

`fcff_dcf()`:
    Free Cash Flow to Firm — discount at WACC, subtract net debt to get equity.
    Standard for non-financial businesses.

`fcfe_dcf()`:
    Free Cash Flow to Equity — discount at cost of equity. Used for banks /
    NBFCs (where debt is operating, not financing). Also exposes excess
    return component for transparency.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from assumptions.country import get_country
from assumptions.sector_defaults import get_sector_assumption
from utils.finance import (
    capm_cost_of_equity, cost_of_debt, growth_decay, gordon_terminal, wacc_calc, clip,
)
from valuation.inputs import ValuationInputs
from valuation.sector_logic import classify_business, use_fcfe


@dataclass
class DcfResult:
    intrinsic_per_share: float
    equity_value_cr: float
    enterprise_value_cr: float
    sum_pv_forecast: float
    pv_terminal: float
    wacc_used: float
    cost_of_equity: float
    cost_of_debt_after_tax: float
    growth_path: list[float]
    fcf_projection: list[float]
    terminal_value_cr: float
    discount_rate_used: float
    model: str            # 'FCFF' or 'FCFE'
    notes: str = ''


def _project_growth(inp: ValuationInputs) -> list[float]:
    """Build a 5-year growth path."""
    a = get_sector_assumption(classify_business(inp.sector))
    if inp.five_year_growth_override_pct is not None:
        start = inp.five_year_growth_override_pct / 100.0
    else:
        # Anchor on the BETTER of profit-growth-3y vs sales-growth-3y;
        # use guidance if present and exceeds historical.
        sales3y = (inp.revenue_growth_3y_pct or inp.yoy_sales_growth_pct or 12.0) / 100.0
        profit3y = (inp.profit_growth_3y_pct or sales3y * 100) / 100.0
        anchor = max(sales3y, profit3y * 0.85)
        if inp.guidance_revenue_growth_pct is not None:
            anchor = max(anchor, inp.guidance_revenue_growth_pct / 100.0)
        start = clip(anchor, 0.05, 0.45)
    terminal = (
        inp.terminal_growth_override
        if inp.terminal_growth_override is not None
        else a.terminal_growth
    )
    return growth_decay(start, terminal, years=5, decay='linear')


def _resolve_wacc(inp: ValuationInputs) -> tuple[float, float, float]:
    """Return (WACC, cost_of_equity, cost_of_debt_after_tax)."""
    bt = classify_business(inp.sector)
    a = get_sector_assumption(bt)
    country = get_country(inp.country)
    tax = (inp.effective_tax_rate_pct / 100.0) if inp.effective_tax_rate_pct else country.default_tax_rate

    if inp.cost_of_equity_override is not None:
        ce = inp.cost_of_equity_override
    else:
        ce = capm_cost_of_equity(country.risk_free_rate, a.beta, country.equity_risk_premium, country.country_risk_premium)

    cd = cost_of_debt(inp.interest_coverage, tax, base_yield=country.risk_free_rate + 0.015)

    if inp.wacc_override is not None:
        w = inp.wacc_override
    else:
        equity_val = inp.market_cap_cr
        debt_val = inp.debt_cr or 0.0
        w = wacc_calc(ce, cd, equity_val, debt_val)
    return w, ce, cd


def fcff_dcf(inp: ValuationInputs) -> Optional[DcfResult]:
    """Standard FCFF DCF for non-financial businesses."""
    if inp.shares_outstanding_cr is None or inp.shares_outstanding_cr <= 0:
        return None
    # Base FCF — direct preferred; derive from EBITDA × 0.6 fallback
    base_fcf = inp.fcf_cr
    if base_fcf is None and inp._ebitda_cr:
        # Rough: FCF ≈ EBITDA × (1 − tax) − maintenance capex (assume 35% of EBITDA)
        country = get_country(inp.country)
        tax = (inp.effective_tax_rate_pct or country.default_tax_rate * 100) / 100.0
        base_fcf = inp._ebitda_cr * (1 - tax) * 0.55
    if not base_fcf or base_fcf <= 0:
        return None

    wacc, ce, cd = _resolve_wacc(inp)
    a = get_sector_assumption(classify_business(inp.sector))
    terminal_g = inp.terminal_growth_override if inp.terminal_growth_override is not None else a.terminal_growth
    growth_path = _project_growth(inp)

    # Project 5 years of FCF
    fcf = base_fcf
    fcf_proj: list[float] = []
    pv_sum = 0.0
    for y, g in enumerate(growth_path, start=1):
        fcf = fcf * (1 + g)
        fcf_proj.append(fcf)
        pv_sum += fcf / ((1 + wacc) ** y)

    # Terminal value at end of year 5
    tv = gordon_terminal(fcf, terminal_g, wacc)
    pv_terminal = tv / ((1 + wacc) ** len(growth_path))

    enterprise_value = pv_sum + pv_terminal
    net_debt = (inp._net_debt_cr or 0.0)
    equity_value = enterprise_value - net_debt
    intrinsic_ps = equity_value / inp.shares_outstanding_cr

    return DcfResult(
        intrinsic_per_share=intrinsic_ps,
        equity_value_cr=equity_value,
        enterprise_value_cr=enterprise_value,
        sum_pv_forecast=pv_sum,
        pv_terminal=pv_terminal,
        wacc_used=wacc,
        cost_of_equity=ce,
        cost_of_debt_after_tax=cd,
        growth_path=growth_path,
        fcf_projection=fcf_proj,
        terminal_value_cr=tv,
        discount_rate_used=wacc,
        model='FCFF',
        notes=f'5y growth → terminal {terminal_g*100:.1f}%; tax {(inp.effective_tax_rate_pct or 25):.0f}%',
    )


def fcfe_excess_return(inp: ValuationInputs) -> Optional[DcfResult]:
    """
    Excess return model for financials.

        Justified P/B = (ROE − g) / (CoE − g)
        Fair price = Justified P/B × Book Value per Share

    Plus a 5-year excess-return projection added to book value.
    """
    bvps = inp.book_value_per_share
    roe = (inp.roe_pct or 0) / 100.0
    if not bvps or bvps <= 0 or roe <= 0:
        return None
    _, ce, _ = _resolve_wacc(inp)
    a = get_sector_assumption(classify_business(inp.sector))
    terminal_g = inp.terminal_growth_override if inp.terminal_growth_override is not None else a.terminal_growth
    # Cap growth strictly below CoE for Gordon stability
    g = min((inp.revenue_growth_3y_pct or 12) / 100.0, ce - 0.015)

    if ce - g < 0.01:
        return None

    justified_pb = max(0.0, (roe - g) / (ce - g))
    intrinsic_ps = justified_pb * bvps

    return DcfResult(
        intrinsic_per_share=intrinsic_ps,
        equity_value_cr=intrinsic_ps * (inp.shares_outstanding_cr or 0),
        enterprise_value_cr=intrinsic_ps * (inp.shares_outstanding_cr or 0),  # banks: EV ≈ Equity
        sum_pv_forecast=0,
        pv_terminal=intrinsic_ps,
        wacc_used=ce,
        cost_of_equity=ce,
        cost_of_debt_after_tax=0,
        growth_path=[g] * 5,
        fcf_projection=[bvps * roe] * 5,  # earnings per share repeated
        terminal_value_cr=intrinsic_ps,
        discount_rate_used=ce,
        model='FCFE',
        notes=f'Excess return: P/B_just = ({roe*100:.1f}% − {g*100:.1f}%)/({ce*100:.1f}% − {g*100:.1f}%) = {justified_pb:.2f}',
    )


def run_dcf(inp: ValuationInputs) -> Optional[DcfResult]:
    """Auto-pick FCFF for non-financial, FCFE for financials."""
    bt = classify_business(inp.sector)
    if use_fcfe(bt):
        return fcfe_excess_return(inp)
    return fcff_dcf(inp)


# ─────────────────────────────────────────────────────────────────────────
# Sensitivity grid — WACC × terminal_growth
# ─────────────────────────────────────────────────────────────────────────

def dcf_sensitivity(
    inp: ValuationInputs,
    wacc_range: tuple[float, float] = (-0.02, 0.02),
    g_range: tuple[float, float] = (-0.01, 0.01),
    steps: int = 5,
) -> dict:
    """Return a sensitivity grid of intrinsic prices vs WACC × terminal-g."""
    base = run_dcf(inp)
    if not base:
        return {}
    waccs = [base.wacc_used + wacc_range[0] + (wacc_range[1] - wacc_range[0]) * i / (steps - 1) for i in range(steps)]
    gs = [
        (inp.terminal_growth_override or get_sector_assumption(classify_business(inp.sector)).terminal_growth)
        + g_range[0] + (g_range[1] - g_range[0]) * i / (steps - 1)
        for i in range(steps)
    ]
    grid = []
    for w in waccs:
        row = []
        for g in gs:
            forked = inp.fork(wacc_override=w, terminal_growth_override=g)
            r = run_dcf(forked)
            row.append(r.intrinsic_per_share if r else 0.0)
        grid.append(row)
    return {
        'waccs_pct': [w * 100 for w in waccs],
        'growths_pct': [g * 100 for g in gs],
        'grid': grid,
    }
