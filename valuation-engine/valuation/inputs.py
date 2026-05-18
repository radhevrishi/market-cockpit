"""
ValuationInputs — typed dataclass for the engine.

User supplies a SMALL set of mandatory fields; everything else is either
optional override or auto-inferred by the engine.

All currency values in ₹ Cr for India / $M for USA, declared via Country enum.
Margin/growth fields are percent points (e.g. 25 means 25%, not 0.25).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Literal

Country = Literal['INDIA', 'USA']


@dataclass
class ValuationInputs:
    # ── Identity ─────────────────────────────────────────────────────────
    company: str
    sector: str
    country: Country = 'INDIA'
    ticker: Optional[str] = None

    # ── Market data (mandatory) ──────────────────────────────────────────
    cmp: float = 0.0                  # ₹ current market price
    market_cap_cr: float = 0.0        # ₹ Cr
    shares_outstanding_cr: Optional[float] = None  # derived if not given

    # ── Income statement (mandatory core) ────────────────────────────────
    revenue_cr: float = 0.0           # last 12m revenue
    ebitda_margin_pct: Optional[float] = None
    pat_margin_pct: Optional[float] = None
    roce_pct: Optional[float] = None
    revenue_growth_3y_pct: Optional[float] = None

    # ── Balance sheet (mandatory core) ───────────────────────────────────
    debt_cr: float = 0.0
    cash_cr: float = 0.0
    book_value_per_share: Optional[float] = None
    eps: Optional[float] = None

    # ── Optional refinements ─────────────────────────────────────────────
    fcf_margin_pct: Optional[float] = None
    fcf_cr: Optional[float] = None
    roe_pct: Optional[float] = None
    gross_margin_pct: Optional[float] = None
    opm_5y_pct: Optional[float] = None
    profit_growth_3y_pct: Optional[float] = None
    yoy_sales_growth_pct: Optional[float] = None
    yoy_profit_growth_pct: Optional[float] = None
    pe: Optional[float] = None
    pb: Optional[float] = None
    ev_ebitda: Optional[float] = None
    industry_pe: Optional[float] = None
    historical_pe_5y: Optional[float] = None
    promoter_pct: Optional[float] = None
    pledge_pct: Optional[float] = None
    fii_pct: Optional[float] = None
    dii_pct: Optional[float] = None
    debt_to_equity: Optional[float] = None
    cfo_to_pat: Optional[float] = None
    interest_coverage: Optional[float] = None
    effective_tax_rate_pct: Optional[float] = None

    # ── NBFC / Bank specific ─────────────────────────────────────────────
    nim_pct: Optional[float] = None
    gnpa_pct: Optional[float] = None
    nnpa_pct: Optional[float] = None
    aum_cr: Optional[float] = None

    # ── User overrides ───────────────────────────────────────────────────
    cost_of_equity_override: Optional[float] = None      # decimal (0.13 = 13%)
    terminal_growth_override: Optional[float] = None     # decimal
    wacc_override: Optional[float] = None
    five_year_growth_override_pct: Optional[float] = None

    # ── Guidance (from concall paste, optional) ──────────────────────────
    guidance_revenue_growth_pct: Optional[float] = None
    guidance_ebitda_margin_pct: Optional[float] = None
    guidance_fiscal_year: Optional[str] = None

    # ── Audit trail ──────────────────────────────────────────────────────
    inputs_source: Literal['MANUAL', 'CSV', 'API'] = 'MANUAL'
    notes: str = ''

    # ── Derived (filled in by engine, not user) ──────────────────────────
    _ebitda_cr: Optional[float] = field(default=None, init=False)
    _ebit_cr: Optional[float] = field(default=None, init=False)
    _pat_cr: Optional[float] = field(default=None, init=False)
    _net_debt_cr: Optional[float] = field(default=None, init=False)
    _ev_cr: Optional[float] = field(default=None, init=False)

    # ─────────────────────────────────────────────────────────────────────
    def __post_init__(self) -> None:
        """Auto-derive computable quantities. Idempotent."""
        # Shares outstanding (Cr) = MCap (Cr) / CMP (₹)
        if self.shares_outstanding_cr is None and self.cmp > 0 and self.market_cap_cr > 0:
            self.shares_outstanding_cr = self.market_cap_cr / self.cmp

        # EBITDA (Cr) = revenue × ebitda_margin
        if self.ebitda_margin_pct is not None and self.revenue_cr > 0:
            self._ebitda_cr = self.revenue_cr * (self.ebitda_margin_pct / 100.0)

        # PAT (Cr) = revenue × pat_margin
        if self.pat_margin_pct is not None and self.revenue_cr > 0:
            self._pat_cr = self.revenue_cr * (self.pat_margin_pct / 100.0)

        # EBIT (Cr) ≈ EBITDA × 0.85 (rough D&A drag if not direct)
        if self._ebitda_cr is not None:
            self._ebit_cr = self._ebitda_cr * 0.85

        # Net Debt = Debt − Cash
        self._net_debt_cr = (self.debt_cr or 0.0) - (self.cash_cr or 0.0)

        # Enterprise Value = MCap + Net Debt
        if self.market_cap_cr > 0:
            self._ev_cr = self.market_cap_cr + (self._net_debt_cr or 0.0)

        # FCF (Cr) — derive from margin if not direct
        if self.fcf_cr is None and self.fcf_margin_pct is not None and self.revenue_cr > 0:
            self.fcf_cr = self.revenue_cr * (self.fcf_margin_pct / 100.0)

        # If EPS not given but PAT and shares known, derive
        if self.eps is None and self._pat_cr is not None and self.shares_outstanding_cr:
            self.eps = self._pat_cr / self.shares_outstanding_cr

        # Conservative ROE fallback from ROCE
        if self.roe_pct is None and self.roce_pct is not None:
            self.roe_pct = self.roce_pct * 0.85

    def fork(self, **overrides) -> 'ValuationInputs':
        """Create a new ValuationInputs with overrides applied.
        Skips private derived fields (computed automatically in __post_init__).
        """
        public = {k: v for k, v in self.__dict__.items() if not k.startswith('_')}
        public.update(overrides)
        return ValuationInputs(**public)
