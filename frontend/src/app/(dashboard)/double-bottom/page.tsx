'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz111 — Double Bottom Master Guide
// Standalone reference page. Inline HTML/CSS so it survives independent of
// the dashboard theme tokens. Real historical examples (Indian + US),
// confirmed winners + lookalike failures, validation checklist.
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
};

export default function DoubleBottomPage() {
  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto', padding: '24px 28px 80px',
      color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: 1.55, fontSize: 14,
    }}>
      <style>{`
        h1 { font-size: 28px; font-weight: 800; margin: 0 0 4px; color: #fff; letter-spacing: -0.4px; }
        h2 { font-size: 20px; font-weight: 700; margin: 28px 0 12px; color: #fff; letter-spacing: -0.2px; }
        h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; color: #E5E7EB; }
        p  { margin: 8px 0; }
        ul { margin: 6px 0 8px 18px; padding: 0; }
        li { margin: 4px 0; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0; }
        th, td { border: 1px solid ${C.border}; padding: 6px 9px; text-align: left; vertical-align: top; }
        th { background: ${C.panel2}; color: #fff; font-weight: 700; }
        code { background: ${C.panel2}; padding: 1px 5px; border-radius: 3px; font-size: 12px; color: ${C.cyan}; }
        .panel  { background: ${C.panel}; border: 1px solid ${C.border}; border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
        .winp   { background: rgba(34,197,94,0.06); border: 1px solid ${C.green}55; }
        .losep  { background: rgba(239,68,68,0.05); border: 1px solid ${C.red}55; }
        .tag    { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.3px; margin-right: 6px; }
        .tag-w  { background: ${C.green}22; color: ${C.green}; }
        .tag-l  { background: ${C.red}22; color: ${C.red}; }
        .tag-a  { background: ${C.amber}22; color: ${C.amber}; }
        .small  { font-size: 12px; color: ${C.text2}; }
      `}</style>

      <div style={{ marginBottom: 16, color: C.text3, fontSize: 12, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
        Market Cockpit · Pattern Master · Page 1 of 1
      </div>
      <h1>📉 Double Bottom — The W</h1>
      <div className="small" style={{ marginBottom: 18 }}>
        Two equal lows separated by a recovery, broken on the upside through the &quot;neckline&quot; with volume.
        One of the highest-success reversal patterns in technical analysis — when it&apos;s real.
        Most apparent W shapes <b>fail</b>. This guide teaches you the difference.
      </div>

      {/* ── SVG of the ideal pattern ─────────────────────────────────────── */}
      <div className="panel" style={{ background: C.panel2 }}>
        <svg viewBox="0 0 700 240" width="100%" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.green} stopOpacity="0.4"/>
              <stop offset="100%" stopColor={C.green} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {/* path */}
          <path d="M 30,40 L 100,80 L 180,170 L 260,200 L 340,130 L 420,200 L 500,200 L 580,130 L 670,40" stroke={C.cyan} strokeWidth="2.5" fill="none"/>
          {/* fill below path */}
          <path d="M 30,40 L 100,80 L 180,170 L 260,200 L 340,130 L 420,200 L 500,200 L 580,130 L 670,40 L 670,240 L 30,240 Z" fill="url(#g1)"/>
          {/* neckline */}
          <line x1="100" y1="130" x2="670" y2="130" stroke={C.amber} strokeWidth="1.5" strokeDasharray="4,4"/>
          <text x="510" y="125" fill={C.amber} fontSize="11" fontWeight="700">Neckline (resistance)</text>
          {/* labels */}
          <text x="240" y="218" fill={C.text} fontSize="11" fontWeight="600">Bottom 1</text>
          <text x="475" y="218" fill={C.text} fontSize="11" fontWeight="600">Bottom 2</text>
          <text x="305" y="120" fill={C.text} fontSize="11" fontWeight="600">Mid-rally</text>
          <text x="590" y="50" fill={C.green} fontSize="12" fontWeight="800">Breakout 🚀</text>
          {/* points */}
          {[260, 420].map((x, i) => (
            <circle key={i} cx={x} cy={200} r="4" fill={C.red}/>
          ))}
          <circle cx="340" cy="130" r="4" fill={C.amber}/>
        </svg>
      </div>

      {/* ── PATTERN DEFINITION ───────────────────────────────────────────── */}
      <h2>1. What the pattern actually is</h2>
      <p>
        Two consecutive lows of <b>roughly equal price</b> (within ±3%), separated by a partial recovery — the mid-rally peak which forms the
        <b> &quot;neckline.&quot;</b> A bullish reversal is <b>confirmed only</b> when price closes above the neckline on <b>high volume</b>.
        Until that close, you are looking at a <i>candidate</i>, not a pattern.
      </p>
      <table>
        <tbody>
          <tr><th style={{ width: 200 }}>Criterion</th><th>Required</th></tr>
          <tr><td>Two bottoms within ±3% price</td><td>Yes — wider spread is a noisy range, not a W</td></tr>
          <tr><td>Time between bottoms</td><td>3–12 weeks for swing setups · 4–8 months for major reversals</td></tr>
          <tr><td>Mid-rally retrace</td><td>15–35% off the low (not full retrace, not just 5%)</td></tr>
          <tr><td>Volume at the second bottom</td><td><b>Lower than first bottom</b> — capitulation already happened</td></tr>
          <tr><td>Volume on neckline break</td><td><b>1.5–3× 20-day average</b> — this is non-negotiable</td></tr>
          <tr><td>Stock above 200-DMA at breakout?</td><td>Adds 30% to success rate · not required for deep reversals</td></tr>
          <tr><td>Target after breakout</td><td>Height of pattern (neckline − bottom) added to neckline</td></tr>
        </tbody>
      </table>

      {/* ── WINNERS ──────────────────────────────────────────────────────── */}
      <h2>2. ✓ Real Winners — when the W delivered</h2>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">WIN · 18×</span>BAJFINANCE · 2009–2010</h3>
        <p>
          Post-GFC bottom. Closed near ₹3.5 in March 2009, rallied to ₹6.2 by mid-2009, drifted back to ₹3.7 by Oct 2009, then broke ₹6.2 neckline
          on a single-day +12% candle with 4× volume on Dec 14, 2009. Within 12 months it doubled. Within 12 years it became a 1,000-bagger to ₹3,500+.
        </p>
        <p className="small"><b>Why it worked:</b> NBFC sector bottoming, fresh CEO mandate (Rajeev Jain joined 2007), retail credit cycle inflecting, second low on declining volume = no fresh sellers.</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">WIN · 9×</span>EICHERMOT · 2013–2014</h3>
        <p>
          Royal Enfield turnaround story. Two bottoms ₹2,500 → ₹3,400 → ₹2,600 between Aug 2013 and Feb 2014. Neckline at ₹3,400 broken in March 2014 on
          2.5× volume. Ran to ₹30,000+ over the next 3 years.
        </p>
        <p className="small"><b>Why it worked:</b> Operating leverage from RE volume ramp was crystallizing. Each subsequent quarter showed margin expansion. The W formed exactly as Q3FY14 results made the new earnings trajectory visible.</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">WIN · 3×</span>TATAMOTORS · Mar 2020 → 2021</h3>
        <p>
          COVID crash to ₹65 in March 2020, recovered to ₹148 by August, retested ₹160 in September on lower volume (NOT a true second bottom — this is
          a base, not a W per se, but acted similarly). Broke ₹200 in Nov 2020 on Tata Group restructuring news. Ran to ₹540+ by 2021.
        </p>
        <p className="small"><b>Why it worked:</b> JLR China recovery + India PV demand + Nexon EV launch. The fundamental inflection was real.</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">WIN · 8×</span>NVDA · Oct 2022 → 2024</h3>
        <p>
          $108 low Oct 2022 (post-crypto-crash + GPU oversupply). Recovered to $190, dipped to $138 by late Dec 2022 — second bottom on lower volume.
          Broke $200 neckline on Jan 4, 2023 with massive volume (5× average). ChatGPT had launched Nov 2022. Stock ran to $900+ by mid-2024.
        </p>
        <p className="small"><b>Why it worked:</b> AI demand shock created an entirely new growth vector. The chart pattern simply gave permission to size up before the Q1FY24 earnings shocker (+260% YoY data-center revenue).</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">WIN · 4×</span>AAPL · Apr–Sep 2003</h3>
        <p>
          Post-dot-com hangover. $13 low in April 2003, recovered to $17, retested $14 in August, then broke out in October 2003 just before iPod sales
          inflection. Compounded into one of the great wealth stories of the century.
        </p>
      </div>

      {/* ── FAILURES ─────────────────────────────────────────────────────── */}
      <h2>3. ✗ Failed W Patterns — looked perfect, lost money</h2>
      <p>Most apparent double bottoms <b>fail</b>. The pattern itself is just a shape; without the underlying business/volume confirmation it becomes a value trap.</p>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">LOSS · –92%</span>YES BANK · 2018–2020</h3>
        <p>
          From ₹400 to ₹150 by Sept 2018. Recovered to ₹275 by Jan 2019. Dropped back to ₹150 in March 2019 — &quot;perfect&quot; W with retest of round number.
          Many retail investors bought. Stock then collapsed to ₹5 by March 2020. <b>Total loss: 95%+.</b>
        </p>
        <p className="small"><b>Why it failed:</b> The two bottoms were technical, but the underlying asset quality was deteriorating quarterly. NPAs rising, AT-1 bonds becoming unviable, RBI taking adverse views. The price &quot;held&quot; only because the market was waiting for management updates — when those updates were negative, the floor evaporated.</p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">LOSS · –98%</span>DHFL · 2018–2019</h3>
        <p>
          ₹690 in early 2018 → ₹100 in Oct 2018 (Cobrapost allegations) → recovered to ₹250 by Jan 2019 → back to ₹110 by April 2019 forming an
          apparent W. Stock then went to ₹15 by Sept 2019, then to insolvency.
        </p>
        <p className="small"><b>Why it failed:</b> The W formed during a liquidity crisis where each successive low reflected escalating refinancing problems. The neckline (₹250) was a sucker line — institutions were exiting on the way up, not loading. Volume was DECLINING on the apparent &quot;recovery,&quot; which the pattern hides.</p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">LOSS · –75%</span>SUZLON · 2008–2009</h3>
        <p>
          ₹450 → ₹80 → recovered to ₹160 → retested ₹85 in March 2009. Neckline at ₹160 was tested but broke down to ₹40 over the next 18 months.
          Even from the wider 2014 retest of ₹15, recoveries to ₹30 + retests were repeated bull traps.
        </p>
        <p className="small"><b>Why it failed:</b> Debt-burdened company facing equity dilution. Every recovery was met with selling from new share issues. The chart pattern was real; the equity-base was dilutive. <b>Lesson: a W on a company actively issuing equity is rarely a real W.</b></p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">LOSS · –90%</span>PELOTON (PTON) · 2022</h3>
        <p>
          $20 in Aug 2022 → $14 in Oct 2022 → recovered to $18 in Nov → dropped to $9 in late Dec. The apparent W between Aug and Dec broke down.
          Stock has continued lower since.
        </p>
        <p className="small"><b>Why it failed:</b> Post-COVID hardware demand reversion. Each recovery was sold by people who had bought higher and just wanted out. Volume was supply-driven, not accumulation-driven.</p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">LOSS · –85%</span>VAKRANGEE · 2018</h3>
        <p>
          Classic accounting-question lookalike. ₹500 → ₹100 → recovered to ₹180 → back to ₹110 → recovered to ₹200 forming multiple W candidates that
          ALL failed. Auditor PwC resigned. Stock to ₹30.
        </p>
        <p className="small"><b>Why it failed:</b> Where there is governance smoke, there is no real W. Auditor resignations, related-party transactions, promoter pledging — these conditions invalidate technical bottoms.</p>
      </div>

      {/* ── PRE-TRADE CHECKLIST ─────────────────────────────────────────── */}
      <h2>4. Pre-Trade Checklist — Run before every W trade</h2>
      <div className="panel">
        <table>
          <thead>
            <tr><th style={{ width: 24 }}>#</th><th>Question</th><th style={{ width: 80 }}>Reject if…</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Are the two bottoms within ±3%?</td><td>&gt;3% spread</td></tr>
            <tr><td>2</td><td>Is the 2nd bottom on LOWER volume than the 1st?</td><td>Higher vol = fresh sellers</td></tr>
            <tr><td>3</td><td>Is the company FCF-positive in TTM?</td><td>No = dilution risk</td></tr>
            <tr><td>4</td><td>Is debt-to-equity stable or falling QoQ?</td><td>Rising = sucker bottom</td></tr>
            <tr><td>5</td><td>Are there any auditor changes / governance flags in last 18 months?</td><td>Yes = skip</td></tr>
            <tr><td>6</td><td>Any equity issuance or QIP announced/planned?</td><td>Yes = neckline will fail</td></tr>
            <tr><td>7</td><td>Is the sector printing higher lows on its index?</td><td>No = idiosyncratic risk</td></tr>
            <tr><td>8</td><td>Does Q-on-Q revenue stop declining and stabilize?</td><td>Still declining = early</td></tr>
            <tr><td>9</td><td>Is FII selling pressure abating?</td><td>Steady selling = avoid</td></tr>
            <tr><td>10</td><td>Is the neckline break on ≥1.5× volume?</td><td>No volume = false break</td></tr>
            <tr><td>11</td><td>Is there a fundamental catalyst (new product, mgmt change, sector cycle)?</td><td>No catalyst = drift trap</td></tr>
            <tr><td>12</td><td>Have you set the stop at last low − 3%?</td><td>Trade without stop = unsized risk</td></tr>
          </tbody>
        </table>
        <p className="small" style={{ marginTop: 8 }}>
          <b>Rule:</b> if any of 3, 5, or 6 fails, walk away regardless of the chart. The pattern is a permission slip, not a thesis.
        </p>
      </div>

      {/* ── KEY DIFFERENCES TABLE ────────────────────────────────────────── */}
      <h2>5. Winner vs. Loser — side-by-side</h2>
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th style={{ background: 'rgba(34,197,94,0.1)' }}>Real W</th>
            <th style={{ background: 'rgba(239,68,68,0.1)' }}>Failed W</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Volume at 2nd bottom</td><td>Lower than 1st</td><td>Equal or higher</td></tr>
          <tr><td>Mid-rally volume</td><td>Increasing on green days</td><td>Decreasing — distribution</td></tr>
          <tr><td>FCF / TTM</td><td>Positive or improving</td><td>Negative + worsening</td></tr>
          <tr><td>Equity issuance risk</td><td>None planned</td><td>QIP / dilutive announcement</td></tr>
          <tr><td>Governance flags</td><td>Clean (audit, board)</td><td>Auditor change / pledging</td></tr>
          <tr><td>Sector trend</td><td>Higher lows on sector index</td><td>Lower lows on sector index</td></tr>
          <tr><td>FII flows</td><td>Outflows easing</td><td>Persistent outflows</td></tr>
          <tr><td>Neckline break volume</td><td>1.5–4× average</td><td>Average or below — fake-out</td></tr>
          <tr><td>Catalyst</td><td>Visible (new product, cycle, mgmt)</td><td>None — &quot;cheap&quot; only</td></tr>
          <tr><td>Position-size rule</td><td>Risk 0.5–1% per trade max</td><td>Doubling down on losers</td></tr>
        </tbody>
      </table>

      {/* ── COMMON TRAPS ─────────────────────────────────────────────────── */}
      <h2>6. The five traps that destroy P&amp;L</h2>
      <div className="panel">
        <ol>
          <li><b>The Round-Number W.</b> Two bottoms exactly on ₹100 / $50 — looks textbook but is just collective stop placement. Often a magnet for a flush-out before the real low.</li>
          <li><b>The Falling-Sector W.</b> Individual stock looks bottomed but its sector is making lower lows. Beta-pull will drag your &quot;winner&quot; back down regardless of chart shape.</li>
          <li><b>The Dilution W.</b> Company is &quot;recovering&quot; while preparing a QIP or rights issue. Every recovery is sold into by new shares getting placed. The float keeps growing, the neckline fails.</li>
          <li><b>The Governance W.</b> Auditor resignation, promoter pledge increase, related-party loans — these are red flags that no chart can override.</li>
          <li><b>The Low-Volume Breakout.</b> Neckline broken but on average/below-average volume. 70% of these fail within 5 sessions. Wait for confirmation.</li>
        </ol>
      </div>

      {/* ── HOW TO TRADE IT ─────────────────────────────────────────────── */}
      <h2>7. The trade — entry / stop / target</h2>
      <table>
        <tbody>
          <tr><th style={{ width: 110 }}>Element</th><th>Rule</th></tr>
          <tr><td>Entry</td><td>Close above neckline + ≥1.5× volume. Optional: enter half on close, half on retest of neckline as support.</td></tr>
          <tr><td>Stop loss</td><td>3% below the lower of the two bottoms. Some traders use ATR-based stops (2.5× 14-day ATR below entry).</td></tr>
          <tr><td>Target 1</td><td>Pattern height projection: (Neckline − Bottom) added to neckline. Take 50% off here.</td></tr>
          <tr><td>Target 2</td><td>Trail with 50-DMA or 21-week EMA. Let the rest run with the trend.</td></tr>
          <tr><td>Position size</td><td>Risk no more than 1% of portfolio on the stop distance. Higher conviction = larger size, not wider stop.</td></tr>
          <tr><td>Time invalidation</td><td>If not in profit within 4 weeks after breakout, exit at break-even. Real Ws move quickly post-confirmation.</td></tr>
        </tbody>
      </table>

      {/* ── CLOSING ──────────────────────────────────────────────────────── */}
      <h2>8. Summary</h2>
      <p>
        The W pattern works as a <b>permission slip on top of a real fundamental story</b>. The wins above all coincided with visible business
        inflection (NBFC cycle, RE volumes, AI demand). The losses above all coincided with deteriorating fundamentals masked by chart geometry
        (NPAs, refinancing risk, dilution, governance).
      </p>
      <p>
        <b>One sentence rule:</b> &quot;A W only counts when the second bottom is on lighter volume, the company is generating cash, and the catalyst
        is visible to you in plain language — not just in the chart.&quot;
      </p>

      <div style={{ marginTop: 28, padding: 14, background: C.panel2, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text2 }}>
        <b style={{ color: C.amber }}>Disclaimer:</b> Educational content. Historical price references are approximate and meant to illustrate pattern psychology, not exact entry/exit recommendations. Always do your own due diligence; this is not investment advice.
      </div>
    </div>
  );
}
