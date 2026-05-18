"""
Automatic warning system. Each flag has severity + actionable comment.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from assumptions.sector_defaults import get_sector_assumption
from valuation.inputs import ValuationInputs
from valuation.sector_logic import classify_business

Severity = Literal['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']


@dataclass
class RiskFlag:
    severity: Severity
    label: str
    detail: str


def detect_risk_flags(inp: ValuationInputs) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    bt = classify_business(inp.sector)
    a = get_sector_assumption(bt)

    # ── Capital destruction ──────────────────────────────────────────────
    if inp.roce_pct is not None and inp.roce_pct < a.wacc * 100 - 1:
        flags.append(RiskFlag(
            'HIGH', 'ROCE < WACC',
            f'ROCE {inp.roce_pct:.1f}% below estimated WACC {a.wacc*100:.0f}% — capital being destroyed, not created.',
        ))
    if bt in ('BANK_NBFC', 'INSURANCE') and inp.roe_pct is not None and inp.roe_pct < a.cost_of_equity * 100 - 1:
        flags.append(RiskFlag(
            'HIGH', 'ROE < Cost of Equity',
            f'ROE {inp.roe_pct:.1f}% below CoE {a.cost_of_equity*100:.0f}% — equity value destruction.',
        ))

    # ── Cash flow quality ────────────────────────────────────────────────
    if inp.cfo_to_pat is not None and inp.cfo_to_pat < 0.6:
        sev: Severity = 'CRITICAL' if inp.cfo_to_pat < 0 else 'HIGH'
        flags.append(RiskFlag(
            sev, 'Weak CFO/PAT',
            f'CFO/PAT {inp.cfo_to_pat:.2f}× — earnings not converting to cash. Check working-capital build-up or accounting flags.',
        ))
    if inp.fcf_cr is not None and inp.fcf_cr < 0:
        flags.append(RiskFlag(
            'HIGH', 'Negative FCF',
            f'FCF ₹{inp.fcf_cr:.0f} Cr — business burns cash; growth requires external capital.',
        ))

    # ── Leverage ────────────────────────────────────────────────────────
    de = inp.debt_to_equity or 0
    if de > 3 and bt not in ('BANK_NBFC', 'INSURANCE'):
        flags.append(RiskFlag('CRITICAL', f'D/E {de:.1f}× — extreme leverage',
                              'Non-financial business with D/E > 3 — survival risk in downturn.'))
    elif de > 1.5 and bt not in ('BANK_NBFC', 'INSURANCE'):
        flags.append(RiskFlag('MEDIUM', f'D/E {de:.1f}× — elevated leverage',
                              'D/E > 1.5 raises Fisher survival concern. Verify interest coverage and FCF stability.'))
    if inp.interest_coverage is not None and inp.interest_coverage < 2 and bt not in ('BANK_NBFC',):
        flags.append(RiskFlag('HIGH', f'ICR {inp.interest_coverage:.1f}×',
                              'Interest coverage < 2 — earnings barely covering interest expense.'))

    # ── Governance ──────────────────────────────────────────────────────
    if inp.pledge_pct is not None and inp.pledge_pct > 50:
        flags.append(RiskFlag('CRITICAL', f'Pledge {inp.pledge_pct:.0f}%',
                              'Promoter pledge > 50% — forced-sale risk on margin call.'))
    elif inp.pledge_pct is not None and inp.pledge_pct > 25:
        flags.append(RiskFlag('HIGH', f'Pledge {inp.pledge_pct:.0f}%',
                              'Promoter pledge > 25% — leverage on promoter side, watch repayment schedule.'))
    if (inp.promoter_pct or 50) < 5 and de > 2:
        flags.append(RiskFlag('HIGH', 'Governance vacuum',
                              f'Promoter {inp.promoter_pct:.0f}% + D/E {de:.1f}× — no skin in the game on leveraged book.'))

    # ── Valuation absurdity ─────────────────────────────────────────────
    if inp.pe is not None and inp.pe > 100 and (inp.profit_growth_3y_pct or 0) < 25:
        flags.append(RiskFlag('MEDIUM', f'P/E {inp.pe:.0f}× without justifying growth',
                              'Premium multiple not supported by demonstrated growth — priced for perfection.'))

    # ── Pre-revenue / pre-profit warnings ───────────────────────────────
    if (inp.pat_margin_pct or 1) <= 0 and bt != 'BANK_NBFC':
        flags.append(RiskFlag('HIGH', 'Loss-making',
                              'PAT margin ≤ 0 — model relies on growth + future margin expansion. Higher uncertainty.'))

    # ── NBFC-specific ───────────────────────────────────────────────────
    if bt == 'BANK_NBFC':
        if inp.gnpa_pct is not None and inp.gnpa_pct > 3.5:
            flags.append(RiskFlag('HIGH', f'GNPA {inp.gnpa_pct:.1f}%',
                                  'Asset-quality stress — provisioning will dent ROE.'))
        if inp.nnpa_pct is not None and inp.nnpa_pct > 1.5:
            flags.append(RiskFlag('MEDIUM', f'NNPA {inp.nnpa_pct:.1f}%',
                                  'Net NPA > 1.5% — net of provisioning, asset quality still deteriorating.'))

    # ── SaaS / Platform-specific ────────────────────────────────────────
    if bt in ('SAAS_SOFTWARE', 'PLATFORM_ECOM'):
        r40 = (inp.revenue_growth_3y_pct or 0) + (inp.fcf_margin_pct or 0)
        if r40 < 20:
            flags.append(RiskFlag('MEDIUM', f'Rule of 40 = {r40:.0f}',
                                  'SaaS/Platform names below Rule of 40 typically de-rate sharply.'))

    return flags
