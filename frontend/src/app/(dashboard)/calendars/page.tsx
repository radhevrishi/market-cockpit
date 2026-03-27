'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCw, Star, TrendingUp, TrendingDown, Minus, BookMarked } from 'lucide-react';
import { format, addDays, subDays, startOfDay } from 'date-fns';
import api from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import type { CalendarEvent } from '@/types';

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Fetches all tickers from the user's portfolios + watchlists. */
function useUserTickers() {
  return useQuery<string[]>({
    queryKey: ['user', 'tickers'],
    queryFn: async () => {
      const tickers = new Set<string>();
      try {
        const { data: portfolios } = await api.get('/portfolios');
        for (const p of (portfolios ?? [])) {
          try {
            const { data: positions } = await api.get(`/portfolios/${p.id}/positions`);
            for (const pos of (positions ?? [])) {
              if (pos.ticker) tickers.add(pos.ticker);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      try {
        const { data: watchlists } = await api.get('/watchlists');
        for (const wl of (watchlists ?? [])) {
          for (const item of (wl.items ?? [])) {
            if (item.ticker) tickers.add(item.ticker);
          }
        }
      } catch { /* ignore */ }
      return Array.from(tickers);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

function useEarningsCalendar(from: string, to: string, tickers?: string[]) {
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar', 'earnings', from, to, tickers?.join(',') ?? 'all'],
    queryFn: async () => {
      const params: Record<string, any> = { from_date: from, to_date: to };
      if (tickers?.length) {
        params.tickers = tickers;
      }
      const { data } = await api.get('/calendar/earnings', {
        params,
        paramsSerializer: (params) => {
          const searchParams = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach(v => searchParams.append(key, v));
            } else if (value != null) {
              searchParams.append(key, String(value));
            }
          });
          return searchParams.toString();
        }
      });
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

function useEconomicCalendar(from: string, to: string) {
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar', 'economic', from, to],
    queryFn: async () => {
      const { data } = await api.get(`/calendar/economic?from_date=${from}&to_date=${to}`);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

function useRatingsCalendar(from: string, to: string, tickers?: string[]) {
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar', 'ratings', from, to, tickers?.join(',') ?? 'all'],
    queryFn: async () => {
      const params: Record<string, any> = { from_date: from, to_date: to };
      if (tickers?.length) {
        params.tickers = tickers;
      }
      const { data } = await api.get('/calendar/ratings', {
        params,
        paramsSerializer: (params) => {
          const searchParams = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach(v => searchParams.append(key, v));
            } else if (value != null) {
              searchParams.append(key, String(value));
            }
          });
          return searchParams.toString();
        }
      });
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

function useDividendsCalendar(from: string, to: string, tickers?: string[]) {
  return useQuery<CalendarEvent[]>({
    queryKey: ['calendar', 'dividends', from, to, tickers?.join(',') ?? 'all'],
    queryFn: async () => {
      const params: Record<string, any> = { from_date: from, to_date: to };
      if (tickers?.length) {
        params.tickers = tickers;
      }
      const { data } = await api.get('/calendar/dividends', {
        params,
        paramsSerializer: (params) => {
          const searchParams = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach(v => searchParams.append(key, v));
            } else if (value != null) {
              searchParams.append(key, String(value));
            }
          });
          return searchParams.toString();
        }
      });
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

type TabId = 'earnings' | 'economic' | 'ratings' | 'dividends';

/**
 * Deduplicate calendar events by creating a composite key.
 */
function deduplicateEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const deduplicated: CalendarEvent[] = [];

  for (const event of events) {
    const ev = event as any;
    const eType = ev.event_type ?? ev.eventType ?? '';
    const eDate = ev.event_date ?? ev.date ?? '';
    let key: string;

    if (eType === 'DIVIDEND') {
      key = `${eType}|${ev.ticker ?? ''}`;
    } else {
      key = `${eType}|${eDate}`;
      if (eType === 'EARNINGS') {
        key += `|${ev.ticker ?? ''}|${ev.fiscal_quarter ?? ''}`;
      } else if (eType === 'ECONOMIC') {
        key += `|${ev.indicator_name ?? ev.indicator ?? ''}`;
      } else if (eType === 'RATING_CHANGE') {
        key += `|${ev.ticker ?? ''}|${ev.analyst_firm ?? ev.analyst ?? ''}`;
      }
    }

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(event);
    }
  }

  return deduplicated;
}

const IMPACT_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-600/30 text-red-200 border-red-600/40',
  HIGH:     'bg-red-500/20 text-red-300 border-red-500/30',
  MEDIUM:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  LOW:      'bg-green-500/20 text-green-300 border-green-500/30',
};

const EXCHANGE_FLAG: Record<string, string> = {
  NSE: '🇮🇳', BSE: '🇮🇳', NYSE: '🇺🇸', NASDAQ: '🇺🇸', GLOBAL: '🌐',
};

function fmtDate(iso: string) {
  try { return format(new Date(iso), 'EEE, MMM d'); } catch { return iso; }
}

/** Check if a date string falls on a weekend */
function isWeekend(iso: string): boolean {
  try {
    const d = new Date(iso);
    const day = d.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  } catch { return false; }
}

/** Determine if actual is "good" or "bad" vs forecast for color coding */
function actualVsForecast(actual: string | number | null | undefined, forecast: string | number | null | undefined): 'good' | 'bad' | 'neutral' {
  if (actual == null || forecast == null) return 'neutral';
  // Try to extract numeric values
  const parseNum = (v: string | number): number | null => {
    if (typeof v === 'number') return v;
    const cleaned = v.replace(/[%KMBTkmbtr,]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };
  const a = parseNum(actual);
  const f = parseNum(forecast);
  if (a == null || f == null) return 'neutral';
  if (a > f) return 'good';
  if (a < f) return 'bad';
  return 'neutral';
}

function ErrorBar({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" /> {msg}
      <button onClick={onRetry} className="ml-auto text-xs hover:text-red-300 flex items-center gap-1">
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  );
}

// ─── Earnings Tab ─────────────────────────────────────────────────────────────

function SurpriseBadge({ estimate, actual }: { estimate?: number | null; actual?: number | null }) {
  if (estimate == null || actual == null) return null;
  const pct = ((actual - estimate) / Math.abs(estimate)) * 100;
  const beat = pct >= 0;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${beat ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'}`}>
      {beat ? 'BEAT' : 'MISS'} {beat ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function EarningsTab({ from, to, tickers }: { from: string; to: string; tickers?: string[] }) {
  const { data, isLoading, error, refetch } = useEarningsCalendar(from, to, tickers);
  const dedupedData = deduplicateEvents(data ?? []).filter(ev => !isWeekend(ev.event_date ?? ''));

  // Group by country: India (NSE/BSE) vs US (NYSE/NASDAQ) vs Other
  const indiaEvents = dedupedData.filter(ev => ['NSE', 'BSE'].includes(ev.exchange ?? ''));
  const usEvents = dedupedData.filter(ev => ['NYSE', 'NASDAQ'].includes(ev.exchange ?? ''));

  const groupByDate = (events: CalendarEvent[]) => {
    const grouped: Record<string, CalendarEvent[]> = {};
    events.forEach(ev => { const k = ev.event_date?.split('T')[0] ?? ''; if (!grouped[k]) grouped[k] = []; grouped[k].push(ev); });
    return Object.keys(grouped).sort().map(date => ({ date, events: grouped[date] }));
  };

  const renderGroup = (events: CalendarEvent[], label: string, flag: string) => {
    const grouped = groupByDate(events);
    if (!grouped.length) return null;
    return (
      <div key={label} className="space-y-3">
        <div className="flex items-center gap-2 mt-2">
          <span className="text-base">{flag}</span>
          <h3 className="text-sm font-semibold text-white/80">{label}</h3>
          <span className="text-xs text-[#4A5B6C]">({events.length} events)</span>
        </div>
        {grouped.map(({ date, events: evs }) => (
          <div key={date} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-[#0D1B2E]/60 border-b border-[#2A3B4C]">
              <p className="text-white text-sm font-semibold">{fmtDate(date)}</p>
            </div>
            <div className="divide-y divide-[#2A3B4C]">
              {evs.map(ev => (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#0D1B2E]/30 transition-colors">
                  <span className="text-lg">{EXCHANGE_FLAG[ev.exchange ?? ''] ?? '🌐'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-white text-sm font-bold">{ev.ticker}</span>
                      {ev.status === 'COMPLETED' && <SurpriseBadge estimate={(ev as any).eps_estimate} actual={(ev as any).eps_actual} />}
                    </div>
                    <p className="text-[#8899AA] text-xs truncate">{ev.company_name ?? ev.title}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {ev.status === 'COMPLETED' ? (
                      <div>
                        <p className="text-[#4A5B6C] text-[10px]">EPS Est / Act</p>
                        <p className="text-white text-xs font-semibold">{(ev as any).eps_estimate?.toFixed(2) ?? '—'} / {(ev as any).eps_actual?.toFixed(2) ?? '—'}</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-[#4A5B6C] text-[10px]">EPS Est</p>
                        <p className="text-white text-xs font-semibold">{(ev as any).eps_estimate?.toFixed(2) ?? 'TBD'}</p>
                      </div>
                    )}
                    {ev.event_time && <p className="text-[#4A5B6C] text-[10px] mt-0.5">{ev.event_time}</p>}
                  </div>
                  <button className="text-[#2A3B4C] hover:text-[#0F7ABF] transition-colors ml-1"><Star className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBar msg="Failed to load earnings calendar." onRetry={() => refetch()} />}
      {isLoading
        ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
            <p className="text-[#4A5B6C] text-xs text-center mt-4">Loading earnings data...</p>
          </div>
        )
        : !dedupedData.length
        ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">📊</p>
            <p className="text-[#4A5B6C] text-sm">
              {tickers?.length
                ? 'No earnings scheduled for your holdings in this period'
                : 'No earnings scheduled for this period'}
            </p>
          </div>
        )
        : (
          <>
            {renderGroup(indiaEvents, 'India', '🇮🇳')}
            {renderGroup(usEvents, 'United States', '🇺🇸')}
          </>
        )
      }
    </div>
  );
}

// ─── Economic Tab ─────────────────────────────────────────────────────────────

function EconomicTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error, refetch } = useEconomicCalendar(from, to);

  // Deduplicate and filter out weekend events
  const dedupedData = deduplicateEvents(data ?? []).filter(ev => !isWeekend(ev.event_date ?? ''));

  // Split into US and India
  const usEvents = dedupedData.filter(ev => (ev as any).country === 'US');
  const inEvents = dedupedData.filter(ev => (ev as any).country === 'IN');

  const renderEventCard = (ev: CalendarEvent) => {
    const actual = (ev as any).actual;
    const forecast = (ev as any).forecast;
    const prior = (ev as any).prior;
    const sentiment = actualVsForecast(actual, forecast);

    return (
      <div key={ev.id} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-5 py-3.5 hover:border-[#0F7ABF]/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#4A5B6C] text-xs">{fmtDate(ev.event_date ?? '')} {ev.event_time ? `, ${ev.event_time}` : ''}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${IMPACT_STYLES[ev.impact_level ?? 'LOW'] ?? IMPACT_STYLES.LOW}`}>
                {ev.impact_level ?? 'LOW'}
              </span>
            </div>
            <p className="text-white text-sm font-medium">{ev.title}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0 text-right">
            <div>
              <p className="text-[#4A5B6C] text-[10px]">Forecast</p>
              <p className="text-[#8899AA] text-xs font-semibold">{forecast ?? '—'}</p>
            </div>
            <div>
              <p className="text-[#4A5B6C] text-[10px]">Previous</p>
              <p className="text-[#8899AA] text-xs font-semibold">{prior ?? '—'}</p>
            </div>
            <div>
              <p className="text-[#4A5B6C] text-[10px]">Actual</p>
              <p className={`text-xs font-bold ${
                sentiment === 'good' ? 'text-green-400' :
                sentiment === 'bad' ? 'text-red-400' :
                actual != null ? 'text-white' : 'text-[#4A5B6C]'
              }`}>
                {actual ?? 'Pending'}
              </p>
            </div>
            {actual != null && forecast != null && sentiment !== 'neutral' && (
              <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                sentiment === 'good' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {sentiment === 'good' ? '▲ BEAT' : '▼ MISS'}
              </div>
            )}
            <button className="text-[#2A3B4C] hover:text-[#0F7ABF] transition-colors"><Star className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBar msg="Failed to load economic calendar." onRetry={() => refetch()} />}
      {isLoading
        ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            <p className="text-[#4A5B6C] text-xs text-center mt-4">Loading economic data...</p>
          </div>
        )
        : !dedupedData.length
        ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">🏛️</p>
            <p className="text-[#4A5B6C] text-sm">No economic events for this period</p>
          </div>
        )
        : (
          <>
            {/* US Section */}
            {usEvents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-base">🇺🇸</span>
                  <h3 className="text-sm font-semibold text-white/80">United States</h3>
                  <span className="text-xs text-[#4A5B6C]">({usEvents.length})</span>
                </div>
                {usEvents.map(renderEventCard)}
              </div>
            )}

            {/* India Section */}
            {inEvents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-base">🇮🇳</span>
                  <h3 className="text-sm font-semibold text-white/80">India</h3>
                  <span className="text-xs text-[#4A5B6C]">({inEvents.length})</span>
                </div>
                {inEvents.map(renderEventCard)}
              </div>
            )}
          </>
        )
      }
    </div>
  );
}

// ─── Ratings Tab ──────────────────────────────────────────────────────────────

const CHANGE_STYLES: Record<string, { cls: string; Icon: React.ElementType }> = {
  UPGRADE:   { cls: 'bg-green-500/20 text-green-300 border-green-500/30', Icon: TrendingUp },
  DOWNGRADE: { cls: 'bg-red-500/20 text-red-300 border-red-500/30',       Icon: TrendingDown },
  MAINTAIN:  { cls: 'bg-[#2A3B4C] text-[#8899AA] border-[#3A4B5C]',      Icon: Minus },
};

function RatingsTab({ from, to, tickers }: { from: string; to: string; tickers?: string[] }) {
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'UPGRADE' | 'DOWNGRADE' | 'MAINTAIN'>('ALL');
  const { data, isLoading, error, refetch } = useRatingsCalendar(from, to, tickers);

  const dedupedData = deduplicateEvents(data ?? []).filter(ev => !isWeekend(ev.event_date ?? ''));
  const filtered = dedupedData.filter(ev => typeFilter === 'ALL' || (ev as any).change_type === typeFilter);

  // Split by country
  const indiaRatings = filtered.filter(ev => ['NSE', 'BSE'].includes(ev.exchange ?? ''));
  const usRatings = filtered.filter(ev => ['NYSE', 'NASDAQ'].includes(ev.exchange ?? ''));

  const renderRatingCard = (ev: CalendarEvent) => {
    const ct = (ev as any).change_type ?? 'MAINTAIN';
    const { cls, Icon } = CHANGE_STYLES[ct] ?? CHANGE_STYLES.MAINTAIN;
    return (
      <div key={ev.id} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-5 py-4 hover:border-[#0F7ABF]/40 transition-colors">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white text-sm font-bold">{ev.ticker}</span>
              <span className="text-[10px] text-[#4A5B6C]">{ev.exchange}</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
                <Icon className="w-3 h-3" /> {ct}
              </span>
            </div>
            <p className="text-[#8899AA] text-xs mb-1">{ev.company_name}</p>
            <p className="text-[#4A5B6C] text-xs">{(ev as any).analyst_firm} · {fmtDate(ev.event_date ?? '')}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center gap-2 mb-1 justify-end">
              <span className="text-[#8899AA] text-xs line-through">{ev.rating_prev}</span>
              <span className="text-white text-xs font-semibold">→ {ev.rating_new}</span>
            </div>
            {ev.price_target && (
              <p className="text-[#0F7ABF] text-xs font-semibold">
                PT: {['NSE', 'BSE'].includes(ev.exchange ?? '') ? '₹' : '$'}{(ev.price_target as number).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(['ALL', 'UPGRADE', 'DOWNGRADE', 'MAINTAIN'] as const).map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${typeFilter === t ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white' : 'border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'}`}>
            {t === 'UPGRADE' ? '⬆ Upgrades' : t === 'DOWNGRADE' ? '⬇ Downgrades' : t === 'MAINTAIN' ? '➡ Maintained' : 'All'}
          </button>
        ))}
      </div>

      {error && <ErrorBar msg="Failed to load ratings calendar." onRetry={() => refetch()} />}
      {isLoading
        ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            <p className="text-[#4A5B6C] text-xs text-center mt-4">Loading ratings data...</p>
          </div>
        )
        : !filtered.length
        ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">⭐</p>
            <p className="text-[#4A5B6C] text-sm">
              {tickers?.length
                ? 'No analyst rating changes for your holdings'
                : 'No rating changes for this period'}
            </p>
          </div>
        )
        : (
          <>
            {/* US Section */}
            {usRatings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-base">🇺🇸</span>
                  <h3 className="text-sm font-semibold text-white/80">United States</h3>
                  <span className="text-xs text-[#4A5B6C]">({usRatings.length})</span>
                </div>
                {usRatings.map(renderRatingCard)}
              </div>
            )}

            {/* India Section */}
            {indiaRatings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-base">🇮🇳</span>
                  <h3 className="text-sm font-semibold text-white/80">India</h3>
                  <span className="text-xs text-[#4A5B6C]">({indiaRatings.length})</span>
                </div>
                {indiaRatings.map(renderRatingCard)}
              </div>
            )}
          </>
        )
      }
    </div>
  );
}

// ─── Dividends Tab ────────────────────────────────────────────────────────────

function DividendsTab({ from, to, tickers }: { from: string; to: string; tickers?: string[] }) {
  const { data, isLoading, error, refetch } = useDividendsCalendar(from, to, tickers);
  const dedupedData = deduplicateEvents(data ?? []).filter(ev => !isWeekend(ev.event_date ?? ''));

  // Split by country
  const indiaDiv = dedupedData.filter(ev => ['NSE', 'BSE'].includes(ev.exchange ?? ''));
  const usDiv = dedupedData.filter(ev => ['NYSE', 'NASDAQ'].includes(ev.exchange ?? ''));

  const renderDivCard = (ev: CalendarEvent) => {
    const currency = (ev as any).dividend_currency === 'INR' ? '₹' : '$';
    return (
      <div key={ev.id} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-5 py-3.5 hover:border-[#0F7ABF]/40 transition-colors">
        <div className="flex items-center gap-4">
          <span className="text-lg">{EXCHANGE_FLAG[ev.exchange ?? ''] ?? '🌐'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-white text-sm font-bold">{ev.ticker}</span>
              <span className="text-[10px] text-[#4A5B6C]">{ev.exchange}</span>
            </div>
            <p className="text-[#8899AA] text-xs">{ev.company_name}</p>
          </div>
          <div className="flex items-center gap-5 shrink-0 text-right">
            {[
              ['Ex-Date', fmtDate(ev.event_date ?? '')],
              ['Record', ev.record_date ? fmtDate(ev.record_date) : '—'],
              ['Pay Date', ev.pay_date ? fmtDate(ev.pay_date) : '—'],
            ].map(([label, val]) => (
              <div key={label as string}>
                <p className="text-[#4A5B6C] text-[10px]">{label}</p>
                <p className="text-white text-xs font-semibold">{val}</p>
              </div>
            ))}
            <div>
              <p className="text-[#4A5B6C] text-[10px]">Dividend</p>
              <p className="text-green-400 text-sm font-bold">{currency}{(ev as any).dividend_amount?.toFixed(2)}</p>
              {(ev as any).dividend_yield && <p className="text-[#4A5B6C] text-[10px]">{(ev as any).dividend_yield}% yield</p>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {error && <ErrorBar msg="Failed to load dividends calendar." onRetry={() => refetch()} />}
      {isLoading
        ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            <p className="text-[#4A5B6C] text-xs text-center mt-4">Loading dividends data...</p>
          </div>
        )
        : !dedupedData?.length
        ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-2">💰</p>
            <p className="text-[#4A5B6C] text-sm">
              {tickers?.length
                ? 'No dividends for your holdings in this period'
                : 'No dividends for this period'}
            </p>
          </div>
        )
        : (
          <>
            {usDiv.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-base">🇺🇸</span>
                  <h3 className="text-sm font-semibold text-white/80">United States</h3>
                  <span className="text-xs text-[#4A5B6C]">({usDiv.length})</span>
                </div>
                {usDiv.map(renderDivCard)}
              </div>
            )}
            {indiaDiv.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-base">🇮🇳</span>
                  <h3 className="text-sm font-semibold text-white/80">India</h3>
                  <span className="text-xs text-[#4A5B6C]">({indiaDiv.length})</span>
                </div>
                {indiaDiv.map(renderDivCard)}
              </div>
            )}
          </>
        )
      }
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: 'earnings',  label: 'Earnings',  emoji: '📊' },
  { id: 'economic',  label: 'Economic',  emoji: '🏛️' },
  { id: 'ratings',   label: 'Ratings',   emoji: '⭐' },
  { id: 'dividends', label: 'Dividends', emoji: '💰' },
];

export default function CalendarsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('earnings');
  const [daysAhead, setDaysAhead] = useState(14);
  const [myTickersOnly, setMyTickersOnly] = useState(false);

  // Include last 3 days + upcoming days
  const from = format(subDays(startOfDay(new Date()), 3), 'yyyy-MM-dd');
  const to   = format(addDays(startOfDay(new Date()), daysAhead), 'yyyy-MM-dd');

  const { data: userTickers = [], isLoading: tickersLoading } = useUserTickers();

  // Only pass tickers when toggle is on AND we have tickers
  const filterTickers = myTickersOnly && userTickers.length > 0 ? userTickers : undefined;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Calendars</h1>
          <p className="text-[#4A5B6C] text-xs mt-0.5">
            Last 3 days + next {daysAhead} days
            {myTickersOnly && userTickers.length > 0 && ` · Showing ${userTickers.length} ticker${userTickers.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* My tickers toggle */}
          <button
            onClick={() => setMyTickersOnly(v => !v)}
            disabled={tickersLoading}
            title={userTickers.length === 0 && !tickersLoading ? 'Add tickers to your portfolio or watchlist first' : undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              myTickersOnly
                ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
                : 'bg-transparent border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <BookMarked className="w-3.5 h-3.5" />
            My tickers only
            {tickersLoading && <span className="animate-pulse">…</span>}
          </button>

          {/* Days ahead selector */}
          <div className="flex gap-1">
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDaysAhead(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${daysAhead === d ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white' : 'bg-transparent border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* No tickers hint */}
      {myTickersOnly && userTickers.length === 0 && !tickersLoading && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-amber-300 text-sm">
          <BookMarked className="w-4 h-4 shrink-0" />
          No tickers found in your portfolio or watchlists. Add some to use this filter.
        </div>
      )}

      <div className="flex gap-1 bg-[#0D1B2E] rounded-xl p-1 border border-[#2A3B4C]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-[#1A2B3C] text-white shadow' : 'text-[#4A5B6C] hover:text-[#8899AA]'}`}>
            <span>{tab.emoji}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'earnings'  && <EarningsTab from={from} to={to} tickers={filterTickers} />}
      {activeTab === 'economic'  && <EconomicTab from={from} to={to} />}
      {activeTab === 'ratings'   && <RatingsTab from={from} to={to} tickers={filterTickers} />}
      {activeTab === 'dividends' && <DividendsTab from={from} to={to} tickers={filterTickers} />}
    </div>
  );
}
