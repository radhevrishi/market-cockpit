'use client';
// ═══════════════════════════════════════════════════════════════════════════
// NAMES ON YOUR LISTS, BY THEME (zzz795) — collapsed by default.
//
// Honest about what it counts: Technicals uploads, Multibagger uploads and the
// Conviction bench are research LISTS, not holdings. Holdings (India portfolio
// page, US book) are shown separately and only they get an exposure sentence.
// Each theme shows its best few names with "+N more", never a wall of 80.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import type { Market } from '@/lib/theme-rotation/types';
import type { ThemeView } from '@/lib/theme-rotation/view-model';
import type { BestSupported, HoldingsExposure, ListEntry } from '@/lib/theme-rotation/lists';
import { NameChips, Pill, VerdictBadge, card } from './ui';
import { T, tint } from './tokens';

export interface ListsByThemeProps {
  region: Market;
  entries: ListEntry[];
  groups: Array<{ v: ThemeView; names: ListEntry[] }>;
  unclassified: ListEntry[];
  holdings: HoldingsExposure;
  holdingsSource: string;
  holdingsNote: string | null;
  best: BestSupported;
  nameOf: (id: string) => string;
  onPick: (id: string) => void;
  resolving: number;
  tv: { busy: boolean; done: boolean; count: number; onCopy: () => void; scope: 'combo' | 'hold' | 'all'; setScope: (s: 'combo' | 'hold' | 'all') => void };
}

const label = (e: ListEntry) => `${e.held ? '● ' : ''}${e.ticker}${e.benchTier ? (/BLOCK/i.test(e.benchTier) ? ' BB' : ' STR') : ''}${e.grade ? ` ${e.grade}` : ''}`;

