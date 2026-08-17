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
import { readDecisions, DECISION_META, type Decision, type DecisionStatus } from '@/lib/decisions';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

// PATCH 1101k — Added 10% (FD/bank-deposit benchmark) and 15% (typical mutual
// fund) rows above the target band (20/25/30/40) for educational reference.
// User's actual targets remain 20–40%; 10/15 just frame the opportunity cost
// of staying in low-return vehicles. The flagship highlight stays at 25%.
const CAGRS = [10, 15, 20, 25, 30, 35, 40] as const;
const HORIZONS = [5, 10, 15, 20, 25] as const; // zzz308 — added 5Y, removed 30Y

function compound(start: number, cagrPct: number, years: number): number {
  return start * Math.pow(1 + cagrPct / 100, years);
}

function fmtCr(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 100) return `₹${(v).toFixed(0)} cr`;
  if (v >= 10) return `₹${v.toFixed(1)} cr`;
  return `₹${v.toFixed(2)} cr`;
}

// ─── "YOUR RECORD" HELPERS (PATCH — realized-performance scorecard) ─────────
// Formats a fractional return (0.12 → "+12.0%").
function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  const p = v * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

// A single decision that has BOTH a logged price AND a live price, with its
// realized return already computed.
interface RecordRow {
  symbol: string;
  company?: string;
  status: DecisionStatus;
  priceAt: number;
  live: number;
  ret: number; // fractional (live − priceAt) / priceAt
  reason: string;
  bullCase?: string;
}

