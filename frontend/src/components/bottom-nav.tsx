'use client';

// ─────────────────────────────────────────────────────────────────────────
// BOTTOM NAV + ACRONYM REGISTRY — PATCH 1063 (HANDOFF4 continuation)
//
// Two design-audit follow-ups in one drop-in client component file:
//
//   • <BottomNav />          — DESIGN_AUDIT #10 — 5-icon mobile bottom nav.
//                              Renders only at <= 768 px. Highlights the
//                              currently-active section.
//
//   • ACRONYMS + <Acronym />  — DESIGN_AUDIT #4 — central registry of the 30
//     and <AutoAcronyms />     acronyms the audit flagged + a Tooltip
//                              wrapper. <Acronym name="ROCE" /> renders the
//                              text with a hover-tooltip. <AutoAcronyms text="…"/>
//                              scans a string for known acronyms and wraps
//                              each appearance — drop into any page heading
//                              or chip label without per-page imports.
//
// Both pieces depend only on the design-system primitives shipped in
// PATCH 1061. No external libs.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Tooltip } from '@/components/design-system';

// ═════════════════════════════════════════════════════════════════════════
// ACRONYM REGISTRY (DESIGN_AUDIT #4)
// ═════════════════════════════════════════════════════════════════════════

interface AcronymEntry {
  label: string;
  long: string;
  hint?: string;
}

export const ACRONYMS: Record<string, AcronymEntry> = {
  // ── Profitability / returns ────────────────────────────────────────
  ROCE: { label: 'ROCE', long: 'Return on Capital Employed', hint: 'EBIT / (Total Assets − Current Liabilities). Below 10% = wealth-destruction flag (v5.4.8).' },
  ROE:  { label: 'ROE',  long: 'Return on Equity', hint: 'Net Profit / Shareholders Equity. >15% is institutional grade.' },
  ROIC: { label: 'ROIC', long: 'Return on Invested Capital', hint: 'NOPAT / Invested Capital. Cleaner than ROE — excludes non-operating items.' },
  OPM:  { label: 'OPM',  long: 'Operating Profit Margin', hint: 'EBIT / Sales. Track trend, not absolute level.' },
  EBIT: { label: 'EBIT', long: 'Earnings Before Interest and Tax', hint: 'PBT + Interest. The pre-financing operating profit.' },
  EBITDA: { label: 'EBITDA', long: 'Earnings Before Interest, Tax, Depreciation, Amortisation', hint: 'EBIT + D&A. Proxy for operating cash generation.' },
  PAT:  { label: 'PAT',  long: 'Profit After Tax', hint: 'Bottom-line net profit.' },
  PBT:  { label: 'PBT',  long: 'Profit Before Tax', hint: 'Pre-tax operating + financing result.' },
  EPS:  { label: 'EPS',  long: 'Earnings Per Share', hint: 'PAT / Outstanding Shares.' },

  // ── Balance-sheet / capital structure ──────────────────────────────
  CWIP: { label: 'CWIP', long: 'Capital Work In Progress', hint: 'Plant & equipment under construction. >15% of net block = active capex cycle.' },
  CE:   { label: 'CE',   long: 'Capital Employed', hint: 'Equity + Reserves + Borrowings. The total capital deployed in the business.' },
  WC:   { label: 'WC',   long: 'Working Capital', hint: 'Current Assets − Current Liabilities. Rising days = funding stress signal.' },
  DE:   { label: 'D/E',  long: 'Debt-to-Equity', hint: 'Borrowings / Net Worth. >1.5x is a deal-breaker (DB1).' },
  ND:   { label: 'ND',   long: 'Net Debt', hint: 'Borrowings − Cash. The economically meaningful leverage figure.' },
  NB:   { label: 'NB',   long: 'Net Block', hint: 'Gross block of fixed assets less accumulated depreciation.' },

  // ── Cash flow / quality ────────────────────────────────────────────
  OCF:  { label: 'OCF',  long: 'Operating Cash Flow', hint: 'Cash generated from operations. OCF/EBITDA <50% for 2 quarters = quality flag.' },
  FCF:  { label: 'FCF',  long: 'Free Cash Flow', hint: 'OCF − Capex. The cash available to shareholders.' },
  CFO:  { label: 'CFO',  long: 'Cash Flow from Operations', hint: 'Synonym for OCF.' },

  // ── Growth / time ──────────────────────────────────────────────────
  CAGR: { label: 'CAGR', long: 'Compounded Annual Growth Rate', hint: '(End / Start)^(1/n) − 1. Three-year CAGR > 20% scores full F13.' },
  YoY:  { label: 'YoY',  long: 'Year-over-Year', hint: 'Same metric vs the same period one year earlier.' },
  QoQ:  { label: 'QoQ',  long: 'Quarter-over-Quarter', hint: 'Same metric vs the immediately prior quarter.' },

  // ── Valuation ──────────────────────────────────────────────────────
  PE:   { label: 'PE',   long: 'Price / Earnings ratio', hint: 'Market Cap / PAT. Indian average ≈ 25x; quality compounders 30-45x.' },
  PEG:  { label: 'PEG',  long: 'Price / Earnings to Growth', hint: 'PE / EPS-growth %. <1.2 green, >2 red.' },
  EV:   { label: 'EV',   long: 'Enterprise Value', hint: 'Market Cap + Debt − Cash. The all-in cost of the whole business.' },
  EV_EBITDA: { label: 'EV/EBITDA', long: 'Enterprise Value / EBITDA', hint: 'Capital-structure-neutral valuation. Commodity ≈ 5-10x, quality ≈ 25-35x.' },

  // ── Domain-specific (audit-listed) ────────────────────────────────
  MRI: { label: 'MRI', long: 'Material Risk Indicator', hint: 'Internal portal flag — composite of pledge / leverage / OCF triggers.' },
  NARR_VS_FIN: { label: 'NARR-vs-FIN', long: 'Narrative vs Financials', hint: 'Concall-tone vs printed-numbers divergence score (PATCH 0881).' },
  ULTRA_BULLISH: { label: 'ULTRA_BULLISH', long: 'Ultra-Bullish tone classification', hint: 'Concall-tone tier 1: strongest forward guidance language detected.' },
  EDP: { label: 'EDP', long: 'Earnings-Day Probability', hint: 'Modelled probability the stock prints a beat-and-raise event on result day.' },

  // ── Indian-market specific ────────────────────────────────────────
  NSE: { label: 'NSE', long: 'National Stock Exchange of India' },
  BSE: { label: 'BSE', long: 'Bombay Stock Exchange' },
  AIF: { label: 'AIF', long: 'Alternative Investment Fund', hint: 'SEBI-regulated pooled vehicle; disclosure tier on this portal.' },
};

