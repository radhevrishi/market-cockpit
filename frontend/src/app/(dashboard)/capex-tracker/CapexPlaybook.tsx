// ============================================================
// CapexPlaybook.tsx — Quick-reference institutional notes
// Renders inside the capex-tracker as a new "📚 Playbook" tab.
// Pure reference content, no data dependency.
// ============================================================

import React from 'react';

const C = {
  bg: '#0a0e1a',
  card: '#0f1421',
  divider: '#1a2233',
  text: '#d8dee9',
  textDim: '#9aa6b8',
  textMuted: '#7c8ba1',
  white: '#f4f6fa',
  green: '#1d9e75',
  amber: '#ef9f27',
  red: '#e24b4a',
  blue: '#4d8fcc',
  purple: '#A78BFA',
  orange: '#f08e3a',
  teal: '#1d9e75',
};

const MONO: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};

// ─── building blocks ────────────────────────────────────────
function SectionHead({ n, title, color }: { n: string; title: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        paddingBottom: 6,
        marginBottom: 10,
        borderBottom: `0.5px solid ${C.divider}`,
      }}
    >
      <span style={{ ...MONO, fontSize: 11, color: C.textMuted, letterSpacing: 0.5 }}>
        {n}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.card,
        border: `0.5px solid ${C.divider}`,
        borderRadius: 4,
        padding: '14px 16px',
        marginBottom: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Tag({ kind, children }: { kind: 'GREEN' | 'AMBER' | 'RED' | 'NEUTRAL'; children: React.ReactNode }) {
  const map = {
    GREEN: { bg: 'rgba(29,158,117,0.12)', fg: C.green, border: 'rgba(29,158,117,0.4)' },
    AMBER: { bg: 'rgba(239,159,39,0.12)', fg: C.amber, border: 'rgba(239,159,39,0.4)' },
    RED: { bg: 'rgba(226,75,74,0.12)', fg: C.red, border: 'rgba(226,75,74,0.4)' },
    NEUTRAL: { bg: 'rgba(154,166,184,0.10)', fg: C.textDim, border: 'rgba(154,166,184,0.3)' },
  } as const;
  const s = map[kind];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.8,
        background: s.bg,
        color: s.fg,
        border: `0.5px solid ${s.border}`,
        borderRadius: 2,
        marginRight: 6,
        ...MONO,
      }}
    >
      {children}
    </span>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        fontSize: 12,
        color: C.text,
        lineHeight: 1.65,
        marginBottom: 4,
        paddingLeft: 4,
      }}
    >
      {children}
    </li>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '4px 0',
        borderBottom: `0.5px solid ${C.divider}`,
        fontSize: 12,
      }}
    >
      <span style={{ color: C.textDim }}>{k}</span>
      <span style={{ ...MONO, color: color ?? C.white, fontWeight: 500 }}>{v}</span>
    </div>
  );
}

