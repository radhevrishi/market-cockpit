"""
Screener.in CSV → ValuationInputs

Tolerant of column-name variations. Returns a list of ValuationInputs for
every parseable row. Headers are matched by tolerant alias resolution.
"""
from __future__ import annotations

import pandas as pd
from typing import Optional

from valuation.inputs import ValuationInputs


# Column-name aliases (case-insensitive, trimmed match)
ALIASES: dict[str, list[str]] = {
    'company':              ['Name', 'Company', 'Company Name'],
    'nse_code':             ['NSE Code', 'NSE'],
    'bse_code':             ['BSE Code', 'BSE'],
    'sector':               ['Industry Group', 'Industry', 'Sector'],
    'cmp':                  ['Current Price', 'CMP', 'Price'],
    'mcap':                 ['Market Capitalization', 'Market Cap', 'MCap'],
    'revenue':              ['Sales', 'Revenue', 'Sales (TTM)'],
    'pe':                   ['Price to Earning', 'P/E', 'PE'],
    'pb':                   ['Price to book value', 'P/B', 'PB'],
    'peg':                  ['PEG Ratio', 'PEG'],
    'ev_ebitda':            ['EVEBITDA', 'EV/EBITDA', 'EV / EBITDA'],
    'opm':                  ['OPM', 'EBITDA Margin', 'Operating Profit Margin'],
    'opm_5y':               ['OPM 5Year', 'OPM 5 Year'],
    'roce':                 ['Return on capital employed', 'ROCE'],
    'roe':                  ['Return on equity', 'ROE'],
    'roic':                 ['Return on invested capital', 'ROIC'],
    'cfo_to_pat':           ['CFO to PAT'],
    'de':                   ['Debt to equity', 'D/E'],
    'icr':                  ['Interest Coverage Ratio', 'Interest Coverage', 'ICR'],
    'sales_3y':             ['Sales growth 3Years', 'Sales growth 3 Years'],
    'profit_3y':            ['Profit growth 3Years', 'Profit growth 3 Years'],
    'sales_yoy':            ['YOY Quarterly sales growth'],
    'profit_yoy':           ['YOY Quarterly profit growth'],
    'sales_ttm':            ['Sales growth'],
    'profit_ttm':           ['Profit growth'],
    'eps':                  ['EPS'],
    'bvps':                 ['Book value', 'Book Value', 'Book Value per Share'],
    'ebit':                 ['EBIT'],
    'ev':                   ['Enterprise Value', 'EV'],
    'industry_pe':          ['Industry PE'],
    'historical_pe_5y':     ['Historical PE 5Years', 'Historical PE 5 Years'],
    'debt':                 ['Debt'],
    'fcf':                  ['Free cash flow last year', 'Free Cash Flow', 'FCF'],
    'promoter':             ['Promoter holding'],
    'pledge':               ['Pledged percentage', 'Pledged Percentage'],
    'fii':                  ['FII holding'],
    'dii':                  ['DII holding'],
    'gpm':                  ['GPM latest quarter', 'Gross profit margin', 'Gross Profit Margin'],
}


def _resolve(df_cols: list[str], key: str) -> Optional[str]:
    """Find a column in df_cols matching any alias for `key`."""
    targets = [t.strip().lower() for t in ALIASES.get(key, [])]
    for col in df_cols:
        if col.strip().lower() in targets:
            return col
    return None


def _f(row, col_map: dict, key: str) -> Optional[float]:
    """Fetch a float from row given the resolved column map."""
    col = col_map.get(key)
    if not col:
        return None
    val = row.get(col)
    if pd.isna(val) or val == '' or val is None:
        return None
    try:
        return float(str(val).replace(',', '').replace('%', '').replace('₹', '').strip())
    except (ValueError, TypeError):
        return None


def parse_csv(file) -> list[ValuationInputs]:
    """Parse a Screener.in-style CSV. Returns one ValuationInputs per row."""
    df = pd.read_csv(file)
    cols = list(df.columns)
    col_map = {k: _resolve(cols, k) for k in ALIASES.keys()}
    out: list[ValuationInputs] = []
    for _, row in df.iterrows():
        company = str(row.get(col_map.get('company') or '', '') or '').strip()
        if not company:
            continue
        sector = str(row.get(col_map.get('sector') or '', '') or '').strip() or 'DEFAULT'
        symbol = str(row.get(col_map.get('nse_code') or '', '') or '').strip() or \
                 str(row.get(col_map.get('bse_code') or '', '') or '').strip()

        cmp = _f(row, col_map, 'cmp') or 0.0
        mcap = _f(row, col_map, 'mcap') or 0.0
        revenue = _f(row, col_map, 'revenue') or 0.0

        ebit = _f(row, col_map, 'ebit')
        opm = _f(row, col_map, 'opm')
        pat_margin = None
        if revenue > 0:
            # Derive PAT margin from EPS × shares / revenue if possible
            eps = _f(row, col_map, 'eps')
            shares = mcap / cmp if (cmp and mcap) else None
            if eps and shares:
                pat = eps * shares
                pat_margin = pat / revenue * 100

        ev = _f(row, col_map, 'ev')
        debt = _f(row, col_map, 'debt') or 0.0
        cash = max(0.0, (ev or mcap) - mcap - debt) if ev else 0.0

        inp = ValuationInputs(
            company=company,
            ticker=symbol or None,
            sector=sector,
            country='INDIA',
            cmp=cmp,
            market_cap_cr=mcap,
            revenue_cr=revenue,
            ebitda_margin_pct=opm,
            pat_margin_pct=pat_margin,
            roce_pct=_f(row, col_map, 'roce'),
            revenue_growth_3y_pct=_f(row, col_map, 'sales_3y'),
            debt_cr=debt,
            cash_cr=cash,
            eps=_f(row, col_map, 'eps'),
            book_value_per_share=_f(row, col_map, 'bvps'),

            fcf_cr=_f(row, col_map, 'fcf'),
            roe_pct=_f(row, col_map, 'roe'),
            gross_margin_pct=_f(row, col_map, 'gpm'),
            opm_5y_pct=_f(row, col_map, 'opm_5y'),
            profit_growth_3y_pct=_f(row, col_map, 'profit_3y'),
            yoy_sales_growth_pct=_f(row, col_map, 'sales_yoy'),
            yoy_profit_growth_pct=_f(row, col_map, 'profit_yoy'),
            pe=_f(row, col_map, 'pe'),
            pb=_f(row, col_map, 'pb'),
            ev_ebitda=_f(row, col_map, 'ev_ebitda'),
            industry_pe=_f(row, col_map, 'industry_pe'),
            historical_pe_5y=_f(row, col_map, 'historical_pe_5y'),
            promoter_pct=_f(row, col_map, 'promoter'),
            pledge_pct=_f(row, col_map, 'pledge'),
            fii_pct=_f(row, col_map, 'fii'),
            dii_pct=_f(row, col_map, 'dii'),
            debt_to_equity=_f(row, col_map, 'de'),
            cfo_to_pat=_f(row, col_map, 'cfo_to_pat'),
            interest_coverage=_f(row, col_map, 'icr'),

            inputs_source='CSV',
        )
        out.append(inp)
    return out
