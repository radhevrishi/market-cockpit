'use client';

// ConcallPro.tsx — concall mastery reference card.
// Standalone component to keep the main page.tsx clean. Pass the C color palette.

type CPal = { gold: string; dim: string; cyan: string; muted: string; body: string; green: string; amber: string; red: string };

const sectionHdStyle = (C: CPal) => ({fontSize:14, fontWeight:700 as const, color:C.cyan, marginTop:18, marginBottom:8, borderBottom: '1px solid ' + C.muted, paddingBottom:4});
const cardStyle = (C: CPal) => ({padding:10, background:'rgba(174,187,208,0.04)', border:'1px solid '+C.muted, borderRadius:6, marginBottom:8, fontSize:12, color:C.body, lineHeight:1.55});
const lexStyle = (C: CPal) => ({fontSize:11, color:C.dim, fontStyle:'italic' as const});
const chipStyle = (C: CPal) => ({display:'inline-block' as const, padding:'2px 8px', margin:'2px 4px 2px 0', background:'rgba(255,215,0,0.10)', border:'1px solid '+C.gold, borderRadius:10, fontSize:11, color:C.gold});

const KW_GROUPS: { title: string; kws: string[] }[] = [
  { title: '🏗 Capacity & Capex', kws: ['utilization','capex','commission','expansion','brownfield','greenfield','debottleneck','MW','MT','tonnes','installed','operational by'] },
  { title: '📦 Demand & Pipeline', kws: ['order book','backlog','pipeline','enquir','RFQ','RFP','tender','book-to-bill','marquee customer','design win','repeat order'] },
  { title: '💰 Margins & Pricing', kws: ['EBITDA margin','operating margin','gross margin','pricing','pricing power','pass-through','raw material','operating leverage','realization','mix'] },
  { title: '🔮 Guidance & Outlook', kws: ['guidance','expect','target','outlook','visibility','FY27','FY28','medium-term','steady state','structural'] },
  { title: '💸 Balance Sheet & Funding', kws: ['debt','net cash','D/E','QIP','fundraise','working capital','receivable days','inventory days','interest cost','contingent liability'] },
  { title: '🚩 Risks & Red Flags', kws: ['one-off','exceptional','deferred','delay','challenging','headwind','lumpy','provision','write-off','related party','auditor'] },
];

const SECTORS: { title: string; tail: string; red: string }[] = [
  { title: 'Pharma / CDMO / API', tail: 'FDA approval · USFDA cleared · EUGMP · WHO-GMP · ANDA filings · DMF · China+1 · captive · backward-integration', red: '483 · warning letter · import alert · OAI · recall · patent cliff · price erosion' },
  { title: 'Solar / Renewables', tail: 'PLI · ALMM · RPO · safeguard duty · BCD · order book MW · battery storage · domestic content', red: 'China dumping · polysilicon spike · module price erosion · curtailment · DISCOM payments' },
  { title: 'T&D / Power Equipment', tail: 'smart meter · RDSS · data center · transmission line · transformer · substation · battery storage', red: 'DISCOM payment delay · subsidy backlog · execution slippage · L1 vs L1+5%' },
  { title: 'Capital Goods / Defense / Railways', tail: 'order book · book-to-bill · indigenization · Make in India · iDEX · Kavach · Vande Bharat · L1', red: 'tender delay · L1 walk-away · provisioning · execution risk · cost over-run' },
  { title: 'Auto-Ancillary / EMS', tail: 'EV ramp · design win · premium model · OEM Tier-1 · content per vehicle · BOM enrichment', red: 'customer concentration · OEM destocking · model phase-out · receivable stretch' },
  { title: 'Specialty Chem / Agrochem', tail: 'China+1 · destocking ended · inventory normalization · innovator partnership · multi-year contract', red: 'inventory overhang · price erosion · oil-linked volatility · environmental fine' },
  { title: 'Food / FMCG / Egg', tail: 'feed cost down · EU import demand · premiumization · A&P leverage · distribution expansion', red: 'feed cost spike · FX weakness · channel destocking · ASP cut' },
  { title: 'Steel / Cement / Bulk Commodities', tail: 'utilization above 85% · price hike sustained · China discipline · iron-ore down', red: 'China capacity restart · price collapse · spread compression · debt funded expansion' },
];

