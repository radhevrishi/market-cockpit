'use client';

// ════════════════════════════════════════════════════════════════════════════
// FreshnessStrip — one slim Home strip showing how stale each data feed is:
// India/USA technicals, both multibagger scored sets, screener CSVs and the
// conviction bench. Arrays without reliable timestamps show a row count
// (presence = synced); dated feeds show relative age with amber/red staleness.
// Hover any chip for what to do to refresh it.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getEngineViews } from '@/lib/engines';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

type Tone = 'fresh' | 'amber' | 'red' | 'dim';

interface Chip {
  label: string;
  value: string;
  tone: Tone;
  title: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

function readJSON(key: string): any {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function relAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

/** Turn an epoch-age into {value, tone}: <2d fresh, 3-7d amber, >7d red+stale. */
function ageChip(ts: number | null): { value: string; tone: Tone } {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return { value: 'unknown', tone: 'dim' };
  const age = Date.now() - ts;
  if (age < 0) return { value: 'now', tone: 'fresh' };
  const rel = relAge(age);
  if (age < 2 * DAY) return { value: rel, tone: 'fresh' };
  if (age <= 7 * DAY) return { value: rel, tone: 'amber' };
  return { value: `${rel} stale`, tone: 'red' };
}

function parseDateish(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Defensively pull the newest date-ish value out of the screener manifest. */
function manifestDate(m: any): number | null {
  if (!m || typeof m !== 'object') return null;
  const KEYS = ['updatedAt', 'updated', 'updated_at', 'generatedAt', 'generated_at', 'generated', 'date', 'ts', 'timestamp'];
  let best: number | null = null;
  const consider = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of KEYS) {
      const t = parseDateish((obj as any)[k]);
      if (t != null && (best == null || t > best)) best = t;
    }
  };
  consider(m);
  const files = (m as any).files;
  const perFile = Array.isArray(files) ? files : (files && typeof files === 'object') ? Object.values(files) : Array.isArray(m) ? m : null;
  if (perFile) for (const f of perFile) consider(f);
  // Last resort: any top-level values that are per-file objects
  if (best == null && !Array.isArray(m)) for (const v of Object.values(m)) consider(v);
  return best;
}

const TONE_STYLE: Record<Tone, { color: string; border: string; background: string }> = {
  fresh: { color: 'var(--mc-bullish)', border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-2)' },
  amber: { color: 'var(--mc-warn)', border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)' },
  red: { color: 'var(--mc-bearish)', border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)' },
  dim: { color: 'var(--mc-text-4)', border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-2)' },
};

export default function FreshnessStrip() {
  const [chips, setChips] = useState<Chip[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Chip[] = [];

      // ── 🇮🇳 Technicals ────────────────────────────────────────────────────
      {
        const rows = readJSON('mb_tech_rows_ind_v1');
        const n = Array.isArray(rows) ? rows.length : 0;
        const ts = parseDateish(readJSON('mb_tech_last_pulled_sync_v1') ?? localStorage.getItem('mb_tech_last_pulled_sync_v1'));
        const title = 'India technicals universe. Re-upload TradingView export on India Technicals tab to refresh. Row count shown when no upload timestamp exists (presence = synced).';
        if (ts != null) { const a = ageChip(ts); out.push({ label: '🇮🇳 Technicals', value: a.value, tone: a.tone, title }); }
        else if (n > 0) out.push({ label: '🇮🇳 Technicals', value: `✓ ${n} rows`, tone: 'fresh', title });
        else out.push({ label: '🇮🇳 Technicals', value: 'unknown', tone: 'dim', title });
      }

      // ── 🇺🇸 Technicals ────────────────────────────────────────────────────
      {
        const rows = readJSON('mb_tech_rows_usa_v1');
        const n = Array.isArray(rows) ? rows.length : 0;
        const ts = parseDateish(readJSON('mb_usa_uploaded_at_v1') ?? localStorage.getItem('mb_usa_uploaded_at_v1'));
        const title = 'USA technicals universe. Re-upload TradingView export on USA Technicals tab to refresh.';
        if (ts != null) { const a = ageChip(ts); out.push({ label: '🇺🇸 Technicals', value: a.value, tone: a.tone, title }); }
        else if (n > 0) out.push({ label: '🇺🇸 Technicals', value: `✓ ${n} rows`, tone: 'fresh', title });
        else out.push({ label: '🇺🇸 Technicals', value: 'unknown', tone: 'dim', title });
      }

      // ── 🚀 Multibagger scored sets (no per-row timestamps → counts) ───────
      for (const [key, label, title] of [
        ['mb_excel_scored_v2', '🚀 Multibagger IND', 'India multibagger scored set. Re-run the Excel scorer upload on the Multibagger tab to refresh. Count shown — presence = synced.'],
        ['mb_usa_scored_v2', '🚀 Multibagger USA', 'USA multibagger scored set. Re-run the USA scorer upload on the Multibagger tab to refresh. Count shown — presence = synced.'],
      ] as const) {
        const rows = readJSON(key);
        const n = Array.isArray(rows) ? rows.length : 0;
        out.push(n > 0
          ? { label, value: `✓ ${n} rows`, tone: 'fresh', title }
          : { label, value: 'unknown', tone: 'dim', title });
      }

      // ── 🧾 Screener CSVs (manifest date, defensive) ───────────────────────
      {
        const title = 'Screener CSV bundle served from /data/screener. Regenerate and redeploy the screener export to refresh.';
        let ts: number | null = null;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10_000);
          const res = await fetch('/data/screener/manifest.json', { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) ts = manifestDate(await res.json());
        } catch { /* silent */ }
        const a = ageChip(ts);
        out.push({ label: '🧾 Screener CSVs', value: a.value, tone: a.tone, title });
      }

      // ── 🏆 Bench ──────────────────────────────────────────────────────────
      {
        const title = 'Conviction Beats bench. Add or refresh names on the Conviction tab. Count shown — presence = synced.';
        let n = 0;
        const stored = readJSON('mc:conviction-beats:v1');
        if (Array.isArray(stored)) n = stored.length;
        else if (stored && typeof stored === 'object' && Array.isArray((stored as any).entries)) n = (stored as any).entries.length;
        if (!n) {
          try { for (const v of getEngineViews().values()) if (v.bench) n++; } catch { /* silent */ }
        }
        out.push(n > 0
          ? { label: '🏆 Bench', value: `✓ ${n} names`, tone: 'fresh', title }
          : { label: '🏆 Bench', value: 'unknown', tone: 'dim', title });
      }

      if (alive) setChips(out);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontFamily: MONO, fontSize: 9.5 }}>
      <span style={{ color: 'var(--mc-text-4)', fontWeight: 800, letterSpacing: 0.5 }}>DATA</span>
      {chips.map((c) => {
        const t = TONE_STYLE[c.tone];
        return (
          <span
            key={c.label}
            title={c.title}
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, padding: '2px 7px', borderRadius: 6, border: t.border, background: t.background, cursor: 'default', whiteSpace: 'nowrap' }}
          >
            <span style={{ color: 'var(--mc-text-3)', fontWeight: 700 }}>{c.label}</span>
            <span style={{ color: t.color, fontWeight: 800 }}>{c.value}</span>
          </span>
        );
      })}
    </div>
  );
}
