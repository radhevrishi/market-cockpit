'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { AutoAcronyms } from '@/components/bottom-nav';
import { useState, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { DRILLDOWN, TIER_MAP, QUAL_STAGE_CONFIG } from './constants';
import { cleanUrl, timeAgo } from './helpers';
import { type NewsArticle } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — DRILLDOWN KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════════

export function DrilldownKB({ articles }: { articles: NewsArticle[] }) {
  const [active, setActive] = useState<string | null>(null);
  const entry = active ? DRILLDOWN[active] : null;
  const bucketArticles = useMemo(() => active ? articles.filter(a => a.bottleneck_sub_tag === active).slice(0, 10) : [], [articles, active]);

  return (
    <div style={{ padding: '20px' }}>
      {/* Category grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: active ? '20px' : 0 }}>
        {Object.entries(DRILLDOWN).map(([key, e]) => {
          const tier = TIER_MAP[key];
          const isAct = active === key;
          return (
            <button key={key} onClick={() => setActive(isAct ? null : key)} style={{
              textAlign: 'left', padding: '14px', borderRadius: '10px', cursor: 'pointer',
              border: `1px solid ${isAct ? (tier?.color ?? 'var(--mc-accent)') + '60' : 'var(--mc-bg-4)'}`,
              backgroundColor: isAct ? (tier?.color ?? 'var(--mc-accent)') + '12' : 'var(--mc-bg-1)',
              transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>{e.icon}</div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: isAct ? 'var(--mc-text-0)' : 'var(--mc-text-2)', marginBottom: '4px' }}>{e.label}</div>
              {tier && <div style={{ fontSize: '10px', color: tier.color, fontWeight: '600' }}>{tier.label}</div>}
            </button>
          );
        })}
      </div>

      {/* Drilldown panel */}
      {entry && active && (
        <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mc-bg-4)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '28px' }}>{entry.icon}</span>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '800', color: 'var(--mc-text-0)', margin: 0 }}>{entry.label}</h2>
              {TIER_MAP[active] && <span style={{ fontSize: '11px', color: TIER_MAP[active].color }}>{TIER_MAP[active].label}</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0' }}>
            {/* Why section */}
            <div style={{ padding: '16px 20px', borderRight: '1px solid var(--mc-bg-4)' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>WHY IT'S A BOTTLENECK</p>
              {/* PATCH 1085 — AutoAcronyms wraps so HBM/GPU/TAM/EUV/CoWoS/etc.
                  surface tooltips. */}
              <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.6', margin: 0 }}><AutoAcronyms text={entry.why} /></p>
            </div>
            {/* Supply / Demand */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <p style={{ fontSize: '10px', color: 'var(--mc-bearish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 6px' }}>SUPPLY CONSTRAINT</p>
                <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.6', margin: 0 }}><AutoAcronyms text={entry.supply} /></p>
              </div>
              <div>
                <p style={{ fontSize: '10px', color: 'var(--mc-bullish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 6px' }}>DEMAND DRIVER</p>
                <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.6', margin: 0 }}><AutoAcronyms text={entry.demand} /></p>
              </div>
            </div>
          </div>

          {/* Winners / Losers */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--mc-bg-4)', display: 'grid', gridTemplateColumns: entry.losers.length > 0 ? '1fr 1fr' : '1fr', gap: '16px' }}>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--mc-bullish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>🏆 WINNERS</p>
              {entry.winners.map(w => (
                <div key={w.ticker} style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '8px 12px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 13%, transparent)', borderRadius: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--mc-bullish)', minWidth: '52px' }}>{w.ticker}</span>
                  <span style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}><AutoAcronyms text={w.thesis} /></span>
                </div>
              ))}
            </div>
            {entry.losers.length > 0 && (
              <div>
                <p style={{ fontSize: '10px', color: 'var(--mc-bearish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>⚠️ RISKS / LOSERS</p>
                {entry.losers.map(l => (
                  <div key={l.ticker} style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '8px 12px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 13%, transparent)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--mc-bearish)', minWidth: '52px' }}>{l.ticker}</span>
                    <span style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}><AutoAcronyms text={l.thesis} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Structured thesis: confirms / breaks / KPIs */}
          <div style={{ padding: '0 20px 16px', borderTop: '1px solid var(--mc-bg-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', paddingTop: '16px' }}>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--mc-bullish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>✅ WHAT CONFIRMS THESIS</p>
              {entry.confirms.map((c, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}><span style={{ color: 'var(--mc-bullish)', flexShrink: 0 }}>›</span><AutoAcronyms text={c} /></div>)}
            </div>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--mc-bearish)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>❌ WHAT BREAKS THESIS</p>
              {entry.breaks.map((b, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}><span style={{ color: 'var(--mc-bearish)', flexShrink: 0 }}>›</span><AutoAcronyms text={b} /></div>)}
            </div>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--mc-warn)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 8px' }}>📊 WATCH THESE KPIs</p>
              {entry.watch_kpi.map((k, i) => <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '5px', fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}><span style={{ color: 'var(--mc-warn)', flexShrink: 0 }}>›</span><AutoAcronyms text={k} /></div>)}
            </div>
          </div>

          {/* Contradiction Engine — evidence that would specifically WEAKEN (not destroy) thesis */}
          {entry.contradictions && entry.contradictions.length > 0 && (
            <div style={{ padding: '14px 20px 16px', borderTop: '1px solid var(--mc-bg-4)', backgroundColor: '#0A0F1A' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-warn)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>
                ⚡ CONTRADICTION ENGINE — what evidence would WEAKEN this thesis
              </p>
              <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '0 0 10px' }}>
                These are NOT thesis-breakers but thesis-weakeners — signals that reduce conviction without invalidating the position.
                Monitor for these before adding to or trimming positions.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
                {entry.contradictions.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 12px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 2%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)', borderRadius: '6px', fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.5' }}>
                    <span style={{ color: 'var(--mc-warn)', flexShrink: 0, marginTop: '1px' }}>⚠</span>
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Causal Chain — second-order idea generation */}
          {entry.causal_chain && entry.causal_chain.length > 0 && (
            <div style={{ padding: '14px 20px 16px', borderTop: '1px solid var(--mc-bg-4)' }}>
              <p style={{ fontSize: '10px', color: '#06B6D4', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>
                🔗 CAUSAL CHAIN — second-order investment ideas
              </p>
              {entry.causal_chain.map((chain, i) => (
                <div key={i} style={{ fontSize: '11px', color: 'var(--mc-text-2)', lineHeight: '1.6', padding: '10px 14px', backgroundColor: '#06B6D408', border: '1px solid #06B6D420', borderRadius: '8px', marginBottom: '6px' }}>
                  {chain.split('→').map((step, si, arr) => (
                    <span key={si}>
                      <span style={{ color: si === 0 ? 'var(--mc-bearish)' : si === arr.length-1 ? 'var(--mc-bullish)' : 'var(--mc-text-2)', fontWeight: si === 0 || si === arr.length-1 ? '700' : '400' }}>{step.trim()}</span>
                      {si < arr.length-1 && <span style={{ color: '#06B6D4', margin: '0 6px' }}>→</span>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* India-listed plays — separate from US plays */}
          {entry.india_plays && entry.india_plays.length > 0 && (
            <div style={{ padding: '14px 20px 16px', borderTop: '1px solid var(--mc-bg-4)' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-warn)', fontWeight: '700', letterSpacing: '1px', margin: '0 0 10px' }}>
                🇮🇳 INDIA-LISTED PLAYS (NSE/BSE)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                {entry.india_plays.map(p => (
                  <div key={p.ticker} style={{ display: 'flex', gap: '10px', padding: '8px 12px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)', borderRadius: '8px' }}>
                    <div style={{ flexShrink: 0 }}>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--mc-warn)' }}>{p.ticker}</span>
                      <span style={{ fontSize: '9px', color: 'var(--mc-text-4)', marginLeft: '4px' }}>{p.exchange}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.4' }}>{p.thesis}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '9px', color: 'var(--mc-text-4)', marginTop: '8px' }}>
                Note: India plays are typically indirect/second-order beneficiaries. Verify earnings linkage before sizing.
              </p>
            </div>
          )}

          {/* ── CHOKEPOINT INTELLIGENCE PANEL (P1) — the 5 Serenity questions ── */}
          {entry.chokepoints && entry.chokepoints.length > 0 && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--mc-bg-4)', backgroundColor: '#0A0F1A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <p style={{ fontSize: '10px', color: 'var(--mc-state-persistent)', fontWeight: '800', letterSpacing: '1.2px', margin: 0 }}>🎯 CHOKEPOINT INTELLIGENCE — exact public companies at the bottleneck</p>
                {entry.theme_family && (
                  <span style={{ fontSize: '9px', color: 'var(--mc-text-4)', border: '1px solid var(--mc-bg-4)', padding: '1px 6px', borderRadius: '10px' }}>
                    family: {entry.theme_family}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                {entry.chokepoints.map(cp => {
                  const qcfg = QUAL_STAGE_CONFIG[cp.qual_stage];
                  return (
                    <div key={cp.ticker} style={{ padding: '12px 14px', backgroundColor: 'var(--mc-bg-1)', border: `1px solid color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)`, borderLeft: '3px solid var(--mc-state-persistent)', borderRadius: '8px' }}>
                      {/* Company header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--mc-text-0)' }}>{cp.ticker}</span>
                        <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{cp.exchange}</span>
                        <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--mc-text-4)', border: '1px solid var(--mc-bg-4)', padding: '1px 5px', borderRadius: '3px' }}>T{cp.tier}</span>
                        <span title={qcfg.desc} style={{ fontSize: '9px', fontWeight: '700', color: qcfg.color, backgroundColor: qcfg.color + '18', border: `1px solid ${qcfg.color}40`, padding: '1px 6px', borderRadius: '3px', cursor: 'help' }}>{qcfg.label}</span>
                        {cp.public_competitors <= 2 && (
                          <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--mc-bearish)', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', padding: '1px 6px', borderRadius: '3px' }}>🔒 {cp.public_competitors === 0 ? 'MONOPOLY' : cp.public_competitors === 1 ? 'DUOPOLY' : '3 competitors'}</span>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--mc-text-3)', margin: '0 0 6px', lineHeight: '1.5' }}>{cp.monopoly_basis}</p>
                      {/* Confirmed customers */}
                      {cp.customers.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                          <span style={{ fontSize: '9px', color: 'var(--mc-text-4)' }}>→</span>
                          {cp.customers.map(c => <span key={c} style={{ fontSize: '10px', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 15%, transparent)', padding: '1px 6px', borderRadius: '4px' }}>{c}</span>)}
                        </div>
                      )}
                      {/* Evidence types */}
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {cp.evidence_types.map(et => (
                          <span key={et} style={{ fontSize: '8px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', padding: '1px 5px', borderRadius: '3px' }}>
                            {et === 'earnings' ? '📊' : et === 'sec_filing' ? '📋' : et === 'conference_pdf' ? '📑' : et === 'wayback' ? '🕰' : et === 'ir_page' ? '🔗' : '📰'} {et}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── COVERAGE COMPLETENESS (P1) — what's known, private, missing ── */}
          {entry.coverage && (entry.coverage.confirmed_public.length > 0 || entry.coverage.likely_missing.length > 0) && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--mc-bg-4)' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-accent)', fontWeight: '800', letterSpacing: '1.2px', margin: '0 0 12px' }}>🗺️ COVERAGE COMPLETENESS — who's in the chain?</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                {entry.coverage.confirmed_public.length > 0 && (
                  <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 13%, transparent)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '9px', color: 'var(--mc-bullish)', fontWeight: '700', margin: '0 0 6px' }}>✅ CONFIRMED PUBLIC ({entry.coverage.confirmed_public.length})</p>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {entry.coverage.confirmed_public.map(t => <span key={t} style={{ fontSize: '10px', color: 'var(--mc-bullish)', fontWeight: '600', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', padding: '1px 6px', borderRadius: '4px' }}>{t}</span>)}
                    </div>
                  </div>
                )}
                {entry.coverage.known_private.length > 0 && (
                  <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '9px', color: 'var(--mc-warn)', fontWeight: '700', margin: '0 0 6px' }}>🏢 KNOWN PRIVATE ({entry.coverage.known_private.length})</p>
                    {entry.coverage.known_private.map((t, i) => <div key={i} style={{ fontSize: '10px', color: 'var(--mc-text-3)', padding: '2px 0' }}>{t}</div>)}
                  </div>
                )}
                {entry.coverage.likely_missing.length > 0 && (
                  <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 13%, transparent)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '9px', color: 'var(--mc-bearish)', fontWeight: '700', margin: '0 0 6px' }}>🔍 LIKELY MISSING — research candidates</p>
                    {entry.coverage.likely_missing.map((t, i) => <div key={i} style={{ fontSize: '10px', color: 'var(--mc-text-3)', padding: '2px 0', lineHeight: '1.4' }}>{t}</div>)}
                  </div>
                )}
                {entry.coverage.uncovered_nodes.length > 0 && (
                  <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '9px', color: 'var(--mc-state-persistent)', fontWeight: '700', margin: '0 0 6px' }}>⚪ UNCOVERED NODES — no confirmed company</p>
                    {entry.coverage.uncovered_nodes.map((t, i) => <div key={i} style={{ fontSize: '10px', color: 'var(--mc-text-4)', padding: '2px 0', lineHeight: '1.4' }}>{t}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── VALUATION & TIMING — when to size + what price signals to watch ── */}
          {entry.chokepoints && entry.chokepoints.length > 0 && (
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--mc-bg-4)' }}>
              <p style={{ fontSize: '10px', color: 'var(--mc-warn)', fontWeight: '800', letterSpacing: '1.2px', margin: '0 0 10px' }}>
                ⏱ VALUATION & TIMING — when is the asymmetric entry?
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)', borderRadius: '8px' }}>
                  <p style={{ fontSize: '10px', color: 'var(--mc-warn)', fontWeight: '700', margin: '0 0 6px' }}>📍 QUALIFICATION STAGE → SIZE</p>
                  <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.6' }}>
                    <div>🟣 Design Win → position 1-2% (pre-revenue, high risk)</div>
                    <div>🟡 Qualifying → position 2-4% (revenue possible, mid conviction)</div>
                    <div>🟢 Ramping → position 3-6% (revenue confirmed, high conviction)</div>
                    <div>🔵 Volume → only enter on dips (fully priced, reduce size)</div>
                  </div>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 13%, transparent)', borderRadius: '8px' }}>
                  <p style={{ fontSize: '10px', color: 'var(--mc-accent)', fontWeight: '700', margin: '0 0 6px' }}>📊 ENTRY TRIGGERS TO WATCH</p>
                  <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.6' }}>
                    <div>→ Earnings call explicitly names hyperscaler customer</div>
                    <div>→ Design win language: "selected," "qualified," "awarded"</div>
                    <div>→ Lead time expansion news / backlog increase</div>
                    <div>→ CEO buys shares from high base</div>
                    <div>→ Institutional 13F first appearance (&lt;3 holders)</div>
                  </div>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 13%, transparent)', borderRadius: '8px' }}>
                  <p style={{ fontSize: '10px', color: 'var(--mc-bearish)', fontWeight: '700', margin: '0 0 6px' }}>🚨 EXIT / REDUCE TRIGGERS</p>
                  <div style={{ fontSize: '11px', color: 'var(--mc-text-3)', lineHeight: '1.6' }}>
                    <div>→ New public competitor qualifies at same customer</div>
                    <div>→ Management sells &gt;10% of holdings</div>
                    <div>→ Customer explicitly names alternative supplier</div>
                    <div>→ Technology substitution announced (e.g. silicon → InP)</div>
                    <div>→ Order book decline 2+ consecutive quarters</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── WATCHLIST ACTIONS ── */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--mc-bg-4)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700' }}>📌 ACTIONS:</span>
            {entry.chokepoints?.map(cp => (
              <a key={cp.ticker}
                href={`https://finance.yahoo.com/quote/${cp.ticker}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)', padding: '4px 10px', borderRadius: '5px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                📈 {cp.ticker}
              </a>
            ))}
            <a href="https://www.screener.in" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '10px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', border: '1px solid var(--mc-bg-4)', padding: '4px 10px', borderRadius: '5px', textDecoration: 'none' }}>
              🔍 Screener.in
            </a>
            <a href={`https://efts.sec.gov/LATEST/search-index?q="${active}"&dateRange=custom&startdt=${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '10px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', border: '1px solid var(--mc-bg-4)', padding: '4px 10px', borderRadius: '5px', textDecoration: 'none' }}>
              📋 SEC Filings
            </a>
          </div>

          {/* Live evidence */}
          {bucketArticles.length > 0 && (
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--mc-bg-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '1px', margin: 0 }}>LIVE EVIDENCE ({bucketArticles.length} articles)</p>
                {entry.evidence_types && entry.evidence_types.length > 0 && (
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {entry.evidence_types.map(et => (
                      <span key={et} style={{ fontSize: '8px', color: 'var(--mc-text-4)', backgroundColor: 'var(--mc-bg-4)', padding: '1px 5px', borderRadius: '3px' }}>
                        {et === 'earnings' ? '📊' : et === 'sec_filing' ? '📋' : et === 'conference_pdf' ? '📑' : et === 'wayback' ? '🕰' : et === 'ir_page' ? '🔗' : '📰'} {et}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {bucketArticles.map((a, i) => {
                const url = cleanUrl(a.url || a.source_url || '#');
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 10px', marginBottom: '6px', backgroundColor: '#060E1A', borderRadius: '8px', textDecoration: 'none', border: '1px solid var(--mc-bg-4)' }}>
                    <ExternalLink className="w-3 h-3" style={{ color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', margin: 0, lineHeight: '1.35' }}>{a.title || a.headline}</p>
                      <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '3px 0 0' }}>{a.source_name} · {timeAgo(a.published_at)}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
