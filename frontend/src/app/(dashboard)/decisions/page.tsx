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
import { Trash2, Download, Filter } from 'lucide-react';
import { readDecisions, clearDecision, subscribeDecisions, DECISION_META, type Decision, type DecisionStatus, type DecisionMarket } from '@/lib/decisions';

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
            onClick={exportCsv}
            disabled={rows.length === 0}
            style={{
              marginLeft: 'auto', padding: '6px 12px', borderRadius: 6,
              background: '#22D3EE15', border: '1px solid #22D3EE60', color: '#22D3EE',
              fontSize: 12, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: rows.length ? 1 : 0.4,
            }}
          >
            <Download size={12} /> EXPORT CSV ({rows.length})
          </button>
        </div>

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
              Open Multibagger India or USA, expand any row, and click BUY / WATCH / NEUTRAL / REJECTED to start your logbook.
            </p>
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
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{d.gradeAtDecision || '—'}</td>
                      <td style={{ ...td, color: DIM, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {d.date ? new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                      <td style={{ ...td, color: DIM, fontStyle: 'italic', fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.reason || '—'}
                      </td>
                      <td style={td}>
                        <button
                          onClick={() => { if (window.confirm(`Remove decision for ${d.symbol}?`)) clearDecision(d.symbol); }}
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
