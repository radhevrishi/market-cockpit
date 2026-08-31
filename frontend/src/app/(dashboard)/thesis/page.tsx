'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THESIS & SELL-DISCIPLINE TRACKER
// The discipline layer: write WHY you own a name + the concrete conditions
// that break the thesis, then get surfaced every name whose auto-triggers
// have BREACHED. Sell-discipline for the long-term investor.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  readTheses, getThesisList, upsertThesis, removeThesis, markReviewed,
  newTriggerId, type ThesisEntry, type ThesisTrigger, type TriggerKind,
} from '@/lib/thesis-store';
import { getConvictionList } from '@/lib/conviction-beats';

/* ── Token map (theme-aware CSS vars only — never hardcode hex) ──────────── */
const C = {
  bg0: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)', bg4: 'var(--mc-bg-4)',
  t0: 'var(--mc-text-0)', t1: 'var(--mc-text-1)', t2: 'var(--mc-text-2)',
  t3: 'var(--mc-text-3)', t4: 'var(--mc-text-4)',
  b1: 'var(--mc-border-1)', b2: 'var(--mc-border-2)', b3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)', bear: 'var(--mc-bearish)', warn: 'var(--mc-warn)',
  err: 'var(--mc-err)', info: 'var(--mc-info)', accent: 'var(--mc-accent)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  persistent: 'var(--mc-state-persistent)',
};
const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const mix = (tok: string, pct: number) => `color-mix(in srgb, ${tok} ${pct}%, transparent)`;

/* ── Trigger presets ─────────────────────────────────────────────────────── */
interface Preset {
  kind: TriggerKind;
  title: string;
  hint: string;
  needsThreshold: boolean;
  thresholdLabel: string;
  defaultThreshold?: number;
  color: string;
}
const PRESETS: Preset[] = [
  { kind: 'margin', title: 'Margin erosion', hint: 'Operating margin drops below X% (or contracts 2 quarters)', needsThreshold: true, thresholdLabel: 'OPM floor %', color: C.warn },
  { kind: 'cash', title: 'Cash conversion', hint: 'CFO/PAT below X for a year', needsThreshold: true, thresholdLabel: 'CFO/PAT floor', defaultThreshold: 0.6, color: C.info },
  { kind: 'growth', title: 'Growth reversal', hint: 'Net profit YoY turns negative / below X%', needsThreshold: true, thresholdLabel: 'YoY floor %', defaultThreshold: 0, color: C.saffron },
  { kind: 'price', title: 'Price / stop', hint: 'Price falls below ₹X (stop / thesis-break level)', needsThreshold: true, thresholdLabel: 'Stop ₹', color: C.bear },
  { kind: 'custom', title: 'Custom reminder', hint: 'Free-text reminder — manual check, never auto-breaches', needsThreshold: false, thresholdLabel: '', color: C.persistent },
];
const presetOf = (k: TriggerKind) => PRESETS.find((p) => p.kind === k)!;

/* ── Types local to the page ─────────────────────────────────────────────── */
interface Holding { symbol: string; entryPrice: number; quantity: number; weight: number; addedAt: string; notes?: string; }
interface UniverseName { ticker: string; company?: string; owned: boolean; benched: boolean; }
type EvalStatus = 'ok' | 'breach' | 'manual' | 'unknown';
interface TrigEval { status: EvalStatus; reason: string; }
// Minimal shape we consume from a conviction entry.
interface ConvLike {
  ticker: string; company?: string;
  opm_pct?: number | null; opm_prev_pct?: number | null;
  net_profit_yoy_pct?: number | null;
  cfo_to_pat_ratio?: number | null; annual_cfo_pat?: (number | null)[] | null;
  roce?: number | null; pe?: number | null;
}

const MS_YEAR = 365 * 24 * 60 * 60 * 1000;
const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
const num = (v: number | null | undefined): number | null =>
  (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);

