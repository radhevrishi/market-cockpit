'use client';
// PATCH 1101hhh — Same-origin redirect proxy avoids Chrome's popup blocker.
//
// 1101ggg attempted to open 15 cross-origin target="_blank" anchors in one
// gesture. Chrome blocked 14 of them as popups (only the first survives for
// cross-origin URLs).
//
// 1101hhh routes anchors through /api/screener/redirect?url=<...> which is
// SAME-ORIGIN. With <a download="..."> on a same-origin URL, the browser uses
// its download manager instead of opening a new window → no popup blocker.
// The server responds 302 to screener.in; the browser follows the redirect
// as part of the download fetch and lands the CSV in the Downloads folder.
//
// Requirements:
//   1. User must be logged in to screener.in in this same browser (any tab).
//   2. Browser may show "Allow multiple downloads" on first run — approve once.

import Link from 'next/link';
import { useState } from 'react';

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

function realUrl(s: { id: string; name: string; type: string }): string {
  return s.type === 'watchlist'
    ? `https://www.screener.in/watchlist/${s.id}/?excel=1`
    : `https://www.screener.in/screens/${s.id}/${s.name}/?source=&days=365&excel=1`;
}

// PATCH 1101hhh — wrap in same-origin redirect proxy so anchors don't trip
// Chrome's cross-origin popup blocker.
function proxiedUrl(s: { id: string; name: string; type: string }): string {
  return `/api/screener/redirect?url=${encodeURIComponent(realUrl(s))}`;
}

export default function ScreenerSyncPage() {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const syncAll = () => {
    setBusy(true);
    setStatus(`Starting ${SCREENS.length} downloads…`);
    let n = 0;
    for (const s of SCREENS) {
      // Same-origin anchor with download attribute. Browser uses the download
      // manager — no popup, no new tab. Server 302's to screener.in; browser
      // follows the redirect as part of the download fetch and lands the file
      // in the Downloads folder.
      const a = document.createElement('a');
      a.href = proxiedUrl(s);
      a.download = `${s.name}.csv`;
      // No target="_blank" — same-origin + download attribute uses download
      // manager directly.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      n++;
    }
    setStatus(`Triggered ${n} downloads. If the browser prompted "Allow multiple downloads", click Allow. Check your Downloads folder.`);
    setTimeout(() => setBusy(false), 1500);
  };

  // Fallback: individual buttons. Each is its own user gesture so works
  // even when the bulk approach is restricted.
  const downloadOne = (s: { id: string; name: string; type: string }) => {
    const a = document.createElement('a');
    a.href = proxiedUrl(s);
    a.download = `${s.name}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
          📥 Screener.in Sync
        </h1>
        <div style={{ fontSize: 12, color: 'var(--mc-text-4)', marginBottom: 24 }}>
          One click → all {SCREENS.length} files download to your Downloads folder.
        </div>

        {/* Pre-flight */}
        <div style={{ background: 'color-mix(in srgb, var(--mc-accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 35%, transparent)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Before clicking:</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13 }}>
            <li>Open <a href="https://www.screener.in/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-accent)' }}>screener.in</a> in another tab and confirm you're logged in.</li>
            <li>Come back here, click the big button below.</li>
            <li>If your browser asks <em>"Allow market-cockpit-production.up.railway.app to download multiple files?"</em>, click <strong>Allow</strong>. One-time only.</li>
          </ol>
        </div>

        {/* THE BUTTON */}
        <button
          onClick={syncAll}
          disabled={busy}
          style={{
            width: '100%',
            background: busy ? 'var(--mc-bg-3)' : 'linear-gradient(135deg, var(--mc-accent), color-mix(in srgb, var(--mc-accent) 60%, var(--mc-success)))',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '24px 32px',
            fontSize: 22,
            fontWeight: 800,
            cursor: busy ? 'not-allowed' : 'pointer',
            marginBottom: 14,
            boxShadow: '0 4px 16px color-mix(in srgb, var(--mc-accent) 30%, transparent)',
            letterSpacing: 0.3,
          }}
        >
          {busy ? 'Downloading…' : `📥 Download all ${SCREENS.length} files`}
        </button>

        {status && (
          <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 13 }}>
            {status}
          </div>
        )}

        {/* How it works */}
        <details style={{ marginBottom: 20, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>How this works</summary>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 8 }}>
            Earlier attempts opened 15 cross-origin tabs which Chrome's popup blocker stopped after the first.
            Now each anchor points to <code>/api/screener/redirect</code> (same origin) which 302-redirects to screener.in.
            Browser treats this as a download (not a popup) and follows the redirect — your screener.in session cookie
            is sent automatically because it's a top-level navigation continuation. Files arrive in your Downloads folder.
          </div>
        </details>

        {/* Individual fallbacks */}
        <div style={{ marginTop: 24, marginBottom: 8, fontSize: 13, fontWeight: 700 }}>
          Or download one at a time
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {SCREENS.map((s) => (
            <button
              key={s.id}
              onClick={() => downloadOne(s)}
              style={{
                textAlign: 'left',
                background: 'var(--mc-bg-2)',
                border: '1px solid var(--mc-border)',
                borderRadius: 6,
                padding: '8px 10px',
                color: 'var(--mc-text-2)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <span style={{ color: s.type === 'watchlist' ? 'var(--mc-warn)' : 'var(--mc-accent)', fontSize: 10, fontWeight: 700 }}>
                {s.type === 'watchlist' ? 'WATCHLIST' : 'SCREEN'}
              </span>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>ID {s.id}</div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24, padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, fontSize: 11, color: 'var(--mc-text-4)' }}>
          <strong>Troubleshooting:</strong>
          <br />· <strong>Downloaded file is HTML / login page:</strong> you're not logged in to screener.in. Log in in another tab, come back, click again.
          <br />· <strong>Only some files downloaded:</strong> approve "Allow multiple downloads". Click the icon left of the URL → Site settings → Automatic downloads → Allow → click big button again.
          <br />· <strong>404 on a file:</strong> the slug in the URL changed. Update SCREENS in <code>screener-sync/page.tsx</code>.
        </div>
      </div>
    </div>
  );
}
