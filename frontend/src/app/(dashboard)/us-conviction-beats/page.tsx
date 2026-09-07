'use client';

// ═══════════════════════════════════════════════════════════════════════════
// US CONVICTION BEATS — the accumulating bench of US names that graded
// BLOCKBUSTER or STRONG. The US sibling of the Conviction Beats tab on
// /watchlists.
//
// It fills itself two ways:
//   1. Every visit to /us-earnings-opportunities syncs that payload onto the
//      bench (and demotes anything that re-graded MIXED/AVOID).
//   2. A background sweep on this page walks the last N sessions of
//      /api/v1/earnings/graded-us so the bench builds up even if the
//      Opportunities page is never opened.
//
// The bench lives in its OWN localStorage namespace, separate from India —
// ticker symbols are not globally unique, and a shared store would have the
// two markets silently overwriting each other. See lib/conviction-beats-us.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCw, X, Undo2, ExternalLink, Star } from 'lucide-react';
import {
  getUsConvictionList, removeUsConviction, clearUsConviction, syncUsConviction,
  restoreUsConvictionBin, readUsConvictionBin,
  usFilingAgeDays, computeUsNewWindow, usVerdict,
  passesUsConvictionFilter, usPresetFilters, isUsPresetActive,
  US_FILTER_DEFAULT, US_PRESET,
  type UsConvictionEntry, type UsConvFilters,
} from '@/lib/conviction-beats-us';
import { fmtUsd, fmtPx, fmtPct } from '@/lib/us-earnings-core';

const OPT_OUT_KEY = 'mc:us-cb:preset:v1:optout';
const SWEEP_KEY = 'mc:us-cb:lastsweep:v1';
const VERDICT_COLOR: Record<string, string> = {
  'STRONG BUY': '#10B981', BUY: '#34D399', WATCH: '#FACC15', AVOID: '#EF4444',
};

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

