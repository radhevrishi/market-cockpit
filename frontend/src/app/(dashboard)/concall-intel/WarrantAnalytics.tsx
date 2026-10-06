'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import type { WarrantFeedPayload } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// WARRANT ANALYTICS — PATCH 0591
//
// Mirrors the Multibagger / Special Situations Analytics philosophy: one
// consolidated dashboard over the entire warrant universe so the analyst
// sees distribution and quality BEFORE diving into individual cards.
//
// Surfaces:
//   • STATS STRIP        — total / relevant / passing / NSE-BSE split / avg score
//   • 🎯 TOP BY WEIGHTED — score-ranked shortlist with company names
//   • 🪣 BUCKET MIX      — GREEN / AMBER / RED split (strategic vs distress)
//   • 💰 USE OF PROCEEDS — capex / working-capital / unknown breakdown
//   • 👥 PROMOTER MIX    — promoter-subscribed vs third-party
//   • 🔍 EXTRACTION QUAL — % of filings with each diagnostic field present
//   • 💹 PRICING SPREAD  — discount vs premium distribution
//   • 🕒 AGING           — fresh (<7d) / warm (7-14d) / older (14-30d)
// ═══════════════════════════════════════════════════════════════════════════

export function WarrantAnalytics({ data }: { data: WarrantFeedPayload }) {
  const [expanded, setExpanded] = useState(true);
  const filings = data.filings || [];
  if (filings.length === 0) return null;

  // ── Aggregations (single pass over filings) ───────────────────────────
  const byBucket: Record<string, number> = { GREEN: 0, AMBER: 0, RED: 0, OTHER: 0 };
  const byUse: Record<string, number> = {};
  const byPromoter: Record<string, number> = {};
  const byExchange: Record<string, number> = { NSE: 0, BSE: 0 };
  const byTier: Record<string, number> = { T1: 0, T2: 0, T3: 0 };
  let scoreSum = 0;
  let scoreCount = 0;
  let promoterSubscribedCount = 0;
  let bothPdfAndPromoter = 0;
  // Pricing premium buckets
  const pricingBuckets = { discount: 0, atMarket: 0, smallPremium: 0, bigPremium: 0 };
  // Aging buckets
  const now = Date.now();
  const aging = { fresh: 0, warm: 0, older: 0 };
  // Extraction quality counters
  const extr = { pdf: 0, promoter: 0, issuePx: 0, convPeriod: 0, cmp: 0, momentum: 0 };

  for (const f of filings) {
    const c = (f as any).conviction || {};
    const bucket = c.bucket || 'OTHER';
    byBucket[bucket] = (byBucket[bucket] || 0) + 1;
    const tier = c.tier || (bucket === 'GREEN' ? 'T1' : bucket === 'AMBER' ? 'T2' : 'T3');
    byTier[tier] = (byTier[tier] || 0) + 1;
    const use = (c.capital_use || c.use_of_proceeds || 'UNKNOWN').toUpperCase();
    byUse[use] = (byUse[use] || 0) + 1;
    const promoterIntent = (c.promoter_intent || (f.details?.is_promoter_subscribed ? 'PARTICIPATING' : 'UNKNOWN')).toUpperCase();
    byPromoter[promoterIntent] = (byPromoter[promoterIntent] || 0) + 1;
    if (f.details?.is_promoter_subscribed) promoterSubscribedCount++;
    byExchange[f.exchange] = (byExchange[f.exchange] || 0) + 1;

    const score = c.weighted?.final ?? c.conviction ?? c.raw_score;
    if (typeof score === 'number') { scoreSum += score; scoreCount++; }

    // Pricing premium classification (uses c.premium_pct if present)
    const prem = c.premium_pct;
    if (typeof prem === 'number') {
      if (prem < -5) pricingBuckets.discount++;
      else if (prem <= 5) pricingBuckets.atMarket++;
      else if (prem <= 25) pricingBuckets.smallPremium++;
      else pricingBuckets.bigPremium++;
    }

    // Aging
    try {
      const ageH = (now - new Date(f.filing_datetime).getTime()) / 3_600_000;
      if (ageH <= 24 * 7) aging.fresh++;
      else if (ageH <= 24 * 14) aging.warm++;
      else aging.older++;
    } catch {}

    // Extraction quality (mirror the row diagnostic flags)
    if (f.attachment_urls && f.attachment_urls.length > 0) extr.pdf++;
    if (f.details?.promoter_participation_pct != null || f.details?.is_promoter_subscribed) extr.promoter++;
    if (f.details?.issue_price != null) extr.issuePx++;
    if (f.details?.conversion_period_months != null) extr.convPeriod++;
    if (f.price?.cmp != null) extr.cmp++;
    if (typeof f.business_momentum_score === 'number' && f.business_momentum_score > 0) extr.momentum++;

    if (f.attachment_urls?.length && f.details?.is_promoter_subscribed) bothPdfAndPromoter++;
  }

  const avgScore = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0;
  const promoterRate = filings.length > 0 ? Math.round((promoterSubscribedCount / filings.length) * 100) : 0;
  const total = filings.length;

  // Top by weighted score
  const topRanked = [...filings]
    .filter((f) => (f.conviction as any)?.weighted?.final != null || f.conviction?.conviction != null)
    .sort((a, b) => {
      const sa = (a.conviction as any)?.weighted?.final ?? a.conviction?.conviction ?? 0;
      const sb = (b.conviction as any)?.weighted?.final ?? b.conviction?.conviction ?? 0;
      return sb - sa;
    })
    .slice(0, 10);

  // ── Render helpers ────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    backgroundColor: '#0A1422', border: '1px solid #1A2540',
    borderRadius: 6, padding: '10px 12px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#6B7A8D', letterSpacing: '0.3px', marginBottom: 4,
  };

  const Bar = ({ pct, color, height }: { pct: number; color: string; height?: number }) => (
    <div style={{ flex: 1, height: height ?? 6, background: 'var(--mc-bg-4)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color }} />
    </div>
  );

  return (
    <div style={{ background: 'var(--mc-bg-1)', border: '1px dashed color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--mc-cyan)',
            fontSize: 13, fontWeight: 800, cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {expanded ? '▾' : '▸'} 📊 WARRANT ANALYTICS
        </button>
        <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>
          {total} filings · avg score {avgScore}/10 · {promoterRate}% promoter-subscribed
        </span>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* PATCH 0598 — Extraction-quality banner. When the underlying
              filings-extraction pipeline is producing mostly-UNKNOWN
              promoter / use / issue-price fields, the bucket distribution
              looks alarming (98% distress / 99% unknown) when really the
              regex pipeline simply couldn't read the PDFs. Surface this
              upfront so the analyst doesn't draw bad conclusions. */}
          {(() => {
            const promoterRateLocal = total > 0 ? Math.round((extr.promoter / total) * 100) : 0;
            const pdfRate = total > 0 ? Math.round((extr.pdf / total) * 100) : 0;
            const issueRate = total > 0 ? Math.round((extr.issuePx / total) * 100) : 0;
            const lowExtraction = pdfRate < 30 || promoterRateLocal < 20 || issueRate < 20;
            if (!lowExtraction) return null;
            return (
              <div style={{
                background: 'color-mix(in srgb, var(--mc-bearish) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)',
                borderRadius: 4, padding: '8px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 3 }}>
                  ⚠ EXTRACTION QUALITY LOW — treat below as anomaly detector, not investment ranking
                </div>
                <div style={{ fontSize: 10.5, color: '#FCA5A5', lineHeight: 1.5 }}>
                  Only {pdfRate}% have PDFs · {promoterRateLocal}% have promoter intent · {issueRate}% have issue price.
                  The bucket distribution below is dominated by &ldquo;UNKNOWN promoter → distress&rdquo; classifications which
                  reflect missing data, NOT confirmed dilutive intent. Use this section to <strong>surface anomalies for manual review</strong>,
                  not as a sized scoring engine. Verify each interesting row by opening the source filing.
                </div>
              </div>
            );
          })()}

          {/* ── STATS STRIP ───────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Total filings</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-text-1)', fontVariantNumeric: 'tabular-nums' }}>{total}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Avg conviction</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>{avgScore}/10</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Strategic (GREEN)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>{byBucket.GREEN || 0}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Distress (RED)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' }}>{byBucket.RED || 0}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Promoter subscribed</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--mc-state-persistent)', fontVariantNumeric: 'tabular-nums' }}>{promoterSubscribedCount}</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{promoterRate}% of all</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Exchange split</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-text-1)' }}>NSE {byExchange.NSE} · BSE {byExchange.BSE}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Aging</div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-1)', fontWeight: 700 }}>
                <span style={{ color: 'var(--mc-bullish)' }}>● {aging.fresh}</span>{' '}
                <span style={{ color: 'var(--mc-warn)' }}>◐ {aging.warm}</span>{' '}
                <span style={{ color: 'var(--mc-text-4)' }}>◯ {aging.older}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>fresh · warm · older</div>
            </div>
          </div>

          {/* ── 🎯 TOP BY WEIGHTED SCORE ──────────────────────────────── */}
          {topRanked.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 6 }}>
                🎯 TOP {topRanked.length} BY WEIGHTED SCORE
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {topRanked.map((f, i) => {
                  const c = (f.conviction as any) || {};
                  const score = c.weighted?.final ?? c.conviction ?? c.raw_score ?? 0;
                  const bucket = c.bucket || 'OTHER';
                  const bcolor = bucket === 'GREEN' ? '#10B981' : bucket === 'AMBER' ? '#F59E0B' : bucket === 'RED' ? '#EF4444' : '#6B7A8D';
                  return (
                    <div key={f.symbol + i} style={{
                      display: 'flex', flexDirection: 'column', gap: 2,
                      padding: '6px 8px', borderRadius: 4,
                      border: `1px solid ${bcolor}30`, background: `${bcolor}08`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 22 }}>#{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.company_name}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>
                            {f.symbol} · {f.exchange}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: bcolor, fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)}</span>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(f.warrant_type || '').replace(/_/g, ' ')}
                        {c.capital_use && ` · use: ${c.capital_use.toLowerCase()}`}
                        {c.premium_pct != null && ` · ${c.premium_pct > 0 ? '+' : ''}${c.premium_pct.toFixed(0)}% vs CMP`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>

            {/* ── 🪣 BUCKET MIX ──────────────────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🪣 BUCKET MIX</div>
              {([
                { key: 'GREEN', label: '🟢 STRATEGIC', color: '#10B981' },
                { key: 'AMBER', label: '🟡 NEUTRAL',   color: '#F59E0B' },
                { key: 'RED',   label: '🔴 DISTRESS',  color: '#EF4444' },
                { key: 'OTHER', label: '◯ OTHER',     color: '#6B7A8D' },
              ] as const).map((b) => {
                const n = byBucket[b.key] || 0;
                if (n === 0) return null;
                const pct = total > 0 ? (n / total) * 100 : 0;
                return (
                  <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 100 }}>{b.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <Bar pct={pct} color={b.color} />
                    <span style={{ fontSize: 10, color: b.color, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* ── 💰 USE OF PROCEEDS ─────────────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>💰 USE OF PROCEEDS</div>
              {Object.entries(byUse).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                const pct = total > 0 ? (n / total) * 100 : 0;
                const tone = /CAPEX|EXPANSION|ACQUISITION/.test(k) ? '#10B981'
                          : /WORKING.CAPITAL|DEBT|REFINANC/.test(k) ? '#F59E0B'
                          : '#6B7A8D';
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <Bar pct={pct} color={tone} />
                    <span style={{ fontSize: 10, color: tone, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* ── 👥 PROMOTER MIX ────────────────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>👥 PROMOTER PARTICIPATION</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, lineHeight: 1.4 }}>
                Promoter-subscribed warrants are the high-conviction subset.
                Third-party-only warrants imply external dilution without owner alignment.
              </div>
              {Object.entries(byPromoter).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                const pct = total > 0 ? (n / total) * 100 : 0;
                const tone = /PARTICIPAT|SUBSCRIB|MAINTAIN/.test(k) ? '#10B981' : '#6B7A8D';
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <Bar pct={pct} color={tone} />
                    <span style={{ fontSize: 10, color: tone, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* ── 🔍 EXTRACTION QUALITY ──────────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🔍 EXTRACTION QUALITY</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, lineHeight: 1.4 }}>
                % of filings with each field extracted. Low coverage means
                the scoring model has limited signal; verify manually.
              </div>
              {([
                { key: 'pdf',        label: 'PDF attached',       n: extr.pdf },
                { key: 'promoter',   label: 'Promoter intent',    n: extr.promoter },
                { key: 'issuePx',    label: 'Issue price',        n: extr.issuePx },
                { key: 'convPeriod', label: 'Conversion period',  n: extr.convPeriod },
                { key: 'cmp',        label: 'CMP (Yahoo)',        n: extr.cmp },
                { key: 'momentum',   label: 'Concall momentum',   n: extr.momentum },
              ] as const).map((row) => {
                const pct = total > 0 ? (row.n / total) * 100 : 0;
                const tone = pct >= 80 ? '#10B981' : pct >= 50 ? '#22D3EE' : pct >= 25 ? '#F59E0B' : '#EF4444';
                return (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 120 }}>{row.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.n}</span>
                    <Bar pct={pct} color={tone} />
                    <span style={{ fontSize: 10, color: tone, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* ── 💹 PRICING SPREAD vs CMP ──────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>💹 ISSUE PRICE vs CMP</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, lineHeight: 1.4 }}>
                Issue price relative to current market price. Deep discounts
                signal distress; premium offers signal promoter confidence.
              </div>
              {([
                { key: 'discount',     label: 'Deep discount (< -5%)',  n: pricingBuckets.discount,     color: '#EF4444' },
                { key: 'atMarket',     label: 'At market (±5%)',         n: pricingBuckets.atMarket,     color: '#94A3B8' },
                { key: 'smallPremium', label: 'Premium (+5 to +25%)',    n: pricingBuckets.smallPremium, color: '#22D3EE' },
                { key: 'bigPremium',   label: 'Big premium (> +25%)',    n: pricingBuckets.bigPremium,   color: '#10B981' },
              ] as const).map((row) => {
                if (row.n === 0) return null;
                const pricedCount = pricingBuckets.discount + pricingBuckets.atMarket + pricingBuckets.smallPremium + pricingBuckets.bigPremium;
                const pct = pricedCount > 0 ? (row.n / pricedCount) * 100 : 0;
                return (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 160 }}>{row.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.n}</span>
                    <Bar pct={pct} color={row.color} />
                    <span style={{ fontSize: 10, color: row.color, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* ── 🏷 TIER MIX ───────────────────────────────────────── */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>🏷 TIER MIX</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6, lineHeight: 1.4 }}>
                T1 = highest conviction (promoter + low distress).
                T2 = neutral / partial signals. T3 = distress / non-strategic.
              </div>
              {([
                { key: 'T1', label: '★ TIER 1',    color: '#10B981' },
                { key: 'T2', label: '◐ TIER 2',    color: '#F59E0B' },
                { key: 'T3', label: '⚠ TIER 3',    color: '#EF4444' },
              ] as const).map((row) => {
                const n = byTier[row.key] || 0;
                if (n === 0) return null;
                const pct = total > 0 ? (n / total) * 100 : 0;
                return (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-1)', fontWeight: 700, minWidth: 80 }}>{row.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-3)', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <Bar pct={pct} color={row.color} />
                    <span style={{ fontSize: 10, color: row.color, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

          </div>

          {/* ── 📚 INSTITUTIONAL DISCLOSURE ────────────────────────────────── */}
          <div style={{ ...cardStyle, borderColor: 'var(--mc-bg-4)' }}>
            <div style={{ fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--mc-text-3)' }}>HOW TO READ:</strong>{' '}
              The bucket mix is the most important chart — strategic (GREEN) warrants
              with promoter subscription and premium pricing are the multibagger setup.
              Distress (RED) warrants signal capital raises from non-promoter parties
              for working-capital or refinancing — typically dilutive without alignment.
              Low extraction quality on Promoter / Issue px / Conversion period means
              the scoring engine is operating with reduced signal; consider verifying
              with the source filings before acting.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
