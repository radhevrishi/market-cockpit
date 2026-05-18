"""
Sector-default assumptions for valuation models.

WACC, terminal growth, exit P/E and exit EV/EBITDA per business type.
These are reasonable institutional anchors; the app exposes overrides.
"""
from dataclasses import dataclass

from valuation.sector_logic import BusinessType


@dataclass(frozen=True)
class SectorAssumption:
    bucket: BusinessType
    beta: float
    wacc: float                  # decimal
    terminal_growth: float       # decimal
    cost_of_equity: float        # decimal
    exit_pe: float
    exit_ev_ebitda: float
    sustainable_roe_for_pb_roe: float  # used by P/B-ROE for financials


SECTOR_DEFAULTS: dict[BusinessType, SectorAssumption] = {
    'BANK_NBFC':              SectorAssumption('BANK_NBFC',              1.10, 0.115, 0.050, 0.135, 18, 0,  0.16),
    'INSURANCE':              SectorAssumption('INSURANCE',              0.95, 0.110, 0.050, 0.130, 22, 0,  0.14),
    'SAAS_SOFTWARE':          SectorAssumption('SAAS_SOFTWARE',          1.25, 0.130, 0.045, 0.145, 35, 25, 0.20),
    'IT_SERVICES':            SectorAssumption('IT_SERVICES',            0.90, 0.125, 0.045, 0.135, 26, 18, 0.22),
    'PHARMA_BIOTECH':         SectorAssumption('PHARMA_BIOTECH',         0.85, 0.120, 0.040, 0.130, 26, 17, 0.18),
    'SPECIALTY_CHEM':         SectorAssumption('SPECIALTY_CHEM',         1.00, 0.125, 0.040, 0.135, 30, 20, 0.17),
    'CONSUMER_STAPLES':       SectorAssumption('CONSUMER_STAPLES',       0.75, 0.115, 0.045, 0.125, 40, 26, 0.30),
    'CONSUMER_DISCRETIONARY': SectorAssumption('CONSUMER_DISCRETIONARY', 1.00, 0.125, 0.040, 0.135, 32, 20, 0.22),
    'AUTO_AUTO_COMP':         SectorAssumption('AUTO_AUTO_COMP',         1.15, 0.130, 0.035, 0.140, 22, 13, 0.16),
    'CAPITAL_GOODS':          SectorAssumption('CAPITAL_GOODS',          1.10, 0.130, 0.040, 0.140, 28, 17, 0.18),
    'INDUSTRIAL_MFG':         SectorAssumption('INDUSTRIAL_MFG',         1.10, 0.130, 0.040, 0.140, 24, 15, 0.17),
    'INFRA_POWER':            SectorAssumption('INFRA_POWER',            0.90, 0.115, 0.035, 0.130, 18, 11, 0.13),
    'COMMODITY_METAL':        SectorAssumption('COMMODITY_METAL',        1.40, 0.145, 0.030, 0.150, 12, 6,  0.12),
    'CEMENT':                 SectorAssumption('CEMENT',                 1.05, 0.130, 0.035, 0.140, 22, 13, 0.14),
    'REALTY':                 SectorAssumption('REALTY',                 1.30, 0.140, 0.030, 0.150, 18, 11, 0.12),
    'TELECOM':                SectorAssumption('TELECOM',                0.95, 0.120, 0.035, 0.130, 24, 11, 0.12),
    'OIL_GAS':                SectorAssumption('OIL_GAS',                1.05, 0.130, 0.030, 0.140, 14, 7,  0.13),
    'PLATFORM_ECOM':          SectorAssumption('PLATFORM_ECOM',          1.30, 0.140, 0.045, 0.150, 40, 30, 0.18),
    'MEDIA_ENTERTAIN':        SectorAssumption('MEDIA_ENTERTAIN',        1.10, 0.130, 0.040, 0.140, 24, 14, 0.18),
    'AGRI_FOOD':              SectorAssumption('AGRI_FOOD',              0.85, 0.120, 0.040, 0.130, 26, 16, 0.18),
    'DEFAULT':                SectorAssumption('DEFAULT',                1.00, 0.125, 0.040, 0.135, 22, 15, 0.18),
}


def get_sector_assumption(bt: BusinessType) -> SectorAssumption:
    return SECTOR_DEFAULTS.get(bt, SECTOR_DEFAULTS['DEFAULT'])
