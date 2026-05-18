"""
Country-level macro inputs for valuation.

Risk-free rate = 10Y government bond yield.
Equity Risk Premium (ERP) = historical equity premium over risk-free.
Country Risk Premium = sovereign-spread adjustment (only relevant when
valuing one country's stocks with another country's investor perspective).

Updated periodically. Override in app sidebar.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class CountryAssumptions:
    name: str
    risk_free_rate: float          # 10Y gov yield (decimal)
    equity_risk_premium: float     # historical ERP
    country_risk_premium: float    # additional spread for EM
    long_run_inflation: float      # real anchor for terminal growth
    default_tax_rate: float


INDIA = CountryAssumptions(
    name='INDIA',
    risk_free_rate=0.072,           # 10Y G-sec ~7.2%
    equity_risk_premium=0.060,      # ERP ~6%
    country_risk_premium=0.000,     # baked into ERP for domestic investor
    long_run_inflation=0.04,        # 4% RBI target
    default_tax_rate=0.2517,        # India 25.17% (new regime)
)

USA = CountryAssumptions(
    name='USA',
    risk_free_rate=0.045,           # 10Y UST ~4.5%
    equity_risk_premium=0.050,      # ERP ~5%
    country_risk_premium=0.000,
    long_run_inflation=0.025,
    default_tax_rate=0.21,
)


def get_country(name: str) -> CountryAssumptions:
    if name.upper() == 'USA':
        return USA
    return INDIA
