'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { classifyTranscriptV2 } from './concallClassifierV2';
import { Fragment, useState, useEffect } from 'react';
import { C, STAGE_META, F } from './constants';
import { type Scored, type ConcallExtract } from './types';

// section header used across every detail panel — small caps, letter-spaced, accent
export const SectionHead = ({ label, color, extra }: { label: string; color: string; extra?: any }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>{label}</span>
    <span style={{ flex: 1, borderBottom: '1px solid ' + C.line, transform: 'translateY(-3px)' }} />
    {extra}
  </div>
);
 // bucket key inside KC for uploads that matched 0 or 2+ companies

// ── small visual atoms ──────────────────────────────────────────────────────
export const TierBars = ({ s, w = 30 }: { s: Scored; w?: number }) => (
  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} title={s.tiers.map((t) => t.label + ' ' + t.pts + '/' + t.max).join(' · ')}>
    {s.tiers.map((t) => {
      const pct = t.max ? t.pts / t.max : 0;
      const col = pct >= 0.7 ? C.green : pct >= 0.4 ? C.amber : C.red;
      return (
        <div key={t.label} style={{ width: w }}>
          <div style={{ fontSize: 9, color: C.dim, textAlign: 'center', lineHeight: '10px' }}>{t.label}</div>
          <div style={{ height: 5, borderRadius: 3, background: C.line, overflow: 'hidden' }}>
            <div style={{ width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
          </div>
        </div>
      );
    })}
  </div>
);
export const StageChip = ({ stage, big }: { stage: string; big?: boolean }) => {
  const m = stage ? STAGE_META[stage] : null;
  if (!m) return <span style={{ color: C.muted, fontSize: F.xs }}>—</span>;
  return (
    <span title={m.label + ' · entry size ' + m.size} style={{
      display: 'inline-block', fontWeight: 900, color: m.color, background: m.color + '1E',
      border: '1px solid ' + m.color + '66', borderRadius: big ? 10 : 7,
      padding: big ? '4px 12px' : '1px 8px', fontSize: big ? F.md : F.xs,
    }}>
      {stage}
    </span>
  );
};
// T0→T5 horizontal stepper — fixed-height nodes (dot + stage + lag), connector
// lines between them, nowrap + horizontal scroll on overflow. Never collapses
// into a vertical run. Current position gets a ring in the band color.
export const Timeline = ({ s }: { s: Scored }) => {
  const noCycle = s.stage === '—';
  const m = s.stage && !noCycle ? STAGE_META[s.stage] : null;
  const T = [
    ['T0', 'Announced'], ['T1', 'Commissioned'], ['T2', 'Util rising'],
    ['T3', 'Earnings inflect'], ['T4', 'Recognition'], ['T5', 'Peak / new capex'],
  ];
  const lags = ['12-24m', '6-12m', '6-12m', '6-12m', '12-24m'];
  const pos = m ? m.pos : -1; // fractional 0..5
  const curIdx = m ? Math.min(5, Math.floor(pos)) : -1;
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '14px 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2, opacity: noCycle ? 0.55 : 1 }}>
        {T.map(([t, lbl], i) => {
          const done = m !== null && i <= pos;
          const isCur = i === curIdx;
          const dotCol = isCur ? m!.color : done ? m!.color + 'AA' : C.line;
          return (
            <Fragment key={t}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 92, flexShrink: 0 }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', marginTop: 4, boxSizing: 'border-box',
                  background: done || isCur ? dotCol : C.panel2,
                  border: '2px solid ' + (done || isCur ? dotCol : C.dim),
                  boxShadow: isCur ? '0 0 0 4px ' + m!.color + '33, 0 0 10px ' + m!.color + '88' : 'none',
                }} />
                <div style={{ fontSize: F.xs, fontWeight: 800, marginTop: 7, whiteSpace: 'nowrap', color: isCur ? m!.color : done ? C.txt : C.dim }}>
                  {t} <span style={{ fontWeight: isCur ? 800 : 600 }}>{lbl}</span>
                </div>
                {isCur && <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.8, color: m!.color, marginTop: 2 }}>● STAGE {s.stage}</div>}
              </div>
              {i < 5 && (
                <div style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10 }}>
                  <div style={{ height: 2, width: '100%', borderRadius: 1, background: m && i < pos ? m.color + '88' : C.line }} />
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 5, whiteSpace: 'nowrap' }}>{lags[i]}</div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {m && (() => {
        const qualityBad = s.final < 40;
        const qualityWatch = s.final >= 40 && s.final < 55;
        const stageOpen = s.stage === 'B' || s.stage === 'C' || s.stage === 'D';
        const showConditional = stageOpen && (qualityBad || qualityWatch);
        return (
          <>
            {showConditional && (
              <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + C.amber, background: C.amber + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
                <b style={{ color: C.amber }}>⚠ Stage {s.stage} window IS open</b> <span style={{ color: C.body }}>— but quality score {s.final} is below the safety floor. The alpha window is conditional: realizes <b>only if</b> utilization ramps successfully AND leverage normalizes AND ROCE recovers. Treat as <b>high-risk speculative</b> rather than core buy.</span>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + m.color, background: m.color + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
              <b style={{ color: m.color }}>Stage {s.stage} — {m.label}</b>{' '}
              <span style={{ color: C.body }}>{m.note}</span>{' '}
              <span style={{ color: C.body }}>· framework size {m.size}</span>
            </div>
          </>
        );
      })()}
      {!m && (
        <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + C.blue, background: C.blue + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px', color: C.body }}>
          {noCycle
            ? <><b style={{ color: C.blue }}>NO MAJOR CYCLE</b> — capex is running at routine, serial-brownfield scale, so the T0→T5 multibagger arc does not apply to this name. Judge it as a steady compounder and re-arm the timeline on a real capex announcement.</>
            : <><b style={{ color: C.blue }}>NO ACTIVE CYCLE IN TELEMETRY</b> — nothing to place on the arc yet; the stepper arms when commissioning telemetry appears.</>}
        </div>
      )}
    </div>
  );
};
// year-by-year capex strip — aligned mini-bars: value on top, bar sized by
// value, year label underneath. Fixed lane heights keep the row perfectly level.
export const CapexStrip = ({ s }: { s: Scored }) => {
  const ser = s.capexSeries.filter((d) => d.y);
  if (!ser.length) return null;
  const mx = Math.max(...ser.map((d) => d.v), 1);
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 14px 12px' }}>
      <SectionHead label="Capex by year" color={C.orange} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · ΔNB + ΔCWIP + Dep</span>} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {ser.map((d, i) => {
          const lastN = i >= ser.length - 1;
          return (
            <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
              <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.orange : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
              <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / mx) * 52)), background: lastN ? C.orange : C.blue + '77', borderRadius: '3px 3px 0 0' }} />
              <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
              <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
            </div>
          );
        })}
      </div>
      {(() => {
        const nbS = (s.nbSeries || []).filter((d) => d.y);
        if (!nbS.length) return null;
        const nbMx = Math.max(...nbS.map((d) => d.v), 1);
        return (
          <div style={{ marginTop: 12 }}>
            <SectionHead label="Fixed Assets (Net Block) by year" color={C.teal} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · gross blocks commissioned</span>} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {nbS.map((d, i) => {
                const lastN = i >= nbS.length - 1;
                return (
                  <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
                    <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.teal : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
                    <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / nbMx) * 52)), background: lastN ? C.teal : C.teal + '55', borderRadius: '3px 3px 0 0' }} />
                    <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
                    <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {(() => {
        const cwS = (s.cwipSeries || []).filter((d) => d.y);
        if (!cwS.length) return null;
        const cwMx = Math.max(...cwS.map((d) => d.v), 1);
        return (
          <div style={{ marginTop: 12 }}>
            <SectionHead label="CWIP by year" color={C.amber} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · projects under construction (build → drain = commissioning)</span>} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {cwS.map((d, i) => {
                const lastN = i >= cwS.length - 1;
                return (
                  <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
                    <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.amber : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
                    <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / cwMx) * 52)), background: lastN ? C.amber : C.amber + '55', borderRadius: '3px 3px 0 0' }} />
                    <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
                    <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {s.cycleNote && <div style={{ marginTop: 8, fontSize: F.sm, color: s.cycleNote.includes('DELIVERED ✓') ? C.green : s.cycleNote.includes('BORDERLINE') ? C.amber : C.red }}>🕰 {s.cycleNote}</div>}
    </div>
  );
};
// 🎙 uniform signal cards — one per extraction channel; value big, source
// sentence quoted in italic body text; channels with no finding stay visible
// as a dim "not mentioned" so the reader knows the extractor looked.
export function HandbookChip({ text }: { text: string }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    let cancel = false;
    try {
      const result = classifyTranscriptV2(text);
      if (!cancel) setR(result);
    } catch (e) { /* ignore */ }
    return () => { cancel = true; };
  }, [text]);
  if (!r) return null;
  const bandColors: Record<string, string> = {
    'ANCHOR BUY': '#00E68A', 'CORE BUY': '#22D3EE', 'SATELLITE': '#A78BFA',
    'WATCHLIST': '#FFB347', 'AVOID': '#FF4D6A', 'REJECT': '#FF4D6A',
  };
  const col = bandColors[r.band] || '#AEBBD0';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0', padding: '4px 0', borderTop: '1px dashed #2A3654', borderBottom: '1px dashed #2A3654', fontSize: 11 }}>
      <span style={{ fontWeight: 800, color: '#FFD700' }}>📘 Handbook</span>
      <span style={{ fontWeight: 900, color: col, padding: '2px 8px', borderRadius: 8, background: col + '1A', border: '1px solid ' + col + '55' }}>{r.scorecardTotal}/100 {r.band}</span>
      {r.sectorGuess && <span style={{ color: '#AEBBD0' }}>sector: <b style={{ color: 'var(--mc-cyan)' }}>{r.sectorGuess}</b> <span style={{ color: '#8B98AC' }}>({String(r.sectorConfidence).toLowerCase()})</span></span>}
      <span style={{ color: '#00E68A' }}>+{r.toneScore.positive}</span>
      <span style={{ color: '#FFB347' }}>⚠{r.toneScore.cautious}</span>
      <span style={{ color: '#FF4D6A' }}>🚩{r.toneScore.redFlag}</span>
      <span style={{ color: '#8B98AC' }}>{r.totalSentences} sent</span>
    </div>
  );
}
export function SignalCards({ ex }: { ex: ConcallExtract }) {
  const qFor = (f: string) => ex.quotes.find((q) => q.field === f)?.snippet || '';
  const clip = (s: string) => (s.length > 190 ? s.slice(0, 187) + '…' : s);
  const cards: { icon: string; label: string; value: string | null; quote: string; plain?: boolean }[] = [
    { icon: '🏭', label: 'UTILIZATION', value: ex.utilization !== null ? ex.utilization + '%' : null, quote: qFor('utilization') },
    { icon: '📦', label: 'ORDER BOOK', value: ex.orderBook !== null ? ex.orderBook.toLocaleString() + ' Cr' : null, quote: qFor('orderBook') },
    { icon: '💰', label: 'CAPEX GUIDANCE', value: ex.capexGuidance !== null ? ex.capexGuidance.toLocaleString() + ' Cr' : null, quote: qFor('capexGuidance') },
    { icon: '📅', label: 'TIMELINE', value: ex.timeline.length ? ex.timeline.length + ' dated commitment' + (ex.timeline.length > 1 ? 's' : '') : null, quote: ex.timeline[0] || '' },
    { icon: '📈', label: 'GROWTH', value: ex.growthNote ? ((ex.growthNote.match(/\d+(?:\.\d+)?\s*%/) || ['noted'])[0]) : null, quote: ex.growthNote || '' },
    { icon: '📊', label: 'MARGINS', value: ex.marginNote ? ((ex.marginNote.match(/\d+(?:\.\d+)?\s*(?:%|bps|basis points)/i) || ['noted'])[0]) : null, quote: ex.marginNote || '' },
    { icon: '🛒', label: 'DEMAND', value: ex.demandNote ? 'noted' : null, quote: ex.demandNote || '' },
    { icon: '🎭', label: 'TONE', value: ex.tone !== null ? Math.round(ex.tone * 100) + '% positive' : null, quote: ex.tone !== null ? ex.optimism + ' positive · ' + ex.caution + ' cautious phrases' : '', plain: true },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, margin: '8px 0 4px' }}>
      {cards.map((cd) => (
        <div key={cd.label} style={{ background: C.bg, border: '1px solid ' + (cd.value ? C.gold + '40' : C.line), borderRadius: 8, padding: '9px 11px', display: 'grid', gap: 5, alignContent: 'start' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.1, color: cd.value ? C.gold : C.dim }}>{cd.icon} {cd.label}</div>
          {cd.value ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.txt, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{cd.value}</div>
              {cd.quote && (
                <div style={{ fontSize: F.xs, fontStyle: 'italic', color: C.body, lineHeight: 1.55 }}>
                  {cd.plain ? cd.quote : '“' + clip(cd.quote) + '”'}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: F.xs, color: C.muted, fontStyle: 'italic' }}>not mentioned</div>
          )}
        </div>
      ))}
    </div>
  );
}
// highlight extracted numbers inside the transcript viewer
export function markText(text: string, quotes: { field: string; match: string; snippet: string }[]): any {
  const marks = Array.from(new Set(quotes.map((q) => q.match))).filter(Boolean).sort((a, b) => b.length - a.length).slice(0, 30);
  if (!marks.length) return text;
  try {
    const re = new RegExp(marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|'), 'g');
    const parts: any[] = [];
    let lastI = 0; let m: RegExpExecArray | null; let k = 0;
    while ((m = re.exec(text)) && k < 200) {
      parts.push(text.slice(lastI, m.index));
      parts.push(<mark key={'m' + k++} style={{ background: C.gold + '33', color: C.txt, borderRadius: 3 }}>{m[0]}</mark>);
      lastI = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    parts.push(text.slice(lastI));
    return parts;
  } catch { return text; }
}
// scoreboard row + expandable detail
export function ScoreRow({ s, open, toggle, fmt, Detail, lens, veto }: { s: Scored; open: boolean; toggle: () => void; fmt: (n: number, d?: number) => string; Detail: (p: { s: Scored }) => any; lens?: any; veto?: boolean }) {
  return (
    <>
      <tr className="cxr" onClick={toggle} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: open ? '#16233B' : undefined }}>
        <td style={{ padding: '8px 8px', fontWeight: 800 }}>
          {s.name} <span style={{ fontSize: 10, color: C.muted }}>{s.country === 'US' ? '🇺🇸' : '🇮🇳'}</span>
          <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}{s.theme ? ' · ' + s.theme : ''}</div>
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: s.decisionColor, background: s.decisionColor + '14', border: '1px solid ' + s.decisionColor + '44', borderRadius: 9, padding: '3px 10px' }}>{s.final}</span>
        </td>
        <td style={{ padding: '8px 8px' }}><span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55', whiteSpace: 'nowrap' }}>{s.decision}</span></td>
        <td style={{ padding: '8px 8px' }}><StageChip stage={s.stage} />{s.watch.length > 0 && <span title={s.watch.join(' | ')}> 🚨</span>}{s.sells.length > 0 && <span title={s.sells.join(' | ')}> 📤</span>}</td>
        <td style={{ padding: '8px 8px' }}><TierBars s={s} /></td>
        <td style={{ padding: '8px 8px' }}>{lens ?? <span style={{ color: C.muted, fontSize: F.xs }}>—</span>}</td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, fontWeight: 800, color: veto ? C.red : s.entryColor, whiteSpace: 'nowrap' }} title={veto ? 'Forensic AVOID/critical — entry blocked regardless of capex quality' : undefined}>{veto ? '☠ FORENSIC VETO' : s.entryShort}</td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, color: s.confidence === 'HIGH' ? C.green : s.confidence === 'MEDIUM' ? C.amber : C.red }}>{s.confidence}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, color: s.dbCount >= 3 ? C.red : s.dbCount ? C.amber : C.muted }}>{s.dbCount || '—'}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.roce)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.de, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', color: s.netDebtEbitda > 2 ? C.red : s.netDebtEbitda < 0 ? C.green : C.txt }}>{s.netDebtEbitda < 0 ? 'net cash' : fmt(s.netDebtEbitda, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.util, 0)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.anchor, 0)}</td>
      </tr>
      {open && <tr><td colSpan={14} style={{ padding: '0 8px' }}><Detail s={s} /></td></tr>}
    </>
  );
}
// ── 📐 The Model — the COMBINED framework, documented ───────────────────────
export function ModelTab({ card }: { card: any }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.cyan, marginBottom: 6 }}>1 · QUALITY — 21 factors, 100 pts (Masterclass Ch.12)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          <b>Tier 1 (50):</b> ROCE/ROIC 12 · Anchor demand 12 · D/E 11 · OCF 8 · Funding source 7<br />
          <b>Tier 2 (25):</b> Utilization 6 · Promoter/Founder 6 · EBITDA 5 · Capex sweet-spot 4 · Overrun record 4<br />
          <b>Tier 3 (15):</b> Cycle timing 4 · WC trend 3 · Rev CAGR 3 · Brownfield 3 · Policy 2<br />
          <b>Tier 4 (10):</b> Industry growth 2 · Import-sub 2 · Export 1 · Valuation 2 · Moat 2 · Prior capex 1<br />
          <span style={{ color: C.body }}>× industry multiplier: Defence 1.10 · SpecChem 1.08 · CDMO 1.06 · Consumer 1.05 · Cement/PEB 1.03 · Renewables 1.02 · Semis/EMS 1.00 · Banks 0.95 · RE 0.85 · Telecom 0.75 · Airlines 0.70 · Merchant power/Steel 0.65</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>2 · DEAL BREAKERS (any 3 ⇒ score capped at 30)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          DB1 D/E &gt;1.5x · DB2 OCF negative/below maintenance · DB3 pledge &gt;30% / material RPT · DB4 debt-funding &gt;70% · DB5 anchor &lt;25% of new capacity · DB6 ROCE below cost of debt.<br />
          <span style={{ color: C.body }}>In 38 of 40 India failures, ≥4 of 8 red flags were visible in audited financials TWO YEARS before the announcement. The information was never the problem — discipline was.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>3 · QUALITY BANDS (Ch.12.4) + confidence (§12.5)</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
          <span style={{ color: C.gold }}>85-100 ANCHOR BUY</span> · 4-6% · 88% hit rate<br />
          <span style={{ color: C.green }}>70-84 CORE BUY</span> · 3-4% · 72%<br />
          <span style={{ color: C.cyan }}>55-69 SATELLITE</span> · 1.5-2.5% · 55% · Q1 confirmation first<br />
          <span style={{ color: C.amber }}>40-54 WATCHLIST</span> · <span style={{ color: C.orange }}>25-39 AVOID</span> · <span style={{ color: C.red }}>0-24 REJECT</span><br />
          <span style={{ color: C.body }}>Score = measured points ÷ measured weight × 100 (v5.4) — unmeasurable factors reduce confidence instead of silently zeroing the score. LOW confidence ⇒ halve the position. Any (est)-filled factor caps confidence at MEDIUM. ≥10 unmeasured factors ⇒ NEEDS DATA, not a fake AVOID.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>4 · TIMING — the T0→T5 arc (Framework, ~250 cases)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          T0 announce → <b>12-24m</b> → T1 commission → <b>6-12m</b> → T2 util rises → <b>6-12m</b> → T3 GAAP earnings inflect → <b>6-12m</b> → T4 street recognition → <b>12-24m</b> → T5 peak (new mega-capex announced).<br />
          <span style={{ color: C.body }}>The institutional alpha window is the 6-18 months BEFORE T3 — execution visible, inflection not yet printed. Entries after T4 are systematically penalized.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>5 · STAGE A-F — entry classification + sizing</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
          {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map((st) => {
            const m = STAGE_META[st];
            return (
              <div key={st} style={{ display: 'flex', gap: 8, alignItems: 'baseline', borderTop: '1px solid ' + C.line, padding: '4px 0' }}>
                <span style={{ fontWeight: 900, color: m.color, minWidth: 16 }}>{st}</span>
                <span style={{ color: C.txt }}><b style={{ color: m.color }}>{m.label}</b> · size {m.size} <span style={{ color: C.body }}>— {m.note}</span></span>
              </div>
            );
          })}
          <div style={{ color: C.body, marginTop: 4 }}>Optimal-entry distribution across winners: C ≈55% · B ≈20% · D ≈20% · A only for proven executors · F net-negative.</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 6 }}>6 · WINNER DNA cross-checks (Framework Phase 3)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Cycle capex <b>30-60% of pre-capex revenue</b> (below 25% too small, above 60% leverage/execution risk acute) · <b>Net Debt/EBITDA &lt;2x at peak capex</b> · OCF positive + growing 2y pre-capex · receivable days flat/declining · utilization 65-80% at announcement ("bursting at the seams") · ramp to 85-95% within 18-30 months of T1 (stall below 70% for 24m ⇒ loser cohort) · brownfield &gt; greenfield by 20-30% on multiple · Stage-C entry valuation: PE 18-25x trailing, EV/EBITDA 10-14x; above 40x PE = negative-outcome zone.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 6 }}>7 · SELL — the staircase (Framework Phase 6)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Six signals: ① utilization &gt;90% on the new plant ② management announces a NEW larger capex cycle ③ EBITDA margin at historical peak band ④ ROCE prints above 35-40% (mean-reverts) ⑤ multiple above prior-cycle peak ⑥ "capacity-constrained" is the consensus narrative.<br />
          <b>Sell ⅓ on the 1st signal, ⅓ on the 2nd, the rest on the 4th.</b> Captured 70-80% of upside while sidestepping the next-cycle 50-80% drawdown. Holding past T5 is the documented failure mode (2008 infra, 2014-16 shale, 2021-22 EV/SPAC).
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>8 · RISK — mechanical rules (Framework Module 6 + Masterclass App.A)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Exit on the print: promoter pledge crosses 50% (led collapse by 6-18m in almost every Indian failure) · Net Debt/EBITDA &gt;3x for 2 consecutive quarters · receivables outgrow revenue for 3 quarters · foreign acquisition above 12x EV/EBITDA · auditor exit / filing delay.<br />
          Quarterly: D/E creep &gt;+0.3x during construction = flag · <b>2 consecutive guidance moderations = TRIM 50% · 3 = EXIT FULL.</b> Single-name cap 5%; theme exposure 15-30% of book.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.blue, marginBottom: 6 }}>9 · The three universal predictors (Masterclass Ch.6)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          (A) Pre-existing ROCE/ROIC above industry median — 84% of winners.<br />
          (B) Demand visibility BEFORE commitment (anchor &gt;40% of new capacity) — 81%.<br />
          (C) Balance-sheet shock capacity (D/E &lt;1.0) — 79%.<br />
          All three present ⇒ 85%+ success. All three absent ⇒ 80%+ failure.<br />
          <span style={{ color: C.body }}>Asymmetries: brownfield 72% vs greenfield 51% · internal-funded 76% vs debt-funded 41% · &gt;85% util 74% vs &lt;70% 43% · domestic 68% vs cross-border M&A 37%.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>10 · How this page computes it</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Screener workbooks → quantitative factors + telemetry (phase, capex/sales, CWIP ratio, spend accel, ΔD/E, OCF self-funding, Net Debt/EBITDA, cycle-capex/pre-revenue, prior-cycle delivery, utilization proxies — all marked (est) where inferred).<br />
          Stage = commissioning telemetry × effective utilization × inflection status. <b>Entry verdict = quality band ∩ stage</b>, with the Stage-F never-chase override and the proven-executor exception for Stage A. Manual inline edits always overwrite estimates and rescore instantly.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: 'var(--mc-state-persistent)', marginBottom: 6 }}>11 · 🚀 MULTIBAGGER SCORE — 12 components, 100 pts (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Recomputed from the 10y workbook series (SQGLP checklist + multibagger-checklist thresholds): earnings consistency 10 (PAT YoY &gt;15% in 7+ yrs) · <b>sales CAGR + acceleration 10 — blended horizons: g = max(cagr3, 0.8×cagr5, 0.7×cagr10), full at ≥25% scaling to 0 at ≤5%; +2 bonus when cagr3&gt;cagr5&gt;cagr10; a 3y print &gt;8pp below the 5y caps the component at 60% (one soft year cannot zero a long-horizon grower)</b> · ROCE level+trajectory 10 (avg3 ≥25, rising vs 10y) · margin/op-leverage 8 · self-funded reinvestment 8 (capex/OCF 0.4-1.2x) · dilution 6 (≤+5% 10y) · debt trajectory 6 (D/E ≤0.3 and falling) · FCF years 6 · CFO→PAT 5 (cum ≥0.8) · size runway 8 (500-5,000 Cr sweet spot) · <b>PEG/PE 8 — PEG uses the blended PAT growth (max of 3y, 0.8×5y, 0.7×10y; sales-blend fallback); PEG &lt;1 full, PE 18-40 entry band; growth &lt;5% ⇒ PEG shown n/m and only the PE band (weight 3) is scored</b> · promoter≥55%/pledge≤5%/moat 7.<br />
          <span style={{ color: C.body }}>Score = pts ÷ measured weight × 100 (NR below 40 weight). Absolute bands: A+ ≥80 · A 70 · B+ 60 · B 50 · C 38 · D. Consistency gates: forensic FLAGS caps at B+; pledge &gt;15% or D/E &gt;1.5 caps at B.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>12 · 🔬 FORENSIC SCORE — 12 checks, higher = cleaner (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Cum CFO/PAT 14 (≥0.9 clean; &lt;0.5 CRITICAL) · CFO/EBITDA 8 · receivable-days trend 10 (channel stuffing) · inventory days 6 · other-income/PBT 8 (&gt;25% = crutch) · tax rate 8 (chronic &lt;15% = suspect) · cash↑+debt↑ 8 (phantom cash) · perpetual CWIP 8 (&gt;20% of NB 3y+) · dilution 5y 8 (&gt;40% CRITICAL) · dividend vs OCF 8 · CFO-positive years 8 · depreciation-rate volatility 6. Workbook fraud-checklist answers overlay −3 each (cap −15).<br />
          <span style={{ color: C.body }}>Grade = WORST of score band (CLEAN ≥80 · WATCH 60 · FLAGS 40 · AVOID) vs flag count (1 flag ≤WATCH · 2-3 ≤FLAGS · ≥4 or CRITICAL ⇒ AVOID).</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.orange, marginBottom: 6 }}>13 · 🧭 VERDICT — the fusion matrix (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          First match wins: ① forensic AVOID/critical ⇒ <b style={{ color: C.red }}>☠ DO NOT TOUCH</b> (vetoes everything) · ② no data ⇒ 🧩 NEEDS DATA · ③ forensic FLAGS ⇒ 🔍 REVIEW FIRST · ④ MB ≥70 ∩ buy window ⇒ <b style={{ color: C.gold }}>🎯 PRIME</b> · ⑤ MB ≥70 ∩ capex-buy band, window shut ⇒ ⏳ PRIME SETUP · ⑥ MB ≥70, capex not ripe ⇒ 🌱 COMPOUNDER · ⑦ MB 50-69 ∩ window ⇒ 🏗 CAPEX PLAY (half size) · ⑧ MB &lt;50 ∩ window ⇒ ⚙ CYCLE ONLY · ⑨ MB ≥70 + CLEAN, no cycle ⇒ 💎 QUALITY HOLD · ⑩ capex AVOID/REJECT + MB &lt;50 ⇒ 🗑 DROP · ⑪ else 👀 MONITOR.<br />
          <span style={{ color: C.body }}>Composite rank = 0.40 capex + 0.35 MB + 0.25 forensic (renormalized; −15 on FLAGS). Concall modifiers: fresh cautious call demotes one rung; fresh bullish + util ≥75% tags 🔥 ramp confirmed.</span>
        </div>
      </div>
    </div>
  );
}
