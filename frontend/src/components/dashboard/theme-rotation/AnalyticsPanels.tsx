'use client';
// ═══════════════════════════════════════════════════════════════════════════
// MORE ANALYTICS (zzz797) — each panel traceable to data already on the page:
//   · Your exposure — holdings weighted by their theme's verdict; holdings in
//     breakdown / TRIM / AVOID themes with their own 1-month move; the names
//     still without a theme and why; cash / non-US lines left out.
//   · Breadth heatmap — themes × % above the 20 / 50 / 200-day lines and new
//     52-week highs minus lows, with the sample size.
//   · Themes that move together — the "moves with" correlation clusters.
//   · Weekly change log — verdict and priority changes, week by week.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import type { HeatRow, ClusterGroup, ExposureModel } from '@/lib/theme-rotation/analytics';
import type { ChangeLogWeek } from '@/lib/theme-rotation/history';
import { NameChips, VerdictBadge, card } from './ui';
import { T, VERDICT_TONE, fmtPct, tint } from './tokens';

const head: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' };

function Section({ title, hint, children, defaultOpen = false }: { title: string; hint?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ ...card, marginTop: 12 }}>
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} style={head}>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>{open ? '▾' : '▸'} {title}</span>
        {hint ? <span style={{ fontSize: 11, color: T.faint }}>{hint}</span> : null}
      </button>
      {open ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </div>
  );
}