// Light thesis-word scan for the (nice-to-have) contradiction chip. Cheap
// substring match against a small lexicon — no external data required.
const THESIS_WORDS = ['margin', 'order book', 'capacity', 'guidance', 'demand', 'pricing power', 'deleverag', 'market share', 'turnaround', 'capex', 'export', 'moat'];
function thesisWord(...texts: (string | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  for (const w of THESIS_WORDS) if (hay.includes(w)) return w;
  return null;
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

  // ─── YOUR RECORD state — Decision Logbook realized performance ───────────
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // On mount: read the logbook once + fetch live prices once. India always;
  // US only when at least one decision is a US name. try/catch, never throws.
  useEffect(() => {
    const d = readDecisions();
    setDecisions(d);
    const needUS = Object.values(d).some((x) => x.market === 'US');
    let cancelled = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 18_000);
    (async () => {
      const map: Record<string, number> = {};
      const markets = needUS ? ['india', 'us'] : ['india'];
      for (const mkt of markets) {
        try {
          const r = await fetch(`/api/market/quotes?market=${mkt}`, { cache: 'no-store', signal: ctl.signal });
          if (!r.ok) continue;
          const j = await r.json();
          for (const s of (j?.stocks || [])) {
            if (s?.ticker && s?.price) map[String(s.ticker).toUpperCase()] = Number(s.price);
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          if (process.env.NODE_ENV !== 'production') console.warn('[journey] quotes fetch failed:', err);
        }
      }
      if (!cancelled) setLivePrices(map);
      clearTimeout(timer);
    })();
    return () => { cancelled = true; clearTimeout(timer); ctl.abort(); };
  }, []);

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

  // ─── YOUR RECORD — realized performance of logged decisions ──────────────
  // BUY = return as-is (positive is a win). REJECTED = "avoided" return, where
  // a name that FELL is a good call (dodged a loss) and one that ROSE is a
  // miss. WATCH/NEUTRAL are informational only — shown but never scored.
  const rec = useMemo(() => {
    const all = Object.values(decisions);
    const totalDecisions = all.length;
    const rows: RecordRow[] = [];
    for (const d of all) {
      const priceAt = d.priceAtDecision;
      if (!priceAt || priceAt <= 0) continue;
      const live = livePrices[String(d.symbol).toUpperCase()];
      if (!live || live <= 0) continue;
      rows.push({
        symbol: d.symbol,
        company: d.company,
        status: d.status,
        priceAt,
        live,
        ret: (live - priceAt) / priceAt,
        reason: d.reason || '',
        bullCase: d.bullCase,
      });
    }
    const withData = rows.length;

    // BUY scoring
    const buys = rows.filter((r) => r.status === 'BUY');
    const buyWins = buys.filter((r) => r.ret > 0);
    const buyLosses = buys.filter((r) => r.ret < 0);
    const buyBattingAvg = buys.length ? (buyWins.length / buys.length) * 100 : null;
    const avgWin = buyWins.length ? buyWins.reduce((s, r) => s + r.ret, 0) / buyWins.length : null;
    const avgLoss = buyLosses.length ? buyLosses.reduce((s, r) => s + r.ret, 0) / buyLosses.length : null;
    const bestBuy = buys.length ? buys.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
    const worstBuy = buys.length ? buys.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;

    // REJECTED scoring (accuracy = % that fell since the call)
    const rejects = rows.filter((r) => r.status === 'REJECTED');
    const rejectGood = rejects.filter((r) => r.ret < 0);
    const rejectAccuracy = rejects.length ? (rejectGood.length / rejects.length) * 100 : null;
    const bestAvoided = rejects.length ? rejects.reduce((a, b) => (b.ret < a.ret ? b : a)) : null; // most negative
    const worstMissed = rejects.length ? rejects.reduce((a, b) => (b.ret > a.ret ? b : a)) : null; // most positive

    // WATCH / NEUTRAL — informational
    const watchNeutral = rows.filter((r) => r.status === 'WATCH' || r.status === 'NEUTRAL');

    return {
      totalDecisions, withData, buys, buyWins, buyLosses, buyBattingAvg, avgWin, avgLoss,
      bestBuy, worstBuy, rejects, rejectGood, rejectAccuracy, bestAvoided, worstMissed, watchNeutral,
    };
  }, [decisions, livePrices]);

  // Instructive rows — the four most-teachable outcomes.
  const instructive = useMemo(() => {
    const out: { label: string; row: RecordRow; tone: string }[] = [];
    if (rec.bestBuy && rec.bestBuy.ret > 0) out.push({ label: 'Biggest win', row: rec.bestBuy, tone: C.green });
    if (rec.worstBuy && rec.worstBuy.ret < 0) out.push({ label: 'Biggest loss', row: rec.worstBuy, tone: C.red });
    if (rec.bestAvoided && rec.bestAvoided.ret < 0) out.push({ label: 'Best avoided', row: rec.bestAvoided, tone: C.green });
    if (rec.worstMissed && rec.worstMissed.ret > 0) out.push({ label: 'Worst missed', row: rec.worstMissed, tone: C.amber });
    return out;
  }, [rec]);

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
            Top rows (10% &middot; 15%) frame the opportunity cost of staying in FD / index funds;
            target band (20% &mdash; 40%) is the actual hunting ground.
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
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.cyan, letterSpacing: 0.3 }}>🎯 WEALTH TARGETS &middot; ₹{startCr < 1 ? (startCr * 100).toFixed(0) + ' L' : startCr + ' CR'} SEED</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Pure compounding math &middot; before tax &middot; no withdrawals</div>
            </div>
            {/* PATCH 1101z — Quick-pick seed amounts. User wanted to change ₹1 cr to
                ₹0.5 cr etc. without scrolling down to the My Plan section. Common values
                are one click; custom amounts still editable in My Plan below. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 800, letterSpacing: 0.5 }}>SEED:</span>
              {[
                { v: 0.25, label: '₹25 L' },
                { v: 0.5,  label: '₹50 L' },
                { v: 1,    label: '₹1 cr' },
                { v: 2,    label: '₹2 cr' },
                { v: 5,    label: '₹5 cr' },
                { v: 10,   label: '₹10 cr' },
              ].map((opt) => {
                const active = Math.abs(startCr - opt.v) < 0.001;
                return (
                  <button key={opt.v} onClick={() => setStartCr(opt.v)} style={{
                    padding: '4px 10px',
                    background: active ? 'color-mix(in srgb, var(--mc-cyan) 18%, transparent)' : 'transparent',
                    border: '1px solid ' + (active ? C.cyan : C.border),
                    borderRadius: 5,
                    color: active ? C.cyan : C.muted,  // zzz381 — C.text2 was undefined
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    ...MONO,
                  }}>{opt.label}</button>
                );
              })}
              <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>or</span>
              <input
                type="number"
                value={startCr}
                onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0.05) setStartCr(v); }}
                step={0.25} min={0.05}
                style={{
                  width: 70, padding: '3px 6px',
                  background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 5, color: C.text, fontSize: 11, ...MONO, textAlign: 'right',
                }}
                title="Custom seed (₹ cr)"
              />
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>cr</span>
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
            <strong style={{ color: C.amber }}>Reality check:</strong> Bank FDs / debt funds run ~7-8% (post-tax) &mdash;
            essentially treading water vs inflation. The average actively-managed equity MF prints ~12-15%.
            Nifty 50 long-term CAGR is ~12%.
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

        {/* ─── YOUR RECORD — realized performance of logged decisions ── */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 8, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.green, letterSpacing: 0.3 }}>📊 YOUR RECORD</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                Your own batting average IS your edge &middot; realized returns on decisions you logged with a price
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.muted, ...MONO }}>
              coverage: <strong style={{ color: rec.withData > 0 ? C.cyan : C.dim }}>{rec.withData}</strong> of {rec.totalDecisions} decision{rec.totalDecisions === 1 ? '' : 's'} priced
            </div>
          </div>

          {rec.withData === 0 ? (
            /* ── Honest empty / low-coverage state ── */
            <div style={{ padding: '18px 16px', background: C.bg, border: '1px dashed ' + C.borderStrong, borderRadius: 6, fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
              Your record fills in as you log BUY / REJECT decisions with a price &mdash; captured automatically when
              you decide from Multibagger.
              {rec.totalDecisions > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: C.dim }}>
                  You have {rec.totalDecisions} logged decision{rec.totalDecisions === 1 ? '' : 's'}, but none carry a captured price yet
                  (older entries pre-date price capture, or the ticker has no live quote right now).
                </div>
              )}
            </div>
          ) : (
            <>
              {/* ── STAT TILES ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
                <StatTile
                  label="BUY BATTING AVG"
                  value={rec.buyBattingAvg == null ? '—' : `${rec.buyBattingAvg.toFixed(0)}%`}
                  sub={rec.buys.length ? `${rec.buyWins.length}/${rec.buys.length} in the green` : 'no priced BUYs'}
                  color={rec.buyBattingAvg == null ? C.dim : rec.buyBattingAvg >= 50 ? C.green : C.amber}
                />
                <StatTile
                  label="AVG WIN"
                  value={fmtPct(rec.avgWin)}
                  sub={`across ${rec.buyWins.length} winner${rec.buyWins.length === 1 ? '' : 's'}`}
                  color={C.green}
                />
                <StatTile
                  label="AVG LOSS"
                  value={fmtPct(rec.avgLoss)}
                  sub={`across ${rec.buyLosses.length} loser${rec.buyLosses.length === 1 ? '' : 's'}`}
                  color={C.red}
                />
                <StatTile
                  label="REJECT ACCURACY"
                  value={rec.rejectAccuracy == null ? '—' : `${rec.rejectAccuracy.toFixed(0)}%`}
                  sub={rec.rejects.length ? `${rec.rejectGood.length}/${rec.rejects.length} fell as called` : 'no priced rejects'}
                  color={rec.rejectAccuracy == null ? C.dim : rec.rejectAccuracy >= 50 ? C.green : C.amber}
                />
                <StatTile
                  label="PRICED DECISIONS"
                  value={`${rec.withData}`}
                  sub={`of ${rec.totalDecisions} logged`}
                  color={C.cyan}
                />
              </div>

              {/* ── INSTRUCTIVE ROWS TABLE ── */}
              {instructive.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO, fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid ' + C.borderStrong }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 800 }}>TAKEAWAY</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 800 }}>TICKER</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 800 }}>CALL</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 800 }}>RETURN SINCE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {instructive.map((it) => {
                        const meta = DECISION_META[it.row.status];
                        // Contradiction chip (nice-to-have): a BUY that is down
                        // whose thesis note names a driver that clearly isn't playing out.
                        const tw = (it.row.status === 'BUY' && it.row.ret < 0)
                          ? thesisWord(it.row.reason, it.row.bullCase) : null;
                        return (
                          <tr key={it.label} style={{ borderBottom: '1px solid ' + C.border }}>
                            <td style={{ padding: '8px 10px', color: it.tone, fontWeight: 700 }}>{it.label}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ fontWeight: 800, color: C.text }}>{it.row.symbol}</span>
                              {it.row.company && (
                                <span style={{ fontSize: 10, color: C.dim, marginLeft: 6 }}>{it.row.company}</span>
                              )}
                              {tw && (
                                <span title={`Thesis mentioned "${tw}" but the position is down since the call`} style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: C.amber, background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', border: '1px solid ' + C.amber + '66', borderRadius: 4, padding: '1px 5px' }}>
                                  ⚑ thesis: {tw}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', color: meta.color, fontWeight: 700 }}>{meta.emoji} {meta.label}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: it.tone }}>{fmtPct(it.row.ret)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── INFORMATIONAL: WATCH / NEUTRAL (not scored) ── */}
              {rec.watchNeutral.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                  <strong style={{ color: C.muted }}>Informational:</strong> {rec.watchNeutral.length} priced WATCH/NEUTRAL name
                  {rec.watchNeutral.length === 1 ? ' is' : 's are'} tracked but not scored as win/loss &mdash;{' '}
                  {rec.watchNeutral
                    .slice()
                    .sort((a, b) => b.ret - a.ret)
                    .slice(0, 4)
                    .map((r) => `${r.symbol} ${fmtPct(r.ret)}`)
                    .join(' · ')}
                  {rec.watchNeutral.length > 4 ? ' …' : ''}
                </div>
              )}

              <div style={{ marginTop: 10, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                <strong style={{ color: C.amber }}>Honesty note:</strong> only decisions with a captured price AND a live quote
                are scored ({rec.withData} of {rec.totalDecisions}). A REJECTED name that fell is a good call (you dodged a loss);
                one that rose is a miss. Returns are point-in-time vs the price logged at decision, not annualized.
              </div>
            </>
          )}
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

function StatTile({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color, ...MONO }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim }}>{sub}</div>}
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
