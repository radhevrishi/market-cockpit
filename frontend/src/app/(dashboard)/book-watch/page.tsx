'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BOOK WATCH FEED (TheWrap / alerting surface)
//
// Makes the Book Watch alerting system visible in-app. The cron + client
// arm alerts on the names the user holds / benches / watchlists and push them
// to Telegram; this page reads the same persisted feed back so the alerts are
// browsable without leaving the dashboard.
//
// Data source: GET /api/v1/book/state?feed=1
//   { ok, chatId, book: { updatedAt, tickers[] } | null, tickers, updatedAt,
//     feed: BookFlag[] }  (feed is newest-first)
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import PanelFreshness from '@/components/PanelFreshness';

// ── Local mirror of the server shapes (types only — no server import) ────────

type BookFlagKind =
  | 'EARNINGS_TIER_DOWNGRADE'
  | 'EARNINGS_PRINT'
  | 'BENCH_DRIFT'
  | 'HOLDING_DRAWDOWN'
  | 'THESIS_DRIFT_REOPEN'
  | 'THESIS_BREAK'
  | 'STAGE4_BREAKDOWN'
  | 'STRUCTURAL_RISK';

type BookFlagSeverity = 'critical' | 'warning' | 'info';

interface BookFlag {
  kind: BookFlagKind;
  ticker: string;
  company?: string;
  severity: BookFlagSeverity;
  message: string;
  detail?: string;
  source: 'client' | 'server';
  armedAt: string;
}

interface BookTicker {
  ticker: string;
  company?: string;
  held?: boolean;
  benched?: boolean;
  watchlisted?: boolean;
  decisionStatus?: string;
  lastTier?: string;
}

interface BookState {
  updatedAt?: string;
  tickers?: BookTicker[];
}

interface BookStateResponse {
  ok?: boolean;
  chatId?: string;
  book?: BookState | null;
  tickers?: number;
  updatedAt?: string | null;
  feed?: BookFlag[];
}

// ── Per-kind label + emoji map (the 8 Book Watch alert kinds) ────────────────

const KIND_META: Record<BookFlagKind, { emoji: string; label: string }> = {
  EARNINGS_TIER_DOWNGRADE: { emoji: '⬇️', label: 'Tier Downgrade' },
  EARNINGS_PRINT: { emoji: '📊', label: 'Weak Print' },
  BENCH_DRIFT: { emoji: '🪑', label: 'Bench Drift' },
  HOLDING_DRAWDOWN: { emoji: '📉', label: 'Holding Drawdown' },
  THESIS_DRIFT_REOPEN: { emoji: '🔓', label: 'Thesis Re-open' },
  THESIS_BREAK: { emoji: '💔', label: 'Thesis Break' },
  STAGE4_BREAKDOWN: { emoji: '🩸', label: 'Stage-4 Breakdown' },
  STRUCTURAL_RISK: { emoji: '⚠️', label: 'Structural Risk' },
};

const KIND_ORDER: BookFlagKind[] = [
  'EARNINGS_TIER_DOWNGRADE',
  'EARNINGS_PRINT',
  'BENCH_DRIFT',
  'HOLDING_DRAWDOWN',
  'THESIS_DRIFT_REOPEN',
  'THESIS_BREAK',
  'STAGE4_BREAKDOWN',
  'STRUCTURAL_RISK',
];

const SEVERITY_META: Record<BookFlagSeverity, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#EF4444' },
  warning: { label: 'Warning', color: '#F59E0B' },
  info: { label: 'Info', color: '#94A3B8' },
};

