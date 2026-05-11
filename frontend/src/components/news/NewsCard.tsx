'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { NewsArticle } from '@/types';

// PATCH 0119 — IMP-02: Watchlist (Multibagger upload) cross-reference.
// Cache the user's MB symbols at module level — refreshed once per mount
// so we don't re-parse localStorage on every NewsCard render.
let __MB_WATCHLIST_CACHE: Set<string> | null = null;
function loadWatchlistSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  if (__MB_WATCHLIST_CACHE) return __MB_WATCHLIST_CACHE;
  const out = new Set<string>();
  try {
    const raw = localStorage.getItem('mb_excel_scored_v2');
    if (raw) {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const sym = String(r?.symbol || r?.ticker || '').trim().toUpperCase();
          if (sym) out.add(sym);
          // Also add stripped form: AXTEL.NS → AXTEL
          const stripped = sym.replace(/\.(NS|BO)$/i, '');
          if (stripped) out.add(stripped);
        }
      }
    }
    const syms = localStorage.getItem('mb3_symbols');
    if (syms) {
      const parsed = JSON.parse(syms);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          const v = typeof s === 'string' ? s : s?.symbol || s?.ticker;
          if (v) {
            const up = String(v).toUpperCase();
            out.add(up);
            out.add(up.replace(/\.(NS|BO)$/i, ''));
          }
        }
      }
    }
  } catch {}
  __MB_WATCHLIST_CACHE = out;
  return out;
}
function articleMatchesWatchlist(article: NewsArticle): boolean {
  const wl = loadWatchlistSet();
  if (wl.size === 0) return false;
  const candidates: string[] = [];
  const pt = (article as any).primary_ticker;
  if (pt) candidates.push(String(pt).toUpperCase());
  const ts = (article as any).ticker_symbols ?? (article as any).tickers ?? [];
  for (const t of ts) {
    const sym = typeof t === 'string' ? t : t?.ticker;
    if (sym) candidates.push(String(sym).toUpperCase());
  }
  for (const c of candidates) {
    if (wl.has(c)) return true;
    const stripped = c.replace(/\.(NS|BO)$/i, '');
    if (wl.has(stripped)) return true;
  }
  return false;
}

