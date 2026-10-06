'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { ExternalLink, ChevronRight } from 'lucide-react';
import { chipStyle, TOKENS } from '@/lib/design-tokens';
import { annotateArticle, CONFIDENCE_VISUAL } from '@/lib/news/event-detectors';
import { detectAllTheWrap } from '@/lib/thewrap-detectors';
import { WatchlistButton, ReadingListButton } from './components';
import { BOOK_PRIORITY_BOOST } from './constants';
import { getTickerSymbols, getTitle, getSource, getUrl, sentimentBadge, tierBadge, isPersistentSignal, importanceDot, regionFlag, typeColor, timeAgo } from './helpers';
import { type NewsArticle } from './types';

export function NewsCard({ article, onSelect }: { article: NewsArticle; onSelect: (a: NewsArticle) => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);
  const tier = tierBadge(article.investment_tier);

  const isStale = (() => {
    try {
      const d = new Date(article.published_at);
      const daysSince = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > 7;
    } catch { return false; }
  })();

  const isPersistent = isPersistentSignal(article);
  const isStructural = !!article.is_synthetic
    || article.feed_layer === 'STRUCTURAL_ALPHA'
    || article.structural_status === 'CRITICAL'
    || article.structural_status === 'ELEVATED';

  // PATCH 0434 BUG-019 — Structural alerts had no URL → became dead <div>s.
  // For structural alerts, link to the Bottleneck Workbench page (filter
  // by theme if we can extract one from tags/title). Otherwise, the card
  // still calls onSelect to show details.
  const structuralLink: string | null = isStructural ? (() => {
    const a = article as any;
    const tagTheme = (a.tags as string[] | undefined)?.find(t => /^theme:/i.test(t))?.replace(/^theme:/i, '');
    const theme = tagTheme || a.bottleneck_theme || a.theme_id || '';
    return theme
      ? `/bottleneck-workbench?theme=${encodeURIComponent(theme)}`
      : '/bottleneck-workbench';
  })() : null;

  const handleCardClick = (e: React.MouseEvent) => {
    // If clicking inner buttons, don't navigate
    if ((e.target as HTMLElement).closest('button')) return;
    if (url && url !== '#') {
      // Use <a> navigation below, don't handle here
      return;
    }
    onSelect(article);
  };

  const CardWrapper = url && url !== '#' ? 'a' : (structuralLink ? 'a' : 'div');
  const cardProps = url && url !== '#'
    ? { href: url, target: '_blank' as const, rel: 'noopener noreferrer' }
    : (structuralLink ? { href: structuralLink } : {});

  return (
    <CardWrapper
      {...cardProps}
      className="news-card"
      style={{ display: 'block', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px', padding: '18px', cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s', opacity: (isStale && !isPersistent && !isStructural) ? 0.55 : 1, textDecoration: 'none', color: 'inherit' }}
      onClick={handleCardClick}
    >
      {/* PATCH 1094 — relax card breathing room: padding 16→18, inner gap 10→12,
          chip-strip marginBottom 8→10 and gap 6→7, title bottom 4→6.
          Goal: keep the dense Bloomberg-lite feel, just untie the chip strip
          from the headline. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: importanceDot(article.importance_score), flexShrink: 0, marginTop: '7px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', color: 'var(--mc-text-4)' }}>{regionFlag(article.region)}</span>
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: typeColor(article.article_type) + '22',
              color: typeColor(article.article_type),
              border: `1px solid ${typeColor(article.article_type)}40`,
            }}>
              {article.article_type?.replace(/_/g, ' ')}
            </span>
            {isStale && !isPersistent && (
              <span style={chipStyle(TOKENS.state.stale)} title="Published 48 hours to 7 days ago">
                STALE
              </span>
            )}
            {isPersistent && (
              <span style={chipStyle(TOKENS.state.persistent)} title="Older than 7 days; persistent structural theme">
                PERSISTENT
              </span>
            )}
            {isStructural && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#6366F115', color: '#818CF8', border: '1px solid #6366F140',
                letterSpacing: '0.3px',
              }}>
                STRUCTURAL
              </span>
            )}
            {tier && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: tier.bg, color: tier.color,
                border: `1px solid ${tier.border}`, letterSpacing: '0.3px',
              }}>
                {tier.label}
              </span>
            )}
            {/* PATCH 0455 TIER1-F — "Why ranked here?" priority badge.
                Tooltip shows the score breakdown: importance × severity ×
                structural × recency × source-weight × noise-multiplier. */}
            {(() => {
              const pri = (article as any).__priority;
              const parts = (article as any).__priorityParts;
              if (typeof pri !== 'number') return null;
              const tip = parts
                ? `Priority ${pri.toFixed(1)} = importance ${parts.importance?.toFixed?.(1) ?? '—'} + severity ${parts.severity?.toFixed?.(1) ?? '—'} + structural ${parts.structural?.toFixed?.(1) ?? '—'} + recency ${parts.recency?.toFixed?.(1) ?? '—'} × source-weight ${parts.source_weight?.toFixed?.(2) ?? '—'} × noise ${parts.noise_mult?.toFixed?.(2) ?? '—'}`
                : `Priority score ${pri.toFixed(1)} — combines impact, severity, source quality, and recency`;
              return (
                <span title={tip} style={{
                  fontSize: '9px', fontWeight: '800', padding: '3px 7px', borderRadius: '5px',
                  backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)',
                  border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', letterSpacing: '0.3px',
                  cursor: 'help', fontFamily: 'ui-monospace, monospace',
                }}>
                  P {pri.toFixed(0)}
                </span>
              );
            })()}
            {/* Book/bench-aware chip — fires when the article touches a name the
                user holds / benches / watches. The card's priority already
                carries a +BOOK_PRIORITY_BOOST bump so it ranks above equal-
                importance strangers. */}
            {article.__inBook && (
              <span title={`In your book${article.__bookMatch ? ` — ${article.__bookMatch}` : ''} · +${BOOK_PRIORITY_BOOST} priority boost`} style={{
                fontSize: '9px', fontWeight: '800', padding: '3px 7px', borderRadius: '5px',
                backgroundColor: 'color-mix(in srgb, var(--mc-accent) 14%, transparent)', color: 'var(--mc-accent)',
                border: '1px solid color-mix(in srgb, var(--mc-accent) 38%, transparent)', letterSpacing: '0.3px',
                cursor: 'help',
              }}>
                💼 IN YOUR BOOK{article.__bookMatch ? ` · ${article.__bookMatch}` : ''}
              </span>
            )}
            {sentiment && (
              <span style={{
                fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: sentiment.bg,
                color: sentiment.color,
                border: `1px solid ${sentiment.border}`,
              }}>
                {sentiment.icon} {sentiment.label}
              </span>
            )}
            {symbols.slice(0, 3).map(t => (
              <span key={t} style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 9%, transparent)', color: 'var(--mc-accent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)' }}>
                {t}
              </span>
            ))}
            {article.themes?.slice(0, 2).map(th => (
              <span key={th} style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', color: '#F87171', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', letterSpacing: '0.3px' }}>
                {th.replace(/_/g, ' ')}
              </span>
            ))}
            {/* PATCH 0449 — Institutional detector chips. Each fires only
                when its regex matches; otherwise the card stays as-is.
                PATCH 0452 P0-5 — Prefer pre-annotated fields stamped by
                the server (cheap path); fall back to client-side compute
                for articles cached before the server-side wiring landed. */}
            {(() => {
              const pre = article as any;
              const ann = (pre.__creditStress !== undefined || pre.__noise !== undefined)
                ? {
                    creditStress: pre.__creditStress ?? null,
                    promoter: pre.__promoter ?? null,
                    workingCapital: pre.__workingCapital ?? null,
                    orderQuality: pre.__orderQuality ?? null,
                    noise: pre.__noise ?? { isListicle: false, isSpeculation: false, qualityMultiplier: 1 },
                    expectation: pre.__expectation ?? null,
                  }
                : annotateArticle({ title: article.title, headline: article.headline, summary: article.summary });
              const chips: React.ReactNode[] = [];
              if (ann.creditStress) chips.push(
                <span key="cs" title={`Credit stress: ${ann.creditStress.label} — matched "${ann.creditStress.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.creditStress.color + '15', color: ann.creditStress.color, border: `1px solid ${ann.creditStress.color}40`, letterSpacing: '0.3px' }}>
                  {ann.creditStress.emoji} {ann.creditStress.label}
                </span>
              );
              if (ann.promoter) chips.push(
                <span key="pb" title={`Promoter behavior: ${ann.promoter.label} — matched "${ann.promoter.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.promoter.color + '15', color: ann.promoter.color, border: `1px solid ${ann.promoter.color}40`, letterSpacing: '0.3px' }}>
                  {ann.promoter.emoji} {ann.promoter.label}
                </span>
              );
              if (ann.workingCapital) chips.push(
                <span key="wc" title={`Working-capital stress: ${ann.workingCapital.label} — matched "${ann.workingCapital.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.workingCapital.color + '15', color: ann.workingCapital.color, border: `1px solid ${ann.workingCapital.color}40`, letterSpacing: '0.3px' }}>
                  {ann.workingCapital.emoji} {ann.workingCapital.label}
                </span>
              );
              if (ann.expectation) chips.push(
                <span key="eg" title={ann.expectation.label}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.expectation.color + '15', color: ann.expectation.color, border: `1px solid ${ann.expectation.color}40`, letterSpacing: '0.3px' }}>
                  {ann.expectation.emoji} {ann.expectation.label}
                </span>
              );
              if (ann.orderQuality) {
                const oq = ann.orderQuality;
                const lab = [
                  oq.hasPassThrough ? 'pass-through' : null,
                  oq.isGovernment ? 'govt' : oq.isPrivate ? 'private' : null,
                  oq.durationLabel,
                  oq.marginHint,
                  oq.concentrationRisk ? '⚠ concentration' : null,
                ].filter(Boolean).join(' · ');
                if (lab) chips.push(
                  <span key="oq" title={`Order-book quality signals: ${lab}`}
                    style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', color: 'var(--mc-cyan)', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', letterSpacing: '0.3px' }}>
                    📋 {lab}
                  </span>
                );
              }
              if (ann.noise.isListicle) chips.push(
                <span key="lst" title="Aggregator listicle — '5 stocks to watch'-style headline. Heavy noise penalty applied to ranking."
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)', color: 'var(--mc-text-3)', border: '1px solid color-mix(in srgb, var(--mc-text-3) 25%, transparent)', letterSpacing: '0.3px' }}>
                  📋 LISTICLE
                </span>
              );
              if (ann.noise.isSpeculation) chips.push(
                <span key="spc" title="Speculative headline — 'could acquire' / 'in talks' / 'reportedly'. Penalty applied to ranking."
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', letterSpacing: '0.3px' }}>
                  💭 SPECULATION
                </span>
              );
              // Confidence band — derived in the parent useMemo from source-weight + cluster size.
              const cb = (article as any).__confidence as keyof typeof CONFIDENCE_VISUAL | undefined;
              if (cb && CONFIDENCE_VISUAL[cb]) {
                const v = CONFIDENCE_VISUAL[cb];
                chips.push(
                  <span key="cb" title={v.description}
                    style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: v.color + '15', color: v.color, border: `1px solid ${v.color}40`, letterSpacing: '0.3px' }}>
                    {v.emoji} {v.label}
                  </span>
                );
              }
              // Cluster size chip — "+N sources" PLUS a corroboration timeline.
              // PATCH 0454 TIER1-B — When the cluster has timestamps, render
              // a 60px-wide row of tick marks proportional to time-span. A
              // 5-min-apart cluster shows ticks tightly clustered (high
              // conviction breaking news); a 6h-apart cluster shows ticks
              // spread out (echo chamber rewrites). The eye reads conviction
              // density at a glance.
              const clusterSize = (article as any).__clusterSize as number | undefined;
              const clusterTimes = (article as any).__clusterTimes as number[] | undefined;
              if (clusterSize && clusterSize > 1) {
                const renderTimeline = () => {
                  if (!clusterTimes || clusterTimes.length < 2) return null;
                  const min = clusterTimes[0];
                  const max = clusterTimes[clusterTimes.length - 1];
                  const span = Math.max(1, max - min);
                  const spanMin = Math.round(span / 60_000);
                  const spanLabel = spanMin < 60 ? `${spanMin}m` : spanMin < 1440 ? `${Math.round(spanMin / 60)}h` : `${Math.round(spanMin / 1440)}d`;
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}
                      title={`Corroboration span: ${spanLabel}. Tight clusters (<30m) = breaking; wide clusters (>4h) = echo chamber rewrites.`}>
                      <span style={{
                        position: 'relative', width: 60, height: 8,
                        borderLeft: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRight: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)',
                      }}>
                        {clusterTimes.map((t, i) => {
                          const left = ((t - min) / span) * 100;
                          return (
                            <span key={i} style={{
                              position: 'absolute', left: `${left}%`, top: 0,
                              width: 1.5, height: 8,
                              background: 'var(--mc-bullish)',
                              transform: 'translateX(-50%)',
                            }} />
                          );
                        })}
                      </span>
                      <span style={{ fontSize: 8, color: 'var(--mc-bullish)', fontWeight: 700 }}>{spanLabel}</span>
                    </span>
                  );
                };
                chips.push(
                  <span key="cl"
                    title={`This event also reported by ${clusterSize - 1} other source${clusterSize === 2 ? '' : 's'} — clustered under one master article.`}
                    style={{ display: 'inline-flex', alignItems: 'center', fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', letterSpacing: '0.3px' }}>
                    🔗 +{clusterSize - 1} sources
                    {renderTimeline()}
                  </span>
                );
              }
              // PATCH 0579 — TheWrap detector chips. Each chip surfaces an
              // alternate-data signal (Order-Book / Strategic-Hire /
              // Marquee-Capital / Marketing-Auth) the standard news feed
              // would otherwise bury. Pure regex over headline + summary;
              // no backend required.
              try {
                const blob = `${article.title || ''} ${article.headline || ''} ${article.summary || ''}`;
                const wrapSignals = detectAllTheWrap(blob);
                for (const sig of wrapSignals) {
                  chips.push(
                    <span key={`tw-${sig.label}`}
                      title={`${sig.evidence}\n\nTheWrap alternate-data detector — heuristic regex match. Verify in the source article before acting.`}
                      style={{
                        fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px',
                        backgroundColor: sig.color + '15', color: sig.color,
                        border: `1px solid ${sig.color}40`, letterSpacing: '0.3px',
                      }}>
                      {sig.emoji} {sig.label}
                    </span>
                  );
                }
              } catch { /* defensive: never let a detector regex crash a card */ }
              return chips;
            })()}
          </div>
          <p style={{ fontSize: '17px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 6px', lineHeight: '1.55' }}>{title}</p>
          {article.impact_statement && (
            <p style={{ fontSize: '18px', color: 'var(--mc-warn)', margin: '0 0 6px', lineHeight: '1.5', fontWeight: '500', fontStyle: 'italic' }}>
              Impact: {article.impact_statement}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '17px', color: '#6A7B8C', fontWeight: '500' }}>{source}</span>
            <span style={{ fontSize: '17px', color: 'var(--mc-border-2)' }}>·</span>
            <span style={{ fontSize: '17px', color: 'var(--mc-text-4)' }}>{timeAgo(article.published_at)}</span>
            {url && url !== '#' && (
              <ExternalLink style={{ width: '11px', height: '11px', color: '#3A4B5C' }} />
            )}
          </div>
        </div>
        {/* PATCH 0569 (UX #4) — Inline +Watch button. Uses the first
            ticker on the article — multi-symbol adds stay the watchlist
            page's job. Hidden when no ticker is attached. */}
        <WatchlistButton ticker={symbols[0] || null} />
        {/* AUDIT_100 #58 — Read-it-later toggle. Saves the article id to
            localStorage 'mc:reading-list:v1' for later retrieval. */}
        <ReadingListButton id={article.id} />
        {/* Info button to open detail overlay */}
        {/* PATCH 0441 BUG-006 — Add preventDefault so clicking 'View details'
            inside an <a href> card opens the drawer instead of navigating to
            the external article URL. Audit reported clicking 'View details'
            destroyed app state by hard-navigating away. */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(article); }}
          style={{ background: 'none', border: '1px solid var(--mc-border-1)', borderRadius: '10px', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', minWidth: '40px', minHeight: '40px', justifyContent: 'center' }}
          title="View details (opens drawer — does not leave app)"
        >
          <ChevronRight style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    </CardWrapper>
  );
}
