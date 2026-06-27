'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz112 — Fan Principle Master Guide
// Edwards & Magee's three-trendline rule for trend reversal confirmation.
// Real examples + failures + checklist.
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

export default function FanPrinciplePage() {
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
      <h1>🪭 The Fan Principle</h1>
      <div className="small" style={{ marginBottom: 18 }}>
        From Edwards &amp; Magee&apos;s <i>Technical Analysis of Stock Trends</i> (1948). A trend reversal is only
        <b> confirmed</b> when three successive trendlines are broken — &quot;the three fans.&quot; Ignore one or two breaks;
        wait for three. The pattern that finally tells you the bull (or bear) is dead.
      </div>

      {/* ── SVG ──────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ background: C.panel2 }}>
        <svg viewBox="0 0 700 240" width="100%" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="gf1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.green} stopOpacity="0.35"/>
              <stop offset="100%" stopColor={C.green} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {/* trend path: up trend then 3 fans then down */}
          <path d="M 20,200 L 90,170 L 160,135 L 220,110 L 280,150 L 330,120 L 390,165 L 440,135 L 500,180 L 550,150 L 620,205 L 680,225"
                stroke={C.cyan} strokeWidth="2.5" fill="none"/>
          <path d="M 20,200 L 90,170 L 160,135 L 220,110 L 280,150 L 330,120 L 390,165 L 440,135 L 500,180 L 550,150 L 620,205 L 680,225 L 680,240 L 20,240 Z"
                fill="url(#gf1)"/>

          {/* Fan 1 (steepest) — connects 20,200 to 220,110, extended */}
          <line x1="20" y1="200" x2="350" y2="55" stroke={C.amber} strokeWidth="1.5" strokeDasharray="4,4"/>
          <text x="200" y="80" fill={C.amber} fontSize="10" fontWeight="700">Fan 1 (steepest)</text>

          {/* Fan 2 — shallower */}
          <line x1="20" y1="200" x2="500" y2="105" stroke="#EAB308" strokeWidth="1.5" strokeDasharray="4,4"/>
          <text x="370" y="130" fill="#EAB308" fontSize="10" fontWeight="700">Fan 2</text>

          {/* Fan 3 — shallowest, break = confirmed reversal */}
          <line x1="20" y1="200" x2="650" y2="160" stroke={C.red} strokeWidth="1.5" strokeDasharray="4,4"/>
          <text x="490" y="155" fill={C.red} fontSize="10" fontWeight="700">Fan 3 broken = REVERSAL</text>

          <circle cx="220" cy="110" r="4" fill={C.amber}/>
          <circle cx="390" cy="165" r="4" fill="#EAB308"/>
          <circle cx="620" cy="205" r="4" fill={C.red}/>
        </svg>
      </div>

      <h2>1. The principle in one paragraph</h2>
      <p>
        Draw the existing trendline. When price breaks it, do NOT call the trend dead. Draw a SECOND trendline from the original origin to the new minor peak (in an uptrend reversal). When THAT breaks, still don&apos;t call it. Draw a THIRD. <b>When the third trendline breaks, the trend is genuinely reversed.</b> This is the Edwards &amp; Magee rule, refined over 80+ years of evidence.
      </p>

      <h3>Why three?</h3>
      <p>
        One break = noise or shake-out. Two breaks = trend losing momentum but not yet broken. Three breaks = the trend has lost the ability
        to defend a successively shallower path of least resistance. The shallowing fans show progressive supply exhaustion (in uptrend death) or
        progressive demand exhaustion (in downtrend death).
      </p>

      <table>
        <tbody>
          <tr><th style={{ width: 200 }}>Element</th><th>Detail</th></tr>
          <tr><td>Origin point</td><td>Same starting point for all three fan lines — typically the major prior swing low (for uptrend) or high (for downtrend)</td></tr>
          <tr><td>Fan 1</td><td>Steepest — the original trendline. Connects origin to the highest minor peak that respected it</td></tr>
          <tr><td>Fan 2</td><td>Shallower — drawn after Fan 1 breaks, connects origin to the next minor peak</td></tr>
          <tr><td>Fan 3</td><td>Shallowest — drawn after Fan 2 breaks. When Fan 3 breaks, reversal is confirmed</td></tr>
          <tr><td>Volume on Fan 3 break</td><td>Should be elevated (≥1.5× 20-day avg) for highest reliability</td></tr>
          <tr><td>Time between fans</td><td>Variable — can be days (short-term) or months (major trends). Each fan should be respected for at least 2–3 touches</td></tr>
          <tr><td>Target after Fan 3 break</td><td>Often a retest of the origin point or 50% retrace of the entire prior trend</td></tr>
        </tbody>
      </table>

      {/* ── WINNERS ──────────────────────────────────────────────────────── */}
      <h2>2. ✓ Real Examples — when the third fan broke and the trend died</h2>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">CLASSIC</span>NIFTY 50 · 2007 → 2008 Bear Top</h3>
        <p>
          The 2003–2007 bull market drew a steep first trendline from 920 (Apr 2003) to ~5,500 (Jan 2008). When it broke in Jan 2008, a second
          shallower trendline was drawn from the same origin to the May 2008 minor peak (~5,200). Broke again in June 2008. A third even shallower
          line was drawn — when that broke in September 2008 (Lehman week), the bear market was confirmed. NIFTY went from 4,500 to 2,500 in 10 weeks.
        </p>
        <p className="small"><b>What it taught:</b> the first two breaks could have been &quot;buy the dip&quot;; the third break was &quot;sell everything.&quot; The discipline of waiting for the third fan saved capital that buy-the-dip discipline would have destroyed.</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">CLASSIC</span>S&amp;P 500 · 2000 Dot-Com Top</h3>
        <p>
          From the Oct 1998 low at ~960 to March 2000 peak at 1,553. First fan broken April 2000. Second fan formed and broken Sept 2000. Third
          fan broken Jan 2001 — confirming the bear market that took S&amp;P to 768 by Oct 2002 (–50%).
        </p>
        <p className="small"><b>Why it worked:</b> Each successive fan reflected progressively weaker bull defense. The third break coincided with the realization that 2001 earnings were collapsing.</p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">EXAMPLE</span>BAJFINANCE · 2018 → 2020 Trend Death (Bull-end)</h3>
        <p>
          The 2014–2018 super-trend broke its first fan in Aug 2018 around ₹2,800. A second fan formed by Oct 2018, broken Feb 2019. A third
          formed by Jan 2020, broken Feb–March 2020 (COVID). The stock fell from ₹4,800 to ₹2,000 in 8 weeks — a 58% drawdown.
        </p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">EXAMPLE</span>NIFTY 50 · 2020 → 2021 Bottom-Reverse (Bear-end)</h3>
        <p>
          The bear trend from Jan 2020 (12,400) to March 2020 (7,500) broke its first descending fan in April 2020. Second fan formed and broken
          May 2020. Third fan broken June 2020 — confirming the new bull market that took NIFTY to 18,800 by Oct 2021.
        </p>
      </div>

      <div className="panel winp">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-w">EXAMPLE</span>NVDA · 2022 Bear Bottom Reverse</h3>
        <p>
          The bear trend from Nov 2021 ($346) to Oct 2022 ($108) drew descending fans. First fan broken Nov 2022. Second broken Dec 2022.
          Third broken Jan 2023 — confirming the AI super-trend.
        </p>
      </div>

      {/* ── FAILURES ─────────────────────────────────────────────────────── */}
      <h2>3. ✗ When applying Fan Principle would have given a false reversal</h2>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">FAILURE</span>NIFTY · 2015 — 3 fan breaks, but no real reversal</h3>
        <p>
          The 2013–2015 uptrend broke its first fan in March 2015. Second fan broken May 2015. Third broken July 2015 — by the book, a confirmed reversal.
          NIFTY did fall from 8,500 to 7,500. But by Feb 2016 it bottomed at 6,800 and the bull resumed for 6 more years. The &quot;reversal&quot; was just a
          18-month sideways correction.
        </p>
        <p className="small"><b>Why it misled:</b> Macro context matters. The corporate earnings cycle was idling, not collapsing. No banking-system stress, no sector breaking down hard. The price action looked like a reversal but was a deep correction in a structural bull. <b>Lesson: Fan Principle confirms trend change in price — not in fundamentals. A reversal in price during a healthy macro is often just a correction.</b></p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">FAILURE</span>RELIANCE · 2018 — 3 down-fans broken, then more downside</h3>
        <p>
          In late 2018 RELIANCE descending fans appeared broken successively, suggesting bottom reversal. The third fan broke around ₹1,150 in
          November. Many traders went long expecting a new bull cycle. The stock then chopped sideways into Q4 2018 with a deeper low at ₹1,050 by
          Feb 2019 — a 9% drawdown for those who took the &quot;confirmed reversal&quot; entry.
        </p>
        <p className="small"><b>Why it misled:</b> Single-stock fan analysis requires sector confirmation. Energy was still under structural pressure. The third break gave a false signal until the sector itself stopped making lower lows.</p>
      </div>

      <div className="panel losep">
        <h3 style={{ marginTop: 0 }}><span className="tag tag-l">FAILURE</span>YES BANK · Apparent reversal fans in 2019</h3>
        <p>
          As Yes Bank crashed through 2019, multiple bear-trend lines were drawn and successively broken on counter-trend rallies. Three-fan reversal
          signals fired three times, each one tempting buyers in. Every &quot;confirmed reversal&quot; was a dead-cat bounce inside an ongoing collapse.
        </p>
        <p className="small"><b>Why it misled:</b> Solvency-stress charts violate trend analysis. The asset is being repriced toward zero based on book-value impairment — chart patterns are noise overlaid on a fundamental implosion. <b>Never apply Fan Principle to a stock facing existential balance-sheet risk.</b></p>
      </div>

      {/* ── CHECKLIST ───────────────────────────────────────────────────── */}
      <h2>4. Pre-Trade Checklist — three fans confirmed, now what?</h2>
      <div className="panel">
        <table>
          <thead>
            <tr><th style={{ width: 24 }}>#</th><th>Question</th><th style={{ width: 80 }}>Reject if…</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Did each fan have ≥2 touches respecting it before breaking?</td><td>Only 1 touch = wasn&apos;t a real trendline</td></tr>
            <tr><td>2</td><td>Was the third break on ≥1.5× average volume?</td><td>Low volume = fake</td></tr>
            <tr><td>3</td><td>Did the third break sustain a close, not just an intraday wick?</td><td>Wick-only = no signal</td></tr>
            <tr><td>4</td><td>Is the broader market index in the same regime?</td><td>Lone stock vs. trending sector = unsafe</td></tr>
            <tr><td>5</td><td>Are macro conditions consistent (Fed/RBI direction, credit spread)?</td><td>Macro headwind = fan still in noise</td></tr>
            <tr><td>6</td><td>For bull-end signal: is corporate earnings cycle slowing?</td><td>No = likely a correction, not reversal</td></tr>
            <tr><td>7</td><td>For bear-end signal: is the panic selling capitulation phase done (VIX peaked)?</td><td>No = early</td></tr>
            <tr><td>8</td><td>Have you defined an exact invalidation level (where the third fan retest fails)?</td><td>No stop = unsized risk</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── KEY DIFFERENCES ─────────────────────────────────────────────── */}
      <h2>5. Real reversal vs. Noise — distinguishing factors</h2>
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th style={{ background: 'rgba(34,197,94,0.1)' }}>Real reversal</th>
            <th style={{ background: 'rgba(239,68,68,0.1)' }}>Noise / correction</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Volume on fan breaks</td><td>Increasing on each break</td><td>Decreasing or flat</td></tr>
          <tr><td>Time between fan breaks</td><td>Successively shorter</td><td>Long gaps — trend still defending</td></tr>
          <tr><td>Broader index regime</td><td>Same direction (multi-stock confirmation)</td><td>Lone stock vs. healthy index</td></tr>
          <tr><td>Macro backdrop</td><td>Rate cycle / credit / earnings inflecting</td><td>Macro is unchanged</td></tr>
          <tr><td>Sector breadth</td><td>Failing across sector peers</td><td>Idiosyncratic — only this stock weak</td></tr>
          <tr><td>VIX behavior</td><td>Spiking (bear-end) or rising slowly (bull-end)</td><td>Subdued</td></tr>
          <tr><td>Post-Fan 3 follow-through</td><td>Move within 2 weeks, sustained</td><td>Drift, then trend resumes</td></tr>
        </tbody>
      </table>

      {/* ── HOW TO TRADE IT ─────────────────────────────────────────────── */}
      <h2>6. The trade — entry / stop / target</h2>
      <table>
        <tbody>
          <tr><th style={{ width: 110 }}>Element</th><th>Rule</th></tr>
          <tr><td>Entry</td><td>Close beyond Fan 3 + ≥1.5× volume + macro context check. Optional half-entry on close, half on retest.</td></tr>
          <tr><td>Stop loss</td><td>Reverse side of Fan 3, at 1× ATR beyond the breakout point. If reclaimed, the signal is voided.</td></tr>
          <tr><td>Target 1</td><td>Retest of the original trend origin point (often a 50% retrace of the prior trend).</td></tr>
          <tr><td>Target 2</td><td>Full retrace of the prior trend (more aggressive). Trail with a 50-DMA for the survivors.</td></tr>
          <tr><td>Position size</td><td>Risk no more than 1–2% of portfolio on the stop distance. Trend reversals can be large; sizing should reflect conviction, not stop-width.</td></tr>
          <tr><td>Time invalidation</td><td>If price doesn&apos;t move in your direction within 2–3 weeks of the third break, exit at break-even.</td></tr>
        </tbody>
      </table>

      {/* ── COMMON MISTAKES ─────────────────────────────────────────────── */}
      <h2>7. Five mistakes that destroy the edge</h2>
      <div className="panel">
        <ol>
          <li><b>Drawing fans on volatility, not trend.</b> If price is choppy and didn&apos;t actually trend, three &quot;fans&quot; are noise. Apply only after a clear directional move with ≥3 trendline touches.</li>
          <li><b>Ignoring intermarket context.</b> A reversal in a single stock without breadth confirmation (sector index, market index, currency) is unreliable. Trade only when the third fan break is corroborated by 2+ other signals.</li>
          <li><b>Acting on Fan 1 or Fan 2 break.</b> This is what panic traders do. The principle&apos;s whole edge is the THIRD break. Two breaks = corrections; three = trend death.</li>
          <li><b>No volume gate.</b> A break on low volume is a fake-out. 70%+ of single-day Fan 3 breaks on subpar volume get reclaimed within a week.</li>
          <li><b>Trading reversals on insolvency situations.</b> Yes Bank type setups: when the underlying business is impaired, no chart pattern survives. Use Fan Principle only on companies with stable fundamentals.</li>
        </ol>
      </div>

      {/* ── CLOSING ──────────────────────────────────────────────────────── */}
      <h2>8. Summary</h2>
      <p>
        Fan Principle is the patience pattern. Most retail traders go short on the first trendline break and lose money to noise. Most go long on the
        second break and lose money to a deeper correction. The <b>third break is where the institutional money positions for trend reversal</b>, because
        by then the macro / sector / volume has aligned.
      </p>
      <p>
        <b>One sentence rule:</b> &quot;Wait for the third fan break, on volume, with macro context. The first two breaks are tuition you don&apos;t need to pay.&quot;
      </p>

      <div style={{ marginTop: 28, padding: 14, background: C.panel2, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text2 }}>
        <b style={{ color: C.amber }}>Disclaimer:</b> Educational content based on Edwards &amp; Magee&apos;s <i>Technical Analysis of Stock Trends</i> and Indian/US market history. Approximate price levels for illustration; not investment advice.
      </div>
    </div>
  );
}
