"""
Equity Valuation Engine — Streamlit app.

Run with:
    streamlit run app.py

5 tabs:
  1. Inputs           — manual entry + CSV upload
  2. Valuation Summary — verdict, bridge, sensitivity
  3. DCF Detail        — projections + WACC build-up
  4. Quality & Risk    — radar + risk flags
  5. Scenarios & MC    — Bull/Base/Bear + Monte Carlo distribution
"""
from __future__ import annotations

import streamlit as st
import pandas as pd
from io import BytesIO

from valuation.inputs import ValuationInputs
from valuation.sector_logic import classify_business, BUSINESS_TYPE_LABELS
from valuation.dcf import run_dcf, dcf_sensitivity
from valuation.relative import relative_valuation
from valuation.quality import quality_score
from valuation.reverse_dcf import reverse_dcf
from valuation.monte_carlo import monte_carlo
from valuation.return_decomposition import expected_return
from valuation.risk_flags import detect_risk_flags
from assumptions.sector_defaults import get_sector_assumption
from assumptions.country import get_country
from utils.csv_loader import parse_csv
from utils.formatting import fmt_inr, fmt_cr, fmt_pct, fmt_x
from templates.ai_commentary import generate_commentary
from visualizations import charts


# ───────────────────────────────────────────────────────────────────────────
# Page config
# ───────────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title='Equity Valuation Engine',
    layout='wide',
    initial_sidebar_state='expanded',
    page_icon='💰',
)

st.markdown("""
<style>
.stApp { background-color: #0a0a0f; }
.metric-big { font-size: 28px; font-weight: 800; }
</style>
""", unsafe_allow_html=True)


# ───────────────────────────────────────────────────────────────────────────
# Sidebar — global assumption controls
# ───────────────────────────────────────────────────────────────────────────
st.sidebar.markdown('### ⚙️ Global Assumptions')
country = st.sidebar.selectbox('Country', ['INDIA', 'USA'], index=0)
ctry = get_country(country)
st.sidebar.markdown(f"**Risk-free**: {ctry.risk_free_rate*100:.1f}%")
st.sidebar.markdown(f"**ERP**: {ctry.equity_risk_premium*100:.1f}%")
st.sidebar.markdown(f"**Long-run inflation**: {ctry.long_run_inflation*100:.1f}%")
st.sidebar.markdown(f"**Default tax rate**: {ctry.default_tax_rate*100:.1f}%")
st.sidebar.markdown('---')
st.sidebar.markdown('### 🎚 Overrides (optional)')
wacc_ov = st.sidebar.number_input('WACC override (%)', value=0.0, step=0.5, format='%.2f')
g_ov = st.sidebar.number_input('Terminal growth override (%)', value=0.0, step=0.25, format='%.2f')
five_y_g_ov = st.sidebar.number_input('5y growth override (%)', value=0.0, step=1.0, format='%.1f')


# ───────────────────────────────────────────────────────────────────────────
# Session state for parsed CSV rows
# ───────────────────────────────────────────────────────────────────────────
if 'csv_rows' not in st.session_state:
    st.session_state.csv_rows = []
if 'inputs' not in st.session_state:
    st.session_state.inputs = None


# ───────────────────────────────────────────────────────────────────────────
# Tabs
# ───────────────────────────────────────────────────────────────────────────
st.title('💰 Equity Valuation Engine')
st.caption('Institutional-grade DCF + Relative + Quality scoring. Sector-aware. India + USA. Manual entry or Screener.in CSV.')

tabs = st.tabs([
    '📝 Inputs',
    '📊 Valuation Summary',
    '🔬 DCF Detail',
    '🛡 Quality & Risk',
    '🎲 Scenarios & Monte Carlo',
])


