'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { classifySource, TIER_VISUAL } from '@/lib/source-tiers';
import { openPassport } from '@/lib/engines';
import { getTickerSymbols, getTitle, getSource, getUrl, sentimentBadge, loadNote, saveNote, regionFlag, typeColor, importanceDot, timeAgo } from './helpers';
import { type NewsArticle } from './types';

export function ArticleDetail({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);
  // PATCH 0233 — Per-article notebook
  const [noteText, setNoteText] = useState(() => loadNote(article.id));
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  // Debounced autosave
  useEffect(() => {
    const id = setTimeout(() => {
      saveNote(article.id, noteText);
      setNoteSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(id);
  }, [noteText, article.id]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '0px', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '0px', width: '100%', maxWidth: '700px', height: '100vh', maxHeight: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        className="article-detail-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', fontSize: '18px', padding: '4px 8px' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Tags row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{regionFlag(article.region)}</span>
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: typeColor(article.article_type) + '22',
            color: typeColor(article.article_type),
            border: `1px solid ${typeColor(article.article_type)}40`,
          }}>
            {article.article_type?.replace(/_/g, ' ')}
          </span>
          {sentiment && (
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: sentiment.bg, color: sentiment.color, border: `1px solid ${sentiment.border}`,
            }}>
              {sentiment.icon} {sentiment.label}
            </span>
          )}
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: importanceDot(article.importance_score) + '22',
            color: importanceDot(article.importance_score),
            border: `1px solid ${importanceDot(article.importance_score)}40`,
          }}>
            Importance: {article.importance_score}/5
          </span>
        </div>

        {/* Headline */}
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 12px', lineHeight: '1.4' }}>
          {title}
        </h2>

        {/* Source & time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--mc-accent)' }}>{source}</span>
          <span style={{ fontSize: '12px', color: 'var(--mc-border-2)' }}>·</span>
          <span style={{ fontSize: '12px', color: 'var(--mc-text-4)' }}>{timeAgo(article.published_at)}</span>
        </div>

        {/* Bottleneck themes */}
        {article.themes && article.themes.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>BOTTLENECK CATEGORIES</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {article.themes.map(th => (
                <span key={th} style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)', color: '#F87171', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)' }}>
                  {th.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tickers */}
        {symbols.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>RELATED TICKERS</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {symbols.map(t => (
                <span key={t} onClick={() => openPassport(t)} title="Open Stock Passport" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 9%, transparent)', color: 'var(--mc-accent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {article.summary ? (
          <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 10px', letterSpacing: '0.5px' }}>SUMMARY</p>
            <p style={{ fontSize: '14px', color: 'var(--mc-text-2)', margin: 0, lineHeight: '1.7' }}>
              {article.summary}
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--mc-text-4)', fontStyle: 'italic', margin: 0 }}>
              No summary available for this article.
            </p>
          </div>
        )}

        {/* PATCH 0232 — Evidence Panel v0 section. Surfaces the data the
            article payload already carries so users can audit a signal's
            provenance without leaving the page. Real evidence chain (with
            classifier feature traces + cross-article corroboration timeline)
            lands once the SignalEvidence schema is in place. */}
        <div style={{
          marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mc-border-1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-cyan)', letterSpacing: '0.6px', marginBottom: 10 }}>
            EVIDENCE & PROVENANCE
          </div>
          {/* Source tier */}
          {(() => {
            const tier = classifySource(article.source_name ?? article.source, article.source_url ?? article.url);
            const v = TIER_VISUAL[tier];
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>SOURCE TIER</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  backgroundColor: v.tone.bg, color: v.tone.solid,
                  border: `1px solid ${v.tone.border}`,
                  padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  fontFamily: 'ui-monospace, monospace',
                }}>{v.glyph} {v.label}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>{v.description}</span>
              </div>
            );
          })()}
          {/* Corroboration */}
          {(article as any).also_reported_by_count > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>CORROBORATED</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--mc-text-2)', marginBottom: 4 }}>
                  By {(article as any).also_reported_by_count} other source{(article as any).also_reported_by_count === 1 ? '' : 's'}:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(((article as any).also_reported_sources || []) as string[]).map((s, i) => (
                    <span key={`${s}-${i}`} style={{
                      backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)',
                      borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'var(--mc-text-3)',
                    }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Severity contributors (what fields drove the rank) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>WHY RANKED</span>
            <div style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-2)', fontFamily: 'ui-monospace, monospace', lineHeight: 1.6 }}>
              <div>  importance: {article.importance_score ?? '—'} / 5</div>
              {article.bottleneck_level && <div>  bottleneck:  {article.bottleneck_level.replace(/_/g, ' ')}</div>}
              {(article as any).investment_tier && <div>  tier:        {(article as any).investment_tier}</div>}
              {(article as any).structural_relevance?.score != null && (
                <div>  structural:  {(article as any).structural_relevance.score} ({(article as any).structural_relevance.tier_label})</div>
              )}
              {(article as any).signal_confidence?.confidence_pct != null && (
                <div>  confidence:  {(article as any).signal_confidence.confidence_pct}%</div>
              )}
              <div style={{ marginTop: 4, color: '#6B7B8C', fontFamily: 'inherit' }}>
                Full classifier feature trace lands once the SignalEvidence schema ships (P0 follow-up).
              </div>
            </div>
          </div>
          {/* Lifecycle */}
          {(() => {
            const ts = new Date(article.published_at || (article as any).ingested_at || 0).getTime();
            const age = Date.now() - ts;
            const ageH = age / 3600_000;
            const bucket = ageH <= 24 ? 'LIVE' : ageH <= 48 ? 'WARM' : ageH <= 168 ? 'STALE' : 'PERSISTENT';
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>LIFECYCLE</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-2)' }}>
                  {bucket} · published {article.published_at ? new Date(article.published_at).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}
                </span>
              </div>
            );
          })()}
        </div>

        {/* PATCH 0233 — Thesis Notebook v0 (per-article notes, localStorage) */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mc-border-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-cyan)', letterSpacing: '0.6px' }}>
              📝 ANALYST NOTE
            </span>
            <span style={{ fontSize: 9, color: '#6B7B8C', fontFamily: 'ui-monospace, monospace' }}>
              {noteSavedAt ? `saved ${new Date(noteSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'autosaves to this browser'}
            </span>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Thesis, decision rationale, ticker tags, follow-ups…  (Markdown supported. Local to this browser until Notebooks server-side ships.)"
            style={{
              width: '100%', minHeight: 96, resize: 'vertical',
              backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-1)',
              borderRadius: 6, padding: '8px 10px', color: 'var(--mc-text-0)',
              fontSize: 12, fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.5, outline: 'none',
            }}
          />
          {noteText.trim().length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#6B7B8C' }}>{noteText.length} chars</span>
              <button
                onClick={() => { if (window.confirm('Delete this note?')) setNoteText(''); }}
                style={{
                  marginLeft: 'auto', background: 'none', border: '1px solid var(--mc-border-1)',
                  color: '#6B7B8C', borderRadius: 4, padding: '2px 8px',
                  fontSize: 10, cursor: 'pointer',
                }}
              >Clear</button>
            </div>
          )}
        </div>

        {/* External link */}
        {url && url !== '#' && (
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: '600', color: 'var(--mc-accent)', textDecoration: 'none',
              padding: '8px 16px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--mc-accent) 6%, transparent)', marginTop: 16,
            }}
          >
            Open original article <ExternalLink style={{ width: '12px', height: '12px' }} />
          </a>
        )}
      </div>
    </div>
  );
}
