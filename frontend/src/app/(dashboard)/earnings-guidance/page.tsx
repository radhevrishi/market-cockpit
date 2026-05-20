'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Activity, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
// PATCH 0273 — Conviction Beats overlay on Earnings Guidance.
import { getConvictionTickers } from '@/lib/conviction-beats';
// PATCH 0545 — AUDIT #95 debounced LS writes for the guidance history snapshot.
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';

// PATCH 0294 — Q-over-Q score delta + sparkline (audit IMP-04).
// We snapshot every (symbol, period) guidance score into localStorage on
// every render. The first render where we see a NEW (symbol, period)
// captures it; subsequent quarters look back at the most-recent earlier
// snapshot to compute Δ. Stored as Record<symbol, {[yyyy_mm]: score}>.
const GUIDANCE_HISTORY_KEY = 'mc:guidance-scores:v1';
interface GuidanceHistoryShape {
  [symbol: string]: { [periodKey: string]: number };
}
function readGuidanceHistory(): GuidanceHistoryShape {
  if (typeof window === 'undefined') return {};
  try {
    // PATCH 0545 — race-aware read so a successive readback in the 250ms
    // idle window after debouncedSetItem sees the latest snapshot.
    const raw = getItemSync(GUIDANCE_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as GuidanceHistoryShape) : {};
  } catch { return {}; }
}
function writeGuidanceHistory(h: GuidanceHistoryShape) {
  if (typeof window === 'undefined') return;
  // AUDIT_100 #9 — bound the store. Without pruning, every (symbol, period)
  // captured forever would blow past 5 MB localStorage cap for a heavy user.
  // Strategy: keep at most 16 most-recent periods per symbol (~4 years of
  // quarterly), then cap to 500 symbols by recency (most-recent period).
  try {
    const PERIODS_PER_SYMBOL = 16;
    const SYMBOLS_CAP = 500;
    const pruned: GuidanceHistoryShape = {};
    const symKeys = Object.keys(h || {});
    // Compute most-recent period per symbol for sorting.
    const symWithMaxPeriod = symKeys.map(s => {
      const pk = Object.keys(h[s] || {});
      const maxP = pk.length ? pk.sort().slice(-1)[0] : '';
      return { s, maxP };
    }).sort((a, b) => b.maxP.localeCompare(a.maxP)).slice(0, SYMBOLS_CAP);
    for (const { s } of symWithMaxPeriod) {
      const periods = Object.keys(h[s] || {}).sort().slice(-PERIODS_PER_SYMBOL);
      const next: Record<string, number> = {};
      for (const p of periods) next[p] = h[s][p];
      pruned[s] = next;
    }
    // PATCH 0545 — debounced write coalesces N rapid period snapshots from
    // the render loop into a single LS write per 250ms idle window. Was
    // doing 1 stringify + setItem per render (heavy on a 500-symbol load).
    debouncedSetItem(GUIDANCE_HISTORY_KEY, JSON.stringify(pruned));
  } catch {}
}
function periodKey(iso: string, quarter?: string): string {
  // AUDIT_100 #79 — when quarter is known, include it in the key so a
  // company reporting Q4 in April vs Q1 in April don't collide on YYYY-MM
  // and silently overwrite each other. Outer storage is already keyed by
  // ticker, so the period scope here just needs to be unique per quarter.
  // 'YYYY-MM' grouping so any filing in the same calendar month is one quarter.
  try {
    const ym = new Date(iso).toISOString().slice(0, 7);
    return quarter ? `${ym}|${quarter}` : ym;
  } catch { return ''; }
}

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
  const [computing, setComputing] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [pollStopped, setPollStopped] = useState(false); // user manually stopped OR max reached
  const MAX_POLLS = 15; // 15 × 20s = 5 min max
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [showOpLeverage, setShowOpLeverage] = useState(false);
  const [showCapexHeavy, setShowCapexHeavy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'timeline'>('cards');

  const symbolsRef = useRef<string[]>([]);

  // PATCH 0273 — Conviction Beats overlay. Loads the institutional bench
  // and live-syncs across tabs via the storage + custom event.
  const [convictionSet, setConvictionSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase())); }
    catch { return new Set(); }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionSet(new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase()))); }
      catch {}
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);
  const isCb = useCallback((sym: string) => convictionSet.has((sym || '').toUpperCase().replace(/\.NS$|\.BO$/i, '')), [convictionSet]);

  const fetchData = useCallback(async (isPolling = false) => {
    if (!isPolling) { setLoading(true); setError(''); }
    try {
      // Fetch portfolio + watchlist symbols (cache them for polling)
      let symbols = symbolsRef.current;
      if (!isPolling || symbols.length === 0) {
        const newSymbols: string[] = [];
        try {
          const [pRes, wRes] = await Promise.all([
            fetch(`/api/portfolio?chatId=${CHAT_ID}`),
            fetch(`/api/watchlist?chatId=${CHAT_ID}`),
          ]);
          if (pRes.ok) {
            const pd = await pRes.json();
            newSymbols.push(...(pd.holdings || []).map((h: any) => h.symbol));
          }
          if (wRes.ok) {
            const wd = await wRes.json();
            newSymbols.push(...(wd.watchlist || []));
          }
        } catch {}
        symbols = [...new Set(newSymbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0))];
        symbolsRef.current = symbols;
      }

      if (symbols.length === 0) {
        setData({ events: [], summary: { total: 0, positive: 0, negative: 0, neutral: 0, operatingLeverage: 0, capexHeavy: 0 }, source: 'none', updatedAt: new Date().toISOString() });
        setLoading(false);
        setComputing(false);
        return;
      }

      // PATCH 0468 — 25s timeout
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      let res: Response;
      try {
        res = await fetch(`/api/market/earnings-guidance?symbols=${symbols.join(',')}&days=45`, { signal: ctl.signal });
      } finally { clearTimeout(timer); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const isComputing = !!(json as any)._meta?.computing || json.source === 'computing';
      setComputing(isComputing);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guidance data');
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-poll every 20s when computing, up to MAX_POLLS attempts (~5 min)
  useEffect(() => {
    if (!computing || pollStopped) { if (!computing) { setPollCount(0); setPollStopped(false); } return; }
    if (pollCount >= MAX_POLLS) {
      setComputing(false);
      setPollStopped(true);
      return;
    }
    const timer = setTimeout(async () => {
      setPollCount(p => p + 1);
      await fetchData(true);
    }, 20000);
    return () => clearTimeout(timer);
  }, [computing, pollCount, pollStopped, fetchData]);

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
          <button onClick={() => fetchData()} disabled={loading} style={{
            backgroundColor: ACCENT, border: 'none', color: '#000',
            padding: '8px 16px', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: 600, opacity: loading ? 0.5 : 1,
          }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: TEXT_DIM }}>
          Last 45 days · Portfolio + Watchlist · Source: {data?.source || '...'}
          {computing && (
            <span style={{ marginLeft: '12px', color: ACCENT, fontSize: '12px' }}>
              ⟳ Computing data... auto-refreshing
            </span>
          )}
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
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>{computing ? '⟳' : '📊'}</div>
          <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500, color: computing ? ACCENT : TEXT_DIM }}>
            {data?.events?.length
              ? 'No events match your filters'
              : computing
              ? 'Fetching earnings data from screener.in...'
              : 'No guidance events found'}
          </p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            {data?.events?.length
              ? 'Try adjusting filters'
              : pollStopped && !computing
              ? `Stopped after ${MAX_POLLS} attempts. Backend may still be computing — try refreshing manually.`
              : computing
              ? `Polling backend pipeline — attempt ${pollCount + 1}/${MAX_POLLS} (${pollCount * 20}s elapsed). Stop polling if backend is offline.`
              : 'Data refreshes automatically via background pipeline. Check back shortly.'}
          </p>
          {computing && !pollStopped && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ width: '200px', height: '4px', backgroundColor: '#1A2540', borderRadius: '2px', margin: '0 auto 14px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', backgroundColor: ACCENT, borderRadius: '2px',
                  animation: 'progress-bar 2s linear infinite',
                  width: `${Math.round((pollCount / MAX_POLLS) * 100)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
              {/* Manual stop — user can bail out of infinite loop */}
              <button
                onClick={() => { setPollStopped(true); setComputing(false); }}
                style={{
                  padding: '6px 16px', borderRadius: '6px', border: `1px solid #4A5B6C`,
                  background: 'transparent', color: '#8899AA', cursor: 'pointer', fontSize: '12px',
                }}
              >
                Stop auto-refresh
              </button>
            </div>
          )}
        </div>
      )}

      {/* Cards View */}
      {!loading && viewMode === 'cards' && filteredEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredEvents.map(event => (
            <GuidanceCard key={event.id} event={event} expanded={expandedId === event.id}
              onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
              isConviction={isCb(event.symbol)} />
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
                    onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)} compact
                    isConviction={isCb(event.symbol)} />
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

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes progress-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
      `}</style>
    </div>
  );
}

// ── Guidance Card Component ──
function GuidanceCard({ event, expanded, onToggle, compact, isConviction }: { event: GuidanceEvent; expanded: boolean; onToggle: () => void; compact?: boolean; isConviction?: boolean }) {
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
          {/* PATCH 0273 — Conviction Beats overlay badge. Amber 🏆 means the
              ticker is on the institutional Conviction Beats bench so users
              know guidance is landing on a high-conviction name. */}
          {isConviction && (
            <span
              title="On Conviction Beats bench (BLOCKBUSTER/STRONG earnings)"
              style={{
                fontSize: 10, fontWeight: 800, color: '#F59E0B',
                border: '1px solid #F59E0B60', backgroundColor: 'rgba(245,158,11,0.10)',
                padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
              }}
            >🏆 CB</span>
          )}
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
          {/* PATCH 0294 — Q-over-Q delta. Compares current score against the
              most-recent previously-seen score for this symbol in a different
              calendar-month bucket. Only renders when we actually have a prior. */}
          {(() => {
            const hist = readGuidanceHistory();
            const symHist = hist[event.symbol] || {};
            const curKey = periodKey(event.eventDate);
            // Find the most recent period key that's NOT the current period.
            const priorKeys = Object.keys(symHist).filter(k => k && k < curKey).sort();
            const priorKey = priorKeys.length > 0 ? priorKeys[priorKeys.length - 1] : null;
            const priorScore = priorKey ? symHist[priorKey] : null;
            // PATCH 0460 — write-through DEFERRED off the render path.
            // Previously this localStorage write fired during render, which
            // (a) is a React anti-pattern (causes commit-time storage events
            // to re-trigger renders), and (b) blocked paint for long lists.
            // queueMicrotask schedules it after render commits without
            // requiring a useEffect refactor inside this IIFE.
            if (curKey && symHist[curKey] !== event.sentimentScore) {
              const snapshot = event.sentimentScore;
              const sym = event.symbol;
              queueMicrotask(() => {
                try {
                  const cur = readGuidanceHistory();
                  const curSym = cur[sym] || {};
                  if (curSym[curKey] !== snapshot) {
                    writeGuidanceHistory({ ...cur, [sym]: { ...curSym, [curKey]: snapshot } });
                  }
                } catch {}
              });
            }
            if (priorScore == null) return null;
            const delta = event.sentimentScore - priorScore;
            if (delta === 0) return null;
            const tone = delta > 0 ? GREEN : RED;
            return (
              <span
                // AUDIT_100 #48 — tooltip now shows explicit prior→current
                // transition so user knows whether Δ+12 was 78→90 or 45→57.
                title={`${priorKey}: ${priorScore} → ${curKey}: ${event.sentimentScore}  (Δ ${delta > 0 ? '+' : ''}${delta})`}
                style={{
                  fontSize: 10, fontWeight: 700, color: tone,
                  border: `1px solid ${tone}60`, backgroundColor: `${tone}14`,
                  padding: '1px 6px', borderRadius: 3, letterSpacing: 0.3,
                  cursor: 'help',
                }}
              >Δ {delta > 0 ? '+' : ''}{delta}</span>
            );
          })()}
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