// Accept aliases / display forms users actually type
const ALIASES: Record<string, keyof typeof ACRONYMS> = {
  'D/E': 'DE',
  'NET DEBT': 'ND',
  'NET BLOCK': 'NB',
  'EV/EBITDA': 'EV_EBITDA',
  'NARR-VS-FIN': 'NARR_VS_FIN',
};

function lookup(key: string): AcronymEntry | null {
  const up = key.toUpperCase().trim();
  if (ACRONYMS[up]) return ACRONYMS[up];
  if (ALIASES[up]) return ACRONYMS[ALIASES[up]];
  return null;
}

export interface AcronymProps {
  /** The acronym key. Looked up case-insensitively against ACRONYMS + ALIASES. */
  name: string;
  /** Override the displayed label. Defaults to `name`. */
  display?: string;
}

/**
 * Wraps a single acronym with the design-system Tooltip and renders its
 * definition + hint on hover. If the acronym isn't in the registry, the
 * name is rendered as-is (no broken-link UX).
 */
export function Acronym({ name, display }: AcronymProps) {
  const entry = lookup(name);
  if (!entry) return <>{display ?? name}</>;
  const body = entry.hint ? `${entry.long} — ${entry.hint}` : entry.long;
  return <Tooltip label={body}>{display ?? entry.label}</Tooltip>;
}

/**
 * Scans a string for known acronyms and wraps each match with <Acronym>.
 * Conservative: only replaces whole-word matches that are 2-12 chars of
 * uppercase letters / digits / `-` / `_`. Use sparingly — once per heading
 * is enough; over-wrapping creates visual noise.
 */
export function AutoAcronyms({ text }: { text: string }) {
  const tokens = text.split(/(\b[A-Z][A-Z0-9_-]{1,11}\b|\bD\/E\b|\bEV\/EBITDA\b|\bNARR-VS-FIN\b)/gi);
  return (
    <>
      {tokens.map((tok, i) => {
        const entry = lookup(tok);
        if (!entry) return <React.Fragment key={i}>{tok}</React.Fragment>;
        return <Acronym key={i} name={tok} />;
      })}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// MOBILE BOTTOM NAV (DESIGN_AUDIT #10)
// ═════════════════════════════════════════════════════════════════════════

interface NavItem {
  label: string;
  icon: string;          // emoji — keeps the bundle dependency-free
  url: string;
  /** Which path prefixes mark this item as "current". */
  match: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'News',     icon: '📰', url: '/news',              match: ['/news', '/in-play', '/news-alerts', '/bottleneck-intel', '/critical-themes'] },
  { label: 'Earnings', icon: '💰', url: '/earnings-hub',      match: ['/earnings', '/calendars', '/guidance-extractor', '/earnings-trigger'] },
  { label: 'Intel',    icon: '🎙', url: '/concall-intel',     match: ['/concall-intel', '/company-intel', '/capex-tracker', '/multibagger', '/playbook'] },
  { label: 'Events',   icon: '⚡', url: '/special-situations', match: ['/special-situations', '/movers', '/heatmap', '/breadth'] },
  { label: 'Book',     icon: '💼', url: '/portfolio',         match: ['/portfolio', '/watchlists', '/decisions', '/alerts', '/buy-strategy', '/investing-os'] },
];

function detectActive(path: string): number {
  for (let i = 0; i < NAV_ITEMS.length; i++) {
    if (NAV_ITEMS[i].match.some((m) => path === m || path.startsWith(m + '/'))) return i;
  }
  return -1;
}

export function BottomNav() {
  // Don't render at all on first SSR paint — the nav is purely a mobile
  // affordance, and rendering at desktop sizes is wasted DOM.
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPath(window.location.pathname);
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  if (path === null) return null;
  const active = detectActive(path);
  return (
    <nav
      className="mc-bottom-nav"
      role="navigation"
      aria-label="Mobile bottom navigation"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        display: 'none',         // overridden by @media query in design-system.css
        background: 'var(--mc-bg-2)',
        borderTop: '1px solid var(--mc-border-0)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'stretch',
        }}
      >
        {NAV_ITEMS.map((item, i) => {
          const isActive = i === active;
          return (
            <li key={item.label} style={{ flex: 1 }}>
              <a
                href={item.url}
                className="mc-tap"
                aria-current={isActive ? 'page' : undefined}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 4px',
                  gap: 2,
                  textDecoration: 'none',
                  color: isActive ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  borderTop: isActive ? '2px solid var(--mc-cyan)' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Default export so the layout import is the canonical form:
//   import BottomNav from '@/components/bottom-nav';
export default BottomNav;
