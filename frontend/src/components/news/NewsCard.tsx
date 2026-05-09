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

          {/* Specific impact strip — Bloomberg-style "TICKER ±X% vs cons" */}
          {(article as any).specific_impact?.label && (
            <p className="text-[11px] font-mono mt-1 mb-0.5 inline-block px-2 py-0.5 rounded bg-[#0F7ABF]/15 text-[#38A9E8] border border-[#0F7ABF]/30">
              {(article as any).specific_impact.label}
            </p>
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
