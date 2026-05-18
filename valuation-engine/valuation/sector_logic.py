"""
Sector classifier + valuation routing.

Maps free-form sector text to a `BusinessType`, then exposes which
valuation lenses are appropriate for that business type.

Example:
    bt = classify_business('Banks')           # → 'BANK_NBFC'
    use_dcf(bt)                                # → False
    use_pb_roe(bt)                             # → True
    use_ev_sales(bt)                           # → False
    use_rule_of_40(bt)                         # → False
"""
from __future__ import annotations

import re
from typing import Literal

BusinessType = Literal[
    'BANK_NBFC',
    'INSURANCE',
    'SAAS_SOFTWARE',
    'IT_SERVICES',
    'PHARMA_BIOTECH',
    'SPECIALTY_CHEM',
    'CONSUMER_STAPLES',
    'CONSUMER_DISCRETIONARY',
    'AUTO_AUTO_COMP',
    'CAPITAL_GOODS',
    'INDUSTRIAL_MFG',
    'INFRA_POWER',
    'COMMODITY_METAL',
    'CEMENT',
    'REALTY',
    'TELECOM',
    'OIL_GAS',
    'PLATFORM_ECOM',
    'MEDIA_ENTERTAIN',
    'AGRI_FOOD',
    'DEFAULT',
]


def classify_business(sector: str) -> BusinessType:
    """Map a free-form sector / industry name to a BusinessType bucket."""
    if not sector:
        return 'DEFAULT'
    s = sector.upper()
    if re.search(r'BANK|NBFC|HOUSING\s*FIN|MICRO\s*FIN|MORTGAGE|LENDING|\bFINANCE\b|CONSUMER\s*FIN|CREDIT', s):
        return 'BANK_NBFC'
    if re.search(r'INSURANCE|REINSURANCE', s):
        return 'INSURANCE'
    if re.search(r'SAAS|SOFTWARE\s*AS|CLOUD\s*COMP', s):
        return 'SAAS_SOFTWARE'
    if re.search(r'SOFTWARE', s):
        return 'SAAS_SOFTWARE'
    if re.search(r'IT\s*-\s*SERV|IT\s*SERV|INFOTECH|TECH\s*-\s*SERV', s):
        return 'IT_SERVICES'
    if re.search(r'PHARMA|BIOTECH|HEALTHCARE|HOSPITAL|DIAGNOSTIC|MEDICAL', s):
        return 'PHARMA_BIOTECH'
    if re.search(r'SPECIALTY\s*CHEM|CHEMICAL|PETROCHEM|AGROCHEM|FERTILI[SZ]ER', s):
        return 'SPECIALTY_CHEM'
    if re.search(r'PERSONAL\s*PROD|FMCG|HOUSEHOLD|TOBACCO|CONSUMER\s*STAPLE|FOOD\s*PRODUCT|BEVERAGE', s):
        return 'CONSUMER_STAPLES'
    if re.search(r'RETAIL|APPAREL|JEWELL?ERY|LEISURE|HOTEL|RESTAURANT|CONSUMER\s*DUR', s):
        return 'CONSUMER_DISCRETIONARY'
    if re.search(r'AUTOMOBILE|AUTO\s*COMP|AUTOMOTIVE|VEHICLE', s):
        return 'AUTO_AUTO_COMP'
    if re.search(r'CAPITAL\s*GOODS|ELECTRICAL\s*EQUIP|MACHINERY', s):
        return 'CAPITAL_GOODS'
    if re.search(r'INDUSTRIAL\s*PROD|INDUSTRIAL\s*MFG|COMMERCIAL\s*SERV|AEROSPACE|DEFEN[CS]E|ENGINEERING', s):
        return 'INDUSTRIAL_MFG'
    if re.search(r'POWER|UTILIT(Y|IES)|RENEWABLE|TRANSMISSION|INFRA|CONSTRUCT', s):
        return 'INFRA_POWER'
    if re.search(r'METAL|STEEL|IRON|ALUMIN|COPPER|ZINC|MINING|MINERAL|FERROUS|NON\s*-?\s*FERROUS', s):
        return 'COMMODITY_METAL'
    if re.search(r'CEMENT|TILE|CERAMIC|GLASS', s):
        return 'CEMENT'
    if re.search(r'REALTY|REAL\s*ESTATE|RESIDENTIAL|COMMERCIAL\s*PROJECT', s):
        return 'REALTY'
    if re.search(r'TELECOM', s):
        return 'TELECOM'
    if re.search(r'OIL|GAS|PETROLEUM|CRUDE|REFINER', s):
        return 'OIL_GAS'
    if re.search(r'E[\s-]*COMMERCE|PLATFORM|MARKETPLACE|FINTECH|INTERNET', s):
        return 'PLATFORM_ECOM'
    if re.search(r'MEDIA|ENTERTAIN|BROADCAST|MUSIC|FILM|GAMING', s):
        return 'MEDIA_ENTERTAIN'
    if re.search(r'AGRI|FOOD\s*OTHER|EDIBLE\s*OIL|SUGAR|TEA|COFFEE', s):
        return 'AGRI_FOOD';
    return 'DEFAULT'


