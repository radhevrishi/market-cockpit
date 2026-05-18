"""
Plotly chart builders. Dark theme by default.
"""
from __future__ import annotations

import plotly.graph_objects as go
import numpy as np


TEMPLATE = 'plotly_dark'
ACCENT = '#a78bfa'
GREEN = '#10b981'
RED = '#ef4444'
AMBER = '#f59e0b'


def sensitivity_heatmap(grid: dict, cmp: float, title: str = 'DCF Sensitivity — WACC × Terminal Growth') -> go.Figure:
    if not grid:
        return go.Figure()
    z = grid['grid']
    waccs = [f'{w:.1f}%' for w in grid['waccs_pct']]
    gs = [f'{g:.1f}%' for g in grid['growths_pct']]
    fig = go.Figure(data=go.Heatmap(
        z=z, x=gs, y=waccs,
        text=[[f'₹{v:,.0f}' for v in row] for row in z],
        texttemplate='%{text}', textfont={'size': 11},
        colorscale=[[0, RED], [0.5, AMBER], [1, GREEN]],
        zmid=cmp if cmp > 0 else None,
        colorbar=dict(title='Intrinsic ₹'),
    ))
    fig.update_layout(
        template=TEMPLATE, title=title,
        xaxis_title='Terminal Growth', yaxis_title='WACC',
        height=400,
    )
    return fig


def quality_radar(quality, title: str = 'Quality Profile') -> go.Figure:
    categories = ['Profitability', 'Capital Allocation', 'Balance Sheet', 'Moat', 'Governance']
    values = [quality.profitability, quality.capital_allocation, quality.balance_sheet,
              quality.moat, quality.governance]
    fig = go.Figure(data=go.Scatterpolar(
        r=values + [values[0]],
        theta=categories + [categories[0]],
        fill='toself',
        fillcolor='rgba(167,139,250,0.25)',
        line=dict(color=ACCENT, width=2),
    ))
    fig.update_layout(
        template=TEMPLATE, title=title,
        polar=dict(radialaxis=dict(visible=True, range=[0, 100])),
        showlegend=False, height=380,
    )
    return fig


def valuation_bridge(cmp: float, dcf_ps: float | None, rel_ps: float | None,
                     consensus_ps: float | None) -> go.Figure:
    fig = go.Figure()
    labels = ['CMP']
    values = [cmp]
    colors = ['#64748b']
    if dcf_ps:
        labels.append('DCF')
        values.append(dcf_ps)
        colors.append(ACCENT)
    if rel_ps:
        labels.append('Relative')
        values.append(rel_ps)
        colors.append('#22d3ee')
    if consensus_ps:
        labels.append('Consensus')
        values.append(consensus_ps)
        colors.append(GREEN if consensus_ps > cmp else RED)
    fig.add_trace(go.Bar(x=labels, y=values, marker_color=colors,
                         text=[f'₹{v:,.0f}' for v in values], textposition='outside'))
    fig.update_layout(template=TEMPLATE, title='Valuation Bridge',
                      yaxis_title='₹ per share', height=380, showlegend=False)
    return fig


def monte_carlo_distribution(samples: list[float], cmp: float, p10: float,
                             p50: float, p90: float) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Histogram(x=samples, nbinsx=60, marker_color=ACCENT, opacity=0.7,
                               name='Intrinsic distribution'))
    # Reference lines
    fig.add_vline(x=cmp, line_dash='dash', line_color='white',
                  annotation_text=f'CMP ₹{cmp:,.0f}', annotation_position='top')
    fig.add_vline(x=p10, line_dash='dot', line_color=RED, annotation_text=f'P10 ₹{p10:,.0f}')
    fig.add_vline(x=p50, line_dash='dash', line_color=AMBER, annotation_text=f'Median ₹{p50:,.0f}')
    fig.add_vline(x=p90, line_dash='dot', line_color=GREEN, annotation_text=f'P90 ₹{p90:,.0f}')
    fig.update_layout(template=TEMPLATE, title='Monte Carlo — 2000 Trials',
                      xaxis_title='Intrinsic ₹ per share', yaxis_title='Frequency',
                      height=380, showlegend=False)
    return fig


def scenario_bar(bear: float, base: float, bull: float, cmp: float) -> go.Figure:
    fig = go.Figure(data=go.Bar(
        x=['Bear', 'Base', 'Bull'],
        y=[bear, base, bull],
        marker_color=[RED, AMBER, GREEN],
        text=[f'₹{v:,.0f}' for v in [bear, base, bull]],
        textposition='outside',
    ))
    fig.add_hline(y=cmp, line_dash='dash', line_color='white',
                  annotation_text=f'CMP ₹{cmp:,.0f}')
    fig.update_layout(template=TEMPLATE, title='Bull / Base / Bear',
                      yaxis_title='Intrinsic ₹', height=380, showlegend=False)
    return fig


def return_decomposition_chart(rd) -> go.Figure:
    if rd is None:
        return go.Figure()
    fig = go.Figure(data=go.Bar(
        x=['EPS growth', 'Re-rating', 'Dividends', 'Total CAGR'],
        y=[rd.eps_growth_pct, rd.rerating_pct, rd.dividend_yield_pct, rd.expected_5y_cagr_pct],
        marker_color=[ACCENT, '#22d3ee', GREEN, AMBER],
        text=[f'{v:+.1f}%' for v in [rd.eps_growth_pct, rd.rerating_pct, rd.dividend_yield_pct, rd.expected_5y_cagr_pct]],
        textposition='outside',
    ))
    fig.update_layout(template=TEMPLATE, title='5-Year Return Decomposition',
                      yaxis_title='%', height=320, showlegend=False)
    return fig
