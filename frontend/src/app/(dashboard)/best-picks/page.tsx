'use client';
// zzz1305 — Best Picks: the last Daily Best Picks email as it was sent, the full scoring of every company behind it, and two
// buttons — a preview (builds it now, sends nothing) and a test send.
import { useCallback, useEffect, useMemo, useState } from 'react';

const C = { bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)', green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)', cyan: 'var(--mc-cyan)' };
const LIST_COL: Record<string, string> = { TOP: 'var(--mc-bullish)', 'ADD-ON': 'var(--mc-cyan)', 'STILL VALID': 'var(--mc-text-3)', 'REGIME HELD': 'var(--mc-warn)', 'RAN ALREADY': 'var(--mc-warn)', 'NEAR MISS': '#A78BFA', 'NEW CATALYST': '#A78BFA', 'LEFT OUT': 'var(--mc-text-4)', 'NOT SHOWN': 'var(--mc-text-4)' };

export default function BestPicksPage() {
  const [last, setLast] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'working' | 'error'>('loading');
  const [msg, setMsg] = useState<string>('');
  const [filter, setFilter] = useState<string>('ALL');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const j = await fetch('/api/v1/cron/best-picks?last=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setLast(j?.last ?? null); setState('ready');
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (mode: 'dry' | 'send') => {
    if (mode === 'send' && !window.confirm('Send the Best Picks email now (a test send, even if today\'s already went out)?')) return;
    setState('working'); setMsg(mode === 'dry' ? 'Building the email from every source (up to a minute)…' : 'Building and sending…');
    const j = await fetch(`/api/v1/cron/best-picks?${mode === 'dry' ? 'dry=1' : 'force=1'}`, { method: 'POST', cache: 'no-store' }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    if (!j?.ok) setMsg(`Failed: ${j?.error || j?.partial || 'no channel delivered'}`);
    else if (mode === 'send') setMsg(`Sent — email: ${j.sent?.email ?? '?'}, Telegram: ${j.sent?.telegram ?? '?'}${j.partial ? ` · partial: ${j.partial}` : ''}`);
    else setMsg(`Preview built — ${j.counts?.top ?? 0} top picks from ${j.counts?.candidates ?? 0} companies.`);
    await load();
  };

  const rows: any[] = useMemo(() => (last?.scored || []).filter((s: any) => filter === 'ALL' || s.list === filter), [last, filter]);
  const lists = useMemo(() => { const m = new Map<string, number>(); for (const s of last?.scored || []) m.set(s.list, (m.get(s.list) || 0) + 1); return m; }, [last]);
  const btn = (color: string): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 14%, transparent)`, color });

  return (
    <div style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.text }}>⭐ Daily Best Picks</h1>
        <span style={{ fontSize: 13.5, color: C.muted }}>One email a weekday at 14:40 Berlin: a catalyst plus a second independent confirmation, a healthy trend, small / mid size.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button disabled={state === 'working'} onClick={() => run('dry')} style={btn(C.cyan)}>▶ Preview now (no send)</button>
          <button disabled={state === 'working'} onClick={() => run('send')} style={btn(C.amber)}>✉ Send test email</button>
        </div>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg.startsWith('Failed') ? C.red : C.text2 }}>{msg}</div>}
      {state === 'loading' ? <div style={{ marginTop: 20, color: C.muted }}>Loading the last run…</div>
        : !last ? <div style={{ marginTop: 20, color: C.muted }}>No run stored yet — press “Preview now”.</div>
          : (
            <>
              <div style={{ marginTop: 12, fontSize: 13, color: C.muted }}>
                Last run {String(last.at).replace('T', ' ').slice(0, 16)} UTC {last.dry ? '(preview — not sent)' : '(sent)'} · <b style={{ color: C.text }}>{last.subject}</b>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14, marginTop: 10, alignItems: 'start' }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  <iframe title="Best Picks email" srcDoc={last.html} style={{ width: '100%', height: 'calc(100vh - 200px)', border: 0 }} sandbox="allow-popups allow-popups-to-escape-sandbox" />
                </div>
                <div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {['ALL', ...lists.keys()].map((k) => (
                      <button key={k} onClick={() => setFilter(k)} style={{ padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: `1px solid ${filter === k ? (LIST_COL[k] || C.cyan) : C.border}`, background: 'transparent', color: filter === k ? (LIST_COL[k] || C.cyan) : C.muted }}>
                        {k === 'ALL' ? `All ${last.scored?.length ?? 0}` : `${k} ${lists.get(k)}`}
                      </button>
                    ))}
                  </div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, maxHeight: 'calc(100vh - 240px)', overflow: 'auto', background: C.bg }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>{['Company', 'Score', 'List', 'Why not / risk'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px', fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {rows.map((s) => {
                          const k = `${s.market}:${s.ticker}`; const isOpen = open.has(k);
                          return (
                            <tr key={k} onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                              <td style={{ padding: 8 }}><b style={{ color: C.text }}>{s.ticker}</b> <span style={{ fontSize: 11 }}>{s.market === 'IN' ? '🇮🇳' : '🇺🇸'}</span><div style={{ fontSize: 11.5, color: C.muted }}>{s.company}</div>
                                {isOpen && <div style={{ marginTop: 6, fontSize: 12, color: C.text2, lineHeight: 1.5, fontFamily: 'ui-monospace, Menlo, monospace' }}>{s.breakdown.map((b: string, i: number) => <div key={i} style={{ color: b.startsWith('✕') ? C.red : b.startsWith('!') ? C.amber : b.startsWith('+') ? C.green : C.muted }}>{b}</div>)}</div>}
                              </td>
                              <td style={{ padding: 8, fontWeight: 900, fontSize: 15, color: s.score >= 50 ? C.green : s.score >= 30 ? C.cyan : C.muted }}>{s.score}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 600 }}>{s.familyCount} fam.</div></td>
                              <td style={{ padding: 8, fontSize: 11.5, fontWeight: 800, color: LIST_COL[s.list] || C.muted, whiteSpace: 'nowrap' }}>{s.list}</td>
                              <td style={{ padding: 8, fontSize: 12, color: C.text2 }}>{s.excluded || s.vetoes[0] || s.warnings[0] || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Click a company for every point and every check. Sources: {(last.sources || []).map((s: any) => `${s.label} ${s.state}`).join(' · ')}</div>
                </div>
              </div>
            </>
          )}
    </div>
  );
}
