'use client';
// PATCH 1101jjj — Same-origin sync via GitHub Actions cron.
//
// The architecture finally:
//   1. `.github/workflows/screener-sync.yml` runs daily on GitHub runners
//      (IPs that screener.in does NOT block, unlike Railway). It curls all
//      15 saved screens + watchlists using SCREENER_SESSIONID and commits
//      them into frontend/public/data/screener/.
//   2. Next.js serves them at /data/screener/<filename>. SAME-ORIGIN.
//   3. This page bulk-downloads them with <a download> — same-origin so the
//      download attribute works, no popup blocker, no login required.
//
// One click. Always works. The earlier client-side approaches all failed
// because they were fighting Chrome's cross-origin popup blocker; the
// server-side approach failed because Cloudflare blocked Railway. GitHub
// Actions sidesteps both.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type FileEntry = { name: string; size: number };
type Manifest = { lastSync: string; ok: number; fail: number; files: FileEntry[] };

// Static knowledge of what SHOULD be there. The manifest tells us what
// actually IS there after the latest workflow run.
const EXPECTED = [
  { slug: 'fii',                                          label: 'FII',                          type: 'screen'    },
  { slug: 'future-leaders',                               label: 'Future Leaders',               type: 'screen'    },
  { slug: 'lowequitycapital',                             label: 'Low Equity Capital',           type: 'screen'    },
  { slug: 'multibagger2-ignoring-trend',                  label: 'Multibagger 2 (Ignoring Trend)', type: 'screen'  },
  { slug: 'stocks-like-bajaj-consumer',                   label: 'Stocks Like Bajaj Consumer',   type: 'screen'    },
  { slug: 'rajeev-thakkar-ppfas-screener',                label: 'Rajeev Thakkar PPFAS',         type: 'screen'    },
  { slug: '100-baggers-sales-and-eps-growth',             label: '100-Baggers (Sales + EPS)',    type: 'screen'    },
  { slug: 'multibagger-like-acutaasatlantadee-dev',       label: 'Multibagger like Acutaas',     type: 'screen'    },
  { slug: 'pead-master-screener-rishi-framework',         label: 'PEAD Master (Rishi)',          type: 'screen'    },
  { slug: 'ipobases',                                     label: 'IPO Bases',                    type: 'screen'    },
  { slug: 'great-results-and-pullback',                   label: 'Great Results + Pullback',     type: 'screen'    },
  { slug: 'capex',                                        label: 'Capex',                        type: 'screen'    },
  { slug: 'watchlist-10432429',                           label: 'Watchlist 10432429',           type: 'watchlist' },
  { slug: 'watchlist-10432585',                           label: 'Watchlist 10432585',           type: 'watchlist' },
  { slug: 'watchlist-8105148',                            label: 'Watchlist 8105148',            type: 'watchlist' },
];

const REPO_HTTPS = 'https://github.com/radhevrishi/market-cockpit';

