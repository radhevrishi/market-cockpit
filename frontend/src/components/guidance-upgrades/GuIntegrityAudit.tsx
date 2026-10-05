'use client';
// zzz865 — INTEGRITY AUDIT: (1) every verified upgrade re-checked against 13 assertions, with the bucket sum re-derived from the events; (2) every DERIVED guidance
// calculation with target, base, base period, growth, formula, source, date and status. Nothing is changed or hidden to look cleaner; a failure is listed.
import React from 'react';
import { R, tint } from './gu-tokens';
import { GuFold } from './GuPanel';
import type { UpgradeAuditReport } from '@/lib/guidance-upgrade-audit';
import type { DerivedAudit } from '@/lib/guidance-derived-audit';

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', color: R.dim, fontSize: 11, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top', borderTop: `1px solid ${R.border}`, fontSize: 12 };

export function GuUpgradeAudit({ audit }: { audit?: UpgradeAuditReport | null }) {
  if (!audit) return null;
  const rec = audit.reconciliation;
  const allPass = audit.failed.length === 0;
  return (
    <GuFold title="Upgrade audit: 13 checks on every verified upgrade" count={audit.checked} accent={allPass ? R.green : R.amber} defaultOpen={!allPass}>
      <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
        <div><b>{audit.passed} of {audit.checked}</b> verified upgrades pass all {audit.assertions.length} checks{allPass ? '.' : `; ${audit.failed.length} fail at least one and are listed below. The count is not changed.`}</div>
        <div style={{ color: R.dim }}>Checks: {audit.assertions.join(' · ')}.</div>
        <div>
          Reconciliation: {Object.entries(rec.buckets).map(([k, n]) => `${k} ${n}`).join(' + ')} = <b>{rec.sum}</b>
          {rec.processed != null && <> · processed {rec.processed} · <b style={{ color: rec.holds ? R.green : R.red }}>{rec.holds ? 'adds up exactly' : 'DOES NOT ADD UP'}</b></>}
        </div>
        {audit.failed.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Company</th><th style={th}>Market</th><th style={th}>Checks that failed</th></tr></thead>
              <tbody>{audit.failed.map((f) => <tr key={f.id}><td style={td}>{f.company}{f.ticker ? ` · ${f.ticker}` : ''}</td><td style={td}>{f.market}</td><td style={{ ...td, color: R.red }}>{f.failures.join(', ')}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </GuFold>
  );
}

export function GuDerivedAudit({ audit }: { audit?: DerivedAudit | null }) {
  if (!audit) return null;
  return (
    <GuFold title="Derived guidance: how each growth was calculated" count={audit.total} accent={audit.withIssues ? R.amber : R.violet} defaultOpen={audit.withIssues > 0}>
      <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
        <div>{audit.total === 0 ? 'No active guidance uses a derived growth.' : `${audit.recalcOk} of ${audit.total} recalculate exactly from their stored numbers${audit.withIssues ? `; ${audit.withIssues} have a note below` : ''}. A derived growth is calculated from the target amount the company stated and a sourced base. It is never taken from media.`}</div>
        {audit.rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Company</th><th style={th}>Metric · period</th><th style={th}>Target</th><th style={th}>Base</th><th style={th}>Growth</th><th style={th}>Formula</th><th style={th}>Source · date</th><th style={th}>Status</th></tr></thead>
              <tbody>
                {audit.rows.map((r, i) => (
                  <tr key={`${r.company}-${r.metric}-${r.period}-${i}`} style={r.issues.length ? { background: tint(R.amber, 8) } : undefined}>
                    <td style={td}><b>{r.company}</b>{r.ticker ? <span style={{ color: R.dim }}> · {r.ticker}</span> : null}</td>
                    <td style={td}>{r.metric} · {r.period}</td>
                    <td style={td}>{r.target}</td>
                    <td style={td}>{r.base}<div style={{ color: R.dim, fontSize: 11 }}>{r.basePeriod} ({r.basisKind})</div></td>
                    <td style={{ ...td, fontWeight: 800 }}>{r.growth}</td>
                    <td style={{ ...td, color: R.dim }}>{r.formula}{r.otherFigure ? <div>Another figure exists: {r.otherFigure}</div> : null}{r.issues.map((x, k) => <div key={k} style={{ color: R.red }}>{x}</div>)}</td>
                    <td style={td}>{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>{r.source || 'source'}</a> : r.source || 'no source link'}<div style={{ color: R.dim, fontSize: 11 }}>{r.date || 'date not stated'}</div></td>
                    <td style={td}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GuFold>
  );
}