/* ── Trigger evaluation ──────────────────────────────────────────────────── */
function evaluateTrigger(t: ThesisTrigger, conv: ConvLike | undefined, livePrice: number | null): TrigEval {
  if (t.kind === 'custom') {
    return { status: 'manual', reason: t.note?.trim() || 'Manual check' };
  }

  if (t.kind === 'price') {
    if (t.threshold == null) return { status: 'unknown', reason: 'No stop level set' };
    if (livePrice == null) return { status: 'unknown', reason: 'No live quote available' };
    return livePrice < t.threshold
      ? { status: 'breach', reason: `Price ₹${livePrice.toLocaleString()} < stop ₹${t.threshold.toLocaleString()}` }
      : { status: 'ok', reason: `Price ₹${livePrice.toLocaleString()} ≥ stop ₹${t.threshold.toLocaleString()}` };
  }

  // margin / cash / growth need conviction-bench fundamentals.
  if (!conv) return { status: 'unknown', reason: 'No fundamentals on bench — add via Earnings Opportunities' };

  if (t.kind === 'margin') {
    const cur = num(conv.opm_pct), prev = num(conv.opm_prev_pct);
    if (cur == null || prev == null) return { status: 'unknown', reason: 'No margin data' };
    const contracting = cur < prev;
    const belowThr = t.threshold == null ? true : cur < t.threshold;
    const thrTxt = t.threshold == null ? '' : ` (floor ${t.threshold}%)`;
    if (contracting && belowThr) {
      return { status: 'breach', reason: `OPM ${cur.toFixed(1)}% < prior ${prev.toFixed(1)}%${thrTxt}` };
    }
    return { status: 'ok', reason: `OPM ${cur.toFixed(1)}% vs prior ${prev.toFixed(1)}%${thrTxt}` };
  }

  if (t.kind === 'cash') {
    const thr = t.threshold ?? 0.6;
    let ratio = num(conv.cfo_to_pat_ratio);
    let src = 'CFO/PAT';
    if (ratio == null && Array.isArray(conv.annual_cfo_pat) && conv.annual_cfo_pat.length) {
      const last = conv.annual_cfo_pat[conv.annual_cfo_pat.length - 1];
      ratio = num(last);
      src = 'annual CFO/PAT';
    }
    if (ratio == null) return { status: 'unknown', reason: 'No cash-conversion data' };
    return ratio < thr
      ? { status: 'breach', reason: `${src} ${ratio.toFixed(2)} < floor ${thr}` }
      : { status: 'ok', reason: `${src} ${ratio.toFixed(2)} ≥ floor ${thr}` };
  }

  if (t.kind === 'growth') {
    const thr = t.threshold ?? 0;
    const g = num(conv.net_profit_yoy_pct);
    if (g == null) return { status: 'unknown', reason: 'No profit-growth data' };
    return g < thr
      ? { status: 'breach', reason: `Net profit YoY ${g.toFixed(1)}% < floor ${thr}%` }
      : { status: 'ok', reason: `Net profit YoY ${g.toFixed(1)}% ≥ floor ${thr}%` };
  }

  return { status: 'unknown', reason: '' };
}

const statusColor = (s: EvalStatus) =>
  s === 'breach' ? C.bear : s === 'ok' ? C.bull : s === 'manual' ? C.persistent : C.t4;
const statusIcon = (s: EvalStatus) =>
  s === 'breach' ? '⚠' : s === 'ok' ? '✓' : s === 'manual' ? '◷' : '–';
const statusWord = (s: EvalStatus) =>
  s === 'breach' ? 'BREACHED' : s === 'ok' ? 'OK' : s === 'manual' ? 'MANUAL' : 'NO DATA';

/* ════════════════════════════════════════════════════════════════════════ */

