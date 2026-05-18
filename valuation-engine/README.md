# 💰 Equity Valuation Engine

Institutional-grade automated valuation toolkit. Built for hedge funds, family offices, and serious long-term investors.

Behaves like a buy-side analyst desk:
- Auto-routes to the correct valuation framework based on sector
- Uses **DCF (FCFF)** for non-financials, **FCFE / excess return** for banks/NBFCs
- Sector-aware relative multiples (EV/EBITDA, P/E, P/B, EV/Sales, P/B × ROE)
- Quality scoring across 5 dimensions
- Monte Carlo probabilistic valuation
- Reverse DCF (implied market expectations)
- 5-year expected return decomposition
- AI-style natural-language commentary
- Auto risk-flag detection (governance, leverage, cash conversion, etc)

## Architecture

```
valuation-engine/
├── app.py                          ← Streamlit entry (5 tabs)
├── requirements.txt
├── README.md                       ← this file
├── DEPLOYMENT.md                   ← Streamlit Cloud guide
├── valuation/
│   ├── inputs.py                   ← typed ValuationInputs dataclass
│   ├── sector_logic.py             ← business-type classifier
│   ├── dcf.py                      ← FCFF + FCFE DCF
│   ├── relative.py                 ← multiple-based valuation
│   ├── quality.py                  ← 5-dimension quality score
│   ├── reverse_dcf.py              ← implied growth solver
│   ├── monte_carlo.py              ← 2000-trial simulation
│   ├── return_decomposition.py     ← CAGR = EPS growth + rerating + dividends
│   └── risk_flags.py               ← auto warning system
├── assumptions/
│   ├── sector_defaults.py          ← 21 sector buckets (WACC, exit P/E, β)
│   └── country.py                  ← India + USA macro inputs
├── utils/
│   ├── finance.py                  ← CAGR, NPV, CAPM, growth decay
│   ├── csv_loader.py               ← Screener.in CSV → ValuationInputs
│   └── formatting.py
├── visualizations/
│   └── charts.py                   ← Plotly dashboards
├── templates/
│   └── ai_commentary.py            ← natural-language interpretation
└── sample_data/
    └── working-watchlist-sample.csv
```

## Run locally

```bash
cd valuation-engine
pip install -r requirements.txt
streamlit run app.py
```

App opens at `http://localhost:8501`.

## Inputs

**Mandatory** (12 fields):
- Company name + sector
- Current price (CMP) + market cap
- Revenue, EBITDA margin, PAT margin, ROCE
- Revenue growth 3y CAGR
- Debt, cash, shares outstanding

**Optional refinements:**
- FCF margin / FCF absolute
- ROE, gross margin, OPM 5y avg
- Profit growth 3y, YoY quarterly growth
- P/E, P/B, EV/EBITDA, Industry P/E, Historical P/E 5y
- Promoter %, pledge %, FII %, DII %
- D/E, CFO/PAT, Interest Coverage
- NIM, GNPA, NNPA (banks/NBFCs)
- Cost of equity / terminal growth / WACC overrides
- Concall guidance: growth %, EBITDA margin %, fiscal year

**CSV upload** — drag any Screener.in custom-query export. The loader auto-resolves column-name variations.

## How it routes valuation

| Sector | Primary | Skipped | Multiples |
|---|---|---|---|
| Banks / NBFCs | FCFE excess return + P/B-ROE | DCF, EV/EBITDA, gross margin | P/B × ROE, P/E |
| SaaS / Software | DCF + Rule of 40 + EV/Sales | EPV, Asset Floor | EV/Sales, EV/ARR |
| IT Services | DCF | — | P/E, EV/EBITDA |
| Pharma / Biotech | DCF | — | P/E, EV/EBITDA |
| Consumer Staples | DCF (premium multiples) | — | P/E (premium), EV/EBITDA |
| Auto / Auto Comp | DCF + cyclical haircut | — | P/E, EV/EBITDA |
| Capital Goods | DCF | — | P/E, EV/EBITDA |
| Cyclical / Metals | EV/EBITDA × mid-cycle margins | DCF (avoid peak earnings) | EV/EBITDA normalized |
| Cement | DCF with mean-revert margins | — | EV/EBITDA, P/E |
| Real Estate | NAV / DCF | — | P/E, EV/EBITDA |
| Platform / E-commerce | Contribution margin + EV/Sales | EV/EBITDA (negative) | EV/Sales, GMV multiples |
| Oil / Gas | DCF (cycle-aware) | — | EV/EBITDA |
| Insurance | Embedded value model + P/B | DCF | P/B, P/E |

## Quality Score (0-100)

Weighted blend:
- **Profitability** (30%): ROCE / ROE / EBITDA margin
- **Capital Allocation** (20%): CFO/PAT, FCF margin
- **Balance Sheet** (20%): D/E, interest coverage
- **Moat** (15%): gross margin, ROCE proxy
- **Governance** (15%): promoter holding, pledge, FII/DII trust

## Risk Flags (severity-graded)

Automatic detection of:
- ROCE < WACC (capital destruction)
- ROE < CoE for financials (equity destruction)
- CFO/PAT < 0.6 (weak cash conversion)
- Negative FCF
- D/E > 3 (non-financial)
- Pledge > 50% (forced sale risk)
- P/E > 100 without growth justification
- NBFC: GNPA > 3.5%, NNPA > 1.5%
- SaaS: Rule of 40 < 20

## Streamlit Cloud deployment

See `DEPLOYMENT.md`.

## API integration roadmap

Hooks ready for:
- Yahoo Finance (`yfinance`)
- Financial Modeling Prep (FMP API)
- Screener.in CSV (already supported)
- Alpha Vantage
- TIKR

Add an `api/<provider>.py` module that returns `ValuationInputs` — engine consumes any source identically.

## License

MIT — production-quality, extensible. Not investment advice.
