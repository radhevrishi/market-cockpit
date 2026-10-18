'use client';
import { useEffect, useState } from 'react';
import { resolveVaultConflict } from '@/lib/user-vault-client';

/** A conflict must be visible; neither device's saved copy is silently replaced. */
export default function VaultSyncNotice() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // zzz1078 (B03) — a merge that reached a list limit: what did not fit, with the recovery copy to download
  const [overflow, setOverflow] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    const onConflict = (event: Event) => setKey((event as CustomEvent<{ key: string }>).detail.key);
    const onOverflow = (event: Event) => setOverflow((event as CustomEvent<{ key: string; message: string }>).detail);
    window.addEventListener('mc:vault:conflict', onConflict);
    window.addEventListener('mc:vault:overflow', onOverflow);
    return () => { window.removeEventListener('mc:vault:conflict', onConflict); window.removeEventListener('mc:vault:overflow', onOverflow); };
  }, []);
  if (!key && overflow) {
    const dl = () => {
      const value = localStorage.getItem(`mc:vault:overflow:${overflow.key}`);
      if (!value) return;
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'market-cockpit-watchlist-recovery.json'; a.click(); URL.revokeObjectURL(url);
    };
    return <div role="alert" data-vault-overflow style={{ padding: '10px 16px', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)', borderBottom: '1px solid var(--mc-bg-4)' }}>
      Your chart watchlists were merged from two devices. {overflow.message}
      {' '}<button onClick={dl}>Download recovery copy</button>
      {' '}<button onClick={() => setOverflow(null)}>Dismiss</button>
    </div>;
  }
  if (!key) return null;
  const resolve = async (choice: 'local' | 'server') => {
    setBusy(true); setError('');
    try { await resolveVaultConflict(key, choice); setKey(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Resolution failed'); }
    finally { setBusy(false); }
  };
  const download = () => {
    const value = localStorage.getItem(`mc:vault:conflict:${key}`);
    if (!value) return;
    const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'market-cockpit-local-edit.json'; a.click(); URL.revokeObjectURL(url);
  };
  return <div role="alert" style={{ padding: '10px 16px', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)', borderBottom: '1px solid var(--mc-bg-4)' }}>
    Another device saved a newer copy. Your local edits are preserved, but have not synced.
    {' '}<button onClick={download}>Download local edits</button>
    {' '}<button disabled={busy} onClick={() => void resolve('local')}>Keep this device’s edits</button>
    {' '}<button disabled={busy} onClick={() => void resolve('server')}>Use saved server copy</button>
    {' '}<button onClick={() => setKey('')}>Dismiss</button>
    {error && <span> {error}</span>}
  </div>;
}
