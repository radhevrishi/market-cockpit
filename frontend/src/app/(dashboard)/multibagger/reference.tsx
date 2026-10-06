'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { HISTORICAL_MULTIBAGGERS } from '@/lib/multibagger/framework-extensions';
import type { ExcelResult } from '@/lib/multibagger-india-scoring';
import { BORDER, CARD2, CARD_BG, F, GREEN, MUTED, ORANGE, PURPLE, TEXT, YELLOW } from './constants';

export function MultibaggerReference({ excelRows }: { excelRows: ExcelResult[] }) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [filterMatch, setFilterMatch] = useState(false);

  // Pattern-match each canonical stock against the user's uploads
  const matches: Record<string, ExcelResult[]> = useMemo(() => {
    const out: Record<string, ExcelResult[]> = {};
    for (const hist of HISTORICAL_MULTIBAGGERS) {
      const matched = excelRows.filter(r => {
        // Multibagger archetype scoring — how closely does this stock match
        // the historical pattern at its entry point?
        let pts = 0;
        // Market cap proximity (within 3x band)
        if (r.marketCapCr !== undefined) {
          const ratio = r.marketCapCr / hist.market_cap_cr;
          if (ratio >= 0.3 && ratio <= 5) pts += 2;
        }
        // ROCE within ±8pp
        if (r.roce !== undefined && Math.abs(r.roce - hist.roce_pct) <= 8) pts += 2;
        // Profit CAGR within ±15pp
        if (r.profitCagr !== undefined && Math.abs(r.profitCagr - hist.profit_cagr_pct) <= 15) pts += 2;
        // Dilution drag similar (within ±3pp)
        if (r.dilution?.drag_pp !== null && r.dilution?.drag_pp !== undefined &&
            Math.abs(r.dilution.drag_pp - hist.dilution_drag_pp) <= 3) pts += 1;
        // Promoter holding within ±15pp
        if (r.promoter !== undefined && Math.abs(r.promoter - hist.promoter_pct) <= 15) pts += 2;
        // FII+DII within ±10pp
        if (r.fiiPlusDii !== undefined && Math.abs(r.fiiPlusDii - hist.fii_dii_pct) <= 10) pts += 1;
        return pts >= 5; // need a meaningful number of matching dimensions
      });
      out[hist.ticker] = matched;
    }
    return out;
  }, [excelRows]);

  return (
    <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:F.h2,fontWeight:800,color:TEXT,margin:'0 0 6px'}}>
          📚 Historical 100×–500× Reference
        </h2>
        <p style={{fontSize:F.md,color:MUTED,margin:0,lineHeight:1.5}}>
          Each canonical multibagger profiled at the moment it was buyable. Compare against your
          uploaded stocks to see which historical pattern your candidates resemble. The framework
          uses these to validate scoring calibration — every one of these scored
          {' '}<span style={{color:GREEN,fontWeight:600}}>BUILDING or COMPOUNDING (76-87)</span>{' '}
          on the patch 0055 reinvestment engine at their entry year.
        </p>
        {excelRows.length > 0 && (
          <label style={{display:'flex',alignItems:'center',gap:6,marginTop:10,fontSize:F.md,color:MUTED,cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={filterMatch}
              onChange={e => setFilterMatch(e.target.checked)}
            />
            <span>Show only canonical stocks with at least one match in your {excelRows.length} uploaded stocks</span>
          </label>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:14}}>
        {HISTORICAL_MULTIBAGGERS
          .filter(h => !filterMatch || (matches[h.ticker]?.length ?? 0) > 0)
          .map(h => {
            const isOpen = expandedCard === h.ticker;
            const matchedStocks = matches[h.ticker] ?? [];
            return (
              <div key={h.ticker} style={{
                backgroundColor:CARD_BG,
                border:`1px solid ${BORDER}`,
                borderLeft:`3px solid ${PURPLE}`,
                borderRadius:10,
                padding:'12px 14px',
              }}>
                <div
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                  style={{cursor:'pointer'}}
                >
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                      <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{h.name}</span>
                      <span style={{fontSize:F.xs,color:MUTED}}>{h.entry_year}</span>
                    </div>
                    <span style={{fontSize:F.h2,fontWeight:900,color:GREEN}}>
                      {h.ten_year_return_x}×
                    </span>
                  </div>
                  <div style={{fontSize:F.xs,color:MUTED,marginBottom:8,lineHeight:1.4}}>
                    {h.inflection}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,fontSize:9}}>
                    <div>
                      <div style={{color:MUTED}}>MCap</div>
                      <div style={{color:TEXT,fontWeight:700}}>₹{h.market_cap_cr}Cr</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>ROCE</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.roce_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Promoter</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.promoter_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Rev CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.revenue_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Profit CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.profit_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>FII+DII</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.fii_dii_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>EPS Growth</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.eps_growth_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Dilution drag</div>
                      <div style={{color:h.dilution_drag_pp <= 0 ? GREEN : TEXT,fontWeight:700}}>
                        {h.dilution_drag_pp > 0 ? '+' : ''}{h.dilution_drag_pp}pp
                      </div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Matches</div>
                      <div style={{color:matchedStocks.length>0?GREEN:MUTED,fontWeight:700}}>
                        {matchedStocks.length} stock{matchedStocks.length===1?'':'s'}
                      </div>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${BORDER}`}}>
                    <div style={{fontSize:F.xs,fontWeight:700,color:'var(--mc-cyan)',marginBottom:6,letterSpacing:'0.6px'}}>
                      FRAMEWORK SIGNALS THAT WOULD HAVE CAUGHT IT
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
                      {h.framework_signals.map((s,i) => (
                        <span key={i} style={{
                          fontSize:9,padding:'3px 7px',borderRadius:4,
                          backgroundColor:`${PURPLE}20`,color:PURPLE,
                          border:`1px solid ${PURPLE}40`,fontWeight:600,
                        }}>{s}</span>
                      ))}
                    </div>
                    {matchedStocks.length > 0 && (
                      <>
                        <div style={{fontSize:F.xs,fontWeight:700,color:GREEN,marginBottom:6,letterSpacing:'0.6px'}}>
                          🎯 YOUR STOCKS WITH SIMILAR ARCHETYPE
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {matchedStocks.slice(0,8).map(s => (
                            <div key={s.symbol} style={{
                              display:'flex',alignItems:'center',gap:8,
                              padding:'6px 8px',backgroundColor:CARD2,borderRadius:5,fontSize:F.xs,
                            }}>
                              <span style={{fontWeight:700,color:TEXT,minWidth:80}}>{s.symbol}</span>
                              <span style={{color:MUTED,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                {s.company}
                              </span>
                              <span style={{
                                color: s.score>=80?GREEN:s.score>=68?'var(--mc-cyan)':s.score>=55?YELLOW:ORANGE,
                                fontWeight:700,minWidth:30,textAlign:'right',
                              }}>{s.score}</span>
                              <span style={{color:MUTED,minWidth:60,textAlign:'right'}}>
                                ₹{s.marketCapCr ? (s.marketCapCr >= 1000 ? (s.marketCapCr/1000).toFixed(1)+'k Cr' : s.marketCapCr+'Cr') : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div style={{
                  marginTop:8,fontSize:9,color:MUTED,textAlign:'center',cursor:'pointer',
                }}
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                >
                  {isOpen ? '▲ collapse' : '▼ click to expand'}
                </div>
              </div>
            );
          })}
      </div>

      <div style={{
        marginTop:24,padding:'12px 14px',backgroundColor:`${PURPLE}0A`,
        border:`1px solid ${PURPLE}30`,borderLeft:`3px solid ${PURPLE}`,borderRadius:8,
      }}>
        <div style={{fontSize:F.sm,fontWeight:700,color:PURPLE,marginBottom:6}}>
          📖 How to use this reference
        </div>
        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.6}}>
          1. Toggle <strong style={{color:TEXT}}>'Show only canonical stocks with matches'</strong> to focus on patterns relevant to your uploads.<br/>
          2. Click any card to see which of your stocks match the historical archetype + which framework signals would have caught it.<br/>
          3. Match thresholds: cap within 0.3-5×, ROCE ±8pp, Profit CAGR ±15pp, Promoter ±15pp, FII+DII ±10pp. Need 5+ matching dimensions.<br/>
          4. A high match doesn't guarantee multibagger outcome — these are NECESSARY characteristics, not sufficient. Sector tailwind, founder execution, and reinvestment runway determine the rest.
        </div>
      </div>
    </div>
  );
}
