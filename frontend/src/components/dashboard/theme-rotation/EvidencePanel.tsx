'use client';
// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE PANEL (zzz795) — opens under a theme row. Everything a conclusion
// rests on, traceable: the seven layers with their sources, the dated items
// (graded prints, filings, news) with links, which constituents are gaining or
// losing strength, the sub-theme split, names on your lists, links to other
// themes, and the weekly history of the call.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import type { CrossFlow, EvidenceLink, Tier, WeeklySnapshot } from '@/lib/theme-rotation/types';
import { TIER_LABEL } from '@/lib/theme-rotation/types';
import type { ThemeView } from '@/lib/theme-rotation/view-model';
import type { ListEntry } from '@/lib/theme-rotation/lists';
import { LAYER_NAME, LAYER_ORDER } from '@/lib/theme-rotation/layers';
import { NameChips, Pill, VerdictBadge } from './ui';
import { STATE_META, T, TIER_TONE, fmtPct, tint } from './tokens';

export interface EvidencePanelProps {
  v: ThemeView;
  drill: any | undefined;
  drillLoading: boolean;
  onRetryDrill: () => void;
  listNames: ListEntry[];
  flows: CrossFlow[];
  clusterPeers: string[];
  snapshots: WeeklySnapshot[];
  nameOf: (id: string) => string;
  onPick: (id: string) => void;
}

const sub: React.CSSProperties = { fontSize: 10, fontWeight: 900, letterSpacing: 0.6, color: T.faint, textTransform: 'uppercase', margin: '10px 0 5px' };

function EvidenceList({ items, max = 4 }: { items: EvidenceLink[]; max?: number }) {
  const [all, setAll] = React.useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, max);
  return (
    <ul style={{ listStyle: 'none', margin: '5px 0 0', padding: 0, display: 'grid', gap: 2 }}>
      {shown.map((e, i) => {
        const c = e.tone === 'pos' ? T.up : e.tone === 'neg' ? T.down : T.flat;
        return (
          <li key={i} style={{ fontSize: 11, color: T.dim, display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ color: T.faint, fontFamily: T.mono, fontSize: 10, flexShrink: 0 }}>{e.date || '—'}</span>
            <span style={{ color: c, flexShrink: 0 }}>{e.tone === 'neg' ? '▼' : e.tone === 'pos' ? '▲' : '●'}</span>
            {e.url
              ? <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: T.dim, textDecoration: 'underline', textDecorationColor: tint(T.faint, 50), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{e.label}</a>
              : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{e.label} <span style={{ color: T.faint }}>(no link)</span></span>}
          </li>
        );
      })}
      {items.length > max && (
        <li><button type="button" onClick={() => setAll((x) => !x)} style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 11, padding: 0 }}>{all ? 'show fewer' : `+${items.length - max} more`}</button></li>
      )}
    </ul>
  );
}

