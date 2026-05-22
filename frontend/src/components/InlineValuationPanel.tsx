'use client';

// ═══════════════════════════════════════════════════════════════════════════
// INLINE VALUATION PANEL (PATCH 0681 → P0681-FIX)
//
// First version (P0681) tried to import buildReport + extractors from
// auto-valuation/page.tsx — Next.js blocks named exports from page files,
// build failed. P0681-FIX: render a clear info card directing users to
// /auto-valuation. Proper inline merge requires extracting buildReport into
// a sibling engine.ts module (planned for next session, P0682).
// ═══════════════════════════════════════════════════════════════════════════

const BG = '#0A0E1A';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

export default function InlineValuationPanel() {
  return (
    <div style={{
      marginTop: 32, padding: '18px 22px',
      background: 'linear-gradient(135deg, #0d2030 0%, #122a3f 100%)',
      border: '1px solid #22D3EE40', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 32 }}>🤖</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#22D3EE', marginBottom: 4 }}>
              Also run a full Auto-Valuation on these documents
            </div>
            <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.55, marginBottom: 4 }}>
              Drop the same Excel + PDFs into Auto-Valuation tab to get P/E + P/S + EV/EBITDA fair-value
              with confidence chips, FY27/FY28 scenarios, and override panel. Pipeline reuses these
              concall PDFs so it&apos;s the same evidence — just rendered through valuation calculators.
            </div>
            <div style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>
              Next session (P0682): inline merge so one upload runs both pipelines on this page.
            </div>
          </div>
        </div>
        <a href="/auto-valuation" style={{
          fontSize: 13, fontWeight: 800, color: '#0a0a0f', background: '#22D3EE',
          padding: '10px 20px', borderRadius: 6, textDecoration: 'none',
          whiteSpace: 'nowrap', letterSpacing: '0.3px',
        }}>
          OPEN AUTO-VAL →
        </a>
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 11, color: DIM, lineHeight: 1.55 }}>
        <strong style={{ color: '#F59E0B' }}>Why two clicks for now:</strong> Auto-Val&apos;s buildReport function lives inside a Next.js page file which doesn&apos;t allow named exports. Proper extraction to a shared engine module is the next patch.
      </div>
    </div>
  );
}