# ── TAB 1: Inputs ─────────────────────────────────────────────────────────
with tabs[0]:
    src = st.radio('Data source', ['Manual entry', 'CSV upload'], horizontal=True)

    if src == 'CSV upload':
        st.markdown('Upload a **Screener.in CSV** (Custom Query Builder export).')
        f = st.file_uploader('CSV file', type=['csv'])
        if f:
            try:
                rows = parse_csv(f)
                st.session_state.csv_rows = rows
                st.success(f'Loaded {len(rows)} stocks from CSV.')
            except Exception as e:
                st.error(f'Could not parse CSV: {e}')
        if st.session_state.csv_rows:
            picks = [f'{r.company} — {r.sector} (CMP ₹{r.cmp:,.0f})' for r in st.session_state.csv_rows]
            idx = st.selectbox('Pick a stock to value', range(len(picks)), format_func=lambda i: picks[i])
            st.session_state.inputs = st.session_state.csv_rows[idx]
            st.markdown(f"**Selected:** {st.session_state.inputs.company} · Industry: {st.session_state.inputs.sector}")

    else:
        # ─── Manual entry form ───
        st.markdown('**Mandatory:** company name, sector, CMP, market cap, revenue, EBITDA margin, ROCE, debt, cash, shares.')
        c1, c2, c3 = st.columns(3)
        with c1:
            company = st.text_input('Company name', 'Example Co')
            sector = st.text_input('Sector / Industry', 'Pharmaceuticals')
            country_inp = st.selectbox('Country', ['INDIA', 'USA'], index=(0 if country == 'INDIA' else 1))
            cmp = st.number_input('CMP (₹)', min_value=0.0, value=500.0, step=10.0)
            mcap = st.number_input('Market Cap (₹ Cr)', min_value=0.0, value=5000.0, step=100.0)
        with c2:
            revenue = st.number_input('Revenue TTM (₹ Cr)', min_value=0.0, value=1000.0, step=50.0)
            ebitda_m = st.number_input('EBITDA Margin (%)', value=18.0, step=1.0)
            pat_m = st.number_input('PAT Margin (%)', value=12.0, step=1.0)
            roce = st.number_input('ROCE (%)', value=22.0, step=1.0)
            rev_g = st.number_input('Revenue Growth 3y CAGR (%)', value=18.0, step=1.0)
        with c3:
            debt = st.number_input('Debt (₹ Cr)', value=200.0, step=10.0)
            cash = st.number_input('Cash (₹ Cr)', value=400.0, step=10.0)
            shares = st.number_input('Shares Outstanding (Cr)', value=10.0, step=0.1)
            eps = st.number_input('EPS (₹)', value=25.0, step=1.0)
            bvps = st.number_input('Book Value per Share (₹)', value=120.0, step=5.0)

        st.markdown('**Optional refinements** (auto-inferred if omitted):')
        c4, c5, c6 = st.columns(3)
        with c4:
            fcf_m = st.number_input('FCF Margin (%)', value=10.0, step=1.0, key='fcf_m')
            roe = st.number_input('ROE (%)', value=18.0, step=1.0, key='roe')
            gpm = st.number_input('Gross Margin (%)', value=40.0, step=1.0, key='gpm')
        with c5:
            opm5y = st.number_input('OPM 5y avg (%)', value=17.0, step=1.0, key='opm5y')
            profit_g = st.number_input('Profit Growth 3y (%)', value=22.0, step=1.0, key='pg')
            de = st.number_input('Debt / Equity', value=0.5, step=0.1, key='de')
        with c6:
            cfo_pat = st.number_input('CFO / PAT', value=1.0, step=0.1, key='cfo')
            icr = st.number_input('Interest Coverage', value=8.0, step=0.5, key='icr')
            promoter = st.number_input('Promoter %', value=55.0, step=1.0, key='pr')

        st.markdown('**NBFC / Bank specific** (only if applicable):')
        c7, c8, c9 = st.columns(3)
        with c7: nim = st.number_input('NIM (%)', value=0.0, step=0.1, key='nim')
        with c8: gnpa = st.number_input('GNPA (%)', value=0.0, step=0.1, key='gnpa')
        with c9: nnpa = st.number_input('NNPA (%)', value=0.0, step=0.1, key='nnpa')

        if st.button('💾 Build Valuation Inputs', type='primary'):
            st.session_state.inputs = ValuationInputs(
                company=company, sector=sector, country=country_inp,
                cmp=cmp, market_cap_cr=mcap, shares_outstanding_cr=shares,
                revenue_cr=revenue, ebitda_margin_pct=ebitda_m, pat_margin_pct=pat_m,
                roce_pct=roce, revenue_growth_3y_pct=rev_g,
                debt_cr=debt, cash_cr=cash, eps=eps, book_value_per_share=bvps,
                fcf_margin_pct=fcf_m, roe_pct=roe, gross_margin_pct=gpm,
                opm_5y_pct=opm5y, profit_growth_3y_pct=profit_g,
                debt_to_equity=de, cfo_to_pat=cfo_pat, interest_coverage=icr,
                promoter_pct=promoter,
                nim_pct=nim or None, gnpa_pct=gnpa or None, nnpa_pct=nnpa or None,
                cost_of_equity_override=None,
                terminal_growth_override=(g_ov / 100.0) if g_ov else None,
                wacc_override=(wacc_ov / 100.0) if wacc_ov else None,
                five_year_growth_override_pct=(five_y_g_ov if five_y_g_ov else None),
                inputs_source='MANUAL',
            )
            st.success('Inputs saved. Switch to "Valuation Summary" tab.')

    # Apply sidebar overrides to whatever is selected
    if st.session_state.inputs:
        if wacc_ov:
            st.session_state.inputs.wacc_override = wacc_ov / 100.0
        if g_ov:
            st.session_state.inputs.terminal_growth_override = g_ov / 100.0
        if five_y_g_ov:
            st.session_state.inputs.five_year_growth_override_pct = five_y_g_ov