export function EvidencePanel({ v, drill, drillLoading, onRetryDrill, listNames, flows, clusterPeers, snapshots, nameOf, onPick }: EvidencePanelProps) {
  const { row, a, trend } = v;
  const stocks: any[] = Array.isArray(drill?.stocks) ? drill.stocks : [];
  const subs: any[] = Array.isArray(drill?.subs) ? drill.subs.filter((s: any) => !s.residual) : [];
  const hasChange = stocks.some((s) => typeof s.rsChange === 'number');
  const gaining = hasChange ? stocks.filter((s) => s.strengthTrend === 'gaining').sort((x, y) => y.rsChange - x.rsChange) : [];
  const losing = hasChange ? stocks.filter((s) => s.strengthTrend === 'losing').sort((x, y) => x.rsChange - y.rsChange) : [];
  const onList = new Set(listNames.map((e) => e.ticker));
  const fmtStock = (s: any) => `${s.sym}${onList.has(String(s.sym).toUpperCase()) ? ' ★' : ''} (${s.rsChange > 0 ? '+' : ''}${typeof s.rsChange === 'number' ? s.rsChange.toFixed(0) : '?'} pts)`;
  const weeks = snapshots.map((s) => ({ week: s.week, tier: s.overlay?.[row.id]?.t as Tier | undefined, verdict: s.base?.[row.id]?.v })).filter((w) => w.tier || w.verdict);

  return (
    <div className="trt-evidence" style={{ padding: '10px 4px 12px', display: 'grid', gap: 2 }}>
      {/* The call and why */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <VerdictBadge verdict={row.verdict} note={row.verdictNote} />
        <span style={{ fontSize: 11.5, color: T.dim, flex: 1, minWidth: 220, lineHeight: 1.45 }}>{row.verdictNote || 'No verdict note.'}</span>
      </div>
      {a.flags.length ? (
        <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
          {a.flags.map((f) => (
            <div key={f.kind} style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.45 }}>
              <Pill color={f.kind === 'early-rotation' ? T.accent : f.kind === 'breakdown' ? T.down : T.warn}>{f.label}</Pill> {f.why}
            </div>
          ))}
        </div>
      ) : null}

      {/* The seven layers */}
      <div style={sub}>Evidence layers — each read separately</div>
      <div className="trt-layer-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 6 }}>
        {LAYER_ORDER.map((k) => {
          const r = a.layers[k];
          const m = STATE_META[r.state];
          const stateWord = k === 'valuation' ? (r.level ? 'level only' : 'not available') : m.word;
          return (
            <div key={k} style={{ background: T.card2, border: `1px solid ${T.border}`, borderLeft: `3px solid ${k === 'valuation' ? T.flat : m.color}`, borderRadius: 7, padding: '6px 8px', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: T.text }}>{LAYER_NAME[k]}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: k === 'valuation' ? T.faint : m.color }}>{k === 'valuation' ? '' : m.glyph} {stateWord}</span>
              </div>
              <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2, lineHeight: 1.4 }}>{r.headline}</div>
              {r.detail ? <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2, lineHeight: 1.4 }}>{r.detail}</div> : null}
              <div style={{ fontSize: 9.5, color: T.faint, marginTop: 3, fontStyle: 'italic' }}>Source: {r.source}</div>
              {r.evidence?.length ? <EvidenceList items={r.evidence} /> : null}
            </div>
          );
        })}
      </div>

      {/* Constituents */}
      <div style={sub}>Constituents</div>
      {drillLoading && !drill ? <div style={{ fontSize: 11.5, color: T.faint }}>Loading {row.name} constituents…</div> : null}
      {drill?.error ? <div style={{ fontSize: 11.5, color: T.down }}>{drill.error} <button type="button" onClick={onRetryDrill} style={{ background: 'none', border: `1px solid ${T.border2}`, color: T.dim, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>Retry</button></div> : null}
      {drill?.note ? <div style={{ fontSize: 11.5, color: T.faint }}>{drill.note}</div> : null}
      {stocks.length ? (
        <div style={{ display: 'grid', gap: 5 }}>
          {hasChange ? (
            <>
              <div style={{ fontSize: 11.5, color: T.dim }}><span style={{ color: T.up, fontWeight: 900 }}>Gaining strength</span> <span style={{ color: T.faint }}>(3-month relative strength vs a month ago)</span>: <NameChips names={gaining.map(fmtStock)} n={5} color={T.up} /></div>
              <div style={{ fontSize: 11.5, color: T.dim }}><span style={{ color: T.down, fontWeight: 900 }}>Losing strength</span>: <NameChips names={losing.map(fmtStock)} n={5} color={T.down} /></div>
            </>
          ) : null}
          <div style={{ fontSize: 11.5, color: T.dim }}>
            <span style={{ fontWeight: 900 }}>Strongest now</span> <span style={{ color: T.faint }}>(✓ = above its 50-day line and beating the benchmark)</span>:{' '}
            <NameChips names={stocks.map((s) => `${s.buyReady ? '✓ ' : ''}${s.sym} ${fmtPct(s.m3, 0)}`)} n={8} />
          </div>
          {subs.length >= 2 ? (
            <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
              <div style={{ fontSize: 11, color: T.faint }}>Sub-themes, strongest first — the theme is rarely one trade:</div>
              {subs.map((s: any) => {
                const val = typeof s.rs3m === 'number' ? s.rs3m : 0;
                const mx = Math.max(1, ...subs.map((x: any) => Math.abs(x.rs3m ?? 0)));
                const w = Math.min(50, (Math.abs(val) / mx) * 50);
                const c = val >= 0 ? T.up : T.down;
                return (
                  <div key={s.name} className="trt-sub" style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 190px) 1fr auto', gap: 6, alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.symbols?.join(', ')}>{s.name} <span style={{ color: T.faint }}>({s.count})</span></span>
                    <span style={{ position: 'relative', height: 8, minWidth: 40 }}>
                      <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: T.border2 }} />
                      <span style={{ position: 'absolute', top: 1, bottom: 1, borderRadius: 2, background: c, opacity: 0.8, ...(val >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }) }} />
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, whiteSpace: 'nowrap' }}>{val > 0 ? '+' : ''}{val.toFixed(0)} pts · {s.buyReady}/{s.count} confirmed</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (!drillLoading && drill && !drill.error && !drill.note ? <div style={{ fontSize: 11.5, color: T.faint }}>No constituent prices came back.</div> : null)}

      {/* Your names */}
      <div style={sub}>Names on your lists in this theme</div>
      {listNames.length
        ? <NameChips names={listNames.map((e) => `${e.held ? '● ' : ''}${e.ticker}${e.benchTier ? (/BLOCK/i.test(e.benchTier) ? ' BB' : ' STR') : ''}${e.grade ? ` ${e.grade}` : ''}`)} n={8} />
        : <span style={{ fontSize: 11.5, color: T.faint }}>None of your names map to this theme.</span>}
      {listNames.some((e) => e.held) ? <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>● = a holding. BB / STR = last graded print BLOCKBUSTER / STRONG.</div> : null}

      {/* Cross-theme links */}
      <div style={sub}>Links to other themes</div>
      <div style={{ display: 'grid', gap: 3, fontSize: 11.5, color: T.dim }}>
        {flows.map((f) => (
          <div key={`${f.from}>${f.to}`} style={{ lineHeight: 1.45 }}>
            {f.to === row.id ? <>Money appears to be rotating <b>in</b> from <button type="button" onClick={() => onPick(f.from)} style={lnk}>{nameOf(f.from)}</button>.</> : <>Money appears to be rotating <b>out</b> to <button type="button" onClick={() => onPick(f.to)} style={lnk}>{nameOf(f.to)}</button>.</>}
            {f.beneficiaries.length && f.to === row.id ? <> Second-order beneficiaries here: {f.beneficiaries.join(', ')}.</> : null}
            <span style={{ color: T.faint }}> {f.why}</span>
          </div>
        ))}
        {clusterPeers.length ? <div>Moves with: <NameChips names={clusterPeers} n={4} onPick={onPick} render={nameOf} /> <span style={{ color: T.faint }}>— owning several is closer to one position than to several.</span></div> : null}
        {!flows.length && !clusterPeers.length ? <span style={{ color: T.faint }}>No rotation into or out of this theme detected, and no closely correlated themes.</span> : null}
      </div>

      {/* History */}
      <div style={sub}>History</div>
      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.45 }}>
        <b style={{ color: trend.dir === 'up' ? T.up : trend.dir === 'down' ? T.down : T.flat }}>{trend.word === 'unknown' ? 'Not enough history' : `${trend.word[0].toUpperCase()}${trend.word.slice(1)}`}</b> — {trend.note}
      </div>
      {weeks.length ? (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
          {weeks.map((w) => (
            <span key={w.week} title={`${w.week}: ${w.tier ? TIER_LABEL[w.tier] : 'no tier stored'}${w.verdict ? ` · ${w.verdict}` : ''}`}
              style={{ fontSize: 9.5, fontFamily: T.mono, padding: '1px 5px', borderRadius: 4, color: w.tier ? TIER_TONE[w.tier] : T.faint, border: `1px solid ${tint(w.tier ? TIER_TONE[w.tier] : T.faint, 40)}` }}>
              {w.week.slice(5)} {w.tier ? TIER_LABEL[w.tier].split(' ')[0] : w.verdict}
            </span>
          ))}
        </div>
      ) : <div style={{ fontSize: 10.5, color: T.faint }}>Weekly history starts this week; the trend word above uses the 8-week relative-strength tail meanwhile.</div>}

      {/* Data notes */}
      <div style={{ fontSize: 10, color: T.faint, marginTop: 8, lineHeight: 1.45 }}>
        Priced from {row.sourceKind === 'proxy' ? `${row.proxy}${row.proxySource === 'nse-published' ? ' (NSE published closes)' : ''}` : row.sourceKind === 'proxy-fallback' ? `an equal-weight basket (${row.proxy} unusable: ${row.fallbackReason || 'series problem'})` : 'an equal-weight basket of its leaders'}.
      </div>
    </div>
  );
}

const lnk: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: T.accent, fontWeight: 800, fontSize: 11.5, textDecoration: 'underline', textDecorationStyle: 'dotted' };
