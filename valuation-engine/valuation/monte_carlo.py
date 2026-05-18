"""
Monte Carlo valuation — sample growth / WACC / terminal-growth jointly to
build a probability distribution of intrinsic value rather than a point.

Default: 2000 trials. Growth ~ truncated-normal anchored on base case.
WACC ~ normal ± 1.5pp. Terminal g ~ normal ± 0.5pp.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import math
import random

from assumptions.sector_defaults import get_sector_assumption
from utils.finance import gordon_terminal
from valuation.dcf import _project_growth, _resolve_wacc
from valuation.inputs import ValuationInputs
from valuation.sector_logic import classify_business, use_fcfe


@dataclass
class MonteCarloResult:
    samples: list[float]                # intrinsic per-share
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    mean: float
    prob_undervalued: float             # share of trials with intrinsic > CMP × 1.05
    n_trials: int


def _truncnorm(mu: float, sigma: float, lo: float, hi: float) -> float:
    """Sample from truncated normal."""
    for _ in range(20):
        v = random.gauss(mu, sigma)
        if lo <= v <= hi:
            return v
    return max(lo, min(hi, mu))


def monte_carlo(inp: ValuationInputs, n_trials: int = 2000, seed: Optional[int] = 42) -> Optional[MonteCarloResult]:
    if inp.shares_outstanding_cr is None or inp.shares_outstanding_cr <= 0:
        return None
    if use_fcfe(classify_business(inp.sector)):
        return None  # MC less meaningful for banks; use P/B-ROE
    base_fcf = inp.fcf_cr
    if not base_fcf or base_fcf <= 0:
        return None

    if seed is not None:
        random.seed(seed)

    wacc_base, _, _ = _resolve_wacc(inp)
    a = get_sector_assumption(classify_business(inp.sector))
    base_growth_path = _project_growth(inp)
    base_growth = base_growth_path[0]  # year-1 growth as anchor
    terminal_base = inp.terminal_growth_override if inp.terminal_growth_override is not None else a.terminal_growth

    samples = []
    net_debt = inp._net_debt_cr or 0.0

    for _ in range(n_trials):
        # Sample assumptions
        g_yr1 = _truncnorm(base_growth, 0.04, max(0.02, base_growth - 0.15), min(0.55, base_growth + 0.15))
        w = _truncnorm(wacc_base, 0.012, wacc_base - 0.025, wacc_base + 0.025)
        tg = _truncnorm(terminal_base, 0.005, max(0.025, terminal_base - 0.015), min(0.06, terminal_base + 0.015))
        if w - tg < 0.02:
            w = tg + 0.02

        # Project 5y with linear decay from sampled g_yr1 to sampled terminal
        fcf = base_fcf
        pv = 0.0
        for y in range(1, 6):
            f = 1.0 - (y - 1) / 4
            g = tg + (g_yr1 - tg) * f
            fcf = fcf * (1 + g)
            pv += fcf / ((1 + w) ** y)
        tv = gordon_terminal(fcf, tg, w)
        pv += tv / ((1 + w) ** 5)
        equity = pv - net_debt
        intrinsic = max(0.0, equity / inp.shares_outstanding_cr)
        samples.append(intrinsic)

    samples.sort()
    def p(q: float) -> float:
        idx = int(q * (len(samples) - 1))
        return samples[idx]

    prob_under = sum(1 for s in samples if s > inp.cmp * 1.05) / len(samples) if inp.cmp else 0.0
    return MonteCarloResult(
        samples=samples,
        p10=p(0.10), p25=p(0.25), p50=p(0.50), p75=p(0.75), p90=p(0.90),
        mean=sum(samples) / len(samples),
        prob_undervalued=prob_under,
        n_trials=n_trials,
    )
