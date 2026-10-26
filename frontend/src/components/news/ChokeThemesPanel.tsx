'use client';
// zzz1174 — 🔥 Choke-Point Themes on the News page. Shows the LAST AI run (static until the owner clicks); the button runs the
// AI once with the latest news and saves the result for every device. US first, then India, each with its Investor Playbook.
// zzz1176 — clearer layout: ranked theme cards, ticker chips with market cap that open the chart, ⚠ on tickers the stock
// screener does not know, red / green bear and bull boxes, a playbook with the -30 / -50 / -70% tranche ladder.
import { useCallback, useEffect, useState } from 'react';
import type { ThemePulse } from '@/lib/choke-themes/pulse';
import { chokeAsText, fmtChokeCap, SMALL_MID_MAX, type ChokeLeader, type ChokeReport, type ChokeRegion, type ChokeTheme } from '@/lib/choke-themes/core';

const OPEN_KEY = 'mc:choke-themes:open:v1';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
  red: 'var(--mc-bearish)', green: 'var(--mc-bullish)', accent: 'var(--mc-accent)', warn: 'var(--mc-warn)',
};
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const STAGE_C: Record<string, string> = { EARLY: 'var(--mc-bullish)', BUILDING: 'var(--mc-accent)', CROWDED: 'var(--mc-warn)' };
const STAGE_WHY: Record<string, string> = { EARLY: 'Inflection starting, not yet consensus — shares have not run', BUILDING: 'Proven and accelerating — partly priced', CROWDED: 'Consensus — largely priced; kept only for a real new bottleneck' };

function Chip({ l, region, small }: { l: ChokeLeader; region: ChokeRegion; small?: boolean }) {
  const cap = fmtChokeCap(l.cap, region);
  const bad = l.found === false;
  const c = bad ? C.warn : small ? C.green : C.accent;
  const home = !/,\s*[A-Za-z]+$/.test(l.ticker) || /,\s*(NYSE|NASDAQ|NSE|BSE)$/i.test(l.ticker);
  const sym = l.ticker.replace(/,.*$/, '').trim();
  const inner = (
    <>
      <b style={{ color: C.text }}>{sym}</b>
      <span style={{ color: C.dim }}> {l.name}</span>
      {cap && <span style={{ color: C.faint }}> · {cap}</span>}
      {l.p1y != null && <span style={{ color: l.p1y >= 0 ? C.green : C.red }}> · 1y {l.p1y >= 0 ? '+' : ''}{Math.round(l.p1y)}%</span>}
      {!home && <span style={{ color: C.faint }}> · {l.ticker.split(',').slice(1).join(',').trim()}</span>}
      {bad && <span style={{ color: C.warn, fontWeight: 800 }}> ⚠</span>}
    </>
  );
  const style: React.CSSProperties = { display: 'inline-block', fontSize: 12, padding: '3px 8px', borderRadius: 999, border: `1px solid ${tint(c, 45)}`, background: tint(c, 8), textDecoration: 'none', lineHeight: 1.4 };
  const title = [l.note, bad ? 'Not found in the stock screener — the ticker may be wrong, renamed or delisted. Check before acting.' : null].filter(Boolean).join(' · ');
  return home
    ? <a href={`/charts?m=${region}&t=${encodeURIComponent(sym)}`} target="_blank" rel="noopener noreferrer" title={title || 'Open chart'} style={style}>{inner}</a>
    : <span title={title} style={style}>{inner}</span>;
}

const TREND = { RISING: { a: '↑', c: 'var(--mc-bullish)', w: 'rising' }, STEADY: { a: '→', c: 'var(--mc-text-3)', w: 'steady' }, COOLING: { a: '↓', c: 'var(--mc-bearish)', w: 'cooling' } } as const;
const strengthColor = (v: number) => (v >= 60 ? C.green : v >= 35 ? C.accent : C.faint);

