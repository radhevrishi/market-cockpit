// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG (PATCH 0638)
//
// Aggregates user actions across the portal into a single chronological feed.
// Sources are reconstructed from existing localStorage stores (decisions,
// valuations, custom themes, alert rules, conviction beats) — no new
// writes required at action time.
//
// To add a new action source: append a new collector in `collectActivity()`.
// The collector reads its localStorage key, maps each entry to an ActivityItem,
// and the page-level aggregator sorts everything by timestamp desc.
// ═══════════════════════════════════════════════════════════════════════════

export type ActivityKind =
  | 'DECISION'        // Decision logbook entry
  | 'VALUATION'       // Saved valuation
  | 'THEME'           // Custom theme added
  | 'ALERT'           // Alert rule created
  | 'NOTE'            // Thesis notebook entry
  | 'WATCHLIST'       // Watchlist add/remove
  | 'DATA'            // Multibagger CSV upload, etc.
  ;

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  emoji: string;
  color: string;
  ts: number;        // epoch ms
  label: string;     // short headline
  detail?: string;   // expanded detail
  ticker?: string;
  href?: string;     // where to drill in
}

const KIND_META: Record<ActivityKind, { emoji: string; color: string }> = {
  DECISION:  { emoji: '📒', color: '#A78BFA' },
  VALUATION: { emoji: '🧮', color: '#22D3EE' },
  THEME:     { emoji: '🔥', color: '#EF4444' },
  ALERT:     { emoji: '🔔', color: '#F59E0B' },
  NOTE:      { emoji: '📝', color: '#94A3B8' },
  WATCHLIST: { emoji: '👁', color: '#22D3EE' },
  DATA:      { emoji: '📥', color: '#10B981' },
};

function tryParse<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function collectActivity(): ActivityItem[] {
  const out: ActivityItem[] = [];

  // ── Decisions (mc:decisions:v1) ───────────────────────────────────────
  const decisions = tryParse<Record<string, any>>('mc:decisions:v1', {});
  for (const [ticker, d] of Object.entries(decisions)) {
    if (!d) continue;
    const ts = typeof d.date === 'string' ? new Date(d.date).getTime() : (typeof d.date === 'number' ? d.date : Date.now());
    if (!Number.isFinite(ts)) continue;
    out.push({
      id: `dec-${ticker}-${ts}`,
      kind: 'DECISION',
      ...KIND_META.DECISION,
      ts,
      ticker,
      label: `${d.status || 'DECISION'} · ${ticker}`,
      detail: d.reason || undefined,
      href: `/decisions`,
    });
  }

  // ── Valuations (mc:saved-valuations:v1) ───────────────────────────────
  const vals = tryParse<any[]>('mc:saved-valuations:v1', []);
  for (const v of vals) {
    if (!v?.savedAt) continue;
    const ts = new Date(v.savedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    out.push({
      id: `val-${v.id}`,
      kind: 'VALUATION',
      ...KIND_META.VALUATION,
      ts,
      ticker: v.ticker,
      label: `Saved ${v.calcKind === 'EV_EBITDA' ? 'EV/EBITDA' : v.calcKind} valuation · ${v.ticker || '—'}`,
      detail: v.baseSummary || v.notes,
      href: `/valuation-calc`,
    });
  }

  // ── Custom Themes (mc:critical-themes-custom:v1) ──────────────────────
  const themes = tryParse<any[]>('mc:critical-themes-custom:v1', []);
  for (const t of themes) {
    // No timestamp in stored shape — synthesize from id when possible
    let ts = Date.now();
    const m = t?.id?.match(/custom-[a-z]+-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 1e12) ts = n;
    }
    out.push({
      id: `theme-${t.id}`,
      kind: 'THEME',
      ...KIND_META.THEME,
      ts,
      label: `Added theme · ${t.name}`,
      detail: `Region ${t.region} · ${t.leaders?.length || 0} leaders`,
      href: `/critical-themes`,
    });
  }

  // ── News Alert rules (mc:news-alerts:v1) ──────────────────────────────
  const alerts = tryParse<any[]>('mc:news-alerts:v1', []);
  for (const a of alerts) {
    if (!a?.createdAt) continue;
    out.push({
      id: `alert-${a.id}`,
      kind: 'ALERT',
      ...KIND_META.ALERT,
      ts: a.createdAt,
      label: `Alert rule · ${a.name}`,
      detail: a.enabled ? 'Active' : 'Paused',
      href: `/news-alerts`,
    });
    if (a.lastFiredAt && a.lastFiredAt > 0) {
      out.push({
        id: `alert-fire-${a.id}-${a.lastFiredAt}`,
        kind: 'ALERT',
        ...KIND_META.ALERT,
        ts: a.lastFiredAt,
        label: `Alert fired · ${a.name}`,
        detail: `${a.lastFiredArticleIds?.length || 0} article(s) matched`,
        href: `/news-alerts`,
      });
    }
  }

  // ── Thesis notebooks (mc:notes:meta:v1 sidecar index) ────────────────
  const noteMeta = tryParse<any[]>('mc:notes:meta:v1', []);
  for (const n of noteMeta) {
    if (!n?.lastWriteEpoch) continue;
    out.push({
      id: `note-${n.id}`,
      kind: 'NOTE',
      ...KIND_META.NOTE,
      ts: n.lastWriteEpoch,
      label: `Note edited · ${n.title || n.id}`,
      detail: `${n.charCount || 0} chars`,
      href: `/news`,
    });
  }

  // ── Watchlist (mc_watchlist_tickers) — no timestamps stored, skip ──
  // Multibagger upload meta (mb_excel_meta_v2)
  const mbMeta = tryParse<any>('mb_excel_meta_v2', null);
  if (mbMeta && (mbMeta.uploadedAt || mbMeta.timestamp || mbMeta.lastUpload)) {
    const ts = new Date(mbMeta.uploadedAt || mbMeta.timestamp || mbMeta.lastUpload).getTime();
    if (Number.isFinite(ts)) {
      out.push({
        id: `data-mb-${ts}`,
        kind: 'DATA',
        ...KIND_META.DATA,
        ts,
        label: `Multibagger CSV uploaded · ${mbMeta.rowCount || '—'} rows`,
        detail: `India universe refresh`,
        href: `/multibagger`,
      });
    }
  }

  return out.sort((a, b) => b.ts - a.ts);
}

export function activityTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return m <= 0 ? 'just now' : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
