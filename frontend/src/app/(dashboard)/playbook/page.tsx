'use client';
// PATCH 1061 — PLAYBOOK / INVESTMENT OPERATING SYSTEM
// Institutional-grade discipline tab: live decision-engine + state machine +
// 4-step daily routine + weekly/quarterly checklists + behavior protocol.
// NOT a wall of text — every section is a functional widget with structured
// data, not paragraphs.
import { useState, useEffect, useMemo } from 'react';

const CARD_BG = '#13131a';
const CARD2 = '#1a1a24';
const BORDER = 'rgba(255,255,255,0.08)';
const MUTED = '#94A3B8';
const TEXT = '#E5E7EB';
const PURPLE = '#a78bfa';
const GREEN = '#10b981';
const YELLOW = '#f59e0b';
const RED = '#ef4444';
const CYAN = '#22d3ee';
const ORANGE = '#f97316';

const F = { xs: 10, sm: 11, md: 12, lg: 13, h1: 16, h2: 14 };

type State = 'HOLD' | 'WATCH' | 'EXIT';

interface HoldingState {
  ticker: string;
  state: State;
  pnlPct?: number;
  vsDma50?: number;
  vsDma200?: number;
  closesBelow50: number; // 0–3+ consecutive closes below 50DMA
  absorption: boolean;   // panic-low not revisited for 3–5 sessions
  thesisIntact: boolean;
  note?: string;
  updatedAt: number;
}

const STATE_COLOR: Record<State, string> = { HOLD: GREEN, WATCH: YELLOW, EXIT: RED };
const STATE_ICON: Record<State, string> = { HOLD: '●', WATCH: '◐', EXIT: '✕' };

// Compute the prescribed state per the rule engine. Pure function.
function classify(h: Pick<HoldingState, 'pnlPct' | 'closesBelow50' | 'absorption' | 'thesisIntact'>): { state: State; reason: string } {
  // RULE 1 — Capital protection
  if ((h.pnlPct ?? 0) <= -13) return { state: 'EXIT', reason: 'Rule 1: P&L ≤ −13% capital-protection floor' };
  // RULE 3 — Thesis broken
  if (!h.thesisIntact) return { state: 'EXIT', reason: 'Rule 3: fundamental / thesis broken' };
  // RULE 2 — Trend breakdown
  if (h.closesBelow50 >= 3) {
    if (h.absorption) return { state: 'WATCH', reason: '3 closes < 50DMA but panic-low absorbed (institutional demand)' };
    return { state: 'EXIT', reason: 'Rule 2: 3 closes below 50DMA AND no absorption signal' };
  }
  return { state: 'HOLD', reason: 'above 50DMA · no triggers · do nothing' };
}

// IST time helpers
function getIST() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
}
function isExecutionWindow() {
  const ist = getIST();
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // Execution window = after market close 15:30 → 22:00 IST (EOD)
  return m >= (15 * 60 + 30) && m <= (22 * 60);
}
function isWeeklyWindow() {
  return getIST().getUTCDay() === 0 || getIST().getUTCDay() === 6; // Sat/Sun
}

const SECTIONS = [
  { id: 'engine',    label: 'Decision Engine', icon: '⚙' },
  { id: 'today',     label: 'Today',           icon: '◴' },
  { id: 'states',    label: 'States',          icon: '◐' },
  { id: 'exit',      label: 'Exit Rules',      icon: '↗' },
  { id: 'absorb',    label: 'Absorption',      icon: '◇' },
  { id: 'weekly',    label: 'Weekly',          icon: '▦' },
  { id: 'quarterly', label: 'Quarterly',       icon: '▥' },
  { id: 'behavior',  label: 'Behavior',        icon: '◉' },
];

