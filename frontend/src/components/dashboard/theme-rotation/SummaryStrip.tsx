'use client';
// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY STRIP (zzz795) — the first screen. Four compact cells:
//   market condition · what changed this week · early rotation · risk flags,
// plus one line for any cross-theme rotation. Every name is clickable and
// opens that theme's evidence in the table below.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import type { ViewModel } from '@/lib/theme-rotation/view-model';
import type { HoldingsExposure } from '@/lib/theme-rotation/lists';
import { NameChips, Pill } from './ui';
import { T, tint } from './tokens';

export interface SummaryStripProps {
  vm: ViewModel;
  benchName: string;
  nameOf: (id: string) => string;
  onPick: (id: string) => void;
  holdings: HoldingsExposure | null;
  historyLoaded: boolean;
}

const REGIME: Record<string, { word: string; color: string; advice: string }> = {
  'risk-on': { word: 'RISK-ON', color: T.up, advice: 'Most themes are in uptrends — leadership is being rewarded.' },
  'risk-off': { word: 'RISK-OFF', color: T.down, advice: 'Most themes are below their 50-day line — even correct theme calls struggle here. Size down.' },
  mixed: { word: 'MIXED', color: T.warn, advice: 'No broad trend — be selective and act only where the theme and the stock both confirm.' },
};

export function SummaryStrip({ vm, benchName, nameOf, onPick, holdings, historyLoaded }: SummaryStripProps) {
  const s = vm.summary;
  const reg = s.regime ? REGIME[s.regime] : null;
  const d = vm.diff;
  const ids = (xs: string[]) => xs.filter((x) => vm.byId.has(x));
  const chips = (xs: string[], color: string, n = 4) => <NameChips names={ids(xs)} n={n} color={color} onPick={onPick} render={(id) => nameOf(id)} />;
  const up = [...new Set([...d.newEntrants, ...d.rising])];
  const down = [...new Set([...d.falling, ...d.fading])];
  const cell: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '9px 11px', minWidth: 0 };
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: 0.6, color: T.faint, textTransform: 'uppercase', marginBottom: 5 };
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="trt-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
        <div style={{ ...cell, borderLeft: `3px solid ${reg?.color || T.border2}` }}>
          <div style={label}>Market condition</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {reg ? <Pill color={reg.color} strong>{reg.word}</Pill> : <Pill color={T.absent}>not available</Pill>}
            <span style={{ fontSize: 11, color: T.faint }}>vs {benchName}</span>
          </div>
          <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.45 }}>{s.regimeLine}</div>
          {reg ? <div style={{ fontSize: 11, color: T.faint, marginTop: 3, lineHeight: 1.4 }}>{reg.advice}</div> : null}
        </div>

        <div style={cell}>
          <div style={label}>What changed this week</div>
          <div style={{ fontSize: 11.5, color: T.dim, display: 'grid', gap: 4 }}>
            <div><span style={{ color: T.up, fontWeight: 900 }}>▲ Rising / new</span> {chips(up, T.up)}</div>
            <div><span style={{ color: T.down, fontWeight: 900 }}>▼ Falling / fading</span> {chips(down, T.down)}</div>
            {d.persistentLeaders.length ? <div><span style={{ color: T.accent, fontWeight: 900 }}>■ Still leading</span> {chips(d.persistentLeaders, T.accent, 3)}</div> : null}
          </div>
          <div style={{ fontSize: 10.5, color: T.faint, marginTop: 4, lineHeight: 1.4 }}>{historyLoaded ? d.note : 'Reading stored weeks…'}</div>
        </div>

        <div style={cell}>
          <div style={label}>Early rotation</div>
          {s.early.length
            ? <>{chips(s.early, T.accent, 5)}<div style={{ fontSize: 10.5, color: T.faint, marginTop: 4, lineHeight: 1.4 }}>Earnings or catalysts improving while relative strength still lags — the turn before the price confirms it.</div></>
            : <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.45 }}>None this week. This needs improving earnings or catalysts plus a second confirmation, while the price still lags.</div>}
        </div>

        <div style={cell}>
          <div style={label}>Risk flags</div>
          <div style={{ fontSize: 11.5, color: T.dim, display: 'grid', gap: 4 }}>
            <div><span style={{ color: T.down, fontWeight: 900 }}>Breakdown</span> {chips(s.breakdown, T.down)}</div>
            <div><span style={{ color: T.warn, fontWeight: 900 }}>Short-term break</span> {chips(s.shortBreak, T.warn)}</div>
            <div><span style={{ color: T.warn, fontWeight: 900 }}>Crowded</span> {chips(s.crowded, T.warn)}</div>
          </div>
          {holdings && holdings.atRisk.length ? (
            <div style={{ marginTop: 5, fontSize: 11, color: T.down, background: tint(T.down, 8), border: `1px solid ${tint(T.down, 30)}`, borderRadius: 6, padding: '3px 7px', lineHeight: 1.4 }}>
              Your holdings in these themes: <b>{holdings.atRisk.slice(0, 6).join(', ')}{holdings.atRisk.length > 6 ? ` +${holdings.atRisk.length - 6}` : ''}</b>
            </div>
          ) : null}
        </div>
      </div>

      {vm.flows.length ? (
        <div style={{ ...cell, marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ ...label, marginBottom: 0 }}>Rotation between themes</span>
          {vm.flows.slice(0, 3).map((f) => (
            <span key={`${f.from}>${f.to}`} title={f.why} style={{ fontSize: 11.5, color: T.dim }}>
              <button type="button" onClick={() => onPick(f.from)} style={linkBtn(T.down)}>{nameOf(f.from)}</button>
              <span style={{ color: T.faint }}> → </span>
              <button type="button" onClick={() => onPick(f.to)} style={linkBtn(T.up)}>{nameOf(f.to)}</button>
              {f.beneficiaries.length ? <span style={{ color: T.faint }}> · next in line: {f.beneficiaries.slice(0, 3).join(', ')}</span> : null}
            </span>
          ))}
          <span style={{ fontSize: 10.5, color: T.faint }}>(relative-momentum proxy over {vm.flows[0].weeks} weeks, not fund-flow data)</span>
        </div>
      ) : null}
    </div>
  );
}

const linkBtn = (c: string): React.CSSProperties => ({ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c, fontWeight: 800, fontSize: 11.5, textDecoration: 'underline', textDecorationStyle: 'dotted' });
