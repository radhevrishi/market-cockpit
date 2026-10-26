'use client';
// zzz1174 — 🔥 Choke-Point Themes on the News page. Shows the LAST AI run (static until the owner clicks); the button runs the
// AI once with the latest news and saves the result for every device. US first, then India, each with its Investor Playbook.
import { useCallback, useEffect, useState } from 'react';
import { chokeAsText, fmtChokeCap, SMALL_MID_MAX, type ChokeLeader, type ChokeReport, type ChokeRegion } from '@/lib/choke-themes/core';

const OPEN_KEY = 'mc:choke-themes:open:v1';
const C = { bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-border-1)', text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)', red: 'var(--mc-bearish)', green: 'var(--mc-bullish)', accent: 'var(--mc-accent)', warn: 'var(--mc-warn)' };

function who(list: ChokeLeader[], region: ChokeRegion) {
  return list.map((l, i) => {
    const c = fmtChokeCap(l.cap, region);
    return <span key={l.ticker} title={l.note || ''}>{i > 0 ? ', ' : ''}{l.name} (<b>{l.ticker}</b>{c ? <span style={{ color: 'var(--mc-text-4)', fontWeight: 400 }}> · {c}</span> : null})</span>;
  });
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
      if (j?.ok && j.report) { setReport(j.report); setMsg(j.report.changes?.length ? null : 'Updated.'); }
      else setMsg(j?.error || `Update failed (HTTP ${r.status}) — the previous run is still shown.`);
    } catch (e: any) { setMsg(`Update failed: ${String(e?.message || e)} — the previous run is still shown.`); }
    setBusy(false);
  }, []);

  const copy = () => { if (report) navigator.clipboard?.writeText(chokeAsText(report)).then(() => setMsg('Copied as text.')).catch(() => undefined); };
  const g = report?.regions.find((x) => x.region === tab) || null;
  const when = report ? new Date(report.generatedAt).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const btn = (on = false): React.CSSProperties => ({ cursor: 'pointer', fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 8, border: `1px solid ${on ? C.accent : C.border}`, color: on ? C.accent : C.text, background: on ? 'color-mix(in srgb, var(--mc-accent) 10%, transparent)' : 'transparent' });

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontSize: 14, fontWeight: 900, padding: 0 }}>
          {open ? '▾' : '▸'} 🔥 Choke-Point Themes · 10+ years · 🇺🇸 US + 🇮🇳 India
        </button>
        <span style={{ fontSize: 12, color: C.faint }}>
          {!loaded ? 'loading…' : report ? `last AI update ${when} · ${report.newsUsed} news items read` : 'not run yet — click Update with AI'}
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

      {open && report && (
        <div style={{ marginTop: 10 }}>
          {report.changes.length > 0 && (
            <div style={{ fontSize: 12, color: C.dim, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>
              <b style={{ color: C.text }}>What changed since the last run:</b> {report.changes.join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['US', 'IN'] as ChokeRegion[]).map((r) => <button key={r} type="button" style={btn(tab === r)} onClick={() => setTab(r)}>{r === 'US' ? '🇺🇸 United States' : '🇮🇳 India'}</button>)}
            <span style={{ width: 12 }} />
            <button type="button" style={btn(!sm)} onClick={() => setSm(false)}>All leaders</button>
            <button type="button" style={btn(sm)} onClick={() => setSm(true)} title="US under $10B, India under ₹25,000 Cr (checked against the stock screener)">🔎 Small & mid caps</button>
          </div>
          {g && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 10 }}>
                {g.themes.map((t) => (
                  <div key={t.name} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', background: C.bg2, fontSize: 13, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4 }}>🔥 {t.name} {t.emoji}</div>
                    <div><b>Why:</b> {t.why}</div>
                    {!sm && <div style={{ marginTop: 4 }}><b>Leaders:</b>{' '}{who(t.leaders, g.region)}.</div>}
                    {(() => {
                      // small & mid: the AI's small & mid list plus any headline leader that is itself under the limit
                      const list = [...(t.smallMid || []), ...(sm ? t.leaders.filter((l) => l.cap != null && l.cap <= SMALL_MID_MAX[g.region] && !(t.smallMid || []).some((x) => x.ticker === l.ticker)) : [])];
                      if (!list.length) return sm ? <div style={{ marginTop: 4, color: C.faint }}><b>Small & mid caps:</b> none that pass the size and governance filter.</div> : null;
                      return <div style={{ marginTop: 4 }}><b>Small & mid caps:</b>{' '}{who(list, g.region)}.</div>;
                    })()}
                    <div style={{ marginTop: 4 }}><b>Asymmetry:</b> <span style={{ color: C.red }}>Bear: {t.bear}</span> <span style={{ color: C.green }}>Bull: {t.bull}</span></div>
                    {t.evidence && <div style={{ marginTop: 4, fontSize: 12, color: C.dim }}>📰 Recent: {t.evidence}</div>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4 }}>🎯 Investor Playbook — {g.region === 'US' ? 'US' : 'India'}</div>
                <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{g.playbook.dominant.map((d) => <li key={d}>{d}</li>)}</ul>
                {g.playbook.smallMid && <div style={{ marginBottom: 4 }}><b>Small & mid caps first:</b> {g.playbook.smallMid}</div>}
                <div><b>Accumulation:</b> {g.playbook.accumulation}</div>
              </div>
            </>
          )}
          <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>AI research view from the latest news and your gainers themes ({report.model || 'AI'}). Governance screened by the AI from what it knows — check filings before acting. Not investment advice.</div>
        </div>
      )}
    </div>
  );
}
