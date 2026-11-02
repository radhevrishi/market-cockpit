'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type ReactNode, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { readPortfolioSymbols, normSymbol, type SymbolSource, classifySource, SOURCE_META } from '@/lib/portfolio-symbols';
import { type ConvictionEntry, readConvictionBeats } from '@/lib/conviction-beats';
import { readSmallMidPref, writeSmallMidPref, knownCapCr, smallMidCounts, passesSmallMid, SMALL_MID_MAX_CR } from '@/lib/small-mid-filter';
const RADAR_MIN_CAP_CR = 500; // Microcaps remain available when Small & mid toggle is off.
import type { TransformationRadarData, TransformScreenPayload } from './types';
import { TF, TFM, TIER_COLOR, CONV_TIER_COLOR } from './constants';
import { velocityColor } from './helpers';
import { FeedStatusNote } from './FeedStatusNote';
import { RadarCard } from './radar-card';   // zzz1214
import { radarDecision, type RadarQueue } from '@/lib/concall-radar-decision';

export function TfSection({ n, title, lede, children }: { n: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: lede ? 5 : 12, borderTop: `1px solid ${TF.border}`, paddingTop: 16 }}>
        <span style={{ ...TFM, fontSize: 11, color: TF.saffron, fontWeight: 700 }}>{n}</span>
        <h3 style={{ fontSize: 16, fontWeight: 900, color: TF.text, margin: 0 }}>{title}</h3>
      </div>
      {lede && <div style={{ fontSize: 12.5, color: TF.muted, lineHeight: 1.55, marginBottom: 12, maxWidth: 900 }}>{lede}</div>}
      {children}
    </div>
  );
}

