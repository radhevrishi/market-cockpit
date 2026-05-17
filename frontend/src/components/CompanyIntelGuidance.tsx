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

  useEffect(() => {
    if (!ticker) return;
    const tk = String(ticker).toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '');
    if (!tk) return;
    setLoading(true);
    fetch(`/api/v1/company-intel/${encodeURIComponent(tk)}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => setCorpus(j))
      .catch(() => setCorpus(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (!ticker) return null;
  if (loading) return (
    <div style={{ padding: 12, fontSize: 11, color: '#8A95A3', fontStyle: 'italic' }}>
      Loading company intelligence…
    </div>
  );
  if (!corpus || !corpus.guidance || corpus.guidance.length === 0) {
    return (
      <div style={{
        padding: 12, fontSize: 11, color: '#8A95A3',
        border: '1px dashed #1A2540', borderRadius: 6, background: 'rgba(34,211,238,0.04)',
      }}>
        No uploaded transcripts for <strong style={{ color: '#22D3EE' }}>{ticker}</strong>.
        Add concall / PPT text via{' '}
        <Link href={`/company-intel`} style={{ color: '#22D3EE', textDecoration: 'underline' }}>
          Company Intelligence
        </Link>{' '}
        — guidance will surface here automatically.
      </div>
    );
  }

  const items = compact ? corpus.guidance.slice(0, 5) : corpus.guidance;

  return (
    <div style={{ padding: compact ? 10 : 14, background: '#0A1422', border: '1px solid #1A2540', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 6 : 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#10B981', letterSpacing: '0.5px' }}>
          📈 STORED GUIDANCE
        </span>
        <span style={{ fontSize: 10, color: '#6B7A8D' }}>
          {corpus.guidance.length} items · {corpus.documents.length} docs · updated {new Date(corpus.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </span>
        <Link href={`/company-intel`} style={{ marginLeft: 'auto', fontSize: 10, color: '#22D3EE', textDecoration: 'none', fontWeight: 600 }}>
          full corpus →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((g, i) => (
          <div key={i} title={g.quote} style={{ padding: '5px 8px', borderLeft: '2px solid #10B98160', background: 'rgba(16,185,129,0.04)', borderRadius: 3 }}>
            <span style={{ fontSize: 9, color: '#10B981', fontWeight: 700, letterSpacing: '0.3px', marginRight: 6 }}>
              {categoryLabel(g.category)}{g.year ? ` · ${g.year}` : ''}
            </span>
            <span style={{ fontSize: 12, color: '#E6EDF3', fontWeight: 600 }}>{g.text}</span>
          </div>
        ))}
        {compact && corpus.guidance.length > 5 && (
          <Link href={`/company-intel`} style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'underline', marginTop: 4 }}>
            +{corpus.guidance.length - 5} more guidance items →
          </Link>
        )}
      </div>
    </div>
  );
}
