'use client';
// zzz865 — COVERAGE CHECK. Paste company names; each one is checked against the guidance universe. Not found = "not read yet" (never "no guidance").
// One click adds the unread names to the automatic read-first list. Company names only, never a holding.
import React, { useMemo, useState } from 'react';
import { R, box, tint } from './gu-tokens';
import { btn } from './GuBits';
import { GuPanel } from './GuPanel';
import { useGuUniverse } from './useGuUniverse';
import { checkCoverage, coverageSummary, parseNames, type CoverageActive, type CoverageClaim, type CoverageStatus } from '@/lib/guidance-coverage-check';

const COLOR: Record<CoverageStatus, string> = { ACTIVE: R.green, CLAIM_WAITING: R.amber, NOT_SEEN: R.red };
const LABEL: Record<CoverageStatus, string> = { ACTIVE: 'IN THE UNIVERSE', CLAIM_WAITING: 'CLAIM WAITING FOR DOCUMENT', NOT_SEEN: 'NOT READ YET' };

export function GuNameCheck() {
  const { data } = useGuUniverse({ market: 'ALL', view: 'active' });
  const [text, setText] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo<CoverageActive[]>(() => (data?.records || []).map((r) => ({
    company: r.record.company, ticker: r.record.ticker ?? null, market: r.record.market, display: r.display, metric: r.metric, period: r.record.guidanceDuration || null, verification: r.record.verification ?? null,
  })), [data]);
  const claims = useMemo<CoverageClaim[]>(() => (data?.pipeline?.claims || []).map((c) => ({
    company: c.company, ticker: c.ticker, market: c.market, claim: `${c.claimed_metric} ${c.claimed_growth} · ${c.claimed_period}`, status: c.verification_status, nextAction: c.next_action,
  })), [data]);
  const rows = useMemo(() => checkCoverage(names, active, claims), [names, active, claims]);
  const sum = coverageSummary(rows);
  const unseen = rows.filter((r) => r.status === 'NOT_SEEN').map((r) => r.input);

  const run = () => { setNote(null); setNames(parseNames(text)); };
  const request = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch('/api/v1/guidance-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: unseen }) });
      const j = await r.json().catch(() => null);
      setNote(r.ok && j?.ok ? `Added ${j.added} name${j.added === 1 ? '' : 's'} to the read-first list (${j.total} in total). Their next filings are read first on the next run.` : (j?.error || 'This could not be saved. Please sign in and try again.'));
    } catch { setNote('This could not be saved right now. Please try again.'); }
    setBusy(false);
  };

  return (
    <GuPanel id="gu-coverage-check" icon="🔍" title="Coverage check" accent={R.cyan} defaultOpen={false}
      hint="Paste company names to see which ones the tab already holds, and which have not been read yet.">
      <div style={{ display: 'grid', gap: 8 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'One name per line, or separated by commas. Numbers and notes in brackets are ignored.'}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: 8, borderRadius: 8, border: `1px solid ${R.border}`, background: R.bg, color: R.text, fontFamily: 'inherit' }} aria-label="Company names to check" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={btn(R.cyan, true)} onClick={run} disabled={!text.trim()}>Check these names</button>
          {names.length > 0 && <span style={{ fontSize: 12, color: R.dim }}>{sum.total} checked · {sum.active} in the universe · {sum.waiting} claim waiting · {sum.notSeen} not read yet</span>}
        </div>
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: R.dim, fontSize: 11 }}><th style={{ padding: '4px 6px' }}>You typed</th><th style={{ padding: '4px 6px' }}>Status</th><th style={{ padding: '4px 6px' }}>What we hold</th><th style={{ padding: '4px 6px' }}>Next step</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.input} style={{ borderTop: `1px solid ${R.border}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '6px', fontWeight: 700 }}>{r.input}{r.matched && r.matched.toLowerCase() !== r.input.toLowerCase() ? <div style={{ fontWeight: 400, color: R.dim, fontSize: 11 }}>{r.matched}{r.ticker ? ` · ${r.ticker}` : ''}</div> : null}</td>
                    <td style={{ padding: '6px' }}><span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, color: COLOR[r.status], border: `1px solid ${tint(COLOR[r.status], 45)}`, background: tint(COLOR[r.status], 10), whiteSpace: 'nowrap' }}>{LABEL[r.status]}</span></td>
                    <td style={{ padding: '6px' }}>{r.line}{r.guidance.slice(0, 3).map((g, i) => <div key={i} style={{ color: R.dim, fontSize: 11.5 }}>{g}</div>)}</td>
                    <td style={{ padding: '6px', color: R.dim }}>{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unseen.length > 0 && (
          <div style={box({ padding: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 })}>
            <span>{unseen.length} name{unseen.length === 1 ? ' is' : 's are'} not read yet. Add them so their filings are read first, automatically.</span>
            <button type="button" style={btn(R.green, true)} onClick={request} disabled={busy}>{busy ? 'Adding…' : 'Add to automatic read list'}</button>
          </div>
        )}
        {note && <div style={{ fontSize: 12, color: R.dim }} role="status">{note}</div>}
      </div>
    </GuPanel>
  );
}
