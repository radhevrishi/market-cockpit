'use client';

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE HUB — PATCH 0455
//
// Single tab where the user uploads concall transcripts, earnings PPTs,
// guidance documents per company. Everything persists in KV and is
// retrievable site-wide (Stock Sheet, Multibagger, Earnings Hub all read
// from the same store).
//
// Two main views:
//   1. UPLOAD — paste / drop text per ticker; auto-extract guidance
//      preview before saving.
//   2. GUIDANCE TABLE — flat list across all stored companies (mirrors the
//      reference table the user shared: Company | Growth Guidance).
//      Click a row → drilldown into that company's full corpus.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, Trash2, Search, RefreshCw } from 'lucide-react';
import { extractGuidance, categoryLabel, type GuidanceItem } from '@/lib/company-intel/guidance-extractor';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';
const ACCENT = '#22D3EE';

type Tab = 'upload' | 'table' | 'drilldown';

interface TableRow {
  ticker: string;
  company?: string;
  summary?: string;
  doc_count: number;
  guidance_count: number;
  updated_at: string;
  top_guidance: { category: string; text: string }[];
}

interface IntelDoc {
  id: string;
  kind: string;
  title: string;
  text: string;
  uploaded_at: string;
  size_chars: number;
}

interface IntelCorpus {
  ticker: string;
  company?: string;
  documents: IntelDoc[];
  guidance: (GuidanceItem & { source_doc_id?: string })[];
  summary?: string;
  updated_at: string;
}

