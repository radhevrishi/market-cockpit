'use client';
// zzz1174 — 🔥 Choke-Point Themes on the News page. Shows the LAST AI run (static until the owner clicks); the button runs the
// AI once with the latest news and saves the result for every device. US first, then India, each with its Investor Playbook.
// zzz1176 — clearer layout: ranked theme cards, ticker chips with market cap that open the chart, ⚠ on tickers the stock
// screener does not know, red / green bear and bull boxes, a playbook with the -30 / -50 / -70% tranche ladder.
import { useCallback, useEffect, useState } from 'react';
import { chokeAsText, fmtChokeCap, SMALL_MID_MAX, type ChokeLeader, type ChokeReport, type ChokeRegion, type ChokeTheme } from '@/lib/choke-themes/core';

const OPEN_KEY = 'mc:choke-themes:open:v1';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
  red: 'var(--mc-bearish)', green: 'var(--mc-bullish)', accent: 'var(--mc-accent)', warn: 'var(--mc-warn)',
};
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

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

function ThemeCard({ t, i, region, sm }: { t: ChokeTheme; i: number; region: ChokeRegion; sm: boolean }) {
  const smallList = [...(t.smallMid || []), ...(sm ? t.leaders.filter((l) => l.cap != null && l.cap <= SMALL_MID_MAX[region]) : [])];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.bg, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: tint(C.accent, 14), color: C.accent, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
        <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.3 }}>🔥 {t.name} <span style={{ whiteSpace: 'nowrap' }}>{t.emoji}</span></div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55 }}><span style={{ fontWeight: 800, color: C.faint, fontSize: 11, letterSpacing: 0.5 }}>WHY </span>{t.why}</div>
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

  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === '1'); setSm(localStorage.getItem(OPEN_KEY + ':sm') === '1'); } catch { /* optional */ } }, []);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY + ':sm', sm ? '1' : '0'); } catch { /* optional */ } }, [sm]);
  const toggle = () => setOpen((v) => { try { localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch { /* optional */ } return !v; });

  useEffect(() => {
    fetch('/api/v1/choke-themes', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j?.report) setReport(j.report); }).catch(() => undefined).finally(() => setLoaded(true));
  }, []);

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
          </div>
          {report.changes.length > 0 && (
            <div style={{ fontSize: 12, color: C.dim, background: tint(C.accent, 6), border: `1px solid ${tint(C.accent, 25)}`, borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
              <b style={{ color: C.text }}>What changed since the last run:</b> {report.changes.join(' · ')}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 10 }}>
            {g.themes.map((t, i) => <ThemeCard key={t.name} t={t} i={i} region={g.region} sm={sm} />)}
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
