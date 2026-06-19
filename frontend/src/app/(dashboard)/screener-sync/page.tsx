'use client';
// PATCH 1101ggg — Screener.in Sync: ONE CLICK download.
//
// Earlier approaches that failed for the user:
//   1. Server fetch (Railway -> screener.in)  -> Cloudflare blocks data-center IPs.
//   2. Bookmarklet (drag to bookmarks bar)   -> Awkward UX, user says "just click and it works".
//
// This patch: a real button on this page. On click, we synthesise 15 <a target="_blank"
// href="screener.in/..."> anchors and click them in rapid succession inside the SAME user
// gesture. Because these are top-level navigations the browser sends screener.in's
// session cookie automatically (the user is already logged in in another tab). screener.in
// responds with Content-Disposition: attachment so each tab triggers a download and closes
// itself. First time the user runs it the browser will ask "Allow market-cockpit to download
// multiple files?" — click Allow once and it works forever after.
//
// Requirements:
//   1. User must be logged in to screener.in in this same browser (any tab).
//   2. First click: approve "Allow multiple downloads" prompt.
// Works in Chrome, Comet, Edge, Brave, Arc — anywhere with standard popup semantics.

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

function urlFor(s: { id: string; name: string; type: string }): string {
  return s.type === 'watchlist'
    ? `https://www.screener.in/watchlist/${s.id}/?excel=1`
    : `https://www.screener.in/screens/${s.id}/${s.name}/?source=&days=365&excel=1`;
}

export default function ScreenerSyncPage() {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // PATCH 1101ggg — fires 15 anchor.click() calls inside the user-gesture
  // event handler. First click triggers the browser's "Allow multiple
  // downloads" prompt — once approved, all 15 files download.
  const syncAll = () => {
    setBusy(true);
    setStatus('Triggering 15 downloads… approve "Allow multiple downloads" if prompted.');
    let n = 0;
    for (const s of SCREENS) {
      const a = document.createElement('a');
      a.href = urlFor(s);
      a.target = '_blank';
      a.rel = 'noopener';
      // download attribute is advisory for cross-origin — screener.in's
      // Content-Disposition header decides the final name. Setting it here
      // means same-origin policies will still trigger a download flow.
      a.download = `${s.name}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      n++;
    }
    setStatus(`Triggered ${n} downloads. Check your Downloads folder. If only some downloaded, click again and approve the popup prompt.`);
    setTimeout(() => setBusy(false), 1500);
  };

  // Per-screen manual fallback in case the bulk button is blocked.
  const downloadOne = (s: { id: string; name: string; type: string }) => {
    window.open(urlFor(s), '_blank', 'noopener,noreferrer');
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
            <li>Open <a href="https://www.screener.in/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-accent)' }}>screener.in</a> in another tab and make sure you're logged in.</li>
            <li>Come back here, click the big button below.</li>
            <li>If the browser asks <em>"Allow market-cockpit-production.up.railway.app to download multiple files"</em>, click <strong>Allow</strong>. This prompt only appears once.</li>
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
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>How this works (and why no server)</summary>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 8 }}>
            Screener.in is behind Cloudflare which blocks our Railway server from fetching directly.
            So the click triggers <strong>your browser</strong> to fetch 15 screener.in URLs — your browser already has
            screener.in's session cookie from your other tab, so each download just works. We never see your sessionid.
          </div>
        </details>

        {/* Individual fallbacks */}
        <div style={{ marginTop: 24, marginBottom: 8, fontSize: 13, fontWeight: 700 }}>
          Or download one at a time ({SCREENS.length} screens + watchlists)
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
          <br />· <strong>Got the login page instead of a download:</strong> you're not logged in to screener.in. Log in in another tab, come back, click again.
          <br />· <strong>Only some files downloaded:</strong> browser blocked multi-download. Click the lock icon next to the URL → Site settings → Automatic downloads → Allow. Or click again and approve the prompt.
          <br />· <strong>404 on a file:</strong> the slug in the URL changed on screener.in. Update SCREENS in <code>screener-sync/page.tsx</code>.
        </div>
      </div>
    </div>
  );
}
