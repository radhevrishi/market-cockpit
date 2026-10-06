'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect } from 'react';
import { GRADE_COLOR, CHECKLIST } from '@/lib/multibagger-india-scoring';
import type { Grade, ExcelRow, ExcelResult } from '@/lib/multibagger-india-scoring';
import { scoreUSARow } from '@/lib/multibagger-usa-scoring';
import type { USARow, USAResult } from '@/lib/multibagger-usa-scoring';
import { ACCENT, BORDER, CARD2, CARD_BG, F, GREEN, MUTED, PURPLE, RED, TEXT, YELLOW } from './constants';
import { type USAChecklistItem } from './types';

// Feature 2 — surface auto-computed incremental economics on the checklist.
// The scorer already computes roceExpansion (= roce − roce3yr) and opmExpansion
// and feeds them into the rerating bonus, but the `incremental_roic` and
// `cap_5yr` CHECKLIST items shipped as manual human-judgment rows (no autoField).
// CHECKLIST lives in the read-only scoring lib, so we overlay the auto wiring
// locally here — mirroring the exact autoField/autoPass/autoFormat pattern the
// other auto-populated items (e.g. 'roce', 'op_leverage') already use. Rows
// where roceExpansion is absent from the CSV simply stay manual (the auto loop
// skips undefined fields). Additive — the rerating bonus math is untouched.
const CHECKLIST_AUTO: typeof CHECKLIST = CHECKLIST.map(it => {
  if (it.id === 'incremental_roic') {
    return {
      ...it,
      autoField: 'roceExpansion' as keyof ExcelRow,
      autoPass: (_v: number, row?: ExcelRow) => (row?.roceExpansion ?? -999) > 0,
      autoFormat: (_v: number, row?: ExcelRow) => {
        const rx = row?.roceExpansion; const ox = row?.opmExpansion;
        if (rx === undefined) return '';
        return `Incremental ROCE ${rx >= 0 ? '+' : ''}${rx.toFixed(1)}pp${ox !== undefined ? ` · OPM ${ox >= 0 ? '+' : ''}${ox.toFixed(1)}pp` : ''} — ${rx > 0 ? '✓ new capital productive' : '× returns diluting on growth'}`;
      },
    };
  }
  if (it.id === 'cap_5yr') {
    return {
      ...it,
      autoField: 'roceExpansion' as keyof ExcelRow,
      autoPass: (_v: number, row?: ExcelRow) => (row?.roce ?? 0) >= 18 && (row?.roceExpansion ?? -999) >= -3,
      autoFormat: (_v: number, row?: ExcelRow) => {
        const rx = row?.roceExpansion; const rc = row?.roce;
        if (rx === undefined || rc === undefined) return '';
        return `CAP proxy: ROCE ${rc.toFixed(0)}% ${rx >= 0 ? 'expanding' : rx >= -3 ? 'stable' : 'reverting'} (${rx >= 0 ? '+' : ''}${rx.toFixed(1)}pp/3yr)`;
      },
    };
  }
  return it;
});

