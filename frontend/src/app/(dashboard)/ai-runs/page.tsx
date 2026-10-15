// zzz1050 — AI runs: one row per model call (Postgres ai_run). Today's cost against the caps, runs per day, why calls failed,
// which models answered, the slowest calls, and the latest calls (filter by result or job). Light page, plain words.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { OUTCOME_LABEL, OUTCOME_COLOR, usd, secs, pct, when, jobLabel, escalationText } from './ai-runs-format';

interface Row {
  runId: string; job: string; model: string | null; promptVersion: string | null; docId: string | null; ticker: string | null;
  startedAt: string; durationMs: number; inputTokens: number; outputTokens: number; costUsd: number; outcome: string;
  error: string | null; rowsKept: number | null; rowsRejected: number | null; escalationReason: string | null;
}
interface Api {
  ok: boolean; error?: string;
  budget?: {
    guidanceToday: { spentUsd: number; capUsd: number };
    escalationToday: { spentUsd: number; capUsd: number; model: string | null };
    month: { month: string; spentUsd: number; capUsd: number; calls: number; failed: number; schemaFailures: number; schemaFailuresByJob: Record<string, number> } | null;
    provider: string; model: string;
  };
  runs?: {
    available: boolean; reason?: string;
    perDay: Array<{ day: string; runs: number; costUsd: number; failed: number }>;
    byOutcome: Array<{ outcome: string; runs: number }>;
    failureReasons: Array<{ outcome: string; error: string; runs: number; lastAt: string }>;
    modelMix: Array<{ model: string; runs: number; costUsd: number }>;
    byJob: Array<{ job: string; runs: number; costUsd: number }>;
    slowest: Row[]; rows: Row[];
    today: { runs: number; costUsd: number; escalatedUsd: number };
  };
}

const C = { bg: '#ffffff', panel: '#f8fafc', line: '#e2e8f0', text: '#0f172a', soft: '#475569', faint: '#94a3b8', accent: '#1d4ed8' };
const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: 14 };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${C.line}`, color: C.soft, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.line}`, fontSize: 13, verticalAlign: 'top' };

