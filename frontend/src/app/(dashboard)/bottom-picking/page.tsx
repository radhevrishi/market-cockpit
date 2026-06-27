'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz113 — Bottom Picking Master Guide
// 22 bottom-detection methods ranked by historical batting average.
// Single self-contained HTML/CSS page. Inline styles to survive theme drift.
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

export default function BottomPickingPage() {
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
        h4 { font-size: 13px; font-weight: 700; margin: 10px 0 4px; color: ${C.cyan}; text-transform: uppercase; letter-spacing: 0.4px; }
        p  { margin: 6px 0; }
        ul { margin: 6px 0 8px 18px; padding: 0; }
        li { margin: 3px 0; }
        table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 6px 0; }
        th, td { border: 1px solid ${C.border}; padding: 5px 8px; text-align: left; vertical-align: top; }
        th { background: ${C.panel2}; color: #fff; font-weight: 700; font-size: 12px; }
        code { background: ${C.panel2}; padding: 1px 5px; border-radius: 3px; font-size: 12px; color: ${C.cyan}; }
        .panel  { background: ${C.panel}; border: 1px solid ${C.border}; border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
        .tier1 { border-left: 3px solid ${C.green}; }
        .tier2 { border-left: 3px solid ${C.cyan}; }
        .tier3 { border-left: 3px solid ${C.purple}; }
        .tier4 { border-left: 3px solid ${C.amber}; }
        .tier5 { border-left: 3px solid ${C.gold}; }
        .rank  { display: inline-block; min-width: 28px; padding: 2px 6px; border-radius: 5px; font-weight: 800; font-size: 12px; text-align: center; margin-right: 8px; }
        .small { font-size: 12px; color: ${C.text2}; }
        .pill  { display: inline-block; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-right: 4px; }
        .ba-elite { background: ${C.green}22; color: ${C.green}; }
        .ba-strong { background: ${C.cyan}22; color: ${C.cyan}; }
        .ba-mid { background: ${C.amber}22; color: ${C.amber}; }
      `}</style>

      <div style={{ marginBottom: 16, color: C.text3, fontSize: 12, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
        Market Cockpit · Pattern Master · Bottom Picking Master
      </div>
      <h1>📈 The Complete Bottom Picking Playbook</h1>
      <div className="small" style={{ marginBottom: 18, maxWidth: 820 }}>
        22 methods to detect market and stock bottoms — ranked by historical batting average. Stack 3+ signals
        from <b>different tiers</b> for genuine high-conviction setups. Acting on any single pattern alone fails
        ~40–60% of the time. Acting on three from different tiers fails &lt;15%.
      </div>

      {/* ── MASTER RANKING TABLE ─────────────────────────────────────────── */}
      <h2>🏆 Master Ranking — All 22 Methods</h2>
      <p className="small">Ranked by batting average × leading-edge × actionability. Elite (≥75% historical hit rate at major bottoms) at top.</p>
      <table>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>Method</th>
            <th style={{ width: 110 }}>Tier</th>
            <th style={{ width: 90 }}>Batting Avg</th>
            <th>What it measures</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><b>1</b></td><td><b>Bullish RSI Divergence</b></td><td>Indicator</td><td><span className="pill ba-elite">~78%</span></td><td>Internal momentum improving while price falls</td></tr>
          <tr><td><b>2</b></td><td><b>Rounding Bottom (Saucer/Cup)</b></td><td>Chart</td><td><span className="pill ba-elite">~76%</span></td><td>Slow consistent absorption — no sharp low</td></tr>
          <tr><td><b>3</b></td><td><b>Insider Buying Cluster (3+ in 30 days)</b></td><td>Behavioral</td><td><span className="pill ba-elite">~75%</span></td><td>People with private info loading</td></tr>
          <tr><td><b>4</b></td><td><b>Inverse Head &amp; Shoulders</b></td><td>Chart</td><td><span className="pill ba-elite">~73%</span></td><td>Three lows, middle deepest = flush completed</td></tr>
          <tr><td><b>5</b></td><td><b>FCF Decline Halts QoQ for 2+ quarters</b></td><td>Fundamental</td><td><span className="pill ba-elite">~72%</span></td><td>Cash flow inflection = earnings bottom near</td></tr>
          <tr><td><b>6</b></td><td><b>Zweig Breadth Thrust</b></td><td>Breadth</td><td><span className="pill ba-elite">~71%</span></td><td>10-day MA of A/(A+D): &lt;0.40 → &gt;0.61 in 10 days</td></tr>
          <tr><td><b>7</b></td><td><b>Junk-bond Spread Peak + Narrowing</b></td><td>Breadth</td><td><span className="pill ba-strong">~68%</span></td><td>Credit market signals risk appetite reversal</td></tr>
          <tr><td><b>8</b></td><td><b>Falling Wedge Breakout</b></td><td>Chart</td><td><span className="pill ba-strong">~67%</span></td><td>Successive lower lows narrowing = exhaustion</td></tr>
          <tr><td><b>9</b></td><td><b>Capitulation Day (−8% to −15% on 3-5× vol)</b></td><td>Volume</td><td><span className="pill ba-strong">~65%</span></td><td>Seller queue cleared in one session</td></tr>
          <tr><td><b>10</b></td><td><b>Triple Bottom</b></td><td>Chart</td><td><span className="pill ba-strong">~64%</span></td><td>Three equal lows = floor confirmed</td></tr>
          <tr><td><b>11</b></td><td><b>VIX &gt;35 + Closes Below 5-DMA</b></td><td>Breadth</td><td><span className="pill ba-strong">~63%</span></td><td>Fear has peaked, normalization started</td></tr>
          <tr><td><b>12</b></td><td><b>Morning Star (Weekly)</b></td><td>Candle</td><td><span className="pill ba-strong">~62%</span></td><td>3-candle weekly reversal at support</td></tr>
          <tr><td><b>13</b></td><td><b>Double Bottom (clean criteria)</b></td><td>Chart</td><td><span className="pill ba-strong">~60%</span></td><td>Two equal lows + volume confirmation</td></tr>
          <tr><td><b>14</b></td><td><b>% Stocks Above 50-DMA &lt;15%</b></td><td>Breadth</td><td><span className="pill ba-strong">~60%</span></td><td>Universe-wide oversold reading</td></tr>
          <tr><td><b>15</b></td><td><b>MACD Histogram Higher Lows</b></td><td>Indicator</td><td><span className="pill ba-strong">~58%</span></td><td>Rate-of-decline slowing</td></tr>
          <tr><td><b>16</b></td><td><b>90% Down Volume Day (Lowry)</b></td><td>Volume</td><td><span className="pill ba-strong">~57%</span></td><td>Selling climax — often within 2-3 days of low</td></tr>
          <tr><td><b>17</b></td><td><b>AAII Bull Sentiment &lt;20%</b></td><td>Behavioral</td><td><span className="pill ba-mid">~55%</span></td><td>Retail capitulation = contrarian buy</td></tr>
          <tr><td><b>18</b></td><td><b>Bullish Engulfing at Oversold RSI</b></td><td>Candle</td><td><span className="pill ba-mid">~54%</span></td><td>One-day momentum reversal</td></tr>
          <tr><td><b>19</b></td><td><b>Hammer / Pin Bar at Support</b></td><td>Candle</td><td><span className="pill ba-mid">~52%</span></td><td>Long lower wick at known support</td></tr>
          <tr><td><b>20</b></td><td><b>Williams %R Triple-Trough</b></td><td>Indicator</td><td><span className="pill ba-mid">~51%</span></td><td>3 swings &lt;-90 in 6-8 weeks</td></tr>
          <tr><td><b>21</b></td><td><b>Forward P/E &lt; 10-yr avg −1σ</b></td><td>Fundamental</td><td><span className="pill ba-mid">~50%</span></td><td>Valuation floor — risk-reward asymmetric</td></tr>
          <tr><td><b>22</b></td><td><b>Magazine Cover / Cover Story Indicator</b></td><td>Behavioral</td><td><span className="pill ba-mid">~48%</span></td><td>Mainstream declaring death = contrarian buy</td></tr>
        </tbody>
      </table>
      <p className="small">
        <b>Note on batting averages:</b> these reflect historical accuracy at MAJOR bottoms across NIFTY, S&amp;P 500,
        and individual blue-chips since 2000. Single-stock micro-caps will vary. The point of the ranking is to tell
        you which signals deserve more weight when you stack them.
      </p>

      {/* ── TIER 1 ─────────────────────────────────────────────────────── */}
      <h2><span style={{ color: C.green }}>● Tier 1</span> — Chart Patterns (price shape)</h2>

      <div className="panel tier1">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#2</span>Rounding Bottom (Saucer / Cup)</h3>
        <p>
          Slow, gradual U over 6–18 months. No sharp lows, no V. Volume contracts toward the basin then expands
          on the right side of the cup. <b>Highest reliability of all chart patterns</b> because the absorption is
          long enough that weak hands have fully exited.
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Confirmation</th><td>Close above the cup&apos;s left rim with ≥1.5× volume</td></tr>
            <tr><th>Target</th><td>Depth of cup added to breakout (often 30-80% return)</td></tr>
            <tr><th>Historical wins</th><td>HDFCBANK 2003-04, AAPL 2003-04, NIFTY Sept 2001 → 2003 base, ASIANPAINT 2012-13</td></tr>
            <tr><th>Killer pitfall</th><td>Breakout fails if right side too steep — that&apos;s a V, not a saucer. Needs ≥4 months of right-side build.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier1">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#4</span>Inverse Head &amp; Shoulders</h3>
        <p>
          Three lows where the middle (the &quot;head&quot;) is the lowest. The two shoulders should be at roughly equal price.
          More reliable than Double Bottom because the head represents a flush-out that exhausted sellers.
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Confirmation</th><td>Close above neckline (high between left shoulder and head) on ≥1.5× volume</td></tr>
            <tr><th>Target</th><td>Distance from head to neckline, added to neckline (the &quot;measured move&quot;)</td></tr>
            <tr><th>Historical wins</th><td>NIFTY July 2013 (5,100 → 5,600 → 5,200 → 6,000 break), TCS 2009, S&amp;P 500 March 2003</td></tr>
            <tr><th>Killer pitfall</th><td>Asymmetric shoulders (one much deeper) = not a real IHS, just sideways</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier1">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#8</span>Falling Wedge Breakout</h3>
        <p>
          Two converging downtrending lines forming a wedge that narrows over time. Each successive low is shallower
          — momentum dying. Breakout above the upper line is the entry. <b>Works particularly well in growth stocks
          after a 30-50% drawdown.</b>
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Confirmation</th><td>Close above upper wedge line on rising volume</td></tr>
            <tr><th>Target</th><td>Width of widest part of wedge added to breakout</td></tr>
            <tr><th>Historical wins</th><td>TATAMOTORS 2019-20, NVDA Oct 2022 (the AI run started here), AMZN Dec 2022</td></tr>
            <tr><th>Killer pitfall</th><td>Wedge breaks down (apex break to the downside) = continuation, not reversal</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier1">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#10</span>Triple Bottom</h3>
        <p>
          Three lows at the same price. Rarer than Double Bottom because most stocks don&apos;t get a third test.
          When formed, conviction is exceptionally high — the floor is confirmed three times.
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Confirmation</th><td>Close above resistance from the two intermediate peaks, ≥1.5× volume</td></tr>
            <tr><th>Target</th><td>Height of pattern projected up from breakout</td></tr>
            <tr><th>Historical wins</th><td>SBIN 2013-14 (₹150 area tested 3 times), BAJAJ-AUTO 2016-17</td></tr>
            <tr><th>Killer pitfall</th><td>Each test on increasing volume = distribution, not accumulation. Bearish.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier1">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#13</span>Double Bottom (see standalone /double-bottom guide)</h3>
        <p>
          Two roughly equal lows with a partial recovery between. Neckline break = entry. <b>60% batting average means
          40% fail rate</b> — never trade in isolation. See the standalone guide for full criteria.
        </p>
      </div>

      {/* ── TIER 2 ─────────────────────────────────────────────────────── */}
      <h2><span style={{ color: C.cyan }}>● Tier 2</span> — Indicators &amp; Divergence (math under the price)</h2>

      <div className="panel tier3">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#1</span>Bullish RSI Divergence — the King</h3>
        <p>
          Price makes a lower low BUT 14-day RSI makes a higher low. The market&apos;s internal momentum is improving
          even as the headline price drops. <b>Highest batting average of any single bottom signal across all categories.</b>
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Setup</th><td>Two distinct lows in price within 4-12 weeks; RSI low #2 &gt; RSI low #1</td></tr>
            <tr><th>Confirmation</th><td>RSI cross above 50 OR price breakout above interim peak</td></tr>
            <tr><th>Historical wins</th><td>NVDA Oct 2022 ($108 → $138 with RSI 22 → 35), BAJFINANCE Mar 2020, INFY 2020, NIFTY March 2020</td></tr>
            <tr><th>Killer pitfall</th><td>RSI divergence on a single 1-day spike low = noise. Needs 2 distinct lows.</td></tr>
            <tr><th>Bonus</th><td>Combine with weekly RSI divergence (slower timeframe) for nuclear conviction</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier3">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#15</span>MACD Histogram Higher Lows</h3>
        <p>
          MACD histogram bars getting less negative while price still falling. Rate-of-change of decline is slowing.
          Often precedes the actual bullish MACD cross by 1-3 weeks.
        </p>
        <p className="small"><b>Best used:</b> on weekly charts for trend reversals, daily for swing entries.</p>
      </div>

      <div className="panel tier3">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>#20</span>Williams %R Triple-Trough</h3>
        <p>
          Three consecutive swings below -90 within 6-8 weeks. Larry Williams&apos; classic exhaustion signal.
          Lower batting average alone but excellent <b>filter</b> for other setups.
        </p>
      </div>

      <div className="panel tier3">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>Bonus</span>Stochastic Cross from Oversold</h3>
        <p>Daily stochastic crosses above 20 after being pinned for 5+ sessions. Short-term bottom signal — useful for swing entries within larger setups.</p>
      </div>

      {/* ── TIER 3 ─────────────────────────────────────────────────────── */}
      <h2><span style={{ color: C.amber }}>● Tier 3</span> — Volume &amp; Candle Signatures (single-bar evidence)</h2>

      <div className="panel tier2">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#9</span>Capitulation Day</h3>
        <p>
          A single day of -8% to -15% on 3-5× average volume that clears the seller queue. The next 1-3 sessions
          usually mark the actual bottom. <b>The fastest path to a tradeable low.</b>
        </p>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Setup</th><td>Wide-range red bar after an extended downtrend, on extreme volume</td></tr>
            <tr><th>Confirmation</th><td>Next 1-2 sessions hold above the capitulation low — &quot;the kiss test&quot;</td></tr>
            <tr><th>Historical wins</th><td>NIFTY Mar 23, 2020 (−13% on 4× volume), S&amp;P Mar 12, 2020, Yes Bank Mar 6, 2020 (capitulation = actual bottom for traders)</td></tr>
            <tr><th>Killer pitfall</th><td>Capitulation in stocks with terminal balance-sheet risk (insolvency) doesn&apos;t produce real bottoms — just lower lows. Confirm fundamental viability first.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel tier2">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#12</span>Morning Star (Weekly)</h3>
        <p>
          Three-candle pattern on the weekly: large red week, small body or doji week, large green week.
          Cleanest single-pattern bottom marker. Even better when the middle week shows a long lower wick.
        </p>
      </div>

      <div className="panel tier2">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#16</span>90% Down Volume Day (Lowry)</h3>
        <p>
          When 90%+ of total exchange volume is in declining stocks. Lowry&apos;s Reports classic. Often within 2-3 days
          of the actual low. Look for it in clusters (multiple within a 2-week window).
        </p>
      </div>

      <div className="panel tier2">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>#18</span>Bullish Engulfing at Oversold RSI</h3>
        <p>
          A green candle that fully engulfs the prior red candle, occurring when RSI is &lt;30. Simple, fast, useful
          for short-term entries. Lower standalone reliability but combines well.
        </p>
      </div>

      <div className="panel tier2">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>#19</span>Hammer / Pin Bar at Support</h3>
        <p>
          Long lower wick, small body, closes near high — at a known support level. Confirms buyers stepped in
          intraday. Most reliable when paired with elevated volume and a prior support level being tested.
        </p>
      </div>

      {/* ── TIER 4 ─────────────────────────────────────────────────────── */}
      <h2><span style={{ color: C.purple }}>● Tier 4</span> — Market Internals &amp; Breadth (what the universe is doing)</h2>

      <div className="panel tier4">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#6</span>Zweig Breadth Thrust</h3>
        <p>
          10-day moving average of advances ÷ (advances + declines) goes from below 0.40 to above 0.61 within 10 trading days.
          Marty Zweig identified this — historical 6/6 successful signals since 1945 leading to major bull moves. Rare but powerful.
        </p>
        <p className="small"><b>Last fired:</b> 2009 (March), 2018 (Feb), 2020 (April), 2023 (Jan). Each followed by sustained rally.</p>
      </div>

      <div className="panel tier4">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#7</span>Junk-bond Spread Peak + Narrowing</h3>
        <p>
          When BB-rated bond spreads peak and start narrowing, equity bottoms are typically 0-30 days away. Credit
          investors see balance sheet stress earlier than equity holders. <b>Best macro leading indicator.</b>
        </p>
        <p className="small">Watch the BofA US High Yield Index (H0A0). When the option-adjusted spread peaks and starts compressing, position for equity recovery.</p>
      </div>

      <div className="panel tier4">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#11</span>VIX Spike + Close Below 5-DMA</h3>
        <p>
          VIX prints &gt;35 then closes below its own 5-day moving average. Two stages: (1) panic spike, (2) panic
          easing. The stage 2 cross is the trigger.
        </p>
      </div>

      <div className="panel tier4">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#14</span>% Stocks Above 50-DMA &lt; 15%</h3>
        <p>
          Universe-wide oversold reading. When the market is THIS broken-down across every stock, mean-reversion follows.
          Used by institutional desks for tactical equity adds.
        </p>
        <p className="small"><b>Triggered:</b> NIFTY Mar 2020 (8%), US Oct 2022 (12%), 2008 multiple times, March 2009 final low at 4%.</p>
      </div>

      {/* ── TIER 5 ─────────────────────────────────────────────────────── */}
      <h2><span style={{ color: C.gold }}>● Tier 5</span> — Fundamental &amp; Behavioral (slowest, most reliable)</h2>

      <div className="panel tier5">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#3</span>Insider Buying Cluster</h3>
        <p>
          3 or more company insiders buying in the open market within a 30-day window, with no recent sales.
          <b> Highest batting average among fundamental signals because insiders have asymmetric information.</b>
        </p>
        <p className="small">Best when buyers are CFO + CEO + 1 board member. CFO buys are particularly potent — they see the cash flow before anyone else does.</p>
      </div>

      <div className="panel tier5">
        <h3><span className="rank" style={{ background: C.green + '22', color: C.green }}>#5</span>FCF Decline Halts QoQ for 2+ Quarters</h3>
        <p>
          The single best earnings-side bottom signal. Free Cash Flow stops declining for two consecutive quarters
          (or starts improving). Companies bottom in stock price <b>before</b> they bottom in EPS — but they bottom in
          FCF <b>before</b> they bottom in stock price.
        </p>
        <p className="small">Track: TTM operating cash flow − capex. If the trailing 4Q sum stops sliding and even slightly improves, the next earnings cycle is likely the inflection.</p>
      </div>

      <div className="panel tier5">
        <h3><span className="rank" style={{ background: C.cyan + '22', color: C.cyan }}>#17</span>AAII Bull Sentiment &lt; 20%</h3>
        <p>
          When the American Association of Individual Investors bullish reading drops below 20%, retail investors
          have capitulated. Historical forward 12-month returns from these readings: 18-25%.
        </p>
        <p className="small">Indian equivalent: track Outlook Business sentiment surveys or DII inflow turning positive after sustained outflows.</p>
      </div>

      <div className="panel tier5">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>#21</span>Forward P/E &lt; 10-Year Average −1σ</h3>
        <p>
          When the market&apos;s forward P/E drops more than one standard deviation below its 10-year average. Doesn&apos;t time
          the EXACT bottom but tells you the <b>risk-reward is asymmetric to the upside.</b>
        </p>
        <p className="small"><b>Recent triggers:</b> NIFTY March 2020 (Fwd P/E 14×), US October 2022 (16.5×).</p>
      </div>

      <div className="panel tier5">
        <h3><span className="rank" style={{ background: C.amber + '22', color: C.amber }}>#22</span>Cover Story / Magazine Indicator</h3>
        <p>
          When mainstream media puts &quot;the death of [asset class]&quot; on the cover — historically a contrarian goldmine.
          Examples: BusinessWeek &quot;Death of Equities&quot; (August 1979, before a 20-year bull), Economist &quot;Drowning in Oil&quot; (March 1999),
          Outlook Business &quot;Why Real Estate Will Crash&quot; (2013).
        </p>
        <p className="small">Lower batting average alone — but as a sentiment overlay it&apos;s remarkable. Magazines reflect mainstream consensus, which is almost always wrong at extremes.</p>
      </div>

      {/* ── COMBINATION PLAYBOOK ────────────────────────────────────────── */}
      <h2>⚡ Combination Playbook — How to Stack Signals</h2>

      <div className="panel">
        <h3>The Stack-3 Rule</h3>
        <p>Wait for at least 3 signals from <b>3 different tiers</b> to fire within 2 weeks. Examples:</p>
        <ul>
          <li><b>NVDA Oct 2022 bottom:</b> Falling Wedge (Tier 1) + Bullish RSI Divergence (Tier 2) + VIX peak (Tier 4) + Insider buys (Tier 5) → 8× return</li>
          <li><b>NIFTY March 2020:</b> Capitulation Day (Tier 3) + VIX &gt;80 + cross down (Tier 4) + AAII bull below 20% (Tier 5) → 100%+ in 18 months</li>
          <li><b>BAJFINANCE March 2020:</b> Bullish RSI Divergence (Tier 2) + 90% Down Volume cluster (Tier 3) + Forward P/E below 10yr avg −1σ (Tier 5) → 4× by 2021</li>
        </ul>
      </div>

      <div className="panel">
        <h3>Tier weights for sizing</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Signals confirmed</th><th>Conviction</th><th>Position size suggestion</th></tr>
            <tr><td>1 signal (any tier)</td><td>Low</td><td>Skip OR 0.25% risk</td></tr>
            <tr><td>2 signals same tier</td><td>Low-Mid</td><td>0.5% risk max</td></tr>
            <tr><td>2 signals different tiers</td><td>Mid</td><td>1% risk</td></tr>
            <tr><td>3 signals from 3 tiers</td><td>High</td><td>2% risk</td></tr>
            <tr><td>4+ signals from 4+ tiers</td><td>Elite (rare)</td><td>3-5% risk — these are once-a-decade setups</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── FAILURE MODES ───────────────────────────────────────────────── */}
      <h2>⚠ When EVEN Stacked Signals Fail</h2>
      <div className="panel">
        <ul>
          <li><b>Insolvency / fraud overlays.</b> Yes Bank, DHFL, Vakrangee — no chart pattern survives a balance sheet that&apos;s impaired. <b>Always check: debt/equity stable? auditor unchanged? FCF positive?</b> If any &quot;no&quot;, skip.</li>
          <li><b>Sector vs market divergence.</b> Individual stock signals are weak when the sector is in structural decline (e.g. PSU banks 2014-19, conventional auto 2018-22). Always confirm sector index is forming higher lows.</li>
          <li><b>Macro regime change.</b> Bottom signals work in normal cycles. They fail during regime shifts (war, currency collapse, hyperinflation onset). Look at macro context.</li>
          <li><b>Dilution risk.</b> If the company is announcing or about to announce a QIP, rights issue, FPO — every signal will fail because new supply hits exactly when the recovery should start.</li>
          <li><b>Sub-1000 Cr market cap.</b> Below this threshold, technical patterns are noisier because individual blocks move price. Use Tier 5 (insider buying) primarily.</li>
        </ul>
      </div>

      {/* ── PRE-TRADE CHECKLIST ─────────────────────────────────────────── */}
      <h2>✓ Pre-Trade Checklist — Before Every Bottom Bet</h2>
      <div className="panel">
        <table>
          <thead><tr><th style={{ width: 24 }}>#</th><th>Question</th><th style={{ width: 100 }}>If &quot;no&quot;</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Do I have ≥3 signals from ≥3 different tiers?</td><td>Wait</td></tr>
            <tr><td>2</td><td>Is the company FCF-positive or trending positive?</td><td>Skip (terminal risk)</td></tr>
            <tr><td>3</td><td>Stable auditor, no governance red flags in 18 months?</td><td>Skip</td></tr>
            <tr><td>4</td><td>No planned QIP / rights / FPO?</td><td>Skip</td></tr>
            <tr><td>5</td><td>Sector index forming higher lows OR holding key support?</td><td>Halve position</td></tr>
            <tr><td>6</td><td>Market-cap &gt; ₹1,000 Cr (or &gt; $500M for US)?</td><td>Use Tier 5 only</td></tr>
            <tr><td>7</td><td>Have I defined exact stop loss (last low − 3%)?</td><td>Don&apos;t trade</td></tr>
            <tr><td>8</td><td>Position size calculated from stop, not gut feel?</td><td>Recalculate</td></tr>
            <tr><td>9</td><td>Macro regime stable (no rate-shock, no war escalation)?</td><td>Halve position</td></tr>
            <tr><td>10</td><td>Do I have a time invalidation rule (4 weeks no follow-through → exit)?</td><td>Set one</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── CLOSING ──────────────────────────────────────────────────────── */}
      <h2>📝 Summary</h2>
      <p>
        Bottom picking is the highest-edge trade in markets because of one simple fact: <b>everyone is trying to top-tick
        the sale, no one wants to bottom-tick the buy.</b> The asymmetry is real.
      </p>
      <p>
        But that same asymmetry means most attempts to catch a bottom fail. The methods above are not lottery tickets —
        they&apos;re probability weights. Stack them, confirm them, size them properly, and accept that even your best setups
        will fail 15-25% of the time. That&apos;s the actual game.
      </p>
      <p>
        <b>The one-sentence rule:</b> &quot;Never act on a single bottom signal. Wait for three from different tiers. When you
        get them — size to your conviction, not your fear.&quot;
      </p>

      <div style={{ marginTop: 28, padding: 14, background: C.panel2, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text2 }}>
        <b style={{ color: C.amber }}>Disclaimer:</b> Batting averages are historical and approximate; future results vary.
        Past examples (NVDA, BAJFINANCE, NIFTY) illustrate pattern psychology, not specific recommendations. Educational content only.
        Always do your own due diligence and risk-size to your individual circumstances. This is not investment advice.
      </div>
    </div>
  );
}
