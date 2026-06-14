'use client';

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTEL — site-wide guidance widget.
//
// Drop this on any page that knows a ticker (Stock Sheet, Multibagger row,
// Earnings Hub card, Portfolio drilldown, Bottleneck Workbench, etc.) and
// it will fetch+render the persisted guidance items for that company. If
// there's no corpus yet, it shows an "upload via /company-intel" hint
// instead of crashing or showing nothing useful.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { categoryLabel, type GuidanceItem } from '@/lib/company-intel/guidance-extractor';

interface Corpus {
  ticker: string;
  company?: string;
  documents: any[];
  guidance: (GuidanceItem & { source_doc_id?: string })[];
  summary?: string;
  updated_at: string;
}

export function CompanyIntelGuidance({ ticker, compact = false }: { ticker?: string; compact?: boolean }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [loading, setLoading] = useState(false);
  // PATCH 0692 — track explicit error state so we can show a Retry CTA instead
  // of silently falling through to the "No uploaded transcripts" empty-state
  // when the fetch genuinely failed (timeout/network/server error).
  const [errored, setErrored] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!ticker) return;
    const tk = String(ticker).toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '');
    if (!tk) return;
    setLoading(true);
    setErrored(false);
    // PATCH 0469 — 15s timeout + cancel-on-unmount via AbortController so
    // a slow corpus fetch can't trigger setState on an unmounted component.
    // PATCH 0692 — surface timeout / network failures via setErrored so the
    // user sees a Retry button instead of an empty-state lie.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    fetch(`/api/v1/company-intel/${encodeURIComponent(tk)}`, { signal: ctl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(j => setCorpus(j))
      .catch(() => { setCorpus(null); setErrored(true); })
      .finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [ticker, reloadKey]);

  if (!ticker) return null;
  if (loading) return (
    <div style={{ padding: 12, fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>
      Loading company intelligence…
    </div>
  );
  // PATCH 0692 — explicit error / timeout panel with Retry button.
  if (errored) {
    return (
      <div style={{
        padding: 12, fontSize: 11, color: 'var(--mc-warn)',
        border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 6, background: 'rgba(251,191,36,0.06)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span>Company intelligence unavailable</span>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          style={{
            marginLeft: 'auto', padding: '3px 10px', fontSize: 10, fontWeight: 700,
            color: 'var(--mc-bg-0)', background: 'var(--mc-warn)', border: 'none', borderRadius: 4,
            cursor: 'pointer', letterSpacing: '0.4px',
          }}
        >
          RETRY
        </button>
      </div>
    );
  }
  if (!corpus || !corpus.guidance || corpus.guidance.length === 0) {
    return (
      <div style={{
        padding: 12, fontSize: 11, color: 'var(--mc-text-3)',
        border: '1px dashed var(--mc-bg-4)', borderRadius: 6, background: 'rgba(34,211,238,0.04)',
      }}>
        No uploaded transcripts for <strong style={{ color: 'var(--mc-cyan)' }}>{ticker}</strong>.
        Add concall / PPT text via{' '}
        <Link href={`/company-intel`} style={{ color: 'var(--mc-cyan)', textDecoration: 'underline' }}>
          Company Intelligence
        </Link>{' '}
        — guidance will surface here automatically.
      </div>
    );
  }

  const items = compact ? corpus.guidance.slice(0, 5) : corpus.guidance;

  return (
    <div style={{ padding: compact ? 10 : 14, background: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 6 : 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-bullish)', letterSpacing: '0.5px' }}>
          📈 STORED GUIDANCE
        </span>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
          {corpus.guidance.length} items · {corpus.documents.length} docs · updated {new Date(corpus.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </span>
        <Link href={`/company-intel`} style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', fontWeight: 600 }}>
          full corpus →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((g, i) => (
          <div key={i} title={g.quote} style={{ padding: '5px 8px', borderLeft: '2px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', background: 'rgba(16,185,129,0.04)', borderRadius: 3 }}>
            <span style={{ fontSize: 9, color: 'var(--mc-bullish)', fontWeight: 700, letterSpacing: '0.3px', marginRight: 6 }}>
              {categoryLabel(g.category)}{g.year ? ` · ${g.year}` : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--mc-text-1)', fontWeight: 600 }}>{g.text}</span>
          </div>
        ))}
        {compact && corpus.guidance.length > 5 && (
          <Link href={`/company-intel`} style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'underline', marginTop: 4 }}>
            +{corpus.guidance.length - 5} more guidance items →
          </Link>
        )}
      </div>
    </div>
  );
}
