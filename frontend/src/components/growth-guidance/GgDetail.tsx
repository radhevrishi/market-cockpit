'use client';
// zzz846 — the forensic detail drawer. Only sections that have real content are drawn, numbered in the order shown.
import React from 'react';
import type { GgCompany, GgGuidancePoint } from '@/lib/growth-guidance-types';
import {
  ANALYST_MARKER, BASIS_LABEL, CAP_LABEL, CATALYST_LABEL, CHAIN_STATUS_LABEL, CHAIN_STEP_LABEL, EXPECTATIONS_LABEL, EXPECTATIONS_PLAIN, GROWTH_ORIGIN_LABEL, INFLECTION_LABEL, LEVERAGE_LABEL,
  MAP2X2_LABEL, NOT_ESTABLISHED, ORGANIC_LABEL, OUTCOME_LABEL, PERIOD_KIND_LABEL, QUALITY_LABEL, REVISION_LABEL, RERATING_LABEL, SOURCE_RANK_NOTE, TREND_LABEL, UNAVAILABLE, absoluteTargetText,
  fmtGrowth, fmtMult, fmtNum, fmtPct, fmtSignedPct, isAnalyst, isMuted, kindLabel, linksFor, pointFor, verificationText, visibleSections, type GgSectionKey,
} from '@/lib/growth-guidance-format';
import { R, box, tint } from './gg-tokens';
import { Chip, ConflictBanner, HeldChip, KV, KindChip, NotVerifiedBanner, OrganicChip, SectionHead, StatusDotView, ValidityChip, btn } from './GgBits';

const CHAIN_COLOR = { PROVEN: R.green, PARTIALLY_PROVEN: R.cyan, ASSUMED: R.amber, UNKNOWN: R.grey } as const;
const mkd = (s: string | null | undefined) => (s && s.trim() ? s : NOT_ESTABLISHED);

