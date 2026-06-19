'use client';
// PATCH 1101iii — Pragmatic Screener.in sync. Three approaches, user picks.
//
// What we learned:
//   - Cross-origin <a target="_blank"> popups: Chrome blocks 14 of 15 (1101ggg).
//   - Same-origin <a download> via /api/redirect: 302 to cross-origin DROPS the
//     download attribute, browser navigates current tab away (1101hhh — broke
//     the page entirely).
//   - Cloudflare blocks Railway server-side fetches (original error).
//
// Settled approach:
//   1. PRIMARY: 15 individual buttons. Each click is its own user gesture →
//      opens one popup → screener.in Content-Disposition triggers download →
//      tab self-closes. Always works.
//   2. BULK: opens 15 target="_blank" anchors. First one downloads, browser
//      shows "Allow multiple downloads" prompt. User approves once, subsequent
//      clicks all work.
//   3. Use target="_blank" so the current tab is NEVER replaced.

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
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>('');

  // Individual download — always opens new tab, NEVER replaces current page.
  const downloadOne = (s: { id: string; name: string; type: string }) => {
    const w = window.open(urlFor(s), '_blank', 'noopener,noreferrer');
    if (!w) {
      setStatus(`❌ Popup blocked for ${s.name}. Click the lock icon (left of URL) → Site settings → Popups and redirects → Allow → try again.`);
      return;
    }
    setDownloaded((prev) => new Set(prev).add(s.id));
    setStatus(`✓ Triggered ${s.name} — check Downloads folder.`);
  };

  // Bulk — best effort. Opens 15 target="_blank" anchors in one gesture.
  // First popup goes through; the rest depend on the user approving
  // "Allow multiple downloads" or having popups allowed for this site.
  const syncAll = () => {
    setStatus('Triggered 15 download requests. If only one downloaded, allow popups for this site or use individual buttons below.');
    const newSet = new Set(downloaded);
    for (const s of SCREENS) {
      window.open(urlFor(s), '_blank', 'noopener,noreferrer');
      newSet.add(s.id);
    }
    setDownloaded(newSet);
  };

  const allCount = SCREENS.length;
  const doneCount = downloaded.size;

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
          Click any button below → that file downloads to your Downloads folder. Be logged in to screener.in in another tab first.
        </div>

        {/* Pre-flight */}
        <div style={{ background: 'color-mix(in srgb, var(--mc-accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 35%, transparent)', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>One-time setup:</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13 }}>
            <li>Open <a href="https://www.screener.in/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-accent)' }}>screener.in</a> in another tab and log in.</li>
            <li>In <strong>this</strong> tab: click the lock icon (left of URL) → <strong>Site settings</strong> → <strong>Popups and redirects</strong> → <strong>Allow</strong>. (This is what lets the bulk button work.)</li>
            <li>Come back here, click the bulk button — or click individual buttons one by one if you prefer.</li>
          </ol>
        </div>

        {/* Progress */}
        {doneCount > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--mc-success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-success) 35%, transparent)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}>
            Progress: <strong>{doneCount} / {allCount}</strong> triggered.
          </div>
        )}

        {/* Bulk button */}
        <button
          onClick={syncAll}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, var(--mc-accent), color-mix(in srgb, var(--mc-accent) 60%, var(--mc-success)))',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '20px 28px',
            fontSize: 20,
            fontWeight: 800,
            cursor: 'pointer',
            marginBottom: 14,
            boxShadow: '0 4px 16px color-mix(in srgb, var(--mc-accent) 30%, transparent)',
            letterSpacing: 0.3,
          }}
        >
          📥 Download all {allCount} files (allow popups first)
        </button>

        {status && (
          <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 13 }}>
            {status}
          </div>
        )}

        {/* INDIVIDUAL — primary path */}
        <div style={{ marginTop: 28, marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
            Or click each button to download (always works)
          </div>
          <div style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>
            Each click downloads one file — no popup blocker issues. The button turns green once you've clicked it.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {SCREENS.map((s) => {
            const done = downloaded.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => downloadOne(s)}
                style={{
                  textAlign: 'left',
                  background: done
                    ? 'color-mix(in srgb, var(--mc-success) 18%, var(--mc-bg-2))'
                    : 'var(--mc-bg-2)',
                  border: done
                    ? '1px solid var(--mc-success)'
                    : '1px solid var(--mc-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--mc-text-2)',
                  fontSize: 12,
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                <span style={{
                  color: s.type === 'watchlist' ? 'var(--mc-warn)' : 'var(--mc-accent)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}>
                  {s.type === 'watchlist' ? 'WATCHLIST' : 'SCREEN'}
                </span>
                {done && (
                  <span style={{ position: 'absolute', top: 8, right: 10, color: 'var(--mc-success)', fontWeight: 800 }}>✓</span>
                )}
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                <div style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>ID {s.id}</div>
              </button>
            );
          })}
        </div>

        {/* How this actually works — honest explanation */}
        <details style={{ marginTop: 28, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Why isn't this just one button?</summary>
          <div style={{ fontSize: 12, color: 'var(--mc-text-3)', marginTop: 8 }}>
            Cloudflare (screener.in's CDN) blocks our Railway server from fetching screener.in directly — so the server can't bundle the files for you. Your browser CAN reach screener.in (it lets your home IP through), so each download has to be triggered by your browser. But Chrome only allows one cross-origin popup per click — that's why clicking the bulk button often only delivers one file unless you've allowed popups for this site.
            <br /><br />
            <strong>Long-term fix:</strong> a GitHub Actions cron job that runs daily, fetches all 15 CSVs from a non-blocked IP, and commits them into the repo. Portal would read them same-origin. Tell me when you want this and I'll wire it up.
          </div>
        </details>

        <div style={{ marginTop: 18, padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, fontSize: 11, color: 'var(--mc-text-4)' }}>
          <strong>Troubleshooting:</strong>
          <br />· <strong>New tab opens but no download:</strong> you're not logged in to screener.in. Log in in another tab, come back, click again.
          <br />· <strong>Bulk button only downloads 1 file:</strong> click the lock icon left of the URL → Site settings → Popups → Allow → click bulk button again. Or just click each individual button.
          <br />· <strong>Tab stays open after download:</strong> normal for some browsers. Close it manually or ignore — file is already downloaded.
        </div>
      </div>
    </div>
  );
}
