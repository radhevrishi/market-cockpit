'use client';
// zzz1193 — the guidance AI check on the focus list: "Check new guidance", "Read the plan's evidence", "Add a company". Each runs in the
// background on the server (≤ 12 companies, its own small daily ceiling) and the page shows what the AI found — added rows join
// tables A / B with a 🤖 label; every other answer says why it was not added. Logic: lib/gu-ai-check.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { R, tint } from './gu-tokens';
import { DECISION_WORD, type AiCheckResult, type AiCheckTarget, type AiEvidence } from '@/lib/gu-ai-check';

interface Report { results: AiCheckResult[]; updatedAt: string | null; last: { at: string; mode: string; asked: number; checked: number; added: number; spentUsd: number; stoppedBy: string | null; error: string | null } | null; spentToday: number; dailyCapUsd: number }
interface JobSt { state: 'idle' | 'running' | 'done' | 'error'; startedAt: string | null; error: string | null }
const URL_ = '/api/v1/guidance-ai-check';

export function useGuAiCheck() {
  const [report, setReport] = useState<Report | null>(null);
  const [job, setJob] = useState<JobSt | null>(null);
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j: any = await fetch(URL_, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (j?.ok) { setReport(j.report); setJob(j.job); }
    return j;
  }, []);
  const poll = useCallback(async (startedAt: string | null) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 12 * 60_000) {
      await new Promise((r) => setTimeout(r, 5000));
      setSecs(Math.round((Date.now() - (startedAt ? Date.parse(startedAt) : t0)) / 1000));
      const j = await load();
      const st = j?.job?.state;
      if (st === 'done' || st === 'error') return;
    }
  }, [load]);
  useEffect(() => { void load().then((j) => { if (j?.job?.state === 'running') void poll(j.job.startedAt); }); }, [load, poll]);
  const run = useCallback(async (body: Record<string, unknown>) => {
    setMsg(null);
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j: any = r ? await r.json().catch(() => null) : null;
    if (!r || !r.ok || !j?.ok) { setMsg(j?.error || (r?.status === 401 ? 'Log in to run the AI check.' : `Could not start (HTTP ${r?.status ?? '—'})`)); return; }
    setJob(j.job); await poll(j.job?.startedAt ?? null);
  }, [poll]);
  const results = report?.results || [];
  const evidence = useMemo(() => { const m = new Map<string, AiEvidence>(); for (const r of results) if (r.evidence) m.set(r.key, r.evidence); return m; }, [results]);
  return { report, job, secs, msg, run, results, evidence, running: job?.state === 'running' };
}

const DEC_COLOR: Record<string, string> = { ADD: R.green, NOT_FOCUS: R.dim, NOT_GUIDANCE: R.amber, NO_DOCUMENT: R.amber, CHECK: R.red };

