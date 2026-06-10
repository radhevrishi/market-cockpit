'use client'

import { useEffect, useState } from 'react'
import { isIndianMarketOpen, isUSMarketOpen } from '@/lib/market-hours'

interface Market {
  name: string
  tz: string
  open: string  // HH:MM
  close: string // HH:MM
  days: number[] // 0=Sun..6=Sat
}

const MARKETS: Market[] = [
  { name: 'NSE', tz: 'Asia/Kolkata',    open: '09:15', close: '15:30', days: [1,2,3,4,5] },
  { name: 'NYSE', tz: 'America/New_York', open: '09:30', close: '16:00', days: [1,2,3,4,5] },
]

function isMarketOpen(market: Market): boolean {
  // Delegate to the holiday-aware market-hours lib (NSE holiday calendar,
  // exact IST/ET session windows) instead of local Intl time math.
  return market.name === 'NSE' ? isIndianMarketOpen() : isUSMarketOpen()
}

export default function MarketHours() {
  /*
   * PATCH 0965 UX — "Market open/closed" header badge.
   * Root cause: the previous component computed open-status once via
   * useMemo with an empty dep list. On a long-lived dashboard tab the
   * status went stale — a market that opened/closed mid-session never
   * updated the badge. Labels were also minimal ("NSE" only) so users
   * couldn't tell at a glance whether the session was live.
   * Fix: drive the badge from state that refreshes every 60 s with
   * setInterval, and render the explicit "Open"/"Closed" suffix per the
   * UX spec. Initial state mirrors SSR (all-closed → no hydration
   * mismatch) and gets overwritten on first effect tick. Compact pill
   * styling so the header doesn't grow.
   */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    // Run immediately, then every 60 s. Cheap pure-fn call — no IO.
    setTick((t) => t + 1)
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  void tick
  const markets = MARKETS.map((m) => ({ ...m, isOpen: isMarketOpen(m) }))

  return (
    <div className="flex items-center gap-2">
      {markets.map((m) => {
        const dotColor = m.isOpen ? '#10B981' /* green */ : '#F59E0B' /* amber */
        const label = m.isOpen ? `${m.name} Open` : `${m.name} Closed`
        return (
          <span
            key={m.name}
            title={`${m.name}: ${m.open}–${m.close} (${m.tz}). Auto-refreshes every 60s.`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              borderRadius: 6,
              border: `1px solid ${dotColor}40`,
              backgroundColor: `${dotColor}12`,
              fontSize: 11,
              fontWeight: 600,
              color: dotColor,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: dotColor,
                boxShadow: m.isOpen ? `0 0 6px ${dotColor}` : 'none',
              }}
            />
            {label}
          </span>
        )
      })}
    </div>
  )
}
