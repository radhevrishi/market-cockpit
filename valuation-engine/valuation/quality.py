"""
Quality scoring engine (0-100) with sub-scores.

Composite blends:
  - Profitability (ROCE / ROE / margins)
  - Capital allocation (FCF conversion, ROIC vs cost of capital)
  - Balance sheet (leverage, interest coverage, cash)
  - Moat proxy (margin stability, ROCE vs sector)
  - Governance (promoter holding, pledge, FII/DII trust)
"""
from __future__ import annotations

from dataclasses import dataclass

from assumptions.sector_defaults import get_sector_assumption
from valuation.inputs import ValuationInputs
from valuation.sector_logic import BusinessType, classify_business, avoid_gross_margin


@dataclass
class QualityScore:
    composite: float           # /100
    profitability: float
    capital_allocation: float
    balance_sheet: float
    moat: float
    governance: float
    notes: list[str]


def _score_band(value: float, bands: list[tuple[float, float]]) -> float:
    """`bands` = list of (threshold, score) tuples, descending threshold order."""
    for thresh, sc in bands:
        if value >= thresh:
            return sc
    return 0.0


def quality_score(inp: ValuationInputs) -> QualityScore:
    bt = classify_business(inp.sector)
    a = get_sector_assumption(bt)
    notes: list[str] = []

    # ── Profitability ─────────────────────────────────────────────────
    roce = inp.roce_pct or 0.0
    roe = inp.roe_pct or 0.0
    op = inp.ebitda_margin_pct or 0.0
    prof = (
        _score_band(roce, [(30, 100), (25, 88), (20, 75), (15, 60), (10, 40), (5, 20), (0, 5)]) * 0.5
        + _score_band(roe, [(25, 100), (20, 85), (15, 65), (10, 45), (5, 20), (0, 5)]) * 0.3
        + _score_band(op, [(30, 100), (22, 80), (15, 60), (10, 40), (5, 20), (0, 5)]) * 0.2
    )
    notes.append(f'ROCE {roce:.0f}% · ROE {roe:.0f}% · OPM {op:.0f}%')

    # ── Capital allocation ────────────────────────────────────────────
    cfo_pat = inp.cfo_to_pat or 0.0
    fcf_m = inp.fcf_margin_pct or 0.0
    cap = (
        _score_band(cfo_pat, [(1.2, 100), (1.0, 90), (0.8, 70), (0.6, 45), (0.3, 20), (0, 5)]) * 0.55
        + _score_band(fcf_m, [(20, 100), (15, 85), (10, 70), (5, 50), (0, 25)]) * 0.45
    )
    notes.append(f'CFO/PAT {cfo_pat:.2f}× · FCF margin {fcf_m:.0f}%')

    # ── Balance sheet ─────────────────────────────────────────────────
    de = inp.debt_to_equity or 0.0
    icr = inp.interest_coverage or 0.0
    if bt == 'BANK_NBFC':
        # For lenders, high D/E is normal; substitute capital adequacy proxy
        bs = 60 + min(20, max(0, (roe - 10) * 2))  # ROE 10-20% → 60-80
        notes.append('Bank/NBFC — leverage exempted from balance-sheet score')
    else:
        de_score = _score_band(-de, [(-0.2, 100), (-0.5, 90), (-0.8, 75), (-1.2, 55), (-2.0, 30), (-3.0, 10), (-99, 0)])
        icr_score = _score_band(icr, [(10, 100), (6, 85), (4, 65), (2.5, 45), (1.5, 25), (0, 5)])
        bs = de_score * 0.6 + icr_score * 0.4
        notes.append(f'D/E {de:.2f}× · ICR {icr:.1f}×')

    # ── Moat (qualitative proxy) ──────────────────────────────────────
    moat_proxy = 50.0
    if not avoid_gross_margin(bt) and inp.gross_margin_pct:
        moat_proxy += min(25, (inp.gross_margin_pct - 30) * 0.7)
    if roce > 25: moat_proxy += 15
    elif roce > 18: moat_proxy += 8
    elif roce < 10: moat_proxy -= 15
    moat = max(0, min(100, moat_proxy))
    notes.append(f'Moat proxy: GPM + ROCE → {moat:.0f}')

    # ── Governance ────────────────────────────────────────────────────
    promo = inp.promoter_pct or 50
    pledge = inp.pledge_pct or 0
    fiidii = (inp.fii_pct or 0) + (inp.dii_pct or 0)
    gov = 50.0
    if 40 <= promo <= 75: gov += 20
    elif promo < 25: gov -= 25
    elif promo > 85: gov -= 5
    if pledge > 50: gov -= 40
    elif pledge > 25: gov -= 20
    elif pledge > 10: gov -= 8
    if 15 <= fiidii <= 35: gov += 10  # sweet spot
    elif fiidii < 5: gov -= 10
    gov = max(0, min(100, gov))
    notes.append(f'Promoter {promo:.0f}% · Pledge {pledge:.0f}% · FII+DII {fiidii:.0f}%')

    # ── Composite ─────────────────────────────────────────────────────
    composite = (
        prof * 0.30 +
        cap * 0.20 +
        bs * 0.20 +
        moat * 0.15 +
        gov * 0.15
    )
    return QualityScore(
        composite=composite,
        profitability=prof,
        capital_allocation=cap,
        balance_sheet=bs,
        moat=moat,
        governance=gov,
        notes=notes,
    )
