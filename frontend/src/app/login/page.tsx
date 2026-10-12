'use client';
// zzz778 — the one public page. Owner password → site cookie → back to `next`.
import { useState } from 'react';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);   // zzz964 — show / hide the password
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        const next = new URLSearchParams(window.location.search).get('next') || '/';
        window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return;
      }
      setMsg(j.error === 'not_configured' ? j.message : j.error === 'wrong_password' ? 'Wrong password.' : r.status === 429 ? `Too many attempts — wait ${Number(j.resetInSeconds) > 0 ? `${j.resetInSeconds} s` : 'a minute'}.` : 'Login failed.');
    } catch { setMsg('Network error — try again.'); }
    setBusy(false);
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1220', color: '#F1F5F9', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12, padding: 24, border: '1px solid #1F2A3D', borderRadius: 12, background: '#101A2C' }}>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.5 }}>MARKET COCKPIT</div>
        <div style={{ fontSize: 13, color: '#AEBBCB' }}>Private. Enter the owner password.</div>
        <div style={{ position: 'relative', display: 'flex' }}>
          <input type={show ? 'text' : 'password'} autoFocus autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" aria-label="Password"
            style={{ flex: 1, fontSize: 15, padding: '10px 70px 10px 12px', borderRadius: 8, border: '1px solid #2A3A55', background: '#0B1220', color: '#F1F5F9' }} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, padding: '5px 8px', borderRadius: 6, border: '1px solid #2A3A55', background: '#101A2C', color: '#AEBBCB', cursor: 'pointer' }}>
            {show ? '🙈 Hide' : '👁 Show'}
          </button>
        </div>
        <button type="submit" disabled={busy || !pw} style={{ fontSize: 15, fontWeight: 800, padding: '10px 12px', borderRadius: 8, border: 'none', background: '#22D3EE', color: '#0B1220', cursor: busy ? 'wait' : 'pointer', opacity: busy || !pw ? 0.6 : 1 }}>{busy ? 'Checking…' : 'Log in'}</button>
        {msg && <div role="alert" style={{ fontSize: 13, color: '#FBBF24' }}>{msg}</div>}
      </form>
    </div>
  );
}