export default function ScreenerSyncPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // Load manifest written by the GitHub Action.
  useEffect(() => {
    fetch('/data/screener/manifest.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((m: Manifest) => setManifest(m))
      .catch((e) => setManifestError(String(e)));
  }, []);

  // Find the actual file for a slug (workflow might write .csv or .xlsx).
  const fileFor = useCallback((slug: string): FileEntry | null => {
    if (!manifest) return null;
    return manifest.files.find(f => f.name.startsWith(slug + '.')) || null;
  }, [manifest]);

  const allFiles = manifest?.files || [];

  const downloadAll = () => {
    if (allFiles.length === 0) {
      setStatus('Manifest is empty — the GitHub Action hasn\'t run yet. Trigger it: GitHub → Actions → "Sync Screener.in CSVs" → Run workflow.');
      return;
    }
    setStatus(`Downloading ${allFiles.length} file(s)…`);
    for (const f of allFiles) {
      // Same-origin URL + download attribute → browser uses download manager.
      // No popup window opens, no popup blocker, all 15 downloads start.
      const a = document.createElement('a');
      a.href = `/data/screener/${f.name}`;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setStatus(`Triggered ${allFiles.length} download(s). Check Downloads folder.`);
  };

  const downloadOne = (slug: string) => {
    const f = fileFor(slug);
    if (!f) {
      setStatus(`${slug}: not in manifest. Likely the last GitHub Action run failed for this screen.`);
      return;
    }
    const a = document.createElement('a');
    a.href = `/data/screener/${f.name}`;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const lastSyncStr = manifest ? new Date(manifest.lastSync).toLocaleString() : '—';
  const hoursOld = manifest ? Math.round((Date.now() - new Date(manifest.lastSync).getTime()) / 3_600_000) : null;
  const stale = hoursOld !== null && hoursOld > 36;

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
        <div style={{ fontSize: 12, color: 'var(--mc-text-4)', marginBottom: 18 }}>
          GitHub Actions fetches CSVs daily and commits them into the repo. Click below to download — all same-origin, always works.
        </div>

        {/* Manifest status banner */}
        {manifest && (
          <div style={{
            background: stale ? 'color-mix(in srgb, var(--mc-warn) 12%, transparent)' : 'color-mix(in srgb, var(--mc-success) 10%, transparent)',
            border: `1px solid color-mix(in srgb, ${stale ? 'var(--mc-warn)' : 'var(--mc-success)'} 40%, transparent)`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
          }}>
            <strong>Last sync:</strong> {lastSyncStr} ({hoursOld}h ago) · <strong>{manifest.ok} ok</strong>{manifest.fail > 0 && <> · <span style={{ color: 'var(--mc-warn)' }}>{manifest.fail} failed</span></>}
            {stale && (
              <div style={{ marginTop: 6, color: 'var(--mc-warn)' }}>
                Data is &gt; 36h old. Trigger a fresh run: <a target="_blank" rel="noopener noreferrer" href={`${REPO_HTTPS}/actions/workflows/screener-sync.yml`} style={{ color: 'var(--mc-warn)' }}>GitHub → Actions → Run workflow</a>
              </div>
            )}
          </div>
        )}

        {manifestError && (
          <div style={{ background: 'color-mix(in srgb, var(--mc-warn) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 40%, transparent)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
            <strong>Manifest not found</strong> ({manifestError}). The GitHub Action hasn't run yet. One-time setup:
            <ol style={{ margin: '8px 0 0 20px', padding: 0 }}>
              <li>GitHub repo → <strong>Settings → Secrets and variables → Actions</strong> → <strong>New repository secret</strong></li>
              <li>Name: <code>SCREENER_SESSIONID</code> &nbsp; Value: paste the sessionid cookie from screener.in</li>
              <li><a target="_blank" rel="noopener noreferrer" href={`${REPO_HTTPS}/actions/workflows/screener-sync.yml`} style={{ color: 'var(--mc-accent)' }}>Actions → "Sync Screener.in CSVs" → Run workflow</a> (one-time bootstrap)</li>
              <li>Wait ~30s, refresh this page.</li>
            </ol>
          </div>
        )}

        {/* THE button */}
        <button
          onClick={downloadAll}
          disabled={!manifest || allFiles.length === 0}
          style={{
            width: '100%',
            background: (!manifest || allFiles.length === 0)
              ? 'var(--mc-bg-3)'
              : 'linear-gradient(135deg, var(--mc-accent), color-mix(in srgb, var(--mc-accent) 60%, var(--mc-success)))',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '24px 32px',
            fontSize: 22,
            fontWeight: 800,
            cursor: (!manifest || allFiles.length === 0) ? 'not-allowed' : 'pointer',
            marginBottom: 14,
            boxShadow: '0 4px 16px color-mix(in srgb, var(--mc-accent) 30%, transparent)',
            letterSpacing: 0.3,
          }}
        >
          {!manifest ? 'Loading…' : allFiles.length === 0 ? 'No files yet — run the GitHub Action first' : `📥 Download all ${allFiles.length} files`}
        </button>

        {status && (
          <div style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 13 }}>
            {status}
          </div>
        )}

        {/* Individual files */}
        <div style={{ marginTop: 22, marginBottom: 8, fontSize: 14, fontWeight: 700 }}>
          Individual files
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {EXPECTED.map((s) => {
            const f = fileFor(s.slug);
            const missing = !f;
            return (
              <button
                key={s.slug}
                onClick={() => downloadOne(s.slug)}
                disabled={missing}
                style={{
                  textAlign: 'left',
                  background: missing ? 'color-mix(in srgb, var(--mc-warn) 8%, var(--mc-bg-2))' : 'var(--mc-bg-2)',
                  border: missing ? '1px solid color-mix(in srgb, var(--mc-warn) 30%, transparent)' : '1px solid var(--mc-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--mc-text-2)',
                  fontSize: 12,
                  cursor: missing ? 'not-allowed' : 'pointer',
                  opacity: missing ? 0.7 : 1,
                }}
              >
                <span style={{ color: s.type === 'watchlist' ? 'var(--mc-warn)' : 'var(--mc-accent)', fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
                  {s.type === 'watchlist' ? 'WATCHLIST' : 'SCREEN'}
                </span>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.label}</div>
                <div style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>
                  {missing
                    ? 'not synced — check workflow logs'
                    : `${f!.name} · ${(f!.size / 1024).toFixed(1)} KB`}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer info */}
        <div style={{ marginTop: 22, padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border)', borderRadius: 8, fontSize: 12, color: 'var(--mc-text-3)' }}>
          <strong>How fresh is the data?</strong> The workflow runs daily at 04:00 UTC (~09:30 IST) before market open. Force a fresh run anytime: <a target="_blank" rel="noopener noreferrer" href={`${REPO_HTTPS}/actions/workflows/screener-sync.yml`} style={{ color: 'var(--mc-accent)' }}>GitHub Actions → Sync Screener.in CSVs → Run workflow</a>.
          <br /><br />
          <strong>If a file is "not synced":</strong> the sessionid expired or screener.in returned the login page. Rotate <code>SCREENER_SESSIONID</code> in <a target="_blank" rel="noopener noreferrer" href={`${REPO_HTTPS}/settings/secrets/actions`} style={{ color: 'var(--mc-accent)' }}>GitHub Secrets</a> (use the same value you have in Railway).
        </div>
      </div>
    </div>
  );
}