function Meter({ label, spent, cap, note }: { label: string; spent: number; cap: number; note?: string }) {
  const p = pct(spent, cap);
  const color = p >= 100 ? '#b91c1c' : p >= 80 ? '#b45309' : '#047857';
  return (
    <div style={box}>
      <div style={{ fontSize: 12, color: C.soft }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '4px 0' }}>{usd(spent, spent < 1 ? 4 : 2)} <span style={{ fontSize: 13, color: C.soft, fontWeight: 400 }}>of {usd(cap, cap < 1 ? 2 : 0)}</span></div>
      <div style={{ height: 6, background: C.line, borderRadius: 3 }}><div style={{ width: `${p}%`, height: 6, background: color, borderRadius: 3 }} /></div>
      {note ? <div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}

function RunsTable({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <div style={{ color: C.soft, fontSize: 13 }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Started</th><th style={th}>Job</th><th style={th}>Company / document</th><th style={th}>Model</th><th style={th}>Result</th>
          <th style={th}>Rows kept / thrown out</th><th style={th}>Took</th><th style={th}>Tokens in / out</th><th style={th}>Cost</th><th style={th}>Why</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.runId}>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.startedAt)}</td>
              <td style={td}>{jobLabel(r.job)}</td>
              <td style={td}>{r.ticker || '—'}{r.docId ? <div style={{ color: C.faint, fontSize: 11 }}>{r.docId}</div> : null}</td>
              <td style={td}>{r.model || '—'}{r.promptVersion ? <div style={{ color: C.faint, fontSize: 11 }}>{r.promptVersion}</div> : null}</td>
              <td style={{ ...td, color: OUTCOME_COLOR[r.outcome] || C.text, fontWeight: 600 }}>{OUTCOME_LABEL[r.outcome] || r.outcome}</td>
              <td style={td}>{r.rowsKept == null ? '—' : `${r.rowsKept} / ${r.rowsRejected ?? 0}`}</td>
              <td style={td}>{secs(r.durationMs)}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}</td>
              <td style={td}>{usd(r.costUsd)}</td>
              <td style={{ ...td, color: C.soft, maxWidth: 360 }}>{[escalationText(r.escalationReason), r.error].filter(Boolean).join(' · ') || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AiRunsPage() {
  const [days, setDays] = useState(14);
  const [outcome, setOutcome] = useState('');
  const [job, setJob] = useState('');
  const [data, setData] = useState<Api | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const key = `${days}|${outcome}|${job}|${refresh}`;
  const loading = loadedKey !== key;
  const load = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let off = false;
    const q = new URLSearchParams({ days: String(days), ...(outcome ? { outcome } : {}), ...(job ? { job } : {}) });
    fetch(`/api/v1/ai-runs?${q}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: Api) => { if (!off) { setData(j); setLoadedKey(key); } })
      .catch((e: any) => { if (!off) { setData({ ok: false, error: String(e?.message || e) }); setLoadedKey(key); } });
    return () => { off = true; };
  }, [key, days, outcome, job]);

  const b = data?.budget; const v = data?.runs;
  const maxDay = Math.max(1, ...(v?.perDay || []).map((d) => d.runs));
  return (
    <div style={{ background: C.panel, color: C.text, minHeight: '100vh', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI runs</h1>
          <div style={{ fontSize: 13, color: C.soft }}>Every call to an AI model: what it cost, how long it took, and whether it worked. Kept for 90 days.</div>
        </div>
        <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', color: C.accent, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {data && !data.ok ? <div style={{ ...box, color: '#b91c1c', marginBottom: 14 }}>{data.error || 'Could not load.'}</div> : null}

      {b ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
          <Meter label="Guidance reading today (UTC)" spent={b.guidanceToday.spentUsd} cap={b.guidanceToday.capUsd} note="Daily ceiling for reading company documents. Reading stops when it is reached." />
          <Meter label="Stronger model today" spent={b.escalationToday.spentUsd} cap={b.escalationToday.capUsd}
            note={b.escalationToday.model ? `Hard documents only, read again by ${b.escalationToday.model}. Part of the daily ceiling above.` : 'Switched off — every document is read by the normal model only.'} />
          {b.month ? <Meter label={`All AI this month (${b.month.month})`} spent={b.month.spentUsd} cap={b.month.capUsd} note={`${b.month.calls.toLocaleString()} calls · ${b.month.failed} failed · ${b.month.schemaFailures} wrong-shape answers`} /> : null}
          <div style={box}>
            <div style={{ fontSize: 12, color: C.soft }}>Today</div>
            <div style={{ fontSize: 20, fontWeight: 700, margin: '4px 0' }}>{v?.today.runs ?? 0} calls</div>
            <div style={{ fontSize: 12, color: C.soft }}>{usd(v?.today.costUsd ?? 0)} recorded · normal model {b.model} ({b.provider})</div>
          </div>
        </div>
      ) : null}

      {v && !v.available ? <div style={{ ...box, color: C.soft, marginBottom: 14 }}>{v.reason || 'Run records are not available.'}</div> : null}

      {v?.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Calls per day</div>
              {v.perDay.length ? v.perDay.map((d) => (
                <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ width: 80, color: C.soft }}>{d.day}</span>
                  <div style={{ flex: 1, height: 10, background: C.line, borderRadius: 3 }}><div style={{ width: `${pct(d.runs, maxDay)}%`, height: 10, background: C.accent, borderRadius: 3 }} /></div>
                  <span style={{ width: 150, textAlign: 'right' }}>{d.runs} calls · {usd(d.costUsd, 3)}{d.failed ? <span style={{ color: '#b91c1c' }}> · {d.failed} not ok</span> : null}</span>
                </div>
              )) : <div style={{ color: C.soft, fontSize: 13 }}>No calls in this window.</div>}
            </div>
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Results</div>
              {v.byOutcome.map((o) => (
                <div key={o.outcome} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: OUTCOME_COLOR[o.outcome] || C.text }}>{OUTCOME_LABEL[o.outcome] || o.outcome}</span><span>{o.runs}</span>
                </div>
              ))}
              <div style={{ fontWeight: 600, margin: '12px 0 8px' }}>Models used</div>
              {v.modelMix.map((m) => (
                <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{m.model}</span><span>{m.runs} calls · {usd(m.costUsd, 3)}</span>
                </div>
              ))}
              <div style={{ fontWeight: 600, margin: '12px 0 8px' }}>Jobs</div>
              {v.byJob.map((j) => (
                <div key={j.job} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{jobLabel(j.job)}</span><span>{j.runs} calls · {usd(j.costUsd, 3)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...box, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Why calls did not work (grouped)</div>
            {v.failureReasons.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Result</th><th style={th}>Reason</th><th style={th}>Times</th><th style={th}>Last seen</th></tr></thead>
                <tbody>{v.failureReasons.map((f, i) => (
                  <tr key={i}><td style={{ ...td, color: OUTCOME_COLOR[f.outcome] || C.text }}>{OUTCOME_LABEL[f.outcome] || f.outcome}</td><td style={td}>{escalationText(f.error) || f.error}</td><td style={td}>{f.runs}</td><td style={{ ...td, whiteSpace: 'nowrap' }}>{when(f.lastAt)}</td></tr>
                ))}</tbody>
              </table>
            ) : <div style={{ color: C.soft, fontSize: 13 }}>Every call in this window worked.</div>}
          </div>

          <div style={{ ...box, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Slowest calls</div>
            <RunsTable rows={v.slowest} empty="No calls in this window." />
          </div>

          <div style={box}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>Latest calls</div>
              <label style={{ fontSize: 13, color: C.soft }}>Window{' '}
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: `1px solid ${C.line}`, borderRadius: 4, padding: 3, background: C.bg, color: C.text }}>
                  {[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d === 1 ? 'last 24 hours' : `last ${d} days`}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13, color: C.soft }}>Result{' '}
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 4, padding: 3, background: C.bg, color: C.text }}>
                  <option value="">all</option>
                  {Object.keys(OUTCOME_LABEL).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13, color: C.soft }}>Job{' '}
                <select value={job} onChange={(e) => setJob(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 4, padding: 3, background: C.bg, color: C.text }}>
                  <option value="">all</option>
                  {v.byJob.map((j) => <option key={j.job} value={j.job}>{jobLabel(j.job)}</option>)}
                </select>
              </label>
            </div>
            <RunsTable rows={v.rows} empty="No calls match these filters." />
          </div>
        </>
      ) : null}
    </div>
  );
}
