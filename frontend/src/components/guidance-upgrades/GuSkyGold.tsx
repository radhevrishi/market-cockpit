'use client';
// zzz923 — the "Next Sky Gold" score on the focus list: one batched fetch for the listed names only, a score cell (number + one
// band word) and an open-on-click breakdown of every check (met / half / not met / not known) and every red flag.
import React, { useEffect, useRef, useState } from 'react';
import { R, tint } from './gu-tokens';
import type { SkyFacts } from '@/lib/gu-skygold-facts';
import { BAND_WORDS, type SkyBand, type SkyScore, type SkyStatus } from '@/lib/gu-skygold-score';

export const SKY_BAND_COLOR: Record<SkyBand, string> = { STRONG: R.green, GOOD: R.cyan, MIXED: R.amber, WEAK: R.grey };
const MARK: Record<SkyStatus, { t: string; c: string; w: string }> = {
  pass: { t: '✓', c: R.green, w: 'met' }, partial: { t: '½', c: R.amber, w: 'half met' }, fail: { t: '✗', c: R.red, w: 'not met' }, unknown: { t: '?', c: R.grey, w: 'not known' },
};

export type SkyFactsMap = Record<string, SkyFacts | null>;
export type SkyCaps = { IN: Record<string, number>; US: Record<string, number> };
/** Facts for 'IN:TICKER' / 'US:TICKER' keys. Asks only for names not asked yet; asks once more for names the server did not reach.
 *  zzz925: also the market caps the server read (India ₹ Cr, USA $M), and India company names so a BSE-only company is found by name. */
