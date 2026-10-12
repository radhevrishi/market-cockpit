'use client';
// zzz966 — Learn tab: "a growing business can still be a poor investment". Lessons that connect business growth,
// valuation and the return left for the buyer, plus a Return Lab that runs the same maths on the owner's own numbers.
// All arithmetic lives in lib/return-math.ts (tested). Example numbers are hypothetical unless marked otherwise.
import { useMemo, useState } from 'react';
import { returnFromToday, guidanceToEps, impliedPe, cagr } from '@/lib/return-math';
import { BORDER, TEXT, DIM } from './constants';

const BLUE = '#38BDF8', AMBER = '#F59E0B', GREEN = '#10B981', RED = '#EF4444';
const box: React.CSSProperties = { background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: DIM, borderBottom: `1px solid ${BORDER}`, fontWeight: 700 };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, color: TEXT, borderBottom: `1px solid ${BORDER}` };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '8px 10px', fontSize: 12.5, color: TEXT, margin: '8px 0', whiteSpace: 'pre-wrap' };
const rs = (v: number, d = 2) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pc = (v: number, d = 1) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(d)}%`;
const x = (v: number, d = 1) => `${v.toFixed(d)}×`;

function Lesson({ n, color, title, children }: { n: number; color: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(n <= 3);
  return (
    <div style={{ ...box, borderLeft: `3px solid ${color}` }}>
      <button onClick={() => setOpen((o) => !o)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline', width: '100%' }}>
        <span style={{ fontSize: 11, color: DIM, fontFamily: 'ui-monospace, monospace' }}>{String(n).padStart(2, '0')}</span>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: TEXT, flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: DIM }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ marginTop: 10, fontSize: 13, color: TEXT, lineHeight: 1.6 }}>{children}</div>}
    </div>
  );
}

function Table({ head, rows, right = [] }: { head: string[]; rows: (string | number | React.ReactNode)[][]; right?: number[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0' }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ ...th, textAlign: right.includes(i) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={right.includes(j) ? num : td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Field({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: DIM, fontWeight: 700 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" value={Number.isFinite(value) ? value : ''} step={step} onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', fontSize: 13, padding: '6px 8px', borderRadius: 4, border: `1px solid ${BORDER}`, background: '#0D1426', color: TEXT }} />
        {suffix && <span style={{ color: DIM, fontSize: 12 }}>{suffix}</span>}
      </span>
    </label>
  );
}

/** The Return Lab — bear / base / bull on the owner's own inputs. */
function ReturnLab() {
  const [price, setPrice] = useState(800);
  const [eps0, setEps0] = useState(10);
  const [growth, setGrowth] = useState(30);
  const [years, setYears] = useState(4);
  const [exitPe, setExitPe] = useState(30);
  const [hurdle, setHurdle] = useState(20);
  const [dil, setDil] = useState(0);
  const [div, setDiv] = useState(0);
  const valid = price > 0 && eps0 > 0 && years >= 1 && years <= 15 && exitPe > 0;
  const cases = useMemo(() => !valid ? [] : ([
    { name: 'Bear', color: RED, g: growth * 0.6, pe: exitPe * 0.75 },
    { name: 'Base', color: AMBER, g: growth, pe: exitPe },
    { name: 'Bull', color: GREEN, g: growth * 1.25, pe: exitPe * 1.15 },
  ].map((c) => ({ ...c, r: returnFromToday({ price, eps0, growthPct: c.g, years: Math.round(years), exitPe: c.pe, hurdlePct: hurdle, dilutionPct: dil, dividendYieldPct: div }) }))), [valid, price, eps0, growth, years, exitPe, hurdle, dil, div]);
  const base = cases[1]?.r;
  return (
    <div style={{ ...box, borderLeft: `3px solid ${GREEN}` }}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT }}>🧪 Return Lab — “if the business succeeds, what is left for me?”</div>
      <div style={{ fontSize: 12, color: DIM, marginTop: 4, lineHeight: 1.5 }}>
        Put in today’s price and EPS (or market cap and profit — same maths), your growth forecast, the holding period and the P/E you think the
        market will pay at the exit. Bear = 60% of your growth and 75% of your exit P/E; Bull = 125% and 115%.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 12 }}>
        <Field label="Price today (₹)" value={price} onChange={setPrice} />
        <Field label="EPS now (₹)" value={eps0} onChange={setEps0} step={0.5} />
        <Field label="EPS growth / yr" value={growth} onChange={setGrowth} suffix="%" />
        <Field label="Years held" value={years} onChange={setYears} />
        <Field label="Exit P/E" value={exitPe} onChange={setExitPe} suffix="×" />
        <Field label="Return wanted / yr" value={hurdle} onChange={setHurdle} suffix="%" />
        <Field label="Share dilution / yr" value={dil} onChange={setDil} step={0.5} suffix="%" />
        <Field label="Dividend yield" value={div} onChange={setDiv} step={0.5} suffix="%" />
      </div>
      {!valid ? <div style={{ marginTop: 10, fontSize: 12, color: AMBER }}>Enter a positive price, EPS and exit P/E, and 1–15 years.</div> : base && (
        <>
          <div style={{ marginTop: 12, fontSize: 12, color: DIM, fontWeight: 700 }}>TODAY’S PRICE ÷ EACH YEAR’S EPS (base case)</div>
          <Table head={['Year', 'EPS', 'Today’s P/E on it']} right={[1, 2]}
            rows={base.path.map((p) => [p.year === 0 ? 'Now' : `Year ${p.year}`, rs(p.eps), x(p.peOnToday)])} />
          <Table head={['Case', 'EPS ×', 'P/E change', 'Exit price', 'Price ×', 'Return / yr', 'Entry price for your return']} right={[1, 2, 3, 4, 5, 6]}
            rows={cases.map((c) => [<b key="n" style={{ color: c.color }}>{c.name}</b>, x(c.r.epsMultiple, 2), `${x(c.r.entryPe)} → ${x(c.pe)}`, rs(c.r.exitPrice), x(c.r.priceMultiple, 2), pc(c.r.totalCagrPct), rs(c.r.hurdleEntryPrice)])} />
          <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.55,
            background: base.verdict === 'ok' ? 'rgba(16,185,129,0.12)' : base.verdict === 'thin' ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
            color: base.verdict === 'ok' ? GREEN : base.verdict === 'thin' ? AMBER : RED }}>
            {base.verdict === 'ok' && <>🟢 If the base case comes true, today’s price earns about {pc(base.totalCagrPct)} a year — above your {pc(hurdle, 0)}.</>}
            {base.verdict === 'thin' && <>🟠 Base case earns about {pc(base.totalCagrPct)} a year — below your {pc(hurdle, 0)}. Little room for error.</>}
            {base.verdict === 'insufficient' && <>🔴 Current price offers insufficient return even if the base-case growth forecast is achieved ({pc(base.totalCagrPct)} a year vs {pc(hurdle, 0)} wanted).</>}
            {' '}To earn {pc(hurdle, 0)} from {rs(price)} with an exit at {x(exitPe)}, EPS must grow about <b>{pc(base.requiredEpsCagrPct)} a year</b>
            {' '}— or you buy near <b>{rs(base.hurdleEntryPrice)}</b>.
          </div>
          <div style={{ fontSize: 11, color: DIM, marginTop: 6 }}>
            Scenario arithmetic, not a forecast and not a recommendation. Dividends are added as a simple yearly yield; taxes and costs are ignored.
          </div>
        </>
      )}
    </div>
  );
}

export function ReturnLessons() {
  const ex = useMemo(() => returnFromToday({ price: 800, eps0: 10, growthPct: 30, years: 4, exitPe: 30, hurdlePct: 20 }), []);
  const ge = useMemo(() => guidanceToEps(30, 10, 12, 10), []);
  const sai = useMemo(() => { const rev = 1500 * Math.pow(1.175, 4); const cap = rev * 12; return { rev, cap, c: cagr(cap / 14000, 4), entry: cap / Math.pow(1.2, 4) }; }, []);
  const need = useMemo(() => returnFromToday({ price: 800, eps0: 10, growthPct: 30, years: 4, exitPe: 30, hurdlePct: 20 }).requiredEpsCagrPct, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: TEXT }}>📐 Growth ≠ Return — what is left for the buyer</h2>
        <div style={{ marginTop: 6, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
          A growing business can still be a poor investment when the share price already assumes most of that growth. Keep three things apart:
          <span style={{ color: BLUE }}> 🔵 business growth</span> (what the company may achieve),
          <span style={{ color: AMBER }}> 🟠 valuation</span> (what you pay for it) and
          <span style={{ color: GREEN }}> 🟢 your return</span> (what is left between your entry price and a defensible exit price).
          Examples are hypothetical; company figures marked “unverified” came from pasted notes.
        </div>
      </div>

      <ReturnLab />

      <Lesson n={1} color={BLUE} title="Three different valuation questions">
        <Table head={['Question', 'Calculation', 'Name']} rows={[
          ['How expensive on past earnings?', 'Price today ÷ last year’s EPS', 'Trailing P/E'],
          ['How expensive on forecast earnings?', 'Price today ÷ FY27 or FY28 EPS', 'Forward P/E for that year'],
          ['What price could it reach in FY30?', 'FY30 EPS × a sensible exit P/E', 'Future price scenario'],
        ]} />
        No stock “trades on” one fixed year — you can work out FY27, FY28 and FY30 multiples at the same time. “25× FY28” is only a ratio. The next
        question is always: <b>what growth must happen, how long do I wait, and what multiple is left when I sell?</b>
      </Lesson>

      <Lesson n={2} color={AMBER} title="Why a stock can look cheap on FY30 earnings">
        Price ₹800 today, EPS ₹10, growing 30% a year for four years, sold at 30× FY30 earnings, no dividends:
        <Table head={['Year', 'EPS', '₹800 ÷ EPS']} right={[1, 2]} rows={ex.path.map((p) => [`FY${26 + p.year}`, rs(p.eps), x(p.peOnToday)])} />
        “Only 28× FY30” sounds fair. But the exit price is {rs(ex.exitEps)} × 30 = <b>{rs(ex.exitPrice)}</b>, and from ₹800 that is
        <b style={{ color: RED }}> {pc(ex.priceCagrPct)} a year</b>. EPS nearly triples; you earn almost nothing. A distant denominator makes the multiple look
        smaller — it does not make today’s price smaller.
      </Lesson>

      <Lesson n={3} color={GREEN} title="The one identity that links growth to return">
        <div style={mono}>Price multiple = EPS multiple × (Exit P/E ÷ Entry P/E)</div>
        Example above: {x(ex.epsMultiple, 3)} × (30 ÷ 80) = <b>{x(ex.priceMultiple, 3)}</b> — the P/E falling from 80× to 30× eats nearly all the growth.
        <Table head={['Earnings', 'Valuation', 'Effect on your price gain']} rows={[
          ['🔵 EPS up', '🟢 P/E expands', 'Valuation adds to the earnings gain'],
          ['🔵 EPS up', 'P/E unchanged', 'Price rises in line with EPS'],
          ['🔵 EPS up', '🔴 P/E contracts', 'Valuation takes away some or all of the gain'],
        ]} />
        <b>Multibagger maths:</b> EPS doubles and P/E goes 15× → 25×: 2 × 25/15 = <b>3.33×</b>. For a 10-bagger with the same re-rating you need
        EPS to grow 10 × 15/25 = <b>6×</b>. Always write down both multipliers; a growth rate alone proves nothing.
      </Lesson>

      <Lesson n={4} color={GREEN} title="Same company, very different returns — the entry price decides">
        <Table head={['Entry price', 'FY30 exit price', '4-year multiple', 'Return / yr']} right={[1, 2, 3]} rows={[200, 400, 800].map((p) =>
          [rs(p, 0), rs(ex.exitPrice), x(ex.exitPrice / p, 2), <b key="c" style={{ color: p === 800 ? RED : GREEN }}>{pc(cagr(ex.exitPrice / p, 4))}</b>])} />
        Turn it round to get the price that earns the return you want:
        <div style={mono}>Entry price for your hurdle = Future exit price ÷ (1 + r)^N</div>
        At 20% a year: {rs(ex.exitPrice)} ÷ 1.2⁴ = <b>{rs(ex.hurdleEntryPrice)}</b>. That is the price consistent with that scenario and that hurdle —
        not an independently proven intrinsic value.
      </Lesson>

      <Lesson n={5} color={RED} title="Reverse it: what growth is today’s price asking for?">
        Instead of guessing the return, ask what the price already needs:
        <div style={mono}>Required EPS multiple = (1 + r)^N × Entry P/E ÷ Exit P/E</div>
        ₹800 at 80×, 20% wanted, exit at 30× after 4 years: 1.2⁴ × 80 ÷ 30 = 5.5× EPS — about <b>{pc(need, 0)} EPS growth every year</b>. If even the
        bull case of management cannot reach that, the price is the problem, not the company. The <b>Reverse-DCF</b> tab does the same with cash flows.
      </Lesson>

      <Lesson n={6} color={AMBER} title="A forward valuation holds two separate bets">
        <Table head={['Bet', 'What you must check']} rows={[
          ['Earnings up to the exit year', 'Can revenue, margins and funding really produce that diluted EPS?'],
          ['Growth left after the exit year', 'What runway, risk and return on capital justify the exit multiple?'],
        ]} />
        If your FY30 forecast already has the plant fully used and growth slowing after it, the exit P/E must be the multiple of that slower, mature
        business — not today’s growth multiple. Also say which exit P/E you mean: <b>trailing</b> (on FY30 EPS) or <b>forward</b> (on FY31 EPS). They differ
        by one year of growth.
      </Lesson>

      <Lesson n={7} color={RED} title="The dating mistake in multi-year calculators">
        Pasted Sai Life Sciences assumptions (unverified): revenue ₹1,500 Cr growing 17.5% a year for four years → ₹{Math.round(sai.rev).toLocaleString('en-IN')} Cr;
        × 12 P/S → ₹{Math.round(sai.cap).toLocaleString('en-IN')} Cr.
        <Table head={['Output', 'What it really is']} rows={[
          [`₹${Math.round(sai.cap).toLocaleString('en-IN')} Cr`, 'A market cap FOUR YEARS from now, at a 12× exit P/S'],
          [pc(sai.c), 'Yearly market-cap growth from ₹14,000 Cr (same share count, no dividends)'],
          [`₹${Math.round(sai.entry).toLocaleString('en-IN')} Cr`, 'Today’s market cap that earns 20% a year on that scenario'],
        ]} />
        🔴 “Fair value today: ₹{Math.round(sai.cap).toLocaleString('en-IN')} Cr” mixes dates. 🟢 “Four-year target market cap” is the honest label.
        But do not discount everything: FY27 EPS × a <i>present-day</i> forward P/E is already a today value. <b>The valuation date decides whether to discount — not
        the earnings year.</b>
      </Lesson>

      <Lesson n={8} color={BLUE} title="From management guidance to diluted EPS">
        <div style={mono}>Revenue → operating profit → profit after interest and tax → profit to shareholders → diluted EPS</div>
        Revenue +30%, net margin 10% → 12%, 10% more shares:
        <div style={mono}>PAT × = 1.30 × 12/10 = 1.56 · EPS × = 1.56 ÷ 1.10 = 1.418</div>
        <Table head={['Line', 'Growth']} right={[1]} rows={[['🔵 Revenue', pc(ge.revenueGrowthPct, 0)], ['🟢 Profit (PAT)', pc(ge.patGrowthPct, 0)], ['🟠 EPS per share', pc(ge.epsGrowthPct)]]} />
        Operating leverage lifts profit growth; dilution (QIP, warrants, ESOPs, convertibles) takes part of it away from each share. Model both before you pick a multiple.
      </Lesson>

      <Lesson n={9} color={AMBER} title="Match the method to what management actually guides">
        <Table head={['Management says', 'You model next', 'Value with']} rows={[
          ['Revenue growth or revenue figure', 'Margins, profit to shareholders, share count', 'P/E or EV methods; P/S as a cross-check'],
          ['Absolute PAT', 'Profit to shareholders, diluted EPS', 'P/E'],
          ['EBITDA growth or margin', 'EBITDA and the debt / cash bridge', 'EV/EBITDA, then to equity'],
          ['Multi-year CAGR', 'Year-by-year earnings', 'Dated exit price + yearly return'],
          ['Peak revenue potential', 'Timing, plant use, margins, funding', 'Scenarios'],
          ['Separate segment guidance', 'Each segment + head-office costs', 'Sum of parts'],
        ]} />
        <div style={mono}>Equity value = Enterprise value − Debt + Cash   (plus minority interests, leases and other claims where they exist)</div>
      </Lesson>

      <Lesson n={10} color={RED} title="Three checks every guidance-based valuation needs">
        <b>Right base year.</b> “FY27 +25%” is on FY26 revenue, not on an arbitrary trailing-12-month figure.<br />
        <b>Profitability cross-check.</b> A sector label does not justify a P/S. For the same period:
        <div style={mono}>P/E = P/S ÷ net margin</div>
        <Table head={['P/S', 'Net margin', 'Implied P/E']} right={[0, 1, 2]} rows={[[10, 10], [10, 20], [10, 25]].map(([p, m]) => [x(p, 0), `${m}%`, x(impliedPe(p, m), 0)])} />
        <b>Scenarios from evidence.</b> A blanket “cut guidance 20–30%” is a modelling choice. Build bear/base/bull from orders, plant use, margins,
        funding and the company’s own record of meeting guidance.
      </Lesson>

      <Lesson n={11} color={GREEN} title="More connections that change the answer">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Earnings yield vs your hurdle.</b> 80× P/E = 1.25% earnings yield. Growth has to close the gap to your 20% — and the faster that gap must close, the less room for a miss.</li>
          <li><b>Time is part of the price.</b> Doubling in 2 years = {pc(cagr(2, 2), 0)} a year; doubling in 6 years = {pc(cagr(2, 6), 0)} a year. A late thesis is a worse thesis.</li>
          <li><b>Interest rates move multiples.</b> When the return investors demand rises, the P/E they pay falls even if the business is unchanged — exit multiples are not fixed.</li>
          <li><b>PEG is a shortcut, not a proof.</b> 40× on 40% growth (PEG 1) is only cheap if that growth lasts long enough to bring the multiple down before you sell.</li>
          <li><b>Margin of safety = the bear case.</b> If the bear-case exit price is below today’s price, you are paying for things going right.</li>
          <li><b>Cash backs the multiple.</b> Profit that does not turn into operating cash (receivables, inventory) deserves a lower exit multiple than profit that does.</li>
          <li><b>Buybacks and dividends add, dilution subtracts.</b> Total return ≈ EPS growth ± change in share count ± change in P/E + dividend yield.</li>
        </ul>
      </Lesson>

      <Lesson n={12} color={GREEN} title="What to see before any entry decision">
        <Table head={['Output', 'Why']} rows={[
          ['Guidance base year and forecast year', 'No period mix-ups'],
          ['FY27 / FY28 / FY30 diluted EPS', 'The earnings path written down'],
          ['Today’s P/E on each of those years', 'What you are paying for that path'],
          ['Dated exit price and exit multiple', 'The future scenario, with a date on it'],
          ['Yearly return from today', 'The investment outcome'],
          ['Entry price for your hurdle', 'The price that makes the scenario worth it'],
          ['Bear / base / bull', 'How much the answer moves with growth, dilution and multiple'],
        ]} />
        The test behind every FY30 valuation: <b>if the business succeeds, does today’s entry price still leave an attractive return?</b>
      </Lesson>
    </div>
  );
}