// ── Relative time (deterministic ladder) ─────────────────────────────────────

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const age = Math.max(0, Date.now() - t);
  if (age < 60_000) return 'now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  if (age < 7 * 86_400_000) return `${Math.floor(age / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export default function BookWatchPage() {
  const [data, setData] = useState<BookStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);

  const [sevFilter, setSevFilter] = useState<BookFlagSeverity | 'ALL'>('ALL');
  const [kindFilter, setKindFilter] = useState<BookFlagKind | 'ALL'>('ALL');

  async function load() {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch('/api/v1/book/state?feed=1', {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: BookStateResponse = await res.json();
      setData(json);
      setFetchedAt(Date.now());
    } catch (e: any) {
      setError(
        e?.name === 'AbortError'
          ? 'Timed out — the Book Watch feed is slow. Retry.'
          : e?.message || 'Failed to load the Book Watch feed.',
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const book = data?.book || null;
  const feed = useMemo<BookFlag[]>(() => (Array.isArray(data?.feed) ? data!.feed! : []), [data]);

  // Book summary counts
  const bookCounts = useMemo(() => {
    const rows = Array.isArray(book?.tickers) ? book!.tickers! : [];
    let held = 0;
    let benched = 0;
    let watchlisted = 0;
    for (const t of rows) {
      if (t.held) held += 1;
      if (t.benched) benched += 1;
      if (t.watchlisted) watchlisted += 1;
    }
    return { held, benched, watchlisted, total: rows.length };
  }, [book]);

  // Kinds actually present in the feed (for the filter row)
  const presentKinds = useMemo(() => {
    const set = new Set<BookFlagKind>();
    for (const f of feed) if (KIND_META[f.kind]) set.add(f.kind);
    return KIND_ORDER.filter((k) => set.has(k));
  }, [feed]);

  const filtered = useMemo(() => {
    return feed.filter((f) => {
      if (sevFilter !== 'ALL' && f.severity !== sevFilter) return false;
      if (kindFilter !== 'ALL' && f.kind !== kindFilter) return false;
      return true;
    });
  }, [feed, sevFilter, kindFilter]);

  const updatedAtMs = (() => {
    const iso = data?.updatedAt || book?.updatedAt;
    const t = iso ? new Date(iso).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  })();

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1080, margin: '0 auto', color: '#E2E8F0' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🔔</span> Book Watch
          </h1>
          <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 6, lineHeight: 1.5 }}>
            Watches the names you hold, bench and watchlist and pushes alerts (also delivered to your
            Telegram) on earnings-tier downgrades, weak prints, bench drift, holding drawdowns, thesis
            drift, Stage-4 breakdowns and structural risk.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {updatedAtMs > 0 && (
            <PanelFreshness dataUpdatedAt={updatedAtMs} isFetching={loading} staleAfterMs={30 * 60_000} />
          )}
          <button onClick={load} disabled={loading} style={btnStyle}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Book summary strip */}
      <div style={{ marginTop: 18 }}>
        {book ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SummaryStat label="Held" value={bookCounts.held} color="#10B981" />
            <SummaryStat label="Benched" value={bookCounts.benched} color="#F59E0B" />
            <SummaryStat label="Watchlisted" value={bookCounts.watchlisted} color="#22D3EE" />
            <SummaryStat label="Total tracked" value={bookCounts.total} color="#94A3B8" />
          </div>
        ) : (
          <div style={{ ...noteStyle }}>
            <span style={{ fontSize: 16 }}>📭</span>
            <span>
              No book synced yet — open{' '}
              <span style={{ color: '#CBD5E1', fontWeight: 600 }}>Portfolio</span> or{' '}
              <span style={{ color: '#CBD5E1', fontWeight: 600 }}>Watchlists</span> to sync your holdings
              + bench. The dashboard auto-syncs on navigation, so this resolves once you browse.
            </span>
          </div>
        )}
      </div>

      {/* Filters */}
      {!loading && !error && feed.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Severity:</span>
          <FilterChip label="All" active={sevFilter === 'ALL'} onClick={() => setSevFilter('ALL')} />
          {(['critical', 'warning', 'info'] as BookFlagSeverity[]).map((s) => (
            <FilterChip
              key={s}
              label={SEVERITY_META[s].label}
              active={sevFilter === s}
              accent={SEVERITY_META[s].color}
              onClick={() => setSevFilter(s)}
            />
          ))}
          {presentKinds.length > 0 && (
            <>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, marginLeft: 8 }}>Kind:</span>
              <FilterChip label="All" active={kindFilter === 'ALL'} onClick={() => setKindFilter('ALL')} />
              {presentKinds.map((k) => (
                <FilterChip
                  key={k}
                  label={`${KIND_META[k].emoji} ${KIND_META[k].label}`}
                  active={kindFilter === k}
                  onClick={() => setKindFilter(k)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ marginTop: 16 }}>
        {loading ? (
          <SkeletonList />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : feed.length === 0 ? (
          <EmptyFeed />
        ) : filtered.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1' }}>
              No alerts match the current filters
            </div>
            <button
              onClick={() => {
                setSevFilter('ALL');
                setKindFilter('ALL');
              }}
              style={{ ...btnStyle, marginTop: 12 }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((f, i) => (
              <AlertCard key={`${f.kind}-${f.ticker}-${f.armedAt}-${i}`} flag={f} />
            ))}
          </div>
        )}
      </div>

      {!loading && !error && feed.length > 0 && (
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 12 }}>
          Showing {filtered.length} of {feed.length} fired alert{feed.length === 1 ? '' : 's'} · newest
          first · also pushed to Telegram.
        </div>
      )}
    </div>
  );
}

