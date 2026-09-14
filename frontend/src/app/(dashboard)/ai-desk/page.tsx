'use client';
// ═══════════════════════════════════════════════════════════════════════════
// AI RESEARCH DESK  (zzz611)
//
// The deck this page shows is the answer to one question the screener could
// never answer: of the names the filings already qualified, which ones had
// something actually CHANGE, why would the market care now, and what is the
// best argument that each is wrong.
//
// THREE RULES THE LAYOUT ENFORCES
//
//  1. THE MACHINE'S NUMBER AND THE AI'S OPINION ARE NEVER MIXED. Every figure
//     in grey type came from SEC XBRL and is reproducible. Everything in the
//     interpretation block is a model's judgement and is labelled as one. A
//     reader must always be able to tell which is which at a glance, because
//     they carry completely different warranties.
//
//  2. THE BEAR CASE IS NOT COLLAPSED. It sits on the card, in full, at the
//     same weight as the thesis. A research tool that makes the argument
//     against easier to skip than the argument for is a marketing tool.
//
//  3. NOTHING CLAIMS TO BE PROVEN. The ledger tab shows sample sizes on every
//     row and says plainly when it is too young to mean anything.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type Tab = 'DESK' | 'LEDGER';

interface Ai {
  change_level: number; change_type: 'NOISE' | 'CYCLICAL' | 'STRUCTURAL';
  structural_score: number; structural_drivers: string[]; temporary_factors: string[];
  why_now_score: number; why_now: string[];
  bear_case: string; bear_severity: number; key_risks: string[];
  invalidation: string[]; thesis: string; confidence: number; not_established: string[];
}
interface Row {
  ticker: string; company: string; sector?: string | null; quarter?: string | null;
  filing_date: string; tier: string; price: number | null;
  engine_score: number | null; pead: number | null; rs: number | null;
  sales_yoy_pct: number | null; eps_yoy_pct: number | null; opm_pct: number | null;
  cfo_to_pat_ratio: number | null; d1_pct: number | null; market_cap_musd: number | null;
  filing_url: string | null; caveat_tags: string[];
  ai: Ai | null; ai_error?: string; composite: number;
  composite_parts?: Array<{ label: string; value: number; weight: number }>;
}

const CHANGE_COLOR: Record<string, string> = {
  STRUCTURAL: 'var(--mc-bullish, #22C55E)',
  CYCLICAL: '#EAB308',
  NOISE: 'var(--mc-bearish, #EF4444)',
};
const CHANGE_WORD: Record<string, string> = {
  STRUCTURAL: 'Structural — the earning power looks different',
  CYCLICAL: 'Cyclical — the industry turned, not the company',
  NOISE: 'Noise — the headline overstates what changed',
};

