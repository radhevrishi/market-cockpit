"""
Sector-aware relative valuation.

Selects appropriate multiples based on business type:
    Banks/NBFCs        → P/B × ROE, P/E
    SaaS / Platforms   → EV/Sales, Rule of 40
    Pharma / Capital   → P/E, EV/EBITDA
    Cyclical           → Mid-cycle EV/EBITDA (normalized)
    Consumer Staples   → P/E (premium), EV/EBITDA
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from assumptions.sector_defaults import get_sector_assumption
from valuation.inputs import ValuationInputs
from valuation.sector_logic import (
    BusinessType, classify_business,
    use_ev_ebitda, use_ev_sales, use_pb_roe, use_pe, use_normalized_ebitda,
)


@dataclass
class RelativeResult:
    fair_pe: Optional[float] = None
    fair_pb: Optional[float] = None
    fair_ev_ebitda: Optional[float] = None
    fair_ev_sales: Optional[float] = None
    fair_price_pe: Optional[float] = None
    fair_price_pb: Optional[float] = None
    fair_price_ev_ebitda: Optional[float] = None
    fair_price_ev_sales: Optional[float] = None
    fair_price_consensus: Optional[float] = None
    methods_applied: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _growth_tilted_multiple(base: float, growth_pct: float) -> float:
    """Tilt sector-default exit multiple by stock's growth profile."""
    g = growth_pct / 100.0
    if g >= 0.40:
        return base * 1.6
    if g >= 0.25:
        return base * 1.3
    if g >= 0.15:
        return base * 1.1
    if g >= 0.08:
        return base * 1.0
    return base * 0.85


def relative_valuation(inp: ValuationInputs) -> RelativeResult:
    """Produce a sector-appropriate relative valuation."""
    bt = classify_business(inp.sector)
    a = get_sector_assumption(bt)
    result = RelativeResult()
    growth = inp.revenue_growth_3y_pct or inp.profit_growth_3y_pct or 12.0
    shares = inp.shares_outstanding_cr or 0
    net_debt = inp._net_debt_cr or 0.0

    # ─── P/E (most universal except platforms/commodities at peak) ───
    if use_pe(bt) and inp.eps and inp.eps > 0:
        # Prefer historical own P/E if available and sensible
        bench = inp.industry_pe if (inp.industry_pe and 5 < inp.industry_pe < 100) else None
        if bench is None and inp.historical_pe_5y and 5 < inp.historical_pe_5y < 100:
            bench = inp.historical_pe_5y
        if bench is None:
            bench = a.exit_pe
        fair_pe = _growth_tilted_multiple(bench, growth)
        result.fair_pe = fair_pe
        # Forward EPS = EPS × (1 + growth)
        fwd_eps = inp.eps * (1 + growth / 100.0)
        result.fair_price_pe = fwd_eps * fair_pe
        result.methods_applied.append('P/E × Fwd EPS')
        result.notes.append(f'P/E {fair_pe:.1f}× × Fwd EPS ₹{fwd_eps:.1f}')

    # ─── EV/EBITDA ───
    if use_ev_ebitda(bt) and inp._ebitda_cr and inp._ebitda_cr > 0 and shares > 0:
        bench_ev = a.exit_ev_ebitda
        if use_normalized_ebitda(bt):
            # For cyclicals: use 5y average margin if available
            if inp.opm_5y_pct and inp.revenue_cr:
                normalized_ebitda = inp.revenue_cr * (inp.opm_5y_pct / 100.0)
                ebitda_to_use = normalized_ebitda
                result.notes.append(f'Cyclical — using 5y avg OPM {inp.opm_5y_pct:.1f}% (normalized EBITDA ₹{normalized_ebitda:.0f} Cr)')
            else:
                ebitda_to_use = inp._ebitda_cr * 0.85  # haircut for cycle-peak risk
                result.notes.append('Cyclical — applying 15% haircut to current EBITDA')
        else:
            ebitda_to_use = inp._ebitda_cr
        # Project forward 1y EBITDA
        fwd_ebitda = ebitda_to_use * (1 + growth / 100.0)
        fair_ev_mult = _growth_tilted_multiple(bench_ev, growth)
        result.fair_ev_ebitda = fair_ev_mult
        fair_ev = fwd_ebitda * fair_ev_mult
        result.fair_price_ev_ebitda = max(0.0, (fair_ev - net_debt) / shares)
        result.methods_applied.append('EV/EBITDA × Fwd EBITDA')

    # ─── EV/Sales (SaaS / Platforms / pre-profit) ───
    if use_ev_sales(bt) and inp.revenue_cr > 0 and shares > 0:
        # Rule of 40: growth + FCF margin
        fcf_m = inp.fcf_margin_pct or (inp.pat_margin_pct or 0)
        r40 = growth + fcf_m
        # Base EV/Sales multiplier — Rule-of-40 anchored
        if r40 >= 60: ev_sales_mult = 12.0
        elif r40 >= 40: ev_sales_mult = 8.0
        elif r40 >= 20: ev_sales_mult = 4.5
        elif r40 >= 0: ev_sales_mult = 2.0
        else: ev_sales_mult = 1.0
        # Sector growth tilt
        ev_sales_mult = _growth_tilted_multiple(ev_sales_mult, growth)
        result.fair_ev_sales = ev_sales_mult
        fair_ev = inp.revenue_cr * ev_sales_mult
        result.fair_price_ev_sales = max(0.0, (fair_ev - net_debt) / shares)
        result.methods_applied.append(f'EV/Sales (R40 {r40:.0f})')

    # ─── P/B × ROE (Banks / NBFCs) ───
    if use_pb_roe(bt) and inp.book_value_per_share and inp.book_value_per_share > 0 and inp.roe_pct:
        roe = inp.roe_pct / 100.0
        ce = a.cost_of_equity
        g_long = a.terminal_growth + 0.04  # bank growth allowance
        g = min(growth / 100.0, ce - 0.015)
        if ce - g > 0.001:
            justified_pb = max(0.0, (roe - g) / (ce - g))
            result.fair_pb = justified_pb
            result.fair_price_pb = justified_pb * inp.book_value_per_share
            result.methods_applied.append('P/B × ROE')
            result.notes.append(f'P/B {justified_pb:.2f} = (ROE {inp.roe_pct:.0f}% − g {g*100:.0f}%) / (CoE {ce*100:.1f}% − g)')

    # ─── Consensus = average of applicable price targets ───
    prices = [p for p in [
        result.fair_price_pe, result.fair_price_ev_ebitda,
        result.fair_price_ev_sales, result.fair_price_pb,
    ] if p is not None and p > 0]
    if prices:
        result.fair_price_consensus = sum(prices) / len(prices)
    return result