export function ListsByTheme(p: ListsByThemeProps) {
  const [open, setOpen] = useState(false);
  const counts = {
    tech: p.entries.filter((e) => e.inTech).length,
    fundo: p.entries.filter((e) => e.inFundo).length,
    bench: p.entries.filter((e) => e.inBench).length,
    graded: p.entries.filter((e) => e.grade).length,
  };
  const listed = p.entries.filter((e) => e.inTech || e.inFundo || e.inBench).length;
  const byName = p.entries.filter((e) => e.via === 'name' || e.via === 'ticker').length;
  return (
    <div style={{ ...card, marginTop: 12 }}>
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>{open ? '▾' : '▸'} Names on your lists, by theme</span>
        <span style={{ fontSize: 11, color: T.faint }}>
          {listed} names on your lists · {p.holdings.total} holding{p.holdings.total === 1 ? '' : 's'} · {p.unclassified.length} without a theme
        </span>
      </button>

      {/* Holdings sentence is always visible: it is the one that matters. */}
      <div style={{ fontSize: 11.5, color: T.dim, marginTop: 6, lineHeight: 1.45 }}>
        {p.holdings.total
          ? <><b>Your holdings</b> ({p.holdingsSource}): {p.holdings.line}{p.holdings.atRisk.length ? <> At risk: <b style={{ color: T.down }}>{p.holdings.atRisk.slice(0, 8).join(', ')}{p.holdings.atRisk.length > 8 ? ` +${p.holdings.atRisk.length - 8}` : ''}</b>.</> : null}</>
          : <><b>Your holdings:</b> none found for {p.region === 'us' ? 'the US' : 'India'} on this device ({p.holdingsSource || 'no portfolio source'}). The counts below are research lists, not positions.</>}
        {p.holdingsNote ? <span style={{ color: T.warn }}> {p.holdingsNote}</span> : null}
      </div>

      {open && (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 11, color: T.faint, lineHeight: 1.5 }}>
            From your Technicals upload ({counts.tech}), Multibagger upload ({counts.fundo}, {counts.graded} with a Fundo grade) and the {p.region === 'us' ? 'US' : 'India'} Conviction bench ({counts.bench}).
            Each name is placed by its industry; {byName ? `${byName} were matched by company name or ticker because no industry was found (less certain). ` : ''}
            ● = holding · BB / STR = last graded print BLOCKBUSTER / STRONG. {p.resolving ? `Looking up industries for ${p.resolving} more names…` : ''}
          </div>

          {/* Best-supported names — the honest replacement for the Dummy Portfolio */}
          <div style={{ background: T.card2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: T.text, marginBottom: 3 }}>Best-supported names in favoured themes</div>
            {p.best.declined
              ? <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.45 }}>{p.best.declined}</div>
              : (
                <>
                  <div style={{ fontSize: 10.5, color: T.faint, marginBottom: 5 }}>
                    Themes rated BUY / EARLY BUY and not flagged for a breakdown · ranked by {p.best.rankedBy === 'grade' ? 'your Fundo grade' : p.best.rankedBy === 'print' ? 'graded earnings prints (tier, then recency)' : 'Fundo grade and graded prints'} · at most 3 per theme · {p.best.eligible - p.best.picks.length} other eligible names had no quality data or hit the cap. A research list, not advice.
                  </div>
                  <div style={{ display: 'grid', gap: 2 }}>
                    {p.best.picks.map((e, i) => (
                      <div key={e.ticker} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: T.dim, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ color: T.faint, fontFamily: T.mono, width: 18 }}>{i + 1}</span>
                        <b style={{ color: T.text, minWidth: 80 }}>{e.held ? '● ' : ''}{e.ticker}</b>
                        <button type="button" onClick={() => e.theme && p.onPick(e.theme)} style={{ background: 'none', border: 'none', padding: 0, color: T.accent, cursor: 'pointer', fontSize: 11.5 }}>{e.theme ? p.nameOf(e.theme) : ''}</button>
                        <span style={{ color: T.faint }}>{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
          </div>

          {/* Per-theme groups */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {p.groups.map(({ v, names }) => (
              <div key={v.row.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 9px', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
                  <button type="button" onClick={() => p.onPick(v.row.id)} style={{ background: 'none', border: 'none', padding: 0, color: T.text, fontWeight: 800, fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>{v.row.emoji} {v.row.name}</button>
                  <span style={{ fontSize: 10.5, color: T.faint }}>{names.length}</span>
                  <span style={{ flex: 1 }} />
                  <VerdictBadge verdict={v.row.verdict} note={v.row.verdictNote} />
                  {v.a.flags.filter((f) => f.kind !== 'defensive').slice(0, 1).map((f) => <Pill key={f.kind} color={f.kind === 'breakdown' ? T.down : f.kind === 'early-rotation' ? T.accent : T.warn} style={{ fontSize: 9 }}>{f.label}</Pill>)}
                </div>
                <NameChips names={names.map(label)} n={6} />
              </div>
            ))}
          </div>

          {p.unclassified.length ? (
            <div style={{ border: `1px dashed ${T.border2}`, borderRadius: 8, padding: '7px 9px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.dim, marginBottom: 3 }}>No theme yet · {p.unclassified.length}</div>
              <div style={{ fontSize: 10.5, color: T.faint, marginBottom: 5, lineHeight: 1.45 }}>
                No industry, company name or ticker pattern placed these. {p.region === 'india' ? 'Industries are looked up in the background and kept for good, so this list shrinks over visits. BSE numeric codes cannot be looked up.' : 'US names need a sector or industry on the bench row or upload.'}
              </div>
              <NameChips names={p.unclassified.map(label)} n={10} />
            </div>
          ) : null}

          {/* TradingView export */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: T.faint }}>Copy to TradingView:</span>
            {(['combo', 'hold', 'all'] as const).map((k) => (
              <button key={k} type="button" onClick={() => p.tv.setScope(k)} aria-pressed={p.tv.scope === k}
                style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${p.tv.scope === k ? T.accent : T.border}`, background: p.tv.scope === k ? tint(T.accent, 15) : 'transparent', color: p.tv.scope === k ? T.accent : T.faint }}>
                {k === 'combo' ? 'BB/STRONG in BUY themes' : k === 'hold' ? '+ HOLD themes' : 'all names'}
              </button>
            ))}
            <button type="button" onClick={p.tv.onCopy} disabled={p.tv.busy || !p.tv.count}
              style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 6, cursor: p.tv.count ? 'pointer' : 'not-allowed', border: `1px solid ${p.tv.done ? T.up : T.border2}`, background: 'transparent', color: p.tv.done ? T.up : p.tv.count ? T.dim : T.faint }}>
              {p.tv.busy ? 'Copying…' : p.tv.done ? 'Copied' : `Copy ${p.tv.count} names`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
