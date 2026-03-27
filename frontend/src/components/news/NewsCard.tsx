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
  const timeAgo = article.published_at ? formatDistanceToNow(new Date(article.published_at), { addSuffix: true }) : '';

  return (
    <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-lg p-4 hover:border-[#0F7ABF]/50 transition-colors group">
      <div className="flex items-start gap-3">
        {/* Importance dot */}
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${IMPORTANCE_DOT[tier]}`} />

        <div className="flex-1 min-w-0">
          {/* Top row: tickers + badge + time */}
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
            <span className="text-[#4A5B6C] text-[11px] ml-auto shrink-0">{timeAgo}</span>
          </div>

          {/* Headline */}
          <p className="text-white text-sm font-medium leading-snug mb-1 group-hover:text-[#38A9E8] transition-colors">
            {article.headline}
          </p>

          {/* Source */}
          <span className="text-[#4A5B6C] text-[11px]">{article.source_name ?? article.source}</span>

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