// ── YOUR EXPOSURE ──────────────────────────────────────────────────────────
export function ExposurePanel({ model, nameOf, onPick, source }: { model: ExposureModel; nameOf: (id: string) => string; onPick: (id: string) => void; source: string }) {
  const hint = model.total ? `${model.total} holding${model.total === 1 ? '' : 's'} · ${model.atRisk.length} in breakdown / TRIM / AVOID themes · ${model.unmatched.length} without a theme` : 'no holdings on this device';
  return (
    <Section title="Your exposure" hint={hint} defaultOpen={model.atRisk.length > 0}>
      {!model.total ? <div style={{ fontSize: 11.5, color: T.faint }}>No holdings found for this market ({source || 'no portfolio source'}). Lists are research, not positions, and are not counted here.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.faint, marginBottom: 4 }}>Share of holdings by the verdict of their theme — {model.note}</div>
            <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', border: `1px solid ${T.border}` }} role="img" aria-label="Holdings by theme verdict">
              {model.byVerdict.filter((b) => b.weight > 0).map((b) => (
                <span key={b.verdict} title={`${b.verdict}: ${b.weight}% (${b.count}) — ${b.tickers.join(', ')}`} style={{ width: `${b.weight}%`, background: b.verdict === 'No theme' ? T.absent : VERDICT_TONE[b.verdict] || T.flat, opacity: 0.85 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5, fontSize: 11, color: T.dim }}>
              {model.byVerdict.map((b) => (
                <span key={b.verdict}><span style={{ color: b.verdict === 'No theme' ? T.absent : VERDICT_TONE[b.verdict] || T.flat, fontWeight: 900 }}>■ {b.verdict}</span> {b.weight}% <span style={{ color: T.faint }}>({b.count})</span></span>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: T.text, marginBottom: 3 }}>Holdings in breakdown / TRIM / AVOID themes</div>
            {model.atRisk.length ? (
              <div style={{ display: 'grid', gap: 2 }}>
                {model.atRisk.map((h) => (
                  <div key={h.ticker} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5, color: T.dim }}>
                    <b style={{ color: T.text, minWidth: 80 }}>{h.ticker}</b>
                    <span style={{ fontFamily: T.mono, color: h.m1 == null ? T.faint : h.m1 >= 0 ? T.up : T.down, minWidth: 64 }} title="The holding's own 1-month price move">1M {fmtPct(h.m1)}</span>
                    <button type="button" onClick={() => onPick(h.theme)} style={lnk}>{nameOf(h.theme)}</button>
                    <VerdictBadge verdict={h.verdict} />
                    <span style={{ color: T.faint }}>{h.reason}</span>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>The theme's weakness is not the stock's: check each name's own chart — a holding up on the month inside a weak theme is holding up on its own.</div>
              </div>
            ) : <div style={{ fontSize: 11.5, color: T.faint }}>None — no holding sits in a theme rated TRIM / AVOID or flagged for a breakdown.</div>}
          </div>

          {model.unmatched.length ? (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: T.text, marginBottom: 3 }}>Still without a theme · {model.unmatched.length}</div>
              <div style={{ display: 'grid', gap: 1 }}>
                {model.unmatched.map((u) => <div key={u.ticker} style={{ fontSize: 11, color: T.dim }}><b style={{ color: T.text }}>{u.ticker}</b> <span style={{ color: T.faint }}>— {u.reason}</span></div>)}
              </div>
            </div>
          ) : null}
          {model.excluded.length ? (
            <div style={{ fontSize: 11, color: T.faint, lineHeight: 1.45 }}>
              <b>Not counted:</b> {model.excluded.map((x) => `${x.ticker} (${x.reason})`).join(' · ')}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// ── BREADTH HEATMAP ────────────────────────────────────────────────────────
const heat = (p: number | null) => (p == null ? 'transparent' : p >= 50 ? tint(T.up, Math.round(10 + (p - 50) * 1.1)) : tint(T.down, Math.round(10 + (50 - p) * 1.1)));

export function BreadthHeatmap({ rows, nameOf, onPick }: { rows: HeatRow[]; nameOf: (id: string) => string; onPick: (id: string) => void }) {
  const [sort, setSort] = useState<'p20' | 'p50' | 'p200' | 'hiLo'>('p50');
  const sorted = [...rows].sort((a, b) => ((b[sort] ?? -999) as number) - ((a[sort] ?? -999) as number));
  const cell = (p: number | null, sub?: string, low?: boolean) => (
    <td style={{ padding: '3px 6px', textAlign: 'center', fontFamily: T.mono, fontSize: 11, background: heat(p), color: p == null ? T.faint : T.text, opacity: low ? 0.55 : 1 }} title={sub}>{p == null ? '—' : `${p}%`}</td>
  );
  const th = (k: typeof sort, label: string, title: string) => (
    <th scope="col" style={{ padding: '3px 6px', fontSize: 10, color: sort === k ? T.text : T.faint, fontWeight: sort === k ? 900 : 700, whiteSpace: 'nowrap' }}>
      <button type="button" title={title} onClick={() => setSort(k)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>{label}{sort === k ? ' ▼' : ''}</button>
    </th>
  );
  return (
    <Section title="Breadth heatmap" hint={`${rows.length} themes with constituent breadth · % of each theme's stocks above their own moving averages`}>
      {!rows.length ? <div style={{ fontSize: 11.5, color: T.faint }}>No constituent breadth this build.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 420 }}>
            <thead>
              <tr>
                <th scope="col" style={{ padding: '3px 6px', textAlign: 'left', fontSize: 10, color: T.faint }}>Theme</th>
                <th scope="col" style={{ padding: '3px 6px', fontSize: 10, color: T.faint }} title="Stocks priced — the sample size">n</th>
                {th('p20', '> 20-day', 'Short term: % above the 20-day line')}
                {th('p50', '> 50-day', 'Medium term: % above the 50-day line')}
                {th('p200', '> 200-day', 'Long term: % above the 200-day line (of names with 200 days of history)')}
                {th('hiLo', 'Highs − lows', 'Names near 52-week highs minus names near 52-week lows')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}><button type="button" onClick={() => onPick(r.id)} style={{ ...lnk, color: T.dim, fontWeight: 700 }}>{nameOf(r.id)}</button></td>
                  <td style={{ padding: '3px 6px', textAlign: 'center', fontFamily: T.mono, fontSize: 10.5, color: r.lowConfidence ? T.warn : T.faint }} title={r.lowConfidence ? 'Fewer than 5 stocks — low confidence' : undefined}>{r.n}{r.lowConfidence ? '*' : ''}</td>
                  {cell(r.p20, undefined, r.lowConfidence)}
                  {cell(r.p50, undefined, r.lowConfidence)}
                  {cell(r.p200, r.n200 != null ? `of ${r.n200} with 200 days of history` : undefined, r.lowConfidence)}
                  <td style={{ padding: '3px 6px', textAlign: 'center', fontFamily: T.mono, fontSize: 11, color: r.hiLo == null ? T.faint : r.hiLo > 0 ? T.up : r.hiLo < 0 ? T.down : T.flat, opacity: r.lowConfidence ? 0.55 : 1 }}>{r.hiLo == null ? '—' : `${r.hiLo > 0 ? '+' : ''}${r.hiLo}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: T.faint, marginTop: 5, lineHeight: 1.45 }}>Green = most of the theme's stocks above that line; red = most below. * fewer than 5 stocks priced — a hint, not a measurement (faded). Up to 12 constituents per theme, daily prices from Yahoo Finance.</div>
        </div>
      )}
    </Section>
  );
}

// ── CLUSTERS ───────────────────────────────────────────────────────────────
export function ClusterPanel({ groups, nameOf, onPick }: { groups: ClusterGroup[]; nameOf: (id: string) => string; onPick: (id: string) => void }) {
  return (
    <Section title="Themes that move together" hint={groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'} of correlated themes` : 'no strongly correlated groups'}>
      {!groups.length ? <div style={{ fontSize: 11.5, color: T.faint }}>No two themes moved together closely enough (daily correlation 0.8+ over 6 months) to group.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {groups.map((g) => (
            <div key={g.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 9px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.text, marginBottom: 3 }}>The {g.label} group <span style={{ color: T.faint, fontWeight: 600 }}>· {g.members.length}</span></div>
              <NameChips names={g.members} n={6} onPick={onPick} render={nameOf} />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {Object.entries(g.verdicts).map(([v, n]) => <span key={v} style={{ fontSize: 10.5, color: VERDICT_TONE[v] || T.faint }}>{v} ×{n}</span>)}
              </div>
              <div style={{ fontSize: 10.5, color: T.faint, marginTop: 3, lineHeight: 1.4 }}>{g.note}</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── WEEKLY CHANGE LOG ──────────────────────────────────────────────────────
export function ChangeLogPanel({ weeks, stored, nameOf, onPick }: { weeks: ChangeLogWeek[]; stored: number; nameOf: (id: string) => string; onPick: (id: string) => void }) {
  return (
    <Section title="Weekly change log" hint={weeks.length ? `${weeks.length} week${weeks.length === 1 ? '' : 's'} compared` : `starts once two weeks are stored (now ${stored})`}>
      {!weeks.length ? <div style={{ fontSize: 11.5, color: T.faint }}>The board saves one snapshot per week. The log starts once two weeks are stored — {stored} so far. Nothing is back-filled or estimated.</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {weeks.map((w) => (
            <div key={w.week}>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: T.text }}>{w.week} <span style={{ color: T.faint, fontWeight: 600 }}>vs {w.previousWeek}</span></div>
              {!w.changes.length ? <div style={{ fontSize: 11, color: T.faint }}>No verdict or priority changes.</div> : (
                <div style={{ display: 'grid', gap: 1 }}>
                  {w.changes.map((c, i) => (
                    <div key={`${c.id}-${c.kind}-${i}`} style={{ fontSize: 11, color: T.dim }}>
                      <span style={{ color: c.dir === 'up' ? T.up : T.down }}>{c.dir === 'up' ? '▲' : '▼'}</span>{' '}
                      <button type="button" onClick={() => onPick(c.id)} style={{ ...lnk, color: T.dim }}>{nameOf(c.id)}</button>{' '}
                      <span style={{ color: T.faint }}>{c.kind === 'verdict' ? 'verdict' : 'priority'}</span> {c.from} → <b>{c.to}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

const lnk: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.accent, fontWeight: 800, fontSize: 11.5, textDecoration: 'underline', textDecorationStyle: 'dotted', textAlign: 'left' };
