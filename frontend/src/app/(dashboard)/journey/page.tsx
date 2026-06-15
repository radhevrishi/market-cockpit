'use client';

// ════════════════════════════════════════════════════════════════════════════
// JOURNEY — PATCH 1082
// Wealth-targets compounding tab. Personal motivational dashboard showing
// what ₹X invested at CAGR Y% becomes over time. Includes:
//   • Big target panel: 20/25/30/40% CAGR over 10y / 20y from ₹1 Cr
//   • Personal target setter: input starting capital + target CAGR
//   • Year-by-year milestone tracker with progress vs target
//   • Curated quotes from compounding masters (Munger, Buffett, Lynch, Indian
//     market voices like Kacholia, Kedia, Damani, Veliyath, Marcellus)
//   • Reality check footer — base rates, what a "good" CAGR means
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

const CAGRS = [20, 25, 30, 40] as const;
const HORIZONS = [10, 15, 20, 25, 30] as const;

function compound(start: number, cagrPct: number, years: number): number {
  return start * Math.pow(1 + cagrPct / 100, years);
}

function fmtCr(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 100) return `₹${(v).toFixed(0)} cr`;
  if (v >= 10) return `₹${v.toFixed(1)} cr`;
  return `₹${v.toFixed(2)} cr`;
}

const QUOTES: { text: string; who: string; color: string }[] = [
  { text: 'The first rule of compounding: never interrupt it unnecessarily.', who: 'Charlie Munger', color: 'var(--mc-cyan)' },
  { text: "Time is the friend of the wonderful business, the enemy of the mediocre.", who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: "Far more money has been lost by investors trying to anticipate corrections than has been lost in the corrections themselves.", who: 'Peter Lynch', color: 'var(--mc-warn)' },
  { text: "The big money is not in the buying or selling, but in the waiting.", who: 'Charlie Munger', color: 'var(--mc-cyan)' },
  { text: 'The stock market is a device for transferring money from the impatient to the patient.', who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: "I don't look to jump over seven-foot bars: I look around for one-foot bars that I can step over.", who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: 'You make most of your money in a bear market, you just don\'t realize it at the time.', who: 'Shelby Davis', color: 'var(--mc-warn)' },
  { text: 'Risk comes from not knowing what you are doing.', who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: "It takes character to sit there with all that cash and do nothing. I didn't get to where I am by going after mediocre opportunities.", who: 'Charlie Munger', color: 'var(--mc-cyan)' },
  { text: "Conviction is the differentiator between great investors and merely good ones. Position size matters more than picks.", who: 'Stan Druckenmiller', color: 'var(--mc-state-persistent)' },
  { text: "Bull markets are born on pessimism, grown on scepticism, mature on optimism and die on euphoria.", who: 'Sir John Templeton', color: 'var(--mc-cyan)' },
  { text: "The intelligent investor is a realist who sells to optimists and buys from pessimists.", who: 'Benjamin Graham', color: 'var(--mc-bullish)' },
  { text: "I'm not so much interested in the return on my money as I am in the return of my money.", who: 'Will Rogers', color: 'var(--mc-warn)' },
  { text: "Look at market fluctuations as your friend rather than your enemy; profit from folly rather than participate in it.", who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: "Concentrate when you have conviction. Diversify when you do not.", who: 'Ashish Kacholia', color: 'var(--mc-saffron)' },
  { text: "If you find a 100-bagger, the worst thing you can do is sell it.", who: 'Vijay Kedia', color: 'var(--mc-saffron)' },
  { text: "Patience is the most underrated investing skill in India. Sit on your hands.", who: 'Ramesh Damani', color: 'var(--mc-saffron)' },
  { text: "Quality at a fair price compounded over 10 years beats fair quality at a low price almost every time.", who: 'Marcellus Investment Managers', color: 'var(--mc-saffron)' },
  { text: "If you cannot hold a stock for 10 years, do not hold it for 10 minutes.", who: 'Warren Buffett', color: 'var(--mc-bullish)' },
  { text: "The most important quality for an investor is temperament, not intellect.", who: 'Warren Buffett', color: 'var(--mc-bullish)' },
];

