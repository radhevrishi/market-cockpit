'use client';
import { useEffect, useState } from 'react';
import { resolveVaultConflict } from '@/lib/user-vault-client';
import { pendingOverflows, dismissOverflow, deleteOverflow, OVERFLOW_PREFIX, type OverflowNotice } from '@/lib/vault-overflow';

/** A conflict must be visible; neither device's saved copy is silently replaced. */
export default function VaultSyncNotice() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // zzz1078 (B03) — a merge that reached a list limit: what did not fit, with the recovery copy to download
  // zzz1093 (R2) — every unresolved recovery record in this browser, read on mount (survives reload / another page)
  const [overflows, setOverflows] = useState<(OverflowNotice & { kept?: boolean })[]>([]);
  const reread = () => { try { setOverflows(pendingOverflows(localStorage)); } catch { setOverflows([]); } };
  useEffect(() => {
    reread();
    const onConflict = (event: Event) => setKey((event as CustomEvent<{ key: string }>).detail.key);
    const onOverflow = (event: Event) => {
      const d = (event as CustomEvent<{ key: string; message: string; kept?: boolean }>).detail;
      let list: (OverflowNotice & { kept?: boolean })[] = [];
      try { list = pendingOverflows(localStorage); } catch { /* blocked */ }
      if (!list.some((o) => o.key === d.key)) list = [{ key: d.key, message: d.message, at: null, kept: d.kept }, ...list];
      else list = list.map((o) => (o.key === d.key ? { ...o, kept: d.kept } : o));
      setOverflows(list);
    };
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith(OVERFLOW_PREFIX)) reread(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:vault:conflict', onConflict);
    window.addEventListener('mc:vault:overflow', onOverflow);
    return () => { window.removeEventListener('mc:vault:conflict', onConflict); window.removeEventListener('mc:vault:overflow', onOverflow); window.removeEventListener('storage', onStorage); };
  }, []);
  if (!key && overflows.length) {
    const dl = (k: string) => {
      const value = localStorage.getItem(`${OVERFLOW_PREFIX}${k}`);
      if (!value) return;
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `market-cockpit-${k.replace(/[^a-z0-9-]+/gi, '-')}-recovery.json`; a.click(); URL.revokeObjectURL(url);
    };
    return <div role="alert" data-vault-overflow style={{ padding: '10px 16px', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)', borderBottom: '1px solid var(--mc-bg-4)', display: 'grid', gap: 6 }}>
      {overflows.map((o) => (
        <div key={o.key}>
          Your chart watchlists were merged from two devices{o.at ? ` (${new Date(o.at).toLocaleString()})` : ''}. {o.message}
          {o.kept === false
            ? <span style={{ color: 'var(--mc-bearish, #DC2626)' }}> The recovery copy could not be saved in this browser (storage full).</span>
            : <>{' '}<button onClick={() => dl(o.key)}>Download recovery copy</button></>}
          {' '}<button title="Hide this notice; the recovery copy stays in this browser" onClick={() => { dismissOverflow(localStorage, o.key); reread(); }}>Dismiss</button>
          {' '}<button title="Delete the recovery copy from this browser" onClick={() => { if (window.confirm('Delete the recovery copy? Download it first if you may need it.')) { deleteOverflow(localStorage, o.key); reread(); } }}>Delete copy</button>
        </div>
      ))}
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
