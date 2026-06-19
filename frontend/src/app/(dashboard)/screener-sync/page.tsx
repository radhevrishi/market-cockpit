'use client';
// PATCH 1101eee — Screener.in Sync via browser bookmarklet.
// Cloudflare blocks Railway server-side fetches to screener.in. The reliable
// workaround is a bookmarklet: a small JS snippet pinned in the browser's
// bookmarks bar. The user clicks it WHILE on screener.in (logged in) and the
// browser triggers all 15 downloads using their existing session cookie + home
// IP — which Cloudflare allows.

import Link from 'next/link';
import { useMemo, useState } from 'react';

const SCREENS = [
  { id: '3443614', name: 'fii', type: 'screen' },
  { id: '3470949', name: 'future-leaders', type: 'screen' },
  { id: '3479774', name: 'lowequitycapital', type: 'screen' },
  { id: '3545352', name: 'multibagger2-ignoring-trend', type: 'screen' },
  { id: '3549314', name: 'stocks-like-bajaj-consumer', type: 'screen' },
  { id: '3565418', name: 'rajeev-thakkar-ppfas-screener', type: 'screen' },
  { id: '3586238', name: '100-baggers-sales-and-eps-growth', type: 'screen' },
  { id: '3601571', name: 'multibagger-like-acutaasatlantadee-dev', type: 'screen' },
  { id: '3612486', name: 'pead-master-screener-rishi-framework', type: 'screen' },
  { id: '3615320', name: 'ipobases', type: 'screen' },
  { id: '3658091', name: 'great-results-and-pullback', type: 'screen' },
  { id: '3717728', name: 'capex', type: 'screen' },
  { id: '10432429', name: 'watchlist-10432429', type: 'watchlist' },
  { id: '10432585', name: 'watchlist-10432585', type: 'watchlist' },
  { id: '8105148',  name: 'watchlist-8105148',  type: 'watchlist' },
] as const;

