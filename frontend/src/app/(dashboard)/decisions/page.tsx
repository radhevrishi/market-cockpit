'use client';

// ═══════════════════════════════════════════════════════════════════════════
// DECISION LOGBOOK — PATCH 0454 TIER1-A
//
// Queryable journal of every BUY / WATCH / NEUTRAL / REJECTED decision the
// user has logged across Multibagger India + USA. Per audit:
//   • Filter by status × market × date range × free-text search.
//   • Sort by date / symbol / score-at-decision.
//   • Inline "current vs decision" delta (score then vs now).
//   • CSV export for compliance / audit / external review.
// Builds entirely from the existing /lib/decisions.ts localStorage store.
// No new API surface needed.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Trash2, Download, Filter, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { readDecisions, clearDecision, subscribeDecisions, setDecision, DECISION_META, type Decision, type DecisionStatus, type DecisionMarket } from '@/lib/decisions';

type StatusFilter = 'ALL' | DecisionStatus;
type MarketFilter = 'ALL' | DecisionMarket;
type SortKey = 'date' | 'symbol' | 'score';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => readDecisions());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // PATCH 0487 QA-#19 — manual entry modal so user can add a decision
  // directly without having to open Multibagger and expand a row.
  const [showAdd, setShowAdd] = useState(false);
  const [addSymbol, setAddSymbol] = useState('');
  const [addMarket, setAddMarket] = useState<DecisionMarket>('IN');
  const [addStatus, setAddStatus] = useState<DecisionStatus>('WATCH');
  const [addCompany, setAddCompany] = useState('');
  const [addReason, setAddReason] = useState('');
  const submitNewDecision = () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym) return;
    setDecision({
      symbol: sym, market: addMarket, status: addStatus,
      company: addCompany.trim() || undefined,
      reason: addReason.trim(),
    });
    // Reset & close
    setAddSymbol(''); setAddCompany(''); setAddReason('');
    setAddStatus('WATCH'); setAddMarket('IN');
    setShowAdd(false);
  };

  // Subscribe to cross-tab decision updates.
  useEffect(() => {
    const unsub = subscribeDecisions(() => setDecisions(readDecisions()));
    return unsub;
  }, []);

  // Filtered + sorted rows.
  const rows = useMemo(() => {
    const all = Object.values(decisions);
    const q = search.trim().toLowerCase();
    const filtered = all.filter(d => {
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      if (marketFilter !== 'ALL' && d.market !== marketFilter) return false;
      if (q) {
        const blob = `${d.symbol} ${d.company || ''} ${d.reason || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = (a.date || '').localeCompare(b.date || '');
      else if (sortBy === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
      else if (sortBy === 'score') cmp = (a.scoreAtDecision ?? 0) - (b.scoreAtDecision ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [decisions, statusFilter, marketFilter, search, sortBy, sortDir]);

  // AUDIT_100 #59 — outcome tracking. Look up the current score from the
  // multibagger localStorage so each decision shows score-now vs score-at-
  // decision. Price tracking would require fresh quotes; deferred. Score
  // alone is signal-rich because re-scoring on a fresh CSV upload captures
  // earnings/fundamentals updates.
  const currentScoreMap = useMemo(() => {
    if (typeof window === 'undefined') return new Map<string, { score?: number; grade?: string }>();
    const m = new Map<string, { score?: number; grade?: string }>();
    try {
      const inScored = JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]');
      if (Array.isArray(inScored)) for (const r of inScored) {
        if (r?.symbol) m.set(String(r.symbol).toUpperCase() + '|IN', { score: r.composite ?? r.score, grade: r.grade });
      }
    } catch {}
    try {
      const usScored = JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]');
      if (Array.isArray(usScored)) for (const r of usScored) {
        if (r?.symbol) m.set(String(r.symbol).toUpperCase() + '|US', { score: r.score, grade: r.grade });
      }
    } catch {}
    return m;
  }, [decisions]);

  const counts = useMemo(() => {
    const c: Record<DecisionStatus, number> = { BUY: 0, WATCH: 0, NEUTRAL: 0, REJECTED: 0 };
    Object.values(decisions).forEach(d => { c[d.status]++; });
    return c;
  }, [decisions]);

  const exportCsv = () => {
    const header = ['Symbol', 'Market', 'Status', 'Date', 'Company', 'Score@Decision', 'Grade@Decision', 'Reason'];
    const lines = [header.join(',')];
    for (const d of rows) {
      const row = [
        d.symbol,
        d.market,
        d.status,
        d.date ? new Date(d.date).toISOString().slice(0, 10) : '',
        (d.company || '').replace(/,/g, ';'),
        d.scoreAtDecision != null ? String(d.scoreAtDecision) : '',
        d.gradeAtDecision || '',
        (d.reason || '').replace(/[,\r\n]/g, ' ').slice(0, 200),
      ];
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>📒 Decision Logbook</h1>
          <span style={{ fontSize: 12, color: DIM }}>
            Every BUY / WATCH / NEUTRAL / REJECTED you logged. Survives uploads + clears.
          </span>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              marginLeft: 'auto', padding: '6px 12px', borderRadius: 6,
              background: '#10B98115', border: '1px solid #10B98160', color: '#10B981',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
            title="Add a decision manually without opening Multibagger"
          >
            <Plus size={12} /> NEW DECISION
          </button>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            style={{
              padding: '6px 12px', borderRadius: 6,
              background: '#22D3EE15', border: '1px solid #22D3EE60', color: '#22D3EE',
              fontSize: 12, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: rows.length ? 1 : 0.4,
            }}
          >
            <Download size={12} /> EXPORT CSV ({rows.length})
          </button>
        </div>

        {/* PATCH 0487 QA-#19 — Manual decision entry modal */}
        {showAdd && (
          <div onClick={() => setShowAdd(false)} style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: 24, minWidth: 420, maxWidth: 520, width: '90vw',
            }}>
              <h2 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 800, color: TEXT }}>
                + New Decision
              </h2>
              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  SYMBOL
                  <input
                    autoFocus
                    value={addSymbol}
                    onChange={(e) => setAddSymbol(e.target.value)}
                    placeholder="e.g. RELIANCE / TCS / NVDA"
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
                    }}
                  />
                </label>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  COMPANY NAME (optional)
                  <input
                    value={addCompany}
                    onChange={(e) => setAddCompany(e.target.value)}
                    placeholder="e.g. Reliance Industries"
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13,
                    }}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 4 }}>MARKET</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['IN', 'US'] as DecisionMarket[]).map((m) => (
                        <button key={m} onClick={() => setAddMarket(m)} style={{
                          flex: 1, padding: '6px 10px', borderRadius: 5,
                          border: `1px solid ${addMarket === m ? '#22D3EE' : BORDER}`,
                          background: addMarket === m ? '#22D3EE20' : 'transparent',
                          color: addMarket === m ? '#22D3EE' : DIM,
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 4 }}>STATUS</div>
                    <select
                      value={addStatus}
                      onChange={(e) => setAddStatus(e.target.value as DecisionStatus)}
                      style={{
                        width: '100%', padding: '6px 10px', borderRadius: 5,
                        border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {(['BUY','WATCH','NEUTRAL','REJECTED'] as DecisionStatus[]).map((s) => (
                        <option key={s} value={s}>{DECISION_META[s].emoji} {s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  REASON / NOTE
                  <textarea
                    value={addReason}
                    onChange={(e) => setAddReason(e.target.value)}
                    placeholder="Why this decision? Thesis, risk note, or trigger."
                    rows={3}
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12,
                      resize: 'vertical', fontFamily: 'inherit',
                    }}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setShowAdd(false)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 5,
                    border: `1px solid ${BORDER}`, background: 'transparent', color: DIM,
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={submitNewDecision} disabled={!addSymbol.trim()} style={{
                    flex: 2, padding: '8px 12px', borderRadius: 5,
                    border: '1px solid #10B981',
                    background: addSymbol.trim() ? '#10B98125' : 'transparent',
                    color: addSymbol.trim() ? '#10B981' : DIM,
                    fontSize: 12, fontWeight: 700, cursor: addSymbol.trim() ? 'pointer' : 'not-allowed',
                  }}>Save Decision</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status summary chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['ALL', 'BUY', 'WATCH', 'NEUTRAL', 'REJECTED'] as const).map(s => {
            const isActive = statusFilter === s;
            const meta = s === 'ALL' ? { color: '#22D3EE', emoji: '🎯', label: 'ALL' } : DECISION_META[s];
            const n = s === 'ALL' ? Object.keys(decisions).length : counts[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${isActive ? meta.color : BORDER}`,
                  background: isActive ? `${meta.color}20` : 'transparent',
                  color: isActive ? meta.color : DIM,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {meta.emoji} {meta.label} · {n}
              </button>
            );
          })}
          <span style={{ width: 1, background: BORDER, margin: '4px 4px' }} />
          {(['ALL', 'IN', 'US'] as const).map(m => {
            const isActive = marketFilter === m;
            return (
              <button
                key={m}
                onClick={() => setMarketFilter(m)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${isActive ? '#8B5CF6' : BORDER}`,
                  background: isActive ? '#8B5CF620' : 'transparent',
                  color: isActive ? '#8B5CF6' : DIM,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {m === 'IN' ? '🇮🇳 INDIA' : m === 'US' ? '🇺🇸 USA' : '🌐 ALL'}
              </button>
            );
          })}
        </div>

        {/* Search + sort */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol / company / reason…"
            style={{
              flex: '1 1 280px', maxWidth: 480,
              padding: '7px 12px', borderRadius: 6,
              border: `1px solid ${BORDER}`, background: CARD, color: TEXT,
              fontSize: 13, outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>SORT:</span>
          {(['date', 'symbol', 'score'] as const).map(k => {
            const isActive = sortBy === k;
            return (
              <button
                key={k}
                onClick={() => {
                  if (sortBy === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                  else { setSortBy(k); setSortDir('desc'); }
                }}
                style={{
                  padding: '5px 10px', borderRadius: 5,
                  border: `1px solid ${isActive ? '#22D3EE' : BORDER}`,
                  background: isActive ? '#22D3EE20' : 'transparent',
                  color: isActive ? '#22D3EE' : DIM,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {k.toUpperCase()} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            );
          })}
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: DIM, border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📒</div>
            <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>No decisions logged yet</p>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>
              Open Multibagger India or USA, expand any row, and click BUY / WATCH / NEUTRAL / REJECTED to start your logbook —
              or use the <strong style={{ color: '#10B981' }}>+ NEW DECISION</strong> button above to add one manually.
            </p>
            <button onClick={() => setShowAdd(true)} style={{
              marginTop: 14, padding: '8px 18px', borderRadius: 6,
              background: '#10B98115', border: '1px solid #10B98160', color: '#10B981',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>+ Add Your First Decision</button>
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0A1422', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={th}>STATUS</th>
                  <th style={th}>SYMBOL</th>
                  <th style={th}>MKT</th>
                  <th style={th}>COMPANY</th>
                  <th style={{ ...th, textAlign: 'right' }}>SCORE</th>
                  <th style={{ ...th, textAlign: 'right' }} title="Score now (from latest CSV upload). Δ vs decision-time score below.">NOW</th>
                  <th style={{ ...th, textAlign: 'right' }}>GRADE</th>
                  <th style={th}>DATE</th>
                  <th style={th}>REASON</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const meta = DECISION_META[d.status];
                  return (
                    <tr key={d.symbol} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          background: `${meta.color}20`, color: meta.color,
                          border: `1px solid ${meta.color}40`,
                          fontSize: 11, fontWeight: 800,
                        }}>{meta.emoji} {meta.label}</span>
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: '#22D3EE' }}>{d.symbol}</td>
                      <td style={td}>{d.market === 'IN' ? '🇮🇳' : '🇺🇸'}</td>
                      <td style={{ ...td, color: TEXT, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.company || '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {d.scoreAtDecision != null ? d.scoreAtDecision.toFixed(0) : '—'}
                      </td>
                      {/* AUDIT_100 #59 — outcome tracking (score now). */}
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {(() => {
                          const now = currentScoreMap.get(d.symbol.toUpperCase() + '|' + d.market);
                          if (!now || now.score == null) return <span style={{ color: DIM }}>—</span>;
                          const delta = (d.scoreAtDecision != null) ? Math.round(now.score) - Math.round(d.scoreAtDecision) : null;
                          const deltaColor = delta == null ? DIM : delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : DIM;
                          return (
                            <span title={`Latest re-score from CSV upload. Decision-time score was ${d.scoreAtDecision ?? 'n/a'}.`}>
                              <span style={{ color: TEXT }}>{Math.round(now.score)}</span>
                              {delta != null && <span style={{ color: deltaColor, marginLeft: 4, fontSize: 11 }}>{delta > 0 ? '▲+' : delta < 0 ? '▼' : '='}{Math.abs(delta) || ''}</span>}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{d.gradeAtDecision || '—'}</td>
                      <td style={{ ...td, color: DIM, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {d.date ? new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                      <td style={{ ...td, color: DIM, fontStyle: 'italic', fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.reason || '—'}
                      </td>
                      <td style={td}>
                        <button
                          onClick={() => {
                            // AUDIT_100 #5 — toast confirm in place of native window.confirm (iframe-safe + consistent app-wide).
                            toast((t) => (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span>Remove decision for <strong>{d.symbol}</strong>?</span>
                                <button onClick={() => { clearDecision(d.symbol); toast.dismiss(t.id); toast.success(`${d.symbol} removed`); }}
                                  style={{ padding: '4px 10px', background: '#EF4444', color: '#fff', borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 12 }}>Delete</button>
                                <button onClick={() => toast.dismiss(t.id)}
                                  style={{ padding: '4px 10px', background: 'transparent', color: '#94A3B8', borderRadius: 4, border: '1px solid #2A3B4C', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                              </div>
                            ), { duration: 8000 });
                          }}
                          title="Remove this decision"
                          style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 4 }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 11, color: DIM, textAlign: 'right' }}>
            Logbook persists in your browser. Decisions survive Multibagger re-uploads, clear operations, and tab switches.
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  color: '#8BA3C1', letterSpacing: '0.5px',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
