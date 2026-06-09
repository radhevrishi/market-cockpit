'use client';

// ============================================================================
// THE GAUTAM BAID PLAYBOOK (PATCH 1130)
// How to think, read markets, and compound like Gautam Baid — full 20-part
// operating manual built from the source document. Tabbed, in execution order.
// Interactive: bull/bear stage tracker, 10-signal bottom checklist (scored),
// stock-selection veto checker, 30-day plan tracker. Persists to localStorage.
// Self-contained (react + next/link).
// ============================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';

const C = {
  bg: '#090d13', panel: '#111722', panel2: '#0d131c', line: '#1e2733', line2: '#2b3a4d',
  txt: '#e6edf3', muted: '#8a98ab', dim: '#5b6677',
  green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff',
  violet: '#a78bfa', cyan: '#39d0d8', teal: '#2dd4bf', lime: '#84cc16', orange: '#f0883e', gold: '#e3b341',
};
const F = { xs: 13, sm: 14.5, md: 16, base: 17, lg: 20, xl: 24, xxl: 32, hero: 40 };
const band = (r: number) => (r >= 0.8 ? C.green : r >= 0.6 ? C.amber : C.red);
const LS = { read: 'mc:baid:read', bottom: 'mc:baid:bottom', stock: 'mc:baid:stock', plan: 'mc:baid:plan' };
const save = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- block model ----------
type Block =
  | { k: 'p'; t: string }
  | { k: 'h'; t: string }
  | { k: 'q'; t: string; by?: string }
  | { k: 'note'; title?: string; lines: string[]; c?: string; ol?: boolean }
  | { k: 'ul'; items: string[] }
  | { k: 'ol'; items: string[] }
  | { k: 'tbl'; head: string[]; rows: string[][] }
  | { k: 'kv'; title?: string; rows: [string, string][] }
  | { k: 'comp'; name: 'stages' | 'bottom' | 'stockcheck' | 'plan' };
type Part = { id: string; n: number; title: string; intro?: string; blocks: Block[] };
type Group = { label: string; color: string; parts: string[] };

function Pill({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: F.xs, fontWeight: 800, color, border: `1px solid ${color}66`, background: `${color}14`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{text}</span>;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {blocks.map((b, i) => {
        if (b.k === 'p') return <p key={i} style={{ margin: 0, fontSize: F.base, color: C.txt, lineHeight: 1.65 }}>{b.t}</p>;
        if (b.k === 'h') return <div key={i} style={{ fontSize: F.lg, fontWeight: 800, color: C.txt, marginTop: 6 }}>{b.t}</div>;
        if (b.k === 'q') return (
          <div key={i} style={{ borderLeft: `4px solid ${C.gold}`, background: `${C.gold}0d`, borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: F.lg, color: C.txt, lineHeight: 1.55, fontStyle: 'italic' }}>&ldquo;{b.t}&rdquo;</div>
            {b.by ? <div style={{ fontSize: F.sm, color: C.muted, marginTop: 6, fontWeight: 700 }}>— {b.by}</div> : null}
          </div>
        );
        if (b.k === 'note') {
          const col = b.c || C.cyan;
          return (
            <div key={i} style={{ background: `${col}0d`, border: `1px solid ${col}40`, borderLeft: `4px solid ${col}`, borderRadius: 10, padding: '14px 16px' }}>
              {b.title ? <div style={{ fontSize: F.md, fontWeight: 800, color: col, marginBottom: 8 }}>{b.title}</div> : null}
              {b.ol
                ? <ol style={{ margin: 0, paddingLeft: 22 }}>{b.lines.map((l, j) => <li key={j} style={{ fontSize: F.base, color: C.txt, lineHeight: 1.6, marginBottom: 5 }}>{l}</li>)}</ol>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{b.lines.map((l, j) => <div key={j} style={{ fontSize: F.base, color: C.txt, lineHeight: 1.6 }}>{l}</div>)}</div>}
            </div>
          );
        }
        if (b.k === 'ul') return <ul key={i} style={{ margin: 0, paddingLeft: 22 }}>{b.items.map((x, j) => <li key={j} style={{ fontSize: F.base, color: C.txt, lineHeight: 1.6, marginBottom: 6 }}>{x}</li>)}</ul>;
        if (b.k === 'ol') return <ol key={i} style={{ margin: 0, paddingLeft: 22 }}>{b.items.map((x, j) => <li key={j} style={{ fontSize: F.base, color: C.txt, lineHeight: 1.6, marginBottom: 6 }}>{x}</li>)}</ol>;
        if (b.k === 'kv') return (
          <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
            {b.title ? <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt, padding: '10px 14px', borderBottom: `1px solid ${C.line}` }}>{b.title}</div> : null}
            {b.rows.map((r, j) => (
              <div key={j} style={{ display: 'flex', gap: 12, padding: '9px 14px', background: j % 2 ? C.panel2 : 'transparent', borderBottom: j < b.rows.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                <div style={{ fontSize: F.sm, fontWeight: 800, color: C.muted, minWidth: 190, maxWidth: 240 }}>{r[0]}</div>
                <div style={{ fontSize: F.base, color: C.txt, lineHeight: 1.55, flex: 1 }}>{r[1]}</div>
              </div>
            ))}
          </div>
        );
        if (b.k === 'tbl') return (
          <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', background: C.panel2, borderBottom: `1px solid ${C.line2}` }}>
              {b.head.map((h, j) => <div key={j} style={{ flex: j === 0 ? '0 0 170px' : 1, fontSize: F.sm, fontWeight: 800, color: C.cyan, padding: '10px 12px' }}>{h}</div>)}
            </div>
            {b.rows.map((r, j) => (
              <div key={j} style={{ display: 'flex', borderBottom: j < b.rows.length - 1 ? `1px solid ${C.line}` : 'none', background: j % 2 ? C.panel2 : 'transparent' }}>
                {r.map((c, k) => <div key={k} style={{ flex: k === 0 ? '0 0 170px' : 1, fontSize: F.sm, color: k === 0 ? C.txt : C.muted, fontWeight: k === 0 ? 800 : 500, padding: '10px 12px', lineHeight: 1.5 }}>{c}</div>)}
              </div>
            ))}
          </div>
        );
        if (b.k === 'comp') {
          if (b.name === 'stages') return <StagesViz key={i} />;
          if (b.name === 'bottom') return <BottomChecklist key={i} />;
          if (b.name === 'stockcheck') return <StockCheck key={i} />;
          if (b.name === 'plan') return <Plan30 key={i} />;
        }
        return null;
      })}
    </div>
  );
}

