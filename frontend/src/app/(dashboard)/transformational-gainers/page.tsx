'use client';
// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATIONAL GAINERS (zzz1166). The events from AI Daily Gainers (India + USA) that can change a company's future
// earnings — orders, capacity, approvals, new business, strategic deals, raised guidance, earnings inflections — kept for
// 60 days, grouped by theme, with the themes and companies that are NEW this week and a multibagger-chance read (rules,
// plus an AI second opinion on request). Filled automatically from the daily research; no AI runs on page load.
// ═══════════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import NavLink from '@/components/NavLink';
import { R, tint } from '@/components/special-situations/radar-tokens';
import { MbChip, MB_COLOR } from '@/components/transformational/MbChip';
import { MB_NAME, MB_WORD, ONE_PAGE_CASE, OTHER_THEME, chanceOf, tgKindWord, type MbLabel, type TgBoard, type TgItem, type TgStrength } from '@/lib/transformational/core';

type Mkt = 'ALL' | 'IN' | 'US';
const STRENGTH_COLOR: Record<TgStrength, string> = { TRANSFORMATIONAL: R.green, INFLECTION: R.cyan, NOTABLE: R.amber };
const STRENGTH_WORD: Record<TgStrength, string> = { TRANSFORMATIONAL: 'Transformational', INFLECTION: 'Inflection', NOTABLE: 'Notable' };
const FILTER_KEY = 'mc:transformational:filters:v2';

const fmtCap = (x: TgItem) => (x.marketCap == null ? 'size n/a' : x.market === 'IN' ? `₹${Math.round(x.marketCap).toLocaleString('en-IN')} Cr` : x.marketCap >= 1000 ? `$${(x.marketCap / 1000).toFixed(1)}B` : `$${Math.round(x.marketCap)}M`);
const isSmallMid = (x: TgItem) => x.marketCap != null && (x.market === 'IN' ? x.marketCap < 25_000 : x.marketCap < 10_000);
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

interface Group { key: string; market: 'IN' | 'US'; ticker: string; company: string; items: TgItem[]; best: TgItem }

