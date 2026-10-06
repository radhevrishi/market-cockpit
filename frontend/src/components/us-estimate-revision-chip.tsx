'use client';
// zzz890 — "Street estimates since the print" chip. Cards ask for their own ticker; requests made within 60 ms are
// batched into one call, and answers are kept for the visit.
import { useEffect, useState } from 'react';
import type { EstimateRevision } from '@/lib/us-estimate-revision';

const cache = new Map<string, EstimateRevision | null>();
const waiting = new Map<string, Array<(r: EstimateRevision | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const batch = Array.from(waiting.entries()); waiting.clear();
  for (let i = 0; i < batch.length; i += 40) {
    const part = batch.slice(i, i + 40);
    fetch(`/api/v1/us-estimate-revisions?items=${encodeURIComponent(part.map(([k]) => k).join(','))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { for (const [k, cbs] of part) { const v = j?.revisions?.[k.split(':')[0]] ?? null; cache.set(k, v); cbs.forEach((cb) => cb(v)); } })
      .catch(() => { for (const [k, cbs] of part) { cache.set(k, null); cbs.forEach((cb) => cb(null)); } });
  }
}
function ask(key: string, cb: (r: EstimateRevision | null) => void) {
  if (cache.has(key)) { cb(cache.get(key)!); return; }
  waiting.set(key, [...(waiting.get(key) || []), cb]);
  if (!timer) timer = setTimeout(flush, 60);
}

export function UsEstimateRevisionChip({ ticker, filingDate }: { ticker: string; filingDate: string | null }) {
  const key = `${String(ticker || '').toUpperCase()}:${String(filingDate || '').slice(0, 10)}`;
  const [rev, setRev] = useState<EstimateRevision | null | undefined>(cache.has(key) ? cache.get(key) : undefined);
  useEffect(() => { let alive = true; ask(key, (r) => { if (alive) setRev(r); }); return () => { alive = false; }; }, [key]);
  if (!rev || rev.verdict === 'NO_DATA') return null;
  const color = rev.verdict === 'RAISED' ? '#10B981' : rev.verdict === 'CUT' ? '#EF4444' : undefined;
  const fy = rev.lines.find((l) => l.period === '+1y' && l.changePct != null) || rev.lines.find((l) => l.changePct != null);
  const tip = `${rev.text}\n\n${rev.lines.map((l) => `${l.label}: ${l.before != null ? `$${l.before.toFixed(2)}` : '—'} (${l.anchor || 'before print'}) → ${l.now != null ? `$${l.now.toFixed(2)}` : '—'}${l.changePct != null ? `  ${l.changePct >= 0 ? '+' : ''}${l.changePct}%` : ''}${l.up != null || l.down != null ? `  · ${l.up ?? 0} up / ${l.down ?? 0} down` : ''}`).join('\n')}\n\nSource: Yahoo Finance consensus (epsTrend).`;
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 4, cursor: 'help',
      border: `1px solid ${color || 'var(--mc-bg-4)'}`, color: color || 'var(--mc-text-2)', background: color ? `${color}14` : 'transparent', whiteSpace: 'nowrap' }}>
      📊 Street EPS {rev.verdict === 'RAISED' ? 'raised' : rev.verdict === 'CUT' ? 'cut' : 'unchanged'}{fy?.changePct != null ? ` ${fy.changePct >= 0 ? '+' : ''}${fy.changePct}%` : ''} since print
    </span>
  );
}
