// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type CommentarySignal, type DayOneFilter } from './types';

// ══════════════════════════════════════════════
// EARNINGS PAGE — Custom Universe Only
// Sources: Portfolio / Watchlist / Both
// Shows: Revenue, OP, OPM%, PAT, NPM%, EPS with YoY/QoQ
// Aggregates: Avg growth metrics, trend analysis, risk flags
// ══════════════════════════════════════════════

export const BG = '#0A0E1A';
export const CARD = '#0D1623';
export const CARD_BORDER = '#1A2540';
export const ACCENT = '#0F7ABF';
export const TEXT = '#E8ECF1';
export const TEXT_DIM = '#8899AA';
export const GREEN = '#00C853';
export const YELLOW = '#FFD600';
export const RED = '#F44336';
export const HEADER_BG = '#0A1628';
// PATCH 0199 — Persistent localStorage cache (was per-tab in-memory only,
// which meant every fresh browser tab re-scanned 685 stocks from scratch).
// Now: cache survives across browser sessions for 1 hour, auto-invalidates
// on calendar-month change, and renders cards INSTANTLY from disk while a
// background refresh runs in parallel (stale-while-revalidate pattern).
export const EARNINGS_CACHE_TTL = 60 * 60 * 1000;
 // "2026-05"
export const LS_CACHE_KEY = 'mc:earnings-scan:v1';
export const _earningsCache = {
  get: (): { data: any; timestamp: number; month: string } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(LS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  },
  set: (v: { data: any; timestamp: number; month: string }) => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(v)); } catch {}
  },
};
// PATCH 0962 — Current schema version the client expects. Cached objects
// with a lower version are treated as stale and re-fetched. Bump this only
// when the schema gains a NEW non-optional field; optional additions don't
// need a bump because validateGuidanceObject still passes.
export const CLIENT_EXPECTED_SCHEMA_VERSION = 3;
export const CLIENT_LS_KEY = 'mc:ai-fg:v3';
export const COMMENTARY_COLORS: Record<CommentarySignal, { bg: string; border: string; text: string }> = {
  POSITIVE:  { bg: '#10B98110', border: '#10B98130', text: '#10B981' },
  MIXED:     { bg: '#F59E0B10', border: '#F59E0B30', text: '#F59E0B' },
  RED_FLAG:  { bg: '#EF444410', border: '#EF444430', text: '#EF4444' },
};
export const DAY_ONE_FILTERS: { key: DayOneFilter; label: string; predicate: (v: number) => boolean; color: string }[] = [
  { key: 'GE2',  label: '≥ +2%',  predicate: v => v >= 2,   color: '#22D3EE' },
  { key: 'GE4',  label: '≥ +4%',  predicate: v => v >= 4,   color: '#10B981' },
  { key: 'GE7',  label: '≥ +7%',  predicate: v => v >= 7,   color: '#10B981' },
  { key: 'GE10', label: '≥ +10%', predicate: v => v >= 10,  color: '#F59E0B' },
  { key: 'NEG2', label: '≤ -2%',  predicate: v => v <= -2,  color: '#F87171' },
  { key: 'NEG5', label: '≤ -5%',  predicate: v => v <= -5,  color: '#EF4444' },
];