function Q({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${C.purple}`,
        padding: '4px 12px',
        margin: '8px 0',
        fontSize: 11,
        color: C.textDim,
        fontStyle: 'italic',
        background: 'rgba(167,139,250,0.06)',
      }}
    >
      {children}
    </div>
  );
}

// ─── main component ─────────────────────────────────────────
const CapexPlaybook: React.FC = () => {
  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        padding: 18,
        borderRadius: 6,
        border: `0.5px solid ${C.divider}`,
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: 'inherit',
        marginTop: 8,
      }}
    >
      {/* Master header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 10,
          marginBottom: 16,
          borderBottom: `0.5px solid ${C.divider}`,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: C.textMuted,
              letterSpacing: 2,
              marginBottom: 4,
            }}
          >
            CAPEX TRACKER · QUICK REFERENCE
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.white, letterSpacing: 0.5 }}>
            The Capex Investing Playbook
          </div>
        </div>
        <div style={{ ...MONO, fontSize: 10, color: C.textDim }}>
          institutional · v1
        </div>
      </div>

      {/* ═══ 1 · THE THREE-CHART STORY ═══ */}
      <Card>
        <SectionHead n="01" title="The Three-Chart Story" color={C.orange} />
        <p style={{ fontSize: 12, color: C.textDim, margin: '0 0 10px' }}>
          One picture of a capex cycle = three strips read together.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ borderLeft: `2px solid ${C.orange}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.orange, letterSpacing: 0.8 }}>
              CAPEX
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              Money invested per year. Spikes = active expansion phase.
            </div>
          </div>
          <div style={{ borderLeft: `2px solid ${C.amber}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.amber, letterSpacing: 0.8 }}>
              CWIP
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              Money in flight — projects under construction, not yet productive.
            </div>
          </div>
          <div style={{ borderLeft: `2px solid ${C.teal}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.teal, letterSpacing: 0.8 }}>
              NET BLOCK
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              Money productive — commissioned assets generating output.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>
          The cycle:
        </div>
        <div
          style={{
            ...MONO,
            fontSize: 11,
            color: C.text,
            background: 'rgba(167,139,250,0.06)',
            border: `0.5px solid ${C.divider}`,
            padding: '10px 14px',
            borderRadius: 4,
            lineHeight: 1.9,
            letterSpacing: 0.3,
          }}
        >
          spend → <span style={{ color: C.orange }}>CAPEX rises</span> →{' '}
          <span style={{ color: C.amber }}>CWIP rises</span> (under construction) →
          <br />
          CWIP drains → <span style={{ color: C.teal }}>NET BLOCK jumps</span> (commissioned) →
          <br />
          production → sales rise → profit rises → <span style={{ color: C.green }}>ROCE recovers</span>
        </div>
        <Q>
          ₹461 Cr did not disappear. It moved from CWIP into Net Block. Construction account → completed factory.
        </Q>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
          <b style={{ color: C.text }}>Yasho FY22→FY26 example:</b> CAPEX peak 378 Cr (FY24) → CWIP peak 461 (FY24) → CWIP drains to 1 + Net Block jumps 203→624 (FY25) → ramp phase begins (FY26).
        </div>
      </Card>

      {/* ═══ 2 · T0→T5 ARC ═══ */}
      <Card>
        <SectionHead n="02" title="T0 → T5 — Multibagger Arc" color={C.purple} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 6,
            marginBottom: 10,
          }}
        >
          {[
            { t: 'T0', l: 'Announced', d: '12-24m', c: C.textMuted },
            { t: 'T1', l: 'Commissioned', d: '6-12m', c: C.amber },
            { t: 'T2', l: 'Util rising', d: '6-12m', c: C.purple },
            { t: 'T3', l: 'Earnings inflect', d: '6-12m', c: C.green },
            { t: 'T4', l: 'Recognition', d: '12-24m', c: C.green },
            { t: 'T5', l: 'Peak / new capex', d: '—', c: C.red },
          ].map((s) => (
            <div
              key={s.t}
              style={{
                background: C.bg,
                border: `0.5px solid ${C.divider}`,
                borderTop: `2px solid ${s.c}`,
                padding: '8px 6px',
                borderRadius: 3,
                textAlign: 'center',
              }}
            >
              <div style={{ ...MONO, fontSize: 11, color: s.c, fontWeight: 600 }}>{s.t}</div>
              <div style={{ fontSize: 10, color: C.text, marginTop: 2 }}>{s.l}</div>
              <div style={{ ...MONO, fontSize: 9, color: C.textMuted, marginTop: 2 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            background: 'rgba(167,139,250,0.10)',
            border: `0.5px solid ${C.purple}`,
            padding: '8px 12px',
            borderRadius: 3,
            fontSize: 11,
            color: C.text,
            marginTop: 6,
          }}
        >
          <b style={{ color: C.purple }}>ALPHA WINDOW · Stage C (~40% util):</b> modal optimal entry — ~55% of winners. Depreciation visible, GAAP not yet inflected, consensus extrapolates the depressed margin.
        </div>
        <Q>
          Buy when CWIP starts falling, Fixed Assets jump, Depreciation rises, Interest rises, and earnings still look weak. That's the highest-alpha period.
        </Q>
      </Card>

      {/* ═══ 3 · HARD EXCLUSIONS ═══ */}
      <Card>
        <SectionHead n="03" title="Hard Exclusions — Any Hit = Exit" color={C.red} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.amber, letterSpacing: 0.8, marginBottom: 6 }}>
              A · Scale / Relevance
            </div>
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              <Bullet>Capex &lt; 10–15% of sales (unless early-stage SME)</Bullet>
              <Bullet>No capacity addition quantified</Bullet>
              <Bullet>No commissioning timeline</Bullet>
              <Bullet>"Expansion / growth initiatives" without numbers</Bullet>
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.red, letterSpacing: 0.8, marginBottom: 6 }}>
              B · Financial Stress
            </div>
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              <Bullet>ND/EBITDA &gt; 3× AND rising</Bullet>
              <Bullet>ROCE &lt; 10% for 2 consecutive years</Bullet>
              <Bullet>Interest coverage deteriorating</Bullet>
              <Bullet>Heavy equity dilution linked to capex</Bullet>
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.blue, letterSpacing: 0.8, marginBottom: 6 }}>
              C · Execution Quality
            </div>
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              <Bullet>Util &lt; 60% AND no contracted demand</Bullet>
              <Bullet>No brownfield advantage in fragmented industry</Bullet>
              <Bullet>Pure greenfield + no anchor customer</Bullet>
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.purple, letterSpacing: 0.8, marginBottom: 6 }}>
              D · Governance
            </div>
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              <Bullet>Frequent QIP / promoter stake reduction during capex</Bullet>
              <Bullet>Promoter pledge &gt; 25–30%</Bullet>
              <Bullet>History of missed commissioning timelines</Bullet>
            </ul>
          </div>
        </div>
      </Card>

      {/* ═══ 4 · STOP & STUDY ═══ */}
      <Card>
        <SectionHead n="04" title="Stop & Study — 8-Core Validation" color={C.green} />
        <p style={{ fontSize: 12, color: C.textDim, margin: '0 0 10px' }}>
          If past hard exclusions, evaluate against these eight before deep work.
        </p>
        {[
          { n: '1', k: 'Materiality', v: 'Capex > 20% sales OR > 30% gross block' },
          { n: '2', k: 'Disclosure quality', v: 'Exact ₹, capacity, commissioning date all disclosed' },
          { n: '3', k: 'Demand visibility', v: 'Order book / contracts / anchor customer OR structural tailwind' },
          { n: '4', k: 'Utilization reality', v: '>75% bottleneck = strong · 60-75% conditional · <60% ignore unless contracted' },
          { n: '5', k: 'Balance-sheet safety', v: 'ND/EBITDA < 2× preferred · D/E < 1.0–1.2 acceptable' },
          { n: '6', k: 'Funding mix', v: 'Internal accruals > 50% = high quality · debt-heavy only if ROCE > 15% already' },
          { n: '7', k: 'Past capital allocation', v: 'Previous capex → ROCE expansion = GREEN · → overcapacity = RED FLAG' },
          { n: '8', k: 'Industry cycle position', v: 'Upcycle/early recovery = GOOD · Peak = WARNING · Downcycle = HIGH RISK' },
        ].map((r) => (
          <div
            key={r.n}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'baseline',
              padding: '6px 0',
              borderBottom: `0.5px solid ${C.divider}`,
              fontSize: 12,
            }}
          >
            <span style={{ ...MONO, color: C.textMuted, width: 16 }}>{r.n}</span>
            <span style={{ color: C.white, fontWeight: 500, width: 180 }}>{r.k}</span>
            <span style={{ color: C.textDim, flex: 1 }}>{r.v}</span>
          </div>
        ))}
      </Card>

      {/* ═══ 5 · STRUCTURAL CLASSIFICATION ═══ */}
      <Card>
        <SectionHead n="05" title="Structural Classification — A·B·C·D" color={C.blue} />
        {[
          {
            t: 'A',
            kind: 'RED' as const,
            label: 'Maintenance / Noise',
            verdict: 'IGNORE',
            examples: 'Store openings · small equipment upgrades · hospital bed additions · branch expansion',
            outcome: 'No ROCE shift expected',
          },
          {
            t: 'B',
            kind: 'GREEN' as const,
            label: 'Capacity Fill / Debottlenecking',
            verdict: 'HIGH QUALITY',
            examples: 'Pitti-Engineering-type expansions · util > 75% · low incremental capex',
            outcome: 'Best risk-adjusted category',
          },
          {
            t: 'C',
            kind: 'AMBER' as const,
            label: 'Platform Expansion',
            verdict: 'MID RISK / MID REWARD',
            examples: '₹100–500 Cr brownfield · Hitachi / Elantas type',
            outcome: 'Requires deep study, not automatic buy',
          },
          {
            t: 'D',
            kind: 'AMBER' as const,
            label: 'Bet-the-Company Greenfield',
            verdict: 'HIGH VARIANCE',
            examples: 'JSW Steel scale · multi-thousand Cr projects',
            outcome: 'Multibagger OR permanent capital loss',
          },
        ].map((r) => (
          <div
            key={r.t}
            style={{
              borderLeft: `3px solid ${r.kind === 'GREEN' ? C.green : r.kind === 'AMBER' ? C.amber : C.red}`,
              padding: '8px 14px',
              marginBottom: 8,
              background: 'rgba(255,255,255,0.015)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <span style={{ ...MONO, color: C.textMuted, marginRight: 8 }}>TYPE {r.t}</span>
                <span style={{ color: C.white, fontWeight: 600 }}>{r.label}</span>
              </div>
              <Tag kind={r.kind}>{r.verdict}</Tag>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{r.examples}</div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, fontStyle: 'italic' }}>
              → {r.outcome}
            </div>
          </div>
        ))}
      </Card>

      {/* ═══ 6 · 20 PRINCIPLES ═══ */}
      <Card>
        <SectionHead n="06" title="20 Operating Principles" color={C.green} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px 24px',
          }}
        >
          {[
            ['Follow CWIP, not management commentary', 'Rising CWIP > press releases'],
            ['Best entry is AFTER commissioning, BEFORE earnings', 'Highest-alpha window'],
            ['Sales should follow capex within 1–3 years', 'Flat sales = project failed'],
            ['Watch Asset Turnover (Sales / Net FA)', 'Recovering ratio = ramp working'],
            ['ROCE always falls first', 'Temporary OK · Permanent dangerous'],
            ['Brownfield > Greenfield', 'Lower execution risk, higher hit rate'],
            ['Internal funding beats debt', 'CFO > accruals > equity > debt'],
            ['Debt must peak BEFORE earnings', 'If debt rises post-commissioning, broken'],
            ['Working capital reveals fakes', 'Inventory/receivables growing faster than sales = bad'],
            ['Depreciation is a hidden signal', 'Big jump = assets started operating'],
            ['Capacity utilization = holy grail', 'Stocks rerate when util crosses 70-80%'],
            ['Export orders validate expansion', 'Global anchors > generic demand'],
            ['Compare capex with market cap', 'Big capex / small mcap = transformation'],
            ['Never trust announced capacity', 'Trust actual production, sales volume, util'],
            ['Margins recover after utilization', 'Dep ↑ + Int ↑ first, then margins ↑'],
            ['CFO must eventually exceed PAT', 'Weak conversion = warning'],
            ['Avoid perpetual capex destroyers', 'Look for build → monetize → build'],
            ['The best capex is invisible', 'No headlines, depressed earnings, rising CWIP'],
            ['Study guidance consistency quarter-by-quarter', 'Repeated delays = execution issue'],
            ['Rerating happens BEFORE peak earnings', 'Commissioning → full util is the window'],
          ].map(([t, d], i) => (
            <div
              key={i}
              style={{
                padding: '5px 0',
                borderBottom: `0.5px solid ${C.divider}`,
                fontSize: 11,
                display: 'flex',
                gap: 8,
              }}
            >
              <span style={{ ...MONO, color: C.textMuted, width: 18 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.white }}>{t}</div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ═══ 7 · INTEL SIGNALS (overrides ratios) ═══ */}
      <Card>
        <SectionHead n="07" title="Intel Signals — Override the Ratios" color={C.purple} />
        <KV k="Commissioning specificity" v={'"Q2 FY27" = strong · "next few years" = weak'} />
        <KV k="Customer anchoring" v={'Pre-committed buyers = institutional-grade'} />
        <KV k="Utilization trajectory" v={'40% → 75% ramp = best historical setup'} />
        <KV k="ROCE delta expectation" v={'Post-capex ROCE < WACC = value-destructive'} color={C.red} />
      </Card>

      {/* ═══ 8 · QUICK SCORING ═══ */}
      <Card>
        <SectionHead n="08" title="Quick Scoring Output" color={C.green} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div
            style={{
              border: `1px solid ${C.green}`,
              padding: '10px 12px',
              borderRadius: 3,
              background: 'rgba(29,158,117,0.06)',
            }}
          >
            <Tag kind="GREEN">GREEN</Tag>
            <div style={{ fontSize: 11, color: C.text, marginTop: 6, fontWeight: 600 }}>
              Deep Dive
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
              Material capex + capacity + timeline + funding clarity + strong utilization
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${C.amber}`,
              padding: '10px 12px',
              borderRadius: 3,
              background: 'rgba(239,159,39,0.06)',
            }}
          >
            <Tag kind="AMBER">AMBER</Tag>
            <div style={{ fontSize: 11, color: C.text, marginTop: 6, fontWeight: 600 }}>
              Watchlist
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
              Some clarity missing OR early-stage execution risk
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${C.red}`,
              padding: '10px 12px',
              borderRadius: 3,
              background: 'rgba(226,75,74,0.06)',
            }}
          >
            <Tag kind="RED">RED</Tag>
            <div style={{ fontSize: 11, color: C.text, marginTop: 6, fontWeight: 600 }}>
              Ignore
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
              Small, vague, debt-heavy, or no capacity economics
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ 9 · THE FUNNEL ═══ */}
      <Card>
        <SectionHead n="09" title="The Funnel — From Feed to Position" color={C.amber} />
        <div style={{ ...MONO, fontSize: 12, lineHeight: 2, color: C.text }}>
          <div>
            <span style={{ color: C.textMuted }}>100 announcements</span>
          </div>
          <div style={{ paddingLeft: 16 }}>
            <span style={{ color: C.red }}>↓ 70 ignored instantly</span>
          </div>
          <div style={{ paddingLeft: 16 }}>
            <span style={{ color: C.amber }}>↓ 20 watchlist</span>
          </div>
          <div style={{ paddingLeft: 16 }}>
            <span style={{ color: C.blue }}>↓ 8 detailed model (ROCE / ND / util)</span>
          </div>
          <div style={{ paddingLeft: 16 }}>
            <span style={{ color: C.green }}>↓ 2–3 investable capex cycles</span>
          </div>
        </div>
        <Q>
          The discipline is in the discarding, not the discovery. 70 of 100 announcements should go in the trash inside 60 seconds.
        </Q>
      </Card>

      {/* ═══ 10 · ULTIMATE CHECKLIST ═══ */}
      <Card>
        <SectionHead n="10" title="The Ultimate Pre-Buy Checklist" color={C.green} />
        <p style={{ fontSize: 11, color: C.textDim, margin: '0 0 10px' }}>
          Before sizing a position post-major-expansion, every one of these must be green.
        </p>
        {[
          ['CWIP rising historically', '✓'],
          ['CWIP draining into Fixed Assets', '✓'],
          ['Sales accelerating', '✓'],
          ['Utilization improving', '> 60%'],
          ['Debt stabilizing', '✓'],
          ['ROCE recovering', '> 15%'],
          ['CFO positive', '✓'],
          ['Inventory controlled', '✓'],
          ['Working capital stable', '✓'],
          ['Valuation reasonable', '✓'],
        ].map(([k, v]) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '5px 0',
              borderBottom: `0.5px solid ${C.divider}`,
              fontSize: 12,
            }}
          >
            <span style={{ color: C.text }}>{k}</span>
            <span style={{ ...MONO, color: C.green, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </Card>

      {/* ═══ 11 · LIVE SIGNAL TAGGING (sample) ═══ */}
      <Card>
        <SectionHead n="11" title="Live Capex Signal Sheet — How to Tag" color={C.blue} />
        <p style={{ fontSize: 11, color: C.textDim, margin: '0 0 10px' }}>
          Sample classifications applied to recent feed (Indian capex announcements).
        </p>
        {[
          ['Tenneco Clean Air India', '₹140 Cr greenfield + 2.1M unit OEM ramp FY26-28', 'GREEN'],
          ['Amic Forging', '₹150 + ₹165 Cr phased — bottleneck + execution visibility', 'GREEN'],
          ['Pondy Oxides', '₹200 Cr recycling — structural growth', 'GREEN'],
          ['Kirloskar Oil Engines', '₹1,400 Cr industrial cycle + tightness', 'GREEN'],
          ['Indo Tech Transformers', '₹135 Cr — power cycle bottleneck', 'GREEN'],
          ['Archean Chemicals', '₹2,067 Cr SiC fab — strategic semi capex', 'GREEN'],
          ['Indo Count', '₹60 Cr brownfield spinning', 'AMBER'],
          ['JSW Steel', '₹65,000 Cr mega-cycle — high variance', 'AMBER'],
          ['HFCL Defence', '₹230 Cr — policy + execution risk', 'AMBER'],
          ['JK Tyre', '₹4,980 Cr — cycle + leverage risk', 'AMBER'],
          ['Broach Lifecure (25→50 beds)', 'Bed addition — no operating leverage', 'RED'],
          ['Smartworks coworking', 'Capacity leasing — real estate demand risk', 'RED'],
          ['Meta Infotech', 'Office lease — non-productive', 'RED'],
          ['Trishakti Industries (₹22 Cr fleet)', 'Immaterial scale', 'RED'],
          ['Mukta Arts', 'Non-operating', 'RED'],
        ].map(([name, note, tag], i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'baseline',
              padding: '5px 0',
              borderBottom: `0.5px solid ${C.divider}`,
              fontSize: 11,
            }}
          >
            <Tag kind={tag as 'GREEN' | 'AMBER' | 'RED'}>{tag}</Tag>
            <span style={{ color: C.white, fontWeight: 500, width: 200 }}>{name}</span>
            <span style={{ color: C.textDim, flex: 1 }}>{note}</span>
          </div>
        ))}
      </Card>

      {/* Footer — final principle */}
      <div
        style={{
          padding: '14px 16px',
          background: 'rgba(167,139,250,0.06)',
          border: `0.5px solid ${C.purple}`,
          borderRadius: 4,
          fontSize: 11,
          color: C.text,
          fontStyle: 'italic',
          lineHeight: 1.6,
        }}
      >
        The market usually rerates a manufacturing company <b style={{ color: C.purple }}>before peak earnings arrive</b>. Strongest returns occur between commissioning and full utilization — when financial statements still look mediocre but operational indicators (utilization, order inflow, volume growth, cash generation) are improving. Learning to recognize that transition is one of the most valuable skills in capex investing.
      </div>
    </div>
  );
};

export default CapexPlaybook;
