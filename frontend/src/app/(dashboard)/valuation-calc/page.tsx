'use client';

// ═══════════════════════════════════════════════════════════════════════════
// VALUATION CALCULATORS (PATCH 0628)
//
// Institutional P/S, P/E, EV/EBITDA target-multiple calculators.
// Each takes management guidance + multiple band → projects market cap +
// bull/base/bear cases with annualized upside.
//
// Worked examples ship in /lib/valuation-calculators.ts (Rubicon, Bajaj
// Consumer, TD Power, Sterlite, Aeroflex, Atlanta Electricals, DEE Dev).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import {
  type SavedValuation,
} from '@/lib/valuation-calculators';
import { SectorLookupPanel, MoreMethodsTab, LearnTab } from './methodPanels';
import { ForwardFairValueCalculator } from './ForwardFairValueCalculator';
import { ReverseDcfCalculator } from './ReverseDcfCalculator';
import { SavedValuationsPanel } from './SavedValuationsPanel';
import { ValuationAnalyticsPanel } from './ValuationAnalyticsPanel';
import { PSCalculator, PECalculator, EvEbitdaCalculator } from './components';
import { BG, CARD, BORDER, TEXT, DIM } from './constants';
import { type CalcKind } from './types';

export default function ValuationCalcPage() {
  const [tab, setTab] = useState<CalcKind>('PE');
  // PATCH 0636 — switch tab when EDIT is clicked on a saved valuation
  useEffect(() => {
    const h = (e: any) => {
      const v = e?.detail as SavedValuation | undefined;
      if (!v) return;
      setTab(v.calcKind);
    };
    window.addEventListener('mc:load-valuation', h);
    return () => window.removeEventListener('mc:load-valuation', h);
  }, []);
  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🧮 Valuation Calculators</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
            Project market cap from management guidance + a sector-appropriate multiple band. Always run before sizing entry.
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
          {([
            { id: 'FAIR_VALUE', label: 'Fair Value (Excel)', emoji: '🧾' },
            { id: 'PE',         label: 'P/E Target',        emoji: '📈' },
            { id: 'PS',         label: 'P/S Target',        emoji: '💰' },
            { id: 'EV_EBITDA',  label: 'EV / EBITDA',       emoji: '🏭' },
            { id: 'REVERSE_DCF', label: 'Reverse-DCF',      emoji: '🔎' },
            { id: 'MORE',       label: 'More Methods',      emoji: '🧬' },
            { id: 'ANALYTICS',  label: 'Analytics',         emoji: '📊' },
            { id: 'LEARN',      label: 'Learn',             emoji: '📚' },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              fontSize: 13, padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--mc-cyan)' : '2px solid transparent',
              color: tab === t.id ? 'var(--mc-cyan)' : DIM,
              cursor: 'pointer',
              fontWeight: 700,
            }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px 22px' }}>
          {tab === 'FAIR_VALUE' && <ForwardFairValueCalculator />}
          {tab === 'PS' && <PSCalculator />}
          {tab === 'PE' && <PECalculator />}
          {tab === 'EV_EBITDA' && <EvEbitdaCalculator />}
          {tab === 'REVERSE_DCF' && <ReverseDcfCalculator />}
          {tab === 'MORE' && <MoreMethodsTab />}
          {tab === 'ANALYTICS' && <ValuationAnalyticsPanel />}
          {tab === 'LEARN' && <LearnTab />}
        </div>

        {/* PATCH 0633 — Saved valuations panel */}
        <SavedValuationsPanel />

        {/* Sector → calculator map */}
        <SectorLookupPanel />

        <div style={{ fontSize: 11, color: DIM, padding: '12px 0', lineHeight: 1.6, fontStyle: 'italic' }}>
          All calculators run client-side — no data leaves your browser. Edit assumptions freely. Worked examples (Rubicon, Bajaj Consumer, TD Power, Sterlite, Aeroflex, Atlanta Electricals, DEE Dev) are built in — load any to see the inputs and tweak.
        </div>
      </div>
    </div>
  );
}
