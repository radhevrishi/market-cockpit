'use client';

import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { NewsArticle } from '@/types';

interface Props {
  article: NewsArticle;
  onTickerClick?: (ticker: string) => void;
}

const IMPORTANCE_DOT: Record<number, string> = {
  0: 'bg-green-500',
  1: 'bg-yellow-400',
  2: 'bg-orange-500',
  3: 'bg-red-500',
};

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  EARNINGS: { label: 'Earnings', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  GUIDANCE: { label: 'Guidance', className: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  RATING_CHANGE: { label: 'Rating', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  MACRO: { label: 'Macro', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  INSIDER: { label: 'Insider', className: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  GENERAL: { label: 'News', className: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
};

// PATCH 0049/0050: institutional pill styles for the richer envelope.
const RANK_PILL: Record<string, string> = {
  TIER_1_ALPHA:    'bg-amber-500/30 text-amber-200 border-amber-500/50',
  TIER_2_RELEVANT: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
  TIER_3_CONTEXT:  'bg-slate-500/15 text-slate-300 border-slate-500/30',
  TIER_4_NOISE:    'bg-zinc-700/15 text-zinc-400 border-zinc-700/30',
};
const RANK_LABEL: Record<string, string> = {
  TIER_1_ALPHA:    'α',
  TIER_2_RELEVANT: 'β',
  TIER_3_CONTEXT:  'γ',
  TIER_4_NOISE:    '·',
};
const HALF_LIFE_PILL: Record<string, string> = {
  TRANSIENT:  'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  CYCLICAL:   'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  STRUCTURAL: 'bg-violet-500/20 text-violet-200 border-violet-500/40',
  SECULAR:    'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/50',
};
const TAXONOMY_PILL: Record<string, string> = {
  MOMENTUM:           'bg-orange-500/15 text-orange-300 border-orange-500/30',
  CROWDED:            'bg-red-500/15 text-red-300 border-red-500/30',
  STRUCTURAL:         'bg-violet-500/15 text-violet-300 border-violet-500/30',
  CYCLICAL:           'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  REFLEXIVE:          'bg-pink-500/15 text-pink-300 border-pink-500/30',
  CONSENSUS:          'bg-slate-500/15 text-slate-300 border-slate-500/30',
  CONTRARIAN:         'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CAPACITY_CONSTRAINED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};
const RESOLUTION_PILL: Record<string, string> = {
  EMERGING:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  PERSISTENT: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  EASING:     'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  RESOLVED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};
const CATEGORY_LABEL: Record<string, string> = {
  COMPUTE_CONSTRAINT:   'Compute',
  POWER_CONSTRAINT:     'Power',
  DEFENSE_SUPPLY:       'Defense',
  MATERIAL_SCARCITY:    'Materials',
  LOGISTICS_CONSTRAINT: 'Logistics',
  ENERGY_CONSTRAINT:    'Energy',
  FINANCIAL_INFRA:      'FinInfra',
};

function importanceTier(score: number): number {
  if (score >= 80) return 3;
  if (score >= 60) return 2;
  if (score >= 40) return 1;
  return 0;
}

export default function NewsCard({ article, onTickerClick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tier = importanceTier(article.importance_score ?? 0);
  const badge = TYPE_BADGE[article.article_type ?? 'GENERAL'] ?? TYPE_BADGE.GENERAL;
  // Defensive: some new RSS feeds (BSE / SEBI / WSJ) emit malformed
  // pubDate strings that crash formatDistanceToNow with "Invalid time
  // value". Validate before formatting; fallback to '' on bad input.
  const timeAgo = (() => {
    if (!article.published_at) return '';
    try {
      const d = new Date(article.published_at);
      if (isNaN(d.getTime())) return '';
      return formatDistanceToNow(d, { addSuffix: true });
    } catch { return ''; }
  })();

  return (
    <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-lg p-4 hover:border-[#0F7ABF]/50 transition-colors group">
      <div className="flex items-start gap-3">
        {/* Importance dot */}
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${IMPORTANCE_DOT[tier]}`} />

        <div className="flex-1 min-w-0">
          {/* Top row: tickers + badge + sentiment + time */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {(article.ticker_symbols ?? article.tickers ?? []).slice(0, 3).map((t: any) => {
              const sym = typeof t === 'string' ? t : t?.ticker ?? '';
              return (
                <button
                  key={sym}
                  onClick={() => onTickerClick?.(sym)}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0F7ABF]/20 text-[#38A9E8] border border-[#0F7ABF]/30 hover:bg-[#0F7ABF]/40 transition-colors"
                >
                  {sym}
                </button>
              );
            })}
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${badge.className}`}>
              {badge.label}
            </span>
            {/* Sentiment magnitude pill — replaces undifferentiated HIGH/MED/LOW.
                "+7" = strongly positive, "−5" = moderately negative. */}
            {(article as any).sentiment && (article as any).sentiment.direction !== 'neutral' && (() => {
              const s = (article as any).sentiment;
              const sign = s.direction === 'positive' ? '+' : '−';
              const cls = s.direction === 'positive'
                ? (s.magnitude >= 7 ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500/50' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30')
                : (s.magnitude >= 7 ? 'bg-rose-500/30 text-rose-300 border-rose-500/50' : 'bg-rose-500/15 text-rose-300 border-rose-500/30');
              return (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`} title={`Sentiment magnitude (1–10): ${s.magnitude}`}>
                  {sign}{s.magnitude}
                </span>
              );
            })()}
            {/* Watchlist match indicator */}
            {(article as any).watchlist_match && (article as any).watchlist_match.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40" title={`Matches your watchlist: ${(article as any).watchlist_match.join(', ')}`}>
                ★ WATCH
              </span>
            )}
            <span className="text-[#4A5B6C] text-[11px] ml-auto shrink-0">{timeAgo}</span>
          </div>

          {/* Headline */}
          <p className="text-white text-sm font-medium leading-snug mb-1 group-hover:text-[#38A9E8] transition-colors">
            {article.headline}
          </p>

          {/* PATCH 0049/0050: Institutional pill row — rank, half-life,
              category, resolution state, taxonomy. Only renders when
              fields are present so legacy cached articles don't show
              empty pills. */}
          {(((article as any).importance_rank) || ((article as any).half_life) || ((article as any).bottleneck_category && (article as any).bottleneck_category !== 'NONE')) && (
            <div className="flex items-center flex-wrap gap-1.5 mt-1.5 mb-1">
              {(article as any).importance_rank && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${RANK_PILL[(article as any).importance_rank] || 'border-slate-500/30 text-slate-300'}`}
                  title={`Signal Importance: ${(article as any).importance_rank.replace(/_/g, ' ')}`}
                >
                  {RANK_LABEL[(article as any).importance_rank]} {(article as any).importance_rank.replace('TIER_1_', 'T1·').replace('TIER_2_', 'T2·').replace('TIER_3_', 'T3·').replace('TIER_4_', 'T4·')}
                </span>
              )}
              {(article as any).half_life && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${HALF_LIFE_PILL[(article as any).half_life] || ''}`}
                  title="Signal half-life — how long this matters"
                >
                  ⧗ {(article as any).half_life.toLowerCase()}
                </span>
              )}
              {(article as any).bottleneck_category && (article as any).bottleneck_category !== 'NONE' && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#0F7ABF]/15 text-[#38A9E8] border border-[#0F7ABF]/30">
                  {CATEGORY_LABEL[(article as any).bottleneck_category] || (article as any).bottleneck_category}
                </span>
              )}
              {(article as any).bottleneck_resolution && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${RESOLUTION_PILL[(article as any).bottleneck_resolution] || ''}`}
                  title={`Resolution state: ${(article as any).bottleneck_resolution.toLowerCase()}`}
                >
                  {(article as any).bottleneck_resolution === 'EMERGING' ? '↗' : (article as any).bottleneck_resolution === 'EASING' ? '↘' : (article as any).bottleneck_resolution === 'RESOLVED' ? '✓' : '●'} {(article as any).bottleneck_resolution.toLowerCase()}
                </span>
              )}
              {((article as any).signal_taxonomy || []).slice(0, 4).map((tag: string) => (
                <span
                  key={tag}
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${TAXONOMY_PILL[tag] || 'border-slate-500/30 text-slate-300'}`}
                  title="Signal taxonomy"
                >
                  {tag.replace(/_/g, ' ').toLowerCase()}
                </span>
              ))}
            </div>
          )}

          {/* Specific impact strip — Bloomberg-style "TICKER ±X% vs cons" */}
          {(article as any).specific_impact?.label && (
            <p className="text-[11px] font-mono mt-1 mb-0.5 inline-block px-2 py-0.5 rounded bg-[#0F7ABF]/15 text-[#38A9E8] border border-[#0F7ABF]/30">
              {(article as any).specific_impact.label}
            </p>
          )}

          {/* PATCH 0049: Transmission chain — beneficiaries → losers → second-order */}
          {((article as any).transmission?.causal_path || ((article as any).transmission?.second_order || []).length > 0) && (
            <div className="text-[10px] mt-1 leading-relaxed border-l-2 border-[#0F7ABF]/40 pl-2 py-0.5 bg-[#0F7ABF]/5">
              {(article as any).transmission?.causal_path && (
                <div className="text-[#8899AA] italic">→ {(article as any).transmission.causal_path}</div>
              )}
              {((article as any).transmission?.second_order || []).length > 0 && (
                <div className="text-[#6677AA] mt-0.5">
                  2°: {((article as any).transmission.second_order as string[]).slice(0, 3).join(' · ')}
                </div>
              )}
            </div>
          )}

          {/* PATCH 0049: Structural confidence bar (BOTTLENECK only) */}
          {(article as any).structural_confidence && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px]">
              <span className="text-[#4A5B6C] uppercase tracking-wide">conf</span>
              <div className="flex-1 h-1.5 bg-[#2A3B4C] rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500"
                  style={{ width: `${(article as any).structural_confidence.confidence_pct}%` }}
                />
              </div>
              <span className="text-[#8899AA] font-mono">{(article as any).structural_confidence.confidence_pct}%</span>
              <span className="text-[#6677AA]">
                6m·{(article as any).structural_confidence.horizon_6m_impact[0]} 2y·{(article as any).structural_confidence.horizon_2y_impact[0]}
              </span>
            </div>
          )}

          {/* PATCH 0049: Expectation framework */}
          {(article as any).expectation && ((article as any).expectation.priced_in_score < 50 || (article as any).expectation.sentiment_saturation > 50) && (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-[#6677AA]">
              <span>priced-in {(article as any).expectation.priced_in_score}%</span>
              {(article as any).expectation.surprise_direction !== 'NEUTRAL' && (
                <span className={(article as any).expectation.surprise_direction === 'POSITIVE' ? 'text-emerald-400' : 'text-rose-400'}>
                  surprise {(article as any).expectation.surprise_direction.toLowerCase()}
                </span>
              )}
              {(article as any).expectation.sentiment_saturation > 50 && (
                <span className="text-amber-400">narrative saturation {(article as any).expectation.sentiment_saturation}%</span>
              )}
            </div>
          )}

          {/* Beneficiary / At-Risk exposure mapping */}
          {((article as any).exposure_beneficiaries?.length > 0 || (article as any).exposure_at_risk?.length > 0) && (
            <div className="text-[10px] mt-1 flex items-center flex-wrap gap-x-2 gap-y-1">
              {(article as any).exposure_beneficiaries?.length > 0 && (
                <span className="text-emerald-400">
                  + {((article as any).exposure_beneficiaries || []).join(' ')}
                </span>
              )}
              {(article as any).exposure_at_risk?.length > 0 && (
                <span className="text-rose-400">
                  − {((article as any).exposure_at_risk || []).join(' ')}
                </span>
              )}
            </div>
          )}

          {/* Source + tier */}
          <span className="text-[#4A5B6C] text-[11px]">
            {article.source_name ?? article.source}
            {(article as any).source_tier && (article as any).source_tier !== 'secondary' && (
              <span className="ml-1 opacity-60">· {(article as any).source_tier}</span>
            )}
          </span>

          {/* Expandable summary */}
          {article.summary && (
            <>
              {expanded && (
                <p className="text-[#8899AA] text-xs mt-2 leading-relaxed border-t border-[#2A3B4C] pt-2">
                  {article.summary}
                </p>
              )}
              <div className="flex items-center gap-4 mt-2">
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-[#4A5B6C] hover:text-[#8899AA] text-[11px] transition-colors"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'Less' : 'Summary'}
                </button>
                {(article.source_url ?? article.url) && (
                  <a
                    href={article.source_url ?? article.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#4A5B6C] hover:text-[#0F7ABF] text-[11px] transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Full article
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