export default function PlaybookPage() {
  const [holdings, setHoldings] = useState<HoldingState[]>([]);
  const [activeSection, setActiveSection] = useState<string>('engine');

  // Hydrate state machine: merge saved playbook state with current portfolio
  useEffect(() => {
    let saved: HoldingState[] = [];
    try { saved = JSON.parse(localStorage.getItem('mc:playbook:states:v1') || '[]'); } catch {}
    let portfolio: string[] = [];
    try {
      const port = JSON.parse(localStorage.getItem('mc:portfolio:v3') || localStorage.getItem('mc:portfolio:v2') || localStorage.getItem('mc:portfolio:v1') || '[]');
      if (Array.isArray(port)) portfolio = port.map((p: any) => (p?.ticker || p?.symbol || '').toUpperCase()).filter(Boolean);
    } catch {}
    const savedMap = new Map(saved.map(h => [h.ticker, h]));
    const merged: HoldingState[] = portfolio.map(t =>
      savedMap.get(t) || { ticker: t, state: 'HOLD', closesBelow50: 0, absorption: false, thesisIntact: true, updatedAt: Date.now() }
    );
    // include any saved tickers no longer in portfolio (in case user wants to retire them)
    saved.forEach(h => { if (!merged.find(m => m.ticker === h.ticker)) merged.push(h); });
    setHoldings(merged);
  }, []);

  function persist(next: HoldingState[]) {
    setHoldings(next);
    try { localStorage.setItem('mc:playbook:states:v1', JSON.stringify(next)); } catch {}
  }
  function updateHolding(ticker: string, patch: Partial<HoldingState>) {
    persist(holdings.map(h => h.ticker === ticker ? { ...h, ...patch, updatedAt: Date.now() } : h));
  }

  const counts = useMemo(() => {
    const c = { HOLD: 0, WATCH: 0, EXIT: 0 };
    holdings.forEach(h => { const cls = classify(h); c[cls.state]++; });
    return c;
  }, [holdings]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 20px', color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
      {/* ═════ HEADER ═════ */}
      <div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.h1, fontWeight: 900, color: PURPLE, letterSpacing: 0.5 }}>PLAYBOOK</span>
        <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, letterSpacing: 0.4 }}>· INVESTMENT OPERATING SYSTEM</span>
        <span style={{ fontSize: 9, color: MUTED }}>disciplined trend-follower · state machine · absorption-aware</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Pill color={GREEN} label={`HOLD ${counts.HOLD}`} />
          <Pill color={YELLOW} label={`WATCH ${counts.WATCH}`} />
          <Pill color={RED} label={`EXIT ${counts.EXIT}`} />
        </div>
      </div>

      {/* ═════ TAB STRIP ═════ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {SECTIONS.map(s => {
          const active = activeSection === s.id;
          return (
            <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
              fontSize: F.xs, fontWeight: 700, padding: '6px 12px', borderRadius: 6, letterSpacing: 0.3,
              border: `1px solid ${active ? `${PURPLE}60` : BORDER}`,
              background: active ? `${PURPLE}14` : 'transparent',
              color: active ? PURPLE : MUTED, cursor: 'pointer',
            }}>{s.icon} {s.label.toUpperCase()}</button>
          );
        })}
      </div>

      {activeSection === 'engine'    && <DecisionEngineSection holdings={holdings} updateHolding={updateHolding} persist={persist} />}
      {activeSection === 'today'     && <TodaySection counts={counts} />}
      {activeSection === 'states'    && <StatesSection />}
      {activeSection === 'exit'      && <ExitRulesSection />}
      {activeSection === 'absorb'    && <AbsorptionSection />}
      {activeSection === 'weekly'    && <WeeklySection />}
      {activeSection === 'quarterly' && <QuarterlySection />}
      {activeSection === 'behavior'  && <BehaviorSection />}
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return <span style={{ fontSize: 9, fontWeight: 800, color, border: `1px solid ${color}40`, backgroundColor: `${color}14`, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3 }}>{label}</span>;
}

function SectionCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, padding: '12px 14px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${accent}`, borderRadius: 8 }}>
      <div style={{ fontSize: F.xs, fontWeight: 800, color: accent, letterSpacing: 0.6, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — LIVE DECISION ENGINE
// ═══════════════════════════════════════════════════════════════════════════
function DecisionEngineSection({ holdings, updateHolding, persist }: { holdings: HoldingState[]; updateHolding: (t: string, p: Partial<HoldingState>) => void; persist: (n: HoldingState[]) => void }) {
  const [addTicker, setAddTicker] = useState('');
  if (holdings.length === 0) {
    return (
      <SectionCard title="DECISION ENGINE" accent={PURPLE}>
        <div style={{ fontSize: F.sm, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
          No portfolio detected. Either upload portfolio tickers in <a href="/portfolio" style={{ color: CYAN }}>/portfolio</a>, or add tickers manually below to run the state machine.
        </div>
        <ManualAdd addTicker={addTicker} setAddTicker={setAddTicker} onAdd={() => {
          const t = addTicker.trim().toUpperCase();
          if (!t) return;
          persist([...holdings, { ticker: t, state: 'HOLD', closesBelow50: 0, absorption: false, thesisIntact: true, updatedAt: Date.now() }]);
          setAddTicker('');
        }} />
      </SectionCard>
    );
  }
  return (
    <>
      <SectionCard title="EXECUTE — DAILY DECISION (5 MIN, EOD ONLY)" accent={PURPLE}>
        <div style={{ fontSize: F.xs, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
          For each holding, mark the four inputs the engine needs. Engine classifies into HOLD / WATCH / EXIT and tells you the rule that fired.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,100px) 60px 60px 70px 70px 80px 1fr', gap: 6, fontSize: F.xs, color: MUTED, fontWeight: 700, letterSpacing: 0.3, padding: '4px 6px', borderBottom: `1px solid ${BORDER}` }}>
          <span>TICKER</span>
          <span>P&L %</span>
          <span>3-CLOSE&lt;50</span>
          <span>ABSORB</span>
          <span>THESIS</span>
          <span>STATE</span>
          <span>REASON · ACTION</span>
        </div>
        {holdings.map(h => {
          const cls = classify(h);
          return (
            <div key={h.ticker} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,100px) 60px 60px 70px 70px 80px 1fr', gap: 6, alignItems: 'center', fontSize: F.xs, padding: '5px 6px', borderBottom: `1px solid ${BORDER}40` }}>
              <span style={{ fontWeight: 800, color: TEXT, letterSpacing: 0.3 }}>{h.ticker}</span>
              <input type="number" value={h.pnlPct ?? ''} onChange={e => updateHolding(h.ticker, { pnlPct: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="—" style={inputStyle()} />
              <select value={h.closesBelow50} onChange={e => updateHolding(h.ticker, { closesBelow50: Number(e.target.value) })} style={selectStyle()}>
                <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3+</option>
              </select>
              <ToggleChip value={h.absorption} onToggle={() => updateHolding(h.ticker, { absorption: !h.absorption })} onLabel="YES" offLabel="NO" onColor={CYAN} offColor={MUTED} />
              <ToggleChip value={h.thesisIntact} onToggle={() => updateHolding(h.ticker, { thesisIntact: !h.thesisIntact })} onLabel="OK" offLabel="BROKEN" onColor={GREEN} offColor={RED} />
              <span style={{ fontSize: F.xs, fontWeight: 800, color: STATE_COLOR[cls.state], padding: '2px 6px', borderRadius: 4, backgroundColor: `${STATE_COLOR[cls.state]}14`, border: `1px solid ${STATE_COLOR[cls.state]}40`, textAlign: 'center', letterSpacing: 0.3 }}>{STATE_ICON[cls.state]} {cls.state}</span>
              <span style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.35 }}>{cls.reason}</span>
            </div>
          );
        })}
        <ManualAdd addTicker={addTicker} setAddTicker={setAddTicker} onAdd={() => {
          const t = addTicker.trim().toUpperCase();
          if (!t || holdings.find(h => h.ticker === t)) { setAddTicker(''); return; }
          persist([...holdings, { ticker: t, state: 'HOLD', closesBelow50: 0, absorption: false, thesisIntact: true, updatedAt: Date.now() }]);
          setAddTicker('');
        }} />
      </SectionCard>
      <SectionCard title="DECISION SEQUENCE — EXECUTE IN ORDER" accent={CYAN}>
        <Step n={1} title="Capital check" body="Any holding ≤ −13% P&L? → EXIT immediately. No exceptions." color={RED} />
        <Step n={2} title="Trend check" body="3 consecutive closes below 50DMA? If NO → HOLD. If YES → step 3." color={ORANGE} />
        <Step n={3} title="Absorption check" body="Panic low occurred AND not revisited 3–5 sessions? YES → WATCH. NO → EXIT." color={YELLOW} />
        <Step n={4} title="Final output" body="Every holding classified into HOLD / WATCH / EXIT. No ambiguity allowed." color={GREEN} />
      </SectionCard>
    </>
  );
}

function Step({ n, title, body, color }: { n: number; title: string; body: string; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', alignItems: 'baseline' }}>
      <span style={{ fontSize: F.xs, fontWeight: 900, color, minWidth: 18 }}>{n}.</span>
      <span style={{ fontSize: F.sm, fontWeight: 700, color: TEXT, minWidth: 140 }}>{title}</span>
      <span style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.4 }}>{body}</span>
    </div>
  );
}

function ToggleChip({ value, onToggle, onLabel, offLabel, onColor, offColor }: { value: boolean; onToggle: () => void; onLabel: string; offLabel: string; onColor: string; offColor: string }) {
  const color = value ? onColor : offColor;
  return (
    <button onClick={onToggle} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 3, background: `${color}14`, border: `1px solid ${color}50`, color, cursor: 'pointer', letterSpacing: 0.3 }}>{value ? onLabel : offLabel}</button>
  );
}
function inputStyle(): React.CSSProperties {
  return { fontSize: F.xs, padding: '2px 6px', background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 3, color: TEXT, width: '100%', fontVariantNumeric: 'tabular-nums' };
}
function selectStyle(): React.CSSProperties {
  return { fontSize: F.xs, padding: '2px 4px', background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 3, color: TEXT, fontWeight: 700, cursor: 'pointer' };
}
function ManualAdd({ addTicker, setAddTicker, onAdd }: { addTicker: string; setAddTicker: (s: string) => void; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
      <input value={addTicker} onChange={e => setAddTicker(e.target.value)} placeholder="ADD TICKER (e.g. NORTHARC)" style={{ ...inputStyle(), width: 220, padding: '4px 8px' }} onKeyDown={e => e.key === 'Enter' && onAdd()} />
      <button onClick={onAdd} style={{ fontSize: F.xs, fontWeight: 700, padding: '4px 10px', borderRadius: 4, background: `${PURPLE}14`, border: `1px solid ${PURPLE}40`, color: PURPLE, cursor: 'pointer' }}>+ ADD</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — TODAY
// ═══════════════════════════════════════════════════════════════════════════
function TodaySection({ counts }: { counts: Record<State, number> }) {
  const ist = getIST();
  const inExec = isExecutionWindow();
  const isWE = isWeeklyWindow();
  const hh = ist.getUTCHours().toString().padStart(2, '0');
  const mm = ist.getUTCMinutes().toString().padStart(2, '0');
  return (
    <>
      <SectionCard title={`TIME — ${hh}:${mm} IST`} accent={inExec ? GREEN : (isWE ? CYAN : YELLOW)}>
        {inExec && <p style={{ margin: 0, fontSize: F.sm, color: GREEN, fontWeight: 700 }}>● Execution window OPEN — 5 min EOD review. Run Decision Engine, classify each holding, log notes.</p>}
        {!inExec && !isWE && <p style={{ margin: 0, fontSize: F.sm, color: YELLOW, fontWeight: 700 }}>● Off-window. <span style={{ color: MUTED, fontWeight: 600 }}>No intraday checking, no P&L obsession, no X/news interpretation. Ask: "Is there any action in my system right now?" → NO → do nothing.</span></p>}
        {isWE && <p style={{ margin: 0, fontSize: F.sm, color: CYAN, fontWeight: 700 }}>● Weekly window — 60–90 min portfolio integrity review. See WEEKLY tab.</p>}
      </SectionCard>
      <SectionCard title="DAILY ROUTINE (5–10 MIN, EOD ONLY)" accent={PURPLE}>
        <ChecklistRow label="1. Check closing prices vs 50-DMA for every holding" />
        <ChecklistRow label="2. Apply Rule 1 capital check (≤ −13% → EXIT)" />
        <ChecklistRow label="3. Apply Rule 2 trend check (3 closes < 50DMA → escalate)" />
        <ChecklistRow label="4. Apply Rule 4 absorption check on flagged stocks" />
        <ChecklistRow label="5. Update Decision Engine state for any change" />
        <ChecklistRow label="6. Prepare next-day action list (BUY/SELL queue)" />
      </SectionCard>
      <SectionCard title="CURRENT PORTFOLIO STATE" accent={CYAN}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <StateCount color={GREEN} state="HOLD" n={counts.HOLD} desc="above 50DMA · no triggers · do nothing" />
          <StateCount color={YELLOW} state="WATCH" n={counts.WATCH} desc="breakdown + absorption · observe 3–5 sessions" />
          <StateCount color={RED} state="EXIT" n={counts.EXIT} desc="capital floor / breakdown / thesis broken" />
        </div>
      </SectionCard>
    </>
  );
}
function ChecklistRow({ label }: { label: string }) {
  return <div style={{ fontSize: F.sm, color: MUTED, padding: '4px 0', lineHeight: 1.4 }}>› {label}</div>;
}
function StateCount({ color, state, n, desc }: { color: string; state: string; n: number; desc: string }) {
  return (
    <div style={{ padding: '10px 12px', backgroundColor: CARD2, border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`, borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 900, color, letterSpacing: 0.5 }}>{n}</span>
        <span style={{ fontSize: F.xs, fontWeight: 800, color, letterSpacing: 0.4 }}>{state}</span>
      </div>
      <div style={{ fontSize: 9, color: MUTED, marginTop: 4, lineHeight: 1.35 }}>{desc}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════
function StatesSection() {
  return (
    <>
      <SectionCard title="STATE MACHINE — every holding is in exactly one state" accent={PURPLE}>
        <StateRow color={GREEN} state="HOLD" condition="Above 50DMA · no triggers fired" action="Do nothing" />
        <StateRow color={YELLOW} state="WATCH" condition="3 closes below 50DMA AND panic-low absorbed" action="No EXIT, no ADD. Observe 3–5 sessions. Recovery → HOLD. Continued weakness → EXIT." />
        <StateRow color={RED} state="EXIT" condition="P&L ≤ −13% OR 3 closes below 50DMA WITHOUT absorption OR thesis broken" action="Sell on next execution window. No exceptions, no negotiation." />
      </SectionCard>
      <SectionCard title="TRANSITION DIAGRAM" accent={CYAN}>
        <pre style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{`    ┌──────────┐  3-close < 50DMA   ┌─────────┐  recovery > 50DMA  ┌──────────┐
    │   HOLD   │ ─────w/absorption─→│  WATCH  │ ──────────────────→│   HOLD   │
    └──────────┘                    └─────────┘                    └──────────┘
         │                               │
         │ −13% P&L OR thesis broken     │ continued weakness
         │ OR 3-close < 50DMA            │ OR new −13% / thesis-broken
         │ WITHOUT absorption            │
         ↓                               ↓
    ┌──────────┐ ←─────────────────────────┘
    │   EXIT   │
    └──────────┘`}</pre>
      </SectionCard>
    </>
  );
}
function StateRow({ color, state, condition, action }: { color: string; state: string; condition: string; action: string }) {
  return (
    <div style={{ padding: '8px 10px', marginBottom: 6, backgroundColor: CARD2, borderLeft: `3px solid ${color}`, borderRadius: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: F.sm, fontWeight: 900, color, letterSpacing: 0.4 }}>{state}</span>
        <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 600 }}>{condition}</span>
      </div>
      <div style={{ fontSize: F.xs, color: TEXT, lineHeight: 1.4 }}>→ {action}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — EXIT RULES (HARD)
// ═══════════════════════════════════════════════════════════════════════════
function ExitRulesSection() {
  return (
    <>
      <SectionCard title="RULE 1 — CAPITAL PROTECTION (ABSOLUTE)" accent={RED}>
        <div style={{ fontSize: F.lg, fontWeight: 800, color: TEXT, marginBottom: 6 }}>P&L ≤ −13% from cost → EXIT immediately</div>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5 }}>No exceptions. Not "let me wait one more day". Not "the thesis is still intact". Not "it'll bounce". Exit. The position is failed; preserve capital for the next setup.</div>
      </SectionCard>
      <SectionCard title="RULE 2 — TREND BREAKDOWN (STRUCTURAL EXIT)" accent={ORANGE}>
        <div style={{ fontSize: F.lg, fontWeight: 800, color: TEXT, marginBottom: 6 }}>3 consecutive closes below 50DMA + no absorption → EXIT</div>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5 }}>The 3-close confirmation prevents whipsaw on one bad day. The absorption check (Rule 4) is the ONLY override — it converts the breakdown into WATCH, not HOLD.</div>
      </SectionCard>
      <SectionCard title="RULE 3 — FUNDAMENTAL BREAKDOWN (OVERRIDE)" accent={RED}>
        <div style={{ fontSize: F.lg, fontWeight: 800, color: TEXT, marginBottom: 6 }}>Earnings deterioration OR thesis broken → EXIT irrespective of price</div>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5 }}>This overrides everything else. Even if the chart looks fine, even if you're up 30%. The reason you owned it is gone. Position is a different business now; you didn't sign up for this one.</div>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — ABSORPTION (CONFIRMATION-ONLY)
// ════════════════════════════════════════════════════════════════════════════
function AbsorptionSection() {
  return (
    <SectionCard title="RULE 4 — PANIC LOW ABSORPTION (CONFIRMATION-ONLY, NOT EXIT TRIGGER)" accent={CYAN}>
      <div style={{ fontSize: F.sm, color: TEXT, lineHeight: 1.55, marginBottom: 10 }}>
        Absorption is a <strong style={{ color: CYAN }}>defensive override</strong> — it can prevent a forced exit but never trigger one. It tells you institutional demand absorbed the panic, not that the stock is healthy.
      </div>
      <div style={{ fontSize: F.xs, fontWeight: 800, color: MUTED, letterSpacing: 0.4, marginTop: 8, marginBottom: 4 }}>CONDITIONS (all required)</div>
      <ChecklistRow label="Intraday sharp breakdown occurred — panic low formed" />
      <ChecklistRow label="That low NOT revisited for 3–5 trading sessions" />
      <ChecklistRow label="Price stabilizes — no continuous lower-low sequence" />
      <div style={{ fontSize: F.xs, fontWeight: 800, color: MUTED, letterSpacing: 0.4, marginTop: 12, marginBottom: 4 }}>INTERPRETATION</div>
      <ChecklistRow label="Selling pressure absorbed at the panic level" />
      <ChecklistRow label="Institutional demand present at that price" />
      <ChecklistRow label="Breakdown was a liquidity event, NOT structural damage" />
      <div style={{ fontSize: F.xs, fontWeight: 800, color: MUTED, letterSpacing: 0.4, marginTop: 12, marginBottom: 4 }}>FUNCTION (this is all it does)</div>
      <ChecklistRow label="Prevents premature exit under Rule 2 (3-close breakdown)" />
      <ChecklistRow label="Moves the holding into WATCH state for 3–5 sessions" />
      <div style={{ fontSize: F.xs, color: RED, lineHeight: 1.4, marginTop: 10, padding: '6px 8px', backgroundColor: `${RED}10`, border: `1px solid ${RED}30`, borderRadius: 4 }}>
        ⚠ Absorption does <strong>NOT</strong> override Rule 1 (capital protection) or Rule 3 (thesis broken). Those are absolute.
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — WEEKLY
// ═══════════════════════════════════════════════════════════════════════
function WeeklySection() {
  return (
    <>
      <SectionCard title="WEEKLY ROUTINE — ONE FIXED SESSION, 60–90 MIN" accent={PURPLE}>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5, marginBottom: 8 }}>Purpose: portfolio integrity review. Run on Sat or Sun only — never replaces daily execution.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: F.xs, fontWeight: 800, color: GREEN, letterSpacing: 0.4, marginBottom: 6 }}>HOLD STOCKS — per-name check</div>
            <ChecklistRow label="Thesis intact? (Y/N)" />
            <ChecklistRow label="Earnings trend intact? (Y/N)" />
            <ChecklistRow label="Sector tailwind intact? (Y/N)" />
          </div>
          <div>
            <div style={{ fontSize: F.xs, fontWeight: 800, color: YELLOW, letterSpacing: 0.4, marginBottom: 6 }}>WATCH STOCKS — resolve state</div>
            <ChecklistRow label="Recovery happening? → HOLD" />
            <ChecklistRow label="Breakdown continuing? → EXIT" />
          </div>
        </div>
      </SectionCard>
      <SectionCard title="PORTFOLIO-LEVEL CHECK" accent={CYAN}>
        <ChecklistRow label="Sector concentration risk — any sector > 25% of book?" />
        <ChecklistRow label="Theme overcrowding — too many names on the same narrative?" />
        <ChecklistRow label="Single-factor overexposure (rates, crude, AI, defence, etc.)" />
        <ChecklistRow label="Cash deployment vs setups in waiting" />
        <ChecklistRow label="Watchlist update — add new setups, retire dead ones" />
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — QUARTERLY
// ═══════════════════════════════════════════════════════════════════════════
function QuarterlySection() {
  return (
    <>
      <SectionCard title="QUARTERLY ROUTINE — STRATEGIC RESET (EARNINGS CYCLE)" accent={PURPLE}>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5, marginBottom: 8 }}>Purpose: fundamental recalibration. Run once after each earnings season closes.</div>
        <div style={{ fontSize: F.xs, fontWeight: 800, color: TEXT, letterSpacing: 0.4, marginBottom: 6 }}>FOR EVERY STOCK</div>
        <ChecklistRow label="Revenue + earnings trajectory — accelerating or fading?" />
        <ChecklistRow label="Margin expansion or contraction?" />
        <ChecklistRow label="Order book / demand cycle direction" />
        <ChecklistRow label="Management credibility shift (guidance hit/miss/withdrawn)" />
        <ChecklistRow label="Valuation vs growth reality (PE/PEG vs CAGR achieved)" />
        <ChecklistRow label="Capital allocation quality (where did FCF go?)" />
      </SectionCard>
      <SectionCard title="FINAL OUTPUT PER STOCK — ONE OF FOUR LABELS" accent={CYAN}>
        <OutputRow color={GREEN} label="CORE COMPOUNDER" desc="Buy more on weakness. Highest conviction." />
        <OutputRow color={CYAN}  label="TREND HOLD" desc="Continue holding while trend intact. No additions." />
        <OutputRow color={YELLOW} label="REDUCE / EXIT ON STRENGTH" desc="Trim into rallies. Replace with better setups." />
        <OutputRow color={RED}    label="EXIT NOW" desc="Thesis broken or rule fired. Sell on next window." />
      </SectionCard>
    </>
  );
}
function OutputRow({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div style={{ padding: '6px 0', display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: F.sm, fontWeight: 800, color, letterSpacing: 0.3, minWidth: 200 }}>{label}</span>
      <span style={{ fontSize: F.xs, color: MUTED }}>{desc}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════
function BehaviorSection() {
  return (
    <>
      <SectionCard title="BEHAVIOR PROTOCOL — CRITICAL EDGE LAYER" accent={PURPLE}>
        <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.5, marginBottom: 10 }}>The system fails when behavior fails. These are non-negotiable.</div>
        <BehaviorRule code="A" title="TIME RESTRICTION" body="Market interaction ONLY: EOD 10 min · Weekly review · Quarterly review. Nothing else." />
        <BehaviorRule code="B" title="NO INTRADAY ACTION" body="No checking charts during market hours. No reacting to volatility. No 'just one quick look'." />
        <BehaviorRule code="C" title="X / SOCIAL MEDIA" body="Allowed ONLY during weekly review. Never used for execution decisions. Treat as entertainment, not signal." />
        <BehaviorRule code="D" title="EMOTIONAL CONTROL PROTOCOL" body={'When the urge to check portfolio strikes: ask "Is there any action in my system right now?" — NO → do nothing. YES → wait until EOD window.'} />
      </SectionCard>
      <SectionCard title="ONE-LINE SYSTEM SUMMARY" accent={GREEN}>
        <div style={{ fontSize: F.sm, color: TEXT, lineHeight: 1.55, fontStyle: 'italic', padding: '6px 10px', borderLeft: `2px solid ${GREEN}`, backgroundColor: `${GREEN}06` }}>
          "I run a disciplined trend-following portfolio where exits are triggered only by capital loss (−13%), structural breakdown (50-DMA + 3 closes), or fundamental deterioration — while panic-low absorption signals convert breakdowns into WATCH mode instead of forced exits."
        </div>
      </SectionCard>
      <SectionCard title="WHAT YOU NOW HAVE" accent={CYAN}>
        <ChecklistRow label="A state-machine portfolio system — not a discretionary checklist" />
        <ChecklistRow label="Not a psychological guideline — a rules engine" />
        <ChecklistRow label="Not multiple overlapping rules — one operating manual" />
        <ChecklistRow label="Behaves like a rules engine used in hedge-fund risk desks" />
      </SectionCard>
    </>
  );
}
function BehaviorRule({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: F.xs, fontWeight: 900, color: PURPLE, padding: '1px 6px', borderRadius: 3, backgroundColor: `${PURPLE}15`, border: `1px solid ${PURPLE}40`, letterSpacing: 0.3 }}>RULE {code}</span>
        <span style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, letterSpacing: 0.3 }}>{title}</span>
      </div>
      <div style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
}