// ---------- interactive: bull/bear stage tracker ----------
const STAGE_DATA = {
  bull: [
    { tag: 'Stage 1 (shortest) — "Donkeys and horses all run"', see: 'Most beaten-down stocks of the just-concluded bear bounce hardest. Broad rally, everything up.', mean: 'Mean-reversion bounce in junk. NEW leaders are quietly revealing themselves via relative strength but do not rally explosively yet.', does: 'Rotate OUT of past laggards. Rotate INTO names that refused to fall in the bear’s final months. Do the deep research now.', c: C.amber },
    { tag: 'Stage 2 (longest) — "The stock-picker’s paradise"', see: 'Market becomes NARROW. Rewards earnings growth, management commentary, growth visibility. 3–4 sector leaders rotate in sequence, passing the baton.', mean: 'This is where alpha is made. Quality + earnings + theme + visibility all line up.', does: 'Concentrate work on the 3–4 emerging leaders. Ride the rotation. Average UP into winners as they execute.', c: C.green },
    { tag: 'Stage 3 (final crescendo) — "Everything goes up at once"', see: 'Record QIPs and IPOs. Junk SME IPOs over-subscribed 100–200×. Stocks stop reacting to good earnings. Universal euphoria.', mean: 'Distribution. Smart money is exiting via primary issuance into retail hands.', does: 'Raise cash. Trim. Prepare the bear-market checklist. Re-read Howard Marks.', c: C.red },
  ],
  bear: [
    { tag: 'Stage 1 (short) — Denial', see: 'Sharp 20–30% fall in small/mid. "Buy the dip" chatter still loud. No real fear yet.', mean: 'The wave is forming but most don’t believe yet.', does: 'DO NOT buy dips. Start raising some cash. Trim the most leveraged and lowest-quality.', c: C.amber },
    { tag: 'Stage 2 (longest) — "Death by a thousand cuts"', see: 'Grinding decline. Quality time-corrects sideways. Bad quality washes out gradually. Many lower lows.', mean: 'The slow purge. Realization phase. Active patience required.', does: 'Stay defensive. Hold cash. Track relative-strength leaders quietly. Read concalls. Do the work no one wants to do.', c: C.orange },
    { tag: 'Stage 3 (most violent) — Capitulation', see: 'Nifty 50 itself crashes 25–30%. Currency breaks. VIX > 25. Largest FII outflow on record. "India is finished" everywhere.', mean: 'The terminal washout. Institutional money panics last; their exit IS the bottom.', does: 'Get fully invested. Raise new capital if you can. The pain you feel is the price of admission to the next bull.', c: C.green },
  ],
};
function StagesViz() {
  const [mode, setMode] = useState<'bull' | 'bear'>('bull');
  const rows = STAGE_DATA[mode];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['bull', 'bear'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 16px', borderRadius: 999, border: `1px solid ${mode === m ? (m === 'bull' ? C.green : C.red) : C.line2}`, background: mode === m ? (m === 'bull' ? `${C.green}1f` : `${C.red}1f`) : C.panel2, color: mode === m ? (m === 'bull' ? C.green : C.red) : C.muted }}>{m === 'bull' ? '🟢 Bull market' : '🔴 Bear market'}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {rows.map((s, i) => (
          <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderTop: `3px solid ${s.c}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: s.c, marginBottom: 8, lineHeight: 1.35 }}>{s.tag}</div>
            <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}><b style={{ color: C.txt }}>See: </b>{s.see}</div>
            <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}><b style={{ color: C.txt }}>Means: </b>{s.mean}</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.5, background: `${s.c}12`, border: `1px solid ${s.c}40`, borderRadius: 8, padding: '8px 10px' }}><b style={{ color: s.c }}>Do: </b>{s.does}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- interactive: 10-signal bottom checklist ----------
const BOTTOM_SIGNALS: { ind: string; trig: string; read: string }[] = [
  { ind: '1. Severity of price damage', trig: 'Median fall in sub-3,000-cr mcap stocks > 60–65%', read: '66% median fall achieved' },
  { ind: '2. FII capitulation + worst rupee month', trig: 'Largest monthly FII outflow on record + worst rupee month — BOTH same month', read: 'Both occurred March 2026' },
  { ind: '3. India VIX', trig: '> 25', read: 'Above 25 late March 2026 (higher than Russia–Ukraine 2022)' },
  { ind: '4. Nifty 50 capitulation', trig: 'Biggest single-month Nifty fall in years; blue-chips (HDFC Bank, Kotak) finally fall 25–30%', read: 'Largest monthly Nifty fall since COVID Mar 2020' },
  { ind: '5. % of NSE-500 above 200-DMA', trig: '< 20% (false positives if alone)', read: 'Below 20% in March 2026' },
  { ind: '6. Google Trends "multibagger"', trig: 'Below COVID lows', read: 'Below COVID lows in March 2026' },
  { ind: '7. Social-media sentiment', trig: 'Retail openly blaming the government on X/Twitter', read: 'Widespread Feb–March 2026' },
  { ind: '8. Pundit / journalist tone', trig: 'Media pushes REITs, InvITs, high-dividend, fixed income, gold', read: 'Confirmed Feb–March 2026' },
  { ind: '9. "India is finished" narrative', trig: 'Crowd says US/Korea/Taiwan is the place; "why invest in India?"', read: 'Widespread March 2026' },
  { ind: '10. The Big Reversal Day', trig: 'Gap-down open, thousands of stocks down 3%+, close GREEN = seller exhaustion', read: '2 April 2026 — exactly this pattern' },
];
function BottomChecklist() {
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(LS.bottom) || '{}'); if (v && typeof v === 'object') setOn(v); } catch {} }, []);
  const toggle = (i: number) => setOn((p) => { const n = { ...p, [i]: !p[i] }; save(LS.bottom, n); return n; });
  const reset = () => { setOn({}); save(LS.bottom, {}); };
  const done = BOTTOM_SIGNALS.filter((_, i) => on[i]).length;
  const verdict = done >= 9 ? 'Bottom is in (9–10 + a Big Reversal Day)' : done >= 7 ? 'Within weeks of the bottom (7–8 green)' : done >= 4 ? 'Forming — keep scoring' : 'Not yet — stay patient';
  const col = done >= 9 ? C.green : done >= 7 ? C.lime : done >= 4 ? C.amber : C.dim;
  return (
    <div>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: F.md, fontWeight: 900, color: C.txt }}>Bottom score</span>
        <div style={{ flex: 1, minWidth: 160, height: 12, background: C.panel2, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.line}` }}>
          <div style={{ width: `${(done / 10) * 100}%`, height: '100%', background: col }} />
        </div>
        <span style={{ fontSize: F.md, fontWeight: 900, color: col }}>{done}/10</span>
        <span style={{ fontSize: F.sm, fontWeight: 800, color: col }}>{verdict}</span>
        <button onClick={reset} style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Reset</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BOTTOM_SIGNALS.map((s, i) => (
          <button key={i} onClick={() => toggle(i)} style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', background: on[i] ? `${C.green}10` : C.panel, border: `1px solid ${on[i] ? C.green : C.line}`, borderRadius: 10, padding: '10px 13px' }}>
            <span style={{ color: on[i] ? C.green : C.dim, fontSize: F.lg, fontWeight: 900, lineHeight: 1.2 }}>{on[i] ? '☑' : '☐'}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: F.md, fontWeight: 800, color: C.txt }}>{s.ind}</span>
              <span style={{ display: 'block', fontSize: F.sm, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>{s.trig}</span>
              <span style={{ display: 'block', fontSize: F.xs, color: C.cyan, lineHeight: 1.4, marginTop: 3 }}>Apr 2026 reading: {s.read}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- interactive: stock-selection veto checker ----------
const QUANT = ['ROCE sustained materially above cost of capital', 'ROE high and stable', 'Gross margin high + stable/improving (pricing power)', 'Operating cash flow strong and growing', 'Capital-light: sales growth without heavy reinvestment', 'High FCF / operating-cash-flow ratio', 'Low debt', 'Minimal equity dilution over time', 'Long reinvestment runway at the same high ROICs'];
const MOATS = ['Brand strength → pricing power', 'Network effects', 'High switching costs', 'A collection of patents (not one or two)', 'Proprietary tech / strategic raw materials', 'Regulatory entry barriers (licenses, approvals)', 'Culture (most underappreciated moat — HDFC Bank, Costco, Berkshire)', 'Long runway + monopoly/duopoly/oligopoly structure'];
const VETOS = ['Absurdly high valuations', 'Bad corporate governance', 'Gross capital misallocation', 'Terminal-value risk (tech obsolescence / app risk)', 'Wafer-thin margins', 'Intense competition', 'High leverage', 'Negative operating cash flow'];
function CheckRow({ on, onClick, text, color }: { on: boolean; onClick: () => void; text: string; color: string }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: '4px 0', width: '100%' }}>
      <span style={{ color: on ? color : C.dim, fontSize: F.base, fontWeight: 900, lineHeight: 1.3, minWidth: 18 }}>{on ? '☑' : '☐'}</span>
      <span style={{ fontSize: F.sm, color: on ? C.txt : C.muted, lineHeight: 1.5 }}>{text}</span>
    </button>
  );
}
function StockCheck() {
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(LS.stock) || '{}'); if (v && typeof v === 'object') setOn(v); } catch {} }, []);
  const toggle = (k: string) => setOn((p) => { const n = { ...p, [k]: !p[k] }; save(LS.stock, n); return n; });
  const reset = () => { setOn({}); save(LS.stock, {}); };
  const quantDone = QUANT.filter((_, i) => on[`q${i}`]).length;
  const moatDone = MOATS.filter((_, i) => on[`m${i}`]).length;
  const vetoHit = VETOS.filter((_, i) => on[`v${i}`]).length;
  const total = QUANT.length + MOATS.length;
  const passed = quantDone + moatDone;
  const r = passed / total;
  return (
    <div>
      <div style={{ background: vetoHit ? `${C.red}12` : C.panel, border: `1px solid ${vetoHit ? C.red : C.line}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        {vetoHit ? <span style={{ fontSize: F.md, fontWeight: 900, color: C.red }}>⛔ VETO — {vetoHit} disqualifier{vetoHit > 1 ? 's' : ''} present. Walk away.</span>
          : <span style={{ fontSize: F.md, fontWeight: 900, color: band(r) }}>Quality score {passed}/{total} · {Math.round(r * 100)}% · {r >= 0.8 ? 'Strong' : r >= 0.6 ? 'Decent' : 'Weak'}</span>}
        <button onClick={reset} style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Reset</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: F.md, fontWeight: 800, color: C.green, marginBottom: 8 }}>Quantitative — the numbers must work ({quantDone}/{QUANT.length})</div>
          {QUANT.map((t, i) => <CheckRow key={i} on={!!on[`q${i}`]} onClick={() => toggle(`q${i}`)} text={t} color={C.green} />)}
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 8 }}>Qualitative — the moat must be real ({moatDone}/{MOATS.length})</div>
          {MOATS.map((t, i) => <CheckRow key={i} on={!!on[`m${i}`]} onClick={() => toggle(`m${i}`)} text={t} color={C.violet} />)}
        </div>
        <div style={{ background: `${C.red}0a`, border: `1px solid ${C.red}40`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 8 }}>Disqualifiers — any one = instant veto</div>
          {VETOS.map((t, i) => <CheckRow key={i} on={!!on[`v${i}`]} onClick={() => toggle(`v${i}`)} text={t} color={C.red} />)}
        </div>
      </div>
    </div>
  );
}

// ---------- interactive: 30-day plan tracker ----------
const PLAN: { week: string; color: string; days: string[] }[] = [
  { week: 'Week 1 — Foundation', color: C.amber, days: [
    'Day 1: Buy a $10 paper journal. Open it. Date the first page.',
    'Day 2: Start the morning 3-3-3 ritual (gratitudes, today-great, affirmations).',
    'Day 3: Start the evening 3-3 ritual (highlights, lessons).',
    'Day 4: Order Poor Charlie’s Almanack + Seeking Wisdom + All I Want To Know Is Where I’m Going To Die.',
    'Day 5: Download the Buffett Partnership letters (1957–1969). Print them.',
    'Day 6: Download Sanjay Bakshi’s Oct 2013 "Mispricing of Quality" white paper. Read it twice.',
    'Day 7: Reflect — has daily journaling been hard? Plan how to make it easier.',
  ] },
  { week: 'Week 2 — Investment Process', color: C.cyan, days: [
    'Day 8: Open a separate investment journal. Write every current holding + original thesis.',
    'Day 9: For each holding, fill in valuation assumptions, key catalyst, what could go wrong.',
    'Day 10: Run the 8-disqualifier checklist on each holding. Any veto? Plan an exit.',
    'Day 11: Build a watchlist of every sector and sub-industry in your market.',
    'Day 12: Start the cluster watch — on the next red day, note every stock making 3-month highs.',
    'Day 13: For one cluster you spot, open the latest annual report. Read it.',
    'Day 14: Read 4 conference-call transcripts for that company. Cross-check on Screener.in.',
  ] },
  { week: 'Week 3 — Portfolio Construction', color: C.blue, days: [
    'Day 15: Count holdings. If > 30, plan a consolidation. If < 15, plan a diversification.',
    'Day 16: Calculate industry concentration. Anything > 30%? Plan to bring it under.',
    'Day 17: Identify your single largest position. Highest-conviction quality, or just up the most?',
    'Day 18: Run the 4 inverted questions on your largest position.',
    'Day 19: Run the same on your bottom 5 positions. Worth holding?',
    'Day 20: Do you use leverage / shorts / derivatives? If yes, plan to unwind.',
    'Day 21: Calculate current cash level. Where in the cycle are you? Should it be higher?',
  ] },
  { week: 'Week 4 — Cycle Awareness & Habits', color: C.green, days: [
    'Day 22: Score today’s market on the 10-point bottom checklist.',
    'Day 23: Place your market on the 3-stage bull/bear framework.',
    'Day 24: Identify the 3–4 sector leaders showing the strongest relative strength.',
    'Day 25: For each, run the 7-step research workflow.',
    'Day 26: Start the daily concall habit — one transcript per day.',
    'Day 27: Health discipline — sleep 7–8h, sugar down, exercise 3–4×/week.',
    'Day 28: Connect with one more-experienced investor. Schedule a monthly call.',
    'Day 29: Do your first quarterly journal review. What patterns emerge?',
    'Day 30: Write the ONE behavior to compound next year. Pin it above your desk.',
  ] },
];
function Plan30() {
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(LS.plan) || '{}'); if (v && typeof v === 'object') setOn(v); } catch {} }, []);
  const toggle = (k: string) => setOn((p) => { const n = { ...p, [k]: !p[k] }; save(LS.plan, n); return n; });
  const reset = () => { setOn({}); save(LS.plan, {}); };
  const total = PLAN.reduce((a, w) => a + w.days.length, 0);
  const done = Object.values(on).filter(Boolean).length;
  const r = total ? done / total : 0;
  return (
    <div>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: F.md, fontWeight: 900, color: C.txt }}>30-day progress</span>
        <div style={{ flex: 1, minWidth: 160, height: 12, background: C.panel2, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.line}` }}>
          <div style={{ width: `${r * 100}%`, height: '100%', background: band(r) }} />
        </div>
        <span style={{ fontSize: F.md, fontWeight: 900, color: band(r) }}>{done}/{total} · {Math.round(r * 100)}%</span>
        <button onClick={reset} style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Reset</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignItems: 'start' }}>
        {PLAN.map((w, wi) => (
          <div key={wi} style={{ background: C.panel, border: `1px solid ${C.line}`, borderTop: `3px solid ${w.color}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: w.color, marginBottom: 8 }}>{w.week}</div>
            {w.days.map((d, di) => <CheckRow key={di} on={!!on[`${wi}-${di}`]} onClick={() => toggle(`${wi}-${di}`)} text={d} color={w.color} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================= CONTENT (20 parts) =============================
const PARTS: Part[] = [
  { id: 'who', n: 1, title: 'Who Gautam Baid Is',
    intro: 'Before you copy a man’s process, study his life. Baid’s process is the residue of specific experiences — a graveyard-shift hotel job, a brutal Indian small-cap bear market, and thousands of hours of reading.',
    blocks: [
      { k: 'kv', title: 'The bio at a glance', rows: [
        ['Full name', 'Gautam Baid, CFA'],
        ['Born / raised', 'Kolkata, India (youngest of four siblings)'],
        ['Education', 'MBA (India); CFA charterholder'],
        ['Pre-2015 career', 'Healthcare investment banking — Citigroup (Mumbai, 3 yrs), Deutsche Bank (Mumbai / London / Hong Kong, 4 yrs)'],
        ['The 2015 pivot', 'Relocated to the US with no job; took a graveyard-shift hotel front-desk job in San Francisco (11pm–7am); read voraciously between guests'],
        ['First investing role', 'Portfolio Manager, Global Equity Strategy, Summit Global Investments, Salt Lake City (Nov 2016 – Jul 2021)'],
        ['Featured', 'Morningstar India "Learn From the Masters" series (2018, 2019)'],
        ['Books', 'The Joys of Compounding (2018; revised Columbia Univ. Press 2020); The Making of a Value Investor (HarperCollins India, Oct 2023)'],
        ['Current vehicle', 'Stellar Wealth Partners India Fund I, LP (Delaware LP, live 3 Oct 2022). Listed Indian equities only. ~US$35M AUM (May 2026).'],
        ['India PMS / Smallcase', 'Stellar Wealth PMS (via Complete Circle Wealth); FlexiCap and Megatrends smallcases'],
        ['Fee structure', 'Buffett Partnership model: 0% management fee, 6% annual hurdle, 25% performance fee above hurdle, high-water mark'],
        ['Key habit since 2014', 'Keeps a $10 journal — "one of the best value investments I ever made."'],
        ['Twitter / X', '@Gautam__Baid'],
      ] },
      { k: 'h', t: 'The career arc — in his own words' },
      { k: 'q', t: 'I got lured into the stock market out of greed during the final euphoric phases of the 2003–2007 bull market. I bought Reliance Power Sector MF in late 2007 and Ispat Steel in January 2008. Both crashed 70–80%. I had successfully gained admission into the stock markets by paying my tuition fees.', by: 'Gautam Baid' },
      { k: 'q', t: 'In 2015 I moved to the US with no job in hand. I got 1,300 rejections over 15 months. I took a minimum-wage front-desk job at a San Francisco hotel from 11pm to 7am, riding the bus in storms to read one extra chapter of Carol Loomis’s Tap Dancing to Work at Barnes & Noble to save a few dollars. That night I realised I had finally discovered my calling in life. I could not sleep that entire night.', by: 'Gautam Baid' },
      { k: 'h', t: 'The five inflection points' },
      { k: 'ol', items: [
        '2007–08 — Speculative losses in Reliance Power MF and Ispat Steel. Lesson: never chase late-cycle euphoria.',
        '2015 — Moves to the US with no job. Begins reading Safal Niveshak, Sanjay Bakshi’s Fundoo Professor, Base Hit Investing, Microcap Club — the deliberate-practice apprenticeship.',
        'Nov 2016 — Lands a Portfolio Manager seat at Summit Global Investments via a random LinkedIn quick-apply. Begins managing real money.',
        'Jan 2018 – Mar 2020 — The Indian small/mid-cap bear market. Concentrated in micro-caps, small-caps and cyclicals. Loses heavily. Journals daily. This reshapes everything: "return ON capital" becomes "return OF capital."',
        'Oct 2022 — Launches Stellar Wealth Partners India Fund, his own partnership, modeled on Buffett’s original fee structure.',
      ] },
    ] },
  { id: 'pillars', n: 2, title: 'Life Philosophy: The Six Pillars of Compounding',
    intro: 'Baid’s biggest idea is not about money. It is that everything important in life compounds — and your job is to compound on six fronts simultaneously, every single day.',
    blocks: [
      { k: 'note', c: C.gold, title: 'His central sentence (read this slowly)', lines: ['Money compounds. Knowledge compounds. Character compounds. Relationships compound. Habits compound. Health compounds. Goodwill compounds.', 'Every single day either compounds positively or negatively on each of those fronts. Most people only track one (money) and lose on the others.'] },
      { k: 'h', t: 'The six-pillar framework' },
      { k: 'tbl', head: ['Pillar', 'What it means', 'How he practices it'], rows: [
        ['1. Positive Thoughts', 'A scared or resentful brain cannot hold a quality stock for a decade.', 'Morning gratitude ×3, affirmations ×3, avoids toxic people, celebrates small wins, replaces complaining with curiosity.'],
        ['2. Good Health', '"A long, healthy life is the key to compounding." Jhunjhunwala had the best CAGR ever but died young because he ignored health.', 'Less sugar/junk; exercises 3–4 h/week; 7–8 h sleep; no late nights.'],
        ['3. Good Habits', 'Tiny daily rituals stacked over decades. Identity is the residue of habit.', 'Reading non-negotiable. Journaling non-negotiable. Phone silenced during deep work.'],
        ['4. Wealth', '(Monthly savings) + (subtract greed & biases) ÷ (asset allocation) × (time horizon).', 'Single bank account, one house, one fund. Live below means. Avoid lifestyle inflation.'],
        ['5. Knowledge', 'The highest-ROI investment. "The best investment you can make is an investment in yourself."', 'Reads daily — annual reports, concalls, blogs, biographies, history, philosophy, science.'],
        ['6. Goodwill', 'From Pabrai & Spier. "Karma is like a big snowball."', 'Helps unconditionally. "Be a funnel, not a sponge." Replies to every reader. Mentors freely.'],
      ] },
      { k: 'note', c: C.teal, title: 'The wealth equation (Jan 2026)', lines: ['Addition (monthly savings) + Subtraction (eliminate greed & biases) + Division (right asset allocation) + Multiplication (long time horizon) = Exponential compounding power.'] },
      { k: 'h', t: 'Investment in yourself comes first' },
      { k: 'q', t: 'The best investment you can make is an investment in yourself. The more you learn, the more you’ll earn. An investment in knowledge pays the best interest.', by: 'Joys of Compounding, Ch. 1' },
      { k: 'ul', items: [
        'Reading: 9,000+ pages a year minimum (25 pages a day = The Power Broker 7× per year).',
        'Thinking: Buffett and Munger spend ~80% of every day reading or thinking.',
        'Writing: "Writing is a thinking exercise." Forces clarity; reveals self-delusion.',
        'Reflection: daily journal + quarterly review of past decisions vs outcomes.',
        'Mistakes: tuition fees. Pay them; learn; don’t repeat them.',
        'Relationships: "Associate with people better than you and you cannot help but improve."',
      ] },
      { k: 'q', t: 'Even though we desire to be loved by others, at the end of the day we experience happiness only when we are successful according to our inner scorecard. Self-esteem beats social approval. Every time.', by: 'Joys of Compounding, Ch. 10' },
      { k: 'note', c: C.violet, ol: true, title: 'Personal life principles (he repeats these in every interview)', lines: [
        'Control over your personal time > absolute level of money.',
        'Associate with and learn from people better than you.',
        'A long, healthy life is the key to compounding.',
        'Be kind, humble, empathetic; help unconditionally.',
        'Always thank God, parents, and those who helped you in hard times.',
        'Never underestimate luck.',
        'There is no alternative to hard work (his grandfather’s mantra).',
      ] },
    ] },
  { id: 'evolution', n: 3, title: 'The Investing Evolution: Return ON → Return OF Capital',
    intro: 'The single most important shift in Baid’s thinking happened during the Jan 2018 – Mar 2020 Indian small/mid-cap bear market. Before: a concentrated, statistically-cheap, micro/small-cap and cyclical investor. After: a quality-focused, prudently-diversified compounder.',
    blocks: [
      { k: 'tbl', head: ['Dimension', 'Old Gautam (pre-2018)', 'New Gautam (post-2020)'], rows: [
        ['Concentration', 'Highly concentrated in a few names', '20–25 stocks across industries and risk factors'],
        ['Hunting ground', 'Micro-caps, small-caps, cyclicals', 'Quality businesses with structural growth + 30% tactical sleeve'],
        ['Valuation lens', 'Deep value / statistically cheap', 'Reasonable valuation on a great business; willing to pay up for quality'],
        ['Primary risk metric', 'Drawdown opportunity ("how cheap can it get?")', 'Permanent loss of capital ("how do I survive?")'],
        ['Holding mindset', 'Mean reversion (12–24 months)', 'Active patience for 3–10 years on quality compounders'],
        ['Leverage / shorts / derivatives', 'Open in principle', 'Never. Long-only. No margin.'],
        ['Adding to positions', 'Average DOWN as price falls', 'Average UP only when management executes above expectations'],
        ['Macro role', 'Largely ignored', 'Liquidity, breadth, sentiment, IPO quality are explicit cycle inputs'],
        ['Core mental switch', '"Return ON capital"', '"Return OF capital before return ON capital"'],
      ] },
      { k: 'q', t: 'By the time the bear market ended, I had evolved from being a highly concentrated portfolio investor focused on statistically cheap securities, to one focused on quality and prudent diversification. Focus on return of capital before return on capital.', by: 'The Making of a Value Investor' },
      { k: 'q', t: 'However well you are prepared, and have calculated your odds, risk surfaces from places you can never imagine. Even if you are very careful in crossing the road by looking left and right, a drone might still kill you from above.', by: 'Quartr interview, Dec 2024' },
      { k: 'h', t: 'The Bandhan Bank lesson — his costliest single mistake' },
      { k: 'note', c: C.red, lines: [
        'What happened: Baid read Bandhan: The Making of a Bank and got emotionally attached to the founder’s story.',
        'The error: he failed to separate the promoter from the economics; sized up despite governance and concentration risk.',
        'The outcome: sold at 60% down from cost.',
        'The model named: "bias from over-influence of authority + liking/disliking tendency" (Munger).',
        'Coded lesson: always separate the narrative from the economics. Never invest because you admire the founder.',
      ] },
      { k: 'h', t: 'The six habits that replaced old Gautam' },
      { k: 'ol', items: [
        'Distinguish investment from speculation. Stock = business ownership, not a piece of paper.',
        'Mr. Market is your friend. "Widespread fear is your best friend; personal fear is your worst enemy."',
        'Study crowd psychology, biases, market history. Temperament > raw intellect.',
        'Working knowledge of accounting — the language of business.',
        'Focus on process, not outcome. Resist the illusion of control.',
        'Magnitude > frequency of correctness (the Babe Ruth Effect, Mauboussin).',
      ] },
    ] },
  { id: 'cycle', n: 4, title: 'The Three-Stage Market Cycle Framework',
    intro: 'Every bull and bear market in India moves through three stages. Knowing which stage you’re in tells you what behaviour to use, what stocks to look at, and what mistakes to avoid. Toggle bull/bear below.',
    blocks: [
      { k: 'comp', name: 'stages' },
      { k: 'note', c: C.cyan, title: 'Cycle cadence in modern India (~18–24 month phases)', lines: [
        'Bear: Jan 2018 → Mar 2020 (~26 months)',
        'Bull: Apr 2020 → Oct 2021 (~18 months)',
        'Bear: Nov 2021 → Mar 2023 (~17 months)',
        'Bull: Apr 2023 → Sep 2024 (~18 months)',
        'Bear: Oct 2024 → 2 Apr 2026 (~18 months)',
        'Bull: 2 Apr 2026 → likely runs ~18 months minimum (Diwali 2027 or longer, per Baid May 2026).',
      ] },
      { k: 'q', t: 'It is moving in a cycle of one and a half to two years.', by: 'Baid, on the Indian market rhythm' },
    ] },
  { id: 'bottom', n: 5, title: 'Bear-Market Bottom Checklist (10 signals)',
    intro: 'The single most operationally useful section. No one indicator works alone — they must ALL or MOSTLY tick together. Baid used these exact signals to call the 2 April 2026 bottom in real time. Tick each as it triggers.',
    blocks: [
      { k: 'comp', name: 'bottom' },
      { k: 'h', t: 'Two pre-conditions that must be met first' },
      { k: 'note', c: C.orange, title: 'Pre-condition A — "Good news stops working"', lines: ['In 2025 India delivered five positive stimuli — RBI cut 125 bps in CY2025, income up to ₹12 lakh tax-free, GST rationalization, good monsoon — yet the market kept falling.', 'When good news stops moving stocks, you are in Stage 3 of a bear. Conversely, when bad news stops hurting stocks, the bottom is forming.'] },
      { k: 'note', c: C.orange, title: 'Pre-condition B — Stage-3 bull poster boys are destroyed', lines: ['Resourceful Automobile (the Yamaha-dealership IPO, 200× over-subscribed Aug 2024) had to crash 80–90% from its peak before the bear could end.', 'OCL Hyper Retail (₹730 cr issue at ₹370 cr market cap) had to collapse too.', 'Until the previous bull’s frauds are obliterated, the bear is not done.'] },
      { k: 'h', t: 'Why each indicator matters — the logic chain' },
      { k: 'ol', items: [
        'Severity of damage: weak models and dubious promoters must be demolished before fresh capital rebuilds.',
        'FII outflow + rupee crash together: institutional money panics LAST; when FIIs finally eject (driven by currency losses), the marginal seller is exhausted.',
        'VIX > 25: fear must fully enter the system. In a bear’s Stage 1, VIX is suppressed — no one fears yet.',
        'Nifty 50 capitulation: if blue-chips haven’t capitulated, the bear isn’t done (2018–20 confirmed only when Nifty fell 30% in Mar 2020).',
        'NSE-500 above 200-DMA < 20%: breadth must be utterly broken — but this gave a false signal alone in Mar–Apr 2025, so the others must agree.',
        'Google Trends "multibagger" sub-COVID: when no one searches for the next 10-bagger, the next 10-bagger is being born.',
        'Blame-the-government tweets: a recurring crowd-psychology pattern (same as 2018–19).',
        'REITs / InvITs / dividend chatter: journalists default to defensives only when risk appetite is broken.',
        '"India is finished" narrative: classic recency-bias crescendo at the durable bottom.',
        'The Big Reversal Day: a gap-down open with most stocks down 3%+ that closes GREEN proves sellers have exhausted (2 Apr 2026 = textbook).',
      ] },
      { k: 'note', c: C.green, title: 'Practitioner instruction', lines: ['DO NOT act on any single indicator.', 'Make a 10-row scorecard; tick each as it triggers.', 'When 7–8 of 10 are green simultaneously, you are within weeks of the bottom.', 'When 9–10 of 10 are green AND a Big Reversal Day prints, the bottom is in.'] },
    ] },
  { id: 'newbull', n: 6, title: 'How a New Bull Market Begins',
    intro: 'Bear ends, new bull begins — but how it begins is counter-intuitive. The biggest bouncers are not the future winners. The winners reveal themselves quietly, through relative strength, before the bear is even officially over.',
    blocks: [
      { k: 'h', t: 'Stage 1 — the trap and the opportunity' },
      { k: 'note', c: C.red, title: 'The Stage 1 trap', lines: ['What everyone sees: the most beaten-down trash bounces 30–50% in 2–3 weeks. "My loser is recovering!"', 'The trap (math): 100 → 20 (-80%) that bounces 40% is still 28 — still down 72%. False hope.', 'The mistake: holding past losers expecting full recovery instead of rotating into new leaders.', 'April 2026 examples: Reliance Power, Jaiprakash Power, Gallantt Ispat, Elec Green Tech, scores of SME stocks. Small/midcap index up 15–16% in three weeks — but these will NOT lead Stage 2.'] },
      { k: 'note', c: C.green, title: 'The Stage 1 opportunity', lines: ['Where to look: stocks that did NOT fall hard in the terminal stage of the bear; names at/near 3- and 6-month highs while the index made lows.', 'Why they’re quiet: they didn’t fall much, so they don’t rally explosively in Stage 1 either — they rise broadly with the index (15–16%).', 'The action: rotate OUT of laggards, INTO the relative-strength names. Open their annual reports, read the last 4 concalls, dig in.', 'Their payoff: Stage 2.'] },
      { k: 'h', t: 'Stage 2 — where real wealth is made' },
      { k: 'q', t: 'Once Stage 1 gets over, the market starts becoming narrow. The market starts to differentiate and rewards strong earnings growth, good management commentary, growth visibility very handsomely. This is the longest phase of any bull market.', by: 'Baid, May 2026' },
      { k: 'note', c: C.cyan, title: 'The baton-passing pattern — 2003–2007 example', lines: ['Leaders: real estate, infrastructure, commodities, organized retail.', 'Pattern: infra runs first, rests; real estate takes the baton, rests; organized retail picks it up, rests; commodities run; and so on.', 'Implication: hold all four and you always have something running and something resting — the portfolio looks calm but rotation keeps adding alpha.'] },
      { k: 'q', t: 'You have to make friends with the word NEW. New management, new industry segment, new product vertical, new government catalyst. Rate of change is the most important thing in investing. Where will the rate of change be the maximum? Where something new is happening.', by: 'Baid' },
      { k: 'h', t: 'Stage 3 — reading the top (read in reverse to time cash-raising)' },
      { k: 'tbl', head: ['Top signal', 'What it looks like', 'Example (2024)'], rows: [
        ['Record QIP issuance', 'Insider stake sales surge in secondary markets', '₹53,000 cr (CY2023) → ₹1 lakh cr (CY2024)'],
        ['Record IPO volume', 'Country leads global IPO league table', 'India had largest IPO value globally in CY2024'],
        ['Dubious SME IPOs 100×+ subscribed', 'Zero-fundamentals businesses raising massive money', 'Resourceful Automobile (two Yamaha dealers, ₹12 cr ask, ₹2,400 cr bid = 200×)'],
        ['Stocks stop reacting to good earnings', 'Beat by 20% → stock flat or down', 'Started Oct–Nov 2024 across India'],
        ['Everything goes up together', 'Quality, junk, micro, large — all rallying at once', 'Sep–Oct 2024 manic phase'],
        ['Stage-3 poster boys', 'No business model trading at 50× sales', 'Multiple SME IPO names in 2024'],
      ] },
    ] },
  { id: 'relstrength', n: 7, title: 'Relative Strength on Red Days — The Signature Method',
    intro: 'Baid’s most actionable idea-generation tool. Master this and you have an unfair advantage at every cycle inflection.',
    blocks: [
      { k: 'q', t: 'A bull market is always going on, at all times, in some specific sectors of the stock market.', by: 'Baid, IIFL, 2022' },
      { k: 'q', t: 'During a bear market, pay very close attention to price trends in which sectors and stocks are breaking out to fresh 52-week highs. Because after every bear market, the sectoral leadership changes. So it’s very important to be very alert during those times.', by: 'Investor’s Podcast, July 2023' },
      { k: 'note', c: C.amber, title: 'The cluster concept — one stock isn’t a signal, many are', lines: ['Single stock holding up: could be noise, a takeover rumor, one operator. Don’t act.', 'MANY stocks in the SAME industry holding up: capacity utilization is turning, margins recovering, regulation shifting, demand inflecting. A real signal.', 'Why it matters: industry-wide change shows up in price BEFORE headlines, BEFORE the concall, BEFORE most analysts know. The cluster tells you where to start research.'] },
      { k: 'h', t: 'The seven-step workflow' },
      { k: 'ol', items: [
        'Start with a broad watchlist of every sector and sub-industry in India (or your market).',
        'On red days, note which stocks: (a) refuse to break down, (b) recover intraday, (c) hold above recent bases, (d) make new 3- or 6-month highs.',
        'Look for CLUSTERS — multiple stocks in the same industry showing the same resilience → flag the industry.',
        'Investigate the trigger: capacity-utilization recovery? regulatory tailwind? margin recovery? deleveraging? pricing-power inflection? cycle turn? management pivot? institutional accumulation?',
        'Open the latest annual report. Read it cover-to-cover.',
        'Read the last FOUR conference-call transcripts (not one — four). Cross-check forward guidance vs trailing operating data.',
        'Verify on Screener.in / Tijori: ROCE trend, margin trend, debt trajectory, working capital, asset turns.',
      ] },
      { k: 'q', t: 'That is the screen. But just because you see the price is not falling, you don’t just buy a stock. That is where the actual grunt work begins — open the latest annual report, the last four conference-call transcripts, the presentations, press releases, look at the track record on Screener.in or Tijori. The initial screening is easy. Then you start going deep.', by: 'Baid, Finance With Sharan, May 2026' },
      { k: 'note', c: C.green, title: 'Case study — Rajratan Global Wire (+1,200% from Apr 2020 lows)', lines: ['Setup: late 2018–early 2020, post NBFC crisis; auto deeply out of favor.', 'What Baid noticed: while peers fell, Rajratan was quietly executing a major Thailand bead-wire capacity expansion — relative strength on red days.', 'Why it worked: capex completion → throughput jump; auto cycle recovered post-COVID; earnings visibility surged; rerating multiplied gains.', 'Lesson: time arbitrage + capex completion + cyclical recovery + relative strength = multibagger. Price gave the early signal; fundamentals confirmed; patience captured the move.'] },
      { k: 'note', c: C.blue, title: 'Price as idea-generation, not a system', lines: ['Wrong: "Stock is making a new high, therefore I buy." / "Stock is making a new low, therefore I sell."', 'Right: "This cluster is making 3-month highs against a weak tape. WHY? Read the AR, 4 concalls, check Screener. If the economics confirm what the tape suggested, build a position. If not, walk away."'] },
      { k: 'note', c: C.green, title: 'Reading the tape — BOTTOM signal (end of bear)', lines: ['Sector leaders show relative strength on red days. Clusters make new 3-/6-month highs. Bad news stops being sold. The screen is hinting at the new bull’s leadership.'] },
      { k: 'note', c: C.red, title: 'Reading the tape — TOP signal (end of bull)', lines: ['Stocks stop reacting to good earnings. Bull leaders post good results but stay flat or fall. Sector leaders are exhausted. The screen is screaming the bull is over.'] },
      { k: 'q', t: 'Initially, my philosophy was restricted only to secular growth stocks at reasonable to slightly expensive valuations. But now it covers spinoffs, merger arbitrage, cyclicals, deep value, and management-change special situations. I now invest wherever I find mispricing of value and a highly favorable risk-return trade-off.', by: 'Baid, Compounding Quality, 2023' },
      { k: 'p', t: 'He explicitly cites William O’Neil (CAN SLIM) as a foundational influence. The "L" — Leader/Laggard — is at the heart of his relative-strength method.' },
    ] },
  { id: 'themes', n: 8, title: 'Theme Investing & Variant Perception',
    intro: 'Baid does not chase narratives — he chases ECONOMICS. A theme is investable only when capacity, regulation, balance sheets, or industry economics are actually changing, not when CNBC has discovered it.',
    blocks: [
      { k: 'q', t: 'Variant perception comes from having a differentiated view on the short-to-medium term trajectory of a business. It refers to situations where you get ROCE expansion along with earnings growth; that leads to valuation rerating, and you end up with multibaggers.', by: 'Baid' },
      { k: 'h', t: 'The nine variant-perception triggers (satellite, 1–3 year bets)' },
      { k: 'tbl', head: ['Trigger', 'What it means', 'Why it works'], rows: [
        ['1. Debottlenecking', 'Removing throughput limits in existing capacity', 'HIGHEST margin yield — incremental revenue at near-zero cost'],
        ['2. Brownfield expansion', 'Adding to an existing plant', 'Quicker, lower risk, lower capex than greenfield'],
        ['3. Greenfield expansion', 'Brand-new plant from scratch', 'Bigger payoff if economics line up, higher execution risk'],
        ['4. Deleveraging', 'Reducing debt', 'Interest ↓ → PAT ↑ → ROCE ↑ → market cap ↑. Compound effect'],
        ['5. Product-mix shift', 'Moving to higher-margin categories', 'Margin expansion without revenue growth'],
        ['6. Operating leverage', 'Fixed costs absorbed by revenue growth', 'Each incremental rupee of sales drops to the bottom line faster'],
        ['7. Working-capital improvement', 'Shorter inventory/receivable cycles', 'Cash conversion improves → ROCE expansion'],
        ['8. Industry-cycle shift', 'Sector turning after a long downcycle', 'Real estate post-2020 is the canonical example'],
        ['9. Regulatory tailwind', 'Codified policy creates demand or barriers', 'Ethanol blending → sugar/distilleries; defense indigenization → Indian primes'],
      ] },
      { k: 'ul', items: [
        'Bonus — Spinoffs: forced-selling dynamics; under-followed parent/child (Greenblatt’s specialty).',
        'Bonus — Management change: new CEO with a proven track record at a struggling business.',
        'Bonus — Merger arbitrage: spread between deal price and current price.',
        'Bonus — Divestiture of loss-making segment: a pure-play emerges with a rerated multiple.',
      ] },
      { k: 'note', c: C.teal, title: 'Long-term structural themes Baid likes (~70% of his portfolio)', lines: [
        'Contract manufacturing: EMS, precision engineering, China+1.',
        'Energy transition: renewables, transmission, ancillaries.',
        'Housing finance & building materials: Indian residential cycle turn from 2020.',
        'Branded discretionary consumption: premiumization across categories.',
        'Financialization of savings: demat 35M → 120M in three years; AMCs, depositories, exchanges, insurers.',
        'Digital transformation: software / IT with proven AI leverage.',
        'Data centers & ancillaries: heat exchangers, fiber-optic preforms, liquid cooling.',
        'Specialty chemicals: fluorination as a megatrend.',
        'Innovator CDMO/CRAMS: contract dev & manufacturing for Western big pharma — NOT generics.',
      ] },
      { k: 'h', t: 'The core–satellite structure' },
      { k: 'tbl', head: ['Sleeve', 'Allocation / horizon', 'What goes there'], rows: [
        ['CORE', '≈70% · 3–10+ years', 'Long-term compounders in structural themes. Monopolies/duopolies/oligopolies with strong moats, capable management, long runway. Held with active patience.'],
        ['SATELLITE', '≈30% · 1–3 years', 'Variant-perception bets using the 9 triggers. Sized smaller. Exited when the trigger plays out or the rerating happens.'],
      ] },
      { k: 'note', c: C.blue, ol: true, title: 'Real theme vs narrative — Baid’s 8-question filter', lines: [
        'Has the earnings inflection already arrived (not just been promised)?',
        'Is ROCE expansion observable in the LAST four quarters of data?',
        'Has capex commissioning shown up in concalls / asset turns?',
        'Does industry data confirm the inflection (absorption, inventory, capacity utilization)?',
        'Is the regulatory tailwind codified into law (not just lobbying noise)?',
        'Is price action confirming — clusters making 3-/6-month highs?',
        'Does it FAIL the negative-OCF + sky-high-valuation bubble test? (If it’s a bubble, AVOID.)',
        'Invert: how can I lose money here? What growth is the market already implying?',
      ] },
    ] },
  { id: 'selection', n: 9, title: 'The Stock-Selection Checklist',
    intro: 'Three layers: quantitative filters (must pass), qualitative filters (must pass with judgment), and disqualifying features (any one = instant veto). Tick the live checker — any disqualifier flips it to VETO.',
    blocks: [
      { k: 'comp', name: 'stockcheck' },
      { k: 'h', t: 'Management evaluation framework' },
      { k: 'tbl', head: ['Trait', 'What he looks for', 'What he avoids'], rows: [
        ['Integrity', 'Honest commentary in good and bad quarters', 'Promotional, hyping, deflecting CEOs'],
        ['Capital allocation', 'Explicit ROIC commentary; delays capex when ROIC < hurdle', 'Empire-builders; acquisitions for size'],
        ['Track record', 'Multi-cycle execution', 'First-time turnaround stories with no proof'],
        ['Shareholder friendliness', 'Reasonable salary, low dilution, fair related-party terms', 'Excessive comp, dilutive ESOPs, sketchy related parties'],
        ['Clarity of thought', 'Concalls that compound your understanding', 'Vague, defensive, evasive concalls'],
      ] },
      { k: 'note', c: C.violet, ol: true, title: 'The four inverted questions (ask before buying)', lines: [
        'How can I LOSE money? (not: how can I make money?)',
        'What is this stock NOT worth? (find the floor before the ceiling.)',
        'What can go WRONG? (pre-mortem before commit.)',
        'What growth rate is the MARKET ALREADY IMPLYING? (reverse-DCF the consensus, then form your own view.)',
      ] },
      { k: 'h', t: 'Value-trap categories to recognize' },
      { k: 'ul', items: [
        'Cyclical peak earnings disguising a low P/E: looks cheap, isn’t — normalize earnings first.',
        '"App risk" / tech disruption: a taxi company that looked cheap until Uber arrived.',
        'Bad capital allocators burning cash: profits consumed by terrible reinvestment.',
        'Governance risk: "give zero valuation to cash held in the books of a business run by shady promoters."',
      ] },
      { k: 'q', t: 'Remember that a man who will steal for you, will steal from you.', by: 'Thomas Phelps, quoted by Baid' },
    ] },
  { id: 'portfolio', n: 10, title: 'Portfolio Construction — The 20–25 Rule',
    intro: 'Where most investors blow themselves up. Baid’s structure is unusually rule-bound — the rules exist precisely because his pre-2018 self lost a lot of money breaking them.',
    blocks: [
      { k: 'tbl', head: ['Rule', 'Number', 'Why it exists'], rows: [
        ['Holdings count', '20–25 stocks', 'Past ~25, the volatility-reduction benefit approaches zero (Malkiel).'],
        ['Diversification axes', 'Across industries AND risk factors', 'One unknown risk should not be catastrophic.'],
        ['Initial position size', '3–5% min, never > 10% at cost', 'Big enough to matter; small enough to be wrong about.'],
        ['Industry cap', '≈30% of portfolio', 'Sector rotation in India is fast; no industry should dominate.'],
        ['Adding to a position', 'Average UP only — when management beats expectations', 'Reverses the averaging-down impulse. Pyramid into winners.'],
        ['Sleeping point', 'Trim if a position becomes mentally uncomfortable', 'Behavioral risk management. If you can’t sleep, it’s too big.'],
        ['Largest weights', 'On longevity + growth + disciplined capital allocators', 'The rare compounders deserve the most capital.'],
        ['Leverage / shorts / derivatives', 'ZERO. Never.', 'Long-only protects against ruin. Survival precedes compounding.'],
        ['Cash level', 'Bottom-up driven', '"Once I sense Stage 1 of a bear, I would not mind 20–30% cash."'],
        ['Style', 'Market-cap & sector agnostic', 'Picks where mispricing is, not where the label is.'],
      ] },
      { k: 'note', c: C.green, title: 'The cash-alpha math', lines: ['If your portfolio falls 20% in a bear and you were 30% cash going in, you effectively added 6% alpha just from being out.', 'Rotate the remaining 70% into post-bear relative-strength leaders and you compound the alpha further in Stage 1.', '"Everyone earns beta in a bull market. True alpha is generated only in a bear market."'] },
      { k: 'q', t: 'I sell down to my "sleeping point" if an individual position becomes a discomfortingly large percentage of my portfolio value.', by: 'Joys of Compounding' },
      { k: 'note', c: C.gold, title: 'The fund’s fee model (Buffett Partnership: 0/6/25)', lines: ['Management fee: 0%. First 6%: hurdle, goes to investors. Performance fee: 25% above the hurdle. High-water mark: yes. Minimum ticket: $250,000 (US accredited).', 'The exact structure Buffett ran 1956–1969. He eats only after investors make money.'] },
    ] },
  { id: 'selling', n: 11, title: 'Selling, Holding & Averaging Up',
    intro: 'Most investors are great at buying and terrible at selling. Baid’s sell discipline is unusually tight — only TWO official triggers — and he is more famous for NOT selling.',
    blocks: [
      { k: 'note', c: C.red, title: 'The two official sell triggers (Stellar Owner’s Manual)', lines: ['Trigger A: company OR industry fundamentals deteriorating sharply (terminal value impaired).', 'Trigger B: valuations no longer justified by growth prospects.', 'Otherwise: hold. Through corrections, through media noise, through your own boredom.'] },
      { k: 'h', t: 'The practical four-test sell check' },
      { k: 'ol', items: [
        'Is the business going downhill with NO turnaround in sight?',
        'Has management shown a LACK of integrity?',
        'Have I found a MUCH more profitable alternative?',
        'Has the position grown beyond my sleeping point? (Trim, don’t exit.)',
      ] },
      { k: 'note', c: C.amber, title: 'The Page Industries lesson — selling too early', lines: ['Bought May 2014 at ~₹6,000. Sold one month later at ~₹6,000 (flat, anxious to move on). Stock went above ₹45,000.', 'Coded: quality compounders go SIDEWAYS for a year or two after a sharp rally as earnings catch up. Selling because they’re "expensive" loses you the next decade.'] },
      { k: 'note', c: C.teal, title: 'The right sell question', lines: ['Don’t ask "has the P/E gone up?" Ask "has the terminal value been disrupted?"', 'As long as growth, moat, management and capital allocation are sound, exceptional patience is right. Quality stocks rally → time-correct sideways for years → break out again as earnings catch up. Don’t sell during the time-correction.'] },
      { k: 'q', t: 'A long-term investment horizon must be married with an investment process that is willing to continually question the core investment thesis.', by: 'Baid' },
      { k: 'ul', items: [
        'Each quarter re-test — Competitive position: has the moat been challenged? by whom? with what?',
        'Capital allocation: still earning above-hurdle returns on incremental capital?',
        'Management behavior: still acting like owners, or starting to cash out?',
        'Terminal value: any tech/regulation/shift threatening long-term cash flows?',
        'Reverse-DCF: what growth rate is the current price now implying?',
      ] },
      { k: 'note', c: C.gold, title: 'The 4% power law — why holding winners matters', lines: ['1926–2018 US market: only 4% of all listed equities accounted for 100% of the wealth creation.', 'India 1990–2018: only 1% of listed equities accounted for 90% of wealth creation.', 'Stellar Fund’s first 12 months: 4 of 23 stocks drove >80% of the return.', '"Once you have found the goose that lays the golden eggs, don’t kill the goose. Hold on to it for dear life."'] },
      { k: 'q', t: 'I initiate new positions with a minimum weighting of 3 to 5 percent and subsequently average upward if the management executes above my expectations.', by: 'Baid' },
      { k: 'p', t: 'The O’Neil influence: pyramid into winners, not losers. Adding to a falling stock is doubling your conviction in someone else’s lie; adding to a rising one is paying for proof of execution.' },
    ] },
  { id: 'averagedown', n: 12, title: 'When NEVER to Average Down',
    intro: 'Averaging down is a quality investor’s superpower or a disaster — the difference is the kind of business you add to. Baid will add to high-quality structural compounders in temporary weakness, but is strictly closed to four archetypes.',
    blocks: [
      { k: 'tbl', head: ['Archetype', 'Why averaging down destroys you', 'Examples'], rows: [
        ['1. Leveraged models (banks, NBFCs)', 'Balance-sheet leverage means small NPL changes wipe out equity. A 20% fall can be the market correctly pricing solvency risk.', 'DHFL, Yes Bank, IL&FS (2018–19 NBFC crisis)'],
        ['2. Operationally leveraged / cyclicals / commodities', 'Peak-cycle earnings look cheap; as the cycle turns, earnings collapse faster than price.', 'Steel, sugar, cement, base metals at cycle peaks'],
        ['3. Tech obsolescence / app-risk', 'Once the moat is gone, no price is cheap. Terminal value collapses.', 'Taxi after Uber; print vs digital; brick-and-mortar vs e-commerce'],
        ['4. Fraud / leveraged fraud', '"Crooks don’t suddenly sprout a sense of fiduciary duty." Cash on the books is worth zero. Integrity is binary.', 'Various promoter-fraud cases in Indian mid/small-caps'],
      ] },
      { k: 'note', c: C.green, ol: true, title: 'When YES to averaging down — all three must be true', lines: [
        'Underlying business is a structural growth compounder (core sleeve, not satellite).',
        'Fundamentals are improving — concalls, asset turns, ROCE all trending right.',
        'The correction is for non-fundamental reasons (market panic, sector sell-off, macro fear) — and it would not breach industry / position-size limits.',
      ] },
      { k: 'q', t: 'Average up into winners, not down into losers.', by: 'Baid (default mode)' },
      { k: 'p', t: 'The philosophical core: most investors think risk = volatility. Baid thinks risk = quality of the underlying business × leverage. A 50% decline in a fortress balance sheet is a gift; a 50% decline in a leveraged cyclical fraud is the start of a 90% decline.' },
    ] },
  { id: 'os', n: 13, title: 'The Daily Operating System',
    intro: 'Knowing the rules and living them are different things. The daily routine is the conveyor belt that turns knowledge into compounding. Copy the routine before you try to copy the returns.',
    blocks: [
      { k: 'note', c: C.amber, title: 'Before starting the day (morning journal)', lines: ['Write 3 things you’re grateful for.', 'Write 3 things that will make today great.', 'Write 3 positive affirmations.'] },
      { k: 'note', c: C.violet, title: 'Before sleeping (evening journal)', lines: ['Write 3 highlights of the day.', 'Write 3 lessons learned today.'] },
      { k: 'q', t: 'Trust me, when you do this every single day, for many years, over thousands of days, you can actually reflect. Go back to these writings, and you realize just how far you’ve come along in your life.', by: 'Baid, Arigato Investor, April 2024' },
      { k: 'h', t: 'The workday structure' },
      { k: 'tbl', head: ['Time', 'Activity', 'Purpose'], rows: [
        ['Pre-8 AM', 'Morning ritual (journal, exercise, breakfast)', 'Set state. Health pillar. Calm mind.'],
        ['8 AM – 6 PM', 'Office: newspapers, SEC filings, concall transcripts, periodicals, trade pubs, investing blogs; periodic IC meetings.', 'Pure deep work. No social media. No news-cycle drama.'],
        ['6 PM – 7 PM', 'Early supper', 'Health pillar. Light meal.'],
        ['7 PM – 12 AM', 'Books; carefully selected films (Marvel, sci-fi); calls with family, friends, peers; magic shows when time permits.', 'Knowledge + relationships + recovery.'],
      ] },
      { k: 'note', c: C.cyan, title: 'The investment journal (separate from the life journal) — record for every buy & sell', lines: ['Original thesis at purchase; rationale for sale.', 'Valuation assumptions (DCF, multiple, scenario).', 'Risk factors / what could go wrong (pre-mortem).', 'Catalyst & triggers relied on; position-sizing rationale.', 'Your emotional state and any behavioral biases you noticed in yourself.', 'Market commentary during the panic/euphoria you bought/sold into (for later pattern recognition).'] },
      { k: 'q', t: 'Outcomes distort our thinking a lot. Unless we are intellectually honest, we will take the wrong lessons from favorable outcomes. We may be right a lot of the time, but for the wrong reasons. This self-realization can be very humbling.', by: 'Baid' },
      { k: 'note', c: C.green, title: 'The quarterly journal review — "was the reasoning right?", not "did it work?"', lines: ['Right for right reasons → repeat the process.', 'Wrong for right reasons → repeat the process; the result was variance.', 'Right for WRONG reasons → most dangerous; you’ll repeat it without knowing why.', 'Wrong for wrong reasons → identify the bias, update the checklist.'] },
      { k: 'note', c: C.red, title: 'Health stack (the often-ignored pillar)', lines: ['Less sugar, less junk food.', 'Exercise 3–4×/week, ~1 hour each.', '7–8 hours of sleep daily.', 'No alcohol abuse, no late nights.', '"A long, healthy life is the key to compounding. Jhunjhunwala had the best CAGR but died young because his health was not good."'] },
      { k: 'p', t: 'Personal-finance simplicity: single investment account, one house, one bank account. The life is decluttered so the few things that matter — reading, thinking, journaling, family, health — get the attention.' },
    ] },
  { id: 'heroes', n: 14, title: 'Mental Heroes — Who Shaped Him',
    intro: 'Baid is a "funnel, not a sponge." His ideas are a synthesis. Knowing which idea came from where lets you go to the source to deepen understanding.',
    blocks: [
      { k: 'kv', title: 'The pantheon — investor influences', rows: [
        ['Warren Buffett', 'Business-ownership mindset. Inner scorecard. Circle of competence. Read 500 pages a day. "Does less" — intense focus. The 0/6/25 fee structure Stellar copies.'],
        ['Charlie Munger', 'Latticework of mental models. Inversion. Multidisciplinary thinking. Opportunity-cost hurdle rates. "More important than the will to win is the will to prepare." Intellectual humility.'],
        ['Benjamin Graham', 'Mr. Market parable. Margin of safety. Investment vs speculation.'],
        ['Phil Fisher', 'Scuttlebutt. Long-runway quality growth. Holding for decades — the philosophy Baid pivoted to post-2018.'],
        ['Peter Lynch', '"It isn’t the head but the stomach that determines your fate." Time in market > timing. Skepticism of macro forecasting.'],
        ['Joel Greenblatt', 'Special situations, spinoffs. "Investing success has more to do with the big picture, not spreadsheets."'],
        ['William O’Neil', 'Pyramid into winners (average UP). The "L" in CAN SLIM — Leader/Laggard relative strength. Breakouts to 52-week highs.'],
        ['Sanjay Bakshi', 'Quality compounders persistently undervalued (Oct 2013 white paper). Hyperbolic discounting. Justified high multiples on real quality.'],
        ['Howard Marks', 'Risk = permanent loss of purchasing power. Consequences > probabilities. Second-level thinking. Cycles.'],
        ['Stanley Druckenmiller', 'Liquidity moves markets — central banks, currency, fiscal stimulus. Concentrated conviction when right.'],
        ['Nick Sleep', 'Scale economies shared. Destination thinking. Holding rare compounders very long.'],
        ['Michael Mauboussin', 'Magnitude > frequency (Babe Ruth Effect). Base rates / outside view. Ten attributes of great investors.'],
        ['Mohnish Pabrai + Guy Spier', 'Goodwill compounding. "Karma is like a big snowball." Frugality + patience + decisive action.'],
        ['Peter Bevelin', 'Inversion. Multidisciplinary thinking. Seeking Wisdom.'],
        ['Kahneman / Thaler / Cialdini', 'Minimize behavioral biases. Two systems of thinking. Crowd influence.'],
        ['John Maynard Keynes', 'Temperament > IQ. Concentrated quality investing in his King’s College portfolio.'],
        ['Thomas Phelps', '100 to 1 in the Stock Market. "A man who will steal for you, will steal from you."'],
        ['Edward Chancellor / Marathon', 'Capital-cycle framework — supply matters more than demand. Used for commodities/cyclicals.'],
        ['Utpal Sheth (Rare Enterprises)', 'His personal mentor. "Remain invested in good businesses for a long period — simple but not easy."'],
      ] },
      { k: 'note', c: C.violet, title: 'Behavioral pantheon — required reading', lines: ['Kahneman — Thinking, Fast and Slow.', 'Thaler — Misbehaving / Nudge.', 'Cialdini — Influence.', 'Annie Duke — Thinking in Bets.', 'Taleb — Antifragile / Fooled by Randomness.', 'Morgan Housel — The Psychology of Money.'] },
    ] },
  { id: 'reading', n: 15, title: 'The Reading List',
    intro: 'Reading is the single highest-ROI investment of his life. The graveyard-shift hotel years (2015–16) — a cheap chair, a library card, limitless curiosity — are the origin story of every framework here.',
    blocks: [
      { k: 'note', c: C.gold, ol: true, title: 'Desert-island top three', lines: ['Poor Charlie’s Almanack — Peter Kaufman.', 'Seeking Wisdom — Peter Bevelin (finest book on multidisciplinary thinking).', 'All I Want To Know Is Where I’m Going To Die So I’ll Never Go There — Peter Bevelin (best on inversion).', 'Plus printed copies of the Buffett Partnership letters + Berkshire annual letters + Owner’s Manual.'] },
      { k: 'h', t: 'The 3 + 3 recommendation (Compounding Quality, 2023)' },
      { k: 'ul', items: ['Investing — Investing for Growth (Terry Smith), Capital Returns (Edward Chancellor), You Can Be a Stock Market Genius (Joel Greenblatt).', 'Non-investing — Seeking Wisdom (Bevelin), Poor Charlie’s Almanack (Kaufman), More Than You Know (Mauboussin).'] },
      { k: 'kv', title: 'The full categorized reading list (Mauboussin’s ten attributes mapped)', rows: [
        ['Accounting & numeracy', 'How to Read a Financial Report (Tracy); Accounting for Value (Penman); Financial Shenanigans (Schilit); Quality of Earnings (O’glove); The End of Accounting (Lev)'],
        ['Valuation', 'Creating Shareholder Value (Rappaport); Valuation (McKinsey); Expectations Investing (Rappaport & Mauboussin)'],
        ['Strategy & moats', 'Business Model Generation (Osterwalder & Pigneur); Competitive Strategy (Porter); Understanding Michael Porter (Magretta); The Little Book That Builds Wealth (Dorsey); Different (Moon)'],
        ['Probability & decision-making', 'The Drunkard’s Walk (Mlodinow); Innumeracy (Paulos); Thinking in Bets (Duke); Superforecasting (Tetlock); The Thinker’s Toolkit (Jones); The Art of Thinking (Dimnet)'],
        ['Behavioral biases', 'Thinking, Fast and Slow (Kahneman); The Art of Thinking Clearly (Dobelli); Your Money and Your Brain (Zweig); Why Smart People Make Big Money Mistakes (Belsky & Gilovich)'],
        ['Crowds, influence & manias', 'The Crowd (Le Bon); The Art of Contrary Thinking (Neill); Influence (Cialdini); Extraordinary Popular Delusions (Mackay); A Short History of Financial Euphoria (Galbraith)'],
        ['Position sizing', 'The Warren Buffett Portfolio (Hagstrom); Fortune’s Formula (Poundstone)'],
        ['Culture & intelligent fanatics', 'A Bank for the Buck (Bandyopadhyay); Intelligent Fanatics Project + Intelligent Fanatics of India (Iddings & Cassel); Investing Between the Lines (Rittenhouse)'],
        ['Multidisciplinary wisdom', 'Investing: The Last Liberal Art (Hagstrom); A Few Lessons from Sherlock Holmes (Bevelin); Stalking the Black Swan (Posner)'],
        ['Patience & dhandho', 'The Dhandho Investor (Pabrai)'],
        ['Checklists', 'The Checklist Manifesto (Gawande); The Investment Checklist (Shearn)'],
        ['Reading itself', 'How to Read a Book (Adler & Van Doren)'],
        ['Bevelin trilogy', 'Seeking Wisdom; All I Want To Know Is Where I’m Going To Die; A Few Lessons from Sherlock Holmes'],
      ] },
      { k: 'note', c: C.cyan, title: 'What Baid reads every season', lines: ['Annual reports: all portfolio companies + their listed peers.', 'Concalls: last 4 transcripts for any new idea; quarterly for existing holdings.', 'Letters: Buffett Partnership + Berkshire annual letters + Owner’s Manual (he prints them).', 'Blogs: Bakshi’s Fundoo Professor; Safal Niveshak; Base Hit Investing; Microcap Club.', 'Bakshi’s Oct 2013 white paper "The Mispricing of Quality" — foundational on why quality compounders stay undervalued.'] },
    ] },
  { id: 'quotes', n: 16, title: 'Quote Bank (verbatim)',
    intro: 'Print this section. Stick it on a wall.',
    blocks: [
      { k: 'h', t: 'On compounding & self-investment' },
      { k: 'q', t: 'The best investment you can make is an investment in yourself. The more you learn, the more you’ll earn. An investment in knowledge pays the best interest.', by: 'Joys of Compounding, Ch. 1' },
      { k: 'q', t: 'Today, I am a better investor because I am a lifelong learner, and I am a better lifelong learner because I am an investor.', by: 'Joys of Compounding' },
      { k: 'q', t: 'As investors, our job is simply to compound capital over time at the highest possible rate with the minimum amount of risk.', by: 'Baid' },
      { k: 'h', t: 'On behavior & edge' },
      { k: 'q', t: 'Fifty years ago, the best investors were the ones with an informational edge. Today, the best investors are the ones with a behavioral edge.', by: 'Quartr, 2024' },
      { k: 'q', t: 'Investing is not about being right all the time; it is about being patient and disciplined.', by: 'Baid' },
      { k: 'q', t: 'Most investors would perform better if they thought more and did less. One of the best hacks in the investment field is learning to be happy doing nothing.', by: 'Joys of Compounding' },
      { k: 'q', t: 'It is "time in the market" and not timing the market that drives wealth creation.', by: 'Baid' },
      { k: 'q', t: 'The two most stupid investing mistakes are panic buying in a bull market and panic selling in a bear market.', by: 'Compounding Quality' },
      { k: 'q', t: 'It isn’t the head but the stomach that will determine your fate.', by: 'Peter Lynch, quoted by Baid' },
      { k: 'h', t: 'On quality, risk & survival' },
      { k: 'q', t: 'Return of capital before return on capital.', by: 'The Making of a Value Investor' },
      { k: 'q', t: 'If you focus on preventing the downside, the upside takes care of itself.', by: 'Baid' },
      { k: 'q', t: 'Make sure that you hold tennis balls (quality stocks) and not eggs (junk stocks) when you’re in the middle of a storm.', by: 'Compounding Quality' },
      { k: 'q', t: 'The only protection against unknown unknowns is diversification.', by: 'Compounding Quality' },
      { k: 'q', t: 'Crooks don’t suddenly sprout a sense of fiduciary duty.', by: 'Baid' },
      { k: 'q', t: 'However well you are prepared, and have calculated your odds, risk surfaces from places you can never imagine. Even if you are very careful in crossing the road by looking left and right, a drone might still kill you from above.', by: 'Quartr' },
      { k: 'q', t: 'Remember that a man who will steal for you, will steal from you.', by: 'Thomas Phelps, quoted by Baid' },
      { k: 'h', t: 'On cycles & market psychology' },
      { k: 'q', t: 'Widespread fear is your best friend as an investor; personal fear is your worst enemy.', by: 'Joys of Compounding' },
      { k: 'q', t: 'In a bear market, good news is sold into. In a bull market, bad news is bought into.', by: 'Baid' },
      { k: 'q', t: 'Markets do not react negatively to the same bad news twice.', by: 'Baid' },
      { k: 'q', t: 'The final leg of selling in a bear market is always the most painful. Most investors lose hope and sell in panic during this stage as there is bad news everywhere with no resolution in sight.', by: 'X / Twitter, April 2026' },
      { k: 'q', t: 'Stocks can stay cheap for longer than we expect and then may be repriced much more quickly than we expect.', by: 'IIFL, 2022' },
      { k: 'q', t: 'Never let a good bear market go to waste.', by: 'The Making of a Value Investor' },
      { k: 'q', t: 'If underperforming broader markets and peers for certain interim intervals is the price of admission to exemplary long-term performance, we won’t mind paying it.', by: 'Stellar Wealth Owner’s Manual' },
      { k: 'h', t: 'On process & decision-making' },
      { k: 'q', t: 'The aim of an argument, or of a discussion, should not be victory, but progress.', by: 'Joys of Compounding' },
      { k: 'q', t: 'A great investment idea doesn’t need hours to analyze. More often than not, it is love at first sight.', by: 'Joys of Compounding' },
      { k: 'q', t: 'The frequency of correctness does not matter; it is the magnitude of correctness that matters.', by: 'Joys of Compounding (after Mauboussin)' },
      { k: 'q', t: 'Invert, always invert: instead of looking for success, make a list of how to fail — through sloth, envy, resentment, self-pity, entitlement. Avoid these and you will succeed.', by: 'Charlie Munger via Baid' },
      { k: 'q', t: 'Knowing the limits of your knowledge is the dawning of wisdom.', by: 'Joys of Compounding' },
      { k: 'q', t: 'Ego = 1 / Knowledge. More the knowledge, lesser the ego. Lesser the knowledge, more the ego.', by: 'Einstein, championed by Baid' },
      { k: 'q', t: 'The best cure for overconfidence in your beliefs is to constantly remind yourself that you have experienced less than a tiny fraction of a percent of what has happened in the world.', by: 'Baid' },
      { k: 'h', t: 'On character & life' },
      { k: 'q', t: 'Each of us forever remains a work in progress — always evolving, ever changing. We’re all rough drafts of the person we’re still becoming.', by: 'Joys of Compounding' },
      { k: 'q', t: 'Self-esteem beats social approval. Every time.', by: 'Joys of Compounding, Ch. 10' },
      { k: 'q', t: 'Control over your personal time is much more valuable than high absolute levels of money.', by: 'Quartr' },
      { k: 'q', t: 'In life, the winners also lose occasionally, but those who help others win can never lose.', by: 'Quartr' },
      { k: 'q', t: 'Be a funnel, not a sponge.', by: 'Baid' },
      { k: 'q', t: 'Karma is like a big snowball.', by: 'Baid (after Pabrai / Spier)' },
      { k: 'q', t: 'Only free people can be honest. Only honest people can be free.', by: 'Joys of Compounding' },
      { k: 'q', t: 'There is no alternative to hard work.', by: 'His maternal grandfather' },
      { k: 'q', t: 'Simplicity is the end result of long, hard work, not the starting point.', by: 'Joys of Compounding' },
      { k: 'q', t: 'Be passionate about the business but dispassionate about the stock.', by: 'Joys of Compounding, Ch. 12' },
    ] },
  { id: 'stocks', n: 17, title: 'Specific Stocks & Themes He Has Discussed',
    intro: 'Baid is selective about naming positions publicly. This is the most complete public record — disclosed holdings, case studies he has narrated, and the themes he has flagged for the new bull.',
    blocks: [
      { k: 'tbl', head: ['Stock', 'Disclosure / date', 'Stake', 'Fit'], rows: [
        ['Macpower CNC Machines', 'Q1 2026 shareholder filing (Mar 31, 2026)', '≈1.01% (1,01,149 sh)', 'Brownfield/greenfield capex (Vibrant Gujarat 2024 MoU, ~₹100 cr aerospace/defense plant). Margin upgrade ~15–16% → 22–25%. Precision-engineering capex super-cycle.'],
        ['Sakar Healthcare', 'NSE bulk deal (May 15, 2026)', '≈0.88% (1,95,000 sh @ ₹664.58)', 'Q4 FY26 PAT +91.3%, sales +41.5%. Inflection. Healthcare/pharma.'],
      ] },
      { k: 'note', c: C.dim, title: 'Why disclosure is limited', lines: ['The fund is a Delaware LP investing in listed Indian equities only — US-style 13F filings don’t apply.', 'Indian disclosure shows only through shareholder filings above thresholds and bulk/block-deal reports.', 'His smallcase / PMS holdings are visible only to subscribers.'] },
      { k: 'h', t: 'Case studies he has narrated' },
      { k: 'note', c: C.green, title: 'Rajratan Global Wire — the canonical multibagger (+1,200%)', lines: ['Setup: late 2018–early 2020 post NBFC crisis; auto deeply out of favor; Rajratan quietly executing a major Thailand bead-wire expansion.', 'Signal: held up while peers fell — relative strength.', 'Catalyst: capex completion + auto-cycle recovery + earnings visibility surge.', 'Frameworks: relative strength + capex completion + cyclical recovery + variant perception.'] },
      { k: 'note', c: C.teal, title: 'Kilpest India / 3B Blackbio — the deep-value find', lines: ['Kilpest owns 97% of 3B Blackbio, a fast-growing, highly profitable molecular-diagnostics business.', 'Variant perception: for < ₹25 cr (~$4M) market cap you got part-ownership of a business with 100%+ ROCE and 20%+ net margins.', '"As Bezos said: a dreamy business has at least four characteristics. When you find one, don’t just swipe right — get married."'] },
      { k: 'note', c: C.amber, title: 'Page Industries — the regretted early sale', lines: ['Bought May 2014 ~₹6,000; sold a month later ~₹6,000 (flat). Stock went above ₹45,000.', 'Coded: quality compounders go sideways for years as earnings catch up. Selling on "looks expensive" loses the next 10× run.'] },
      { k: 'note', c: C.red, title: 'Bandhan Bank — the liking-bias loss', lines: ['Read Tamal Bandyopadhyay’s book, got attached to the founder narrative.', 'Failed to separate promoter from economics; ignored leverage and concentration risk. Sold at -60%.', '"You have to separate the promoter from the economics of the business." Liking + authority bias = Munger’s most dangerous combination.'] },
      { k: 'h', t: 'Quality / culture exemplars he has named' },
      { k: 'ul', items: ['Berkshire Hathaway — decentralized trust + capital-allocation discipline.', 'Amazon — "Day 1" culture, customer obsession.', 'Costco — scale economies shared (Nick Sleep’s destination business).', 'Piramal Enterprises — capital allocation through cycles.', 'HDFC Bank — Aditya Puri-era culture as the moat (A Bank for the Buck).'] },
      { k: 'h', t: 'Themes he likes for the new bull (April 2026 onward)' },
      { k: 'tbl', head: ['Theme', 'Thesis', 'What to look for'], rows: [
        ['Precision-engineering exports', 'Indian auto-ancillary firms pivoting into defense/aerospace as Tier-1/2 suppliers to Airbus & Boeing.', 'Aerospace/defense contracts; new capacity coming on stream; margin shift > 20%.'],
        ['Innovator CDMO / CRAMS', 'AI compresses drug discovery; India has chemists; USFDA/EU-compliant capacity is the bottleneck. NOT generics.', 'USFDA/EU-compliant facilities; long-term contracts with Western big pharma; NOT commodity APIs.'],
        ['Power ancillaries', 'Biggest AI bottleneck globally is POWER — watch the components.', 'Transformers, bushings, GIS, HVDC; backward-integrated players; long order books.'],
        ['Data-center ancillaries', 'Heat exchangers, liquid cooling, fiber optics — especially preform-backward-integrated.', 'Preform capability; OEM relationships; export potential.'],
        ['AI-leverage IT (mid/small)', 'Firms showing 20%+ revenue growth on 1–2% headcount growth — they’ve actually implemented AI.', 'Revenue-per-employee trajectory; gross-margin trajectory; AI-led service lines.'],
        ['Fluorination chemistry', 'Megatrend in specialty chemicals; high regulatory barriers; long-term contracts.', 'USFDA/EU-compliant capacity; backward integration; multi-year contracts.'],
      ] },
      { k: 'note', c: C.red, title: 'Themes he is avoiding (where the relative strength has left)', lines: ['Legacy IT services (TCS, Infosys, HCL): TCS posted first negative YoY constant-currency $ growth in 22 years in Q4 FY26. AI is now a headwind for headcount-heavy models.', 'Most financials at current valuations: government liquidity focus shifted from capex to consumption (tax/GST cuts).', 'Auto OEMs: prefers ancillaries pivoting into defense/aerospace.', 'E-commerce / quick-commerce (Zomato, Swiggy, Blinkit, Urban Company): capital cycle deteriorating as Amazon/Flipkart enter.', 'Government-capex theme (solar, renewables, smart meters, railways, defense PSUs): even with good earnings, valuation re-rates DOWN as policy focus shifts to consumption.', 'Silver: extreme volatility; flagged euphoric Jan 2026.', 'Mid/small-cap froth (Nov 2023 warning): said overheated; "there is value in large caps."'] },
      { k: 'h', t: 'Historical bull-market leaders cited' },
      { k: 'ul', items: ['2003–2007 (India): real estate, infrastructure, commodities, organized retail.', '2009–2013 (during a bear): IT services, consumer discretionary, pharmaceuticals.', 'Apr 2020 – Sep 2024 (capex super-cycle): solar, renewables, smart meters, railways, defense, PSUs.'] },
    ] },
  { id: 'mistakes', n: 18, title: 'Mistakes & War Stories',
    intro: 'Baid is unusually transparent about losses — he treats every mistake as tuition. The complete public list of his self-disclosed errors:',
    blocks: [
      { k: 'tbl', head: ['Mistake', 'Cause', 'Loss', 'Lesson coded'], rows: [
        ['Reliance Power Sector MF (late 2007)', 'Chasing late-cycle euphoria. Recency + greed.', '70–80%', 'Never buy what’s hot at the peak.'],
        ['Ispat Steel (Jan 2008)', 'Chasing a late-cycle steel peak.', '70–80%', 'Cyclicals at peak P/E are NOT cheap. Normalize earnings first.'],
        ['Page Industries (May 2014)', 'Sold a fresh buy flat in a bull market; anxious to move on.', 'Lost 7×+ subsequent gain', 'Quality compounders time-correct sideways. Don’t sell because "P/E went up."'],
        ['Bandhan Bank (post-2018)', 'Read the book; fell for the founder narrative. Liking + authority bias.', '60%', 'Separate the promoter from the economics. Always.'],
        ['Pre-2018 concentration', '~20% in cyclicals/microcaps/smallcaps. No diversification.', 'Heavy 2018–20 drawdown', '20–25 stocks across industries and risk factors. Always.'],
        ['Pre-2018 deep-value orientation', 'Buying low-quality at cheap multiples.', 'Persistent underperformance', 'Quality at fair valuation > junk at cheap. Higher stress-adjusted returns.'],
      ] },
      { k: 'note', c: C.violet, title: 'Munger’s psychology of misjudgment — Baid’s own hit list', lines: ['Bias from over-influence of authority (the Bandhan founder).', 'Anchoring (on cost basis).', 'Liking/disliking tendency (Bandhan again).', 'Stress-influence tendency (panic-selling in bears).', 'Cognitive dissonance (refusing to update on new info).', 'Loss aversion (holding losers too long).'] },
      { k: 'q', t: 'Going forward, I wouldn’t invest as much in cyclicals, commodities, and microcaps anymore. Furthermore, I wouldn’t concentrate my portfolio to only one or a few sectors.', by: 'Baid, Compounding Quality' },
      { k: 'q', t: 'Nothing seems to be working in this market. Maybe I am really just an average investor at best. Maybe I just got lucky in the past. Maybe this is the bear market talking inside me. I am not sure.', by: 'Baid’s journal during the 2018–20 bear' },
      { k: 'p', t: 'He survived this period because he had a network of senior investors who had seen multiple cycles. He dedicated The Making of a Value Investor to them. The lesson: build a network of people who have been through real bears — their moral support is the difference between giving up and getting through.' },
    ] },
  { id: 'plan', n: 19, title: 'The 30-Day Plan to Start Living This Playbook',
    intro: 'Reading this changes nothing unless you start. A concrete 30-day plan to begin operating like Baid — starting today. Tick each day as you do it.',
    blocks: [
      { k: 'comp', name: 'plan' },
      { k: 'note', c: C.teal, title: 'The permanent routine (after day 30)', lines: ['Every morning: 3-3-3 journal. Every evening: 3-3 reflection.', 'Every red day: scan for relative strength; note clusters.', 'Every new buy: run the 8-feature checklist + 4 inverted questions.', 'Every quarter: revisit journal entries; audit thesis vs outcome.', 'Every annual-report season: read your holdings AND their peers.', 'Every year: re-read Poor Charlie’s Almanack + the Buffett letters.', 'Every cycle: refresh the 10-point bottom checklist; score the market.'] },
      { k: 'note', c: C.gold, title: 'The compounding promise', lines: ['Do this for one year and your decisions will already be measurably better.', 'Do this for five years and you will be in the top decile of investors.', 'Do this for fifteen years and the laws of compounding will do the rest.', 'There is no shortcut. There never was. There never will be.'] },
    ] },
  { id: 'sources', n: 20, title: 'Sources & Where to Go Deeper',
    blocks: [
      { k: 'h', t: 'Books' },
      { k: 'ul', items: ['The Joys of Compounding — Gautam Baid (Columbia University Press, 2020 revised ed.)', 'The Making of a Value Investor — Gautam Baid (HarperCollins India, Oct 2023)'] },
      { k: 'h', t: 'Most important long-form interviews' },
      { k: 'ul', items: [
        'Quartr — "Lessons from Gautam Baid: Mastering Simplicity and Compounding" (Dec 2024) — richest written source.',
        'Finance With Sharan (FWS116) — "India’s New Bull Market" (May 2026) — most detailed framework exposition.',
        'The N Show with Neeraj Bajpai — "New Bull Market Started?" (Apr 2026).',
        'Konversation with Kushal Lodha #327 — "The 3 Stages of Every Market Crash" (May 2026).',
        'Talking Billions Ep. 77 — "What a Bear Market Taught Me About Investing" (Apr 2024).',
        'Talking Billions — "Building Wealth, Health, and Wisdom" (Jan 2026) — six-pillar framework.',
        'Excess Returns — "4% of Stocks. 100% of Wealth" (Jan 2026).',
        'The Investor’s Podcast TIP583 — "Preparing for the Bear Market to Come" (Oct 2023).',
        'Compounding Quality — interview with Pieter Slegers (Oct 2023).',
        'Guy Spier — The Education of a Value Investor podcast (Sep 2021).',
        'Arigato Investor with Chloe Lin (Apr 2024) — source of the morning routine.',
        'IndiaInfoline Leaders Speak (Jun 2022) — Rajratan case study.',
        'Acquirer’s Multiple — "The 4% Rule" (Oct 2023) & "Slugging Percentage" (Jan 2022).',
      ] },
      { k: 'ul', items: ['X / Twitter: @Gautam__Baid', 'LinkedIn: gautam-baid-cfa', 'Fund: stellarwealthindia.com', 'Smallcase: stellarwealth.smallcase.com'] },
      { k: 'q', t: 'Each of us forever remains a work in progress — always evolving, ever changing. We’re all rough drafts of the person we’re still becoming.', by: 'Joys of Compounding' },
      { k: 'p', t: 'Use this playbook. Add to it. Argue with it. Test it against your own experience. Baid himself would not want you to copy him blindly — he would want you to become the most thoughtful version of yourself. Start where you are. Compound from there.' },
    ] },
];

const GROUPS: Group[] = [
  { label: 'Who & philosophy', color: C.violet, parts: ['who', 'pillars', 'evolution'] },
  { label: 'Market cycles (operational)', color: C.green, parts: ['cycle', 'bottom', 'newbull', 'relstrength', 'themes'] },
  { label: 'Selection & portfolio', color: C.cyan, parts: ['selection', 'portfolio', 'selling', 'averagedown'] },
  { label: 'Operating system', color: C.amber, parts: ['os'] },
  { label: 'Influences & learning', color: C.blue, parts: ['heroes', 'reading', 'quotes'] },
  { label: 'Record & action', color: C.orange, parts: ['stocks', 'mistakes', 'plan', 'sources'] },
];

export default function GautamBaidPlaybookPage() {
  const [active, setActive] = useState<string>('who');
  useEffect(() => { try { const v = localStorage.getItem(LS.read); if (v && PARTS.some((p) => p.id === v)) setActive(v); } catch {} }, []);
  const go = (id: string) => { setActive(id); save(LS.read, id); try { document.getElementById('baid-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} };
  const idx = Math.max(0, PARTS.findIndex((p) => p.id === active));
  const part = PARTS[idx];
  const wrap = { maxWidth: 1680, margin: '0 auto', padding: '0 22px' } as const;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}f0`, borderBottom: `1px solid ${C.line}`, backdropFilter: 'blur(8px)' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 22px' }}>
          <Link href="/" style={{ fontSize: F.sm, color: C.muted, textDecoration: 'none', fontWeight: 700 }}>← Home</Link>
          <span style={{ fontSize: F.md, fontWeight: 900, color: C.gold, letterSpacing: 0.5 }}>📖 THE GAUTAM BAID PLAYBOOK</span>
          <span style={{ marginLeft: 'auto', fontSize: F.sm, color: C.muted }}>Part {part.n} / 20</span>
        </div>
      </div>

      <div id="baid-top" style={{ borderBottom: `1px solid ${C.line}`, background: `radial-gradient(900px 240px at 12% -40%, ${C.gold}14, transparent), radial-gradient(700px 220px at 90% -60%, ${C.violet}10, transparent)` }}>
        <div style={{ ...wrap, padding: '26px 22px 22px' }}>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.gold, letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: 2 }}>How to think, read markets & compound like one of India’s most disciplined value investors</div>
          <div style={{ marginTop: 12, fontSize: F.sm, color: C.muted, lineHeight: 1.6, maxWidth: 980 }}>
            Read it cover-to-cover once for the full mental model, then keep <b style={{ color: C.txt }}>Parts 5, 7, 9, 10 & 13</b> open as live operating checklists. Re-read quarterly. Don’t try to be him — adopt the disciplines and let your own circle of competence decide the rest.
          </div>
        </div>
      </div>

      <div style={{ ...wrap, padding: '18px 22px 90px', display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* nav rail */}
        <div style={{ flex: '1 1 240px', maxWidth: 300, minWidth: 220, position: 'sticky', top: 58 }}>
          {GROUPS.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: F.xs, fontWeight: 800, color: g.color, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>{g.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.parts.map((pid) => {
                  const p = PARTS.find((x) => x.id === pid)!;
                  const on = p.id === active;
                  return (
                    <button key={pid} onClick={() => go(pid)} style={{ textAlign: 'left', cursor: 'pointer', fontSize: F.sm, fontWeight: on ? 800 : 600, color: on ? C.txt : C.muted, background: on ? `${g.color}1f` : 'transparent', border: `1px solid ${on ? g.color : 'transparent'}`, borderRadius: 8, padding: '7px 10px', lineHeight: 1.35 }}>
                      <span style={{ color: g.color, fontWeight: 900, marginRight: 6 }}>{p.n}</span>{p.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* content */}
        <div style={{ flex: '3 1 640px', minWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: F.xl, fontWeight: 900, color: C.gold }}>Part {part.n}</span>
            <span style={{ fontSize: F.xl, fontWeight: 800 }}>{part.title}</span>
          </div>
          <div style={{ height: 2, background: `linear-gradient(90deg, ${C.gold}, transparent)`, margin: '10px 0 16px', borderRadius: 2 }} />
          {part.intro ? <p style={{ margin: '0 0 16px', fontSize: F.lg, color: C.muted, lineHeight: 1.6 }}>{part.intro}</p> : null}
          <Blocks blocks={part.blocks} />

          {/* prev / next */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 30, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
            <button onClick={() => idx > 0 && go(PARTS[idx - 1].id)} disabled={idx === 0} style={{ cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontSize: F.sm, fontWeight: 700, color: C.txt, background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 8, padding: '9px 14px', maxWidth: '48%', textAlign: 'left' }}>{idx > 0 ? `← ${PARTS[idx - 1].n}. ${PARTS[idx - 1].title}` : ''}</button>
            <button onClick={() => idx < PARTS.length - 1 && go(PARTS[idx + 1].id)} disabled={idx === PARTS.length - 1} style={{ cursor: idx === PARTS.length - 1 ? 'default' : 'pointer', opacity: idx === PARTS.length - 1 ? 0.4 : 1, fontSize: F.sm, fontWeight: 700, color: C.txt, background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 8, padding: '9px 14px', maxWidth: '48%', textAlign: 'right' }}>{idx < PARTS.length - 1 ? `${PARTS[idx + 1].n}. ${PARTS[idx + 1].title} →` : ''}</button>
          </div>

          <div style={{ marginTop: 22, fontSize: F.xs, color: C.dim, lineHeight: 1.6, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
            A study guide built from Gautam Baid’s books, interviews, podcasts and fund disclosures (2018–2026) — not investment advice, and not affiliated with him. Your checklist ticks and progress are saved in this browser only. Verify every figure independently before acting.
          </div>
        </div>
      </div>
    </div>
  );
}