export default function TransformationalGainersPage() {
  const [data, setData] = useState<TgBoard | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [mkt, setMkt] = useState<Mkt>('ALL');
  const [days, setDays] = useState(60);
  const [theme, setTheme] = useState<string | null>(null);
  const [mbMin, setMbMin] = useState<MbLabel | null>(null);
  const [strength, setStrength] = useState<TgStrength | null>(null);
  const [smallMid, setSmallMid] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [chainMin, setChainMin] = useState<number | null>(null);   // zzz1190 — evidence chain: stages met at least
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'chance'>('chance');
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); if (s) { setMkt(s.mkt || 'ALL'); setSmallMid(s.smallMid !== false); setSort(s.sort === 'newest' ? 'newest' : 'chance'); } } catch { /* defaults */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ mkt, smallMid, sort })); } catch { /* optional */ } }, [mkt, smallMid, sort]);

  const load = useCallback(async () => {
    setState('loading'); setErr(null);
    try {
      const r = await fetch(`/api/v1/transformational?days=${days}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j); setState('ok');
    } catch (e: any) { setErr(String(e?.message || e)); setState('error'); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  // zzz1167 — no browser backfill: 30 research views built back to back held the whole server for minutes (every page slow).
  // The daily job fills the board from the stored sessions, spaced out (lib/app-scheduler transformational-archive).
  const filling: string | null = null;

  const newSet = useMemo(() => new Set(data?.newCompanies || []), [data]);
  const rank: Record<MbLabel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNLIKELY: 0 };
  const filtered = useMemo(() => (data?.items || []).filter((x) =>
    (mkt === 'ALL' || x.market === mkt) && (!theme || x.theme === theme) && (!strength || x.strength === strength)
    && (!mbMin || rank[chanceOf(x).label] >= rank[mbMin])
    && (!smallMid || isSmallMid(x) || x.marketCap == null) && (!onlyNew || newSet.has(`${x.market}:${x.ticker}`))
    && (chainMin == null || ((x.chain?.met ?? 0) >= chainMin && (chainMin < 5 || (x.chain?.missing ?? 1) === 0) && (x.chain?.missing ?? 0) <= (chainMin >= 4 ? 0 : 1)))
    && (!q || `${x.ticker} ${x.company} ${x.headline} ${x.theme}`.toLowerCase().includes(q.toLowerCase()))), [data, mkt, theme, strength, mbMin, smallMid, onlyNew, chainMin, q, newSet]);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const x of filtered) {
      const k = `${x.market}:${x.ticker}`;
      const g = m.get(k) || { key: k, market: x.market, ticker: x.ticker, company: x.company, items: [], best: x };
      g.items.push(x);
      if (chanceOf(x).score > chanceOf(g.best).score) g.best = x;
      m.set(k, g);
    }
    const arr = [...m.values()];
    for (const g of arr) g.items.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    return sort === 'chance'
      // zzz1169 — one ranking: the rules read blended with the AI read when there is one (an AI-read 8% no longer ranks above
      // an unread HIGH)
      ? arr.sort((a, b) => chanceOf(b.best).score - chanceOf(a.best).score || b.items[0].sessionDate.localeCompare(a.items[0].sessionDate))
      : arr.sort((a, b) => b.items[0].sessionDate.localeCompare(a.items[0].sessionDate) || chanceOf(b.best).score - chanceOf(a.best).score);
  }, [filtered, sort]);

  const themes = useMemo(() => (data?.themes || []).filter((t) => mkt === 'ALL' || (data?.items || []).some((x) => x.theme === t.theme && x.market === mkt)), [data, mkt]);

  const askAi = useCallback(async (ids: string[] | null, label: string) => {
    setAiBusy(label); setAiNote(null);
    try {
      const r = await fetch('/api/v1/transformational/ai', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : { auto: true, market: mkt === 'ALL' ? undefined : mkt, sinceDays: days }) });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const got = new Map<string, any>((j.results || []).map((x: any) => [x.id, x.ai]));
      setData((d) => (d ? { ...d, items: d.items.map((x) => (got.has(x.id) ? { ...x, ai: got.get(x.id) } : x)) } : d));
      setAiNote(j.note || (j.read ? `AI read ${j.read} event${j.read === 1 ? '' : 's'}${j.failed?.length ? ` · ${j.failed.length} not answered (AI busy or out of credit)` : ''}.` : 'Nothing new for the AI to read — every event shown already has an AI read.'));
    } catch (e: any) { setAiNote(`AI read failed: ${String(e?.message || e)}`); }
    setAiBusy(null);
  }, [mkt, days]);

  const chip = (on: boolean, c: string = R.cyan): React.CSSProperties => ({ cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? c : R.border}`, color: on ? c : R.dim, background: on ? tint(c, 12) : 'transparent' });

  const kpi = useMemo(() => {
    const cos = groups.length;
    const trans = groups.filter((g) => g.items.some((x) => x.strength === 'TRANSFORMATIONAL')).length;
    const high = groups.filter((g) => chanceOf(g.best).label === 'HIGH').length;
    const fresh = groups.filter((g) => newSet.has(g.key)).length;
    const newThemes = themes.filter((t) => t.isNew).length;
    const aiCos = groups.filter((g) => g.items.some((x) => x.ai)).length;
    return { cos, trans, high, fresh, themes: themes.length, newThemes, aiCos };
  }, [groups, newSet, themes]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const shortHistory = data ? new Date(Date.parse(`${data.to}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10) : '';
  const collecting = !!(data?.historyFrom && data.historyFrom > data.from);
  const maxThemeCos = Math.max(1, ...themes.map((t) => t.companies));
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: R.faint, margin: '0 0 6px' };

  return (
    <div className="tg-page" style={{ padding: '14px 20px 28px', color: R.text, width: '100%', boxSizing: 'border-box' }}>
      <style>{`
        .tg-grid{display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;align-items:start}
        .tg-side{position:sticky;top:8px;display:flex;flex-direction:column;gap:12px}
        .tg-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:10px 0 14px}
        .tg-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
        .tg-table th{position:sticky;top:0;background:var(--mc-bg-1);text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--mc-text-3);padding:8px 10px;border-bottom:2px solid var(--mc-bg-4);white-space:nowrap}
        .tg-table td{padding:9px 10px;border-bottom:1px solid var(--mc-bg-4);vertical-align:top}
        .tg-row{cursor:pointer}
        .tg-row:hover td{background:color-mix(in srgb, var(--mc-cyan) 6%, transparent)}
        .tg-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        @media (max-width:1100px){.tg-grid{grid-template-columns:1fr}.tg-side{position:static}.tg-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media (max-width:640px){.tg-hide-sm{display:none}.tg-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: 0.2 }}>🧬 Transformational Gainers</h1>
          <div style={{ fontSize: 13, color: R.dim, marginTop: 2 }}>Events from AI Daily Gainers that can change future earnings · India + USA · rolling {days} days</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={!!aiBusy} onClick={() => askAi(null, 'auto')} style={{ ...chip(true, R.violet), padding: '7px 14px', fontSize: 13, opacity: aiBusy ? 0.6 : 1 }}
            title="The AI reads the strongest events that have no AI read yet (up to 12 at a time, 60 a day; each event is read once).">
            {aiBusy === 'auto' ? '🤖 Reading…' : '🤖 AI multibagger read · top events'}
          </button>
          <NavLink href="/ai-gainers" style={{ fontSize: 13, color: R.cyan, fontWeight: 700 }}>AI Daily Gainers →</NavLink>
        </div>
      </div>
      {aiNote && <div style={{ fontSize: 12, color: R.dim, marginTop: 6 }}>{aiNote}</div>}
      {data && (() => {   // zzz1188 — when today's gainers arrive here
        const latest = (m: string) => (data.items || []).filter((x: any) => x.market === m).map((x: any) => x.sessionDate).sort().pop() || '—';
        return <div style={{ fontSize: 12, color: R.dim, marginTop: 6 }}>Latest session on the board: 🇮🇳 {latest('IN')} · 🇺🇸 {latest('US')}. Today's gainers arrive after their AI research: India after the 16:20 IST sweep (board updated ≈17:55, 19:15 and 22:55 IST), the US after the 17:30 ET sweep — or at once when you run the AI sweep on AI Daily Gainers.</div>;
      })()}
      {collecting && data && <div style={{ fontSize: 12, color: R.amber, marginTop: 6, fontWeight: 700 }}>⏳ Collecting history: available since {data.historyFrom} — the {days}-day window fills one session a day (complete about {new Date(Date.parse(`${data.historyFrom}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)}).</div>}
      {filling && <div style={{ fontSize: 12, color: R.cyan, marginTop: 6 }}>{filling}</div>}

      {/* zzz1171 — India / USA tabs at the top (also in the side panel), with company counts */}
      {data && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(['ALL', 'IN', 'US'] as Mkt[]).map((m) => {
            const n = new Set((data.items || []).filter((x) => m === 'ALL' || x.market === m).map((x) => `${x.market}:${x.ticker}`)).size;
            const on = mkt === m;
            return (
              <button key={m} type="button" onClick={() => setMkt(m)}
                style={{ cursor: 'pointer', fontSize: 14, fontWeight: 800, padding: '8px 16px', borderRadius: 8, border: `1px solid ${on ? R.cyan : R.border}`, color: on ? R.cyan : R.text, background: on ? tint(R.cyan, 12) : R.bg }}>
                {m === 'ALL' ? '🌐 India + USA' : m === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'} <span style={{ color: R.faint, fontWeight: 700 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* KPI strip */}
      <div className="tg-kpis">
        {[
          { k: 'Companies', v: kpi.cos, c: R.text, sub: `${filtered.length} events · click: clear filters`, on: false,
            click: () => { setTheme(null); setStrength(null); setMbMin(null); setOnlyNew(false); setQ(''); setMkt('ALL'); } },
          { k: 'Transformational', v: kpi.trans, c: R.green, sub: 'lasting change to earnings', on: strength === 'TRANSFORMATIONAL', click: () => setStrength((v) => (v === 'TRANSFORMATIONAL' ? null : 'TRANSFORMATIONAL')) },
          { k: `High ${MB_NAME.toLowerCase()}`, v: kpi.high, c: R.green, sub: `rules + AI · AI reviewed ${kpi.aiCos} of ${kpi.cos}`, on: mbMin === 'HIGH', click: () => setMbMin((v) => (v === 'HIGH' ? null : 'HIGH')) },
          { k: 'New this week', v: kpi.fresh, c: R.violet, sub: data?.historyFrom && data.historyFrom > shortHistory ? `history only since ${data.historyFrom} — 'new' settles after 2 weeks` : 'first seen in 7 days', on: onlyNew, click: () => setOnlyNew((v) => !v) },
          { k: 'Themes', v: kpi.themes, c: R.cyan, sub: theme ? `showing: ${theme === OTHER_THEME ? 'Other' : theme} · click: all` : `${kpi.newThemes} new this week · pick one on the left`, on: !!theme, click: () => setTheme(null) },
          { k: 'Window', v: `${days}d`, c: R.text, sub: `${data ? `${data.from} → ${data.to}` : ''} · click: change`, on: days !== 60, click: () => setDays((d) => ({ 60: 30, 30: 14, 14: 7, 7: 60 } as Record<number, number>)[d] || 60) },
        ].map((t) => (
          <button type="button" key={t.k} onClick={t.click} style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', border: `1px solid ${t.on ? t.c : R.border}`, boxShadow: t.on ? `0 0 0 1px ${t.c}` : 'none', borderRadius: 10, padding: '10px 12px', background: t.on ? tint(t.c === R.text ? R.cyan : t.c, 8) : R.bg }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: R.faint }}>{t.k}{t.on ? ' ✓' : ''}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: t.c, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{t.v}</div>
            <div style={{ fontSize: 11, color: R.dim }}>{t.sub}</div>
          </button>
        ))}
      </div>

      {state === 'loading' && <div style={{ color: R.dim, fontSize: 13 }}>Loading…</div>}
      {state === 'error' && <div style={{ color: R.red, fontSize: 13 }}>Could not load: {err} <button type="button" style={chip(false)} onClick={load}>Retry</button></div>}

      {state === 'ok' && data && (
        <div className="tg-grid">
          {/* side: filters + themes */}
          <aside className="tg-side">
            <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, padding: 12, background: R.bg, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, ticker, theme…" style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: `1px solid ${R.border}`, background: R.bg2, color: R.text, width: '100%', boxSizing: 'border-box' }} />
              <div><div style={sectionTitle}>Market</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['ALL', 'IN', 'US'] as Mkt[]).map((m) => <button key={m} type="button" style={chip(mkt === m)} onClick={() => setMkt(m)}>{m === 'ALL' ? 'All' : m === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}</button>)}
              </div></div>
              <div><div style={sectionTitle}>Period</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[60, 30, 14, 7].map((d) => <button key={d} type="button" style={chip(days === d)} onClick={() => setDays(d)}>{d}d</button>)}
              </div></div>
              <div><div style={sectionTitle}>Show</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={chip(smallMid, R.green)} onClick={() => setSmallMid((v) => !v)} title="India under ₹25,000 Cr, USA under $10B">Small & mid only</button>
                <button type="button" style={chip(onlyNew, R.violet)} onClick={() => setOnlyNew((v) => !v)}>🆕 New this week</button>
              </div></div>
              <div><div style={sectionTitle}>Strength</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['TRANSFORMATIONAL', 'INFLECTION', 'NOTABLE'] as TgStrength[]).map((x) => <button key={x} type="button" style={chip(strength === x, STRENGTH_COLOR[x])} onClick={() => setStrength((v) => (v === x ? null : x))}>{STRENGTH_WORD[x]}</button>)}
              </div></div>
              <div><div style={sectionTitle}>{MB_NAME} at least</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['HIGH', 'MEDIUM', 'LOW'] as MbLabel[]).map((x) => <button key={x} type="button" style={chip(mbMin === x, MB_COLOR[x])} onClick={() => setMbMin((v) => (v === x ? null : x))}>{MB_WORD[x]}</button>)}
              </div></div>
              <div><div style={sectionTitle} title="Your research chain: advantage (a named, filed event) → material (big enough for earnings) → timing (the change starts now) → per share (no dilution, cash backs profit, debt) → price room (P/E, 3-month run). Milestones and invalidation are yours to write.">Evidence chain</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[5, 4, 3].map((n) => <button key={n} type="button" style={chip(chainMin === n, n === 5 ? R.green : n === 4 ? R.cyan : R.amber)} onClick={() => setChainMin((v) => (v === n ? null : n))} title={n === 5 ? 'all 5 stages met' : n === 4 ? `at least ${n} met, none failing` : `at least ${n} met, at most one failing`}>{n === 5 ? 'All 5 ✓' : `${n}+ ✓`}</button>)}
              </div><div style={{ fontSize: 11, color: R.faint, marginTop: 4 }}>{data?.items ? `${data.items.filter((x) => (x.chain?.met ?? 0) >= 4 && (x.chain?.missing ?? 1) === 0).length} events with 4+ met and none failing` : ''}</div></div>
              <div><div style={sectionTitle}>Sort</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={chip(sort === 'newest')} onClick={() => setSort('newest')}>Newest</button>
                <button type="button" style={chip(sort === 'chance')} onClick={() => setSort('chance')}>{MB_NAME}</button>
              </div></div>
            </div>
            <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, padding: 12, background: R.bg }}>
              <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between' }}><span>Themes</span>{theme && <button type="button" onClick={() => setTheme(null)} style={{ fontSize: 11, color: R.cyan, background: 'none', border: 'none', cursor: 'pointer' }}>clear ✕</button>}</div>
              {themes.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>No themes yet.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {themes.map((t) => {
                  const c = t.isNew ? R.violet : t.structural ? R.green : R.cyan;
                  return (
                    <button key={t.theme} type="button" onClick={() => setTheme((v) => (v === t.theme ? null : t.theme))}
                      title={`${t.companies} companies, ${t.events} events · first ${t.firstSeen} · latest ${t.lastSeen} · ${t.tickers.slice(0, 12).join(', ')}`}
                      style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${theme === t.theme ? c : 'transparent'}`, background: theme === t.theme ? tint(c, 10) : 'transparent', borderRadius: 6, padding: '4px 6px', color: R.text }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, fontWeight: 700 }}>
                        <span>{t.isNew ? '🆕 ' : ''}{t.structural ? '★ ' : ''}{t.theme === OTHER_THEME ? 'Other' : t.theme}</span>
                        <span style={{ color: R.faint, fontVariantNumeric: 'tabular-nums' }}>{t.companies}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: tint(c, 18), marginTop: 3 }}><div style={{ height: 4, borderRadius: 2, width: `${Math.round((t.companies / maxThemeCos) * 100)}%`, background: c }} /></div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: R.faint, marginTop: 8 }}>★ structural theme · 🆕 first seen this week</div>
            </div>
          </aside>

          {/* results */}
          <section style={{ minWidth: 0 }}>
            {groups.length === 0 ? (
              <div style={{ fontSize: 13, color: R.dim, padding: 16, border: `1px dashed ${R.border}`, borderRadius: 10 }}>
                No events match these filters.{data.items.length === 0 ? ' The board fills from each day’s gainers research and grows by one session a day until it holds 60 days.' : ''}
              </div>
            ) : (
              <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, overflow: 'hidden', background: R.bg }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tg-table">
                    <thead><tr>
                      <th>Company</th><th className="tg-hide-sm">Theme</th><th>What changed</th><th className="tg-hide-sm">Growth (latest quarter)</th><th>{MB_NAME}</th><th className="tg-hide-sm">Move</th><th className="tg-hide-sm">Session</th>
                    </tr></thead>
                    <tbody>
                      {groups.map((g) => {
                        const x = g.best; const f = x.facts; const open = openKey === g.key;
                        const dm = f.marginNow != null && f.marginPrior != null ? f.marginNow - f.marginPrior : null;
                        return (
                          <Fragment key={g.key}>
                            <tr className="tg-row" onClick={() => setOpenKey(open ? null : g.key)} style={{ boxShadow: `inset 3px 0 0 ${STRENGTH_COLOR[x.strength]}` }}>
                              <td style={{ minWidth: 170 }}>
                                <div style={{ fontWeight: 900, fontSize: 14 }}>{g.ticker} {newSet.has(g.key) && <span style={{ fontSize: 10, fontWeight: 800, color: R.violet, border: `1px solid ${R.violet}`, borderRadius: 999, padding: '0 5px', marginLeft: 4 }}>NEW</span>}</div>
                                <div style={{ fontSize: 12, color: R.dim }}>{g.market === 'IN' ? '🇮🇳' : '🇺🇸'} {g.company}</div>
                                <div style={{ fontSize: 11, color: R.faint }}>{fmtCap(x)}</div>
                              </td>
                              <td className="tg-hide-sm" style={{ minWidth: 140 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: R.cyan }}>{x.theme === OTHER_THEME ? 'Other' : x.theme}</span>
                                <div style={{ fontSize: 11, fontWeight: 800, color: STRENGTH_COLOR[x.strength], marginTop: 3 }}>{STRENGTH_WORD[x.strength]}</div>
                              </td>
                              <td style={{ minWidth: 260 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: R.faint, textTransform: 'uppercase', letterSpacing: 0.4 }}>{tgKindWord(x.kind)}{g.items.length > 1 ? ` · ${g.items.length} events` : ''}</div>
                                <div className="tg-clamp" style={{ fontWeight: 700, lineHeight: 1.4 }}>{x.headline}</div>
                                <div className="tg-clamp" style={{ fontSize: 12, color: R.dim, marginTop: 2 }}>{x.signals.slice(0, 3).join(' · ')}</div>
                                {x.orderToRevenuePct != null && <div style={{ fontSize: 12, fontWeight: 700, color: x.orderToRevenuePct >= 25 ? R.green : R.dim, marginTop: 2 }}>Order ≈ {x.orderToRevenuePct}% of a year’s revenue</div>}
                                {x.chain && <ChainChips chain={x.chain} />}
                              </td>
                              <td className="tg-hide-sm" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                                <div>Sales <b style={{ color: (f.revenueYoY ?? 0) >= 25 ? R.green : R.text }}>{pct(f.revenueYoY)}</b></div>
                                <div>Profit <b style={{ color: (f.patYoY ?? 0) >= 40 ? R.green : R.text }}>{pct(f.patYoY)}</b></div>
                                {dm != null && <div>Margin <b style={{ color: dm >= 3 ? R.green : R.text }}>{`${dm >= 0 ? '+' : ''}${dm.toFixed(1)}pt`}</b></div>}
                                {x.factsNote && <div style={{ fontSize: 11, color: R.amber }}>{x.factsNote}</div>}
                                <div style={{ fontSize: 11, color: R.faint }}>{x.factsSource === 'screener' ? `stock screener${x.factsPeriod ? ` · ${x.factsPeriod}` : ''} · profit = EPS growth` : x.factsSource === 'filing' ? 'from the results filing' : 'no results figures yet'}</div>
                              </td>
                              <td style={{ minWidth: 190 }} onClick={(e) => e.stopPropagation()}><MbChip mb={x.mb} ai={x.ai} compact /></td>
                              <td className="tg-hide-sm" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                                <div style={{ color: (x.movePct ?? 0) >= 0 ? R.green : R.red, fontWeight: 800 }}>{pct(x.movePct)} <span style={{ color: R.faint, fontWeight: 400 }}>{x.moveWindow}</span></div>
                                <div style={{ color: R.faint }}>3M {pct(x.returns.m3)}</div>
                              </td>
                              <td className="tg-hide-sm" style={{ whiteSpace: 'nowrap', fontSize: 12, color: R.dim }}>{g.items[0].sessionDate}<div style={{ color: R.faint }}>{open ? '▲ less' : '▼ more'}</div></td>
                            </tr>
                            {open && (
                              <tr><td colSpan={7} style={{ background: R.bg2, padding: '10px 14px' }}>
                                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginBottom: 6 }}>
                                  <NavLink href={`/charts?m=${g.market}&t=${encodeURIComponent(g.ticker)}`} style={{ color: R.cyan, fontWeight: 700 }}>Open chart →</NavLink>
                                  <NavLink href={`/ai-gainers?market=${g.market}`} style={{ color: R.cyan, fontWeight: 700 }}>AI Daily Gainers →</NavLink>
                                  {x.themeWhy && <span style={{ color: R.faint }}>Theme from {x.themeWhy}</span>}
                                </div>
                                <details style={{ fontSize: 12.5, marginBottom: 6 }}>
                                  <summary style={{ cursor: 'pointer', color: R.cyan, fontWeight: 700 }}>📄 One-page investment case — answer before buying</summary>
                                  <ol style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.55 }}>{ONE_PAGE_CASE.map((q) => <li key={q}>{q}</li>)}</ol>
                                  <div style={{ color: R.faint, marginTop: 2 }}>Record the trigger, expected earnings effect, valuation range, position size and what would invalidate the case — so the decision can be checked honestly later.</div>
                                </details>
                                {g.items.map((it) => (
                                  <div key={it.id} style={{ padding: '8px 0', borderTop: `1px dashed ${R.border}` }}>
                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12, color: R.faint }}>
                                      <b style={{ color: R.text }}>{tgKindWord(it.kind)}</b>
                                      <span>session {it.sessionDate}{it.eventDate && it.eventDate !== it.sessionDate ? ` · filed ${it.eventDate}` : ''}</span>
                                      <span style={{ color: it.evidence === 'official' ? R.green : R.amber }}>{it.evidence === 'official' ? '✓ company filing' : '⚠ press only — verify'}</span>
                                      {it.durationYears && <span style={{ color: R.green }}>multi-year runway</span>}
                                      {it.materiality && <span>materiality {String(it.materiality).toLowerCase()}</span>}
                                      {it.sourceUrl && /^https?:\/\//.test(it.sourceUrl) && <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>source ↗</a>}
                                      {!it.ai && <button type="button" disabled={!!aiBusy} onClick={() => askAi([it.id], it.id)} style={{ ...chip(false, R.violet), padding: '1px 8px', fontSize: 11 }}>{aiBusy === it.id ? '🤖 reading…' : '🤖 Ask AI'}</button>}
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{it.headline}</div>
                                    {it.whatChanged && it.whatChanged !== it.headline && <div style={{ fontSize: 13, color: R.dim, marginTop: 2, lineHeight: 1.45 }}>{it.whatChanged}</div>}
                                    {it.signals.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                                      {it.signals.map((sg) => <span key={sg} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: tint(R.green, 8), border: `1px solid ${R.border}` }}>{sg}</span>)}
                                    </div>}
                                    {it.quote && <div style={{ fontSize: 12, color: R.faint, marginTop: 5, fontStyle: 'italic', lineHeight: 1.45 }}>“{it.quote}”</div>}
                                    <div style={{ marginTop: 6 }}><MbChip mb={it.mb} ai={it.ai} /></div>
                                    {(it.research || []).length > 0 && (
                                      <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5 }}>
                                        <b style={{ color: R.amber }}>🔎 Research before concluding:</b>
                                        <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{(it.research || []).map((q) => <li key={q}>{q}</li>)}</ul>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {data.needsCheck?.length > 0 && (
              <div style={{ marginTop: 12, border: `1px solid ${R.border}`, borderRadius: 10, background: R.bg, padding: '10px 12px' }}>
                <button type="button" onClick={() => setShowCheck((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: R.amber, fontWeight: 800, fontSize: 13, padding: 0 }}>
                  {showCheck ? '▲' : '▼'} Needs verification ({data.needsCheck.length}) — the shown text does not back the label, so these are not ranked
                </button>
                {showCheck && <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.needsCheck.filter((x) => mkt === 'ALL' || x.market === mkt).map((x) => (
                    <div key={x.id} style={{ fontSize: 12, borderTop: `1px dashed ${R.border}`, paddingTop: 6 }}>
                      <b>{x.ticker}</b> <span style={{ color: R.dim }}>{x.market === 'IN' ? '🇮🇳' : '🇺🇸'} {x.company} · labelled {tgKindWord(x.kind)} · {x.sessionDate}</span>
                      <div style={{ color: R.amber }}>⚠ {x.needsCheck}</div>
                      <div style={{ color: R.dim }} className="tg-clamp">{x.headline}</div>
                      {x.sourceUrl && /^https?:\/\//.test(x.sourceUrl) && <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>open the filing ↗</a>}
                    </div>
                  ))}
                </div>}
              </div>
            )}
            <p style={{ fontSize: 11, color: R.faint, marginTop: 10 }}>Company data only. Not investment advice. Price is context, never the reason an event is listed. {MB_NAME} is a research priority from the filed facts — not a tested probability.</p>
          </section>
        </div>
      )}
    </div>
  );
}

// zzz1190 — the owner's evidence chain, one chip per stage (✓ met · ? not known · ✗ failing); hover for why
function ChainChips({ chain }: { chain: NonNullable<TgItem['chain']> }) {
  const col = { met: R.green, unknown: R.faint, missing: R.red } as const;
  const sym = { met: '✓', unknown: '?', missing: '✗' } as const;
  const lead = chain.met === 5 ? R.green : chain.met >= 4 && chain.missing === 0 ? R.cyan : chain.missing >= 2 ? R.red : R.amber;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 900, color: lead, border: `1px solid ${lead}`, borderRadius: 6, padding: '1px 6px' }} title="Your evidence chain: stages met of 5. Milestones and invalidation are yours to write.">Chain {chain.met}/5</span>
      {chain.stages.map((s) => <span key={s.id} title={`${s.name}: ${s.why}`} style={{ fontSize: 10.5, fontWeight: 700, color: col[s.state], border: `1px solid ${tint(col[s.state], 40)}`, borderRadius: 999, padding: '0 6px', whiteSpace: 'nowrap' }}>{sym[s.state]} {s.name}</span>)}
    </div>
  );
}