export default function CompanyIntelPage() {
  const [tab, setTab] = useState<Tab>('table');
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [drillTicker, setDrillTicker] = useState<string>('');
  const [drillCorpus, setDrillCorpus] = useState<IntelCorpus | null>(null);

  // ── Upload form state ─────────────────────────────────────────────────
  const [ticker, setTicker] = useState('');
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<IntelDoc['kind']>('concall_transcript');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live preview of extracted guidance — runs client-side as user types.
  const preview = useMemo(() => {
    if (text.length < 30) return [];
    return extractGuidance(text);
  }, [text]);

  // ── Loaders ───────────────────────────────────────────────────────────
  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/company-intel/index', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRows(j.rows || []);
    } catch (e) {
      console.error('[company-intel] index fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCorpus = useCallback(async (tk: string) => {
    try {
      const res = await fetch(`/api/v1/company-intel/${encodeURIComponent(tk)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setDrillCorpus(j);
    } catch (e) {
      console.error('[company-intel] corpus fetch failed', e);
      setDrillCorpus(null);
    }
  }, []);

  useEffect(() => { loadIndex(); }, [loadIndex]);
  useEffect(() => {
    if (tab === 'drilldown' && drillTicker) loadCorpus(drillTicker);
  }, [tab, drillTicker, loadCorpus]);

  // ── File pick → read text ─────────────────────────────────────────────
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const out = String(r.result || '');
      setText(out);
      if (!title) setTitle(f.name);
    };
    r.readAsText(f);
  };

  // ── Submit upload ─────────────────────────────────────────────────────
  const submit = async () => {
    if (!ticker.trim() || text.trim().length < 30) {
      setUploadResult('⚠ Ticker required and text must be at least 30 chars.');
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await fetch(`/api/v1/company-intel/${encodeURIComponent(ticker.trim().toUpperCase())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          kind,
          title: title || undefined,
          company: company || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setUploadResult(`⚠ Upload failed: ${j?.error || res.status}`);
      } else {
        setUploadResult(
          `✓ Saved · ${j.doc_count} docs total · ${j.guidance_count} guidance items · ${j.guidance_extracted_now} newly extracted.`
        );
        setText('');
        setTitle('');
        if (fileRef.current) fileRef.current.value = '';
        loadIndex();
      }
    } catch (e: any) {
      setUploadResult(`⚠ Upload threw: ${e?.message || 'unknown'}`);
    } finally {
      setUploading(false);
    }
  };

  // ── Filtered table rows ───────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const blob = `${r.ticker} ${r.company || ''} ${r.summary || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>📚 Company Intelligence</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: DIM, maxWidth: 900, lineHeight: 1.5 }}>
            Upload concall transcripts, earnings PPTs, guidance docs per ticker.
            All data persists across sessions and is available site-wide. Re-uploads
            merge into the existing corpus (no overwrites). Guidance items (revenue,
            EBITDA, capex, operating leverage, peak revenue, order book) are auto-extracted
            with source quotes preserved for auditability.
          </p>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { id: 'table' as Tab, label: '📋 Guidance Table', desc: 'all stored companies' },
            { id: 'upload' as Tab, label: '⬆ Upload Document', desc: 'transcripts / PPTs / guidance' },
            { id: 'drilldown' as Tab, label: '🔎 Company Drilldown', desc: 'pick a ticker, see full corpus' },
          ].map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={t.desc}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: `1px solid ${active ? ACCENT : BORDER}`,
                  background: active ? `${ACCENT}20` : 'transparent',
                  color: active ? ACCENT : DIM,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >{t.label}</button>
            );
          })}
          <button
            onClick={loadIndex}
            disabled={loading}
            title="Reload guidance table"
            style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: DIM, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} /> RELOAD
            <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
          </button>
        </div>

        {/* ── TABLE VIEW ──────────────────────────────────────────────── */}
        {tab === 'table' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <Search size={14} style={{ color: DIM }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ticker / company / guidance…"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD, color: TEXT, fontSize: 13, outline: 'none' }}
              />
              <span style={{ fontSize: 11, color: DIM }}>{visibleRows.length} of {rows.length} companies</span>
            </div>
            {visibleRows.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: DIM }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>No companies stored yet</p>
                <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                  Switch to the <strong style={{ color: ACCENT }}>⬆ Upload Document</strong> tab to add your first transcript or PPT.
                </p>
              </div>
            ) : (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#0A1422', borderBottom: `1px solid ${BORDER}` }}>
                      <th style={th}>TICKER</th>
                      <th style={th}>COMPANY</th>
                      <th style={th}>GROWTH GUIDANCE</th>
                      <th style={{ ...th, textAlign: 'right' }}>DOCS</th>
                      <th style={{ ...th, textAlign: 'right' }}>ITEMS</th>
                      <th style={th}>UPDATED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => (
                      <tr key={r.ticker}
                        onClick={() => { setDrillTicker(r.ticker); setTab('drilldown'); }}
                        style={{
                          borderBottom: i < visibleRows.length - 1 ? `1px solid ${BORDER}` : 'none',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ ...td, color: ACCENT, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.ticker}</td>
                        <td style={{ ...td, color: TEXT, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company || '—'}</td>
                        <td style={{ ...td, color: TEXT, lineHeight: 1.5, fontSize: 12.5 }}>
                          {r.summary
                            ? r.summary
                            : <span style={{ color: DIM, fontStyle: 'italic' }}>No guidance items extracted yet — re-upload with longer transcript.</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: DIM, fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{r.doc_count}</td>
                        <td style={{ ...td, textAlign: 'right', color: DIM, fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{r.guidance_count}</td>
                        <td style={{ ...td, color: DIM, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── UPLOAD VIEW ─────────────────────────────────────────────── */}
        {tab === 'upload' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TEXT, fontWeight: 700 }}>📤 Upload to corpus</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                <Field label="Ticker (required)">
                  <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                    placeholder="AEROFLEX, NAVINFLUOR, ITC, …"
                    style={inputStyle} />
                </Field>
                <Field label="Company name (optional)">
                  <input value={company} onChange={e => setCompany(e.target.value)}
                    placeholder="Aeroflex Industries Ltd"
                    style={inputStyle} />
                </Field>
                <Field label="Document kind">
                  <select value={kind} onChange={e => setKind(e.target.value as IntelDoc['kind'])} style={inputStyle}>
                    <option value="concall_transcript">Concall Transcript</option>
                    <option value="earnings_ppt">Earnings PPT (text-pasted)</option>
                    <option value="investor_presentation">Investor Presentation</option>
                    <option value="guidance_doc">Standalone Guidance Doc</option>
                    <option value="manual">Manual / Note</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Title (optional)">
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Q4 FY26 Concall — 14 May 2026"
                    style={inputStyle} />
                </Field>
                <Field label="Pick a text file (.txt, .md)">
                  <input ref={fileRef} type="file" accept=".txt,.md,text/plain"
                    onChange={onFile}
                    style={{ ...inputStyle, padding: '6px 8px' }} />
                </Field>
                <Field label="Paste transcript / PPT text">
                  <textarea value={text} onChange={e => setText(e.target.value)}
                    placeholder="Paste full concall transcript or PPT text here — guidance is auto-extracted on save."
                    rows={14}
                    style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }} />
                </Field>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={submit} disabled={uploading || !ticker.trim() || text.trim().length < 30}
                    style={{
                      padding: '8px 16px', borderRadius: 6, border: 'none',
                      background: uploading ? '#22D3EE60' : '#22D3EE',
                      color: '#000', fontWeight: 800, cursor: uploading ? 'wait' : 'pointer',
                      fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6,
                      opacity: (!ticker.trim() || text.trim().length < 30) ? 0.5 : 1,
                    }}>
                    <Upload size={13} /> {uploading ? 'Saving…' : 'Save to corpus'}
                  </button>
                  <span style={{ fontSize: 11, color: DIM }}>
                    {text.length.toLocaleString()} chars · {preview.length} guidance items detected
                  </span>
                </div>
                {uploadResult && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: uploadResult.startsWith('✓') ? '#10B98118' : '#EF444418',
                    color: uploadResult.startsWith('✓') ? '#10B981' : '#EF4444',
                    border: `1px solid ${uploadResult.startsWith('✓') ? '#10B98140' : '#EF444440'}`,
                  }}>
                    {uploadResult}
                  </div>
                )}
              </div>
            </div>

            {/* Live preview */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TEXT, fontWeight: 700 }}>
                ✨ Live guidance preview ({preview.length})
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                The same regex pipeline runs server-side on save. What you see here is what will be stored.
                Hover the quote to see the matched source sentence.
              </p>
              {preview.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: DIM, fontStyle: 'italic', fontSize: 12 }}>
                  Paste a transcript and watch guidance items materialise here in real time.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {preview.map((g, i) => (
                    <div key={i} title={g.quote}
                      style={{ padding: '8px 10px', borderLeft: '3px solid #22D3EE60', background: '#0A1422', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: ACCENT, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 3 }}>
                        {categoryLabel(g.category)}{g.year ? ` · ${g.year}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, marginBottom: 3 }}>{g.text}</div>
                      <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', lineHeight: 1.4 }}>“{g.quote}”</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DRILLDOWN VIEW ──────────────────────────────────────────── */}
        {tab === 'drilldown' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Search size={14} style={{ color: DIM }} />
              <input
                value={drillTicker}
                onChange={e => setDrillTicker(e.target.value.toUpperCase())}
                placeholder="Type a ticker (e.g. AEROFLEX)…"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD, color: TEXT, fontSize: 13, outline: 'none' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && drillTicker.trim()) loadCorpus(drillTicker.trim()); }}
              />
              <button onClick={() => drillTicker.trim() && loadCorpus(drillTicker.trim())}
                style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${ACCENT}`, background: `${ACCENT}20`, color: ACCENT, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Load
              </button>
              {drillTicker && (
                <button
                  onClick={async () => {
                    if (!confirm(`Reset entire corpus for ${drillTicker}? This cannot be undone.`)) return;
                    await fetch(`/api/v1/company-intel/${encodeURIComponent(drillTicker)}`, { method: 'DELETE' });
                    setDrillCorpus(null);
                    loadIndex();
                  }}
                  style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid #EF444460`, background: '#EF444415', color: '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Trash2 size={11} /> Reset
                </button>
              )}
            </div>

            {!drillCorpus || (!drillCorpus.documents?.length && !drillCorpus.guidance?.length) ? (
              <div style={{ padding: 40, textAlign: 'center', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: DIM }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>No corpus for {drillTicker || '—'} yet</p>
                <p style={{ margin: '6px 0 0', fontSize: 12 }}>Switch to ⬆ Upload to add documents for this company.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Guidance items */}
                <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TEXT, fontWeight: 700 }}>
                    📈 Guidance items ({drillCorpus.guidance.length})
                  </h3>
                  {drillCorpus.guidance.length === 0 ? (
                    <p style={{ color: DIM, fontStyle: 'italic', fontSize: 12 }}>
                      No guidance extracted yet — re-upload with the full transcript text.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {drillCorpus.guidance.map((g, i) => (
                        <div key={i} style={{ padding: '8px 10px', borderLeft: '3px solid #10B98160', background: '#0A1422', borderRadius: 4 }}>
                          <div style={{ fontSize: 10, color: '#10B981', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 3 }}>
                            {categoryLabel(g.category)}{g.year ? ` · ${g.year}` : ''}
                          </div>
                          <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, marginBottom: 3 }}>{g.text}</div>
                          <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic', lineHeight: 1.4 }}>“{g.quote}”</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Documents */}
                <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 14, color: TEXT, fontWeight: 700 }}>
                    <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Stored documents ({drillCorpus.documents.length})
                  </h3>
                  {drillCorpus.documents.length === 0 ? (
                    <p style={{ color: DIM, fontStyle: 'italic', fontSize: 12 }}>No documents yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {drillCorpus.documents.slice().reverse().map((d) => (
                        <div key={d.id} style={{ padding: '8px 10px', background: '#0A1422', borderRadius: 4, border: `1px solid ${BORDER}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: ACCENT, fontWeight: 700, letterSpacing: '0.4px' }}>
                              {d.kind.replace(/_/g, ' ').toUpperCase()}
                            </span>
                            <span style={{ fontSize: 10, color: DIM }}>
                              {new Date(d.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>{d.title}</div>
                          <div style={{ fontSize: 10, color: DIM, marginTop: 3 }}>
                            {d.size_chars.toLocaleString()} chars
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: DIM, fontWeight: 600, letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${BORDER}`,
  background: '#0A1422',
  color: TEXT,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#8BA3C1', letterSpacing: '0.5px' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