export default function ConcallPro({ C }: { C: CPal }) {
  return (
    <div style={{padding:'14px 4px', maxWidth: 1180, margin: '0 auto'}}>
      <div style={{fontSize:20, fontWeight:700, color:C.gold, marginBottom:4}}>🎓 Concall Pro — read like a champion</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:6}}>One-page reference. The pattern that wins: <b style={{color:C.body}}>prepare → skim structure → ctrl+F power keywords → mine the Q&amp;A → extract 12 numbers → check 8 red flags → write a 3-bullet update.</b></div>

      <div style={sectionHdStyle(C)}>① BEFORE YOU READ (5 min)</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.gold}}>1.</b> Open the <b>previous quarter&#39;s transcript</b> first. What did they GUIDE? What KPIs were promised? Concall judging = guidance vs delivery.</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>2.</b> Pull the <b>investor presentation</b> alongside — slide-by-slide narrative is the same story management will tell.</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>3.</b> Note <b>consensus EPS &amp; rev estimates</b> and the <b>3 things the bulls believe</b> + <b>3 things the bears worry about</b>. The call resolves those.</div>
        <div style={{marginTop:6, ...lexStyle(C)}}>Why: 80% of value is whether the call validated / disrupted your prior. Without a prior, every fact looks important.</div>
      </div>

      <div style={sectionHdStyle(C)}>② ANATOMY OF A CONCALL — read in this order</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.gold}}>A. Opening monologue (CEO/CFO, ~10 min):</b> the narrative they want printed. Note repeated phrases — those are slogans / strategy pillars.</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>B. Segment commentary:</b> which segment is the hero? Which gets a single line? Single-line segments hide deceleration.</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>C. Forward guidance:</b> the only forward-looking number that&#39;s auditable. Note conviction words (we expect vs we are targeting vs we are confident).</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>D. Q&amp;A (60-70% of value!):</b> management gets tested here. <b>Long answers = uncertainty</b>. <b>2-3 follow-ups on the same topic = real concern</b>. <b>Deflection = issue</b>.</div>
        <div style={{marginTop:6, ...lexStyle(C)}}>Pro tip: skim opening → JUMP to Q&amp;A → come back to segments only if Q&amp;A surfaced something.</div>
      </div>

      <div style={sectionHdStyle(C)}>③ POWER KEYWORDS — ctrl+F these every time</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8}}>
        {KW_GROUPS.map(g => (
          <div key={g.title} style={cardStyle(C)}>
            <div style={{fontWeight:700, color:C.cyan, marginBottom:6}}>{g.title}</div>
            {g.kws.map(k => (<span key={k} style={chipStyle(C)}>{k}</span>))}
          </div>
        ))}
      </div>

      <div style={sectionHdStyle(C)}>④ SECTOR-SPECIFIC DECKS — ctrl+F these by sector</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8}}>
        {SECTORS.map(s => (
          <div key={s.title} style={cardStyle(C)}>
            <b style={{color:C.green}}>{s.title}</b><br/>
            <span style={lexStyle(C)}>tailwinds:</span> {s.tail}<br/>
            <span style={lexStyle(C)}>red flags:</span> {s.red}
          </div>
        ))}
      </div>

      <div style={sectionHdStyle(C)}>⑤ PHRASES THAT TELL THE TRUTH — tone lexicon</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8}}>
        <div style={{padding:10, background:'rgba(0,230,138,0.05)', border:'1px solid '+C.green, borderRadius:6, fontSize:12, color:C.body, lineHeight:1.55}}>
          <div style={{fontWeight:700, color:C.green, marginBottom:6}}>✅ POSITIVE conviction</div>
          <div style={lexStyle(C)}>in line with our plan · ahead of guidance · exceeded our internal target · strong pricing held · robust demand environment · fully booked · we are confident · structural shift · multi-year visibility</div>
        </div>
        <div style={{padding:10, background:'rgba(255,179,71,0.05)', border:'1px solid '+C.amber, borderRadius:6, fontSize:12, color:C.body, lineHeight:1.55}}>
          <div style={{fontWeight:700, color:C.amber, marginBottom:6}}>⚠ CAUTIOUS hedging</div>
          <div style={lexStyle(C)}>we will see how it plays out · remains to be seen · watching closely · near-term cautious · lumpy quarter · back-ended · second-half loaded · Q1 was a wash · monitoring the situation</div>
        </div>
        <div style={{padding:10, background:'rgba(255,77,106,0.05)', border:'1px solid '+C.red, borderRadius:6, fontSize:12, color:C.body, lineHeight:1.55}}>
          <div style={{fontWeight:700, color:C.red, marginBottom:6}}>🚩 RED FLAG spin</div>
          <div style={lexStyle(C)}>challenging quarter · weaker than expected · deferred · one-time · exceptional item · transition phase · investing for future · structural rationalization · course correction · tactical pricing</div>
        </div>
      </div>

      <div style={sectionHdStyle(C)}>⑥ THE 12 NUMBERS TO ALWAYS EXTRACT</div>
      <div style={cardStyle(C)}>
        <ol style={{margin:0, paddingLeft:18, lineHeight:1.7}}>
          <li><b>Current util %</b> (vs last call&#39;s util%)</li>
          <li><b>Order book in Cr</b> (vs annual revenue → book-to-bill)</li>
          <li><b>Capex spend this year + next year</b></li>
          <li><b>Capacity now → after expansion</b> (in physical units)</li>
          <li><b>Commissioning timeline</b> (specific quarter)</li>
          <li><b>EBITDA margin guidance</b> (steady state vs current)</li>
          <li><b>Revenue guidance</b> (FY+1 and FY+2)</li>
          <li><b>Net debt or net cash</b></li>
          <li><b>Top customer concentration %</b></li>
          <li><b>Export %</b></li>
          <li><b>Funding source for capex</b> (internal vs debt vs QIP)</li>
          <li><b>Raw material trend</b> (pricing power test)</li>
        </ol>
      </div>

      <div style={sectionHdStyle(C)}>⑦ 8 RED-FLAG PATTERNS — pick these out fast</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.red}}>1. Receivable days creep.</b> 60 → 75 → 90 over 3 calls = channel stuffing or distress.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>2. Inventory build with flat sales.</b> Demand is softer than narrative.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>3. One-off / exceptional more than once a year.</b> Recurring one-off is just operating reality.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>4. Segmental reporting change.</b> Often hides a deceleration.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>5. CWIP perpetually stuck above 10% of net block.</b> Capex isn&#39;t being commissioned — earnings printing is delayed.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>6. Subsidiary or related-party transaction expansion.</b> Look for interco or RPT in the financials.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>7. Management refuses to give margin guidance.</b> Either margin is at risk OR they were burnt last time.</div>
        <div style={{marginTop:4}}><b style={{color:C.red}}>8. CFO change / auditor change in the year.</b> Always investigate.</div>
      </div>

      <div style={sectionHdStyle(C)}>⑧ Q&amp;A READING STRATEGY — where the real call lives</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.cyan}}>Long answer rule:</b> if management spends over 300 words answering, they&#39;re either uncertain or it&#39;s a topic they CARE about. Flag it.</div>
        <div style={{marginTop:6}}><b style={{color:C.cyan}}>Repeat-question rule:</b> the same analyst asking 2-3 follow-ups means the original answer didn&#39;t satisfy. The PE/HF analyst knows.</div>
        <div style={{marginTop:6}}><b style={{color:C.cyan}}>Deflection rule:</b> we don&#39;t disclose that / we&#39;ll come back to you offline / pivots to a different metric = the question hit a sore spot.</div>
        <div style={{marginTop:6}}><b style={{color:C.cyan}}>Question quality rule:</b> note who asks. Long-only buy-side (Fidelity, T.Rowe, Prima, ICICI Pru AMC, HDFC AMC) ≠ small broker. Buy-side questions probe thesis.</div>
        <div style={{marginTop:6}}><b style={{color:C.cyan}}>Last question rule:</b> moderators often save the toughest question for last. Read backwards.</div>
      </div>

      <div style={sectionHdStyle(C)}>⑨ THE 60-SECOND SKIM — when you&#39;re short on time</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.gold}}>Step 1 (10s):</b> ctrl+F → <b>guidance</b>. Read those 3-5 sentences.</div>
        <div style={{marginTop:4}}><b style={{color:C.gold}}>Step 2 (15s):</b> ctrl+F → <b>order book</b> or <b>backlog</b>. Note the number.</div>
        <div style={{marginTop:4}}><b style={{color:C.gold}}>Step 3 (15s):</b> ctrl+F → <b>utilization</b>. Compare to last call.</div>
        <div style={{marginTop:4}}><b style={{color:C.gold}}>Step 4 (10s):</b> ctrl+F → <b>capex</b>. Total spend + timeline.</div>
        <div style={{marginTop:4}}><b style={{color:C.gold}}>Step 5 (10s):</b> ctrl+F → <b>margin</b>. Direction + steady state.</div>
        <div style={{marginTop:8, ...lexStyle(C)}}>Five searches, one minute, 80% of the signal.</div>
      </div>

      <div style={sectionHdStyle(C)}>⑩ AFTER THE CALL — close the loop</div>
      <div style={cardStyle(C)}>
        <div><b style={{color:C.gold}}>1.</b> Write your <b>3-bullet thesis update</b>: confirmed / weakened / pivoted. Max 15 words each.</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>2.</b> Pick <b>1-2 KPIs to track next quarter</b> (e.g., util above 75%, order book above 1.5x revenue).</div>
        <div style={{marginTop:6}}><b style={{color:C.gold}}>3.</b> Set the <b>next catalyst date</b> in your calendar — commissioning, results, regulatory milestone.</div>
      </div>

      <div style={{marginTop:18, padding:10, background:'rgba(255,215,0,0.06)', border:'1px solid '+C.gold, borderRadius:6, fontSize:11.5, color:C.dim, lineHeight:1.55, fontStyle:'italic'}}>
        <b style={{color:C.gold, fontStyle:'normal'}}>💎 THE CHAMPION&#39;S MINDSET:</b> Most readers skim the opening monologue, miss the Q&amp;A, and call it done. The 10% who win on concalls do the opposite: skim the opening, READ the Q&amp;A line-by-line, hunt the conviction words, count the qualifiers. The market prices the headlines instantly; you make money on the second derivative — what management is REALLY telling you, and what their tone is REALLY saying.
      </div>
    </div>
  );
}
