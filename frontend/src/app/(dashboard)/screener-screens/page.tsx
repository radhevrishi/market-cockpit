'use client';
// zzz1234 — the owner's screener.in screens, now made from our own Stock Screener data. Paste a screen's screener.in query
// once and it runs on our data (Multibagger India, Fundamentals, Turnarounds, Volume Pockets read these files).
import { useEffect, useState } from 'react';

type F = { name: string; displayName: string; rows: number; source: string; note: string | null; kind: string; query: string | null };
const C = { panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)', green: 'var(--mc-bullish)', amber: '#D97706', blue: '#3B82F6' };

export default function ScreenerScreensPage() {
  const [files, setFiles] = useState<F[]>([]);
  const [built, setBuilt] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => { const j = await fetch('/api/v1/screener-data', { cache: 'no-store' }).then((r) => r.json()).catch(() => null); if (j?.files) { setFiles(j.files); setBuilt(j.lastSync); } };
  useEffect(() => { void load(); }, []);
  const save = async (slug: string, query: string | null) => {
    setMsg('Saving and running…');
    const j = await fetch('/api/v1/screener-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, query }) }).then((r) => r.json()).catch(() => null);
    if (j?.manifest?.files) { setFiles(j.manifest.files); const f = j.manifest.files.find((x: F) => x.name === `${slug}.csv`); setMsg(f ? `${f.displayName}: ${f.rows} companies · ${f.source}${f.note ? ` · ${f.note}` : ''}` : 'Saved.'); setEdit(null); }
    else setMsg('Could not save.');
  };
  return (
    <div style={{ padding: '18px 20px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: C.txt, margin: 0 }}>Screener.in screens — on our own data</h1>
      <p style={{ fontSize: 13, color: C.mute, margin: '4px 0 14px' }}>
        These files used to be downloaded from screener.in with your login every day. They are now made from the portal&apos;s own Stock Screener (same file names, same columns), so Multibagger India, Fundamentals, Turnarounds and Volume Pockets keep working without screener.in.
        A screen with no query keeps the companies from its last screener.in export, with today&apos;s figures. Paste the screen&apos;s query from screener.in (Edit screen → copy the query) to run it here. Data as of {built ? built.slice(0, 16).replace('T', ' ') : '…'}.
      </p>
      {msg && <div style={{ fontSize: 12.5, color: C.blue, marginBottom: 10 }}>{msg}</div>}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>{['Screen', 'Companies', 'Where the list comes from', ''].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.dim, fontSize: 11, borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
          <tbody>{files.map((f) => {
            const slug = f.name.replace(/\.csv$/, '');
            return (
              <tr key={f.name} style={{ borderBottom: `1px solid ${C.line}`, verticalAlign: 'top' }}>
                <td style={{ padding: '8px 10px' }}><b style={{ color: C.txt }}>{f.displayName}</b><div style={{ fontSize: 11, color: C.dim }}>{f.name}</div>
                  {edit === slug && (
                    <div style={{ marginTop: 6 }}>
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'Market Capitalization > 500 AND\nSales growth 3Years > 15 AND\nReturn on capital employed > 15'}
                        style={{ width: 'min(520px, 80vw)', fontFamily: 'monospace', fontSize: 12, padding: 8, borderRadius: 6, border: `1px solid ${C.line}`, background: 'var(--mc-bg-0)', color: C.txt }} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button onClick={() => save(slug, text)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.green}`, color: C.green, background: 'transparent', cursor: 'pointer' }}>Save and run</button>
                        <button onClick={() => setEdit(null)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.line}`, color: C.mute, background: 'transparent', cursor: 'pointer' }}>Cancel</button>
                        {f.query && <button onClick={() => save(slug, null)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.amber}`, color: C.amber, background: 'transparent', cursor: 'pointer' }}>Remove query</button>}
                      </div>
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px', fontWeight: 800, color: C.txt }}>{f.rows}</td>
                <td style={{ padding: '8px 10px', color: C.mute }}>{f.source}{f.note && <div style={{ color: C.amber, fontSize: 11.5 }}>{f.note}</div>}{f.query && edit !== slug && <pre style={{ margin: '4px 0 0', fontSize: 11, color: C.dim, whiteSpace: 'pre-wrap' }}>{f.query}</pre>}</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  {f.kind === 'screen' && edit !== slug && <button onClick={() => { setEdit(slug); setText(f.query || ''); }} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.blue}`, color: C.blue, background: 'transparent', cursor: 'pointer' }}>{f.query ? 'Edit query' : 'Paste query'}</button>}
                  <a href={`/api/v1/screener-data?file=${encodeURIComponent(f.name)}`} style={{ marginLeft: 8, fontSize: 11.5, color: C.mute }}>CSV</a>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
