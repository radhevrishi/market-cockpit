'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz114 — News Triage Master Playbook
// How to score every news item, react only to high-signal events,
// ignore the 90% that's noise. Built from real WallStreetEngine feeds.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';

const C = {
  bg:    '#0B0E14',
  panel: '#11151F',
  panel2:'#161B27',
  border:'#1F2937',
  text:  '#E5E7EB',
  text2: '#94A3B8',
  text3: '#64748B',
  green: '#22C55E',
  red:   '#EF4444',
  amber: '#F59E0B',
  cyan:  '#06B6D4',
  purple:'#8B5CF6',
  gold:  '#FBBF24',
};

const Tag = ({ kind, children }: { kind: 'long'|'short'|'sector'|'ignore'|'high'|'med'|'low'; children: React.ReactNode }) => {
  const map: any = {
    long:   { bg: C.green + '22',  fg: C.green,  label: 'LONG-TERM BUY' },
    short:  { bg: C.cyan + '22',   fg: C.cyan,   label: 'SHORT TRADE' },
    sector: { bg: C.purple + '22', fg: C.purple, label: 'SECTOR PLAY' },
    ignore: { bg: C.red + '22',    fg: C.red,    label: 'IGNORE' },
    high:   { bg: C.green + '22',  fg: C.green,  label: 'HIGH' },
    med:    { bg: C.amber + '22',  fg: C.amber,  label: 'MED' },
    low:    { bg: C.red + '22',    fg: C.red,    label: 'LOW' },
  };
  const s = map[kind] || map.ignore;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 5,
      background: s.bg, color: s.fg, fontSize: 11, fontWeight: 800,
      letterSpacing: '0.3px', marginRight: 6,
    }}>{children || s.label}</span>
  );
};

