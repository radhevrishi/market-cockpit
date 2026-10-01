'use client';
// zzz848 — Guidance diagnostics: the owner's 20-name regression list, one row each, with an honest status. Not linked from the main page.
import React, { useCallback, useEffect, useState } from 'react';
import type { GuRegressionResponse, GuRegressionStatus } from '@/lib/guidance-universe-types';
import { REGRESSION_STATUS_LABEL, REGRESSION_URL, investigatedCount } from '@/lib/guidance-upgrades-format';
import { PRINT_CSS, R, box } from './gu-tokens';
import { Chip, btn } from './GuBits';

const COLOR: Record<GuRegressionStatus, string> = { VERIFIED: R.green, PARTIALLY_VERIFIED: R.amber, NOT_FOUND: R.grey, REJECTED: R.red, SUPERSEDED: R.grey, EXPIRED: R.grey };

export function GuRegressionTable() {
  const [data, setData] = useState<GuRegressionResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setState('loading');
    (async () => {
      try {
        const r = await fetch(REGRESSION_URL, { cache: 'no-store', signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j || !Array.isArray(j.rows)) throw new Error('bad answer');
        if (ac.signal.aborted) return;
        setData(j as GuRegressionResponse); setState('ok');
      } catch (e) { if (!ac.signal.aborted) { setData(null); setState('error'); } }
    })();
    return () => ac.abort();
  }, [tick]);
  const rows = data?.rows || [];
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', padding: '6px 8px', borderBottom: `2px solid ${R.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${R.border}`, verticalAlign: 'top', fontSize: 12.5 };
  return (
    <div className="gu-page" style={{ color: R.text, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{PRINT_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: 0.8, margin: 0 }}>GUIDANCE DIAGNOSTICS</h1>
        <span style={{ fontSize: 12, color: R.dim }}>{data ? `${investigatedCount(data.counts, rows.length)}${data.asOf ? ` · as of ${data.asOf.slice(0, 16).replace('T', ' ')}` : ''}` : 'Regression list'}</span>
      </div>
      <div style={{ fontSize: 12.5, color: R.dim }}>Each name on the owner&apos;s list, what was expected, what the system found, and why it has its status.</div>
      {state === 'loading' && !data && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>Regression list loading / not available yet.</div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>The regression list could not be read right now. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={() => setTick((t) => t + 1)}>Retry</button>
        </div>
      )}
      {data && data.counts && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
          {(Object.keys(REGRESSION_STATUS_LABEL) as GuRegressionStatus[]).map((k) => (
            <span key={k}><Chip color={COLOR[k]} dashed={k === 'NOT_FOUND'}>{REGRESSION_STATUS_LABEL[k]}</Chip> <b>{data.counts[k] ?? 0}</b></span>
          ))}
        </div>
      )}
      {data && rows.length === 0 && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>No rows returned. This is not a result; the list is not available.</div>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Owner\'s list', 'Company (ticker)', 'Expected', 'Found', 'Source', 'Period', 'Metric', 'Status', 'Reason'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{r.ownerText}</td>
                  <td style={td}><b>{r.company}</b>{r.ticker ? ` (${r.ticker})` : ' (ticker not resolved)'}</td>
                  <td style={td}>{r.expected}</td>
                  <td style={td}>{r.found || '—'}</td>
                  <td style={td}>
                    {r.source ? (/^https?:\/\//i.test(r.source) ? <a href={r.source} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>Open link</a> : r.source) : '—'}
                    {r.sourceDate ? <div style={{ fontSize: 11, color: R.dim }}>{r.sourceDate.slice(0, 10)}</div> : null}
                  </td>
                  <td style={td}>{r.period || '—'}</td>
                  <td style={td}>{r.metric || '—'}</td>
                  <td style={td}><Chip color={COLOR[r.status] || R.grey}>{REGRESSION_STATUS_LABEL[r.status] || String(r.status)}</Chip></td>
                  <td style={{ ...td, overflowWrap: 'anywhere', minWidth: 200 }}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11, color: R.faint }}>Company data only. Not investment advice.</div>
    </div>
  );
}
