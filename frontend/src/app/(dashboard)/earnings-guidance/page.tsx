'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Filter, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

// ══════════════════════════════════════════════
// EARNINGS GUIDANCE TAB — Historical + Real-time Guidance Intelligence
// Tracks last 45 days earnings + guidance for Portfolio/Watchlist
// Shows: Revenue outlook, Margin, Capex signals, Operating Leverage
// ══════════════════════════════════════════════

const BG = '#0A0E1A';
const CARD = '#0D1623';
const CARD_BORDER = '#1A2540';
const ACCENT = '#0F7ABF';
const TEXT = '#E8ECF1';
const TEXT_DIM = '#8899AA';
const GREEN = '#00C853';
const YELLOW = '#FFD600';
const RED = '#F44336';
const PURPLE = '#7C3AED';

const CHAT_ID = '5057319640';

interface GuidanceEvent {
  id: string;
  symbol: string;
  companyName: string;
  eventDate: string;
  source: string;
  eventType: string;
  revenueGrowth: number | null;
  profitGrowth: number | null;
  marginChange: number | null;
  guidanceRevenue: string | null;
  guidanceMargin: string | null;
  guidanceCapex: number | null;
  guidanceDemand: string | null;
  operatingLeverage: boolean;
  deleveraging: boolean;
  orderBookGrowth: boolean;
  rawText: string;
  sentimentScore: number;
  confidenceScore: number;
  dedupKey: string;
  createdAt: string;
  grade: string;
  gradeColor: string;
}

interface GuidanceResponse {
  events: GuidanceEvent[];
  summary: {
    total: number;
    positive: number;
    negative: number;
    neutral: number;
    operatingLeverage: number;
    capexHeavy: number;
  };
  source: string;
  updatedAt: string;
}

type FilterMode = 'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

const GRADE_COLORS: Record<string, string> = {
  STRONG: PURPLE,
  POSITIVE: GREEN,
  NEUTRAL: YELLOW,
  NEGATIVE: '#FF6B00',
  WEAK: RED,
};