// ── Sub-components (local to this page file) ─────────────────────────────────

function AlertCard({ flag }: { flag: BookFlag }) {
  const sev = SEVERITY_META[flag.severity] || SEVERITY_META.info;
  const kind = KIND_META[flag.kind] || { emoji: '•', label: flag.kind };
  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${sev.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          title={sev.label}
          style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: sev.color, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 4,
            color: sev.color,
            border: `1px solid ${sev.color}55`,
            backgroundColor: `${sev.color}14`,
          }}
        >
          {kind.emoji} {kind.label}
        </span>
        <span style={{ fontWeight: 800, fontSize: 13, color: '#F1F5F9', fontVariantNumeric: 'tabular-nums' }}>
          {flag.ticker || '—'}
        </span>
        {flag.company && <span style={{ fontSize: 12, color: '#94A3B8' }}>{flag.company}</span>}
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            color: '#64748B',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: flag.source === 'server' ? '#A78BFA' : '#22D3EE',
              border: '1px solid #1E2D45',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {flag.source}
          </span>
          <span title={flag.armedAt}>{relativeTime(flag.armedAt)}</span>
        </span>
      </div>

      <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 8, lineHeight: 1.45 }}>{flag.message}</div>
      {flag.detail && (
        <div style={{ fontSize: 11, color: '#8B9DB0', marginTop: 6, lineHeight: 1.4 }}>{flag.detail}</div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        background: '#0B1526',
        border: '1px solid #16233A',
        borderRadius: 8,
        padding: '8px 14px',
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function FilterChip({
  label,
  active,
  accent,
  onClick,
}: {
  label: string;
  active: boolean;
  accent?: string;
  onClick: () => void;
}) {
  const tone = accent || '#A78BFA';
  return (
    <button
      onClick={onClick}
      style={{
        ...chipBase,
        color: active ? '#0B1120' : '#94A3B8',
        backgroundColor: active ? tone : 'transparent',
        borderColor: active ? tone : '#1E2D45',
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ ...cardStyle, opacity: 0.5 }}>
          <div style={{ height: 12, width: '35%', background: '#1E2D45', borderRadius: 4 }} />
          <div style={{ height: 12, width: '75%', background: '#16233A', borderRadius: 4, marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyFeed() {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔕</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1' }}>No alerts fired yet</div>
      <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, maxWidth: 460, lineHeight: 1.5 }}>
        Book Watch evaluates on a schedule (and after you sync your book); this fills in as conditions
        trigger. Nothing has fired yet — this is honest emptiness, not an error.
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ ...emptyStyle, borderColor: 'rgba(239,68,68,0.3)' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#FCA5A5' }}>Couldn’t load the Book Watch feed</div>
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{message}</div>
      <button onClick={onRetry} style={{ ...btnStyle, marginTop: 12 }}>
        ↻ Retry
      </button>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#94A3B8',
  background: '#0F1A2E',
  border: '1px solid #1E2D45',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
};

const chipBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: '#94A3B8',
  background: 'transparent',
  border: '1px solid #1E2D45',
  borderRadius: 999,
  padding: '4px 10px',
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  background: '#0B1526',
  border: '1px solid #16233A',
  borderRadius: 8,
  padding: '12px 14px',
};

const emptyStyle: React.CSSProperties = {
  border: '1px dashed #1E2D45',
  borderRadius: 10,
  padding: '40px 20px',
  textAlign: 'center',
  background: '#0B1526',
};

const noteStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  border: '1px dashed #1E2D45',
  borderRadius: 10,
  padding: '14px 16px',
  background: '#0B1526',
  fontSize: 12.5,
  color: '#94A3B8',
  lineHeight: 1.5,
};