export function MultibaggerChecklist({excelRows}:{excelRows:ExcelResult[]}) {
  // Feature 2 — use the auto-wired overlay in place of the raw imported CHECKLIST.
  const CHECKLIST = CHECKLIST_AUTO;
  const [symbol,setSymbol]=useState('');
  const [activeSymbol,setActiveSymbol]=useState('');
  const [savedSymbols,setSavedSymbols]=useState<string[]>([]);
  const [checks,setChecks]=useState<Record<string,boolean>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});

  function loadSymbol(sym:string){
    setActiveSymbol(sym);
    // Load saved checks
    let savedChecks: Record<string,boolean> = {};
    try{ savedChecks = JSON.parse(localStorage.getItem(`mb3_checks_${sym}`)||'{}'); } catch{}
    // Auto-tick items where autoPass fires for this stock
    const stock = excelRows.find(r => r.symbol.toUpperCase() === sym.toUpperCase());
    if (stock) {
      for (const item of CHECKLIST) {
        if (item.autoField && item.autoPass) {
          const val = stock[item.autoField as keyof ExcelResult];
          if (val !== undefined) {
            savedChecks[item.id] = item.autoPass(val as number, stock);
          }
        }
      }
      localStorage.setItem(`mb3_checks_${sym}`, JSON.stringify(savedChecks));
    }
    setChecks(savedChecks);
    try{setNotes(JSON.parse(localStorage.getItem(`mb3_notes_${sym}`)||'{}'));}catch{setNotes({});}
  }
  function addSymbol(){
    const s=symbol.trim().toUpperCase();
    if(!s||savedSymbols.includes(s)) return;
    const next=[...savedSymbols,s];
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    loadSymbol(s);setSymbol('');
  }
  function removeSymbol(sym:string){
    const next=savedSymbols.filter(x=>x!==sym);
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    if(activeSymbol===sym){setActiveSymbol(next[0]??'');setChecks({});setNotes({});}
  }
  function toggleCheck(id:string){
    const next={...checks,[id]:!checks[id]};
    setChecks(next);
    if(activeSymbol) localStorage.setItem(`mb3_checks_${activeSymbol}`,JSON.stringify(next));
  }
  function setNote(id:string,val:string){
    const next={...notes,[id]:val};
    setNotes(next);
    if(activeSymbol) localStorage.setItem(`mb3_notes_${activeSymbol}`,JSON.stringify(next));
  }

  useMemo(()=>{
    try{
      const syms=JSON.parse(localStorage.getItem('mb3_symbols')||'[]') as string[];
      setSavedSymbols(syms);
      if(syms.length>0&&!activeSymbol)loadSymbol(syms[0]);
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const excelStock=excelRows.find(r=>r.symbol.toUpperCase()===activeSymbol.toUpperCase());
  const autoChecks=useMemo(():Record<string,{pass:boolean;note:string}|null>=>{
    if(!excelStock) return {};
    const result:Record<string,{pass:boolean;note:string}|null>={};
    for (const item of CHECKLIST){
      if(!item.autoField||!item.autoPass) continue;
      // Handle both numeric fields and derived non-numeric fields (accelSignal etc.)
      const rawVal=excelStock[item.autoField as keyof ExcelResult];
      // For string-type fields (accelSignal), pass 0 as numeric placeholder — autoPass uses row
      const numVal = typeof rawVal === 'number' ? rawVal : (rawVal !== undefined ? 0 : undefined);
      if(numVal===undefined && rawVal===undefined) continue;
      const pass=item.autoPass(numVal??0, excelStock);
      const formatted = item.autoFormat ? item.autoFormat(numVal??0, excelStock) : (typeof rawVal==='number'?rawVal.toFixed(2):String(rawVal??''));
      if(!formatted) continue; // skip if format returns empty (derived field not available)
      const note=`Auto: ${formatted} → ${pass?'✅ PASS':'❌ FAIL'}`;
      result[item.id]={pass,note};
    }
    return result;
  },[excelStock]);

  const pillars=[...new Set(CHECKLIST.map(i=>i.pillar))];
  const completed=CHECKLIST.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
  const autoPassed=Object.values(autoChecks).filter(v=>v?.pass).length;
  const pct=Math.round((completed/CHECKLIST.length)*100);
  const grade:Grade=pct>=90?'A+':pct>=80?'A':pct>=68?'B+':pct>=55?'B':pct>=42?'C':'D';

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {excelRows.length>0&&(
        <div style={{marginBottom:14,padding:'12px 18px',backgroundColor:`${GREEN}08`,border:`1px solid ${GREEN}20`,borderRadius:10,fontSize:F.md,color:GREEN}}>
          🤖 {excelRows.length} stocks from uploaded Excel — click any to auto-verify {CHECKLIST.filter(i=>i.autoField).length} criteria · {autoPassed>0?`${autoPassed} already verified for ${activeSymbol||'selected stock'}`:'select a stock below'}
        </div>
      )}

      {/* Ticker selector */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&addSymbol()}
          placeholder="Add ticker (e.g. HBLENGINE, APARINDS)" maxLength={20}
          style={{flex:'0 0 260px',padding:'10px 14px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,color:TEXT,fontSize:F.md,fontWeight:600,outline:'none'}}/>
        <button onClick={addSymbol} style={{padding:'10px 18px',backgroundColor:`${PURPLE}20`,border:`1px solid ${PURPLE}40`,borderRadius:10,color:PURPLE,fontSize:F.md,fontWeight:700,cursor:'pointer'}}>Add</button>
        {/* Quick buttons from top Excel scores */}
        {excelRows.slice(0,10).map(r=>(
          <button key={r.symbol} onClick={()=>{
            if(!savedSymbols.includes(r.symbol)){const n=[...savedSymbols,r.symbol];setSavedSymbols(n);localStorage.setItem('mb3_symbols',JSON.stringify(n));}
            loadSymbol(r.symbol);
          }} style={{padding:'8px 14px',borderRadius:8,border:`1px solid ${activeSymbol===r.symbol?GRADE_COLOR[r.grade]:BORDER}`,background:activeSymbol===r.symbol?`${GRADE_COLOR[r.grade]}15`:'transparent',color:activeSymbol===r.symbol?GRADE_COLOR[r.grade]:MUTED,fontSize:F.sm,fontWeight:700,cursor:'pointer'}}>
            {r.symbol} <span style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</span>
          </button>
        ))}
        {savedSymbols.map(s=>(
          <div key={s} style={{display:'flex',borderRadius:10,border:`1px solid ${activeSymbol===s?`${PURPLE}60`:BORDER}`,overflow:'hidden'}}>
            <button onClick={()=>loadSymbol(s)} style={{padding:'8px 14px',background:activeSymbol===s?`${PURPLE}20`:'transparent',border:'none',cursor:'pointer',color:activeSymbol===s?PURPLE:MUTED,fontSize:F.md,fontWeight:700}}>{s}</button>
            <button onClick={()=>removeSymbol(s)} style={{padding:'8px 10px',background:'none',border:'none',borderLeft:`1px solid ${BORDER}`,cursor:'pointer',color:MUTED,fontSize:F.md}}>×</button>
          </div>
        ))}
      </div>

      {!activeSymbol?(
        <div style={{textAlign:'center',padding:60,color:MUTED}}>
          <div style={{fontSize:52}}>📋</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:16}}>37 criteria from SQGLP + Fisher + Framework</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            Add a ticker above or click any scored stock · Auto-verification from uploaded Excel data<br/>
            Sources: MOSL 100× (SQGLP) · Philip Fisher 100-Bagger · Multibagger Framework
          </div>
        </div>
      ):(
        <>
          {/* Progress header */}
          <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div>
                <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{activeSymbol}</span>
                {excelStock&&<span style={{fontSize:F.md,color:MUTED,marginLeft:12}}>{excelStock.company} · {excelStock.sector} · Excel Score: <strong style={{color:GRADE_COLOR[excelStock.grade]}}>{excelStock.score} {excelStock.grade}</strong></span>}
              </div>
              <div style={{textAlign:'right'}}>
                <span style={{fontSize:F.h1,fontWeight:900,color:GRADE_COLOR[grade]??MUTED}}>{grade}</span>
                <span style={{fontSize:F.md,color:MUTED,marginLeft:8}}>{completed}/{CHECKLIST.length} criteria ({pct}%)</span>
              </div>
            </div>
            <div style={{height:10,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:5,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:pct>=70?GREEN:pct>=50?YELLOW:RED,borderRadius:5,transition:'width 0.3s'}}/>
            </div>
            <div style={{display:'flex',gap:20,marginTop:8,flexWrap:'wrap'}}>
              <span style={{fontSize:F.sm,color:GREEN}}>✅ {completed} passed</span>
              <span style={{fontSize:F.sm,color:ACCENT}}>🤖 {autoPassed} auto-verified from Excel</span>
              <span style={{fontSize:F.sm,color:MUTED}}>{CHECKLIST.length-completed} remaining</span>
              {!excelStock&&excelRows.length>0&&<span style={{fontSize:F.sm,color:YELLOW}}>⚠ Upload {activeSymbol} in Excel to enable auto-checks</span>}
            </div>
          </div>

          {/* Checklist by pillar */}
          {pillars.map(pillar=>{
            const items=CHECKLIST.filter(i=>i.pillar===pillar);
            const pc=items[0].pillarColor;
            const passed=items.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
            return (
              <div key={pillar} style={{marginBottom:24}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <span style={{fontSize:F.md,fontWeight:800,letterSpacing:'1px',color:pc}}>{pillar.replace('_',' ')}</span>
                  <span style={{fontSize:F.sm,color:MUTED}}>({passed}/{items.length} passed)</span>
                  <div style={{flex:1,height:1,backgroundColor:`${pc}25`}}/>
                </div>
                {items.map(item=>{
                  const auto=autoChecks[item.id];
                  const isChecked=auto?.pass||checks[item.id];
                  const isFail=auto&&!auto.pass;
                  const isAuto=!!auto;
                  return (
                    <div key={item.id} style={{marginBottom:8,borderRadius:10,border:`1px solid ${isChecked?`${pc}35`:isFail?`${RED}30`:BORDER}`,backgroundColor:isChecked?`${pc}07`:isFail?`${RED}05`:CARD_BG,overflow:'hidden'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px'}}>
                        <button onClick={()=>!isAuto&&toggleCheck(item.id)} style={{background:'none',border:`2px solid ${isChecked?pc:isFail?RED:MUTED}`,borderRadius:5,width:22,height:22,cursor:isAuto?'default':'pointer',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',color:isChecked?pc:isFail?RED:'transparent',fontSize:F.md,fontWeight:900}}>
                          {isChecked?'✓':isFail?'✗':''}
                        </button>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                            <span style={{fontSize:F.md,color:TEXT,fontWeight:600}}>{item.label}</span>
                            {isAuto&&<span style={{fontSize:F.xs,fontWeight:800,color:ACCENT,border:`1px solid ${ACCENT}30`,padding:'1px 6px',borderRadius:4}}>AUTO</span>}
                            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>wt {item.weight}% · {item.source}</span>
                          </div>
                          <div style={{fontSize:F.sm,color:MUTED,marginBottom:4}}><strong>Target:</strong> {item.target}</div>
                          {auto?.note&&<div style={{fontSize:F.sm,color:auto.pass?GREEN:RED,marginBottom:4,fontWeight:600}}>{auto.note}</div>}
                          {!isAuto&&(
                            <input value={notes[item.id]||''} onChange={e=>setNote(item.id,e.target.value)}
                              placeholder="Your research note / evidence…"
                              style={{width:'100%',marginTop:6,padding:'6px 10px',backgroundColor:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:F.sm,outline:'none',boxSizing:'border-box'}}/>
                          )}
                        </div>
                      </div>
                      <div style={{padding:'0 16px 10px 50px',fontSize:F.sm,color:`${MUTED}90`,lineHeight:1.6}}>{item.why}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USA MULTIBAGGER SYSTEM — TradingView CSV format
// Framework: Revenue Acceleration + Gross Margin + FCF Quality + US Valuation
// PATCH 0728 — Scoring engine moved to @/lib/multibagger-usa-scoring (imported
// alongside the India lib at the top of this file).
// ═══════════════════════════════════════════════════════════════════════════════

const USA_CHECKLIST: USAChecklistItem[] = [
  // ── QUALITY / MOAT ────────────────────────────────────────────────────────
  { id:'us_gm', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + SaaS benchmark',
    label:'Gross Margin ≥ 60% (software) or ≥ 50% (semis/hardware)', target:'Software: >65% elite · Hardware: >50% · <35% = weak moat',
    why:'Gross margin is the first test of pricing power. High GM = durable competitive advantage. Google 55%, NVDA 74%, AAPL 46%. Below 35% = no moat.' },
  { id:'us_gm_expand', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Institutional standard',
    label:'Gross Margin expanding QoQ / TTM vs Annual (direction > absolute)', target:'TTM GM > Annual GM = pricing power strengthening',
    why:'A rising GM trend proves the moat is durably improving, not just high. The direction is more important than the level for predicting future multiples.' },
  { id:'us_fcf', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + Buffett',
    label:'FCF Margin ≥ 15% AND positive (free cash machine)', target:'>25% = excellent · >15% = good · <0% = risk',
    why:'US tech multibaggers are defined by FCF generation. NVDA 55% FCF margin, MSFT 29%. FCF funds buybacks, R&D, M&A without dilution.' },
  { id:'us_roe', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Buffett',
    label:'ROE ≥ 20% consistently (without excessive leverage)', target:'>30% = exceptional · >20% = good · <10% = weak',
    why:'Buffett rule: ROE > 20% without leverage = true earnings power. With leverage = false signal.' },
  { id:'us_roic', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Fisher ROIC test',
    label:'ROIC ≥ 15% AND stable or rising (not diluting from new investments)', target:'>20% = moat confirmed · 10–20% = acceptable · <10% = below WACC',
    why:"Fisher key test: 'Does new capital earn at least as much as legacy capital?' Rising ROIC = each dollar invested creates more value than before." },
  { id:'us_r40', pillar:'QUALITY', pillarColor:'#a78bfa', weight:9, source:'SaaS/tech institutional benchmark',
    label:'Rule of 40: (Revenue growth% + FCF margin%) ≥ 40', target:'≥60 = elite · ≥40 = investment grade · <20 = value trap for SaaS',
    why:'The primary institutional benchmark for evaluating tech/SaaS companies. Combines growth + profitability into one number. Palantir at 78, NVDA at ~100+. BELOW 20 = no premium multiple justified.' },
  { id:'us_moat_type', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Fisher 100-Bagger',
    label:'Moat type: network effects / switching cost / ecosystem (Tier 1)', target:'Network > Switching > Brand > Cost > Regulatory (weakest)',
    why:'Fisher: verify moat type matters more than gross margin. A 90% gross margin with zero switching costs (commoditizable) is not a moat.' },
  // ── GROWTH ────────────────────────────────────────────────────────────────
  { id:'us_revgrowth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'MOSL adapted',
    label:'Revenue CAGR ≥ 20% (3-year or annual)', target:'>30% = hypergrowth · >20% = multibagger zone · <15% = insufficient',
    why:'US multibaggers need higher base growth than India. NVDA 3yr CAGR 90%+. Palantir 24%. Rule: if a company cannot grow 20%+ annually, it cannot 10× in 5 years.' },
  { id:'us_rev_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'Framework core signal',
    label:'Revenue ACCELERATING: Quarterly YoY > Annual YoY (+5pp threshold)', target:'QoQ YoY % > Annual % by ≥5pp = structural acceleration',
    why:'MOST important signal for entry timing. NVDA went from 20% growth to 200% in 2023 before consensus caught on. Catch this inflection, not after.' },
  { id:'us_eps_growth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7, source:'Fisher Twin Engine',
    label:'EPS growth ≥ 20% AND faster than revenue (op leverage proof)', target:'EPS CAGR > Revenue CAGR × 1.3 = operating leverage firing',
    why:'Fisher Twin Engine: EPS growth + stable/expanding PE = compounding. EPS growing faster than revenue = operating leverage visible.' },
  { id:'us_growth_sustained', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6, source:'MOSL consistency check',
    label:'3-year CAGR ≥ 15% (not a one-year spike)', target:'3yr CAGR ≥ 15% confirms sustainability. Annual/3yr ratio < 2× = not a spike.',
    why:'COVID-reopening, one-off contracts, and AI hype create fake spikes. 3yr CAGR confirms the growth is structural, not cyclical.' },
  { id:'us_gp_expansion', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Operating leverage',
    label:'Gross profit growing faster than revenue (margin expansion real-time)', target:'Gross profit growth QoQ % > Revenue growth QoQ % = live margin expansion',
    why:'If GP grows faster than revenue, OPM will expand next quarter. Lead indicator of upcoming profitability improvement.' },
  // ── VALUATION ─────────────────────────────────────────────────────────────
  { id:'us_peg', pillar:'VALUATION', pillarColor:'#f59e0b', weight:7, source:'Fisher PEG adapted',
    label:'PEG Ratio < 1.5 (growth at reasonable price)', target:'<0.8 = exceptional · 0.8–1.5 = fair GARP · >2.5 = expensive growth',
    why:'Fisher: PEG adjusts P/E for growth rate. Paying 40× PE for 40% growth = fair (PEG=1). Paying 40× for 10% growth = expensive (PEG=4).' },
  { id:'us_ev_ebitda', pillar:'VALUATION', pillarColor:'#f59e0b', weight:6, source:'Institutional standard',
    label:'EV/EBITDA < sector median (enterprise value discipline)', target:'Tech: <35× fair · <20× cheap · >80× very expensive',
    why:'EV/EBITDA is capital-structure neutral — works even with buybacks, debt, or net-cash. More reliable than P/E for comparing companies.' },
  { id:'us_fwd_pe', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5, source:'Growth investing',
    label:'Forward P/E < 40× (or justified by growth trajectory)', target:'<25× = cheap · 25–40× = fair growth premium · >80× = requires exceptional execution',
    why:'Forward PE anchors valuation to expected earnings. NVDA at 25× fwd PE in 2023 was cheap for 400% EPS growth ahead. Context matters.' },
  { id:'us_mcap', pillar:'VALUATION', pillarColor:'#f59e0b', weight:8, source:'MOSL SQGLP adapted',
    label:'Market Cap $1B–$50B = multibagger runway zone', target:'$1–5B = maximum runway · $5–50B = solid runway · >$150B = limited 10× potential',
    why:'MOSL: sheer size militates against great growth. A $1B company can 100× to $100B. A $300B company needs to become $30T. Focus on $1–50B.' },
  // ── BALANCE SHEET ─────────────────────────────────────────────────────────
  { id:'us_debt', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:6, source:'Fisher survival filter',
    label:'D/E ≤ 0.5 (low leverage = resilience in downturns)', target:'D/E < 0.5 = clean · <1.0 = acceptable · >2.0 = existential risk in rate hikes',
    why:'US tech cycles can be brutal. High leverage during 2022 rate cycle destroyed companies. D/E < 0.5 = survives any cycle.' },
  { id:'us_net_cash', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:5, source:'Buffett',
    label:'Net cash position OR ND/EBITDA < 1.5', target:'Net cash = maximum flexibility · ND/EBITDA < 1.0 = safe · >3.0 = CRITICAL',
    why:'Net cash = can fund growth internally, return capital, make acquisitions. Best companies self-fund.' },
  // ── DISCOVERY / SQGLP "S" ─────────────────────────────────────────────────
  { id:'us_discovery', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:8, source:'MOSL SQGLP "S" adapted',
    label:'Analyst coverage ≤ 10 (undiscovered = institutional re-rating ahead)', target:'≤5 = essentially undiscovered · ≤12 = early · >30 = fully discovered, alpha gone',
    why:'MOSL: low institutional holding = undiscovered. US equivalent = low analyst coverage. When Goldman/MS initiate coverage, the re-rating happens. Be there first.' },
  { id:'us_insider', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:6, source:'Fisher insider signal',
    label:'Insider ownership ≥ 10% (management skin in game)', target:'>20% = strong alignment · 10–20% = good · <2% = watch carefully',
    why:'Fisher Scuttlebutt: insiders who own significant equity behave differently. Founder-led companies with 15%+ insider ownership consistently outperform.' },
  { id:'us_fwd_growth', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:5, source:'Forward visibility',
    label:'Forward revenue growth ≥ 20% FY1 (analysts confirm acceleration continues)', target:'>25% = analysts highly confident · <10% = slowdown expected',
    why:'Forward guidance from management + analyst consensus. If consensus sees 25%+ growth ahead, institutional money will follow.' },
  // ── TECHNICAL / MARKET ────────────────────────────────────────────────────
  { id:'us_technical', pillar:'TECHNICAL', pillarColor:'#f97316', weight:5, source:'MOSL price action',
    label:'Price above DMA200 OR within 20% (trend not broken)', target:'Above = uptrend intact · 0 to -20% = consolidating · >-30% = wait for reversal',
    why:'Price action validates fundamental thesis. 100-baggers rarely give long entry windows below DMA200.' },
  { id:'us_52wk', pillar:'TECHNICAL', pillarColor:'#f97316', weight:4, source:'Relative strength',
    label:'Near 52-week high (within 10%) = price confirming thesis', target:'0 to -10% = institutional buying confirmed · <-40% = requires deep dive',
    why:'When fundamentals are accelerating AND price is making new highs, institutions are actively buying. Breakout patterns precede the biggest moves.' },
  { id:'us_perf1y', pillar:'TECHNICAL', pillarColor:'#f97316', weight:3, source:'Momentum',
    label:'1-year performance > 20% (momentum confirming fundamentals)', target:'>50% = exceptional momentum · >20% = positive · Negative = wait for catalyst',
    why:'Price reflects accumulated fundamental insight. Strong 1-year performance with accelerating fundamentals = thesis intact, market agreeing.' },
  // ── SECTOR / TAILWIND ────────────────────────────────────────────────────
  { id:'us_tailwind', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:7, source:'Fisher Stage 1',
    label:'Sector structural tailwind — NOT at cyclical peak', target:'AI infra · Defence · Healthcare IT · Fintech · Space tech = HIGH tailwind',
    why:"Fisher: 'Buy the right industry at the right cycle point.' 100-baggers ride tailwinds + execution, not execution alone. Semiconductor in AI build-out = tailwind. Crypto at peak = cyclical trap." },
  { id:'us_not_cyclical', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:5, source:'Fisher Stage 1',
    label:'Not at peak cyclical moment (avoid sector top)', target:'Avoid: energy at high prices · semis at peak cycle · banks at credit peak',
    why:'Fisher: peak cyclical earnings = P/E looks cheap but earnings will collapse. Cyclical peaks are value traps disguised as value buys.' },
  // ── CATALYSTS ────────────────────────────────────────────────────────────
  { id:'us_catalyst', pillar:'CATALYST', pillarColor:'#ec4899', weight:6, source:'Framework mandatory',
    label:'Visible catalyst for re-rating in next 4–8 quarters', target:'New product launch / margin improvement / market share gain / international expansion',
    why:'Without a visible catalyst, a fundamentally good company can stay cheap for years. Identify the specific trigger that will move valuation.' },
  { id:'us_repeat', pillar:'CATALYST', pillarColor:'#ec4899', weight:5, source:'Framework final filter',
    label:'Growth repeatable for next 4–6 quarters (not one-quarter wonder)', target:"'Did this quarter materially increase probability of higher future earnings?' YES = buy",
    why:'The most important question: can this quarter structurally repeat? Framework: final filter before conviction sizing.' },
];

const USA_CHECKLIST_STORAGE = 'mb_usa_checklist_v1';

export function USAChecklist() {
  // PATCH 0461 — memoize the re-score so this component doesn't burn
  // 200-800ms re-parsing localStorage + re-running scoreUSARow on every
  // render. The dependency intentionally includes nothing — we only need
  // to re-score on mount; manual upload/clear is driven through events
  // captured below. (Audit found this was the biggest perf hog on the
  // USA tab.)
  // AUDIT_100 #18 — bump `tick` on cross-tab storage event AND on the existing
  // 'mc:switch-multibagger-tab' custom event so a fresh CSV upload is reflected
  // immediately. Previously deps were [] with no listeners → re-uploads were
  // invisible until a hard browser reload.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setTick(x => x + 1);
    const onStorage = (e: StorageEvent) => { if (e.key === 'mb_usa_scored_v1') bump(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:switch-multibagger-tab', bump as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mc:switch-multibagger-tab', bump as EventListener);
    };
  }, []);
  const usaRows = React.useMemo(() => {
    try {
      const saved = localStorage.getItem('mb_usa_scored_v1');
      if (!saved) return [];
      const parsed = JSON.parse(saved) as USAResult[];
      return parsed.map(r => scoreUSARow(r as unknown as USARow));
    } catch { return []; }
  }, [tick]);
  const [checks, setChecks] = React.useState<Record<string,boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_CHECKLIST_STORAGE)||'{}'); } catch { return {}; }
  });
  const [selectedTicker, setSelectedTicker] = React.useState('');
  const [notes, setNotes] = React.useState<Record<string,string>>(() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_notes_v1')||'{}'); } catch { return {}; }
  });

  const selRow = usaRows.find(r => r.symbol === selectedTicker);

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(next));
  }
  function updateNote(id: string, v: string) {
    const next = { ...notes, [id]: v };
    setNotes(next);
    localStorage.setItem('mb_usa_notes_v1', JSON.stringify(next));
  }

  const pillars = [...new Set(USA_CHECKLIST.map(c=>c.pillar))];
  const passed = USA_CHECKLIST.filter(c=>checks[c.id]).length;
  const total  = USA_CHECKLIST.length;
  const weightedPass = USA_CHECKLIST.filter(c=>checks[c.id]).reduce((s,c)=>s+c.weight,0);
  const weightedTotal = USA_CHECKLIST.reduce((s,c)=>s+c.weight,0);

  // Auto-check from scored data when ticker selected
  // Returns true/false for items with data, null for missing columns or qualitative items.
  // CRITICAL: optional fields (user hasn't added column) MUST return null not false.
  const autoStatus = (r: USAResult, id: string): boolean | null => {
    switch(id) {
      // ── Always available in base TradingView export ───────────────────────
      case 'us_gm':        return r.grossMarginAnn !== undefined ? r.grossMarginAnn >= 50 : null;
      case 'us_fcf':       return r.fcfMarginAnn !== undefined ? r.fcfMarginAnn >= 15 : null;
      case 'us_revgrowth': return r.revenueGrowthAnn !== undefined ? r.revenueGrowthAnn >= 20 : null;
      case 'us_rev_accel': return r.accelSignal !== undefined ? r.accelSignal === 'ACCELERATING' : null;
      case 'us_ev_ebitda': return r.evEbitda !== undefined ? r.evEbitda < 40 : null;
      case 'us_fwd_pe':    return r.forwardPe !== undefined && r.forwardPe > 0 ? r.forwardPe < 45 : null;
      case 'us_mcap':      return r.marketCapB !== undefined ? r.marketCapB < 50 : null;
      case 'us_net_cash':  return r.netDebtUsd !== undefined ? r.netDebtUsd <= 0 : null;
      // ── Computed from base export (recomputed in scoreUSARow now) ─────────
      case 'us_r40':       return r.ruleOf40 !== undefined ? r.ruleOf40 >= 40 : null;
      case 'us_gm_expand': return r.grossMarginExpansion !== undefined ? r.grossMarginExpansion > 0 : null;
      case 'us_gp_expand': return (r.grossProfitGrowthQtr !== undefined && r.revenueGrowthQtr !== undefined)
                               ? r.grossProfitGrowthQtr > r.revenueGrowthQtr : null;
      // ── Optional: user must add column to TradingView export ─────────────
      case 'us_roe':       return r.roe !== undefined ? r.roe >= 20 : null;
      case 'us_roic':      return r.roic !== undefined ? r.roic >= 15 : null;
      case 'us_eps_growth': return r.epsGrowth !== undefined ? r.epsGrowth >= 20 : null;
      case 'us_growth_sustained': return r.revGrowth3yr !== undefined ? r.revGrowth3yr >= 15 : null;
      case 'us_peg':       return r.peg !== undefined && r.peg > 0 ? r.peg < 1.5 : null;
      case 'us_debt':      return r.de !== undefined ? r.de <= 0.5 : null;
      case 'us_discovery': return r.analystCount !== undefined ? r.analystCount <= 10 : null;
      case 'us_insider':   return r.insiderOwnership !== undefined ? r.insiderOwnership >= 10 : null;
      case 'us_fwd_growth': return r.forwardRevGrowth !== undefined ? r.forwardRevGrowth >= 20 : null;
      case 'us_technical': return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -20 : null;
      case 'us_52wk':      return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -10 : null;
      case 'us_perf1y':    return r.perf1y !== undefined ? r.perf1y >= 20 : null;
      // ── Qualitative — user must assess manually ───────────────────────────
      default: return null;
    }
  };

  // Auto-tick all auto-determinable items when ticker changes
  // FIX: "if auto-pass it should be ticked already" — auto-pass = auto-check
  const applyAutoChecks = (row: USAResult) => {
    const autoUpdates: Record<string, boolean> = {};
    for (const item of USA_CHECKLIST) {
      const result = autoStatus(row, item.id);
      if (result !== null) autoUpdates[item.id] = result; // tick=true for pass, untick=false for fail
    }
    setChecks(prev => {
      // Qualitative items (result===null) keep manual state; auto items get overridden
      const merged = { ...prev, ...autoUpdates };
      localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(merged));
      return merged;
    });
  };

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:F.h2,fontWeight:800,color:'#38bdf8',marginBottom:4}}>🇺🇸 USA Research Checklist</div>
          <div style={{fontSize:F.md,color:MUTED}}>{total} criteria · Fisher 100-Bagger + MOSL SQGLP adapted + Rule of 40</div>
        </div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          {usaRows.length > 0 && (
            <select value={selectedTicker} onChange={e=>{
              const ticker = e.target.value;
              setSelectedTicker(ticker);
              if (ticker) {
                const row = usaRows.find(r => r.symbol === ticker);
                if (row) applyAutoChecks(row);
              }
            }}
              style={{padding:'8px 14px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:8,color:TEXT,fontSize:F.sm,cursor:'pointer'}}>
              <option value=''>Select stock — auto-ticks all checkable items...</option>
              {usaRows.slice(0,20).map(r=><option key={r.symbol} value={r.symbol}>{r.symbol} — {r.grade} ({r.score})</option>)}
            </select>
          )}
          <div style={{padding:'10px 18px',backgroundColor:passed>=20?`${GREEN}18`:passed>=12?`${YELLOW}18`:`${RED}18`,border:`1px solid ${passed>=20?GREEN:passed>=12?YELLOW:RED}30`,borderRadius:10,textAlign:'center'}}>
            <div style={{fontSize:F.h2,fontWeight:900,color:passed>=20?GREEN:passed>=12?YELLOW:RED}}>{passed}/{total}</div>
            <div style={{fontSize:F.xs,color:MUTED}}>checked · {Math.round(weightedPass/weightedTotal*100)}% weighted</div>
          </div>
        </div>
      </div>

      {pillars.map(pillar => {
        const items = USA_CHECKLIST.filter(c=>c.pillar===pillar);
        const pPassed = items.filter(c=>checks[c.id]).length;
        const pColor = items[0].pillarColor;
        return (
          <div key={pillar} style={{marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,borderBottom:`1px solid ${BORDER}`,paddingBottom:8}}>
              <span style={{fontSize:F.md,fontWeight:800,color:pColor,letterSpacing:'0.5px'}}>{pillar}</span>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>{pPassed}/{items.length} checked</span>
              <div style={{flex:1,height:4,backgroundColor:`rgba(255,255,255,0.06)`,borderRadius:2}}>
                <div style={{height:'100%',width:`${pPassed/items.length*100}%`,backgroundColor:pColor,borderRadius:2,transition:'width 0.3s'}}/>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(460px,1fr))',gap:10}}>
              {items.map(item => {
                const auto = selRow ? autoStatus(selRow, item.id) : null;
                const checked = checks[item.id] ?? false;
                const note = notes[item.id] ?? '';
                return (
                  <div key={item.id} style={{
                    padding:'14px 16px',backgroundColor:checked?`${pColor}08`:CARD_BG,
                    border:`1px solid ${checked?pColor+'40':BORDER}`,
                    borderLeft:`3px solid ${checked?pColor:auto===true?`${pColor}60`:auto===false?`${RED}40`:BORDER}`,
                    borderRadius:8,transition:'all 0.15s',
                  }}>
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <button onClick={()=>toggleCheck(item.id)} style={{
                        width:22,height:22,borderRadius:5,border:`2px solid ${checked?pColor:BORDER}`,
                        backgroundColor:checked?pColor:'transparent',flexShrink:0,marginTop:2,cursor:'pointer',
                        display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:14,
                      }}>{checked?'✓':''}</button>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontSize:F.md,fontWeight:700,color:checked?TEXT:`${TEXT}CC`}}>{item.label}</span>
                          <span style={{fontSize:F.xs,color:MUTED}}>w:{item.weight}</span>
                          {auto !== null && (
                            <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,
                              backgroundColor:auto?`${GREEN}18`:`${RED}18`,color:auto?GREEN:RED}}>
                              {auto?'✅ data confirms':'❌ data fails'}
                            </span>
                          )}
                          {auto === null && selRow && (
                            <span style={{fontSize:10,color:MUTED,padding:'2px 6px',borderRadius:10,backgroundColor:`${MUTED}10`}}>
                              ⬜ no data / qualitative
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:F.xs,color:YELLOW,marginBottom:4}}>🎯 {item.target}</div>
                        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{item.why}</div>
                        <div style={{fontSize:F.xs,color:`${MUTED}70`,marginTop:3}}>Source: {item.source}</div>
                        <textarea
                          value={note}
                          onChange={e=>updateNote(item.id,e.target.value)}
                          placeholder="Your notes..."
                          rows={1}
                          style={{width:'100%',marginTop:6,backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:6,padding:'6px 10px',color:MUTED,fontSize:F.xs,resize:'none',boxSizing:'border-box'}}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