export default function EarningsGuidancePage() {
  const [data, setData] = useState<GuidanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [showOpLeverage, setShowOpLeverage] = useState(false);
  const [showCapexHeavy, setShowCapexHeavy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'timeline'>('cards');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch portfolio + watchlist symbols
      let symbols: string[] = [];
      try {
        const [pRes, wRes] = await Promise.all([
          fetch(`/api/portfolio?chatId=${CHAT_ID}`),
          fetch(`/api/watchlist?chatId=${CHAT_ID}`),
        ]);
        if (pRes.ok) {
          const pd = await pRes.json();
          symbols.push(...(pd.holdings || []).map((h: any) => h.symbol));
        }
        if (wRes.ok) {
          const wd = await wRes.json();
          symbols.push(...(wd.watchlist || []));
        }
      } catch {}

      symbols = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0))];

      if (symbols.length === 0) {
        setData({ events: [], summary: { total: 0, positive: 0, negative: 0, neutral: 0, operatingLeverage: 0, capexHeavy: 0 }, source: 'none', updatedAt: new Date().toISOString() });
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/market/earnings-guidance?symbols=${symbols.join(',')}&days=45`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: GuidanceResponse = await res.json();

      // Auto-ingest if no events found (first visit or stale store)
      if (json.events.length === 0 && !ingesting) {
        setIngesting(true);
        try {
          const ingestRes = await fetch('/api/market/earnings-guidance/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols, chatId: CHAT_ID }),
          });
          if (ingestRes.ok) {
            // Re-fetch after ingestion
            const res2 = await fetch(`/api/market/earnings-guidance?symbols=${symbols.join(',')}&days=45`);
            if (res2.ok) {
              const json2: GuidanceResponse = await res2.json();
              setData(json2);
              setIngesting(false);
              setLoading(false);
              return;
            }
          }
        } catch {} finally { setIngesting(false); }
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guidance data');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleIngest = useCallback(async () => {
    setIngesting(true);
    try {
      const res = await fetch('/api/market/earnings-guidance/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: CHAT_ID }) });
      if (res.ok) {
        // After ingestion, refresh data
        await fetchData();
      }
    } catch {} finally { setIngesting(false); }
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    let events = data.events;
    if (filterMode === 'POSITIVE') events = events.filter(e => e.sentimentScore > 50);
    else if (filterMode === 'NEGATIVE') events = events.filter(e => e.sentimentScore < 40);
    else if (filterMode === 'NEUTRAL') events = events.filter(e => e.sentimentScore >= 40 && e.sentimentScore <= 50);
    if (showOpLeverage) events = events.filter(e => e.operatingLeverage);
    if (showCapexHeavy) events = events.filter(e => e.guidanceCapex !== null && e.guidanceCapex > 0);
    return events;
  }, [data, filterMode, showOpLeverage, showCapexHeavy]);

  // Group by date for timeline view
  const timelineGroups = useMemo(() => {
    const groups = new Map<string, GuidanceEvent[]>();
    for (const e of filteredEvents) {
      const date = e.eventDate.slice(0, 10);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(e);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredEvents]);

  const summary = data?.summary || { total: 0, positive: 0, negative: 0, neutral: 0, operatingLeverage: 0, capexHeavy: 0 };

  return (
    <div style={{ padding: '24px', minHeight: '100vh', backgroundColor: BG, color: TEXT }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Earnings Guidance Intelligence</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleIngest} disabled={ingesting} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: '#1A2540', border: `1px solid ${CARD_BORDER}`, color: TEXT,
              padding: '8px 14px', borderRadius: '6px', cursor: ingesting ? 'not-allowed' : 'pointer',
              fontSize: '12px', fontWeight: 600, opacity: ingesting ? 0.5 : 1,
            }}>
              <RefreshCw style={{ width: '14px', height: '14px', animation: ingesting ? 'spin 1s linear infinite' : 'none' }} />
              {ingesting ? 'Ingesting...' : 'Ingest New'}
            </button>
            <button onClick={() => fetchData()} disabled={loading} style={{
              backgroundColor: ACCENT, border: 'none', color: '#000',
              padding: '8px 16px', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600, opacity: loading ? 0.5 : 1,
            }}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: TEXT_DIM }}>
          Last 45 days · Portfolio + Watchlist · Source: {data?.source || '...'}
        </p>
      </div>

      {/* Summary Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Events', value: summary.total, color: TEXT },
          { label: 'Positive', value: summary.positive, color: GREEN },
          { label: 'Negative', value: summary.negative, color: RED },
          { label: 'Neutral', value: summary.neutral, color: YELLOW },
          { label: 'Op. Leverage', value: summary.operatingLeverage, color: PURPLE },
          { label: 'Capex Heavy', value: summary.capexHeavy, color: ACCENT },
        ].map(item => (
          <div key={item.label} style={{
            backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px',
            padding: '16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: '11px', color: TEXT_DIM, marginTop: '4px' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter style={{ width: '16px', height: '16px', color: TEXT_DIM }} />
        {(['ALL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL'] as FilterMode[]).map(f => (
          <button key={f} onClick={() => setFilterMode(f)} style={{
            backgroundColor: filterMode === f ? ACCENT : CARD,
            border: `1px solid ${filterMode === f ? ACCENT : CARD_BORDER}`,
            color: filterMode === f ? '#000' : TEXT,
            padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
          }}>{f}</button>
        ))}
        <span style={{ width: '1px', height: '24px', backgroundColor: CARD_BORDER, margin: '0 4px' }} />
        <button onClick={() => setShowOpLeverage(p => !p)} style={{
          backgroundColor: showOpLeverage ? PURPLE : CARD,
          border: `1px solid ${showOpLeverage ? PURPLE : CARD_BORDER}`,
          color: showOpLeverage ? '#fff' : TEXT,
          padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
        }}>Op. Leverage</button>
        <button onClick={() => setShowCapexHeavy(p => !p)} style={{
          backgroundColor: showCapexHeavy ? ACCENT : CARD,
          border: `1px solid ${showCapexHeavy ? ACCENT : CARD_BORDER}`,
          color: showCapexHeavy ? '#000' : TEXT,
          padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
        }}>Capex Heavy</button>
        <span style={{ width: '1px', height: '24px', backgroundColor: CARD_BORDER, margin: '0 4px' }} />
        <button onClick={() => setViewMode(v => v === 'cards' ? 'timeline' : 'cards')} style={{
          backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, color: TEXT,
          padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
        }}>{viewMode === 'cards' ? 'Timeline View' : 'Card View'}</button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ backgroundColor: '#2D1B1B', border: `1px solid ${RED}`, borderRadius: '8px', padding: '16px', marginBottom: '20px', color: RED }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px', color: TEXT_DIM }}>
          <Activity style={{ width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p>Loading guidance intelligence...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filteredEvents.length === 0 && (
        <div style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px', padding: '60px 20px', textAlign: 'center', color: TEXT_DIM }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>
            {data?.events?.length ? 'No events match your filters' : 'No guidance events found'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {data?.events?.length ? 'Try adjusting filters' : 'Click "Ingest New" to fetch latest filings from NSE'}
          </p>
        </div>
      )}

      {/* Cards View */}
      {!loading && viewMode === 'cards' && filteredEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredEvents.map(event => (
            <GuidanceCard key={event.id} event={event} expanded={expandedId === event.id}
              onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)} />
          ))}
        </div>
      )}

      {/* Timeline View */}
      {!loading && viewMode === 'timeline' && timelineGroups.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: '32px' }}>
          {/* Vertical line */}
          <div style={{ position: 'absolute', left: '15px', top: 0, bottom: 0, width: '2px', backgroundColor: CARD_BORDER }} />
          {timelineGroups.map(([date, events]) => (
            <div key={date} style={{ marginBottom: '24px' }}>
              {/* Date dot */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: '-25px', top: '4px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  backgroundColor: ACCENT, border: `2px solid ${BG}`,
                }} />
                <div style={{ fontSize: '13px', fontWeight: 700, color: ACCENT, marginBottom: '8px' }}>
                  {new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {events.map(event => (
                  <GuidanceCard key={event.id} event={event} expanded={expandedId === event.id}
                    onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)} compact />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Count */}
      {!loading && filteredEvents.length > 0 && (
        <div style={{ textAlign: 'center', padding: '16px', color: TEXT_DIM, fontSize: '12px' }}>
          Showing {filteredEvents.length} of {data?.events?.length || 0} events · Updated: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-'}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Guidance Card Component ──
function GuidanceCard({ event, expanded, onToggle, compact }: { event: GuidanceEvent; expanded: boolean; onToggle: () => void; compact?: boolean }) {
  const gradeColor = GRADE_COLORS[event.grade] || TEXT_DIM;
  const isPositive = event.sentimentScore > 50;
  const isNegative = event.sentimentScore < 40;

  return (
    <div style={{
      backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: '8px',
      overflow: 'hidden', transition: 'border-color 0.2s',
      borderLeftWidth: '3px', borderLeftColor: gradeColor,
    }}>
      {/* Header */}
      <div onClick={onToggle} style={{
        padding: compact ? '12px 16px' : '16px 20px', cursor: 'pointer',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <span style={{
            backgroundColor: gradeColor + '22', color: gradeColor,
            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
          }}>{event.grade}</span>
          <span style={{ fontWeight: 700, fontSize: compact ? '13px' : '14px' }}>{event.symbol}</span>
          <span style={{ color: TEXT_DIM, fontSize: '12px' }}>{event.companyName}</span>
          <span style={{
            backgroundColor: '#1A2540', padding: '2px 8px', borderRadius: '4px',
            fontSize: '10px', color: TEXT_DIM, fontWeight: 600,
          }}>{event.eventType}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Signal badges */}
          {event.operatingLeverage && (
            <span style={{ backgroundColor: PURPLE + '22', color: PURPLE, padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>
              OP. LEVERAGE
            </span>
          )}
          {event.guidanceCapex !== null && event.guidanceCapex > 0 && (
            <span style={{ backgroundColor: ACCENT + '22', color: ACCENT, padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>
              CAPEX: {event.guidanceCapex} Cr
            </span>
          )}
          {/* Score */}
          <span style={{
            fontSize: '16px', fontWeight: 700,
            color: isPositive ? GREEN : isNegative ? RED : YELLOW,
          }}>{event.sentimentScore}</span>
          <span style={{ fontSize: '11px', color: TEXT_DIM }}>
            {new Date(event.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
          {expanded ? <ChevronUp style={{ width: '16px', height: '16px', color: TEXT_DIM }} /> : <ChevronDown style={{ width: '16px', height: '16px', color: TEXT_DIM }} />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 20px 16px', borderTop: `1px solid ${CARD_BORDER}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '12px' }}>
            {/* Revenue Growth */}
            <SignalBox label="Revenue Growth" value={event.revenueGrowth !== null ? `${event.revenueGrowth > 0 ? '+' : ''}${event.revenueGrowth}%` : '-'}
              positive={event.revenueGrowth !== null && event.revenueGrowth > 0} />
            {/* Profit Growth */}
            <SignalBox label="Profit Growth" value={event.profitGrowth !== null ? `${event.profitGrowth > 0 ? '+' : ''}${event.profitGrowth}%` : '-'}
              positive={event.profitGrowth !== null && event.profitGrowth > 0} />
            {/* Margin Change */}
            <SignalBox label="Margin Change" value={event.marginChange !== null ? `${event.marginChange > 0 ? '+' : ''}${event.marginChange} bps` : '-'}
              positive={event.marginChange !== null && event.marginChange > 0} />
            {/* Confidence */}
            <SignalBox label="Confidence" value={`${event.confidenceScore}%`} positive={event.confidenceScore >= 60} />
          </div>

          {/* Guidance details */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '12px' }}>
            {event.guidanceRevenue && (
              <div style={{ backgroundColor: '#0A1628', padding: '10px 14px', borderRadius: '6px' }}>
                <div style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600 }}>REVENUE GUIDANCE</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>{event.guidanceRevenue}</div>
              </div>
            )}
            {event.guidanceMargin && (
              <div style={{ backgroundColor: '#0A1628', padding: '10px 14px', borderRadius: '6px' }}>
                <div style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600 }}>MARGIN GUIDANCE</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>{event.guidanceMargin}</div>
              </div>
            )}
            {event.guidanceDemand && (
              <div style={{ backgroundColor: '#0A1628', padding: '10px 14px', borderRadius: '6px' }}>
                <div style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600 }}>DEMAND SIGNAL</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>{event.guidanceDemand}</div>
              </div>
            )}
          </div>

          {/* Advanced signals row */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            {event.operatingLeverage && <Badge label="Operating Leverage" color={PURPLE} />}
            {event.deleveraging && <Badge label="Deleveraging" color={GREEN} />}
            {event.orderBookGrowth && <Badge label="Order Book Growth" color={ACCENT} />}
          </div>

          {/* Raw text excerpt */}
          {event.rawText && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: TEXT_DIM, lineHeight: '1.5', maxHeight: '60px', overflow: 'hidden' }}>
              {event.rawText.slice(0, 300)}{event.rawText.length > 300 ? '...' : ''}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '11px', color: TEXT_DIM }}>
            <span>Source: {event.source}</span>
            <span>Dedup: {event.dedupKey}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SignalBox({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div style={{ backgroundColor: '#0A1628', padding: '10px 14px', borderRadius: '6px', textAlign: 'center' }}>
      <div style={{ fontSize: '10px', color: TEXT_DIM, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: value === '-' ? TEXT_DIM : positive ? GREEN : RED }}>{value}</div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      backgroundColor: color + '22', color, padding: '4px 10px', borderRadius: '4px',
      fontSize: '11px', fontWeight: 600,
    }}>{label}</span>
  );
}