function PointBlock({ p, label }: { p: GgGuidancePoint; label: string }) {
  const abs = absoluteTargetText(p);
  return (
    <div style={{ borderTop: `1px solid ${R.border}`, paddingTop: 6, marginTop: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: R.dim }}>{label}</div>
      <KV k="Growth" v={<>{fmtGrowth(p)} <span style={{ color: R.dim }}>({GROWTH_ORIGIN_LABEL[p.growthOrigin] ?? ''})</span></>} />
      {abs && <KV k="Absolute target" v={abs} />}
      {p.base && <KV k="Base used" v={`${fmtNum(p.base.value)} (${p.base.period})`} />}
      <KV k="Period" v={`${p.period} · ${PERIOD_KIND_LABEL[p.periodKind] ?? ''}`} />
      <KV k="Kind" v={<>{kindLabel(p.kind)}{isAnalyst(p.kind) && <> <Chip color={R.violet} dashed>{ANALYST_MARKER}</Chip></>}</>} />
      <KV k="Basis" v={<>{p.basis ? BASIS_LABEL[p.basis] : BASIS_LABEL.UNSTATED}{p.constantCurrency ? ' · constant currency' : ''}</>} />
      <KV k="Organic or acquired" v={ORGANIC_LABEL[p.organic] ?? NOT_ESTABLISHED} />
      {p.originalStatement && p.originalStatement.trim() && (
        <blockquote style={{ margin: '6px 0 0', padding: '6px 10px', borderLeft: `3px solid ${R.cyan}`, background: tint(R.cyan, 6), fontSize: 12.5, fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{p.originalStatement}”</blockquote>
      )}
    </div>
  );
}

function Body({ k, c }: { k: GgSectionKey; c: GgCompany }) {
  switch (k) {
    case 'snapshot': {
      const p = c.primary;
      return (
        <div>
          <KV k="Company" v={`${c.company} (${c.ticker || 'ticker not resolved'}) · ${CAP_LABEL[c.capBand] ?? ''}`} />
          <KV k={`${p?.metric ? p.metric : 'Revenue'} growth guided`} v={<b>{fmtGrowth(p)} for {p?.period || '—'}</b>} />
          {(c.others || []).map((o, i) => <KV key={i} k={`${o.metric} growth guided`} v={<>{fmtGrowth(o)} for {o.period}{isAnalyst(o.kind) && <> <Chip color={R.violet} dashed>ANALYST</Chip></>}</>} />)}
          <KV k="Evidence" v={`${verificationText(c.verification)} · ${QUALITY_LABEL[c.quality] ?? ''}`} />
          <KV k="Tracking" v={<StatusDotView c={c} />} />
          <KV k="Latest revision" v={REVISION_LABEL[c.revision] ?? NOT_ESTABLISHED} />
          <KV k="Organic note" v={mkd(c.organicNote)} />
          {c.corporateActionGrowth && <KV k="Corporate action" v="Part of this growth comes from a corporate action such as an acquisition or merger." />}
        </div>
      );
    }
    case 'why':
      return (
        <div>
          {c.driverText && <div style={{ fontSize: 13, marginBottom: 6 }}>{c.driverText}</div>}
          {(c.catalysts || []).length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>{c.catalysts.map((x, i) => <Chip key={x} color={i === 0 ? R.cyan : R.grey}>{CATALYST_LABEL[x] ?? x}</Chip>)}</div>}
          {(c.mechanisms || []).length > 0 && <div style={{ fontSize: 12, color: R.dim, marginBottom: 6 }}>Mechanisms: {c.mechanisms.join(', ')}</div>}
          {(c.chain || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'stretch' }}>
              {c.chain.map((s, i) => (
                <div key={i} title={s.text} style={{ border: `1px ${s.status === 'PROVEN' ? 'solid' : 'dashed'} ${CHAIN_COLOR[s.status]}`, borderRadius: 6, padding: '4px 8px', fontSize: 11.5, maxWidth: 240, background: s.status === 'PROVEN' ? tint(CHAIN_COLOR[s.status], 8) : 'transparent' }}>
                  <div style={{ fontWeight: 800, color: CHAIN_COLOR[s.status] }}>{CHAIN_STEP_LABEL[s.step] ?? s.step} · {CHAIN_STATUS_LABEL[s.status] ?? s.status}</div>
                  <div style={{ color: R.text }}>{s.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case 'evidence':
      return (
        <div>
          <ConflictBanner c={c} />
          {(c.sources || []).length > 0 && (
            <div className="gg-scroll"><table className="gg-table">
              <thead><tr><th>Source</th><th>Rank</th><th>Type</th><th>Date</th><th>Primary?</th></tr></thead>
              <tbody>{c.sources.map((s, i) => (
                <tr key={i}>
                  <td>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>{s.name}</a> : s.name}</td>
                  <td>{s.rank}</td><td>{s.type}</td><td>{s.date ? String(s.date).slice(0, 10) : UNAVAILABLE}</td><td>{s.primary ? 'Yes' : 'No'}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <div style={{ fontSize: 11, color: R.faint, marginTop: 4 }}>{SOURCE_RANK_NOTE}</div>
          {c.primary && <PointBlock p={c.primary} label={`${c.primary.metric} statement`} />}
          {(c.others || []).map((o, i) => <PointBlock key={i} p={o} label={`${o.metric} statement`} />)}
        </div>
      );
    case 'history':
      return (
        <div>
          {c.trend === 'ACCELERATION' && <div role="note" style={{ border: `1px solid ${R.green}`, background: tint(R.green, 10), borderRadius: 6, padding: '6px 10px', fontSize: 12.5, fontWeight: 800, color: R.green, marginBottom: 6 }}>🚀 {TREND_LABEL.ACCELERATION}{c.trendText ? ` · ${c.trendText}` : ''}</div>}
          {c.trend === 'DETERIORATION' && <div role="note" style={{ border: `1px solid ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '6px 10px', fontSize: 12.5, fontWeight: 800, color: R.amber, marginBottom: 6 }}>⚠️ {TREND_LABEL.DETERIORATION}{c.trendText ? ` · ${c.trendText}` : ''}</div>}
          {(c.history || []).length > 0 && (
            <div className="gg-scroll"><table className="gg-table">
              <thead><tr><th>Date</th><th>Guidance</th><th>Change</th><th>Source</th><th>Outcome</th></tr></thead>
              <tbody>{c.history.map((h, i) => {
                const arrow = h.revision === 'RAISED' || h.revision === 'EXCEEDED' ? '↑' : h.revision === 'LOWERED' || h.revision === 'MISSED' || h.revision === 'WITHDRAWN' ? '↓' : '—';
                const col = arrow === '↑' ? R.green : arrow === '↓' ? R.red : R.grey;
                return (
                  <tr key={i} style={{ opacity: isMuted(h.status) ? 0.65 : 1 }}>
                    <td>{String(h.date).slice(0, 10)}</td>
                    <td>{h.old ? `${h.old} → ` : ''}{h.next} <span style={{ color: R.dim, fontSize: 11 }}>{h.period} · {h.metric}</span></td>
                    <td style={{ color: col, fontWeight: 800 }}>{arrow} <span style={{ fontWeight: 600 }}>{REVISION_LABEL[h.revision] ?? ''}</span></td>
                    <td>{h.source}</td>
                    <td>{h.outcome ? OUTCOME_LABEL[h.outcome] : '—'}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
          {c.credibility && c.credibility.line && <div style={{ fontSize: 12.5, marginTop: 6 }}>{c.credibility.line}</div>}
        </div>
      );
    case 'earnings': {
      const e = c.earnings, s = c.surprise;
      return (
        <div>
          {e && <>
            <KV k="Revenue growth (reported)" v={fmtSignedPct(e.revenueGrowthPct)} />
            <KV k="PAT growth" v={fmtSignedPct(e.patGrowthPct)} />
            <KV k="EPS growth" v={fmtSignedPct(e.epsGrowthPct)} />
            <KV k="EBITDA growth" v={fmtSignedPct(e.ebitdaGrowthPct)} />
            <KV k="Operating margin" v={e.opmFrom != null || e.opmTo != null ? `${fmtPct(e.opmFrom, 1)} → ${fmtPct(e.opmTo, 1)}` : UNAVAILABLE} />
            <KV k="Cash from operations / PAT" v={e.cfoToPat != null ? `${e.cfoToPat.toFixed(2)}x` : UNAVAILABLE} />
            <KV k="Free cash flow" v={fmtNum(e.fcf)} />
            <KV k="Inflection" v={INFLECTION_LABEL[e.inflection] ?? NOT_ESTABLISHED} />
            <KV k="Operating leverage" v={<>{LEVERAGE_LABEL[e.leverage] ?? ''}{e.leverageNote ? ` — ${e.leverageNote}` : ''}</>} />
          </>}
          {s && <KV k="Guided vs actual vs consensus" v={`Guided ${fmtPct(s.guidancePct)} · Actual ${fmtPct(s.actualPct)} · Consensus ${fmtPct(s.consensusPct)}`} />}
          <KV k="Map" v={MAP2X2_LABEL[c.map2x2] ?? NOT_ESTABLISHED} />
        </div>
      );
    }
    case 'reality': {
      const r = c.reality!;
      const u = r.unit ? ` ${r.unit}` : '';
      return (
        <div>
          <KV k="Last full-year revenue" v={r.fyActualRevenue != null ? `${fmtNum(r.fyActualRevenue)}${u}` : UNAVAILABLE} />
          <KV k="Guided growth" v={fmtPct(r.guidedGrowthPct)} />
          <KV k="Revenue implied by guidance" v={r.impliedRevenue != null ? `${fmtNum(r.impliedRevenue)}${u}` : UNAVAILABLE} />
          <KV k="Latest quarter growth" v={fmtSignedPct(r.latestQuarterGrowthPct)} />
          <KV k="Latest annual growth" v={fmtSignedPct(r.latestAnnualGrowthPct)} />
          <KV k="Last 12 months revenue" v={r.ttmRevenue != null ? `${fmtNum(r.ttmRevenue)}${u}` : UNAVAILABLE} />
          <KV k="Growth still needed from today's run rate" v={fmtPct(r.requiredGrowthFromRunRate)} />
          <KV k="Tracking" v={<><StatusDotView c={c} /> {r.trackingWhy ? `— ${r.trackingWhy}` : ''}</>} />
          <KV k="Quarterly timing" v={mkd(r.quarterlyTimingNote)} />
        </div>
      );
    }
    case 'expectations':
      return (
        <div>
          <KV k="Expectations" v={<b>{EXPECTATIONS_LABEL[c.expectations]}</b>} />
          <KV k="In plain words" v={EXPECTATIONS_PLAIN[c.expectations]} />
          {c.expectationsWhy && <KV k="Why" v={c.expectationsWhy} />}
          <div style={{ fontSize: 11, color: R.faint, marginTop: 4 }}>Facts are shown as facts. Where this is our reading, it is labelled as inference in the text above.</div>
        </div>
      );
    case 'valuation': {
      const v = c.valuation!;
      return (
        <div>
          <KV k="Market cap" v={fmtNum(v.marketCap ?? c.marketCap, 0)} />
          <KV k="P/E" v={fmtMult(v.pe)} />
          <KV k="EV/EBITDA" v={fmtMult(v.evEbitda)} />
          <KV k="Price / sales" v={fmtMult(v.priceToSales)} />
          <KV k="FCF yield" v={v.fcfYield != null ? fmtPct(v.fcfYield, 1) : UNAVAILABLE} />
          <KV k="PEG" v={v.peg != null ? v.peg.toFixed(2) : UNAVAILABLE} />
          {v.embeddedGrowthNote && <KV k="Growth already in the price" v={v.embeddedGrowthNote} />}
          {v.ifAchievedNote && <KV k="If guidance is achieved" v={v.ifAchievedNote} />}
          <KV k="Re-rating context" v={RERATING_LABEL[v.rerating] ?? NOT_ESTABLISHED} />
        </div>
      );
    }
    case 'duration':
      return (
        <div>
          <KV k="Guidance duration" v={mkd(c.guidanceDuration)} />
          <KV k="Structural duration" v={mkd(c.structuralDuration)} />
          <div style={{ fontSize: 11, color: R.faint, marginTop: 4 }}>These are two different things. Guidance duration is how long management has guided. Structural duration is how long the underlying driver could last.</div>
        </div>
      );
    case 'next':
      return <div style={{ fontSize: 13 }}>{c.nextProof}</div>;
    case 'breakers':
      return <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{c.breakers.map((b, i) => <li key={i}>{b}</li>)}</ul>;
    case 'links':
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {linksFor(c).map((l) => (
            <a key={l.key} href={l.href} title={l.note} style={{ ...btn(R.cyan), textDecoration: 'none' }}>{l.label}{l.note ? ` — ${l.note}` : ''}</a>
          ))}
        </div>
      );
    default: return null;
  }
}

export function GgDetail({ c, onClose, unverified }: { c: GgCompany; onClose: () => void; unverified?: boolean }) {
  const secs = visibleSections(c);
  const muted = isMuted(c.validity);
  return (
    <aside className="gg-drawer" role="dialog" aria-label={`${c.company} growth guidance detail`} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px,100vw)', overflowY: 'auto', zIndex: 60,
      background: R.bg, color: R.text, borderLeft: `1px solid ${R.border}`, padding: 16, boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 17 }}>{c.company}</b><span style={{ color: R.dim, fontSize: 12 }}>{c.ticker || 'ticker not resolved'}</span>
        <KindChip c={c} /><OrganicChip c={c} /><ValidityChip v={c.validity} /><HeldChip held={!!c.portfolio?.held} />
        <button type="button" className="gg-noprint" style={{ ...btn(), marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      {unverified && <div style={{ marginTop: 8 }}><NotVerifiedBanner /></div>}
      {muted && <div style={{ fontSize: 12, color: R.dim, marginTop: 6 }}>This guidance is no longer the current one ({c.validity.toLowerCase()}). Shown for the record.</div>}
      <div style={{ opacity: muted ? 0.75 : 1 }}>
        {secs.map((s) => (
          <section key={s.key}>
            <SectionHead n={s.n} title={s.title} />
            <div style={box({ padding: 10 })}><Body k={s.key} c={c} /></div>
          </section>
        ))}
      </div>
      <div style={{ fontSize: 11, color: R.faint, marginTop: 14 }}>Company data only. Not investment advice.</div>
    </aside>
  );
}
