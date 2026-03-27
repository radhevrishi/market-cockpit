'use client'

import { useMemo } from 'react'

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
  const now = new Date()
  // Get time in market timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: market.tz,
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short'
  }).formatToParts(now)
  
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
  const weekday = parts.find(p => p.type === 'weekday')?.value || ''
  
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayNum = dayMap[weekday] ?? -1
  
  if (!market.days.includes(dayNum)) return false
  
  const currentMins = hour * 60 + minute
  const [oh, om] = market.open.split(':').map(Number)
  const [ch, cm] = market.close.split(':').map(Number)
  const openMins = oh * 60 + om
  const closeMins = ch * 60 + cm
  
  return currentMins >= openMins && currentMins < closeMins
}

export default function MarketHours() {
  const markets = useMemo(() => 
    MARKETS.map(m => ({ ...m, isOpen: isMarketOpen(m) })),
    []
  )
  
  return (
    <div className="flex items-center gap-2">
      {markets.map(m => (
        <div key={m.name} className="flex items-center gap-1" title={`${m.name}: ${m.open}–${m.close} (${m.tz})`}>
          <span className={`w-1.5 h-1.5 rounded-full ${m.isOpen ? 'bg-green-400' : 'bg-gray-500'}`} />
          <span className={`text-xs font-medium ${m.isOpen ? 'text-green-400' : 'text-gray-500'}`}>
            {m.name}
          </span>
        </div>
      ))}
    </div>
  )
}
