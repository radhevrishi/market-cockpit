'use client';
// zzz1065 — the first thing on the home page: one compact strip that answers "where do things stand right now".
//   • the date and time, BOTH in India time and labelled IST (H02 — the date used to come from the browser's zone)
//   • India and US market: open / closed, and when the next session opens
//   • your stored uploads: how many are fresh / ageing / stale (links to the full Data freshness row)
//   • unread price alerts (links to /price-alerts)
// No new data logic: the market rules are lib/home-status.ts, the freshness chips are FreshnessStrip's own local ones,
// and the unread count is the same /api/v1/price-alerts?view=bell answer the header bell reads.
import { useEffect, useState, type CSSProperties } from 'react';
import NavLink from '@/components/NavLink';
import { localFreshnessChips } from '@/components/FreshnessStrip';
import { homeDateTime, indiaSession, usSession, freshnessSummary, type FreshTone } from '@/lib/home-status';
import { getJson } from '@/lib/client-fetch';
import { ALERTS_API, ALERTS_CHANGED_EVENT } from '@/lib/alerts/client';

const TONE_COLOR: Record<FreshTone, string> = {
  fresh: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)', dim: 'var(--mc-text-4)',
};

const pill = (color: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '4px 10px', borderRadius: 8,
  border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)`,
  color, fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', lineHeight: 1.25,
});

export function HomeStatusStrip({ now }: { now: Date | null }) {
  const [tones, setTones] = useState<FreshTone[] | null>(null);
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    try { setTones(localFreshnessChips().map((c) => c.tone)); } catch { setTones([]); }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = (force = false) => {
      void getJson<any>(`${ALERTS_API}?view=bell`, { timeoutMs: 20_000, ttlMs: 60_000, force }).then((j) => {
        if (alive && j?.ok) setUnread(Number(j.unread) || 0);
      });
    };
    load();
    const onChange = () => load(true);
    window.addEventListener(ALERTS_CHANGED_EVENT, onChange);
    return () => { alive = false; window.removeEventListener(ALERTS_CHANGED_EVENT, onChange); };
  }, []);

  const dt = now ? homeDateTime(now) : null;
  const ind = now ? indiaSession(now) : null;
  const us = now ? usSession(now) : null;
  const fresh = tones ? freshnessSummary(tones) : null;

  return (
    <div data-home-section="status-strip" className="mc-home-status" role="region" aria-label="Market and data status"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', minWidth: 0 }}>
      <span data-testid="home-datetime" title="Date and time in India (Asia/Kolkata)" style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap' }}>
        {dt ? <>{dt.date} · {dt.time} <span style={{ color: 'var(--mc-text-4)', fontWeight: 800 }}>{dt.tz}</span></> : '—'}
      </span>
      {ind && (
        <span data-testid="home-market-in" title={ind.note} style={pill(ind.open ? 'var(--mc-bullish)' : 'var(--mc-text-3)')}>
          🇮🇳 India <b>{ind.label}</b>
        </span>
      )}
      {us && (
        <span data-testid="home-market-us" title={us.note} style={pill(us.open ? 'var(--mc-bullish)' : 'var(--mc-text-3)')}>
          🇺🇸 US <b>{us.label}</b>
        </span>
      )}
      <a href="#home-data-freshness" data-testid="home-freshness-summary"
        title="Your stored uploads (technicals, multibagger sets, bench). Opens the Data freshness row below."
        style={pill(fresh ? TONE_COLOR[fresh.worst] : 'var(--mc-text-4)')}>
        🗂 Your data: {fresh ? fresh.text : 'checking…'}
      </a>
      <NavLink href="/price-alerts" data-testid="home-alerts-unread"
        title={unread ? `${unread} price alert${unread === 1 ? '' : 's'} fired that you have not read` : 'Price alerts'}
        style={pill(unread ? '#DC2626' : 'var(--mc-text-3)')}>
        🔔 {unread == null ? 'Price alerts' : unread > 0 ? `${unread > 99 ? '99+' : unread} unread alert${unread === 1 ? '' : 's'}` : 'No unread alerts'}
      </NavLink>
    </div>
  );
}