export function GuAiCheckPanel({ ai, newTargets, evidenceTargets, market }: { ai: ReturnType<typeof useGuAiCheck>; newTargets: AiCheckTarget[]; evidenceTargets: AiCheckTarget[]; market: 'IN' | 'US' }) {
  const [names, setNames] = useState('');
  const [open, setOpen] = useState(false);
  const { report, job, secs, msg, running } = ai;
  const last = report?.last;
  const recent = useMemo(() => {
    if (!report?.results?.length) return [];
    const cut = last?.at ? Date.parse(last.at) - 20 * 60_000 : 0;
    return report.results.filter((r) => Date.parse(r.checkedAt) >= cut).sort((a, b) => (a.decision === 'ADD' ? -1 : 0) - (b.decision === 'ADD' ? -1 : 0) || b.checkedAt.localeCompare(a.checkedAt));
  }, [report, last]);
  const btn = (on: boolean, c: string): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: on ? 'pointer' : 'not-allowed', border: `1px solid ${c}`, background: tint(c, 10), color: c, opacity: on ? 1 : 0.5 });
  const left = report ? Math.max(0, report.dailyCapUsd - report.spentToday) : null;
  return (
    <div data-gu-ai-check style={{ border: `1px solid ${tint(R.violet, 50)}`, borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 6, background: tint(R.violet, 4) }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ fontSize: 13.5 }}>🤖 AI check</b>
        <button type="button" disabled={running || !newTargets.length} style={btn(!running && newTargets.length > 0, R.green)} onClick={() => void ai.run({ mode: 'new', targets: newTargets })}
          title="Reads the newest company documents the page could not size (amount-only targets, this season's calls) and adds those guiding 30%+ growth to table B — each sentence checked word for word in the document.">
          Check new guidance ({newTargets.length})
        </button>
        <button type="button" disabled={running || !evidenceTargets.length} style={btn(!running && evidenceTargets.length > 0, R.cyan)} onClick={() => void ai.run({ mode: 'evidence', targets: evidenceTargets })}
          title="For the top focus names: reads the document for capacity, orders, customers, whether earlier guidance was delivered and any target pushed out — fills those Sky Gold checks.">
          Read plan evidence ({evidenceTargets.length})
        </button>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Missing company? e.g. Acutaas, KROSS" aria-label="Companies to add"
            style={{ fontSize: 12.5, padding: '4px 8px', borderRadius: 6, border: `1px solid ${R.border}`, minWidth: 200, background: 'transparent', color: R.text }} />
          <button type="button" disabled={running || !names.trim()} style={btn(!running && !!names.trim(), R.violet)} onClick={() => void ai.run({ mode: 'names', names, market })}>Add with AI</button>
        </span>
        <span style={{ fontSize: 11.5, color: R.dim, marginLeft: 'auto' }}>
          {running ? `Reading… ${secs}s (about 10–20 s a company)` : left != null ? `AI budget left today $${left.toFixed(2)} of $${report!.dailyCapUsd.toFixed(2)}` : ''}
        </span>
      </div>
      {msg && <div style={{ fontSize: 12, color: R.red }}>{msg}</div>}
      {job?.state === 'error' && job.error && <div style={{ fontSize: 12, color: R.red }}>{job.error}</div>}
      {last && !running && (
        <div style={{ fontSize: 12, color: R.dim }}>
          Last run {new Date(last.at).toLocaleString()}: {last.checked} of {last.asked} read · <b style={{ color: last.added ? R.green : R.dim }}>{last.added} added</b> · ${last.spentUsd.toFixed(3)}
          {last.stoppedBy === 'budget' ? ' · stopped: the day\'s AI budget is used (resumes tomorrow, UTC)' : last.stoppedBy === 'time' ? ' · stopped: time limit — run again for the rest' : ''}
          {recent.length > 0 && <button type="button" onClick={() => setOpen((v) => !v)} style={{ all: 'unset', cursor: 'pointer', color: R.cyan, fontWeight: 700, marginLeft: 6 }}>{open ? 'hide answers' : `show ${recent.length} answers`}</button>}
        </div>
      )}
      {open && recent.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {recent.map((r) => (
            <div key={r.key} style={{ fontSize: 12.5, borderTop: `1px solid ${tint(R.grey, 25)}`, paddingTop: 4 }}>
              <b>{r.company}</b> <span style={{ color: R.dim }}>{r.ticker || ''}</span> — <b style={{ color: DEC_COLOR[r.decision] || R.dim }}>{DECISION_WORD[r.decision]}</b>
              {r.growthLow != null && <span> · {r.metric?.toLowerCase()} {r.growthLow === r.growthHigh || r.growthHigh == null ? `+${r.growthLow}%` : `+${r.growthLow}–${r.growthHigh}%`}{(r.years ?? 1) > 1 ? ' a year' : ''} {r.period ? `(${r.period})` : ''}{r.growthHow === 'WORKED_OUT' ? ` — ${r.targetText} against ${r.baseText}` : ''}</span>}
              <div style={{ color: R.dim }}>{r.reason}{r.issues.length ? ` · ${r.issues.join('; ')}` : ''}</div>
              {r.quote && <div style={{ color: R.dim, fontStyle: 'italic' }}>“{r.quote.slice(0, 260)}”{r.quoteFound ? '' : ' (not found word for word)'}</div>}
              {r.doc && <div style={{ fontSize: 11.5, color: R.faint ?? R.dim }}>{r.doc.url ? <a href={r.doc.url} target="_blank" rel="noopener noreferrer">{r.doc.title}</a> : r.doc.title}{r.doc.filedAt ? ` · ${r.doc.filedAt.slice(0, 10)}` : ''}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