export function useSkyGoldFacts(keys: string[], names?: Record<string, string>): { facts: SkyFactsMap; caps: SkyCaps; loading: boolean; failed: boolean } {
  const [facts, setFacts] = useState<SkyFactsMap>({});
  const [caps, setCaps] = useState<SkyCaps>({ IN: {}, US: {} });
  const namesRef = useRef(names);
  useEffect(() => { namesRef.current = names; }, [names]);   // runs before the fetch effect below
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const asked = useRef<Set<string>>(new Set());
  const done = useRef<Set<string>>(new Set());
  const sig = keys.slice().sort().join(',');
  useEffect(() => {
    const askedSet = asked.current, doneSet = done.current;
    const todo = keys.filter((k) => !askedSet.has(k));
    if (!todo.length) return;
    todo.forEach((k) => asked.current.add(k));
    let stop = false;
    const ask = async (want: string[], tries: number): Promise<void> => {
      const q = (mk: string) => want.filter((k) => k.startsWith(`${mk}:`)).map((k) => k.slice(3)).join(',');
      const nm = want.filter((k) => k.startsWith('IN:') && namesRef.current?.[k]).map((k) => `&n=${encodeURIComponent(`${k.slice(3)}:${namesRef.current![k]}`)}`).join('');
      const r = await fetch(`/api/v1/guidance-upgrades/skygold?in=${encodeURIComponent(q('IN'))}&us=${encodeURIComponent(q('US'))}${nm}`, { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(String(j?.error || r.status));
      if (!stop && j.caps && typeof j.caps === 'object') setCaps((p) => ({ IN: { ...p.IN, ...(j.caps.IN || {}) }, US: { ...p.US, ...(j.caps.US || {}) } }));
      const pend: string[] = Array.isArray(j.pending) ? j.pending : [];
      if (!stop) setFacts((p) => {
        const n = { ...p };
        for (const k of want) if (!pend.includes(k)) n[k] = (j.facts?.[k] ?? null) as SkyFacts | null;
        return n;
      });
      if (!stop) want.forEach((k) => { if (!pend.includes(k)) done.current.add(k); });
      if (pend.length && tries > 0 && !stop) { await new Promise((res) => setTimeout(res, 2500)); return ask(pend, tries - 1); }
      if (pend.length && !stop) { setFacts((p) => { const n = { ...p }; for (const k of pend) n[k] = n[k] ?? null; return n; }); pend.forEach((k) => done.current.add(k)); }
    };
    setLoading(true); setFailed(false);
    ask(todo, 2).catch(() => { if (!stop) { setFailed(true); todo.forEach((k) => asked.current.delete(k)); } }).finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; setLoading(false); todo.forEach((k) => { if (!doneSet.has(k)) askedSet.delete(k); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return { facts, caps, loading, failed };
}

/** The score cell: '83 STRONG', 'not enough data', or '…' while the figures load. Click opens the breakdown. */
export function SkyScoreCell({ s, waiting, open, onToggle, td }: { s: SkyScore | null; waiting: boolean; open: boolean; onToggle: () => void; td: React.CSSProperties }) {
  if (!s) return <td style={{ ...td, color: R.dim, fontSize: 12 }}>{waiting ? 'reading figures…' : '—'}</td>;
  const col = s.band ? SKY_BAND_COLOR[s.band] : R.grey;
  const tip = `${s.summary}${s.capNote ? `. ${s.capNote}` : ''}. Click for every check.`;
  return (
    <td style={td}>
      <button type="button" onClick={onToggle} aria-expanded={open} title={tip} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 2 }}>
        {s.score == null
          ? <span style={{ fontSize: 12, fontWeight: 700, color: R.grey, whiteSpace: 'nowrap' }}>not enough data</span>
          : <span style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 16, color: col }}>{s.score}</b> <b style={{ fontSize: 11.5, color: col }}>{s.band}</b></span>}
        <span style={{ fontSize: 11, color: R.dim, whiteSpace: 'nowrap' }}>{s.mustMet} of {s.mustTotal} main{s.flags.length ? ` · ${s.flags.length} flag${s.flags.length === 1 ? '' : 's'}` : ''} {open ? '▴' : '▾'}</span>
      </button>
    </td>
  );
}

/** The breakdown under a row: main checks, supporting checks, red flags — each in one plain line. */
export function SkyBreakdownRow({ s, facts, cols }: { s: SkyScore; facts: SkyFacts | null; cols: number }) {
  const line = (c: SkyScore['checks'][number]) => (
    <li key={c.id} style={{ listStyle: 'none', display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <b style={{ color: MARK[c.status].c, width: 14, flex: 'none' }} title={MARK[c.status].w}>{MARK[c.status].t}</b>
      <span><b>{c.label}</b> — {c.detail}</span>
    </li>
  );
  const box: React.CSSProperties = { margin: 0, padding: 0, display: 'grid', gap: 3, fontSize: 12.5 };
  return (
    <tr><td colSpan={cols} style={{ padding: '6px 10px 12px 34px', borderBottom: `1px solid ${tint(R.grey, 18)}`, background: tint(R.green, 4) }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12.5 }}>
          {s.score == null ? <b>Not enough data for a score</b> : <><b style={{ color: s.band ? SKY_BAND_COLOR[s.band] : R.grey }}>{s.score} {s.band}</b> — {s.band ? BAND_WORDS[s.band] : ''}</>}
          {s.capNote ? <span style={{ color: R.dim }}> · {s.capNote}</span> : null}
        </div>
        <div><b style={{ fontSize: 12 }}>Main checks (each one missed holds the score down)</b><ul style={box}>{s.checks.filter((c) => c.kind === 'must').map(line)}</ul></div>
        <div><b style={{ fontSize: 12 }}>Supporting checks (add points, cannot lift past the main-check limit)</b><ul style={box}>{s.checks.filter((c) => c.kind === 'support').map(line)}</ul></div>
        <div><b style={{ fontSize: 12 }}>Red flags</b>{s.flags.length
          ? <ul style={box}>{s.flags.map((f) => <li key={f.id} style={{ listStyle: 'none' }}><b style={{ color: R.red }}>−{f.points}</b> <b>{f.label}</b> — {f.detail}</li>)}</ul>
          : <div style={{ fontSize: 12.5, color: R.dim }}>none found in the figures read (promoter pledge is not collected)</div>}
        </div>
        <div style={{ fontSize: 11.5, color: R.dim }}>
          Figures: {facts ? `${facts.source}${facts.period ? `, latest quarter ${facts.period}` : ''}` : 'company figures not found — only the guidance checks could be read'}. Built on the “Identify Next SKY GOLD” framework: a big plan counts only when sales, margins, returns, cash and debt already back it.
        </div>
      </div>
    </td></tr>
  );
}