const fmtPct = (v?: number | null) => (v == null ? '·' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const fmtCap = (v?: number | null) => (v == null ? '·' : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`);

function Meter({ label, value, hint, invert }: { label: string; value: number; hint?: string; invert?: boolean }) {
  // Higher is better for every score except bear severity, where higher is
  // worse — so the colour rule is inverted rather than the number, which keeps
  // the printed figure the same one the model actually produced.
  const good = invert ? value < 40 : value >= 70;
  const mid = invert ? value < 65 : value >= 45;
  const col = good ? '#22C55E' : mid ? '#EAB308' : '#EF4444';
  return (
    <div title={hint} style={{ minWidth: 92 }}>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 17, fontWeight: 900, color: col, fontFamily: 'ui-monospace,monospace' }}>{value}</span>
        <span style={{ flex: 1, height: 5, background: 'var(--mc-bg-3)', borderRadius: 3, overflow: 'hidden', minWidth: 30 }}>
          <span style={{ display: 'block', width: `${Math.max(2, value)}%`, height: '100%', background: col }} />
        </span>
      </div>
    </div>
  );
}

export default function AiDeskPage() {
  const [tab, setTab] = useState<Tab>('DESK');
  const [days, setDays] = useState(10);
  const [limit, setLimit] = useState(12);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async (interpret: boolean) => {
    setLoading(true); setErr(null);
    try {
      // The first visit reads only what is already interpreted, so opening the
      // tab is instant and costs nothing. Interpreting is an explicit act.
      const r = await fetch(`/api/v1/ai/desk?days=${days}&limit=${limit}${interpret ? '' : '&cache_only=1'}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'The desk did not answer.');
      setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [days, limit]);

  const loadLedger = useCallback(async () => {
    try { const r = await fetch('/api/v1/ai/ledger', { cache: 'no-store' }); setLedger(await r.json()); } catch { /* shown as empty */ }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => { if (tab === 'LEDGER' && !ledger) void loadLedger(); }, [tab, ledger, loadLedger]);

  const rows: Row[] = useMemo(() => (data?.rows || []) as Row[], [data]);
  const interpreted = rows.filter((r) => r.ai);
  const pending = rows.filter((r) => !r.ai);
  const top = interpreted.slice(0, 5);

  const panel = (): React.CSSProperties => ({
    backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
    borderRadius: 'var(--mc-radius)', padding: 14, marginBottom: 12,
  });
  const chip = (on: boolean, col = 'var(--mc-cyan)'): React.CSSProperties => ({
    fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
    border: `1px solid ${on ? col : 'var(--mc-bg-4)'}`, background: on ? `${col}22` : 'transparent',
    color: on ? col : 'var(--mc-text-2)',
  });

  return (
    <div style={{ padding: '18px 20px 60px', maxWidth: 1400 }}>
      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 19, fontWeight: 900, color: 'var(--mc-text-0)' }}>🧠 AI Research Desk</h1>
        <span style={{ fontSize: 11, color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)', borderRadius: 20, padding: '2px 10px' }}>
          Machines calculate · AI interprets · You decide
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--mc-text-2)', lineHeight: 1.6, marginBottom: 14, maxWidth: 940 }}>
        Every figure on this page was computed by the engine from SEC XBRL filings and is reproducible. The interpretation blocks
        are a model reading those same figures and the company&rsquo;s own release, and answering the four things arithmetic cannot:
        is the change <b>structural</b>, why would the market re-rate it <b>now</b>, what is the strongest case <b>against</b>, and
        what would prove the read wrong. The model is forbidden to compute anything or to use knowledge of the company from
        outside the filing. Every assessment is written to a prediction ledger and marked against the market later.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setTab('DESK')} style={chip(tab === 'DESK')}>Today&rsquo;s deck</button>
        <button onClick={() => setTab('LEDGER')} style={chip(tab === 'LEDGER', '#A78BFA')}>Prediction ledger</button>
        <span style={{ flex: 1 }} />
        {tab === 'DESK' && (
          <>
            {[5, 10, 20, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} style={chip(days === d)}>{d}d</button>
            ))}
            {[6, 12, 20].map((l) => (
              <button key={l} onClick={() => setLimit(l)} style={chip(limit === l, '#60A5FA')}>top {l}</button>
            ))}
            {/* The button says WHAT IT WILL DO and roughly how long. A run that
                takes a minute with a bare spinner reads as a hang; one that
                said "9 names, about a minute" reads as work. */}
            <button onClick={() => load(true)} disabled={loading}
              title={pending.length ? `${pending.length} of these have never been interpreted. Each costs one model call; a filed quarter is then cached for a year, so this is paid once per company per quarter.` : 'Everything in this deck is already interpreted — this re-reads the cache.'}
              style={{ ...chip(false, '#22C55E'), cursor: loading ? 'wait' : 'pointer' }}>
              <RefreshCw className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5, animation: loading ? 'spin 1s linear infinite' : undefined }} />
              {loading
                ? `Interpreting${pending.length ? ` ${pending.length} name${pending.length > 1 ? 's' : ''}` : ''}…`
                : pending.length
                ? `Run the analyst on ${pending.length}`
                : 'Run the analyst'}
            </button>
          </>
        )}
      </div>

      {err && <div style={{ ...panel(), borderColor: 'rgba(239,68,68,0.4)', color: '#F87171', fontSize: 12 }}>{err}</div>}
      {loading && tab === 'DESK' && (
        <div style={{ ...panel(), borderLeft: '3px solid #22C55E', fontSize: 12, color: 'var(--mc-text-2)', lineHeight: 1.6 }}>
          Reading each company&rsquo;s filing figures and its own press release, then answering the four questions. Roughly
          {' '}<b style={{ color: 'var(--mc-text-0)' }}>{Math.max(1, Math.ceil((pending.length || rows.length || 1) * 12 / 3 / 60))} minute(s)</b> for this deck, three at a time.
          The whole deck is returned at once when it finishes — and every answer is then cached against its SEC accession number, so you pay for a quarter once.
        </div>
      )}

      {tab === 'DESK' && (
        <>
          <div style={{ ...panel(), display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--mc-text-2)' }}>
            <span><b style={{ color: 'var(--mc-text-0)' }}>{rows.length}</b> candidates from the engine</span>
            <span><b style={{ color: 'var(--mc-text-0)' }}>{interpreted.length}</b> interpreted</span>
            {data?.cached ? <span><b style={{ color: 'var(--mc-text-0)' }}>{data.cached}</b> from cache (a filed quarter never changes)</span> : null}
            {data?.failed ? <span style={{ color: 'var(--mc-caution,#F59E0B)' }}>{data.failed} could not be assessed</span> : null}
            {data?.sessions_pending?.length ? (
              <span style={{ color: 'var(--mc-text-3)' }}>
                {data.sessions_pending.length} session{data.sessions_pending.length > 1 ? 's' : ''} not graded yet — those names are not in this deck.
              </span>
            ) : null}
            {!interpreted.length && !loading && (
              <span style={{ color: 'var(--mc-text-3)' }}>Nothing interpreted yet — press <b>Run the analyst</b>.</span>
            )}
          </div>
          {(data?.notes || []).map((n: string, i: number) => (
            <div key={i} style={{ ...panel(), borderColor: 'rgba(245,158,11,0.35)', color: 'var(--mc-caution,#F59E0B)', fontSize: 11.5 }}>{n}</div>
          ))}

          {top.length > 0 && (
            <div style={{ ...panel(), borderLeft: '3px solid var(--mc-cyan)' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-0)', marginBottom: 6 }}>The five to look at first</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {top.map((r, i) => (
                  <span key={r.ticker} style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-text-0)', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 20, padding: '4px 11px' }}>
                    <span style={{ color: 'var(--mc-text-4)' }}>{i + 1}.</span> {r.ticker}
                    <span style={{ color: CHANGE_COLOR[r.ai!.change_type], marginLeft: 6 }}>{r.composite}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {interpreted.length > 0 && (
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.5, color: 'var(--mc-text-3)', margin: '4px 0 8px' }}>
              INTERPRETED — {interpreted.length}, ranked by the composite (engine grade blended with structural and why-now, less the bear drag)
            </div>
          )}
          {interpreted.map((r) => {
            const a = r.ai;
            const isOpen = open.has(r.ticker);
            return (
              <div key={r.ticker} style={{ ...panel(), padding: 0, overflow: 'hidden' }}>
                {/* ── the machine's half ── */}
                <div style={{ padding: '12px 14px', borderBottom: a ? '1px solid var(--mc-bg-4)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--mc-text-0)' }}>{r.ticker}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--mc-text-2)' }}>{r.company}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: r.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981', border: '1px solid currentColor', borderRadius: 5, padding: '1px 6px' }}>{r.tier}</span>
                    {r.quarter && <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{r.quarter} · filed {r.filing_date}</span>}
                    <span style={{ flex: 1 }} />
                    <span title="Engine grade blended with the AI's structural and why-now scores, minus a drag for the severity of the bear case."
                      style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-text-0)', fontFamily: 'ui-monospace,monospace' }}>{r.composite}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace,monospace' }}>
                    <span>Engine <b style={{ color: 'var(--mc-text-1)' }}>{r.engine_score ?? '·'}</b></span>
                    <span>PEAD <b style={{ color: 'var(--mc-text-1)' }}>{r.pead ?? '·'}</b></span>
                    <span>RS <b style={{ color: 'var(--mc-text-1)' }}>{r.rs ?? '·'}</b></span>
                    <span>Rev <b style={{ color: (r.sales_yoy_pct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(r.sales_yoy_pct)}</b></span>
                    <span>EPS <b style={{ color: (r.eps_yoy_pct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(r.eps_yoy_pct)}</b></span>
                    <span>OPM <b style={{ color: 'var(--mc-text-1)' }}>{r.opm_pct == null ? '·' : `${r.opm_pct.toFixed(1)}%`}</b></span>
                    <span>CFO/NI <b style={{ color: (r.cfo_to_pat_ratio ?? 1) >= 0.8 ? 'var(--mc-text-1)' : '#EF4444' }}>{r.cfo_to_pat_ratio?.toFixed(2) ?? '·'}</b></span>
                    <span>Reaction <b style={{ color: (r.d1_pct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(r.d1_pct)}</b></span>
                    <span>Cap <b style={{ color: 'var(--mc-text-1)' }}>{fmtCap(r.market_cap_musd)}</b></span>
                    {r.filing_url && <a href={r.filing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)' }}>filing ↗</a>}
                  </div>
                  {r.caveat_tags?.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--mc-caution,#F59E0B)' }}>
                      Engine caveats: {r.caveat_tags.join(' · ')}
                    </div>
                  )}
                </div>

                {/* ── the AI's half, unmistakably separate ── */}
                {!a ? (
                  <div style={{ padding: '10px 14px', fontSize: 11.5, color: 'var(--mc-text-3)' }}>
                    {r.ai_error || 'Not interpreted yet.'}
                  </div>
                ) : (
                  <div style={{ padding: '12px 14px', background: 'var(--mc-bg-2)' }}>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ minWidth: 210 }}>
                        <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3 }}>CLASSIFICATION</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: CHANGE_COLOR[a.change_type] }}>{a.change_type}</div>
                        <div style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>{CHANGE_WORD[a.change_type]} · level {a.change_level}/5</div>
                      </div>
                      <Meter label="STRUCTURAL" value={a.structural_score} hint="How much of this quarter's improvement should persist." />
                      <Meter label="WHY NOW" value={a.why_now_score} hint="How likely expectations are to move in the near term." />
                      <Meter label="BEAR SEVERITY" value={a.bear_severity} invert hint="How much damage the bear case does if it is right." />
                      <Meter label="CONFIDENCE" value={a.confidence} hint="The model's own confidence given how thin the material was." />
                    </div>

                    <div style={{ fontSize: 12.5, color: 'var(--mc-text-1)', lineHeight: 1.6, marginBottom: 10 }}>{a.thesis}</div>

                    {/* The bear case is given the same weight as the thesis, on
                        purpose. It is the half a reader is most tempted to skip. */}
                    <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>
                      <div style={{ fontSize: 9.5, fontWeight: 900, color: '#F87171', letterSpacing: 0.4, marginBottom: 4 }}>THE CASE AGAINST</div>
                      <div style={{ fontSize: 12, color: 'var(--mc-text-1)', lineHeight: 1.6 }}>{a.bear_case}</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
                      {a.why_now.length > 0 && (
                        <Block title="WHY NOW" color="#22C55E" items={a.why_now} />
                      )}
                      {a.structural_drivers.length > 0 && (
                        <Block title="WHAT ACTUALLY CHANGED" color="#60A5FA" items={a.structural_drivers} />
                      )}
                      {a.temporary_factors.length > 0 && (
                        <Block title="WHAT MAY NOT REPEAT" color="#EAB308" items={a.temporary_factors} />
                      )}
                      {isOpen && a.key_risks.length > 0 && <Block title="RISKS" color="#F87171" items={a.key_risks} />}
                      {isOpen && a.invalidation.length > 0 && <Block title="WHAT WOULD PROVE THIS WRONG" color="#A78BFA" items={a.invalidation} />}
                      {isOpen && a.not_established.length > 0 && <Block title="COULD NOT BE ESTABLISHED FROM THE FILING" color="#94A3B8" items={a.not_established} />}
                    </div>

                    <button onClick={() => setOpen((s) => { const n = new Set(s); n.has(r.ticker) ? n.delete(r.ticker) : n.add(r.ticker); return n; })}
                      style={{ marginTop: 9, ...chip(false) }}>
                      {isOpen ? '▴ less' : '▾ risks, invalidation, gaps'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── THE QUEUE, AS A LIST AND NOT AS CARDS ──────────────────────
              These carry the engine's grade and nothing else. Shown compactly
              and below the line, because a full card for a name the analyst has
              not read yet takes the space of one it has, and its score is not
              comparable with the ones above. */}
          {pending.length > 0 && (
            <div style={panel()}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--mc-text-0)', marginBottom: 3 }}>
                Awaiting interpretation — {pending.length}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 9, lineHeight: 1.55 }}>
                The engine has graded these; the analyst has not read them yet. Their score is the <b>engine grade alone</b> and is
                not comparable with the composites above, which have already had a bear case taken off them — so they are listed
                here rather than ranked among them. Press <b style={{ color: '#22C55E' }}>Run the analyst</b> to read them.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ color: 'var(--mc-text-3)', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Ticker</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Company</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Filed</th>
                      <th style={{ padding: '4px 6px' }}>Engine</th>
                      <th style={{ padding: '4px 6px' }}>PEAD</th>
                      <th style={{ padding: '4px 6px' }}>Rev</th>
                      <th style={{ padding: '4px 6px' }}>EPS</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Engine caveats</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.ticker} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
                        <td style={{ padding: '5px 6px', color: 'var(--mc-text-0)', fontWeight: 800 }}>{r.ticker}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--mc-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{r.company}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--mc-text-4)' }}>{r.filing_date}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 800 }}>{r.engine_score ?? '·'}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{r.pead ?? '·'}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.sales_yoy_pct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(r.sales_yoy_pct)}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: (r.eps_yoy_pct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(r.eps_yoy_pct)}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--mc-caution,#F59E0B)', fontSize: 10.5 }}>{(r.caveat_tags || []).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'LEDGER' && (
        <>
          <div style={panel()}>
            <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-0)', marginBottom: 4 }}>Prediction ledger</div>
            <div style={{ fontSize: 11.5, color: 'var(--mc-text-2)', lineHeight: 1.6 }}>
              Every assessment is recorded the moment it is made, with the engine&rsquo;s inputs and the model&rsquo;s scores frozen beside it,
              and marked later against what the stock actually did at 7 / 30 / 90 / 180 days — <b>relative to the S&amp;P 500</b>, because a
              rising tide is not a signal. Entries are written once and never rewritten, so this measures foresight rather than hindsight.
              {ledger?.note && <><br /><span style={{ color: 'var(--mc-caution,#F59E0B)' }}>{ledger.note}</span></>}
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--mc-text-3)' }}>
              <b style={{ color: 'var(--mc-text-1)' }}>{ledger?.total ?? 0}</b> predictions recorded ·{' '}
              <b style={{ color: 'var(--mc-text-1)' }}>{ledger?.scored ?? 0}</b> marked so far
            </div>
          </div>

          {(ledger?.learned || []).map((L: any) => (
            <div key={L.horizon} style={panel()}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--mc-text-0)', marginBottom: 8 }}>
                Which inputs carried information — {L.horizon.replace('d', '')} days
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ color: 'var(--mc-text-3)', textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Condition</th>
                    <th style={{ padding: '4px 6px' }}>n</th>
                    <th style={{ padding: '4px 6px' }}>hit rate</th>
                    <th style={{ padding: '4px 6px' }}>avg excess</th>
                    <th style={{ padding: '4px 6px' }}>vs. without</th>
                  </tr>
                </thead>
                <tbody>
                  {L.reads.map((rd: any, i: number) => {
                    const edge = +(rd.yes.avg_excess - rd.no.avg_excess).toFixed(1);
                    const thin = rd.yes.n < 20;
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
                        <td style={{ padding: '5px 6px', color: 'var(--mc-text-1)' }}>{rd.yes.label.replace(' — yes', '')}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: thin ? 'var(--mc-caution,#F59E0B)' : 'var(--mc-text-2)', fontFamily: 'ui-monospace,monospace' }}>{rd.yes.n}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: 'var(--mc-text-2)' }}>{rd.yes.hit_rate}%</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: rd.yes.avg_excess >= 0 ? '#22C55E' : '#EF4444' }}>{rd.yes.avg_excess > 0 ? '+' : ''}{rd.yes.avg_excess}pp</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: edge >= 0 ? '#22C55E' : '#EF4444' }}>{edge > 0 ? '+' : ''}{edge}pp</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 6 }}>
                Sample size is shown on every row and amber below 20. An edge over a handful of observations is not an edge.
              </div>
            </div>
          ))}

          {(ledger?.entries || []).length > 0 && (
            <div style={panel()}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--mc-text-0)', marginBottom: 8 }}>Recorded predictions</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: 'var(--mc-text-3)', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Ticker</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Filed</th>
                      <th style={{ padding: '4px 6px' }}>Engine</th>
                      <th style={{ padding: '4px 6px' }}>Struct</th>
                      <th style={{ padding: '4px 6px' }}>Why now</th>
                      <th style={{ padding: '4px 6px' }}>Bear</th>
                      <th style={{ padding: '4px 6px' }}>Comp</th>
                      <th style={{ padding: '4px 6px' }}>+30d excess</th>
                      <th style={{ padding: '4px 6px' }}>+90d excess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.map((e: any) => (
                      <tr key={e.id} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
                        <td style={{ padding: '4px 6px', color: 'var(--mc-text-0)', fontWeight: 800 }}>{e.ticker}</td>
                        <td style={{ padding: '4px 6px', color: 'var(--mc-text-3)' }}>{e.filing_date}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{e.engine_score ?? '·'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{e.structural_score ?? '·'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{e.why_now_score ?? '·'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>{e.bear_severity ?? '·'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontWeight: 800 }}>{e.composite ?? '·'}</td>
                        {(['d30', 'd90'] as const).map((h) => (
                          <td key={h} style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: e.out?.[h] ? (e.out[h].excess_pct >= 0 ? '#22C55E' : '#EF4444') : 'var(--mc-text-4)' }}>
                            {e.out?.[h] ? `${e.out[h].excess_pct > 0 ? '+' : ''}${e.out[h].excess_pct}%` : 'pending'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Block({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 900, color, letterSpacing: 0.4, marginBottom: 5 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 15, fontSize: 11.5, color: 'var(--mc-text-2)', lineHeight: 1.6 }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