export default function NewsTriagePage() {
  return (
    <div style={{
      maxWidth: 1180, margin: '0 auto', padding: '24px 28px 80px',
      color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: 1.55, fontSize: 14,
    }}>
      <style>{`
        h1 { font-size: 30px; font-weight: 800; margin: 0 0 4px; color: #fff; letter-spacing: -0.4px; }
        h2 { font-size: 21px; font-weight: 700; margin: 32px 0 12px; color: #fff; letter-spacing: -0.2px; }
        h3 { font-size: 15px; font-weight: 700; margin: 18px 0 6px; color: #E5E7EB; }
        p  { margin: 6px 0; }
        ul { margin: 6px 0 8px 18px; padding: 0; }
        li { margin: 3px 0; }
        table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 6px 0; }
        th, td { border: 1px solid ${C.border}; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: ${C.panel2}; color: #fff; font-weight: 700; font-size: 12px; }
        code { background: ${C.panel2}; padding: 1px 5px; border-radius: 3px; font-size: 12px; color: ${C.cyan}; }
        .panel  { background: ${C.panel}; border: 1px solid ${C.border}; border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
        .longp  { background: rgba(34,197,94,0.05); border-left: 3px solid ${C.green}; }
        .shortp { background: rgba(6,182,212,0.05); border-left: 3px solid ${C.cyan}; }
        .sectp  { background: rgba(139,92,246,0.05); border-left: 3px solid ${C.purple}; }
        .ignp   { background: rgba(239,68,68,0.04); border-left: 3px solid ${C.red}; }
        .small  { font-size: 12px; color: ${C.text2}; }
        .grid5  { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 12px 0; }
        .dim    { background: ${C.panel2}; border: 1px solid ${C.border}; border-radius: 8px; padding: 12px; text-align: center; }
        .dim-n  { font-size: 28px; font-weight: 800; color: ${C.cyan}; line-height: 1; margin: 4px 0; }
        .dim-l  { font-size: 11px; color: ${C.text3}; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; }
        .dim-d  { font-size: 11.5px; color: ${C.text2}; margin-top: 4px; line-height: 1.35; }
      `}</style>

      <div style={{ marginBottom: 16, color: C.text3, fontSize: 12, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
        Market Cockpit · Decision Master · News Triage
      </div>
      <h1>📰 The News Triage Playbook</h1>
      <div className="small" style={{ marginBottom: 18, maxWidth: 880 }}>
        90% of financial news is noise. 10% can change a stock&apos;s 3-year trajectory. The job isn&apos;t to read everything —
        it&apos;s to score every headline in 30 seconds and decide: <b>Long-term buy · Short-term trade · Sector play · Ignore.</b>
        This playbook gives you the framework, the keywords, and 20+ examples from real WallStreetEngine feeds.
      </div>

      {/* ── 5-DIMENSION SCORING ─────────────────────────────────────────── */}
      <h2>📊 The 5-Dimension News Score</h2>
      <p className="small">Score every news item on these 5. Sum ≥ 15/25 = act. Below 15 = ignore.</p>
      <div className="grid5">
        <div className="dim">
          <div className="dim-l">Magnitude</div>
          <div className="dim-n">M</div>
          <div className="dim-d">Size of $ impact vs market cap. $1B deal on $500M mkt cap = 5/5. $50M deal on $500B mkt cap = 1/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Permanence</div>
          <div className="dim-n">P</div>
          <div className="dim-d">One-time vs structural. Multi-year contract = 5/5. Single quarter beat = 2/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Velocity</div>
          <div className="dim-n">V</div>
          <div className="dim-d">How fast it shows in P&amp;L. Already in this Q = 5/5. 2027+ impact = 1/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Surprise</div>
          <div className="dim-n">S</div>
          <div className="dim-d">Vs consensus. Totally unexpected = 5/5. Already priced in = 0/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Verifiability</div>
          <div className="dim-n">V</div>
          <div className="dim-d">Confirmed filing/press release = 5/5. &quot;Reportedly&quot; or rumor = 2/5.</div>
        </div>
      </div>

      <h3>How to use the score</h3>
      <table>
        <tbody>
          <tr><th style={{ width: 100 }}>Score</th><th>Decision</th><th>Hold period</th></tr>
          <tr><td><b>22-25</b></td><td>Top-conviction LONG. Size up.</td><td>Years</td></tr>
          <tr><td><b>18-21</b></td><td>LONG add. Normal sizing.</td><td>6-24 months</td></tr>
          <tr><td><b>15-17</b></td><td>Short-term trade or starter position.</td><td>1-12 weeks</td></tr>
          <tr><td><b>10-14</b></td><td>Watch only. No trade.</td><td>—</td></tr>
          <tr><td><b>&lt; 10</b></td><td>IGNORE. Pure noise.</td><td>—</td></tr>
        </tbody>
      </table>

      {/* ── DECISION TREE FLOWCHART ─────────────────────────────────────── */}
      <h2>🌳 The 30-Second Decision Tree</h2>
      <div className="panel">
        <svg viewBox="0 0 900 380" width="100%" style={{ display: 'block' }}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={C.text2}/>
            </marker>
          </defs>
          {/* Root */}
          <rect x="340" y="10" width="220" height="50" rx="8" fill={C.panel2} stroke={C.cyan}/>
          <text x="450" y="32" textAnchor="middle" fill={C.text} fontSize="13" fontWeight="700">NEW NEWS ITEM</text>
          <text x="450" y="50" textAnchor="middle" fill={C.text2} fontSize="11">Headline + first paragraph</text>

          {/* Q1 */}
          <line x1="450" y1="60" x2="450" y2="80" stroke={C.text2} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <rect x="290" y="80" width="320" height="48" rx="8" fill={C.panel2} stroke={C.amber}/>
          <text x="450" y="102" textAnchor="middle" fill={C.text} fontSize="12" fontWeight="700">Q1: Is there a dollar number, quantity, or % change?</text>
          <text x="450" y="118" textAnchor="middle" fill={C.text2} fontSize="11">e.g. &quot;$100B contracts&quot; / &quot;100B transistors&quot; / &quot;+50% YoY&quot;</text>

          {/* No → IGNORE */}
          <line x1="290" y1="104" x2="160" y2="104" stroke={C.red} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <text x="225" y="98" textAnchor="middle" fill={C.red} fontSize="10" fontWeight="800">NO</text>
          <rect x="40" y="80" width="120" height="48" rx="8" fill="rgba(239,68,68,0.15)" stroke={C.red}/>
          <text x="100" y="108" textAnchor="middle" fill={C.red} fontSize="12" fontWeight="800">IGNORE</text>

          {/* Yes → Q2 */}
          <line x1="450" y1="128" x2="450" y2="150" stroke={C.text2} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <text x="465" y="142" fill={C.green} fontSize="10" fontWeight="800">YES</text>
          <rect x="290" y="150" width="320" height="48" rx="8" fill={C.panel2} stroke={C.amber}/>
          <text x="450" y="172" textAnchor="middle" fill={C.text} fontSize="12" fontWeight="700">Q2: Is it &gt; 5% of company&apos;s annual revenue OR mcap?</text>
          <text x="450" y="188" textAnchor="middle" fill={C.text2} fontSize="11">If no → score &lt; 15 → IGNORE</text>

          {/* Yes Q2 → Q3 */}
          <line x1="450" y1="198" x2="450" y2="220" stroke={C.text2} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <rect x="290" y="220" width="320" height="48" rx="8" fill={C.panel2} stroke={C.amber}/>
          <text x="450" y="242" textAnchor="middle" fill={C.text} fontSize="12" fontWeight="700">Q3: Is it structural (multi-year) or one-time?</text>
          <text x="450" y="258" textAnchor="middle" fill={C.text2} fontSize="11">Contracts/agreements/TAM expansion = structural. Buybacks/dividends = one-time.</text>

          {/* Final outcomes */}
          <line x1="290" y1="270" x2="150" y2="320" stroke={C.cyan} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <text x="210" y="290" fill={C.cyan} fontSize="10" fontWeight="800">ONE-TIME</text>
          <rect x="40" y="320" width="220" height="50" rx="8" fill="rgba(6,182,212,0.12)" stroke={C.cyan}/>
          <text x="150" y="340" textAnchor="middle" fill={C.cyan} fontSize="13" fontWeight="800">SHORT TRADE</text>
          <text x="150" y="358" textAnchor="middle" fill={C.text2} fontSize="11">Buybacks · tariffs · dividends · M&amp;A pop</text>

          <line x1="610" y1="270" x2="750" y2="320" stroke={C.green} strokeWidth="1.5" markerEnd="url(#arr)"/>
          <text x="690" y="290" fill={C.green} fontSize="10" fontWeight="800">STRUCTURAL</text>
          <rect x="640" y="320" width="220" height="50" rx="8" fill="rgba(34,197,94,0.12)" stroke={C.green}/>
          <text x="750" y="340" textAnchor="middle" fill={C.green} fontSize="13" fontWeight="800">LONG-TERM BUY</text>
          <text x="750" y="358" textAnchor="middle" fill={C.text2} fontSize="11">Contracts · TAM raises · regulatory shifts</text>
        </svg>
      </div>

      {/* ── KEYWORD CHEAT SHEET ─────────────────────────────────────────── */}
      <h2>🔑 The Keyword Cheat Sheet — what to look for</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: 90 }}>Score</th>
            <th>Keywords / Phrases</th>
            <th style={{ width: 200 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: 'rgba(34,197,94,0.04)' }}>
            <td><Tag kind="high"></Tag></td>
            <td>
              &quot;multi-year contract&quot;, &quot;<b>$XB binding agreement</b>&quot;, &quot;TAM raised to&quot;, &quot;first-ever&quot;, &quot;FDA approval&quot;,
              &quot;court ruling in favor&quot;, &quot;regime change&quot;, &quot;100B+ transistors&quot;, &quot;<b>16 strategic customer agreements&quot;</b>,
              &quot;committed capacity&quot;, &quot;X-year exclusive&quot;, &quot;DoJ approved&quot;, &quot;FTC cleared&quot;, &quot;100% tariff&quot;, &quot;sanction lifted&quot;,
              &quot;reserve requirement raised&quot;, &quot;rate hike&quot;
            </td>
            <td>Score 20+. LONG-TERM BUY or major macro hedge</td>
          </tr>
          <tr style={{ background: 'rgba(245,158,11,0.04)' }}>
            <td><Tag kind="med"></Tag></td>
            <td>
              &quot;raised guidance&quot;, &quot;stress-test pass&quot;, &quot;dividend hike&quot;, &quot;$XB buyback authorized&quot;, &quot;named CFO&quot;,
              &quot;CEO succession&quot;, &quot;agreement to acquire&quot;, &quot;exclusive negotiation&quot;, &quot;LOI signed&quot;,
              &quot;qualification complete&quot;, &quot;design-win pipeline&quot;
            </td>
            <td>Score 15-19. Short trade or watch.</td>
          </tr>
          <tr style={{ background: 'rgba(239,68,68,0.04)' }}>
            <td><Tag kind="low"></Tag></td>
            <td>
              &quot;exploring&quot;, &quot;considering&quot;, &quot;in talks&quot;, &quot;could&quot;, &quot;may&quot;, &quot;rumored&quot;, &quot;reportedly&quot;,
              &quot;hired Morgan Stanley to advise&quot;, &quot;weighing options&quot;, &quot;partnership announced&quot; (no $ number),
              &quot;courtside signage&quot;, &quot;digital integration&quot;, single-day price moves, mortgage rate ±2bps
            </td>
            <td>Score &lt; 15. IGNORE.</td>
          </tr>
        </tbody>
      </table>

      <h3>The &quot;Edge Test&quot; — final filter</h3>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Ask one question: <b>Does this news change my model of the company&apos;s 3-year EPS by &gt; 10%?</b>
        </p>
        <ul>
          <li>If YES — react with conviction (size, direction, time horizon).</li>
          <li>If NO — even if interesting, ignore. Your time is the scarce resource.</li>
        </ul>
      </div>

      {/* ── REAL EXAMPLES ───────────────────────────────────────────────── */}
      <h2>📚 20+ Real Examples — scored and decoded</h2>
      <p className="small">Pulled from real Wall Street Engine feeds. Score = M + P + V + S + V (out of 25).</p>

      {/* LONG-TERM BUY EXAMPLES */}
      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>MICRON — &quot;16 strategic customer agreements, ~$100B over remaining term&quot;</h3>
        <p><b>Score: 24/25</b> (M5 · P5 · V4 · S5 · V5)</p>
        <p>Multi-year binding revenue with named customers locks in capacity utilization. <b>40% of revenue at fixed/ceiling prices.</b> Eliminates the boom-bust cycle that destroyed Micron historically.</p>
        <p className="small"><b>How to react:</b> Long-term position. Size 3-5% of equity allocation. Hold through cycle.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>QUALCOMM Investor Day — &quot;Data center revenue: $0.3B → $15B by FY29&quot;</h3>
        <p><b>Score: 22/25</b> (M5 · P5 · V3 · S4 · V5)</p>
        <p>50× revenue growth target with $65B auto design-win pipeline. <b>$1T+ TAM</b> declared. Even at 50% achievement, this is a step-change in Qualcomm&apos;s narrative from mobile-only.</p>
        <p className="small"><b>How to react:</b> Long position. Watch quarterly progress to first $1B revenue milestone for confirmation.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>QUALCOMM — &quot;High Bandwidth Compute architecture stacks memory &amp; compute vertically&quot;</h3>
        <p><b>Score: 21/25</b> (M4 · P5 · V3 · S4 · V5)</p>
        <p>New product architecture extending data-center IP to mobile/PC/auto. Enables &quot;always-on agents on mobile devices.&quot; If the architecture works at scale, this is a moat-creation event.</p>
        <p className="small"><b>How to react:</b> Add to long-term thesis. Track first product launches and design-wins.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>IBM — &quot;Sub-1nm chip with 0.7nm nanostack 3D transistor design, 100B transistors on fingernail&quot;</h3>
        <p><b>Score: 19/25</b> (M4 · P5 · V2 · S4 · V4)</p>
        <p>Research-stage but credible IBM lab announcement. 50% more performance or 70% better efficiency vs. 2nm. Long-dated, but defines technology leadership.</p>
        <p className="small"><b>How to react:</b> Sentiment add. Wait for commercialization timeline before sizing.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>BOFA — &quot;2030 global semi TAM raised $2.3T → $2.7T, AI adds next $1T in 5 years&quot;</h3>
        <p><b>Score: 21/25</b> (M5 · P5 · V3 · S3 · V5)</p>
        <p>Big-bank TAM upgrade. Sector-wide tailwind. Reinforces structural thesis for all top semi names (NVDA, AMD, AVGO, MU, TSM).</p>
        <p className="small"><b>How to react:</b> Sector overweight signal. Add to semi basket if not already heavy.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>SK HYNIX — &quot;Shares +13% on $29B US listing + strong Micron earnings&quot;</h3>
        <p><b>Score: 20/25</b> (M5 · P4 · V4 · S4 · V3)</p>
        <p>$29B US listing is one of the largest in history. Validates HBM cycle. Korean tech revaluation thesis.</p>
        <p className="small"><b>How to react:</b> Long if in Asia tech, or use SK Hynix ADR / KOSPI ETF. Risk: trade war exposure.</p>
      </div>

      {/* SHORT TRADE EXAMPLES */}
      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>TRUMP — &quot;100% tariff on countries with Digital Services Tax&quot;</h3>
        <p><b>Score: 18/25</b> (M5 · P3 · V5 · S4 · V1)</p>
        <p>Macro shock. High velocity (markets react in hours). But could be negotiating tactic — partial reversal likely. Truth-Social policy.</p>
        <p className="small"><b>How to react:</b> SHORT trade in affected sectors (US-importer multinationals, European/Indian IT exporters to US). Time horizon 1-4 weeks. Take profits on first walkback rumor.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>BAYER — &quot;Supreme Court shields Bayer from Roundup cancer-warning suits&quot;</h3>
        <p><b>Score: 17/25</b> (M4 · P5 · V5 · S5 · V5 but already partly priced)</p>
        <p>Legal liability removal. Direct EPS impact via reserves release. One-time but large.</p>
        <p className="small"><b>How to react:</b> SHORT TRADE long (paradoxical — long position, short horizon). Buy Bayer ADR / German shares for 2-8 week pop. Exit after first major upgrade.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>JPM — &quot;Dividend $1.50 → $1.65/share + new $50B buyback&quot;</h3>
        <p><b>Score: 15/25</b> (M3 · P3 · V4 · S2 · V5)</p>
        <p>Cosmetic capital return; doesn&apos;t change earnings power. Stress-test pass was the real signal (already priced).</p>
        <p className="small"><b>How to react:</b> Short-term sentiment positive. Don&apos;t initiate position on this alone. If long, hold.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>XBOX — &quot;Console prices raised 25-30%, M-cost +2.5×&quot;</h3>
        <p><b>Score: 16/25</b> (M3 · P4 · V5 · S5 · V5)</p>
        <p>Confirms memory cost inflation cycle. Direct bullish read-through to MU and SK Hynix. Bearish for hardware-volume thesis but bullish for memory upstream.</p>
        <p className="small"><b>How to react:</b> Long memory names short-term. Bearish on game-console-dependent ecosystem partners. 2-6 week trade.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>BRENT — &quot;Brent falls below $75 first time since Iran war began&quot;</h3>
        <p><b>Score: 17/25</b> (M4 · P3 · V5 · S4 · V5)</p>
        <p>Geopolitical risk premium evaporating. Velocity high. Implications for energy stocks (negative), airline/transport (positive), India CAD (positive — India is oil importer).</p>
        <p className="small"><b>How to react:</b> Short trade on energy if positioned long. Long Indian aviation (INDIGO) / paint (ASIAN PAINT — crude input). 1-3 week horizon.</p>
      </div>

      {/* SECTOR PLAY EXAMPLES */}
      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>PENTAGON — &quot;US Army leases land to Titan/EnergyX/Ioneer for critical minerals&quot;</h3>
        <p><b>Score: 22/25</b> (M5 · P5 · V3 · S5 · V5)</p>
        <p><b>Regime change for US critical-mineral supply chain.</b> Bipartisan policy. ~$2B initial investment. Government takes mineral output share instead of cash. This is a NEW industrial-policy era.</p>
        <p className="small"><b>How to react:</b> Sector basket — IONR, ALB, LAC, MP, sometimes USA Rare Earth. Long-dated. Add even on weakness. Read all subsequent policy announcements as confirming the thesis.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>AMAZON — &quot;$13B additional India AI investment by 2030&quot;</h3>
        <p><b>Score: 19/25</b> (M4 · P5 · V3 · S3 · V4)</p>
        <p>$13B is significant for India tech ecosystem. Beneficiaries: Indian data center REITs, power utility BHEL/JSW Energy, real estate near Hyderabad/Bangalore tech corridors.</p>
        <p className="small"><b>How to react:</b> Indian sectoral basket — data center, power, RE. 12-24 month thesis. India macro positive.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>ARES — &quot;Private credit fund caps redemptions at 5% again&quot;</h3>
        <p><b>Score: 18/25</b> (M3 · P5 · V4 · S4 · V5)</p>
        <p>Second cap. Signals private credit stress building. Read-through: bearish to private credit BDCs, bearish to commercial real estate, bullish to systemically-important banks who win flows. <b>Macro warning sign.</b></p>
        <p className="small"><b>How to react:</b> Reduce private credit exposure. Add to large bank longs (JPM, BAC). Watch high-yield spread (junk bond ETF JNK).</p>
      </div>

      {/* IGNORE EXAMPLES */}
      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>CARTER&apos;S — &quot;WNBA partnership with Atlanta Dream, courtside signage&quot;</h3>
        <p><b>Score: 5/25</b> (M1 · P1 · V1 · S1 · V1)</p>
        <p>Marketing partnership with no $ disclosed. Zero revenue impact. Pure PR. Ignore — even though it&apos;s a real announcement.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>FREDDIE MAC — &quot;30-yr mortgage rate edged up to 6.49% from 6.47%&quot;</h3>
        <p><b>Score: 6/25</b> (M1 · P2 · V1 · S1 · V1)</p>
        <p>2 basis point move. Statistically noise. Daily data release. Ignore unless rate breaks a 100bp range threshold.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>BUMBLE — &quot;Exploring potential sale, hired Morgan Stanley to advise&quot;</h3>
        <p><b>Score: 12/25</b> (M3 · P4 · V2 · S2 · V1)</p>
        <p>&quot;Hired advisor&quot; = exploration phase, not commitment. 60%+ of such announcements never close. Wait for binding terms.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>RADWARE — &quot;Partnered with Dataiku for AI security controls&quot;</h3>
        <p><b>Score: 8/25</b> (M1 · P2 · V2 · S2 · V1)</p>
        <p>Integration announcement with no revenue figures, no exclusivity, no committed customer. Standard go-to-market PR. Ignore.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>NIKE — &quot;Named David Denton as next CFO Aug 17&quot;</h3>
        <p><b>Score: 11/25</b> (M2 · P3 · V2 · S2 · V2)</p>
        <p>Executive succession matters long-term but doesn&apos;t change near-term earnings. Wait 1-2 quarters to see strategic changes before acting.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>ANDURIL — &quot;In talks to acquire Nissan&apos;s Oppama plant&quot;</h3>
        <p><b>Score: 10/25</b> (M3 · P4 · V2 · S2 · V1)</p>
        <p>Multiple buyers cited, no decision made. Even if it happens, integration is years away. Wait for confirmed agreement.</p>
      </div>

      {/* SPECIAL CASE: M&A */}
      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>ONSEMI — &quot;Acquiring Synaptics for $7B all-stock&quot;</h3>
        <p><b>Score: 18/25</b> (M4 · P5 · V4 · S4 · V5 — but binary risk)</p>
        <p>Confirmed deal, all-stock. Synaptics holders get short-term pop. Onsemi holders see dilution short-term but strategic fit medium-term.</p>
        <p className="small"><b>How to react:</b> SYNA holders: trade the spread (merger arb) — buy SYNA, short ONSEMI in the merger ratio. Onsemi holders: hold, wait 6-12 months for synergy delivery.</p>
      </div>

      {/* ── INSTRUMENT GUIDE ────────────────────────────────────────────── */}
      <h2>🎯 Instrument Guide — What to Buy/Sell</h2>
      <table>
        <thead>
          <tr><th style={{ width: 130 }}>Decision</th><th>Best instruments</th><th>Avoid</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><Tag kind="long"/></td>
            <td>Common stock. ATM/OTM call leaps (1-2 year expiry) for leverage. SIP-style add on dips.</td>
            <td>Weekly options — too much time decay. Leveraged ETFs — decay hurts long holds.</td>
          </tr>
          <tr>
            <td><Tag kind="short"/></td>
            <td>Weekly/monthly options. Stock + tight stop loss (5-8%). For broad themes: thematic ETFs (XLE, XSD, ITA).</td>
            <td>LEAPS — overpaid for time value on short trades. Heavy stock — risk of large drawdown if reverse.</td>
          </tr>
          <tr>
            <td><Tag kind="sector"/></td>
            <td>Sector ETF (ITA defense, REMX rare earths, KIE insurance). 5-10 stock basket if no ETF available.</td>
            <td>Single stock — sector themes can have winners/losers, basket is safer.</td>
          </tr>
          <tr>
            <td><Tag kind="ignore"/></td>
            <td>Cash. Your existing positions.</td>
            <td>Trading on noise. Each unnecessary trade taxes alpha.</td>
          </tr>
        </tbody>
      </table>

      {/* ── TIME-HORIZON GUIDE ──────────────────────────────────────────── */}
      <h2>⏱ Time Horizon Cheat Sheet</h2>
      <table>
        <thead>
          <tr><th style={{ width: 130 }}>Horizon</th><th>News types that fit</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><b>Hours-Days</b></td>
            <td>Court rulings, earnings beats/misses, tariff announcements, sanctions lifted, FDA approvals, M&amp;A announcements (target side).</td>
          </tr>
          <tr>
            <td><b>1-4 weeks</b></td>
            <td>Capital returns (dividend hikes, buybacks), stress-test results, large block trades, geopolitical de-escalation, oil/commodity breakouts.</td>
          </tr>
          <tr>
            <td><b>1-6 months</b></td>
            <td>New product launches, contract wins of moderate size, regulatory hearings, sector ETF flows, M&amp;A close completions.</td>
          </tr>
          <tr>
            <td><b>1-3 years</b></td>
            <td>Multi-year customer agreements, TAM upgrades, regime-change policies (IRA, critical-mineral acts), industrial-policy investment.</td>
          </tr>
          <tr>
            <td><b>3-10 years</b></td>
            <td>Architecture inventions (HBM, new chip nodes), regulatory frameworks (EU AI Act), demographic shifts, sustained capex super-cycles.</td>
          </tr>
        </tbody>
      </table>

      {/* ── COMMON TRAPS ────────────────────────────────────────────────── */}
      <h2>⚠ 7 Traps that Destroy Returns</h2>
      <div className="panel">
        <ol>
          <li><b>Rumor trap.</b> &quot;Reportedly&quot;, &quot;in talks&quot;, &quot;considering&quot; — these have 30-40% follow-through rates. Wait for confirmation.</li>
          <li><b>Partnership trap.</b> Any announcement without a dollar number is marketing, not finance. Ignore.</li>
          <li><b>Executive-shuffle trap.</b> New CFO/CEO matters in year 2, not week 2. Don&apos;t front-run leadership news.</li>
          <li><b>Already-priced trap.</b> By the time news hits WallStreetEngine, the smart money has positioned. Check the 5-day chart before acting.</li>
          <li><b>Headline misreads.</b> Read past the headline. &quot;Q1 GDP 2.1%&quot; could be revision up or down — context matters.</li>
          <li><b>Macro confirmation bias.</b> One data point (mortgage rate, jobless claims) doesn&apos;t flip a thesis. Wait for trend.</li>
          <li><b>FOMO on individual chats.</b> Discord pushes adrenaline. Step back. If the score is &lt; 15, walk away even if everyone else is buying.</li>
        </ol>
      </div>

      {/* ── 30-SEC TRIAGE CHECKLIST ─────────────────────────────────────── */}
      <h2>✓ The 30-Second Triage Checklist</h2>
      <div className="panel">
        <table>
          <thead><tr><th style={{ width: 32 }}>#</th><th>Step</th><th style={{ width: 80 }}>Time</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Read headline + first paragraph. Find the dollar number / % / quantity.</td><td>5s</td></tr>
            <tr><td>2</td><td>If no number → IGNORE.</td><td>1s</td></tr>
            <tr><td>3</td><td>Is the number &gt; 5% of company&apos;s annual revenue OR market cap?</td><td>5s</td></tr>
            <tr><td>4</td><td>Is it structural (multi-year, contract) or one-time?</td><td>3s</td></tr>
            <tr><td>5</td><td>Score it: M+P+V+S+V mental sum.</td><td>10s</td></tr>
            <tr><td>6</td><td>Decision: Long / Short / Sector / Ignore</td><td>3s</td></tr>
            <tr><td>7</td><td>Pick instrument + position size + stop.</td><td>3s</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── CLOSING ──────────────────────────────────────────────────────── */}
      <h2>📝 Summary</h2>
      <p>
        Discord and Twitter feeds give you 100 news items per day. 90 of them have <b>zero effect</b> on your portfolio,
        even if interesting. The job is to triage in 30 seconds and act on the 10 that matter.
      </p>
      <p>
        <b>The one-sentence rule:</b> &quot;If there&apos;s no dollar number, ignore. If the number is small relative to the company,
        ignore. If structural — go long. If one-time — short trade. If sectoral — basket. Everything else is noise.&quot;
      </p>

      <div style={{ marginTop: 28, padding: 14, background: C.panel2, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text2 }}>
        <b style={{ color: C.amber }}>Disclaimer:</b> Educational framework. Examples are real headlines but scoring is opinion;
        execute with your own due diligence. Position sizing and stops must reflect your individual risk tolerance.
        Discord news (WallStreetEngine and similar) is faster than legacy media but is not investment advice. Verify
        before acting.
      </div>
    </div>
  );
}