export default function JourneyPage() {
  // Personal target setter (persisted in localStorage)
  const [startCr, setStartCr] = useState<number>(1);
  const [targetCagr, setTargetCagr] = useState<number>(25);
  const [horizonY, setHorizonY] = useState<number>(20);
  const [currentCr, setCurrentCr] = useState<number>(1);
  const [startYear, setStartYear] = useState<number>(new Date().getFullYear());
  const [todayQuoteIdx, setTodayQuoteIdx] = useState<number>(0);

  // Hydrate from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('mc:journey:v1');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.startCr === 'number') setStartCr(p.startCr);
        if (typeof p.targetCagr === 'number') setTargetCagr(p.targetCagr);
        if (typeof p.horizonY === 'number') setHorizonY(p.horizonY);
        if (typeof p.currentCr === 'number') setCurrentCr(p.currentCr);
        if (typeof p.startYear === 'number') setStartYear(p.startYear);
      }
    } catch {}
    // Daily-rotating quote
    const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    setTodayQuoteIdx(day % QUOTES.length);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('mc:journey:v1', JSON.stringify({ startCr, targetCagr, horizonY, currentCr, startYear })); } catch {}
  }, [startCr, targetCagr, horizonY, currentCr, startYear]);

  // Compute year-by-year milestones
  const milestones = useMemo(() => {
    return Array.from({ length: horizonY + 1 }, (_, i) => {
      const year = startYear + i;
      const target = compound(startCr, targetCagr, i);
      return { year, yearsIn: i, target };
    });
  }, [startCr, targetCagr, horizonY, startYear]);

  // Where are we vs target right now (assumes a constant CAGR path)
  const yearsSinceStart = new Date().getFullYear() - startYear;
  const onTrackTarget = compound(startCr, targetCagr, Math.max(0, yearsSinceStart));
  const trackPct = onTrackTarget > 0 ? (currentCr / onTrackTarget) * 100 : 0;
  const trackColor = trackPct >= 100 ? C.green : trackPct >= 80 ? C.amber : C.red;
  const trackVerdict = trackPct >= 100 ? 'AHEAD OF PLAN'
    : trackPct >= 80 ? 'ON TRACK'
    : trackPct >= 50 ? 'CATCHING UP'
    : 'BEHIND — REGROUP';

  return (
    <div style={{ minHeight: '100%', background: C.bg, color: C.text, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ─── HEADER ───────────────────────────────────────────────── */}
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: C.cyan, letterSpacing: '-0.5px' }}>
            🚀 The Journey
          </h1>
          <div style={{ marginTop: 6, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            Wealth compounding is not magic, it is mathematics &middot; patience &middot; discipline.
            What ₹1 cr becomes at 20% vs 25% vs 30% vs 40% over a lifetime &mdash; and where you stand vs target.
          </div>
        </div>

        {/* ─── DAILY QUOTE ──────────────────────────────────────────── */}
        <div style={{ background: 'linear-gradient(135deg, var(--mc-bg-1), var(--mc-bg-2))', border: '1px solid ' + QUOTES[todayQuoteIdx].color + '55', borderLeft: '4px solid ' + QUOTES[todayQuoteIdx].color, borderRadius: 8, padding: '16px 20px', position: 'relative' }}>
          <div style={{ fontSize: 10, color: QUOTES[todayQuoteIdx].color, fontWeight: 800, letterSpacing: 0.5, marginBottom: 4 }}>QUOTE OF THE DAY</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.text, lineHeight: 1.45, fontStyle: 'italic' }}>
            &ldquo;{QUOTES[todayQuoteIdx].text}&rdquo;
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: QUOTES[todayQuoteIdx].color, fontWeight: 700 }}>
            &mdash; {QUOTES[todayQuoteIdx].who}
          </div>
        </div>

        {/* ─── THE TABLE — CANONICAL TARGETS ───────────────────────── */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.cyan, letterSpacing: 0.3 }}>🎯 WEALTH TARGETS &middot; ₹{startCr} CR SEED</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Pure compounding math &middot; before tax &middot; no withdrawals</div>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + C.borderStrong }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 800, letterSpacing: 0.5 }}>CAGR</th>
                {HORIZONS.map((y) => (
                  <th key={y} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: C.muted, fontWeight: 800, letterSpacing: 0.5 }}>{y}Y</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAGRS.map((cagr) => {
                const isFlagship = cagr === targetCagr;
                return (
                  <tr key={cagr} style={{ borderBottom: '1px solid ' + C.border, background: isFlagship ? 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)' : 'transparent' }}>
                    <td style={{ padding: '14px 12px', fontWeight: 900, fontSize: 18, color: isFlagship ? C.cyan : C.text }}>
                      {cagr}% {isFlagship && <span style={{ fontSize: 9, color: C.cyan, marginLeft: 6, fontWeight: 700 }}>← MY TARGET</span>}
                    </td>
                    {HORIZONS.map((y) => {
                      const v = compound(startCr, cagr, y);
                      const big = v >= 100;
                      return (
                        <td key={y} style={{ padding: '14px 12px', textAlign: 'right', fontSize: big ? 16 : 14, fontWeight: big ? 900 : 700, color: big ? (cagr >= 30 ? C.green : C.cyan) : C.text }}>
                          {fmtCr(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
            <strong style={{ color: C.amber }}>Reality check:</strong> Nifty 50 long-term CAGR is ~12%.
            Top Indian compounders (Page Industries, Pidilite, Asian Paints over 20y) printed ~24-28%.
            30%+ over 20y has been done (Bajaj Finance, Astral, AU Small Finance early years) but is a top-1% outcome.
            40% over 20y is essentially the realm of one-decision multibaggers held without flinching.
          </div>
        </div>

        {/* ─── PERSONAL TARGET SETTER ──────────────────────────────── */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.saffron, marginBottom: 10, letterSpacing: 0.3 }}>📐 MY PLAN</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Field label="Starting capital (₹ cr)" value={startCr} setValue={setStartCr} step={0.5} min={0.1} />
            <Field label="Start year" value={startYear} setValue={setStartYear} step={1} min={1990} max={2050} />
            <Field label="Target CAGR (%)" value={targetCagr} setValue={setTargetCagr} step={1} min={1} max={100} />
            <Field label="Horizon (years)" value={horizonY} setValue={setHorizonY} step={1} min={1} max={50} />
            <Field label="Current portfolio (₹ cr)" value={currentCr} setValue={setCurrentCr} step={0.1} min={0} />
          </div>

          {/* WHERE-AM-I CHIP */}
          {yearsSinceStart >= 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: C.bg, border: '1px solid ' + trackColor + '66', borderRadius: 6, marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>STATUS</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: trackColor, ...MONO }}>{trackVerdict}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: C.muted }}>
                  Year {yearsSinceStart} of {horizonY} &middot;
                  On-plan target: <strong style={{ color: C.cyan }}>{fmtCr(onTrackTarget)}</strong> &middot;
                  You have: <strong style={{ color: trackColor }}>{fmtCr(currentCr)}</strong> &middot;
                  <strong style={{ color: trackColor, marginLeft: 6 }}>{trackPct.toFixed(1)}% of plan</strong>
                </div>
                <div style={{ height: 6, background: C.borderStrong, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: Math.min(100, trackPct).toFixed(1) + '%', height: '100%', background: trackColor }} />
                </div>
              </div>
            </div>
          )}

          {/* MILESTONE TABLE */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO, fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + C.borderStrong }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 800 }}>YEAR</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 800 }}>YEARS IN</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 800 }}>TARGET</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 800 }}>MILESTONE</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const isMilestone = m.target >= 1 && m.target % 1 < 0.1 && m.yearsIn % 5 === 0;
                  const isHugeMilestone = m.target >= 100;
                  const isToday = m.year === new Date().getFullYear();
                  const milestone =
                    m.target >= 100 ? '🚀 100 cr club' :
                    m.target >= 50 ? '💎 50 cr fortress' :
                    m.target >= 25 ? '🏆 25 cr quarter-club' :
                    m.target >= 10 ? '⭐ 10 cr milestone' :
                    m.target >= 5 ? '✨ 5 cr launchpad' :
                    m.target >= 3 ? '🌱 3 cr base' : '';
                  return (
                    <tr key={m.year} style={{ borderBottom: '1px solid ' + C.border, background: isToday ? 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)' : (isHugeMilestone ? 'color-mix(in srgb, var(--mc-bullish) 5%, transparent)' : 'transparent') }}>
                      <td style={{ padding: '8px 10px', fontWeight: isToday ? 900 : 600, color: isToday ? C.cyan : C.text }}>{m.year}{isToday && <span style={{ fontSize: 9, color: C.cyan, marginLeft: 6 }}>· NOW</span>}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: C.muted }}>{m.yearsIn}y</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: m.target >= 10 ? C.green : C.text }}>{fmtCr(m.target)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: C.saffron, fontWeight: 700 }}>{milestone}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── QUOTES WALL ─────────────────────────────────────────── */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.purple, marginBottom: 12, letterSpacing: 0.3 }}>🧠 WISDOM WALL &middot; the voices that compound your mind</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {QUOTES.map((q, i) => (
              <div key={i} style={{ background: C.bg, border: '1px solid ' + q.color + '33', borderLeft: '3px solid ' + q.color, borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontStyle: 'italic', color: C.text, lineHeight: 1.45 }}>
                  &ldquo;{q.text}&rdquo;
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: q.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  &mdash; {q.who}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── RULES OF THE JOURNEY ────────────────────────────────── */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.amber, marginBottom: 10, letterSpacing: 0.3 }}>⚖ RULES OF THE JOURNEY</div>
          <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.8, fontSize: 13, color: C.text }}>
            <li><strong style={{ color: C.green }}>Compound, don&apos;t interrupt.</strong> Selling a multibagger early breaks the curve mathematically. The biggest gains arrive in the last 30% of the journey.</li>
            <li><strong style={{ color: C.cyan }}>Concentrate when you have edge, diversify when you don&apos;t.</strong> 6&ndash;12 high-conviction names beat 50 hopefuls.</li>
            <li><strong style={{ color: C.saffron }}>Sit on cash without guilt.</strong> Wide-net-cash positions during euphoria are not laziness, they are ammo for the next dislocation.</li>
            <li><strong style={{ color: C.purple }}>Process &gt; outcome.</strong> A bad outcome from a good process is bad luck. A good outcome from a bad process is a setup for future ruin.</li>
            <li><strong style={{ color: C.red }}>Avoid permanent loss.</strong> The 50% drawdown needs a 100% gain to recover. The 80% drawdown needs a 400%. Survive first, compound second.</li>
            <li><strong style={{ color: C.green }}>Review quarterly, decide yearly, sell when thesis breaks.</strong> Not on price action, not on macro noise, only on falsified thesis.</li>
            <li><strong style={{ color: C.amber }}>Health and family are not the cost of compounding.</strong> Sleep, exercise, real relationships &mdash; the alpha you generate at the cost of these compounds in the wrong direction.</li>
          </ol>
        </div>

        {/* ─── FOOTER ─────────────────────────────────────────────── */}
        <div style={{ fontSize: 11, color: C.dim, textAlign: 'center', padding: '14px 0', fontStyle: 'italic' }}>
          &ldquo;The journey of a thousand crores begins with a single conviction held with patience.&rdquo;
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, setValue, step = 1, min, max }: {
  label: string; value: number; setValue: (n: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={isFinite(value) ? String(value) : '0'}
        onChange={(e) => {
          // PATCH 1082b — accept European comma format ("0,5" → 0.5) and any
          // partial input. We do not clamp to min/max while typing; only on blur.
          const raw = e.target.value.trim().replace(',', '.');
          if (raw === '' || raw === '.' || raw === '-') return;
          const n = Number(raw);
          if (isFinite(n)) setValue(n);
        }}
        onBlur={(e) => {
          // Clamp to min/max on blur so user can type freely.
          let n = Number(String(e.target.value).trim().replace(',', '.'));
          if (!isFinite(n)) n = 0;
          if (min != null && n < min) n = min;
          if (max != null && n > max) n = max;
          setValue(n);
        }}
        style={{ background: C.bg, border: '1px solid ' + C.borderStrong, color: C.text, padding: '8px 10px', borderRadius: 4, fontSize: 14, fontWeight: 700, ...MONO }}
      />
    </div>
  );
}