# ───────────────────────────────────────────────────────────────────────────
# Helper — guard against no inputs
# ───────────────────────────────────────────────────────────────────────────
def require_inputs() -> ValuationInputs | None:
    if not st.session_state.inputs:
        st.warning('⚠ Please supply inputs in the "Inputs" tab first.')
        return None
    return st.session_state.inputs


# ── TAB 2: Valuation Summary ──────────────────────────────────────────────
with tabs[1]:
    inp = require_inputs()
    if inp:
        bt = classify_business(inp.sector)
        a = get_sector_assumption(bt)
        st.markdown(f"### {inp.company} · {BUSINESS_TYPE_LABELS.get(bt, bt)}")
        st.caption(f"Sector input: {inp.sector} → routed to **{bt}** · WACC {a.wacc*100:.1f}% · Exit P/E {a.exit_pe}× · Terminal g {a.terminal_growth*100:.1f}%")

        dcf = run_dcf(inp)
        rel = relative_valuation(inp)
        quality = quality_score(inp)
        rev = reverse_dcf(inp)
        rd = expected_return(inp)
        flags = detect_risk_flags(inp)

        # Headline metric cards
        m1, m2, m3, m4 = st.columns(4)
        with m1:
            st.markdown('CMP')
            st.markdown(f"<div class='metric-big'>{fmt_inr(inp.cmp)}</div>", unsafe_allow_html=True)
        with m2:
            ps = dcf.intrinsic_per_share if dcf else None
            st.markdown(f'Intrinsic ({dcf.model if dcf else "—"})')
            st.markdown(f"<div class='metric-big'>{fmt_inr(ps)}</div>", unsafe_allow_html=True)
        with m3:
            if dcf and inp.cmp:
                mos = (dcf.intrinsic_per_share - inp.cmp) / inp.cmp * 100
                col = '#10b981' if mos > 15 else '#ef4444' if mos < -15 else '#f59e0b'
                st.markdown('Margin of Safety')
                st.markdown(f"<div class='metric-big' style='color:{col}'>{mos:+.0f}%</div>", unsafe_allow_html=True)
            else:
                st.markdown('Margin of Safety')
                st.markdown("<div class='metric-big'>—</div>", unsafe_allow_html=True)
        with m4:
            st.markdown('Quality Score')
            st.markdown(f"<div class='metric-big'>{quality.composite:.0f}/100</div>", unsafe_allow_html=True)

        # Bridge + sensitivity
        col1, col2 = st.columns([1, 1])
        with col1:
            st.plotly_chart(
                charts.valuation_bridge(
                    inp.cmp,
                    dcf.intrinsic_per_share if dcf else None,
                    rel.fair_price_consensus,
                    None,
                ),
                use_container_width=True,
            )
        with col2:
            if dcf:
                grid = dcf_sensitivity(inp)
                st.plotly_chart(charts.sensitivity_heatmap(grid, inp.cmp), use_container_width=True)
            else:
                st.info('DCF not available for this business type / data.')

        # AI commentary
        st.markdown('---')
        st.markdown('### 🤖 AI Commentary')
        st.markdown(generate_commentary(inp, dcf, rel, quality, rev, rd, flags))