export default function ScreenerSyncPage() {
  const [copied, setCopied] = useState(false);

  // The bookmarklet code. Defined as a single-line javascript: URL.
  // When user clicks the bookmark while on screener.in (any page), this fires.
  const bookmarkletCode = useMemo(() => {
    const screens = SCREENS.map(s => ({ id: s.id, name: s.name, type: s.type }));
    const src = `(async()=>{const S=${JSON.stringify(screens)};const today=new Date().toISOString().slice(0,10);for(let i=0;i<S.length;i++){const s=S[i];const url=s.type==='watchlist'?'https://www.screener.in/watchlist/'+s.id+'/?excel=1':'https://www.screener.in/screens/'+s.id+'/?source=&days=365&excel=1';const a=document.createElement('a');a.href=url;a.download=s.name+'-'+today+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);await new Promise(r=>setTimeout(r,1800));}alert('Done! '+S.length+' files downloaded. Check Downloads folder.');})();`;
    return 'javascript:' + encodeURIComponent(src);
  }, []);

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      window.prompt('Copy this bookmarklet code:', bookmarkletCode);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--mc-bg-1)',
      color: 'var(--mc-text-1)',
      padding: '24px 32px',
      fontSize: 14,
      lineHeight: 1.6,
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <Link href="/" style={{ color: 'var(--mc-text-4)', fontSize: 12, textDecoration: 'none' }}>← Home</Link>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 16, marginBottom: 4 }}>
          📥 Screener.in Sync — Browser Bookmarklet
        </h1>
        <div style={{ fontSize: 12, color: 'var(--mc-text-4)', marginBottom: 24 }}>
          One-time 30-second setup. After that, clicking the bookmark while on screener.in downloads all {SCREENS.length} files.
        </div>

        {/* Why */}
        <div style={{ background: 'color-mix(in srgb, var(--mc-warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 35%, transparent)', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: 'var(--mc-warn)', marginBottom: 4 }}>⚠ Why a bookmarklet?</div>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>
            Screener.in is behind Cloudflare, which blocks our server (Railway) from fetching directly — that's why the previous "Sync" button errored with <em>"fetch failed at network layer"</em>.
            <br/><br/>
            The bookmarklet runs in <strong>your browser</strong>, which is already logged into screener.in. Cloudflare allows your IP. Each fetch uses your existing session cookie. Files download to your Downloads folder. Zero server involvement.
          </div>
        </div>

        {/* Step 1 */}
        <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Step 1 — Add the bookmark (one time only)</div>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginBottom: 10 }}>
            Your bookmarks bar must be visible. If not: <code style={{ background: 'var(--mc-bg-3)', padding: '1px 5px', borderRadius: 3 }}>Cmd+Shift+B</code> (Mac) / <code style={{ background: 'var(--mc-bg-3)', padding: '1px 5px', borderRadius: 3 }}>Ctrl+Shift+B</code> (Windows).
            <br/>
            Then <strong>drag this purple button up to your bookmarks bar</strong>:
          </div>
          {/* The actual draggable bookmarklet link */}
          <a
            href={bookmarkletCode}
            onClick={(e) => { e.preventDefault(); alert('Don\'t click — drag this to your bookmarks bar.'); }}
            style={{
              display: 'inline-block',
              background: '#8B5CF6',
              color: '#fff',
              padding: '8px 18px',
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 14,
              textDecoration: 'none',
              cursor: 'grab',
              border: '2px solid #6d28d9',
              boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)',
              userSelect: 'none',
            }}
            draggable
            title="Drag this to your bookmarks bar — do not click"
          >
            📥 Sync Screener.in
          </a>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginTop: 10 }}>
            Can't drag? <button
              onClick={copyBookmarklet}
              style={{ background: 'transparent', color: 'var(--mc-cyan)', border: '1px solid var(--mc-cyan)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
            >{copied ? '✅ Copied!' : '📋 Copy code'}</button> — then right-click bookmarks bar → Add new bookmark → paste into URL field.
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Step 2 — Use it</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--mc-text-3)', fontSize: 12 }}>
            <li style={{ marginBottom: 4 }}>Open <a href="https://www.screener.in/" target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)' }}>screener.in</a> in a new tab (make sure you're <strong>logged in</strong>)</li>
            <li style={{ marginBottom: 4 }}>Click the <strong>📥 Sync Screener.in</strong> bookmark in your bookmarks bar</li>
            <li style={{ marginBottom: 4 }}>Chrome will prompt: <em>"This site wants to download multiple files"</em> — click <strong>Allow</strong> (one-time per origin)</li>
            <li style={{ marginBottom: 4 }}>Wait ~30 seconds — files download one at a time with 1.8s spacing</li>
            <li>Each file lands in your <strong>Downloads folder</strong> as <code style={{ background: 'var(--mc-bg-3)', padding: '0 4px', borderRadius: 2, fontSize: 11 }}>fii-2026-06-19.csv</code> etc.</li>
          </ol>
        </div>

        {/* Screens list */}
        <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Files that will be downloaded ({SCREENS.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 4 }}>
            {SCREENS.map((s, i) => (
              <div key={s.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                fontSize: 11,
                borderBottom: '1px solid var(--mc-bg-3)',
              }}>
                <span style={{ color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 24 }}>{i + 1}.</span>
                <span style={{
                  fontSize: 9,
                  padding: '0 4px',
                  borderRadius: 2,
                  background: s.type === 'watchlist' ? 'color-mix(in srgb, var(--mc-cyan) 20%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 20%, transparent)',
                  color: s.type === 'watchlist' ? 'var(--mc-cyan)' : 'var(--mc-bullish)',
                  fontWeight: 700,
                }}>{s.type === 'watchlist' ? 'WL' : 'SCR'}</span>
                <span style={{ color: 'var(--mc-text-2)' }}>{s.name}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--mc-text-4)', fontFamily: 'monospace', fontSize: 10 }}>{s.id}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: 'var(--mc-text-4)' }}>
          Want to change the screen list? Edit <code style={{ background: 'var(--mc-bg-3)', padding: '0 4px', borderRadius: 2 }}>frontend/src/app/(dashboard)/screener-sync/page.tsx</code> — the bookmarklet auto-regenerates.
        </div>
      </div>
    </div>
  );
}
