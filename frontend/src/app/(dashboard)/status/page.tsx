'use client';

/**
 * PATCH 0219 — System Status page.
 *
 * Probes every critical pipeline on the user's request and renders a
 * Bloomberg-style status board. Each probe shows:
 *   - Health dot (green / amber / red)
 *   - HTTP status
 *   - Latency (ms)
 *   - Last-checked timestamp
 *   - 1-line description of what the pipeline does
 *
 * This is a P0 institutional readiness item — buy-side analysts won't
 * trust a research surface they can't audit the freshness of.
 *
 * Limitations (intentional, not bugs):
 *   - All probes run client-side, so they're scoped to what the user can
 *     reach. A separate server-side heartbeat with KV-persisted history
 *     is the long-term fix.
 *   - No alerting yet (no Slack/email when a pipeline goes red). That
 *     pairs with the alerts engine P1 item.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { TOKENS } from '@/lib/design-tokens';

interface ProbeDef {
  id: string;
  label: string;
  description: string;
  /** Execute the probe and return { ok, status, ms, note?, raw? }. */
  run: () => Promise<ProbeResult>;
  staleAfterMs: number;
}
interface ProbeResult {
  ok: boolean;
  status: number;
  ms: number;
  note?: string;
}

const PROBES: ProbeDef[] = [
  {
    id: 'news-in-play',
    label: 'News · In Play',
    description: '/news/in-play — hot stories last 12 hours, refresh every 90s',
    staleAfterMs: 3 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const r = await api.get('/news/in-play', { timeout: 10_000 });
        const ms = Math.round(performance.now() - t0);
        const count = Array.isArray(r.data) ? r.data.length : 0;
        return { ok: r.status === 200 && count >= 0, status: r.status, ms, note: `${count} items` };
      } catch (e: any) {
        return { ok: false, status: e?.response?.status ?? 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
  {
    id: 'news-bottleneck',
    label: 'News · Bottleneck',
    description: '/news/bottleneck-dashboard — persistent themes (India + Global)',
    staleAfterMs: 5 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const r = await api.get('/news/bottleneck-dashboard', { timeout: 10_000 });
        const ms = Math.round(performance.now() - t0);
        const ind = (r.data?.india?.length ?? 0);
        const glob = (r.data?.global?.length ?? 0);
        return { ok: r.status === 200, status: r.status, ms, note: `${ind} IN · ${glob} GL` };
      } catch (e: any) {
        return { ok: false, status: e?.response?.status ?? 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
  {
    id: 'earnings-post-gap',
    label: 'Earnings · Post-Gap',
    description: '/api/v1/earnings/post-gap — Day-1 / cumulative price action',
    staleAfterMs: 5 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/v1/earnings/post-gap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ ticker: 'RELIANCE', filing_date: '2026-04-15', period: 'Mar 2026', timing: 'post' }] }),
        });
        const ms = Math.round(performance.now() - t0);
        const j = await r.json().catch(() => ({}));
        const sourceTier = j?.data?.RELIANCE?.filing_date_source;
        return { ok: r.ok && !!j?.data, status: r.status, ms, note: sourceTier ? `tier: ${sourceTier}` : 'no data' };
      } catch (e: any) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
  {
    id: 'earnings-enrich',
    label: 'Earnings · Enrich',
    description: '/api/v1/earnings/enrich — Screener-backed quarterly enrichment',
    staleAfterMs: 5 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/v1/earnings/enrich?symbols=RELIANCE');
        const ms = Math.round(performance.now() - t0);
        const j = await r.json().catch(() => ({}));
        const has = !!j?.data?.RELIANCE?.sales_curr_cr;
        return { ok: r.ok && has, status: r.status, ms, note: has ? 'data present' : 'no data' };
      } catch (e: any) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
  {
    id: 'earnings-graded',
    label: 'Earnings · Graded',
    description: '/api/v1/earnings/graded — KV calendar (NSE+BSE filings)',
    staleAfterMs: 15 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const r = await fetch(`/api/v1/earnings/graded?date=${todayIso}`);
        const ms = Math.round(performance.now() - t0);
        const j = await r.json().catch(() => ({}));
        const total = j?.candidates_total ?? 0;
        return { ok: r.ok, status: r.status, ms, note: `${total} graded for ${todayIso}` };
      } catch (e: any) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
  {
    id: 'earnings-scan',
    label: 'Earnings · Scan',
    description: '/api/market/earnings-scan — 750-ticker universe Earnings Cards',
    staleAfterMs: 10 * 60_000,
    run: async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/market/earnings-scan?symbols=RELIANCE');
        const ms = Math.round(performance.now() - t0);
        const j = await r.json().catch(() => ({}));
        const card = j?.cards?.[0];
        return { ok: r.ok && card?.dataStatus !== 'MISSING', status: r.status, ms, note: card ? `status: ${card.dataStatus}` : 'no card' };
      } catch (e: any) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), note: e?.message };
      }
    },
  },
];

