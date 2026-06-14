'use client';

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG (PATCH 0638)
//
// Unified chronological feed of every user action across the portal:
// decisions, valuations, custom themes, alert rules, notes, data uploads.
// Reconstructed from existing localStorage stores — no new writes needed
// at action time.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collectActivity, activityTimeAgo, type ActivityItem, type ActivityKind } from '@/lib/activity-log';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const KIND_FILTER: Array<{ id: ActivityKind | 'ALL'; label: string }> = [
  { id: 'ALL',       label: 'All' },
  { id: 'DECISION',  label: 'Decisions' },
  { id: 'VALUATION', label: 'Valuations' },
  { id: 'THEME',     label: 'Themes' },
  { id: 'ALERT',     label: 'Alerts' },
  { id: 'NOTE',      label: 'Notes' },
  { id: 'DATA',      label: 'Data uploads' },
];

export default function ActivityLogPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [kind, setKind] = useState<ActivityKind | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const refresh = () => setItems(collectActivity());
    refresh();
    const onChange = () => refresh();
    // Listen for cross-tab updates from any feature
    const events = [
      'mc:decisions:updated', 'mc:valuations-updated', 'mc:custom-themes-updated',
      'conviction-beats:updated', 'mc:watchlist:updated', 'mc:notes:updated',
      'storage',
    ];
    for (const e of events) window.addEventListener(e, onChange);
    return () => {
      for (const e of events) window.removeEventListener(e, onChange);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (kind !== 'ALL' && it.kind !== kind) return false;
      if (q && !(it.label.toLowerCase().includes(q) || (it.detail || '').toLowerCase().includes(q) || (it.ticker || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, kind, search]);

  // Group by day
  const byDay = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of filtered) {
      const day = new Date(it.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'long' });
      const arr = map.get(day) || [];
      arr.push(it);
      map.set(day, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Kind counts (full set, ignoring filter)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>📜 Activity Log</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55, maxWidth: 800 }}>
            Chronological feed of every action you&apos;ve taken in the portal — decisions logged, valuations saved, themes added, alerts created, notes written, CSV uploads. Reads from localStorage; persists across reloads.
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {KIND_FILTER.map(f => {
            const n = f.id === 'ALL' ? items.length : (counts[f.id] || 0);
            return (
              <button key={f.id} onClick={() => setKind(f.id)} style={{
                fontSize: 11,
                padding: '5px 11px',
                background: kind === f.id ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
                border: `1px solid ${kind === f.id ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                color: kind === f.id ? 'var(--mc-cyan)' : TEXT,
                borderRadius: 4, cursor: 'pointer', fontWeight: 700,
              }}>
                {f.label} <span style={{ color: DIM, marginLeft: 3 }}>{n}</span>
              </button>
            );
          })}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by ticker / text…"
            style={{
              marginLeft: 'auto', minWidth: 200, fontSize: 11, padding: '5px 10px',
              background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 4,
            }}
          />
        </div>

        {filtered.length === 0 ? (
          /*
           * PATCH 0965 BUG #10 — Activity Log empty state.
           * Root cause: when the user has no logged activity yet, the
           * `filtered` array is empty and the previous code rendered only
           * a single italic filter hint that read more like "no matches"
           * than "you haven't done anything yet." On a fresh portal install
           * the feed looked blank/broken.
           * Fix: distinguish (a) the truly-empty case — no items at all
           * — from (b) the "filter excludes everything" case. For (a)
           * render a friendly centered empty-state card with an icon,
           * generous padding, and the prescribed call-to-action sentence
           * so the user immediately knows where activity comes from. (b)
           * keeps the existing italic "filter matches nothing" hint.
           */
          items.length === 0 ? (
            <div style={{
              background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8,
              padding: '60px 32px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              <div style={{ fontSize: 48, lineHeight: 1, color: DIM }} aria-hidden="true">📋</div>
              <div style={{ fontSize: 14, color: DIM, lineHeight: 1.6, maxWidth: 520 }}>
                No activity yet. Start by saving a valuation, adding a theme, or logging a decision &mdash; it will appear here automatically.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                <Link href="/valuation-calc" style={{ fontSize: 11, color: 'var(--mc-cyan)', textDecoration: 'none', padding: '5px 11px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 4, fontWeight: 700 }}>Save a valuation</Link>
                <Link href="/critical-themes" style={{ fontSize: 11, color: 'var(--mc-cyan)', textDecoration: 'none', padding: '5px 11px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 4, fontWeight: 700 }}>Add a theme</Link>
                <Link href="/multibagger" style={{ fontSize: 11, color: 'var(--mc-cyan)', textDecoration: 'none', padding: '5px 11px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 4, fontWeight: 700 }}>Log a decision</Link>
              </div>
            </div>
          ) : (
            <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '24px 26px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: DIM, fontStyle: 'italic' }}>
                No activity matches your filter. Try logging a decision in <Link href="/multibagger" style={{ color: 'var(--mc-cyan)' }}>Multibagger</Link>, saving a valuation in <Link href="/valuation-calc" style={{ color: 'var(--mc-cyan)' }}>Valuation Calc</Link>, or adding a theme in <Link href="/critical-themes" style={{ color: 'var(--mc-cyan)' }}>Critical Themes</Link>.
              </div>
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {byDay.map(([day, dayItems]) => (
              <div key={day}>
                <div style={{ fontSize: 11, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6, textTransform: 'uppercase' }}>{day}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dayItems.map(it => (
                    <Link key={it.id} href={it.href || '#'} style={{ textDecoration: 'none' }}>
                      <div style={{
                        background: CARD, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${it.color}`,
                        borderRadius: 6, padding: '8px 12px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        cursor: 'pointer',
                      }}>
                        <span style={{ fontSize: 16 }}>{it.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{it.label}</div>
                          {it.detail && <div style={{ fontSize: 11, color: DIM, marginTop: 2, lineHeight: 1.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.detail}</div>}
                        </div>
                        <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                          {activityTimeAgo(it.ts)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 4, padding: '10px 14px', fontSize: 11, color: DIM, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, lineHeight: 1.6 }}>
          <b style={{ color: TEXT }}>Data sources:</b> your decisions, saved valuations and uploads stored in this browser. Cross-tab sync.
        </div>
      </div>
    </div>
  );
}