export default function UsConvictionBeatsPage() {
  const [entries, setEntries] = useState<UsConvictionEntry[]>([]);
  const [filters, setFilters] = useState<UsConvFilters>(US_FILTER_DEFAULT);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  const [binCount, setBinCount] = useState(0);
  const [sort, setSort] = useState<'fresh' | 'score' | 'pead' | 'sales' | 'eps'>('fresh');
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const reload = useCallback(() => {
    setEntries(getUsConvictionList());
    setBinCount(readUsConvictionBin().length);
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener('conviction-beats-us:updated', h);
    return () => window.removeEventListener('conviction-beats-us:updated', h);
  }, [reload]);

  // Auto-apply the Quality Preset on first visit, unless the user opted out.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPT_OUT_KEY) === '1') return;
    } catch { return; }
    setFilters((prev) => (
      prev.sales == null && prev.eps == null && prev.pead == null
        && prev.opmDelta == null && prev.cfoPatMin == null && prev.mktCapMin == null && prev.verdicts == null
        ? usPresetFilters() : prev
    ));
  }, []);

  /** Walk recent sessions of graded-us so the bench fills without needing the
   *  Opportunities page. Chunked into 10-session windows to stay inside the
   *  route's own budget. */
  const sweep = useCallback(async (sessions = 30, manual = false) => {
    if (sweeping) return;
    setSweeping(true);
    setSweepMsg(null);
    let added = 0;
    try {
      const today = etToday();
      const chunks = Math.ceil(sessions / 10);
      for (let i = 0; i < chunks; i++) {
        const end = new Date(Date.parse(today + 'T00:00:00Z') - i * 10 * 86400000).toISOString().slice(0, 10);
        const res = await fetch(`/api/v1/earnings/graded-us?date=${end}&days=10`, { cache: 'no-store' });
        if (!res.ok) continue;
        const p = await res.json();
        const batch: any[] = [];
        for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
          for (const c of (p?.by_tier?.[t] || [])) {
            batch.push({ ...c, source_url: c.filing_url, is_financial: c.is_financial });
          }
        }
        if (batch.length) added += syncUsConviction(batch);
      }
      try { localStorage.setItem(SWEEP_KEY, new Date().toISOString()); } catch {}
      setSweepMsg(added > 0 ? `Bench updated — ${added} change${added > 1 ? 's' : ''} from the last ${sessions} sessions.` : 'Bench already up to date.');
    } catch (e: any) {
      setSweepMsg(`Sweep failed: ${String(e?.message || e)}`);
    } finally {
      setSweeping(false);
      reload();
      if (!manual) setTimeout(() => setSweepMsg(null), 8000);
    }
  }, [sweeping, reload]);

  // Sweep once every 6 hours on load, so an unattended bench keeps growing.
  useEffect(() => {
    let last = 0;
    try { last = Date.parse(localStorage.getItem(SWEEP_KEY) || '') || 0; } catch {}
    if (Date.now() - last > 6 * 3600_000) {
      const t = setTimeout(() => sweep(20), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newWindow = useMemo(() => computeUsNewWindow(entries), [entries]);

  const filtered = useMemo(() => {
    const rows = entries.filter((e) => passesUsConvictionFilter(e, filters, newWindow));
    const by: Record<string, (a: UsConvictionEntry, b: UsConvictionEntry) => number> = {
      fresh: (a, b) => b.filing_date.localeCompare(a.filing_date) || (b.composite_score ?? 0) - (a.composite_score ?? 0),
      score: (a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0),
      pead: (a, b) => (b.pead_score ?? 0) - (a.pead_score ?? 0),
      sales: (a, b) => (b.sales_yoy_pct ?? -1e9) - (a.sales_yoy_pct ?? -1e9),
      eps: (a, b) => (b.eps_yoy_pct ?? -1e9) - (a.eps_yoy_pct ?? -1e9),
    };
    return rows.slice().sort(by[sort]);
  }, [entries, filters, sort, newWindow]);

  const presetOn = isUsPresetActive(filters);
  const togglePreset = () => {
    setFilters((prev) => {
      if (isUsPresetActive(prev)) {
        try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
        return { ...US_FILTER_DEFAULT, cap: prev.cap, q: prev.q };
      }
      try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
      return { ...usPresetFilters(), cap: prev.cap, q: prev.q };
    });
  };

  const tierCounts = useMemo(() => ({
    BLOCKBUSTER: entries.filter((e) => e.tier === 'BLOCKBUSTER').length,
    STRONG: entries.filter((e) => e.tier === 'STRONG').length,
  }), [entries]);

  return (
    <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Award className="w-5 h-5" style={{ color: 'var(--mc-warn)' }} />
        <h1 style={{ fontSize: 'var(--mc-text-h3)', fontWeight: 800, color: 'var(--mc-text-0)', margin: 0 }}>
          US Conviction Beats
        </h1>
        <span style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 999,
          border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)',
        }}>NYSE · NASDAQ</span>
        <a href="/us-earnings-opportunities" style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
          border: '1px solid #F59E0B', color: '#F59E0B', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}><Star className="w-3 h-3" /> US Earnings Opportunities →</a>
      </div>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '0 0 14px' }}>
        The bench of US names that graded BLOCKBUSTER or STRONG. It accumulates on its own from every
        graded window and demotes a name automatically when a later quarter drops out of the top tiers.
        Stored in this browser — nothing is sent anywhere. Educational, not investment advice.
      </p>

      {/* ── quality preset ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={togglePreset}
          title={`Sales YoY ≥${US_PRESET.sales}% · EPS YoY ≥${US_PRESET.eps}% · PEAD ≥${US_PRESET.pead} · OPM Δ ≥${US_PRESET.opmDelta}pp · CFO/NI ≥${US_PRESET.cfoPatMin} (skipped for banks, insurers and REITs, where operating cash flow is a funding artefact) · Market cap ≥ $${US_PRESET.mktCapMinMusd}M · Verdict STRONG BUY / BUY / WATCH. No promoter-pledge gate — that concept does not exist in US markets.`}
          style={{
            fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '7px 12px', borderRadius: 999,
            cursor: 'pointer', border: '1px solid #F59E0B', color: '#F59E0B',
            backgroundColor: presetOn ? 'color-mix(in srgb, #F59E0B 14%, transparent)' : 'var(--mc-bg-2)',
          }}>
          ⚡ QUALITY PRESET · Sales≥{US_PRESET.sales} · EPS≥{US_PRESET.eps} · PEAD≥{US_PRESET.pead} · OPM Δ≥0 · CFO/NI≥{US_PRESET.cfoPatMin} · MktCap≥${US_PRESET.mktCapMinMusd}M {presetOn ? '✓ ON' : '· OFF — click to enable'}
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, newOnly: !p.newOnly }))} style={chip(filters.newOnly, '#10B981')}>
          NEW · {newWindow.days}d{newWindow.widened ? ` (widened from 10d)` : ''} {newWindow.count > 0 ? `(${newWindow.count})` : ''}
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, elite: !p.elite }))} style={chip(filters.elite, '#F59E0B')}>⭐ ELITE</button>
        <button onClick={() => setFilters((p) => ({ ...p, multibagger: !p.multibagger }))} style={chip(filters.multibagger, '#8B5CF6')}>💎 MULTIBAGGER</button>
      </div>

      {/* ── filters row ── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12,
        borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
        border: '1px solid var(--mc-bg-4)', marginBottom: 14,
      }}>
        <input value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          placeholder="Search ticker or company…"
          style={{
            fontSize: 'var(--mc-text-xs)', padding: '6px 10px', borderRadius: 999, minWidth: 200,
            border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-2)', color: 'var(--mc-text-0)',
          }} />
        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>Cap</span>
        {[['all', 'All'], ['smid', 'Small+Mid'], ['small', 'Small'], ['mid', 'Mid'], ['large', 'Large'], ['mega', 'Mega']].map(([v, l]) => (
          <button key={v} onClick={() => setFilters((p) => ({ ...p, cap: v }))} style={chip(filters.cap === v)}>{l}</button>
        ))}
        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', marginLeft: 6 }}>Tier</span>
        {['BLOCKBUSTER', 'STRONG'].map((t) => {
          const on = (filters.tiers || []).includes(t);
          return (
            <button key={t} onClick={() => setFilters((p) => {
              const cur = p.tiers || [];
              const next = on ? cur.filter((x) => x !== t) : [...cur, t];
              return { ...p, tiers: next.length ? next : null };
            })} style={chip(on, t === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981')}>{t}</button>
          );
        })}
        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', marginLeft: 6 }}>Sort</span>
        {[['fresh', 'Freshest'], ['score', 'Score'], ['pead', 'PEAD'], ['sales', 'Revenue'], ['eps', 'EPS']].map(([v, l]) => (
          <button key={v} onClick={() => setSort(v as any)} style={chip(sort === v)}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setView((v) => (v === 'cards' ? 'table' : 'cards'))} style={chip(false)}>
          {view === 'cards' ? '▦ Table' : '▤ Cards'}
        </button>
        <button onClick={() => setFilters({ ...US_FILTER_DEFAULT, cap: 'all' })} style={chip(false)}>Clear filters</button>
      </div>

      {/* ── status strip ── */}
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14,
        padding: '10px 14px', borderRadius: 'var(--mc-radius)',
        backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
        fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)',
      }}>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{entries.length}</b> on the bench</span>
        <span><b style={{ color: '#F59E0B' }}>{tierCounts.BLOCKBUSTER}</b> blockbuster</span>
        <span><b style={{ color: '#10B981' }}>{tierCounts.STRONG}</b> strong</span>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{filtered.length}</b> passing filters</span>
        <span style={{ flex: 1 }} />
        {binCount > 0 && (
          <button onClick={() => { restoreUsConvictionBin(); reload(); }} style={chip(false)}>
            <Undo2 className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            Restore {binCount} removed
          </button>
        )}
        <button onClick={() => sweep(30, true)} disabled={sweeping} style={{ ...chip(false), opacity: sweeping ? 0.5 : 1 }}>
          <RefreshCw className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4, animation: sweeping ? 'spin 1s linear infinite' : undefined }} />
          {sweeping ? 'Sweeping last 30 sessions…' : 'Rebuild from last 30 sessions'}
        </button>
        <button onClick={() => { if (confirm('Clear the entire US bench? Entries move to the recycle bin and can be restored.')) { clearUsConviction(); reload(); } }}
          style={chip(false, '#EF4444')}>Clear all</button>
      </div>
      {sweepMsg && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 12 }}>{sweepMsg}</div>
      )}

      {entries.length === 0 && (
        <div style={{ padding: 20, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)' }}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>The bench is empty</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            It fills itself from graded US results. Hit <b>Rebuild from last 30 sessions</b> above, or open{' '}
            <a href="/us-earnings-opportunities" style={{ color: 'var(--mc-cyan)' }}>US Earnings Opportunities</a> —
            every graded window syncs here automatically.
          </div>
        </div>
      )}

      {entries.length > 0 && filtered.length === 0 && (
        <div style={{ padding: 20, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)' }}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>Nothing passes the current filters</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            {presetOn ? 'The Quality Preset is strict by design — turn it off to see the whole bench.' : 'Loosen a filter or clear them all.'}
          </div>
        </div>
      )}

      {view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(370px, 1fr))', gap: 12 }}>
          {filtered.map((e) => <BenchCard key={`${e.ticker}-${e.filing_date}`} e={e} onRemove={() => { removeUsConviction(e.ticker); reload(); }} />)}
        </div>
      ) : (
        <BenchTable rows={filtered} onRemove={(t) => { removeUsConviction(t); reload(); }} />
      )}

      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function chip(active: boolean, color = 'var(--mc-cyan)'): React.CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px', borderRadius: 999,
    cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`,
    color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}

function BenchCard({ e, onRemove }: { e: UsConvictionEntry; onRemove: () => void }) {
  const v = usVerdict(e);
  const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  const age = usFilingAgeDays(e.filing_date);
  const opmD = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${tierColor}`, position: 'relative',
    }}>
      <button onClick={onRemove} title="Remove from bench"
        style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)' }}>
        <X className="w-3 h-3" />
      </button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingRight: 18 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text-0)' }}>{e.ticker}</span>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.company}</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0 9px' }}>
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: tierColor, border: `1px solid ${tierColor}` }}>{e.tier}</span>
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: VERDICT_COLOR[v.verdictLabel], border: `1px solid ${VERDICT_COLOR[v.verdictLabel]}` }}>{v.verdictLabel}</span>
        {e.quarter && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)' }}>{e.quarter}</span>}
        {age != null && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)' }}>·{age}d</span>}
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)' }}>{fmtUsd(e.market_cap_musd)}</span>
        {e.is_elite && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, color: '#F59E0B', border: '1px solid #F59E0B' }}>⭐ ELITE</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <MiniTile label="REV" value={fmtPct(e.sales_yoy_pct)} good={(e.sales_yoy_pct ?? 0) >= 20} />
        <MiniTile label="EPS" value={fmtPct(e.eps_yoy_pct)} good={(e.eps_yoy_pct ?? 0) >= 25} />
        <MiniTile label="OPM Δ" value={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'} good={(opmD ?? -1) >= 0} />
        <MiniTile label="PEAD" value={String(e.pead_score ?? '—')} good={(e.pead_score ?? 0) >= 60} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span>CFO/NI <b style={{ color: 'var(--mc-text-0)' }}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</b></span>
        <span>Score <b style={{ color: 'var(--mc-text-0)' }}>{e.composite_score}</b></span>
        <span>Since <b style={{ color: (e.move_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(e.move_pct, 1)}</b></span>
        <span>{fmtPx(e.price)}</span>
      </div>
      {v.reasons.length > 0 && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-3)', marginTop: 7 }}>{v.reasons.join(' · ')}</div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>filed {e.filing_date}{e.sector ? ` · ${e.sector}` : ''}</span>
        {e.source_url && (
          <a href={e.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            SEC <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function MiniTile({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: good ? 'var(--mc-bullish)' : 'var(--mc-text-0)' }}>{value}</div>
    </div>
  );
}

function BenchTable({ rows, onRemove }: { rows: UsConvictionEntry[]; onRemove: (t: string) => void }) {
  const th: React.CSSProperties = {
    textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 800,
    color: 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-bg-4)', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 10px', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-1)', whiteSpace: 'nowrap' };
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--mc-radius)', border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Ticker</th>
            <th style={{ ...th, textAlign: 'left' }}>Company</th>
            <th style={{ ...th, textAlign: 'left' }}>Tier</th>
            <th style={{ ...th, textAlign: 'left' }}>Verdict</th>
            <th style={th}>Rev YoY</th>
            <th style={th}>EPS YoY</th>
            <th style={th}>OPM Δ</th>
            <th style={th}>CFO/NI</th>
            <th style={th}>PEAD</th>
            <th style={th}>Score</th>
            <th style={th}>Mkt cap</th>
            <th style={th}>Since</th>
            <th style={{ ...th, textAlign: 'left' }}>Filed</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const v = usVerdict(e);
            const opmD = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
            const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
            return (
              <tr key={`${e.ticker}-${e.filing_date}`} style={{ borderBottom: '1px solid var(--mc-bg-3)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: 'var(--mc-text-0)' }}>{e.ticker}</td>
                <td style={{ ...td, textAlign: 'left', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.company}</td>
                <td style={{ ...td, textAlign: 'left', color: tierColor, fontWeight: 800 }}>{e.tier}</td>
                <td style={{ ...td, textAlign: 'left', color: VERDICT_COLOR[v.verdictLabel], fontWeight: 800 }}>{v.verdictLabel}</td>
                <td style={td}>{fmtPct(e.sales_yoy_pct)}</td>
                <td style={td}>{fmtPct(e.eps_yoy_pct)}</td>
                <td style={td}>{opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'}</td>
                <td style={td}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</td>
                <td style={td}>{e.pead_score ?? '—'}</td>
                <td style={{ ...td, fontWeight: 800, color: 'var(--mc-text-0)' }}>{e.composite_score}</td>
                <td style={td}>{fmtUsd(e.market_cap_musd)}</td>
                <td style={{ ...td, color: (e.move_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(e.move_pct, 1)}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--mc-text-3)' }}>{e.filing_date}</td>
                <td style={td}>
                  <button onClick={() => onRemove(e.ticker)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)' }}>
                    <X className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