# ── TAB 3: DCF Detail ─────────────────────────────────────────────────────
with tabs[2]:
    inp = require_inputs()
    if inp:
        dcf = run_dcf(inp)
        if not dcf:
            st.warning('DCF not applicable / not enough data.')
        else:
            st.markdown(f"### DCF Build-up — {dcf.model}")
            c1, c2, c3 = st.columns(3)
            c1.metric('WACC used', f'{dcf.wacc_used*100:.2f}%')
            c2.metric('Cost of equity', f'{dcf.cost_of_equity*100:.2f}%')
            c3.metric('Cost of debt (after-tax)', f'{dcf.cost_of_debt_after_tax*100:.2f}%')

            c1, c2, c3 = st.columns(3)
            c1.metric('PV forecast period', fmt_cr(dcf.sum_pv_forecast))
            c2.metric('PV terminal', fmt_cr(dcf.pv_terminal))
            c3.metric('Enterprise value', fmt_cr(dcf.enterprise_value_cr))

            c1, c2, c3 = st.columns(3)
            c1.metric('Equity value', fmt_cr(dcf.equity_value_cr))
            c2.metric('Per share intrinsic', fmt_inr(dcf.intrinsic_per_share))
            c3.metric('Terminal value', fmt_cr(dcf.terminal_value_cr))

            st.markdown('#### 📈 Growth path & FCF projection')
            proj_df = pd.DataFrame({
                'Year': [f'FY{i+1}' for i in range(len(dcf.growth_path))],
                'Growth %': [f'{g*100:.1f}%' for g in dcf.growth_path],
                'FCF (₹ Cr)': [f'{f:,.0f}' for f in dcf.fcf_projection],
            })
            st.dataframe(proj_df, hide_index=True, use_container_width=True)

            st.caption(dcf.notes)