function StrengthBadge({ p }: { p: ThemePulse }) {
  const c = strengthColor(p.strength); const tr = TREND[p.trend];
  return (
    <span title={`Live strength ${p.strength}/100 · news ${p.trend.toLowerCase()} · ${p.reasons.join(' · ')}`} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 900, padding: '3px 8px', borderRadius: 6, color: c, border: `1px solid ${c}`, background: tint(c, 10) }}>
      {p.strength}<span style={{ fontWeight: 600, opacity: 0.8 }}>/100</span><span style={{ color: tr.c }}>{tr.a}</span>
    </span>
  );
}

function PulseView({ p }: { p: ThemePulse }) {
  const bar = (label: string, v: number, c: string, hint: string, invert = false) => (
    <div title={hint} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 30px', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: C.dim }}>{label}</span>
      <div style={{ height: 7, borderRadius: 4, background: tint(c, 15) }}><div style={{ height: 7, borderRadius: 4, width: `${v}%`, background: c }} /></div>
      <b style={{ textAlign: 'right', color: invert && v >= 50 ? C.warn : C.text }}>{v}</b>
    </div>
  );
  return (
    <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {bar('News heat', p.heat, C.accent, 'Important news in the last 7 days, and whether it is rising versus the 3 weeks before')}
        {bar('Bottleneck', p.bottleneck, C.red, 'Share of the last 30 days of news that speaks of a squeeze: sold out, shortage, lead times, price hikes, allocation, record backlog')}
        {bar('Company proof', p.proof, C.green, 'Theme companies with revenue accelerating, growth level, margins, plus filed transformational events and key contracts (60 days)')}
        {bar('Crowding', p.crowding, C.warn, 'How far the theme’s shares already ran in a year — high means much is priced in (it lowers the strength)', true)}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {p.events.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>FILED EVENTS & KEY CONTRACTS (60 DAYS)</div>
          {p.events.map((e) => <div key={`${e.ticker}${e.date}${e.headline}`} style={{ fontSize: 12, lineHeight: 1.45, padding: '2px 0' }}><span style={{ color: C.faint }}>{e.date}</span> <b>{e.ticker}</b> <span style={{ color: e.kind === 'CONTRACT' ? C.green : C.accent, fontWeight: 700 }}>{e.kind === 'CONTRACT' ? 'contract' : String(e.strength).toLowerCase()}</span> — {e.headline}</div>)}
        </div>
      )}
      <div>
        <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>LATEST NEWS ({p.news60} IN 60 DAYS · ⚡ = SQUEEZE)</div>
        {p.news.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No matching news yet — the archive grows every hour.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {p.news.map((n) => (
            <div key={n.title + n.date} style={{ fontSize: 12, lineHeight: 1.45 }}>
              <span style={{ color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{n.date}</span>{' '}
              {n.squeeze && <span title="Speaks of a squeeze" style={{ color: C.red, fontWeight: 900 }}>⚡ </span>}
              {n.url && /^https?:\/\//.test(n.url) ? <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, fontWeight: 600 }}>{n.title}</a> : <span style={{ fontWeight: 600 }}>{n.title}</span>}
              {n.tickers.length > 0 && <span style={{ color: C.accent, fontWeight: 700 }}> · {n.tickers.join(', ')}</span>}
              {n.source && <span style={{ color: C.faint }}> · {n.source}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ t, i, region, sm, pulse }: { t: ChokeTheme; i: number; region: ChokeRegion; sm: boolean; pulse?: ThemePulse | null }) {
  const [showPulse, setShowPulse] = useState(false);
  const smallList = [...(t.smallMid || []), ...(sm ? t.leaders.filter((l) => l.cap != null && l.cap <= SMALL_MID_MAX[region]) : [])];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.bg, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: tint(C.accent, 14), color: C.accent, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
        <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.3, flex: 1 }}>🔥 {t.name} <span style={{ whiteSpace: 'nowrap' }}>{t.emoji}</span></div>
        {pulse && <StrengthBadge p={pulse} />}
        {t.stage && <span title={STAGE_WHY[t.stage]} style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, padding: '3px 8px', borderRadius: 6, color: STAGE_C[t.stage], border: `1px solid ${STAGE_C[t.stage]}`, background: tint(STAGE_C[t.stage], 10) }}>{t.stage}</span>}
      </div>
      {t.notPricedIn && <div style={{ fontSize: 13, lineHeight: 1.5, padding: '6px 9px', borderRadius: 8, background: tint(C.accent, 6), border: `1px solid ${tint(C.accent, 25)}` }}><b>What the market misses:</b> {t.notPricedIn}</div>}
      <div style={{ fontSize: 13, lineHeight: 1.55 }}><span style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5 }}>WHY </span>{t.why}</div>
      {t.signals && <div style={{ fontSize: 12, lineHeight: 1.5, color: C.dim }}><span style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5 }}>SIGNALS TO WATCH </span>{t.signals}</div>}
      {!sm && (
        <div>
          <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>LEADERS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{t.leaders.map((l) => <Chip key={l.ticker} l={l} region={region} />)}</div>
        </div>
      )}
      <div>
        <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>SMALL & MID CAPS <span style={{ fontWeight: 400 }}>({region === 'US' ? 'under $10B' : 'under ₹25,000 Cr'})</span></div>
        {smallList.length
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{smallList.map((l) => <Chip key={l.ticker} l={l} region={region} small />)}</div>
          : <div style={{ fontSize: 12, color: C.faint }}>None that pass the size and governance filter.</div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 6 }}>
        <div style={{ borderRadius: 8, padding: '7px 9px', background: tint(C.red, 7), border: `1px solid ${tint(C.red, 30)}`, fontSize: 12, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 900, color: C.red, marginBottom: 2 }}>▼ BEAR</div>{t.bear}
        </div>
        <div style={{ borderRadius: 8, padding: '7px 9px', background: tint(C.green, 7), border: `1px solid ${tint(C.green, 30)}`, fontSize: 12, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 900, color: C.green, marginBottom: 2 }}>▲ BULL</div>{t.bull}
        </div>
      </div>
      {t.evidence && <div style={{ fontSize: 12, color: C.dim, borderTop: `1px dashed ${C.border}`, paddingTop: 7 }}>📰 <b>Recent:</b> {t.evidence}</div>}
      <button type="button" onClick={() => setShowPulse((v) => !v)} disabled={pulse === undefined}
        style={{ alignSelf: 'flex-start', cursor: pulse === undefined ? 'wait' : 'pointer', fontSize: 12, fontWeight: 800, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.accent}`, color: C.accent, background: tint(C.accent, showPulse ? 14 : 6) }}>
        {pulse === undefined ? '📊 Live pulse · loading…' : pulse === null ? '📊 Live pulse · not available' : `📊 Live pulse · ${pulse.news7} news this week ${TREND[pulse.trend].a} · ${showPulse ? 'hide' : 'open'}`}
      </button>
      {showPulse && pulse && <PulseView p={pulse} />}
    </div>
  );
}

export default function ChokeThemesPanel() {
  const [report, setReport] = useState<ChokeReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ChokeRegion>('US');
  const [sm, setSm] = useState(false);   // zzz1175 — small & mid caps only
  const [pulses, setPulses] = useState<Record<string, ThemePulse> | null | undefined>(undefined);   // zzz1179
  const [order, setOrder] = useState<'ai' | 'strength'>('ai');

  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === '1'); setSm(localStorage.getItem(OPEN_KEY + ':sm') === '1'); } catch { /* optional */ } }, []);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY + ':sm', sm ? '1' : '0'); } catch { /* optional */ } }, [sm]);
  const toggle = () => setOpen((v) => { try { localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch { /* optional */ } return !v; });

  useEffect(() => {
    fetch('/api/v1/choke-themes', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j?.report) setReport(j.report); }).catch(() => undefined).finally(() => setLoaded(true));
  }, []);

  // zzz1179 — the live pulse of every theme (no AI): loaded once the panel is open and whenever a new AI run lands
  useEffect(() => {
    if (!open || !report) return;
    setPulses(undefined);
    fetch('/api/v1/choke-themes/pulse', { cache: 'no-store' }).then((r) => r.json()).then((j) => setPulses(j?.ok ? (j.pulses || {}) : null)).catch(() => setPulses(null));
  }, [open, report?.generatedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async () => {
    setBusy(true); setMsg('The AI is reading the latest news and updating the themes — about 1–2 minutes…'); setOpen(true);
    try {
      const r = await fetch('/api/v1/choke-themes', { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (j?.ok && j.report) { setReport(j.report); setMsg(null); }
      else setMsg(j?.error || `Update failed (HTTP ${r.status}) — the previous run is still shown.`);
    } catch (e: any) { setMsg(`Update failed: ${String(e?.message || e)} — the previous run is still shown.`); }
    setBusy(false);
  }, []);

  const copy = () => { if (report) navigator.clipboard?.writeText(chokeAsText(report)).then(() => setMsg('Copied as text.')).catch(() => undefined); };
  const g = report?.regions.find((x) => x.region === tab) || null;
  const when = report ? new Date(report.generatedAt).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const ageDays = report ? Math.floor((Date.now() - Date.parse(report.generatedAt)) / 86_400_000) : 0;
  const btn = (on = false): React.CSSProperties => ({ cursor: 'pointer', fontSize: 12, fontWeight: 800, padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? C.accent : C.border}`, color: on ? C.accent : C.text, background: on ? tint(C.accent, 10) : 'transparent' });
  const unknown = g ? g.themes.flatMap((t) => [...t.leaders, ...(t.smallMid || [])]).filter((l) => l.found === false).map((l) => l.ticker) : [];

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontSize: 15, fontWeight: 900, padding: 0 }}>
          {open ? '▾' : '▸'} 🔥 Choke-Point Themes <span style={{ fontWeight: 600, color: C.dim, fontSize: 13 }}>· 10+ years · 🇺🇸 US + 🇮🇳 India</span>
        </button>
        <span style={{ fontSize: 12, color: ageDays >= 14 ? C.warn : C.faint }}>
          {!loaded ? 'loading…' : report ? `AI update ${when}${ageDays >= 1 ? ` (${ageDays}d ago)` : ''} · ${report.newsUsed} news items read` : 'not run yet — click Update with AI'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {report && <button type="button" style={btn()} onClick={copy} title="Copy the whole report as text">⧉ Copy</button>}
          <button type="button" disabled={busy} onClick={run} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}
            title="Runs the AI once on the latest news and saves the result. Nothing runs unless you click (at most 6 a day).">
            {busy ? '🤖 Updating…' : '🤖 Update with AI'}
          </button>
        </span>
      </div>
      {msg && <div style={{ fontSize: 12, color: busy ? C.accent : C.dim, marginTop: 6 }}>{msg}</div>}

      {open && report && g && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            {(['US', 'IN'] as ChokeRegion[]).map((r) => <button key={r} type="button" style={btn(tab === r)} onClick={() => setTab(r)}>{r === 'US' ? '🇺🇸 United States' : '🇮🇳 India'} <span style={{ color: C.faint }}>{report.regions.find((x) => x.region === r)?.themes.length}</span></button>)}
            <span style={{ width: 1, height: 22, background: C.border, margin: '0 6px' }} />
            <button type="button" style={btn(!sm)} onClick={() => setSm(false)}>All leaders</button>
            <button type="button" style={btn(sm)} onClick={() => setSm(true)} title="US under $10B, India under ₹25,000 Cr (checked against the stock screener)">🔎 Small & mid caps</button>
            <span style={{ width: 1, height: 22, background: C.border, margin: '0 6px' }} />
            <button type="button" style={btn(order === 'ai')} onClick={() => setOrder('ai')} title="The AI's ranking">AI rank</button>
            <button type="button" style={btn(order === 'strength')} onClick={() => setOrder('strength')} title="Live strength from news, bottleneck talk, company numbers and contracts">📊 Live strength</button>
          </div>
          {report.changes.length > 0 && (
            <div style={{ fontSize: 12, color: C.dim, background: tint(C.accent, 6), border: `1px solid ${tint(C.accent, 25)}`, borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
              <b style={{ color: C.text }}>What changed since the last run:</b> {report.changes.join(' · ')}
            </div>
          )}
          {pulses && (() => {
            const rows = g.themes.map((t) => ({ t, p: pulses[`${g.region}|${t.name}`] })).filter((x) => x.p);
            const strong = [...rows].sort((a, b) => b.p!.strength - a.p!.strength).slice(0, 3);
            const rising = rows.filter((x) => x.p!.trend === 'RISING').map((x) => x.t.name);
            const cooling = rows.filter((x) => x.p!.trend === 'COOLING').map((x) => x.t.name);
            if (!rows.length) return null;
            return (
              <div style={{ fontSize: 12, lineHeight: 1.6, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, marginBottom: 10 }}>
                <b>📊 Live now:</b> strongest {strong.map((x) => `${x.t.name.split(/[,(:]/)[0].trim()} ${x.p!.strength}${TREND[x.p!.trend].a}`).join(' · ')}
                {rising.length > 0 && <span style={{ color: C.green }}> · rising: {rising.map((n) => n.split(/[,(:]/)[0].trim()).join(', ')}</span>}
                {cooling.length > 0 && <span style={{ color: C.red }}> · cooling: {cooling.map((n) => n.split(/[,(:]/)[0].trim()).join(', ')}</span>}
                <span style={{ color: C.faint }}> · from news, squeeze talk, company numbers and contracts — no AI, updates every hour</span>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 10 }}>
            {(order === 'strength' && pulses ? [...g.themes].sort((a, b) => (pulses[`${g.region}|${b.name}`]?.strength ?? -1) - (pulses[`${g.region}|${a.name}`]?.strength ?? -1)) : g.themes)
              .map((t, i) => <ThemeCard key={t.name} t={t} i={i} region={g.region} sm={sm} pulse={pulses === undefined ? undefined : pulses === null ? null : (pulses[`${g.region}|${t.name}`] ?? null)} />)}
          </div>

          <div style={{ marginTop: 12, border: `1px solid ${tint(C.accent, 35)}`, borderRadius: 12, padding: 14, background: tint(C.accent, 4) }}>
            <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 8 }}>🎯 Investor Playbook — {g.region === 'US' ? '🇺🇸 US' : '🇮🇳 India'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>LIKELY TO LEAD THE NEXT BULL CYCLE</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>{g.playbook.dominant.map((d) => <li key={d}>{d}</li>)}</ol>
                {g.playbook.smallMid && <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 8 }}><b>Small & mid caps first:</b> {g.playbook.smallMid}</div>}
              </div>
              <div>
                <div style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5, marginBottom: 6 }}>ACCUMULATION (2–3 YEAR BEAR ASSUMED)</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[['−30%', 'Tranche 1'], ['−50%', 'Tranche 2'], ['−70%', 'Tranche 3']].map(([d, n], k) => (
                    <div key={d} style={{ flex: 1, textAlign: 'center', borderRadius: 8, padding: '6px 4px', background: tint(C.red, 6 + k * 5), border: `1px solid ${tint(C.red, 25 + k * 10)}` }}>
                      <div style={{ fontWeight: 900, color: C.red, fontSize: 14 }}>{d}</div><div style={{ fontSize: 11, color: C.dim }}>{n}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>{g.playbook.accumulation}</div>
              </div>
            </div>
          </div>
          {unknown.length > 0 && <div style={{ fontSize: 12, color: C.warn, marginTop: 8 }}>⚠ Not found in the stock screener: {unknown.join(', ')} — the ticker may be wrong, renamed or delisted. Check before acting.</div>}
          <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>AI research view from the latest news and your gainers themes ({report.model || 'AI'}). Market caps from the stock screener. Governance screened by the AI from what it knows — check filings before acting. Not investment advice.</div>
        </div>
      )}
    </div>
  );
}