// PATCH 0120 — IMP-09: per-article strategy relevance tags.
// Each tag fires when the article matches a strategy pattern the cockpit
// already tracks elsewhere — [MB] cross-references Multibagger upload,
// [BN] indicates a bottleneck article (the news pipeline already tags
// article_type=BOTTLENECK or bottleneck_sub_tag), [RR] indicates a re-
// rating catalyst (model shift / margin expansion / multiple expansion).
type StrategyTag = 'MB' | 'BN' | 'RR';
function articleStrategyTags(article: NewsArticle, isMB: boolean): StrategyTag[] {
  const tags: StrategyTag[] = [];
  if (isMB) tags.push('MB');
  const t = (article as any).article_type;
  const subTag = (article as any).bottleneck_sub_tag;
  if (t === 'BOTTLENECK' || subTag) tags.push('BN');
  // Re-rating catalyst proxies: model-shift verbs in title OR earnings + guidance beat
  const titleLower = (article.title || '').toLowerCase();
  const RR_PATTERNS = /\b(re-?rating|multiple expansion|margin expansion|model shift|business model.{0,20}(reclassif|transition)|cyclical.{0,20}compounder|sum-of-parts|hidden value|conglomerate (?:discount|unlock))\b/;
  if (RR_PATTERNS.test(titleLower)) tags.push('RR');
  else if (t === 'EARNINGS' && /\b(beat|guidance.{0,20}(raised|upgraded|hiked))\b/i.test(article.title || '')) tags.push('RR');
  return tags;
}
const STRATEGY_TAG_META: Record<StrategyTag, { label: string; className: string; title: string }> = {
  MB: { label: 'MB',  className: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/40', title: 'Multibagger — matches uploaded watchlist ticker' },
  BN: { label: 'BN',  className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',       title: 'Bottleneck — structural supply constraint article' },
  RR: { label: 'RR',  className: 'bg-violet-500/20 text-violet-300 border-violet-500/40', title: 'Re-rating — model shift / margin or multiple expansion catalyst' },
};

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
  // PATCH 0119 — IMP-02: cross-reference uploaded Multibagger tickers
  // PATCH 0120 — IMP-09: also derive [BN][RR] strategy tags
  const [isWatchlist, setIsWatchlist] = useState(false);
  const [strategyTags, setStrategyTags] = useState<StrategyTag[]>([]);
  useEffect(() => {
    const mb = articleMatchesWatchlist(article);
    setIsWatchlist(mb);
    setStrategyTags(articleStrategyTags(article, mb));
  }, [article]);
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
    <div className={`bg-[#1A2B3C] border rounded-lg p-4 hover:border-[#0F7ABF]/50 transition-colors group ${isWatchlist ? 'border-l-4 border-l-yellow-400 border-[#2A3B4C]' : 'border-[#2A3B4C]'}`}>
      <div className="flex items-start gap-3">
        {/* Importance dot */}
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${IMPORTANCE_DOT[tier]}`} />

        <div className="flex-1 min-w-0">
          {/* Top row: tickers + badge + sentiment + time */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {/* PATCH 0119/0120 — IMP-02/09: Strategy relevance tags [MB][BN][RR] */}
            {strategyTags.map((t) => {
              const meta = STRATEGY_TAG_META[t];
              return (
                <span key={t}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.className}`}
                  title={meta.title}
                >
                  {meta.label}
                </span>
              );
            })}
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
            {/* PATCH 0062: Structural Relevance Score — single visible number 0-100
                so users can prioritize at a glance. Color-coded by tier. */}
            {(article as any).structural_relevance && (() => {
              const sr = (article as any).structural_relevance as { score: number; tier: string; tier_label: string; contributing: string[] };
              const tierColor = sr.tier === 'CONFIRMED'    ? 'bg-emerald-500/30 text-emerald-200 border-emerald-500/50'
                              : sr.tier === 'RECURRING'    ? 'bg-violet-500/25 text-violet-200 border-violet-500/45'
                              : sr.tier === 'THEMATIC'     ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                              : sr.tier === 'SPECULATIVE'  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                                            : 'bg-zinc-700/15 text-zinc-400 border-zinc-700/30';
              return (
                <span
                  className={`shrink-0 ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border ${tierColor}`}
                  title={`Structural relevance ${sr.score}/100 — ${sr.tier_label}.\nDrivers: ${sr.contributing.join(', ') || '—'}`}
                >
                  R {sr.score} · {sr.tier_label}
                </span>
              );
            })()}
            <span className="text-[#4A5B6C] text-[11px] shrink-0">{timeAgo}</span>
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
              {/* PATCH 0051: graph node + event class pills */}
              {(article as any).graph_primary_label && (article as any).graph_primary_node !== 'NONE' && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30" title="System node — permanent ontology primitive">
                  ⬢ {(article as any).graph_primary_label}
                </span>
              )}
              {(article as any).graph_event_class && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                  (article as any).graph_event_class === 'SECULAR' ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40' :
                  (article as any).graph_event_class === 'STRUCTURE' ? 'bg-violet-500/20 text-violet-200 border-violet-500/40' :
                  (article as any).graph_event_class === 'CYCLE' ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' :
                  'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
                }`} title="Event vs structure">
                  {(article as any).graph_event_class.toLowerCase()}
                </span>
              )}
            </div>
          )}

          {/* Specific impact strip — Bloomberg-style "TICKER ±X% vs cons" */}
          {(article as any).specific_impact?.label && (
            <p className="text-[11px] font-mono mt-1 mb-0.5 inline-block px-2 py-0.5 rounded bg-[#0F7ABF]/15 text-[#38A9E8] border border-[#0F7ABF]/30">
              {(article as any).specific_impact.label}
            </p>
          )}

          {/* PATCH 0061: Evidence-bound impact (replaces single-line impact)
              Three rows: Direct effect (FACT) → Second-order (INFERENCE)
              → Evidence quote. Confidence pill on the side. Falls back to
              the older impact_label_safe if the new field isn't present
              (legacy cached articles). */}
          {(article as any).evidence_bound_impact ? (() => {
            const ebi = (article as any).evidence_bound_impact as {
              direct_effect: string;
              second_order_effect?: string;
              confidence: 'HIGH' | 'MEDIUM' | 'LOW';
              evidence_quote?: string;
            };
            const confColor = ebi.confidence === 'HIGH' ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                            : ebi.confidence === 'LOW'  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                                        : 'bg-sky-500/20 text-sky-300 border border-sky-500/40';
            return (
              <div className="mt-1.5 border border-[#1E2D45] rounded p-2 bg-[#0D1B2E]/40">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${confColor}`}
                        title="Confidence — HIGH = article-FACT-anchored, MEDIUM = system inference, LOW = speculative thematic">
                    {ebi.confidence}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Direct effect — what the article says */}
                    <div className="text-[11px] leading-relaxed">
                      <span className="text-[#22d3ee] font-bold mr-1">Direct:</span>
                      <span className="text-[#E6EDF3]">{ebi.direct_effect}</span>
                    </div>
                    {/* Second-order effect — system inference */}
                    {ebi.second_order_effect && (
                      <div className="text-[10px] leading-relaxed mt-1">
                        <span className="text-[#A78BFA] font-bold mr-1">2°:</span>
                        <span className="text-[#A8B5C5]">{ebi.second_order_effect}</span>
                      </div>
                    )}
                    {/* Evidence quote — verbatim text supporting direct */}
                    {ebi.evidence_quote && (
                      <div className="text-[10px] mt-1 text-[#6677AA] italic border-l-2 border-[#22d3ee]/30 pl-2 py-0.5">
                        “{ebi.evidence_quote}”
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })() : (article as any).impact_label_safe && (
            // Legacy fallback for cached articles without evidence_bound_impact
            <div className="flex items-start gap-1.5 mt-1 text-[11px] leading-relaxed">
              <span
                className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide ${
                  (article as any).impact_assertion === 'FACT'        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40' :
                  (article as any).impact_assertion === 'SPECULATION' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                                                                         'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                }`}
                title={`Assertion class: ${(article as any).impact_assertion}`}
              >
                {(article as any).impact_assertion === 'FACT' ? 'fact'
                  : (article as any).impact_assertion === 'SPECULATION' ? 'spec'
                  : 'infer'}
              </span>
              <span className="text-[#C4D2DD]">
                <span className="text-[#6677AA] mr-1">{(article as any).impact_prefix}</span>
                {(article as any).impact_label_safe}
              </span>
            </div>
          )}

          {/* PATCH 0052: Multi-dimensional confidence bar */}
          {(article as any).signal_confidence && (article as any).signal_confidence.confidence_pct > 0 && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px]">
              <span className={`shrink-0 font-bold px-1 py-0.5 rounded uppercase tracking-wide ${
                (article as any).signal_confidence.level === 'HIGH'   ? 'bg-emerald-500/25 text-emerald-300' :
                (article as any).signal_confidence.level === 'MEDIUM' ? 'bg-amber-500/20 text-amber-300' :
                                                                        'bg-zinc-500/20 text-zinc-400'
              }`}>conf {(article as any).signal_confidence.level.toLowerCase()}</span>
              <span className="text-[#8899AA]">{(article as any).signal_confidence.confidence_pct}%</span>
              {(article as any).signal_confidence.evidence_count > 0 && (
                <span className="text-[#6677AA]">· {(article as any).signal_confidence.evidence_count} articles</span>
              )}
              {(article as any).signal_confidence.persistence_days >= 7 && (
                <span className="text-[#6677AA]">· {(article as any).signal_confidence.persistence_days}d persistent</span>
              )}
              {(article as any).signal_confidence.cross_source_confirmation && (
                <span className="text-emerald-400">✓ cross-source</span>
              )}
            </div>
          )}

          {/* PATCH 0052: Freshness layer + defense narrative pills + 0059 structural state */}
          {((article as any).freshness_layer || (article as any).defense_narrative || ((article as any).structural_state && (article as any).structural_state !== 'NONE')) && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {(article as any).freshness_layer && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                  (article as any).freshness_layer === 'LIVE_STRUCTURE'    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                  (article as any).freshness_layer === 'PERSISTENT_THEME'  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' :
                                                                              'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                }`} title="Recency layer">
                  {(article as any).freshness_layer === 'LIVE_STRUCTURE' ? '● live'
                    : (article as any).freshness_layer === 'PERSISTENT_THEME' ? '◑ persistent'
                    : '○ archival'}
                </span>
              )}
              {/* PATCH 0059: structural state pill — replaces the implicit
                  "everything is BOTTLENECK" framing with a precise state */}
              {(article as any).structural_state && (article as any).structural_state !== 'NONE' && (() => {
                const state = (article as any).structural_state;
                const conf = (article as any).structural_state_confidence ?? 0;
                const labelMap: Record<string, string> = {
                  BOTTLENECK:         '🚧 bottleneck',
                  CAPACITY_EXPANSION: '🏗 capacity expansion',
                  CAPEX_BUILDOUT:     '💰 capex buildout',
                  SUPPLY_RESPONSE:    '📈 supply response',
                  DEMAND_SURGE:       '🔥 demand surge',
                  POLICY_SUPPORT:     '📜 policy support',
                };
                const styleMap: Record<string, string> = {
                  BOTTLENECK:         'bg-rose-500/20 text-rose-300 border-rose-500/40',
                  CAPACITY_EXPANSION: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                  CAPEX_BUILDOUT:     'bg-blue-500/20 text-blue-300 border-blue-500/40',
                  SUPPLY_RESPONSE:    'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                  DEMAND_SURGE:       'bg-orange-500/20 text-orange-300 border-orange-500/40',
                  POLICY_SUPPORT:     'bg-violet-500/20 text-violet-300 border-violet-500/40',
                };
                return (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${styleMap[state] || ''}`}
                    title={`Structural state — confidence ${conf}%. Bottleneck (constraint), Capacity Expansion (new supply), Capex Buildout (orders), Supply Response (easing), Demand Surge (orders rising), Policy Support (PLI/FDI/regulatory).`}
                  >
                    {labelMap[state] || state.toLowerCase()}
                  </span>
                );
              })()}
              {(article as any).defense_narrative && (article as any).defense_narrative !== 'GENERIC' && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30" title="Defense narrative">
                  ⚔ {(article as any).defense_narrative.replace(/_/g, ' ').toLowerCase()}
                </span>
              )}
              {(article as any).bottleneck_parent && (article as any).bottleneck_parent !== 'NONE' && (article as any).bottleneck_child && (
                <span className="text-[10px] text-[#6677AA] font-mono">
                  {(article as any).bottleneck_parent.replace(/_/g, ' ').toLowerCase()} › {(article as any).bottleneck_child.replace(/_/g, ' ').toLowerCase()}
                </span>
              )}
            </div>
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

          {/* PATCH 0063: Dependency graph — primary node → 1-hop dependents
              Shows the system map for any article whose semantic graph
              fired. e.g. COMPUTE_INFRA → MEMORY / PACKAGING / FAB / etc.
              Compressed to one line of pills with arrow separator. */}
          {(article as any).graph_primary_node &&
           (article as any).graph_primary_node !== 'NONE' &&
           ((article as any).graph_dependent_nodes || []).length > 0 && (() => {
             const NODE_LABEL: Record<string, string> = {
               COMPUTE_INFRA: 'Compute', MEMORY_INFRA: 'Memory', PACKAGING_INFRA: 'Packaging',
               FABRICATION_INFRA: 'Fab', INTERCONNECT_INFRA: 'Interconnect', COOLING_INFRA: 'Cooling',
               NETWORK_BANDWIDTH: 'Network', ENERGY_INFRA: 'Energy', NUCLEAR_INFRA: 'Nuclear',
               OIL_GAS_INFRA: 'Oil/Gas', RENEWABLE_INFRA: 'Renewable', LOGISTICS_INFRA: 'Logistics',
               TRANSPORT_INFRA: 'Transport', DEFENSE_INFRA: 'Defense', AEROSPACE_INFRA: 'Aerospace',
               RESOURCE_SCARCITY: 'Resource', AGRI_INFRA: 'Agri', MANUFACTURING_CAPACITY: 'Mfg',
               LABOR_CONSTRAINT: 'Labor', CAPITAL_CONSTRAINT: 'Capital',
             };
             const NODE_COLOR: Record<string, string> = {
               COMPUTE_INFRA: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
               MEMORY_INFRA: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
               PACKAGING_INFRA: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
               FABRICATION_INFRA: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
               INTERCONNECT_INFRA: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
               COOLING_INFRA: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
               ENERGY_INFRA: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
               NUCLEAR_INFRA: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
               OIL_GAS_INFRA: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
               RENEWABLE_INFRA: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
               LOGISTICS_INFRA: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
               DEFENSE_INFRA: 'bg-red-500/20 text-red-300 border-red-500/40',
               AEROSPACE_INFRA: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
               RESOURCE_SCARCITY: 'bg-stone-500/20 text-stone-300 border-stone-500/40',
             };
             const primary = (article as any).graph_primary_node as string;
             const dependents = ((article as any).graph_dependent_nodes as string[]).slice(0, 5);
             const primaryStyle = NODE_COLOR[primary] || 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40';
             return (
               <div
                 className="mt-1.5 text-[10px] flex items-center gap-1.5 flex-wrap"
                 title={`System map — this article fires on the ${NODE_LABEL[primary] || primary} node, which depends on ${dependents.length} downstream nodes.`}
               >
                 <span className="text-[#4A5B6C] uppercase tracking-wide mr-1">graph</span>
                 <span className={`px-1.5 py-0.5 rounded border font-bold ${primaryStyle}`}>
                   ⬢ {NODE_LABEL[primary] || primary}
                 </span>
                 <span className="text-[#0F7ABF]">→</span>
                 {dependents.map((d, i) => (
                   <span key={d} className={`px-1.5 py-0.5 rounded border ${NODE_COLOR[d] || 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'}`}>
                     {NODE_LABEL[d] || d}
                   </span>
                 ))}
               </div>
             );
           })()}

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

          {/* PATCH 0050: Why-This-Matters PM line */}
          {(article as any).why_this_matters && (
            <div className="text-[11px] mt-2 leading-relaxed border-l-2 border-amber-500/50 pl-2 py-1 bg-amber-500/5">
              <span className="text-amber-400 font-bold mr-1">Why this matters:</span>
              <span className="text-[#C4D2DD]">{(article as any).why_this_matters}</span>
            </div>
          )}

          {/* PATCH 0050: Consensus vs Variant block */}
          {(article as any).consensus_variant && (
            <div className="mt-2 border border-[#1E2D45] rounded p-2 text-[10px] leading-relaxed bg-[#0D1B2E]/50">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div>
                  <span className="text-[#6677AA] uppercase tracking-wide">Consensus</span>
                  <div className="text-[#C4D2DD]">{(article as any).consensus_variant.consensus}</div>
                </div>
                <div>
                  <span className="text-[#F59E0B] uppercase tracking-wide">Variant View</span>
                  <div className="text-[#F5F7FA] font-medium">{(article as any).consensus_variant.variant}</div>
                </div>
                <div>
                  <span className="text-[#6677AA] uppercase tracking-wide">Market Pricing</span>
                  <div className="text-[#8899AA]">{(article as any).consensus_variant.market_pricing}</div>
                </div>
                <div>
                  <span className="text-[#EF4444] uppercase tracking-wide">Risk</span>
                  <div className="text-[#8899AA]">{(article as any).consensus_variant.risk}</div>
                </div>
              </div>
            </div>
          )}

          {/* PATCH 0050: Multi-hop causal chain */}
          {((article as any).causal_chain || []).length > 0 && (
            <div className="mt-2 text-[10px] leading-relaxed">
              <div className="text-[#6677AA] uppercase tracking-wide mb-1">Causal chain</div>
              <div className="flex flex-col gap-0.5 pl-2 border-l border-[#1E2D45]">
                {((article as any).causal_chain as Array<{ from: string; to: string; mechanism: string }>).map((link, i) => (
                  <div key={i} className="text-[#8899AA]">
                    <span className="text-[#C4D2DD]">{link.from}</span>
                    <span className="text-[#0F7ABF] mx-1">→</span>
                    <span className="text-[#C4D2DD]">{link.to}</span>
                    <span className="text-[#4A5B6C] italic ml-1">({link.mechanism})</span>
                  </div>
                ))}
              </div>
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

          {/* PATCH 0084: 6-layer beneficiary engine + T0-T4 transmission cascade
              Collapsed view: one strip with L1..L6 icons + top 3 tickers per layer
              Expanded view: per-layer chips with rationale tooltips + transmission timing */}
          {(article as any).layered_beneficiaries && ((article as any).layered_beneficiaries.fired_layers || []).length > 0 && (() => {
            const lb = (article as any).layered_beneficiaries as {
              bottleneck: string;
              bottleneck_label: string;
              fired_layers: string[];
              layers: Record<string, Array<{ ticker: string; rationale: string; pricing_leverage: 'STRONG'|'MEDIUM'|'WEAK'; size: 'LARGE_CAP'|'MID_CAP'|'SMALL_CAP'; mandatory?: boolean; sub_layer?: 'GPU_SUB'|'CPU_CYCLE' }>>;
              transmission: { T0: string; T1: string; T2: string; T3: string; T4: string };
            };
            const LAYER_META: Record<string, { icon: string; label: string; tagline: string; color: string }> = {
              L1: { icon: '🧱', label: 'Direct Scarcity Capture',     tagline: 'Input pricing power',                  color: 'bg-amber-500/15 text-amber-300 border-amber-500/40'   },
              L2: { icon: '⚙️', label: 'Compute Substitutes',          tagline: 'GPU / CPU / ARM substitution',         color: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
              L3: { icon: '🌐', label: 'Edge Distribution',            tagline: 'CDN / latency / bandwidth',             color: 'bg-sky-500/15 text-sky-300 border-sky-500/40'           },
              L4: { icon: '🧪', label: 'Transmission Winners',         tagline: 'Sterlite-type pass-through',            color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
              L5: { icon: '🏢', label: 'Platform Beneficiaries',       tagline: 'Hyperscaler demand aggregators',        color: 'bg-blue-500/15 text-blue-300 border-blue-500/40'        },
              L6: { icon: '⚡', label: 'Infrastructure / Efficiency',  tagline: 'Power, thermal, perf-per-watt',         color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40' },
            };
            const LEVERAGE_DOT: Record<string, string> = {
              STRONG: 'bg-emerald-400', MEDIUM: 'bg-amber-400', WEAK: 'bg-zinc-500',
            };
            const SIZE_SUFFIX: Record<string, string> = { LARGE_CAP: '', MID_CAP: 'm', SMALL_CAP: 's' };

            return (
              <details className="mt-2 group/layers">
                <summary className="flex items-center gap-1.5 flex-wrap text-[10px] cursor-pointer select-none list-none marker:hidden">
                  <span className="text-[#4A5B6C] uppercase tracking-wide mr-1 group-open/layers:text-[#0F7ABF]">capital flow</span>
                  {lb.fired_layers.map((L) => {
                    const meta = LAYER_META[L];
                    const top3 = (lb.layers[L] || []).slice(0, 3).map((t) => t.ticker).join(' · ');
                    return (
                      <span
                        key={L}
                        className={`px-1.5 py-0.5 rounded border font-medium ${meta.color}`}
                        title={`${meta.label} — ${meta.tagline}`}
                      >
                        {meta.icon} {L}: <span className="font-mono">{top3 || '—'}</span>
                      </span>
                    );
                  })}
                  <span className="text-[#4A5B6C] ml-1 text-[9px] group-open/layers:hidden">(click to expand)</span>
                </summary>

                {/* Expanded: per-layer chip stack
                    PATCH 0087: when layer === 'L2', split chips into GPU_SUB and
                    CPU_CYCLE sub-clusters with their own sub-headers. Other layers
                    render flat. */}
                <div className="mt-2 border-l-2 border-[#0F7ABF]/40 pl-2.5 space-y-2 bg-[#0D1B2E]/30 rounded-r py-2">
                  {lb.fired_layers.map((L) => {
                    const meta = LAYER_META[L];
                    const tickers = lb.layers[L] || [];
                    if (tickers.length === 0) return null;
                    const renderChip = (t: typeof tickers[number]) => (
                      <span
                        key={`${t.ticker}-${t.sub_layer ?? ''}`}
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-[#1A2B3C] ${
                          t.mandatory ? 'border-amber-500/50 text-amber-200' : 'border-[#2A3B4C] text-[#C4D2DD]'
                        }`}
                        title={`${t.rationale}\nPricing leverage: ${t.pricing_leverage}${t.mandatory ? ' · Mandatory injection' : ''}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${LEVERAGE_DOT[t.pricing_leverage] || 'bg-zinc-500'}`} />
                        <span className="font-mono font-bold">{t.ticker}</span>
                        {SIZE_SUFFIX[t.size] && (
                          <span className="text-[8px] text-[#6677AA] uppercase">{SIZE_SUFFIX[t.size]}</span>
                        )}
                        {t.mandatory && <span className="text-[8px] text-amber-400" title="Mandatory injection — structurally required for this node-class">★</span>}
                      </span>
                    );
                    return (
                      <div key={L}>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.color}`}>
                            {meta.icon} {L} — {meta.label}
                          </span>
                          <span className="text-[9px] text-[#6677AA] italic">{meta.tagline}</span>
                        </div>
                        {L === 'L2' ? (() => {
                          const gpuSub = tickers.filter((t) => t.sub_layer === 'GPU_SUB');
                          const cpuCycle = tickers.filter((t) => t.sub_layer === 'CPU_CYCLE');
                          const untagged = tickers.filter((t) => !t.sub_layer);
                          return (
                            <div className="space-y-1.5">
                              {gpuSub.length > 0 && (
                                <div>
                                  <div className="text-[9px] text-violet-300/80 mb-0.5">⚙️ L2A · GPU substitution <span className="text-[#6677AA]">(in-stack share displacement)</span></div>
                                  <div className="flex flex-wrap gap-1.5">{gpuSub.map(renderChip)}</div>
                                </div>
                              )}
                              {cpuCycle.length > 0 && (
                                <div>
                                  <div className="text-[9px] text-fuchsia-300/80 mb-0.5">🧠 L2B · CPU cycle <span className="text-[#6677AA]">(GPU scarcity → CPU attach + AI-PC + perf/watt)</span></div>
                                  <div className="flex flex-wrap gap-1.5">{cpuCycle.map(renderChip)}</div>
                                </div>
                              )}
                              {untagged.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">{untagged.map(renderChip)}</div>
                              )}
                            </div>
                          );
                        })() : (
                          <div className="flex flex-wrap gap-1.5">{tickers.map(renderChip)}</div>
                        )}
                      </div>
                    );
                  })}

                  {/* Transmission cascade T0 → T4 */}
                  <div className="mt-2 pt-2 border-t border-[#1E2D45]">
                    <div className="text-[9px] text-[#6677AA] uppercase tracking-wide mb-1">Transmission cascade</div>
                    <div className="flex flex-col gap-0.5 text-[10px]">
                      {([
                        ['T0', 'now',     lb.transmission.T0, 'text-cyan-300'],
                        ['T1', '0–1Q',    lb.transmission.T1, 'text-sky-300'],
                        ['T2', '1–3Q',    lb.transmission.T2, 'text-emerald-300'],
                        ['T3', '3–6Q',    lb.transmission.T3, 'text-amber-300'],
                        ['T4', '6–12Q',   lb.transmission.T4, 'text-fuchsia-300'],
                      ] as const).map(([t, q, txt, cls]) => (
                        <div key={t} className="flex gap-2">
                          <span className={`shrink-0 font-mono font-bold ${cls}`}>{t}</span>
                          <span className="shrink-0 text-[9px] text-[#6677AA] font-mono w-12">{q}</span>
                          <span className="text-[#C4D2DD] leading-snug">{txt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            );
          })()}

          {/* Source + tier + also-reported (PATCH 0115 — BUG-04 dedup) */}
          <span className="text-[#4A5B6C] text-[11px]">
            {article.source_name ?? article.source}
            {(article as any).source_tier && (article as any).source_tier !== 'secondary' && (
              <span className="ml-1 opacity-60">· {(article as any).source_tier}</span>
            )}
            {(article as any).also_reported_by_count > 0 && (
              <span
                className="ml-2 px-1.5 py-[1px] rounded bg-[#1A2840] text-[#8A95A3] text-[10px] font-semibold"
                title={`Also reported by: ${((article as any).also_reported_sources || []).join(', ')}`}
              >
                + {(article as any).also_reported_by_count} {(article as any).also_reported_by_count === 1 ? 'source' : 'sources'}
              </span>
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
