'use client';
// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATIONAL GAINERS (zzz1166). The events from AI Daily Gainers (India + USA) that can change a company's future
// earnings — orders, capacity, approvals, new business, strategic deals, raised guidance, earnings inflections — kept for
// 60 days, grouped by theme, with the themes and companies that are NEW this week and a multibagger-chance read (rules,
// plus an AI second opinion on request). Filled automatically from the daily research; no AI runs on page load.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import NavLink from '@/components/NavLink';
import { R, tint } from '@/components/special-situations/radar-tokens';
import { MbChip, MB_COLOR } from '@/components/transformational/MbChip';
import { MB_WORD, OTHER_THEME, tgKindWord, type MbLabel, type TgBoard, type TgItem, type TgStrength } from '@/lib/transformational/core';

type Mkt = 'ALL' | 'IN' | 'US';
const STRENGTH_COLOR: Record<TgStrength, string> = { TRANSFORMATIONAL: R.green, INFLECTION: R.cyan, NOTABLE: R.amber };
const STRENGTH_WORD: Record<TgStrength, string> = { TRANSFORMATIONAL: 'Transformational', INFLECTION: 'Inflection', NOTABLE: 'Notable' };
const FILTER_KEY = 'mc:transformational:filters:v1';

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
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'chance'>('newest');
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); if (s) { setMkt(s.mkt || 'ALL'); setSmallMid(s.smallMid !== false); setSort(s.sort || 'newest'); } } catch { /* defaults */ }
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

  // zzz1166 — the first visit of a day fills the board from every gainers session still stored (≈ the last 10 days, India + USA):
  // stored research only, no AI. The daily job does the same on its own; this makes a new board useful at once.
  const [filling, setFilling] = useState<string | null>(null);
  useEffect(() => {
    if (state !== 'ok' || !data) return;
    const stamp = `mc:transformational:backfill:${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(stamp)) return; localStorage.setItem(stamp, '1'); } catch { /* run once anyway */ }
    (async () => {
      const dates: string[] = [];
      for (let i = 0; i <= 14; i++) { const d = new Date(Date.now() - i * 86_400_000); if (d.getUTCDay() % 6 !== 0) dates.push(d.toISOString().slice(0, 10)); }
      let saved = 0, n = 0;
      for (const m of ['IN', 'US']) for (const d of dates) {
        n++; setFilling(`Filling the board from stored gainers research… ${n}/${dates.length * 2}`);
        try { const r = await fetch(`/api/v1/ai-gainers/research?market=${m}&date=${d}&archive=1&lite=1`, { cache: 'no-store' }); const j = await r.json().catch(() => null); saved += Number(j?.archived || 0); } catch { /* next */ }
      }
      setFilling(null);
      if (saved > 0) load();
    })();
  }, [state, data, load]);

  const newSet = useMemo(() => new Set(data?.newCompanies || []), [data]);
  const rank: Record<MbLabel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNLIKELY: 0 };
  const filtered = useMemo(() => (data?.items || []).filter((x) =>
    (mkt === 'ALL' || x.market === mkt) && (!theme || x.theme === theme) && (!strength || x.strength === strength)
    && (!mbMin || rank[x.mb.label] >= rank[mbMin] || (x.ai && rank[x.ai.label] >= rank[mbMin]))
    && (!smallMid || isSmallMid(x) || x.marketCap == null) && (!onlyNew || newSet.has(`${x.market}:${x.ticker}`))
    && (!q || `${x.ticker} ${x.company} ${x.headline} ${x.theme}`.toLowerCase().includes(q.toLowerCase()))), [data, mkt, theme, strength, mbMin, smallMid, onlyNew, q, newSet]);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const x of filtered) {
      const k = `${x.market}:${x.ticker}`;
      const g = m.get(k) || { key: k, market: x.market, ticker: x.ticker, company: x.company, items: [], best: x };
      g.items.push(x);
      if (x.mb.score > g.best.mb.score) g.best = x;
      m.set(k, g);
    }
    const arr = [...m.values()];
    for (const g of arr) g.items.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    return sort === 'chance'
      ? arr.sort((a, b) => (b.best.ai?.probabilityPct ?? -1) - (a.best.ai?.probabilityPct ?? -1) || b.best.mb.score - a.best.mb.score)
      : arr.sort((a, b) => b.items[0].sessionDate.localeCompare(a.items[0].sessionDate) || b.best.mb.score - a.best.mb.score);
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

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: 16, color: R.text }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>🧬 Transformational Gainers</h1>
        <span style={{ fontSize: 12, color: R.dim }}>India + USA · last {days} days · from AI Daily Gainers</span>
        <NavLink href="/ai-gainers" style={{ fontSize: 12, color: R.cyan, marginLeft: 'auto' }}>AI Daily Gainers →</NavLink>
      </div>
      <p style={{ fontSize: 13, color: R.dim, margin: '6px 0 12px', lineHeight: 1.5 }}>
        Only the events that can change future earnings: large orders, capacity coming on stream, approvals, a new business, strategic deals,
        raised guidance and earnings inflections — taken from each day&apos;s gainers research and kept {days} days. Grouped by theme, with the
        themes and companies that are new this week. The multibagger chance is a research prompt from the filed facts, not a forecast.
      </p>

      {/* controls */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {(['ALL', 'IN', 'US'] as Mkt[]).map((m) => <button key={m} type="button" style={chip(mkt === m)} onClick={() => setMkt(m)}>{m === 'ALL' ? 'All' : m === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}</button>)}
        <span style={{ width: 8 }} />
        {[60, 30, 14, 7].map((d) => <button key={d} type="button" style={chip(days === d)} onClick={() => setDays(d)}>{d}d</button>)}
        <span style={{ width: 8 }} />
        <button type="button" style={chip(smallMid, R.green)} onClick={() => setSmallMid((v) => !v)} title="India under ₹25,000 Cr, USA under $10B">Small & mid only</button>
        <button type="button" style={chip(onlyNew, R.violet)} onClick={() => setOnlyNew((v) => !v)}>🆕 New this week ({data?.newCompanies.length ?? 0})</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, ticker, theme…" style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: `1px solid ${R.border}`, background: R.bg, color: R.text, minWidth: 200 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: R.faint }}>Strength:</span>
        {(['TRANSFORMATIONAL', 'INFLECTION', 'NOTABLE'] as TgStrength[]).map((s) => <button key={s} type="button" style={chip(strength === s, STRENGTH_COLOR[s])} onClick={() => setStrength((v) => (v === s ? null : s))}>{STRENGTH_WORD[s]}</button>)}
        <span style={{ width: 8 }} />
        <span style={{ fontSize: 12, color: R.faint }}>Multibagger chance at least:</span>
        {(['HIGH', 'MEDIUM', 'LOW'] as MbLabel[]).map((s) => <button key={s} type="button" style={chip(mbMin === s, MB_COLOR[s])} onClick={() => setMbMin((v) => (v === s ? null : s))}>{MB_WORD[s]}</button>)}
        <span style={{ width: 8 }} />
        <span style={{ fontSize: 12, color: R.faint }}>Sort:</span>
        <button type="button" style={chip(sort === 'newest')} onClick={() => setSort('newest')}>Newest</button>
        <button type="button" style={chip(sort === 'chance')} onClick={() => setSort('chance')}>Multibagger chance</button>
        <button type="button" disabled={!!aiBusy} onClick={() => askAi(null, 'auto')} style={{ ...chip(true, R.violet), marginLeft: 'auto', opacity: aiBusy ? 0.6 : 1 }}
          title="The AI reads the strongest events that have no AI read yet (up to 12 at a time, 60 a day; each event is read once).">
          {aiBusy === 'auto' ? '🤖 Reading…' : '🤖 Ask AI: multibagger chance for the top events'}
        </button>
      </div>
      {aiNote && <div style={{ fontSize: 12, color: R.dim, marginBottom: 8 }}>{aiNote}</div>}
      {filling && <div style={{ fontSize: 12, color: R.cyan, marginBottom: 8 }}>{filling}</div>}

      {state === 'loading' && <div style={{ color: R.dim, fontSize: 13 }}>Loading…</div>}
      {state === 'error' && <div style={{ color: R.red, fontSize: 13 }}>Could not load: {err} <button type="button" style={chip(false)} onClick={load}>Retry</button></div>}

      {state === 'ok' && data && (
        <>
          {/* themes */}
          <section style={{ border: `1px solid ${R.border}`, borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Themes in these events <span style={{ fontWeight: 400, color: R.faint }}>— click one to filter · 🆕 = first seen this week · ★ = structural theme</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {themes.length === 0 && <span style={{ fontSize: 12, color: R.dim }}>No events yet — the board fills from each day&apos;s gainers research (it grows to {days} days on its own).</span>}
              {themes.map((t) => (
                <button key={t.theme} type="button" onClick={() => setTheme((v) => (v === t.theme ? null : t.theme))} style={chip(theme === t.theme, t.isNew ? R.violet : t.structural ? R.green : R.cyan)}
                  title={`${t.companies} companies, ${t.events} events · first ${t.firstSeen} · latest ${t.lastSeen} · ${t.tickers.slice(0, 12).join(', ')}`}>
                  {t.isNew ? '🆕 ' : ''}{t.structural ? '★ ' : ''}{t.theme === OTHER_THEME ? 'Other' : t.theme} · {t.companies}
                </button>
              ))}
            </div>
          </section>

          <div style={{ fontSize: 12, color: R.faint, marginBottom: 8 }}>{groups.length} companies · {filtered.length} events · {data.from} → {data.to}</div>

          {groups.length === 0 && <div style={{ fontSize: 13, color: R.dim, padding: 16, border: `1px dashed ${R.border}`, borderRadius: 10 }}>
            No events match these filters.{data.items.length === 0 ? ' The board starts from the gainers sessions still stored (the last ~10 days) and grows by one session a day until it holds 60 days.' : ''}
          </div>}

          <div style={{ display: 'grid', gap: 10 }}>
            {groups.map((g) => {
              const x = g.best;
              const isNew = newSet.has(g.key);
              return (
                <article key={g.key} style={{ border: `1px solid ${R.border}`, borderLeft: `4px solid ${STRENGTH_COLOR[x.strength]}`, borderRadius: 10, padding: '10px 12px', background: R.bg }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 900, fontSize: 16 }}>{g.ticker}</span>
                    <span style={{ fontSize: 13, color: R.dim }}>{g.market === 'IN' ? '🇮🇳' : '🇺🇸'} {g.company}</span>
                    <span style={{ fontSize: 12, color: R.faint }}>{fmtCap(x)}</span>
                    {isNew && <span style={{ fontSize: 11, fontWeight: 800, color: R.violet, border: `1px solid ${R.violet}`, borderRadius: 999, padding: '1px 7px' }}>🆕 NEW THIS WEEK</span>}
                    <span style={{ fontSize: 11, fontWeight: 800, color: STRENGTH_COLOR[x.strength], border: `1px solid ${STRENGTH_COLOR[x.strength]}`, borderRadius: 999, padding: '1px 7px' }}>{STRENGTH_WORD[x.strength]}</span>
                    <button type="button" onClick={() => setTheme(x.theme)} title={x.themeWhy || ''} style={{ fontSize: 11, fontWeight: 700, color: R.cyan, background: tint(R.cyan, 8), border: `1px solid ${R.border}`, borderRadius: 999, padding: '1px 8px', cursor: 'pointer' }}>{x.theme}</button>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 12 }}>
                      <NavLink href={`/charts?m=${g.market}&t=${encodeURIComponent(g.ticker)}`} style={{ color: R.cyan }}>Chart</NavLink>
                      <NavLink href={`/ai-gainers?market=${g.market}`} style={{ color: R.cyan }}>Daily Gainers</NavLink>
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}><MbChip mb={x.mb} ai={x.ai} /></div>
                  {g.items.map((it) => (
                    <div key={it.id} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${R.border}` }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12, color: R.faint }}>
                        <span style={{ fontWeight: 800, color: R.text }}>{tgKindWord(it.kind)}</span>
                        <span>session {it.sessionDate}{it.eventDate && it.eventDate !== it.sessionDate ? ` · filed ${it.eventDate}` : ''}</span>
                        <span style={{ color: (it.movePct ?? 0) >= 0 ? R.green : R.red }}>move {pct(it.movePct)} ({it.moveWindow})</span>
                        {it.returns.m3 != null && <span>3M {pct(it.returns.m3)}</span>}
                        <span style={{ color: it.evidence === 'official' ? R.green : R.amber }}>{it.evidence === 'official' ? '✓ company filing' : '⚠ press only — verify'}</span>
                        {it.durationYears && <span style={{ color: R.green }}>multi-year runway</span>}
                        {it.sourceUrl && /^https?:\/\//.test(it.sourceUrl) && <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>source ↗</a>}
                        {!it.ai && <button type="button" disabled={!!aiBusy} onClick={() => askAi([it.id], it.id)} style={{ ...chip(false, R.violet), padding: '1px 8px', fontSize: 11 }}>{aiBusy === it.id ? '🤖 reading…' : '🤖 Ask AI'}</button>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{it.headline}</div>
                      {it.whatChanged && it.whatChanged !== it.headline && <div style={{ fontSize: 13, color: R.dim, marginTop: 2, lineHeight: 1.45 }}>{it.whatChanged}</div>}
                      {it.signals.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                        {it.signals.map((s) => <span key={s} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: tint(R.green, 8), color: R.text, border: `1px solid ${R.border}` }}>{s}</span>)}
                      </div>}
                      {it.quote && <div style={{ fontSize: 12, color: R.faint, marginTop: 5, fontStyle: 'italic', lineHeight: 1.45 }}>“{it.quote}”</div>}
                      {it !== x && <div style={{ marginTop: 5 }}><MbChip mb={it.mb} ai={it.ai} compact /></div>}
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: R.faint, marginTop: 14 }}>Company data only. Not investment advice. Price is context here, never the reason an event is listed.</p>
        </>
      )}
    </div>
  );
}
