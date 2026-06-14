'use client';

// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE EXTRACTOR (PATCH 0629)
//
// Paste concall transcript / investor presentation text and immediately
// see a structured table of forward FY guidance numbers (revenue, EBITDA,
// PAT, margins, growth, capex, order book).
//
// Pure regex/lexicon extraction — runs client-side. No data leaves your
// browser. Uses /lib/forward-guidance-extractor.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { extractGuidance, metricLabel, metricColor, formatGuidanceValue, type GuidanceItem } from '@/lib/forward-guidance-extractor';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const EXAMPLE = `DEE Development Engineers Q3 FY26 concall.

In our core business, excluding the power generation division, the Anjar Pipe Fabrication Unit, which commenced operations in September 2025, was fully operational during the quarter and is consistently benefiting from operating leverage as utilization ramps up, supporting margin expansion.

Management commentary: we expect to reach revenue of ₹1500 crore in FY27 with EBITDA margins of 18-19%. Order book stands at ₹1,300 crore as of Q3 FY26. Capacity is expected to expand from 1,12,500 MT to 1,27,500 MT per annum by FY27.

For FY28, the management targets revenue of ₹2500 crore at EBITDA margin of 20%. Capex of ₹150 crore is planned for FY27 to support this expansion.`;

export default function GuidanceExtractorPage() {
  const [text, setText] = useState('');
  const guidance = useMemo(() => extractGuidance(text), [text]);

  const byYear = useMemo(() => {
    const map = new Map<string, GuidanceItem[]>();
    for (const g of guidance) {
      const arr = map.get(g.fiscalYear) || [];
      arr.push(g);
      map.set(g.fiscalYear, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [guidance]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>📋 Forward Guidance Extractor</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
            Paste a concall transcript or investor-presentation text below. Forward FY guidance (revenue / EBITDA / PAT / margins / order book / capex) auto-extracts into a structured table you can copy into the Valuation Calculator.
          </div>
        </div>

        {/* Input pane */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px' }}>PASTE CONCALL / PPT TEXT</span>
            <button onClick={() => setText(EXAMPLE)} style={{
              fontSize: 11, padding: '4px 10px', border: '1px solid #22D3EE50', background: '#22D3EE15',
              color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700,
            }}>
              Load DEE Dev example
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the concall transcript or PPT text here. The extractor only needs sentences with forward-looking signal words: 'target', 'guidance', 'expect', 'aim', 'by FY27', etc."
            rows={10}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0A1422', color: TEXT,
              border: `1px solid ${BORDER}`, borderRadius: 4,
              padding: '10px 12px', fontSize: 12.5, fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.55, resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 6, fontSize: 10, color: DIM }}>
            {text.length.toLocaleString()} characters · {guidance.length} guidance items extracted
          </div>
        </div>

        {/* Output: pivot by year */}
        {guidance.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
              {byYear.map(([fy, items]) => (
                <div key={fy} style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid var(--mc-cyan)', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-cyan)', marginBottom: 8 }}>{fy}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.map((g, i) => (
                      <div key={i} style={{ background: 'var(--mc-bg-4)', borderRadius: 5, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: metricColor(g.metric), letterSpacing: '0.4px' }}>{metricLabel(g.metric).toUpperCase()}</span>
                          <span style={{ fontSize: 16, fontWeight: 900, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{formatGuidanceValue(g)}</span>
                        </div>
                        <div style={{ fontSize: 10, color: DIM, fontStyle: 'italic', lineHeight: 1.45 }} title={g.rawPhrase}>
                          {g.rawPhrase.slice(0, 140)}{g.rawPhrase.length > 140 ? '…' : ''}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
                          confidence: <span style={{ color: g.confidence === 'high' ? 'var(--mc-bullish)' : g.confidence === 'medium' ? 'var(--mc-warn)' : 'var(--mc-bearish)' }}>{g.confidence}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              padding: '12px 16px',
              background: '#10B98115',
              border: '1px solid #10B98140',
              borderRadius: 6,
              fontSize: 13, color: TEXT, lineHeight: 1.65,
            }}>
              <b style={{ color: 'var(--mc-bullish)' }}>→ Next step:</b> Copy any year's numbers into the <a href="/valuation-calc" style={{ color: 'var(--mc-cyan)', textDecoration: 'underline' }}>Valuation Calculator</a> to project bull/base/bear market-cap targets and annualized upside.
            </div>
          </>
        ) : text.trim().length > 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 18px', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
            No forward guidance items detected. Make sure the text contains explicit forward-looking phrases (e.g. "we target FY27 revenue of ₹1500 Cr", "EBITDA margins of 18-19% in FY27", "expected to reach…").
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 18px', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
            Paste text above to extract forward guidance.
          </div>
        )}

      </div>
    </div>
  );
}