# ─────────────────────────────────────────────────────────────────────────
# Lens flags — which valuation approach applies?
# ─────────────────────────────────────────────────────────────────────────

def use_dcf(bt: BusinessType) -> bool:
    """Standard FCFF DCF. Disabled for banks/NBFCs (use excess return)."""
    return bt not in ('BANK_NBFC', 'INSURANCE')


def use_fcfe(bt: BusinessType) -> bool:
    """FCFE / excess return model — for leveraged financials."""
    return bt in ('BANK_NBFC', 'INSURANCE')


def use_pb_roe(bt: BusinessType) -> bool:
    """P/B × ROE relative valuation — primary for banks/NBFCs."""
    return bt in ('BANK_NBFC', 'INSURANCE')


def use_ev_ebitda(bt: BusinessType) -> bool:
    """EV/EBITDA — disabled for banks (debt is operating)."""
    if bt in ('BANK_NBFC', 'INSURANCE'):
        return False
    return True


def use_ev_sales(bt: BusinessType) -> bool:
    """EV/Sales — for SaaS, platforms, pre-profit names."""
    return bt in ('SAAS_SOFTWARE', 'PLATFORM_ECOM')


def use_rule_of_40(bt: BusinessType) -> bool:
    """Rule of 40 (growth + FCF margin ≥ 40%) — for SaaS."""
    return bt == 'SAAS_SOFTWARE'


def use_normalized_ebitda(bt: BusinessType) -> bool:
    """Use mid-cycle EBITDA — for cyclicals/commodities."""
    return bt in ('COMMODITY_METAL', 'CEMENT', 'OIL_GAS', 'AUTO_AUTO_COMP')


def use_contribution_margin(bt: BusinessType) -> bool:
    """Contribution margin × scale model — for platforms."""
    return bt == 'PLATFORM_ECOM'


def use_pe(bt: BusinessType) -> bool:
    """P/E lens applicable when earnings are positive and stable."""
    return bt not in ('PLATFORM_ECOM', 'COMMODITY_METAL')  # commodity at cycle peak misleading


def avoid_gross_margin(bt: BusinessType) -> bool:
    """Some business models don't have a meaningful gross margin."""
    return bt in ('BANK_NBFC', 'INSURANCE')


# ─────────────────────────────────────────────────────────────────────────
# Display name
# ─────────────────────────────────────────────────────────────────────────

BUSINESS_TYPE_LABELS: dict[BusinessType, str] = {
    'BANK_NBFC':              'Bank / NBFC',
    'INSURANCE':              'Insurance',
    'SAAS_SOFTWARE':          'SaaS / Software',
    'IT_SERVICES':            'IT Services',
    'PHARMA_BIOTECH':         'Pharma / Biotech',
    'SPECIALTY_CHEM':         'Specialty Chemicals',
    'CONSUMER_STAPLES':       'Consumer Staples (FMCG)',
    'CONSUMER_DISCRETIONARY': 'Consumer Discretionary',
    'AUTO_AUTO_COMP':         'Auto / Auto Components',
    'CAPITAL_GOODS':          'Capital Goods',
    'INDUSTRIAL_MFG':         'Industrial Manufacturing',
    'INFRA_POWER':            'Infra / Power',
    'COMMODITY_METAL':        'Commodity / Metals',
    'CEMENT':                 'Cement / Building Materials',
    'REALTY':                 'Real Estate',
    'TELECOM':                'Telecom',
    'OIL_GAS':                'Oil / Gas',
    'PLATFORM_ECOM':          'Platform / E-commerce',
    'MEDIA_ENTERTAIN':        'Media / Entertainment',
    'AGRI_FOOD':              'Agri / Food',
    'DEFAULT':                'General',
}