interface ProbeState {
  status: 'idle' | 'loading' | 'done';
  result?: ProbeResult;
  checkedAt?: number;
}

// PATCH 0236 — 24h history ring buffer in localStorage.
// Each probe result is appended; entries older than 24h are evicted on read.
// Renders a tiny sparkline per row so reliability is visible across the
// session. Real uptime % (24h/7d/30d) needs a server-side recorder.
interface ProbeHistoryEntry { t: number; ok: boolean; ms: number; status: number; }
const HISTORY_KEY = 'mc:status-history:v1';
const HISTORY_WINDOW_MS = 24 * 3600_000;
function loadHistory(): Record<string, ProbeHistoryEntry[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    const out: Record<string, ProbeHistoryEntry[]> = {};
    for (const [k, arr] of Object.entries(parsed || {})) {
      if (Array.isArray(arr)) out[k] = (arr as ProbeHistoryEntry[]).filter(e => e?.t >= cutoff);
    }
    return out;
  } catch { return {}; }
}
function appendHistory(id: string, entry: ProbeHistoryEntry) {
  if (typeof window === 'undefined') return;
  try {
    const all = loadHistory();
    const arr = all[id] || [];
    arr.push(entry);
    // keep last 200 per probe to bound size
    const trimmed = arr.slice(-200);
    all[id] = trimmed;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch {}
}
function uptimePct(arr: ProbeHistoryEntry[]): number {
  if (!arr.length) return -1;
  const okCount = arr.filter(e => e.ok).length;
  return Math.round((okCount / arr.length) * 1000) / 10;
}
function Sparkline({ data, color, fail }: { data: ProbeHistoryEntry[]; color: string; fail: string }) {
  if (!data.length) return <span style={{ fontSize: 9, color: '#4A5B6C', fontFamily: 'ui-monospace, monospace' }}>no history</span>;
  const w = 80, h = 14;
  const cellW = Math.max(2, Math.floor(w / Math.max(1, data.length)));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${data.length * cellW} ${h}`} style={{ display: 'block' }}>
      {data.map((e, i) => (
        <rect
          key={i} x={i * cellW} y={0} width={cellW - 1} height={h}
          fill={e.ok ? color : fail}
          opacity={e.ok ? 0.9 : 1}
        />
      ))}
    </svg>
  );
}

export default function StatusPage() {
  const [states, setStates] = useState<Record<string, ProbeState>>(() =>
    Object.fromEntries(PROBES.map(p => [p.id, { status: 'idle' as const }])),
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  // PATCH 0236 — history per probe id
  const [history, setHistory] = useState<Record<string, ProbeHistoryEntry[]>>(() => loadHistory());

  const runOne = async (probe: ProbeDef) => {
    setStates(s => ({ ...s, [probe.id]: { ...s[probe.id], status: 'loading' } }));
    // PATCH 0296 — Catch probe-side throws so a single failure can't leave
    // a row stuck in 'loading' state. Probes already return `ok: false`
    // for handled failures; this guards against unexpected crashes inside
    // the probe (network exception, JSON parse error, etc.).
    let result: ProbeResult;
    try {
      result = await probe.run();
    } catch (err) {
      result = {
        ok: false,
        status: 0,
        ms: 0,
        note: `Probe threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    setStates(s => ({ ...s, [probe.id]: { status: 'done', result, checkedAt: Date.now() } }));
    // PATCH 0236 — record into 24h ring buffer
    const entry: ProbeHistoryEntry = { t: Date.now(), ok: result.ok, ms: result.ms, status: result.status };
    appendHistory(probe.id, entry);
    setHistory(loadHistory());
  };

  // PATCH 0296 — Promise.allSettled so one stuck probe can't hold up others.
  const runAll = () => {
    Promise.allSettled(PROBES.map(p => runOne(p)));
  };

  // Auto-run on mount
  useEffect(() => { runAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Optional 60s auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(runAll, 60_000);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [autoRefresh]);

  const summary = useMemo(() => {
    const results = Object.values(states).map(s => s.result).filter(Boolean) as ProbeResult[];
    const ok = results.filter(r => r.ok).length;
    const total = PROBES.length;
    const allDone = Object.values(states).every(s => s.status === 'done');
    return { ok, total, allDone };
  }, [states]);

  const overallColor =
    !summary.allDone     ? TOKENS.severity.medium.solid :
    summary.ok === summary.total ? TOKENS.semantic.bullish.solid :
    summary.ok >= summary.total - 1 ? TOKENS.severity.high.solid :
                                       TOKENS.semantic.bearish.solid;

  return (
    <div style={{
      padding: '24px 32px', minHeight: '100vh',
      backgroundColor: TOKENS.surface.canvas, color: TOKENS.surface.text,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>System Status</h1>
          <p style={{ fontSize: 13, color: TOKENS.surface.textDim, margin: '4px 0 0' }}>
            Live probe of every critical pipeline. Click a row to retry it. Auto-refresh polls every 60s.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6,
            backgroundColor: `${overallColor}15`, color: overallColor,
            border: `1px solid ${overallColor}40`,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: overallColor }} />
            {summary.allDone ? `${summary.ok}/${summary.total} healthy` : 'Running…'}
          </span>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{
              backgroundColor: autoRefresh ? `${TOKENS.surface.accent}20` : 'transparent',
              border: `1px solid ${autoRefresh ? TOKENS.surface.accent : TOKENS.surface.cardBorder}`,
              color: autoRefresh ? TOKENS.surface.accent : TOKENS.surface.textDim,
              borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {autoRefresh ? '● Auto-refresh ON' : '○ Auto-refresh OFF'}
          </button>
          <button
            onClick={runAll}
            style={{
              backgroundColor: TOKENS.surface.accent,
              border: 'none', color: '#000',
              borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >Run All</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PROBES.map(probe => {
          const s = states[probe.id];
          const result = s?.result;
          const checkedAt = s?.checkedAt;
          const isStale = checkedAt ? Date.now() - checkedAt > probe.staleAfterMs : false;
          const tone =
            s?.status === 'loading' ? TOKENS.severity.medium :
            !result                 ? TOKENS.state.archived :
            !result.ok              ? TOKENS.semantic.bearish :
            isStale                 ? TOKENS.state.stale :
                                       TOKENS.semantic.bullish;
          return (
            <button
              key={probe.id}
              onClick={() => runOne(probe)}
              style={{
                backgroundColor: TOKENS.surface.card,
                border: `1px solid ${TOKENS.surface.cardBorder}`,
                borderLeft: `3px solid ${tone.solid}`,
                borderRadius: 10, padding: '12px 16px',
                display: 'grid', gridTemplateColumns: '14px 1fr 1fr 90px 110px 90px 120px',
                gap: 14, alignItems: 'center',
                textAlign: 'left', cursor: 'pointer', color: 'inherit',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: tone.solid, boxShadow: `0 0 8px ${tone.solid}40` }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{probe.label}</div>
                <div style={{ fontSize: 11, color: TOKENS.surface.textDim, marginTop: 2 }}>{probe.description}</div>
              </div>
              <div style={{ fontSize: 11, color: TOKENS.surface.textDim, fontFamily: 'ui-monospace, monospace' }}>
                {result?.note || (s?.status === 'loading' ? 'probing…' : '—')}
              </div>
              {/* PATCH 0236 — 24h sparkline + uptime % */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                   title={(() => {
                     const arr = history[probe.id] || [];
                     const pct = uptimePct(arr);
                     return `${arr.length} probes in last 24h${pct >= 0 ? ` — ${pct}% green` : ''}`;
                   })()}
              >
                <Sparkline data={(history[probe.id] || []).slice(-40)} color={TOKENS.semantic.bullish.solid} fail={TOKENS.semantic.bearish.solid} />
                <span style={{ fontSize: 9, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace' }}>
                  {(() => {
                    const arr = history[probe.id] || [];
                    const pct = uptimePct(arr);
                    return arr.length === 0 ? 'no history' : `${pct}% · ${arr.length}p`;
                  })()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: TOKENS.surface.textDim, fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>
                {result ? `${result.status || '—'} · ${result.ms}ms` : '—'}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, textAlign: 'center',
                backgroundColor: tone.bg, color: tone.solid, border: `1px solid ${tone.border}`,
              }}>
                {s?.status === 'loading' ? 'CHECKING' :
                 !result                 ? 'PENDING' :
                 !result.ok              ? 'FAIL' :
                 isStale                 ? 'STALE' :
                                            'OK'}
              </div>
              <div style={{ fontSize: 10, color: TOKENS.surface.textDim, fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>
                {checkedAt ? new Date(checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
              </div>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: TOKENS.surface.textMuted, marginTop: 24, lineHeight: 1.6 }}>
        Probes execute from your browser and history is stored in this tab's localStorage (24h
        rolling window). A server-side heartbeat with KV-persisted history (uptime % over 7d/30d
        and cross-user aggregation) is the long-term plan and pairs with the alerts engine.
      </p>
    </div>
  );
}