# ── TAB 4: Quality & Risk ─────────────────────────────────────────────────
with tabs[3]:
    inp = require_inputs()
    if inp:
        q = quality_score(inp)
        flags = detect_risk_flags(inp)
        c1, c2 = st.columns([1, 1])
        with c1:
            st.plotly_chart(charts.quality_radar(q), use_container_width=True)
        with c2:
            st.markdown(f"### Composite: **{q.composite:.0f} / 100**")
            st.markdown(f"- Profitability: **{q.profitability:.0f}**")
            st.markdown(f"- Capital Allocation: **{q.capital_allocation:.0f}**")
            st.markdown(f"- Balance Sheet: **{q.balance_sheet:.0f}**")
            st.markdown(f"- Moat: **{q.moat:.0f}**")
            st.markdown(f"- Governance: **{q.governance:.0f}**")
            st.caption('  ·  '.join(q.notes))

        st.markdown('### 🚨 Risk Flags')
        if not flags:
            st.success('No structural risk flags detected.')
        else:
            sev_color = {'CRITICAL': '#ef4444', 'HIGH': '#f97316', 'MEDIUM': '#f59e0b', 'LOW': '#94a3b8'}
            for f in flags:
                col = sev_color.get(f.severity, '#94a3b8')
                st.markdown(
                    f"<div style='border-left: 3px solid {col}; padding: 8px 12px; margin: 4px 0; background: #1f1f2e;'>"
                    f"<b style='color:{col}'>{f.severity}</b> · <b>{f.label}</b><br>"
                    f"<span style='color:#94a3b8'>{f.detail}</span></div>",
                    unsafe_allow_html=True,
                )


# ── TAB 5: Scenarios & Monte Carlo ────────────────────────────────────────
with tabs[4]:
    inp = require_inputs()
    if inp:
        st.markdown('### 🎯 Bull / Base / Bear')
        dcf = run_dcf(inp)
        if dcf:
            base = dcf.intrinsic_per_share
            bear = run_dcf(inp.fork(
                wacc_override=dcf.wacc_used + 0.02,
                five_year_growth_override_pct=max(5.0, (dcf.growth_path[0] * 100) * 0.6),
            ))
            bull = run_dcf(inp.fork(
                wacc_override=max(0.08, dcf.wacc_used - 0.015),
                five_year_growth_override_pct=(dcf.growth_path[0] * 100) * 1.25,
            ))
            bear_ps = bear.intrinsic_per_share if bear else base * 0.7
            bull_ps = bull.intrinsic_per_share if bull else base * 1.4
            st.plotly_chart(charts.scenario_bar(bear_ps, base, bull_ps, inp.cmp), use_container_width=True)

        st.markdown('---')
        st.markdown('### 🎲 Monte Carlo — 2000 trials')
        mc = monte_carlo(inp)
        if mc:
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric('P10', fmt_inr(mc.p10))
            c2.metric('P25', fmt_inr(mc.p25))
            c3.metric('Median', fmt_inr(mc.p50))
            c4.metric('P75', fmt_inr(mc.p75))
            c5.metric('P90', fmt_inr(mc.p90))
            st.metric('Probability undervalued', f'{mc.prob_undervalued*100:.0f}%')
            st.plotly_chart(
                charts.monte_carlo_distribution(mc.samples, inp.cmp, mc.p10, mc.p50, mc.p90),
                use_container_width=True,
            )
        else:
            st.info('Monte Carlo requires positive FCF and DCF-applicable sector.')

        st.markdown('---')
        st.markdown('### 🔄 Reverse DCF — implied market expectations')
        rev = reverse_dcf(inp)
        if rev:
            c1, c2, c3 = st.columns(3)
            c1.metric('Implied growth', f'{rev.implied_growth_pct:.1f}%')
            c2.metric('Realistic growth', f'{rev.realistic_growth_pct:.1f}%')
            c3.metric('Gap', f'{rev.gap_pct:+.1f}pp')
            verdict_color = {'STRETCHED': '#ef4444', 'CONSERVATIVE': '#10b981', 'IN_LINE': '#f59e0b'}
            st.markdown(
                f"<div style='padding:10px 14px; border-radius:6px; background:#1f1f2e; "
                f"border-left:4px solid {verdict_color.get(rev.verdict, '#64748b')};'>"
                f"<b>{rev.verdict}</b> — {rev.notes}</div>",
                unsafe_allow_html=True,
            )

        st.markdown('---')
        st.markdown('### 📐 Expected 5-year Return Decomposition')
        rd = expected_return(inp)
        if rd:
            st.plotly_chart(charts.return_decomposition_chart(rd), use_container_width=True)