export function TfChip({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span style={{ ...TFM, fontSize: 11, padding: '4px 8px', borderRadius: 5, background: TF.card2, border: `1px solid ${tone || TF.border}`, color: TF.text, display: 'inline-block' }}>{children}</span>;
}

export function TfCard({ title, accent, children }: { title?: string; accent?: string; children: ReactNode }) {
  return (
    <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderLeft: accent ? `3px solid ${accent}` : `1px solid ${TF.border}`, borderRadius: 8, padding: '13px 15px', marginBottom: 10 }}>
      {title && <div style={{ ...TFM, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: accent || TF.cyan, textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>}
      <div style={{ fontSize: 12.5, color: TF.text2, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

export function TfTable({ head, rows, firstAccent }: { head: string[]; rows: (string | number)[][]; firstAccent?: boolean }) {
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${TF.border}`, borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: Math.max(480, head.length * 120) }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ ...TFM, textAlign: 'left', padding: '9px 11px', fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: TF.dim, borderBottom: `1px solid ${TF.border}`, background: TF.card2, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${TF.border}` : 'none' }}>
              {r.map((c, ci) => <td key={ci} style={{ padding: '9px 11px', color: ci === 0 ? TF.text : TF.text2, fontWeight: ci === 0 ? 700 : 400, whiteSpace: ci === 0 ? 'nowrap' : 'normal', borderLeft: ci === 0 && firstAccent ? `3px solid ${TF.saffron}` : undefined }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- AUTOMATIC RADAR — renders on every analysed transcript ----
export function TransformationRadar({ t, ticker }: { t: TransformationRadarData; ticker: string }) {
  const stagePct = Math.round((t.stage / 10) * 100);
  const sweet = t.stage_sweet_spot;
  const evCol = t.evidence_score >= 8 ? TF.green : t.evidence_score >= 5 ? TF.amber : t.evidence_score >= 1 ? TF.saffron : TF.dim;
  return (
    <div style={{ background: TF.card, border: `1px solid ${sweet ? TF.green : TF.border}`, borderLeft: `4px solid ${sweet ? TF.green : TF.cyan}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: TF.text }}>🚀 Multibagger Transformation Radar <span style={{ ...TFM, fontSize: 10, color: TF.dim, fontWeight: 600 }}>· auto-detected{ticker ? ` · ${ticker}` : ''}</span></div>
        <div style={{ ...TFM, fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 6, color: sweet ? TF.green : TF.cyan, background: `color-mix(in srgb, ${sweet ? TF.green : TF.cyan} 13%, transparent)` }}>{sweet ? '✅ SWEET SPOT · stage 3–7' : 'stage-based read'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 12 }}>
        {[['Inflection stage', `${t.stage}/10`, sweet ? TF.green : TF.text], ['Evidence score', `${t.evidence_score}/11`, evCol], ['Patterns detected', String(t.pattern_count), t.pattern_count >= 3 ? TF.green : TF.text], ['Pattern breadth', t.velocity, /fast/i.test(t.velocity) ? TF.green : TF.text]].map((s, i) => (
          <div key={i} style={{ background: TF.card2, border: `1px solid ${TF.border}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ ...TFM, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: TF.dim }}>{s[0]}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: s[2] as string, marginTop: 3 }}>{s[1]}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 7, borderRadius: 4, background: TF.card2, position: 'relative', marginBottom: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${stagePct}%`, background: `linear-gradient(90deg, ${TF.red}, ${TF.amber} 50%, ${TF.green})` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...TFM, fontSize: 8.5, color: TF.dim, marginBottom: 12 }}><span>0 talk</span><span>3 facility</span><span>5 first order</span><span>7 accelerates</span><span>10 re-expand</span></div>
      <div style={{ fontSize: 11.5, color: TF.muted, marginBottom: t.evidence_quote ? 4 : 10 }}>Strongest evidence: <strong style={{ color: evCol }}>{t.evidence_label}</strong>{typeof t.evidence_breadth === 'number' && t.evidence_breadth > 1 ? <span style={{ color: TF.dim }}> · {t.evidence_breadth} proof points</span> : null}</div>
      {t.evidence_quote ? (
        <div style={{ fontSize: 11, color: TF.text2, marginBottom: 10, padding: '7px 10px', borderLeft: `3px solid ${evCol}`, background: 'rgba(255,255,255,0.03)', borderRadius: 4, fontStyle: 'italic', lineHeight: 1.5 }}>
          “{t.evidence_quote}” <span style={{ color: TF.dim, fontStyle: 'normal' }}>— verify against the transcript before acting</span>
        </div>
      ) : null}
      {typeof t.caution_level === 'number' && t.caution_level >= 1 && (
        <div style={{ fontSize: 11, fontWeight: 700, color: t.caution_level >= 2 ? '#EF4444' : '#F59E0B', marginBottom: 10, padding: '6px 10px', borderRadius: 4, background: t.caution_level >= 2 ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', border: `1px solid ${t.caution_level >= 2 ? '#EF444455' : '#F59E0B55'}` }}>
          {t.caution_level >= 2 ? '⛔ CAUTIOUS CONCALL — downgraded' : '⚠️ MIXED quarter'}{t.caution_flags && t.caution_flags.length ? `: ${t.caution_flags.join(' · ')}` : ''}. The positive signal is outweighed — do not treat as a clean buy.
        </div>
      )}
      {t.patterns.length > 0 && (
        <>
          <div style={{ ...TFM, fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: TF.dim, marginBottom: 7 }}>Transformation patterns detected</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>{t.patterns.map((p, i) => <TfChip key={i} tone={`${TF.green}55`}>{p.emoji} {p.label} <span style={{ color: TF.dim }}>×{p.hits}</span></TfChip>)}</div>
        </>
      )}
      <div style={{ ...TFM, fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: TF.dim, marginBottom: 7 }}>Triple inflection ({t.triple.count}/3)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {([['① Industry', t.triple.industry], ['② Company', t.triple.company], ['③ Financial', t.triple.financial]] as Array<[string, boolean]>).map(([lab, on], i) => (
          <span key={i} style={{ ...TFM, fontSize: 11, padding: '5px 10px', borderRadius: 6, border: `1px solid ${on ? TF.green : TF.border}`, background: on ? `color-mix(in srgb, ${TF.green} 12%, transparent)` : 'transparent', color: on ? TF.green : TF.dim, fontWeight: 700 }}>{on ? '✓' : '○'} {lab}</span>
        ))}
      </div>
      {t.events.length > 0 && (
        <>
          <div style={{ ...TFM, fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: TF.dim, marginBottom: 7 }}>Event keywords in transcript</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{t.events.map((e, i) => <span key={i} style={{ ...TFM, fontSize: 10, padding: '3px 7px', borderRadius: 4, background: TF.card2, border: `1px solid ${TF.border}`, color: TF.text2 }}>{e.kw} <span style={{ color: TF.saffron }}>{e.hits}</span></span>)}</div>
        </>
      )}
      <div style={{ ...TFM, fontSize: 9.5, color: TF.dim, marginTop: 12, lineHeight: 1.6 }}>Chain: TAILWIND → TRANSFORMATION → VALIDATION → EARNINGS INFLECTION → FCF → RE-RATING → MULTIBAGGER · deterministic keyword + evidence read of one transcript, not a recommendation. Open the 🚀 Transformation tab for the full framework.</div>
    </div>
  );
}

// ---- FULL FRAMEWORK TAB ----
export function TransformationFrameworkTab({ lastRadar, lastTicker }: { lastRadar: TransformationRadarData | null; lastTicker: string }) {
  return (
    <div>
      <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${TF.saffron} 8%, transparent), transparent 70%)` }}>
        <div style={{ ...TFM, fontSize: 10, letterSpacing: 1.4, color: TF.saffron, textTransform: 'uppercase', marginBottom: 8 }}>Multibagger transformation hunting</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: TF.text, lineHeight: 1.25, marginBottom: 8 }}>Find the company <span style={{ color: TF.saffron }}>before</span> the earnings reveal what it is becoming.</div>
        <div style={{ fontSize: 12.5, color: TF.text2, lineHeight: 1.55, maxWidth: 900 }}>The best multibaggers are rarely the companies with the best numbers <em>today</em> — they are companies where future earnings power is changing <strong style={{ color: TF.text }}>faster than the market’s perception of it</strong>. The master chain: <span style={{ ...TFM, color: TF.text }}>TAILWIND → TRANSFORMATION → VALIDATION → EARNINGS INFLECTION → FCF → RE-RATING → MULTIBAGGER</span>.</div>
      </div>

      {lastRadar
        ? (<div style={{ marginBottom: 20 }}><div style={{ ...TFM, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: TF.dim, marginBottom: 8 }}>▶ Auto-radar · last analysed transcript</div><TransformationRadar t={lastRadar} ticker={lastTicker} /></div>)
        : (<div style={{ background: TF.card2, border: `1px dashed ${TF.border}`, borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 12.5, color: TF.muted }}>💡 Paste a transcript / PDF in the <strong style={{ color: TF.text }}>🔥 Live Feeds → Manual Analyser</strong> and the <strong style={{ color: TF.saffron }}>Transformation Radar</strong> auto-runs on it — detecting patterns, event keywords, evidence stage and velocity. The framework below is the manual it scores against.</div>)}

      {/* 1 — 15 patterns */}
      <TfSection n="01" title="The 15 transformation patterns" lede={<>Don’t look for one pattern — look for <strong style={{ color: TF.text }}>3–5 occurring simultaneously</strong>. Each is a keyword the auto-radar scans for.</>}>
        <TfTable firstAccent head={['#', 'Pattern', 'What you hunt', 'Why it can explode']} rows={[
          [1, '🟢 Low → High Margin', 'Commodity → premium / value-added', 'Margin × revenue'],
          [2, '🔵 Commodity → CDMO', 'API → contract manufacturing', 'Recurring + higher valuation'],
          [3, '🟠 Debt → Growth', 'Debt falling while revenue rises', 'Interest ↓ + PAT ↑'],
          [4, '🟣 Traditional → Technology', 'Industrial → semiconductor / EV / AI', 'TAM + multiple expansion'],
          [5, '🟡 Capacity Inflection', 'Large new plant', 'Revenue operating leverage'],
          [6, '🔴 Customer Inflection', 'Qualification → commercial order', 'Validates capability'],
          [7, '🟦 Parent Transformation', 'Global parent enters / expands', 'Technology + customers + capital'],
          [8, '🟩 Acquisition Transformation', 'Weak company buys a capability', 'New business economics'],
          [9, '🟪 Product-Mix Shift', 'Low-value → high-value products', 'Same revenue, higher EBITDA'],
          [10, '🟧 TAM Expansion', 'Small market → huge new market', 'Revenue multiplies w/o share gain'],
          [11, '🟨 Export Inflection', 'Domestic → global supply', 'Larger TAM + FX advantage'],
          [12, '🟥 Utilisation Inflection', 'Underutilised → full utilisation', 'Massive operating leverage'],
          [13, '🔷 Recurring Revenue', 'Project/order → repeat programs', 'Visibility + higher multiple'],
          [14, '🔶 Consolidation Winner', 'Fragmented → share gains', 'Scale + pricing power'],
          [15, '⚫ Perception Transformation', '“Boring” → “quality growth”', 'P/E re-rating'],
        ]} />
      </TfSection>

      {/* 2 — inflection ladder */}
      <TfSection n="02" title="The 10-stage inflection ladder" lede={<>Where a story sits on this ladder decides risk vs reward. <strong style={{ color: TF.text }}>Sweet spot = stages 3–7</strong> — too early is execution risk, too late is already priced. The auto-radar estimates this stage from the transcript.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
          {[['0', 'Opportunity talk', '🔴 Very low', TF.red], ['1', 'Strategy announced', '🟠 Low', TF.saffron], ['2', 'Partnership / capex', '🟡', TF.amber], ['3', 'Facility ready', '🟡🟢', TF.amber], ['4', 'Customer qualification', '🟢', TF.green], ['5', 'First commercial order', '🟢🟢', TF.green], ['6', 'First revenue', '🔥', TF.green], ['7', 'Revenue accelerates', '🔥🔥', TF.green], ['8', 'Margin expands', '🔥🔥🔥', TF.green], ['9', 'Second/third customer', '🔥🔥🔥🔥', TF.green], ['10', 'Capacity expanded again', '🚀', TF.cyan]].map((r, i) => {
            const sweet = i >= 3 && i <= 7;
            return (
              <div key={i} style={{ background: TF.card, border: `1px solid ${sweet ? TF.green : TF.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ ...TFM, fontSize: 9, color: TF.dim }}>STAGE {r[0]}{sweet ? ' · sweet spot' : ''}</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: TF.text, margin: '2px 0 3px' }}>{r[1]}</div>
                <div style={{ fontSize: 12 }}>{r[2]}</div>
              </div>
            );
          })}
        </div>
      </TfSection>

      {/* 3 — story to evidence */}
      <TfSection n="03" title="Story → Evidence score" lede={<>Management story = <strong style={{ color: TF.text }}>hypothesis</strong>. Customer + revenue + margin + cash = <strong style={{ color: TF.text }}>evidence</strong>. Score the strength of what was actually said (1 weakest → 11 strongest) — this is exactly what the radar computes.</>}>
        <TfTable head={['Score', 'Evidence']} rows={[[1, 'Management statement'], [2, 'Investor presentation / guidance'], [3, 'Capex approved · partnership signed'], [4, 'Facility ready'], [5, 'Customer qualification'], [6, 'Order received'], [7, 'Commercial production'], [8, 'Revenue visible'], [9, 'Margin improvement'], [10, 'FCF improvement'], [11, 'Second customer / product']]} />
      </TfSection>

      {/* 4 — event scanner keywords */}
      <TfSection n="04" title="The event scanner — every keyword" lede="The radar scans filings/transcripts for these words, then scores the evidence rather than merely counting. All keywords are live in the auto-detector.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {['ACQUISITION', 'CAPACITY', 'COMMERCIAL PRODUCTION', 'QUALIFICATION', 'CUSTOMER APPROVAL', 'NEW PRODUCT', 'PREMIUM', 'VALUE ADDED', 'PRODUCT MIX', 'EXPORT', 'TECHNOLOGY', 'PARTNERSHIP', 'JOINT VENTURE', 'CDMO', 'CONTRACT MANUFACTURING', 'SEMICONDUCTOR', 'DEFENCE', 'AEROSPACE', 'EV', 'AI', 'DATA CENTRE', 'TRANSFORMER', 'GRID', 'DEBT REDUCTION', 'CAPEX', 'ORDER BOOK', 'BATTERY', 'USFDA', 'PLI', 'OPERATING LEVERAGE', 'UTILISATION', 'MARGIN EXPANSION', 'RECURRING', 'FORWARD INTEGRATION', 'DESIGN WIN', 'TAM', 'GREENFIELD', 'BROWNFIELD', 'DELEVERAGING', 'FREE CASH FLOW'].map((k) => <TfChip key={k}>{k}</TfChip>)}
        </div>
      </TfSection>

      {/* 5 — equation + future PE */}
      <TfSection n="05" title="The multibagger equation & the future-P/E trick" lede={<>Future Market Cap = <strong style={{ color: TF.text }}>Future Revenue × Future Net Margin × Future P/E</strong>. Never judge on today’s P/E — a 50× today can be 10× on FY31 earnings if the transformation is real.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
          <TfCard title="Worked example" accent={TF.green}>
            <div style={{ ...TFM, fontSize: 12, lineHeight: 1.9 }}>
              Revenue &nbsp;₹1,000 Cr → ₹3,000 Cr &nbsp;<span style={{ color: TF.green }}>(3×)</span><br />
              PAT margin &nbsp;5% → 10% &nbsp;<span style={{ color: TF.green }}>(2×)</span><br />
              P/E &nbsp;25× → 30× &nbsp;<span style={{ color: TF.green }}>(1.2×)</span><br />
              Market cap &nbsp;₹1,250 Cr → <strong style={{ color: TF.green }}>₹9,000 Cr</strong><br />
              <span style={{ color: TF.saffron }}>= 3 × 2 × 1.2 = 7.2×</span>
            </div>
          </TfCard>
          <TfCard title="The future-P/E flip" accent={TF.cyan}>
            <div style={{ fontSize: 12.5, color: TF.muted, lineHeight: 1.6 }}>Market cap ₹5,000 Cr · PAT ₹100 Cr = <strong style={{ color: TF.text }}>50× (looks expensive)</strong>. But if research supports FY31 PAT ₹500 Cr → that’s <strong style={{ color: TF.green }}>10× forward</strong>. The question flips from “is 50× expensive?” to <strong style={{ color: TF.text }}>“can ₹500 Cr PAT actually happen?”</strong> — which is the right question.</div>
          </TfCard>
        </div>
      </TfSection>

      {/* 6 — earnings bridge */}
      <TfSection n="06" title="The earnings bridge — where does the 5× come from?" lede="For every candidate, force yourself to build the driver-by-driver bridge. If you cannot name where the 5× earnings come from, it is not a multibagger thesis.">
        <TfTable head={['Earnings driver', 'FY26', 'FY27E', 'FY28E', 'FY29E', 'FY30E']} rows={[['Existing business', '—', '—', '—', '—', '—'], ['New product', '—', '—', '—', '—', '—'], ['New plant', '—', '—', '—', '—', '—'], ['New customer', '—', '—', '—', '—', '—'], ['Export', '—', '—', '—', '—', '—'], ['CDMO', '—', '—', '—', '—', '—'], ['Acquisition', '—', '—', '—', '—', '—'], ['→ Total revenue', '—', '—', '—', '—', '—'], ['→ EBITDA', '—', '—', '—', '—', '—'], ['→ PAT', '—', '—', '—', '—', '—'], ['→ FCF', '—', '—', '—', '—', '—']]} />
      </TfSection>

      {/* 7 — revenue quality */}
      <TfSection n="07" title="The revenue-quality test" lede="Two companies can both grow 25% — but one deserves double the multiple. Track revenue QUALITY, not just revenue growth.">
        <TfTable head={['Dimension', 'Company A', 'Company B (worth more)']} rows={[['Type', 'Commodity', 'Specialty'], ['Orders', 'One-off', 'Recurring'], ['Geography', 'Domestic', 'Global'], ['Margin', 'Low', 'High'], ['Switching cost', 'Low', 'High'], ['Cash conversion', 'WC-heavy', 'Better'], ['Customers', '5 spot', '2 sticky Tier-1']]} />
      </TfSection>

      {/* 8 — management credibility */}
      <TfSection n="08" title="Management credibility score" lede="Management can manufacture narratives. Score behaviour, not adjectives.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          <TfCard title="Credibility ↑" accent={TF.green}>{[['Meets guidance', '+5'], ['Beats conservative guidance', '+5'], ['Gives measurable KPIs', '+3'], ['Gives customer milestones', '+3'], ['Reports capex honestly', '+3'], ['Transparent cash flow', '+3']].map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}><span style={{ color: TF.muted }}>{r[0]}</span><span style={{ ...TFM, color: TF.green, fontWeight: 700 }}>{r[1]}</span></div>)}</TfCard>
          <TfCard title="Credibility ↓" accent={TF.red}>{[['Repeatedly misses guidance', '−5'], ['Constant narrative changes', '−5'], ['Promotional language', '−5'], ['Aggressive accounting', '−10'], ['Excessive dilution', '−5'], ['Related-party concerns', '−10']].map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}><span style={{ color: TF.muted }}>{r[0]}</span><span style={{ ...TFM, color: TF.red, fontWeight: 700 }}>{r[1]}</span></div>)}</TfCard>
        </div>
      </TfSection>

      {/* 9 — cash / capex / order book */}
      <TfSection n="09" title="The three validation tests — cash, capex, order book" lede="A transformation that never generates cash is dangerous. Interrogate each claim.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
          <TfCard title="Cash-flow validation" accent={TF.green}>Don’t trust PAT ↑ if CFO ↓ and receivables ↑↑. Check <strong style={{ color: TF.text }}>CFO/PAT</strong>, receivables-growth vs revenue-growth, <strong style={{ color: TF.text }}>FCF = CFO − Capex</strong>, and <strong style={{ color: TF.text }}>FCF/EBITDA</strong> conversion.</TfCard>
          <TfCard title="The capex test" accent={TF.amber}>Best: <span style={{ color: TF.green }}>capex → customer → utilisation → FCF</span>. Worst: <span style={{ color: TF.red }}>capex → debt → no customer → idle plant</span>. Demand confirmed? Customer identified? Completion date? Funding controlled? ROCE attractive?</TfCard>
          <TfCard title="The order-book test" accent={TF.cyan}>Coverage = order book / annual revenue — but <strong style={{ color: TF.text }}>quality &gt; size</strong>. ₹3,000 Cr at 3% margin is worthless; ₹1,000 Cr at 20%+ (repeat OEM / multi-year / Tier-1 / reserved capacity) is transformational.</TfCard>
        </div>
      </TfSection>

      {/* 10 — fundamental x technical */}
      <TfSection n="10" title="Fundamental × technical matrix" lede="Fundamentals identify the company; price tells you whether the market is beginning to recognise it. The sweet spot: fundamentals improving + price beginning to confirm.">
        <TfTable head={['', 'Price weak', 'Price strong']} rows={[['Fundamentals weak', '🔴 Avoid', '🔴 Speculation'], ['Fundamentals improving', '🟡 Early research', '🟢 Best setup'], ['Fundamentals strong', '🟡 Valuation opportunity', '🔥 Momentum'], ['Fundamentals exceptional', '🟢 Accumulation', '🔥🔥 Highest conviction']]} />
      </TfSection>

      {/* 11 — scorecard + velocity + consensus */}
      <TfSection n="11" title="The 150-point scorecard (+ velocity + distance from consensus)" lede={<>Fifteen factors × 10. <span style={{ ...TFM, color: TF.green }}>125–150 exceptional</span> · <span style={{ ...TFM, color: TF.green }}>115–124 high conviction</span> · <span style={{ ...TFM, color: TF.amber }}>100–114 strong</span> · <span style={{ ...TFM, color: TF.amber }}>85–99 watch</span> · <span style={{ ...TFM, color: TF.saffron }}>70–84 speculative</span> · <span style={{ ...TFM, color: TF.red }}>&lt;70 reject</span>.</>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>{['Industry tailwind', 'TAM expansion', 'Revenue acceleration', 'Margin expansion', 'Product mix', 'New business', 'Capacity', 'Customer validation', 'Debt reduction', 'Cash conversion', 'Management credibility', 'Competitive advantage', 'Valuation', 'Operating leverage', 'Recognition gap'].map((f) => <TfChip key={f}>{f} <span style={{ color: TF.dim }}>/10</span></TfChip>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          <TfCard title="+ Transformation velocity" accent={TF.saffron}>How fast is it changing? <span style={{ color: TF.dim }}>Slow</span> (5-yr product) · <span style={{ color: TF.amber }}>Medium</span> (product + capacity 2–3 yr) · <span style={{ color: TF.green }}>Fast</span> (customer + capacity + revenue + margin in 12–18m) · <span style={{ color: TF.green }}>Very fast</span> (multiple transformations at once). The radar reports this automatically.</TfCard>
          <TfCard title="+ Distance from consensus (asymmetry)" accent={TF.cyan}>Market doesn’t understand it <span style={{ ...TFM, color: TF.green }}>+10</span> · only specialists see it <span style={{ ...TFM, color: TF.green }}>+8</span> · revenue beginning <span style={{ ...TFM }}>+6</span> · earnings beginning <span style={{ ...TFM }}>+4</span> · analysts modelling <span style={{ ...TFM }}>+2</span> · consensus fully understands <span style={{ ...TFM }}>0</span> · extreme consensus <span style={{ ...TFM, color: TF.red }}>−5</span>. Ideal: <strong style={{ color: TF.text }}>strong transformation + weak recognition</strong>.</TfCard>
        </div>
      </TfSection>

      {/* 12 — what must go right / what can kill it */}
      <TfSection n="12" title="What must go right? · What can kill it?" lede="If only one thing must go right, risk is high. If five independent things can each create growth, the thesis is robust. And a professional always writes the kill-list.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          <TfCard title="5-year — what must go right (e.g. Morepen)" accent={TF.green}>{['₹825 Cr CDMO ramps', 'Additional customers arrive', 'CDMO margins hold', 'Capacity expands', 'API stays healthy', 'FCF improves', 'Market re-rates the multiple'].map((x, i) => <div key={i} style={{ fontSize: 12, color: TF.muted, padding: '2px 0 2px 14px', position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: TF.green }}>✓</span>{x}</div>)}</TfCard>
          <TfCard title="What can kill the thesis" accent={TF.red}>{['New product fails', 'Customer cancels', 'Capex delay', 'Debt rises', 'Margin disappoints', 'Regulation', 'Commodity price', 'Promoter issue', 'Working capital', 'Valuation compression'].map((x, i) => <div key={i} style={{ fontSize: 12, color: TF.muted, padding: '2px 0 2px 14px', position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: TF.red }}>✕</span>{x}</div>)}</TfCard>
        </div>
      </TfSection>

      {/* 13 — two universes */}
      <TfSection n="13" title="Two universes — why the screener is only the start" lede="A future multibagger can have temporarily poor margins, recent capex/acquisition, a new product not yet contributing, or debt currently high but falling. The classic screen misses exactly these.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          <TfCard title="Universe A — financially proven" accent={TF.cyan}>Good numbers today: Sales &amp; profit 3Y &gt;15% · ROCE &gt;15% · D/E &lt;0.75 or falling · CFO positive · promoter &gt;40%. Safe, but the market often already sees it.</TfCard>
          <TfCard title="Universe B — transformation early" accent={TF.saffron}>Numbers not yet fully good, but evidence of future earnings power is rising. <strong style={{ color: TF.text }}>This is where the biggest discoveries live</strong> — and where the auto-radar earns its keep by scoring evidence the screener can’t see.</TfCard>
        </div>
      </TfSection>

      {/* 14 — case studies */}
      <TfSection n="14" title="Live case-study map" lede={<>Where real transformations currently sit on the ladder. <em>Case studies, not buy recommendations; the stage is an analytical estimate.</em></>}>
        <TfTable head={['Company', 'Transformation', 'Evidence now', 'Stage']} rows={[
          ['Bosch Home Comfort', 'Parent + premium + export + capacity', '€80m India investment; export plan; Q1 sales +28.5%, PAT +49.4%', '5–7'],
          ['Morepen Labs', 'API → CDMO', '₹825 Cr mandate; commercial dispatches; Q1 EBITDA +207%, PAT +394%', '6–8'],
          ['Dhoot Transmission', 'Harness → EV components', 'Non-harness 23%; battery/DC-DC/OBC/charging guns; ₹10bn capex', '3–6'],
          ['Gujarat Themis Biosyn', 'API → forward integration', 'Sanofi anti-TB portfolio (13 brands, 55+ countries) acquisition', '2–4'],
          ['Laurus Labs', 'API → CDMO platform', 'Large active CDMO pipeline + commercial capacity', '6–8'],
        ]} />
      </TfSection>

      {/* 15 — decision tree */}
      <TfSection n="15" title="The final decision tree" lede="Every gate must be YES. One NO and it is not (yet) a future-multibagger candidate.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['Structural tailwind?', 'Business transformation?', 'Customer / capex / product validation?', 'Revenue inflection?', 'Margin inflection?', 'Cash-flow validation?', 'Management credible?', 'Future earnings 3–5× possible?', 'Market not fully pricing it?', 'Valuation + price structure acceptable?'].map((g, i) => (
            <span key={i} style={{ ...TFM, fontSize: 11, padding: '6px 10px', borderRadius: 6, background: TF.card2, border: `1px solid ${TF.border}`, color: TF.text }}><span style={{ color: TF.green, fontWeight: 700 }}>✓</span> {g}</span>
          ))}
          <span style={{ ...TFM, fontSize: 11, padding: '6px 12px', borderRadius: 6, background: `color-mix(in srgb, ${TF.green} 14%, transparent)`, border: `1px solid ${TF.green}`, color: TF.green, fontWeight: 800 }}>🔥 FUTURE MULTIBAGGER CANDIDATE</span>
        </div>
      </TfSection>

      {/* 16 — one page + the difference */}
      <TfSection n="16" title="The one-page version + the real skill" lede="Memorise the chain; internalise the difference.">
        <div style={{ ...TFM, fontSize: 12, color: TF.text2, lineHeight: 1.9, background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
          HOT INDUSTRY → SMALL/MID COMPANY → BUSINESS-MODEL CHANGE → NEW HIGH-MARGIN PRODUCT → CUSTOMER VALIDATION → CAPACITY → DEBT REDUCTION → REVENUE ACCELERATION → MARGIN EXPANSION → FCF INFLECTION → LOW MARKET RECOGNITION → REASONABLE FUTURE VALUATION = <span style={{ color: TF.green, fontWeight: 700 }}>🚀 MULTIBAGGER CANDIDATE</span>
        </div>
        <TfCard title="The most important difference" accent={TF.saffron}>
          A normal investor says: “Sales grew 20%, ROCE is 20%, debt is low.” <br />The framework says: <strong style={{ color: TF.text }}>“The company is moving from a ₹1,000 Cr low-margin business toward a ₹3,000 Cr higher-margin business because a structural market is opening, a Tier-1 customer validated the technology, capacity is being added, and debt is falling — so FY30 earnings are materially higher than today implies, and the market is still valuing the old business.”</strong> You are no longer screening stocks; you are underwriting a company’s future identity. Don’t search for the next Morepen — search for companies at the stage Morepen was <em>before</em> the ₹825 Cr story became commercial revenue.
        </TfCard>
        <TfCard title="Weekly routine">Mon — corporate actions + acquisitions (30m) · Tue — new products / capex / orders (30m) · Wed — earnings + transcripts (60m) · Thu — debt + cash-flow changes (30m) · Fri — price / relative strength (30m) · Weekend — deep-dive top 5 (3–4h). Re-score every candidate monthly.</TfCard>
        <div style={{ ...TFM, fontSize: 10, color: TF.dim, marginTop: 10, lineHeight: 1.6 }}>Educational framework — not investment advice. Case-study figures are approximate and drawn from public disclosures; stage classifications are analytical estimates, not published ratings. The radar is a deterministic keyword + evidence read of a single transcript.</div>
      </TfSection>
    </div>
  );
}

const EXCLUDED_LABEL: Record<string, string> = {
  MEETING_SCHEDULE: 'meeting schedules', CALL_INVITE: 'call invites', RECORDING_LINK: 'recording links', ADMIN_NOTICE: 'routine notices',
  NO_ATTACHMENT: 'without attachment', TRANSCRIPT_LINK_ONLY: 'transcript links only', COVER_LETTER_ONLY: 'covering letters only', UNREADABLE: 'unreadable PDFs',
};

export function TransformationScreenerTab() {
  const [days, setDays] = useState<number>(60);
  // zzz1212 — null = automatic: Underwrite when it holds names, otherwise All (an empty default queue read as "radar broken")
  const [decisionPick, setDecisionFilter] = useState<RadarQueue | 'ALL' | null>(null);
  const [laneFilter, setLaneFilter] = useState<'ALL' | 'INFLECTION' | 'EARLY' | 'NONE'>('ALL');   // zzz1214
  const [bestPick, setBestPick] = useState<boolean | null>(null);   // zzz1214 — null = on when any company passes
  const [showFullSignals, setShowFullSignals] = useState(false);
  const [data, setData] = useState<TransformScreenPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const requestSeq = useRef(0);
  const refreshStartedAt = useRef<number | null>(null);
  const pendingSince = useRef<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // zzz433 — Conviction × Transformation: which radar names are ALSO on the bench
  const [bench, setBench] = useState<Record<string, ConvictionEntry>>({});
  useEffect(() => { try { setBench(readConvictionBeats()); } catch { setBench({}); } }, []);

  // zzz704 — and which of them are in the BOOK. A radar hit on a name he owns
  // is a reason to re-read a thesis; on a name he has never held it is a
  // reason to open one. Those are different jobs and the feed could not tell
  // them apart.
  const [owned, setOwned] = useState<Set<string>>(new Set());
  useEffect(() => { try { setOwned(readPortfolioSymbols()); } catch { setOwned(new Set()); } }, []);
  const benchKeys = useMemo(
    () => new Set(Object.keys(bench).map((k) => normSymbol(k))),
    [bench],
  );
  const [sourceFilter, setSourceFilter] = useState<SymbolSource | null>(null);
  // zzz898 — "Small & mid only" (default on, India ceiling ₹30,000 Cr). The radar feed carries no market
  // cap, so sizes are looked up (cached enrich, Screener figures); a name whose size is unknown stays, labelled.
  const [smallMidOnly, setSmallMidOnlyState] = useState<boolean>(true);
  useEffect(() => { setSmallMidOnlyState(readSmallMidPref('mc:radar:small-mid-only:v1')); }, []);
  const setSmallMidOnly = (on: boolean) => { setSmallMidOnlyState(on); writeSmallMidPref('mc:radar:small-mid-only:v1', on); };
  const [capMap, setCapMap] = useState<Map<string, number | null>>(new Map());
  const [capLoading, setCapLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreNote, setMoreNote] = useState<string | null>(null);

  const load = useCallback(async (d: number, force = false) => {
    const requestId = ++requestSeq.current;
    if (force) { refreshStartedAt.current = Date.now(); setMoreNote(null); }
    setLoading(true); setErr(null);
    try {
      // An uncached force refresh is a bounded request; the backend completes
      // its scan asynchronously and explicitly returns building=true.
      const r = await fetch(`/api/v1/concall-intel/transformation-screener?days=${d}&limit=500${force ? '&refresh=1' : ''}`, {
        cache: 'no-store', signal: AbortSignal.timeout(18_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: TransformScreenPayload = await r.json();
      if (requestId !== requestSeq.current) return;
      const refreshAt = refreshStartedAt.current;
      // A normal poll can return the previous *fresh* cache entry while a
      // forced rebuild is still running. Do not falsely mark that as done.
      const oldSnapshot = refreshAt != null && (!Date.parse(j.generated_at) ||
        Date.parse(j.generated_at) < refreshAt - 1_000);
      if ((refreshAt != null && Date.now() - refreshAt > 120_000) || (pendingSince.current != null && Date.now() - pendingSince.current > 120_000)) {
        refreshStartedAt.current = null;
        pendingSince.current = null;
        setBuilding(false);
        setErr('The Radar scan exceeded two minutes. The last verified results are retained; try again later.');
      } else if (j.building || oldSnapshot) {
        pendingSince.current ??= Date.now();
        setBuilding(true);
        setData((prev) => prev && prev.entries.length > 0 ? prev : j);
      } else {
        refreshStartedAt.current = null;
        pendingSince.current = null;
        setBuilding(false);
        setData(j);
        if (j.error) setErr(j.error);
      }
    } catch (e) {
      if (requestId !== requestSeq.current) return;
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (timedOut) {
        pendingSince.current ??= Date.now();
        if (Date.now() - pendingSince.current < 120_000) {
          setBuilding(true); // automatic cache-only polling, no new forced PDF extraction
          setErr('Data service is slow. Rechecking the saved scan automatically; existing research is retained.');
        } else {
          pendingSince.current = null;
          refreshStartedAt.current = null;
          setBuilding(false);
          setErr('Radar has not responded within two minutes. Existing research is retained; retry later.');
        }
      } else {
        refreshStartedAt.current = null;
        setBuilding(false);
        setErr(e instanceof Error ? e.message : 'load failed');
      }
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { refreshStartedAt.current = null; pendingSince.current = null; setMoreNote(null); setData(null); setBuilding(false); void load(days); }, [days, load]);
  // A pending scan is not an empty feed: poll the shared cached result
  // without another forced extraction. Avoid overlap while fetching.
  useEffect(() => {
    if (!building || loading) return;
    const timer = setTimeout(() => { void load(days); }, 8_000);
    return () => clearTimeout(timer);
  }, [building, loading, days, load]);

  // Partial/blocked exchange feeds are common. Retrying must not force a fresh
  // NSE/BSE + PDF scan every 90 seconds and saturate the application server.
  const feedState = data?.feed_status?.state ?? (data?.error ? 'FAILED' : undefined);
  const retries = useRef(0);
  useEffect(() => { retries.current = 0; }, [days]);
  useEffect(() => {
    if (building || loading || (feedState !== 'FAILED' && feedState !== 'PARTIAL')) return;
    if (retries.current >= 5) return;
    const t = setTimeout(() => { retries.current++; void load(days); }, 90_000);
    return () => clearTimeout(t);
  }, [feedState, building, loading, days, load]);

  // zzz1212 — read the next unread documents now. Every document's result is stored, so this never re-reads or skips
  // anything: the server reads the newest documents not read yet (40 at most) and returns the whole updated radar.
  // The same happens automatically every 20 minutes (scheduled coverage job).
  const loadMore = async () => {
    if (moreLoading || !data) return;
    setMoreLoading(true); setMoreNote(null);
    try {
      const r = await fetch(`/api/v1/concall-intel/transformation-screener?days=${days}&limit=500&more=1`, {
        cache: 'no-store', signal: AbortSignal.timeout(16_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const page: TransformScreenPayload = await r.json();
      if (page.building) {
        refreshStartedAt.current = Date.now();
        pendingSince.current ??= Date.now();
        setBuilding(true);
        setMoreNote('Reading the next unread documents in the background; the radar updates when they are done.');
        return;
      }
      if (page.error) throw new Error(page.error);
      setData(page);
      const n = page.funnel?.fresh_reads ?? 0;
      setMoreNote(n > 0 ? `Read ${n} more document${n === 1 ? '' : 's'}.` : 'Every eligible document in this window has already been examined.');
    } catch (e) {
      setMoreNote(e instanceof Error && e.name === 'TimeoutError' ? 'Still reading; the current results stay until it finishes.' : e instanceof Error ? e.message : 'Reading more documents is unavailable right now.');
    } finally { setMoreLoading(false); }
  };

  const allEntries = data?.entries ?? [];
  // zzz898 — look up the size of every ranked name (chunks of 40, best-effort; failures leave the size unknown)
  useEffect(() => {
    const syms = Array.from(new Set((data?.entries ?? []).filter((e) => typeof e.market_cap_cr !== 'number').map((e) => String(e.symbol || '').toUpperCase()).filter(Boolean)));
    if (syms.length === 0 || !smallMidOnly) { setCapLoading(false); return; }
    let alive = true;
    setCapLoading(true);
    (async () => {
      const m = new Map<string, number | null>();
      const chunks: string[][] = [];
      for (let i = 0; i < syms.length; i += 40) chunks.push(syms.slice(i, i + 40));
      await Promise.all(chunks.map(async (c) => {
        try {
          const r = await fetch(`/api/v1/earnings/enrich?symbols=${encodeURIComponent(c.join(','))}`, { signal: AbortSignal.timeout(12_000) });
          if (!r.ok) return;
          const j = await r.json();
          for (const s of c) m.set(s, knownCapCr(j?.data?.[s]?.market_cap_cr));
        } catch { /* size stays unknown */ }
      }));
      if (alive) { setCapMap(m); setCapLoading(false); }
    })();
    return () => { alive = false; };
  }, [data, smallMidOnly]);
  // zzz1214 — the scan carries each company's market cap from the stock-screener snapshot; the slow enrich lookup is only a fallback
  const serverCap = useMemo(() => { const m = new Map<string, number>(); for (const e of data?.entries ?? []) if (typeof e.market_cap_cr === 'number') m.set(String(e.symbol).toUpperCase(), e.market_cap_cr); return m; }, [data]);
  const capOf = (sym: unknown): number | null => serverCap.get(String(sym || '').toUpperCase()) ?? capMap.get(String(sym || '').toUpperCase()) ?? null;
  const sizeCounts = smallMidCounts(allEntries, (e) => capOf(e.symbol));
  const sourceOf = useCallback(
    (sym: unknown): SymbolSource => classifySource(sym, owned, benchKeys),
    [owned, benchKeys],
  );
  const ownedCount = allEntries.filter((e) => sourceOf(e.symbol) === 'portfolio').length;
  const scopedEntries = (sourceFilter
    ? allEntries.filter((e) => sourceOf(e.symbol) === sourceFilter)
    : allEntries).filter((e) => passesSmallMid(capOf(e.symbol), smallMidOnly) && (!smallMidOnly || capOf(e.symbol) == null || capOf(e.symbol)! >= RADAR_MIN_CAP_CR));
  const decisionCounts = {
    ALL: scopedEntries.length,
    RESEARCH: scopedEntries.filter((e) => radarDecision(e).queue === 'RESEARCH').length,
    RECONCILE: scopedEntries.filter((e) => radarDecision(e).queue === 'RECONCILE').length,
    WAIT: scopedEntries.filter((e) => radarDecision(e).queue === 'WAIT').length,
    RISK: scopedEntries.filter((e) => radarDecision(e).queue === 'RISK').length,
    UNVERIFIED: scopedEntries.filter((e) => radarDecision(e).queue === 'UNVERIFIED').length,
  };
  // zzz1214 — lanes + "best transformations only". The scan already orders best first; the queue filter stays available.
  const laneCounts = {
    ALL: scopedEntries.length,
    INFLECTION: scopedEntries.filter((e) => e.insight?.lane === 'INFLECTION').length,
    EARLY: scopedEntries.filter((e) => e.insight?.lane === 'EARLY').length,
    NONE: scopedEntries.filter((e) => (e.insight?.lane ?? 'NONE') === 'NONE').length,
  };
  const bestCount = scopedEntries.filter((e) => e.insight?.best).length;
  const bestOnly = bestPick ?? bestCount > 0;
  const decisionFilter: RadarQueue | 'ALL' = decisionPick ?? 'ALL';
  const entries = scopedEntries
    .filter((e) => !bestOnly || e.insight?.best)
    .filter((e) => laneFilter === 'ALL' || (e.insight?.lane ?? 'NONE') === laneFilter)
    .filter((e) => decisionFilter === 'ALL' || radarDecision(e).queue === decisionFilter);
  const fn = data?.funnel;
  const routineTotal = fn ? fn.routine.meeting_schedule + fn.routine.call_invite + fn.routine.recording_link + fn.routine.admin_notice + fn.routine.no_attachment : 0;
  const hiddenByFilters = allEntries.length - scopedEntries.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* header */}
      <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '16px 18px' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: TF.cyan, letterSpacing: '0.3px' }}>🔭 Transformation Radar — actionable filing shortlist</div>
        <div style={{ fontSize: 12.5, color: TF.muted, lineHeight: 1.6, marginTop: 6 }}>
          Reads concall transcripts, investor presentations and results documents. Only management's own words count as proof; each company is checked against its latest results, guidance and valuation. Unread companies are unchecked, not negative.
        </div>
        {/* controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: TF.dim, letterSpacing: '0.5px' }}>WINDOW</span>
          {[7, 30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              fontSize: 11.5, fontWeight: 800, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${days === d ? TF.cyan : TF.border}`,
              background: days === d ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
              color: days === d ? TF.cyan : TF.muted,
            }}>{d}d</button>
          ))}
          <button onClick={() => load(days, true)} disabled={loading || building} title="Start a new scan; the last verified results remain until it finishes" style={{
            fontSize: 11.5, fontWeight: 800, padding: '5px 12px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
            border: `1px solid ${TF.green}`, background: 'color-mix(in srgb, var(--mc-bullish) 10%, transparent)', color: TF.green,
          }}>{building ? '⏳ Rebuilding…' : loading ? '⏳ Loading…' : '↻ Rescan (fresh)'}</button>
          {data && (
            <span style={{ fontSize: 10.5, color: TF.dim, ...TFM }}>
              last scan {new Date(data.generated_at).toLocaleString('en-IN')}
            </span>
          )}
        </div>
        {/* zzz1212 — data health: every number says what it counts; routine notices and covering letters are never "analysed" */}
        {data && fn && (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 6 }}>
            {([
              ['Exchange feed', `NSE ${data.feed_status?.nse === 'OK' ? '✓' : '✗'} · BSE ${data.feed_status?.bse === 'OK' ? '✓' : '✗'}`, data.feed_status?.bse === 'OK' && data.feed_status?.nse === 'OK' ? TF.green : TF.amber,
                data.feed_status?.reason ? `Not complete: ${data.feed_status.reason}` : 'Both exchanges answered'],
              ['All announcements', fn.announcements_total != null ? fn.announcements_total.toLocaleString('en-IN') : '—', TF.text2, `Every NSE/BSE announcement in the last ${days} days (all types)`],
              ['Concall feed rows', fn.feed_rows.toLocaleString('en-IN'), TF.text2, 'Announcements the concall feed keeps (concall, results, orders, ratings …), NSE/BSE duplicates removed'],
              ['Routine notices', routineTotal.toLocaleString('en-IN'), TF.dim, `Never read: ${fn.routine.meeting_schedule} meeting schedules · ${fn.routine.call_invite} call invites · ${fn.routine.recording_link} recording links · ${fn.routine.admin_notice} admin notices · ${fn.routine.no_attachment} without attachment`],
              ['Documents to read', fn.eligible.toLocaleString('en-IN'), TF.cyan, 'Transcripts, investor presentations and results documents (by subject / file name)'],
              ['Read in full', fn.read_full.toLocaleString('en-IN'), TF.green, 'Substantive documents read and scored — the only "analysed" count'],
              ['Letter / link only', fn.cover_only.toLocaleString('en-IN'), TF.dim, 'The PDF was only a covering letter (e.g. "transcript is on our website"), so there was nothing to score'],
              ['Unreadable', fn.unreadable.toLocaleString('en-IN'), fn.unreadable ? TF.amber : TF.dim, 'Too large, scanned image, garbled text or download failed'],
              ['Not read yet', fn.not_yet_read.toLocaleString('en-IN'), fn.not_yet_read ? TF.amber : TF.green, 'Read automatically every 20 minutes, newest first'],
              ['With a signal', fn.with_signal.toLocaleString('en-IN'), TF.purple, 'Read in full and at least one transformation pattern found'],
            ] as const).map(([k, v, c, tip]) => (
              <div key={k} title={tip} style={{ background: TF.card2, border: `1px solid ${TF.border}`, borderRadius: 7, padding: '6px 9px' }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: c, ...TFM }}>{v}</div>
                <div style={{ fontSize: 9.5, color: TF.dim, marginTop: 1 }}>{k}</div>
              </div>
            ))}
          </div>
        )}
        {data && (data.coverage_note || (data.concalls_in_feed ?? 0) > 0) && (
          <div style={{ fontSize: 11, color: fn && fn.not_yet_read > 0 ? TF.amber : TF.muted, marginTop: 8, lineHeight: 1.55 }}>
            {data.coverage_note ?? `Coverage: ${data.analyzed} of ${data.concalls_in_feed} identified concall filings sampled. This is not a complete market scan; missed companies are not negative calls.`}
          </div>
        )}
        {data && !building && fn && fn.not_yet_read > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={loading || moreLoading} onClick={() => { void loadMore(); }}
              title="Read the next 40 unread transcripts / presentations now (newest first). This also happens automatically every 20 minutes."
              style={{ border: `1px solid ${TF.border}`, borderRadius: 6, background: TF.card2, color: TF.cyan,
                padding: '7px 11px', cursor: moreLoading ? 'wait' : 'pointer', fontSize: 11, fontWeight: 800 }}>
              {moreLoading ? 'Reading…' : `Read next ${Math.min(40, fn.not_yet_read)} unread documents now`}
            </button>
            {moreNote && <span role="status" style={{ fontSize: 11, color: TF.amber }}>{moreNote}</span>}
          </div>
        )}
        {building && (
          <p role="status" aria-live="polite" style={{ color: TF.amber, fontSize: 12, margin: '10px 0 0' }}>
            ⏳ Radar scanning in the background. Rechecking every 8 seconds; existing results are retained.
          </p>
        )}
        {/* zzz810 — honest feed status: reached or not, real counts */}
        <div style={{ marginTop: 10 }}>
          {data?.feed_status
            ? <FeedStatusNote status={data.feed_status} compact={data.feed_status.state === 'OK'} />
            : null}
        </div>
      </div>

      {/* zzz704 — WHOSE NAME IS THIS. Separating the feed by book / bench /
          neither is the difference between "re-read a thesis I already own"
          and "open a new one", which the radar could not express. */}
      {data && allEntries.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: TF.dim, fontWeight: 700, letterSpacing: '0.4px' }}>SHOW</span>
          {([null, 'portfolio', 'bench', 'other'] as (SymbolSource | null)[]).map((k) => {
            const on = sourceFilter === k;
            const m = k ? SOURCE_META[k] : { label: 'All', icon: '◈', color: TF.dim };
            const n = k ? allEntries.filter((e) => sourceOf(e.symbol) === k).length : allEntries.length;
            return (
              <button key={String(k)} onClick={() => setSourceFilter(k)}
                style={{
                  fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${m.color}${on ? '' : '55'}`,
                  background: on ? m.color : `${m.color}18`,
                  color: on ? '#0B1220' : m.color,
                }}>{m.icon} {m.label} {n}</button>
            );
          })}
          {/* zzz898 — Small & mid only (default on) */}
          <span style={{ width: 1, height: 14, background: TF.border, margin: '0 4px' }} />
          <button onClick={() => setSmallMidOnly(!smallMidOnly)}
            title={`Show ₹${RADAR_MIN_CAP_CR.toLocaleString('en-IN')}–₹${SMALL_MID_MAX_CR.toLocaleString('en-IN')} Cr. Unknown sizes remain visible but are not certified small/mid.`}
            style={{
              fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
              border: `1px solid #38BDF8${smallMidOnly ? '' : '55'}`,
              background: smallMidOnly ? '#38BDF8' : '#38BDF818',
              color: smallMidOnly ? '#0B1220' : '#38BDF8',
            }}>
            {smallMidOnly ? '✓ ' : ''}◧ ₹500–30,000 Cr only
            {smallMidOnly && sizeCounts.hiddenLarge > 0 ? ` · ${sizeCounts.hiddenLarge} large hidden` : ''}{smallMidOnly ? ` · ${allEntries.filter((e) => { const c = capOf(e.symbol); return c != null && c < RADAR_MIN_CAP_CR; }).length} microcaps hidden` : ''}
            {capLoading ? ' · sizes loading…' : sizeCounts.unknown > 0 ? ` · ${sizeCounts.unknown} size n/a` : ''}
          </button>
        </div>
      )}

      {/* zzz1214 — what to look at: best only, by lane, then the review queue */}
      {data && (
        <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
            <button type="button" onClick={() => setBestPick(!bestOnly)} aria-pressed={bestOnly}
              title="Best = a real transformation lane, positive management tone, proof quoted from management, results not slowing, guidance not cut, and (for an inflection) not already priced in."
              style={{ background: bestOnly ? '#FDE68A' : TF.card2, color: bestOnly ? '#7C2D12' : TF.text2, border: `1px solid ${bestOnly ? '#F59E0B' : TF.border}`,
                borderRadius: 999, fontSize: 11.5, fontWeight: 900, cursor: 'pointer', padding: '7px 12px' }}>
              {bestOnly ? '★ Best transformations only · ' : '☆ Show best only · '}{bestCount}
            </button>
            <span style={{ width: 1, height: 18, background: TF.border }} />
            {([
              ['ALL', 'All lanes', TF.cyan, 'Every company with a signal'],
              ['INFLECTION', 'Earnings inflection', '#10B981', 'The change is already in the reported numbers'],
              ['EARLY', 'Early transformation', '#0EA5E9', 'Capacity, customers, orders or approvals moving; not yet in the numbers'],
              ['NONE', 'No clear transformation', TF.dim, 'Keywords only, no milestones, or cautious'],
            ] as const).map(([key, label, color, tip]) => (
              <button key={key} type="button" title={tip} onClick={() => setLaneFilter(key)} aria-pressed={laneFilter === key}
                style={{ background: laneFilter === key ? `color-mix(in srgb, ${color} 18%, transparent)` : TF.card2, color,
                  border: `1px solid ${laneFilter === key ? color : TF.border}`, borderRadius: 7, fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: '6px 10px' }}>
                {label} · {laneCounts[key]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 9 }}>
            <span style={{ fontSize: 10, color: TF.dim, fontWeight: 800, letterSpacing: '0.4px' }}>REVIEW QUEUE</span>
            {([
              ['ALL', 'All', TF.cyan],
              ['RESEARCH', 'Underwrite', TF.green],
              ['RECONCILE', 'Conflicting', TF.amber],
              ['WAIT', 'Wait for proof', TF.amber],
              ['RISK', 'Guidance / risk', TF.red],
            ] as const).map(([key, label, color]) => (
              <button key={key} type="button" onClick={() => setDecisionFilter(key)} aria-pressed={decisionFilter === key}
                style={{ background: decisionFilter === key ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                  color, border: `1px solid ${decisionFilter === key ? color : TF.border}`, borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', padding: '4px 8px' }}>
                {label} · {decisionCounts[key]}
              </button>
            ))}
            <button type="button" onClick={() => setShowFullSignals(v => !v)} aria-pressed={showFullSignals}
              style={{ background: 'transparent', border: `1px solid ${TF.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: TF.text2, fontSize: 10.5, marginLeft: 'auto' }}>
              {showFullSignals ? 'Fold all details' : 'Open all details'}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: TF.dim, marginTop: 7, lineHeight: 1.5 }}>
            Showing {entries.length} of {scopedEntries.length}{hiddenByFilters > 0 ? ` (${hiddenByFilters} more hidden by the SHOW / size filter)` : ''}. Research priority, never a buy signal.
            {bestOnly && bestCount === 0 && ' No company passes every "best" rule yet — switch it off to see all.'}
          </div>
        </div>
      )}

      {err && !loading && !data?.feed_status && (
        <div style={{ background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: TF.text }}>
          ⚠ {err}{retries.current < 5 ? ' Retrying automatically.' : ' Press ↻ Rescan to try again.'}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: TF.dim, fontSize: 13 }}>⏳ Scanning the live feed for transformation patterns…</div>
      )}

      {data && !building && !loading && entries.length === 0 && !err && feedState !== 'FAILED' && (
        <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '18px' }}>
          <div style={{ fontSize: 13, color: TF.text2, lineHeight: 1.6 }}>
            {/* zzz1212 — say WHY the list is empty, from the funnel: never a blanket "nothing found" */}
            {scopedEntries.length > 0
              ? <>No company is in <b>{decisionFilter === 'RESEARCH' ? 'Underwrite thesis' : decisionFilter}</b> — that queue needs a positive filing tone, three distinct proof steps and two structural drivers, and none of the {scopedEntries.length} companies with a signal meets all of them yet. Select <b>All signals</b> to see them.</>
              : fn && fn.eligible === 0
                ? <>The feed holds no transcripts, investor presentations or results documents for the last {days} days ({routineTotal} routine notices skipped).</>
                : fn && fn.read_full === 0 && fn.not_yet_read > 0
                  ? <>None of the {fn.eligible} transcripts / presentations has been read yet — reading runs in the background (newest first); results appear here as they are read.</>
                  : fn && hiddenByFilters > 0 && allEntries.length > 0
                    ? <>{allEntries.length} compan{allEntries.length === 1 ? 'y has' : 'ies have'} a signal, but all are hidden by the SHOW / size filter.</>
                    : fn
                      ? <>The radar read <b style={{ color: TF.text }}>{fn.read_full}</b> document{fn.read_full === 1 ? '' : 's'} in full and found no transformation pattern{fn.not_yet_read > 0 ? <> — {fn.not_yet_read} more are not read yet, so this is not a final answer</> : ''}.</>
                      : data.analyzed > 0
                        ? <>The radar read <b style={{ color: TF.text }}>{data.analyzed}</b> filing{data.analyzed === 1 ? '' : 's'} from the last {days} days and found <b style={{ color: TF.amber }}>no transformation signal yet</b>.</>
                        : data.feed_status?.state === 'EMPTY'
                          ? <>{data.feed_status.message}</>
                          : <>The feed returned <b style={{ color: TF.text }}>{data.candidates_total}</b> filings for the last {days} days but none had a readable document to scan.</>}
          </div>
        </div>
      )}

      {/* zzz1212 — substantive documents read in full without a transformation pattern (never notices / letters) */}
      {data && !building && data.scanned_no_signal && data.scanned_no_signal.length > 0 && (
        <details style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 800, color: TF.dim, letterSpacing: '0.4px' }}>
            READ IN FULL · NO TRANSFORMATION PATTERN ({data.scanned_no_signal.length} newest)
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {data.scanned_no_signal.map((s, i) => (
              <div key={`${s.symbol}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 11px', background: TF.card2, border: `1px solid ${TF.border}`, borderRadius: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: TF.text2 }}>{s.symbol}</span>
                  <span style={{ fontSize: 10.5, color: TF.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{s.subject}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${TF.dim}18`, color: TF.dim }}>
                    {s.scored_from === 'PDF' ? `${s.doc_label || 'document'} read · no pattern` : 'subject only · not read'}
                  </span>
                  {s.attachment_url && <a href={s.attachment_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: TF.cyan, fontWeight: 700 }}>open →</a>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* zzz1212 — processing and excluded documents: every filing that was NOT scored, with the true reason */}
      {data && !building && data.excluded && data.excluded.length > 0 && (
        <details style={{ background: TF.card, border: `1px solid ${TF.border}`, borderRadius: 10, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 800, color: TF.dim, letterSpacing: '0.4px' }}>
            PROCESSING AND EXCLUDED DOCUMENTS
            {data.excluded_counts && <span style={{ fontWeight: 600, marginLeft: 8 }}>
              {Object.entries(data.excluded_counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${EXCLUDED_LABEL[k] || k.toLowerCase()}`).join(' · ')}
            </span>}
          </summary>
          <div style={{ fontSize: 10.5, color: TF.dim, margin: '8px 0', lineHeight: 1.5 }}>
            Not scored, newest first ({data.excluded.length} shown). Meeting schedules, invites and recording links are judged from the exchange subject; covering letters and unreadable PDFs from the document itself. When a company files the actual transcript as a new filing, that filing is read on the next scan.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.excluded.map((x, i) => (
              <div key={`${x.symbol}-${x.filing_datetime}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 120px) minmax(120px, 170px) 1fr auto', gap: 8, alignItems: 'baseline', padding: '6px 10px', background: TF.card2, border: `1px solid ${TF.border}`, borderRadius: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: TF.text2 }}>{x.symbol}</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: x.doc_class === 'UNREADABLE' ? TF.amber : TF.dim }}>{x.label}{x.basis === 'SUBJECT' ? ' (from subject)' : ''}</span>
                <span style={{ fontSize: 10.5, color: TF.muted, lineHeight: 1.4 }}>{x.reason}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  {x.link && <a href={x.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: TF.cyan, fontWeight: 700 }}>company link →</a>}
                  {x.attachment_url && <a href={x.attachment_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: TF.cyan, fontWeight: 700 }}>filing →</a>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* leaderboard — zzz1214 compact cards (radar-card.tsx) */}
      {entries.map((e, i) => (
        <RadarCard key={`${e.symbol}-${e.filing_datetime}-${i}`} e={e} rank={i + 1} bench={bench[e.symbol?.toUpperCase()]}
          inBook={sourceOf(e.symbol) === 'portfolio'} capCr={capOf(e.symbol)} showFullSignals={showFullSignals} />
      ))}

      {data && entries.length > 0 && (
        <div style={{ ...TFM, fontSize: 9.5, color: TF.dim, lineHeight: 1.6 }}>
          T-Score measures narrative and evidence-rung signals, NOT a buy opportunity or the age of the investment cycle. Positive and adverse passages must be reconciled for the same reporting period; OCR fragments, analyst questions and boilerplate do not prove operating results. Guidance, valuation and price setup still require independent checks. Chain: TAILWIND → TRANSFORMATION → VALIDATION → EARNINGS INFLECTION → FCF → RE-RATING. Open any name in the 🚀 Transformation tab framework, or paste its transcript in 🔥 Live Feeds for the full analysis. Educational, not investment advice.
        </div>
      )}
    </div>
  );
}