export default function ThesisTrackerPage() {
  const [theses, setTheses] = useState<ThesisEntry[]>([]);
  const [conv, setConv] = useState<ConvLike[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [fTicker, setFTicker] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fThesis, setFThesis] = useState('');
  const [fTriggers, setFTriggers] = useState<ThesisTrigger[]>([]);

  /* ── Load client-only data ──────────────────────────────────────────── */
  const reload = useCallback(() => {
    if (typeof window === 'undefined') return;
    setTheses(getThesisList());
    try {
      const c = getConvictionList();
      setConv(Array.isArray(c) ? (c as ConvLike[]) : []);
    } catch { setConv([]); }
    try {
      const raw = window.localStorage.getItem('mc_portfolio_holdings');
      const arr = raw ? JSON.parse(raw) : [];
      setHoldings(Array.isArray(arr) ? arr : []);
    } catch { setHoldings([]); }
  }, []);

  useEffect(() => {
    reload();
    setReady(true);
    const onUpd = () => setTheses(getThesisList());
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith('mc')) reload(); };
    window.addEventListener('thesis:updated', onUpd);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('thesis:updated', onUpd);
      window.removeEventListener('storage', onStorage);
    };
  }, [reload]);

  // Live quotes (best-effort; both markets). Never blocks render.
  useEffect(() => {
    let alive = true;
    (async () => {
      const map: Record<string, number> = {};
      for (const market of ['india', 'us']) {
        try {
          const res = await fetch(`/api/market/quotes?market=${market}&fields=ticker,symbol,price`);
          if (!res.ok) continue;
          const data = await res.json();
          const rows: any[] = Array.isArray(data) ? data : (data?.stocks || []);
          for (const r of rows) {
            const sym = String(r?.ticker || r?.symbol || '').trim().toUpperCase();
            const px = Number(r?.price);
            if (sym && isFinite(px) && px > 0) map[sym] = px;
          }
        } catch { /* offline / build — fine */ }
      }
      if (alive) setQuotes(map);
    })();
    return () => { alive = false; };
  }, []);

  /* ── Derived ────────────────────────────────────────────────────────── */
  const convByTicker = useMemo(() => {
    const m: Record<string, ConvLike> = {};
    for (const c of conv) {
      const k = String(c.ticker || '').trim().toUpperCase();
      if (k) m[k] = c;
    }
    return m;
  }, [conv]);

  const universe = useMemo<UniverseName[]>(() => {
    const m: Record<string, UniverseName> = {};
    for (const h of holdings) {
      const k = String(h.symbol || '').trim().toUpperCase();
      if (!k) continue;
      m[k] = { ticker: k, company: undefined, owned: true, benched: false };
    }
    for (const c of conv) {
      const k = String(c.ticker || '').trim().toUpperCase();
      if (!k) continue;
      if (m[k]) { m[k].benched = true; m[k].company = m[k].company || c.company; }
      else m[k] = { ticker: k, company: c.company, owned: false, benched: true };
    }
    return Object.values(m).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [holdings, conv]);

  const livePriceFor = useCallback(
    (ticker: string) => {
      const k = ticker.trim().toUpperCase();
      const px = quotes[k];
      return px != null && isFinite(px) ? px : null;
    },
    [quotes]
  );

  // Evaluate every thesis once.
  interface EvaluatedThesis {
    entry: ThesisEntry;
    evals: { trigger: ThesisTrigger; ev: TrigEval }[];
    breaches: { trigger: ThesisTrigger; ev: TrigEval }[];
    reviewDue: boolean;
  }
  const evaluated = useMemo<EvaluatedThesis[]>(() => {
    return theses.map((entry) => {
      const c = convByTicker[entry.ticker.toUpperCase()];
      const px = livePriceFor(entry.ticker);
      const evals = entry.triggers.map((trigger) => ({ trigger, ev: evaluateTrigger(trigger, c, px) }));
      const breaches = evals.filter((e) => e.ev.status === 'breach');
      const clock = entry.reviewedAt || entry.createdAt;
      const reviewDue = clock ? (Date.now() - new Date(clock).getTime()) > MS_YEAR : false;
      return { entry, evals, breaches, reviewDue };
    });
  }, [theses, convByTicker, livePriceFor]);

  const needsReview = useMemo(() => evaluated.filter((e) => e.breaches.length > 0), [evaluated]);

  /* ── Form helpers ───────────────────────────────────────────────────── */
  const resetForm = () => {
    setEditKey(null); setFTicker(''); setFCompany(''); setFThesis(''); setFTriggers([]);
  };
  const openAdd = (ticker?: string, company?: string) => {
    resetForm();
    if (ticker) setFTicker(ticker.toUpperCase());
    if (company) setFCompany(company);
    setShowForm(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openEdit = (e: ThesisEntry) => {
    setEditKey(e.ticker.toUpperCase());
    setFTicker(e.ticker.toUpperCase());
    setFCompany(e.company || '');
    setFThesis(e.thesis);
    setFTriggers(e.triggers.map((t) => ({ ...t })));
    setShowForm(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addTrigger = (kind: TriggerKind) => {
    const p = presetOf(kind);
    setFTriggers((prev) => [
      ...prev,
      { id: newTriggerId(), kind, label: p.hint, threshold: p.defaultThreshold, note: '' },
    ]);
  };
  const updTrigger = (id: string, patch: Partial<ThesisTrigger>) =>
    setFTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const delTrigger = (id: string) =>
    setFTriggers((prev) => prev.filter((t) => t.id !== id));

  const saveForm = () => {
    const ticker = fTicker.trim().toUpperCase();
    if (!ticker || !fThesis.trim()) return;
    // Auto-fill company from universe if blank.
    const uCompany = universe.find((u) => u.ticker === ticker)?.company;
    const now = new Date().toISOString();
    const entry: ThesisEntry = {
      ticker,
      company: fCompany.trim() || uCompany || undefined,
      thesis: fThesis.trim(),
      triggers: fTriggers.map((t) => ({
        ...t,
        threshold: t.threshold === undefined || (t.threshold as any) === '' ? undefined : Number(t.threshold),
      })),
      createdAt: now, // upsert preserves the original if it exists
      updatedAt: now,
    };
    upsertThesis(entry);
    setShowForm(false);
    resetForm();
  };

  const doDelete = (ticker: string) => {
    if (typeof window !== 'undefined' && window.confirm(`Delete thesis for ${ticker}?`)) {
      removeThesis(ticker);
    }
  };

  /* ── Render guards ──────────────────────────────────────────────────── */
  if (!ready) {
    return (
      <div style={{ minHeight: '100%', background: C.bg0, color: C.t2, padding: '40px 28px', fontSize: 13 }}>
        Loading thesis tracker…
      </div>
    );
  }

  const hasTheses = evaluated.length > 0;
  const inFormTickers = new Set(theses.map((t) => t.ticker.toUpperCase()));
  const quickAdd = universe.filter((u) => !inFormTickers.has(u.ticker));

  return (
    <div style={{ minHeight: '100%', background: C.bg0, color: C.t1, padding: '24px 28px', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.t0, letterSpacing: '0.2px' }}>
              Thesis &amp; Sell-Discipline Tracker
            </h1>
            <div style={{ marginTop: 5, fontSize: 12.5, color: C.t3, lineHeight: 1.55, maxWidth: 720 }}>
              Write <b style={{ color: C.t2 }}>why</b> you own each name and the concrete conditions that would
              <b style={{ color: C.t2 }}> break the thesis</b>. Auto-triggers watch your bench fundamentals and live
              price so the sell decision is made in cold blood, before it&apos;s emotional.
            </div>
          </div>
          {!showForm && (
            <button onClick={() => openAdd()} style={btnPrimary}>+ Add thesis</button>
          )}
        </div>

        {/* ── Add / Edit form ──────────────────────────────────────────── */}
        {showForm && (
          <div style={{ ...card, borderColor: C.b2, borderLeft: `3px solid ${C.cyan}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.cyan, letterSpacing: '0.4px' }}>
                {editKey ? `EDIT THESIS · ${editKey}` : 'NEW THESIS'}
              </div>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={btnGhost}>✕ Cancel</button>
            </div>

            {/* Ticker + company */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={lbl}>Ticker</label>
                <input
                  list="thesis-universe" value={fTicker}
                  onChange={(e) => setFTicker(e.target.value.toUpperCase())}
                  disabled={!!editKey}
                  placeholder="e.g. INFY"
                  style={{ ...input, fontFamily: MONO, fontWeight: 700, opacity: editKey ? 0.6 : 1 }}
                />
                <datalist id="thesis-universe">
                  {universe.map((u) => (
                    <option key={u.ticker} value={u.ticker}>{u.company || u.ticker}</option>
                  ))}
                </datalist>
              </div>
              <div style={{ flex: '2 1 260px' }}>
                <label style={lbl}>Company <span style={{ color: C.t4 }}>(optional)</span></label>
                <input value={fCompany} onChange={(e) => setFCompany(e.target.value)} placeholder="Auto-filled from bench if known" style={input} />
              </div>
            </div>

            {/* Thesis text */}
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Investment thesis</label>
              <textarea
                value={fThesis} onChange={(e) => setFThesis(e.target.value)}
                rows={3}
                placeholder="Why do you own this? What has to stay true? e.g. 'Operating leverage on capex just laid down; margins expand as utilisation climbs. Owner-operator, net cash, 20%+ ROCE.'"
                style={{ ...input, resize: 'vertical', lineHeight: 1.55 }}
              />
            </div>

            {/* Triggers */}
            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Invalidation triggers</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {PRESETS.map((p) => (
                  <button key={p.kind} onClick={() => addTrigger(p.kind)}
                    style={{ ...chip, borderColor: mix(p.color, 40), color: p.color, background: mix(p.color, 8) }}>
                    + {p.title}
                  </button>
                ))}
              </div>

              {fTriggers.length === 0 && (
                <div style={{ fontSize: 11.5, color: C.t4, fontStyle: 'italic', padding: '2px 0 6px' }}>
                  No triggers yet. Add at least one — a thesis without an exit condition is a hope, not a plan.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {fTriggers.map((t) => {
                  const p = presetOf(t.kind);
                  return (
                    <div key={t.id} style={{ background: C.bg1, border: `1px solid ${C.b1}`, borderLeft: `2px solid ${p.color}`, borderRadius: 5, padding: '9px 11px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: p.color, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{p.title}</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={() => delTrigger(t.id)} style={{ ...btnGhost, color: C.bear, padding: '2px 7px' }}>Remove</button>
                      </div>
                      <input value={t.label} onChange={(e) => updTrigger(t.id, { label: e.target.value })} style={{ ...input, marginBottom: 6, fontSize: 12 }} />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {p.needsThreshold && (
                          <div style={{ flex: '0 0 160px' }}>
                            <label style={{ ...lbl, fontSize: 9.5 }}>{p.thresholdLabel}</label>
                            <input
                              type="number" step="any"
                              value={t.threshold ?? ''}
                              onChange={(e) => updTrigger(t.id, { threshold: e.target.value === '' ? undefined : Number(e.target.value) })}
                              placeholder={p.defaultThreshold != null ? String(p.defaultThreshold) : ''}
                              style={{ ...input, fontFamily: MONO }}
                            />
                          </div>
                        )}
                        <div style={{ flex: '1 1 200px' }}>
                          <label style={{ ...lbl, fontSize: 9.5 }}>Note {t.kind === 'custom' ? '(shown as the reminder)' : '(optional)'}</label>
                          <input value={t.note || ''} onChange={(e) => updTrigger(t.id, { note: e.target.value })} style={{ ...input, fontSize: 12 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={saveForm} disabled={!fTicker.trim() || !fThesis.trim()}
                style={{ ...btnPrimary, opacity: (!fTicker.trim() || !fThesis.trim()) ? 0.45 : 1, cursor: (!fTicker.trim() || !fThesis.trim()) ? 'not-allowed' : 'pointer' }}>
                {editKey ? 'Save changes' : 'Save thesis'}
              </button>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={btnSecondary}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Review-needed banner ─────────────────────────────────────── */}
        {hasTheses && (
          needsReview.length > 0 ? (
            <div style={{ ...card, borderColor: mix(C.bear, 45), background: mix(C.bear, 6), borderLeft: `3px solid ${C.bear}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 15 }}>⚠</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.bear, letterSpacing: '0.4px' }}>
                  THESIS REVIEW NEEDED
                </span>
                <span style={{ fontSize: 11, color: C.t3 }}>
                  {needsReview.length} name{needsReview.length > 1 ? 's' : ''} with a breached trigger — this is your sell-discipline signal
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {needsReview.map(({ entry, breaches }) => (
                  <div key={entry.ticker} style={{ background: C.bg1, border: `1px solid ${mix(C.bear, 30)}`, borderRadius: 5, padding: '9px 11px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13, color: C.t0 }}>{entry.ticker}</span>
                      {entry.company && <span style={{ fontSize: 11.5, color: C.t3 }}>{entry.company}</span>}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => openEdit(entry)} style={{ ...btnGhost, color: C.cyan }}>Review →</button>
                    </div>
                    <ul style={{ margin: '6px 0 0', padding: '0 0 0 2px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {breaches.map(({ trigger, ev }) => (
                        <li key={trigger.id} style={{ fontSize: 11.5, color: C.t2, display: 'flex', gap: 6 }}>
                          <span style={{ color: C.bear, fontWeight: 800 }}>⚠</span>
                          <span><b style={{ color: C.bear }}>{presetOf(trigger.kind).title}:</b> {ev.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ ...card, borderColor: mix(C.bull, 40), background: mix(C.bull, 5), borderLeft: `3px solid ${C.bull}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, color: C.bull }}>✓</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.bull, letterSpacing: '0.4px' }}>All theses intact</div>
                <div style={{ fontSize: 11.5, color: C.t3, marginTop: 2 }}>
                  No auto-trigger has breached across {evaluated.length} thesis{evaluated.length > 1 ? 'es' : ''}. Hold with conviction.
                </div>
              </div>
            </div>
          )
        )}

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {!hasTheses && !showForm && (
          <div style={{ ...card, borderStyle: 'dashed', borderColor: C.b2, textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>🧭</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.t0, marginBottom: 6 }}>Start your first thesis</div>
            <div style={{ fontSize: 12.5, color: C.t3, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 16px' }}>
              For every position, write the reason you own it and the exact conditions that would prove you wrong —
              margin erosion, cash-conversion collapse, growth reversal, a price stop. The tracker then flags any name
              whose triggers have breached, so you sell on evidence, not on a bad day.
            </div>
            {quickAdd.length > 0 ? (
              <>
                <div style={{ fontSize: 10.5, color: C.t4, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Quick-add from your holdings &amp; bench
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 }}>
                  {quickAdd.slice(0, 24).map((u) => (
                    <button key={u.ticker} onClick={() => openAdd(u.ticker, u.company)}
                      style={{ ...chip, borderColor: C.b2, color: C.t1, background: C.bg1 }}
                      title={u.owned ? 'You own this' : 'On your conviction bench'}>
                      <span style={{ fontFamily: MONO, fontWeight: 700 }}>{u.ticker}</span>
                      <span style={{ marginLeft: 5, color: u.owned ? C.bull : C.persistent, fontSize: 9 }}>
                        {u.owned ? '● owned' : '○ bench'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: C.t4, marginBottom: 16 }}>
                No holdings or bench names found yet — you can still type any ticker.
              </div>
            )}
            <button onClick={() => openAdd()} style={btnPrimary}>+ Add thesis</button>
          </div>
        )}

        {/* ── Thesis cards ─────────────────────────────────────────────── */}
        {hasTheses && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, color: C.t4, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>
              All theses ({evaluated.length})
            </div>
            {evaluated.map(({ entry, evals, breaches, reviewDue }) => {
              const u = universe.find((x) => x.ticker === entry.ticker.toUpperCase());
              const px = livePriceFor(entry.ticker);
              return (
                <div key={entry.ticker} style={{ ...card, borderColor: breaches.length > 0 ? mix(C.bear, 40) : C.b1 }}>
                  {/* card header */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 15, color: C.t0 }}>{entry.ticker}</span>
                    {entry.company && <span style={{ fontSize: 12.5, color: C.t2 }}>{entry.company}</span>}
                    {u?.owned && <span style={pill(C.bull)}>OWNED</span>}
                    {u?.benched && <span style={pill(C.persistent)}>BENCH</span>}
                    {px != null && <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3 }}>₹{px.toLocaleString()}</span>}
                    {reviewDue && <span style={pill(C.warn)}>⟳ ANNUAL REVIEW DUE</span>}
                    <span style={{ flex: 1 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => markReviewed(entry.ticker)} style={{ ...btnGhost, color: C.bull }}>✓ Mark reviewed</button>
                      <button onClick={() => openEdit(entry)} style={{ ...btnGhost, color: C.cyan }}>Edit</button>
                      <button onClick={() => doDelete(entry.ticker)} style={{ ...btnGhost, color: C.bear }}>Delete</button>
                    </div>
                  </div>

                  {/* thesis text */}
                  <div style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                    {entry.thesis}
                  </div>

                  {/* triggers */}
                  {evals.length === 0 ? (
                    <div style={{ fontSize: 11, color: C.t4, fontStyle: 'italic' }}>
                      No triggers set — add invalidation conditions so this thesis can be tested.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {evals.map(({ trigger, ev }) => {
                        const col = statusColor(ev.status);
                        return (
                          <div key={trigger.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.bg1, border: `1px solid ${C.b1}`, borderLeft: `2px solid ${col}`, borderRadius: 4, padding: '7px 10px' }}>
                            <span style={{ color: col, fontWeight: 800, fontSize: 12, minWidth: 14, textAlign: 'center' }}>{statusIcon(ev.status)}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11.5, color: C.t1 }}>
                                <span style={{ fontWeight: 700, color: col, marginRight: 6, fontSize: 9.5, letterSpacing: '0.5px' }}>{statusWord(ev.status)}</span>
                                {trigger.label}
                              </div>
                              <div style={{ fontSize: 10.5, color: C.t3, marginTop: 2, fontFamily: MONO }}>{ev.reason}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* footer meta */}
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.b1}`, fontSize: 10, color: C.t4, fontFamily: MONO }}>
                    <span>created {fmtDate(entry.createdAt)}</span>
                    <span>updated {fmtDate(entry.updatedAt)}</span>
                    <span>last reviewed {fmtDate(entry.reviewedAt || entry.createdAt)}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: breaches.length > 0 ? C.bear : C.t4 }}>
                      {breaches.length > 0 ? `${breaches.length} breached` : `${evals.length} trigger${evals.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

/* ── Shared inline style objects (token vars only) ───────────────────────── */
const card: React.CSSProperties = {
  background: C.bg2, border: `1px solid ${C.b1}`, borderRadius: 8, padding: '16px 18px',
};
const btnPrimary: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, padding: '8px 16px', background: C.cyan, color: C.bg0,
  border: 'none', borderRadius: 5, cursor: 'pointer', letterSpacing: '0.3px', whiteSpace: 'nowrap',
};
const btnSecondary: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '8px 14px', background: 'transparent', color: C.t2,
  border: `1px solid ${C.b2}`, borderRadius: 5, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, padding: '3px 9px', background: 'transparent', color: C.t3,
  border: `1px solid ${C.b1}`, borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
};
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 20, border: `1px solid ${C.b2}`,
  background: C.bg1, cursor: 'pointer', whiteSpace: 'nowrap',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '8px 10px', background: C.bg0,
  color: C.t1, border: `1px solid ${C.b2}`, borderRadius: 5, outline: 'none',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, color: C.t3, textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: 4,
};
const pill = (tok: string): React.CSSProperties => ({
  fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 3, letterSpacing: '0.5px',
  color: tok, background: mix(tok, 12), border: `1px solid ${mix(tok, 35)}`,
});
