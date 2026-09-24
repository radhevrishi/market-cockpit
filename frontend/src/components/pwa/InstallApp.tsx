'use client';
// zzz796 — "Install app" helper.
//   · Android / Chrome: a real Install button (uses the browser's install prompt).
//   · iPhone / iPad: a one-time hint — "Tap Share → Add to Home Screen" —
//     dismissible, remembered on this phone.
//   · InstallAppCard: the same help, always available (Settings + Menu).
import { useEffect, useState } from 'react';
import { Download, Share, Smartphone } from 'lucide-react';
import { useInstallState, promptInstall, hintDismissed, dismissHint } from './pwa-state';
import s from './pwa.module.css';

export function InstallBanner() {
  const st = useInstallState();
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(true);

  useEffect(() => {
    setGone(hintDismissed());
    const t = setTimeout(() => setReady(true), 3000); // don't greet with a popup
    return () => clearTimeout(t);
  }, []);

  if (!ready || gone || st.standalone || st.installed) return null;
  if (!st.canPrompt && !st.ios) return null;

  const close = () => { dismissHint(); setGone(true); };
  return (
    <div className={s.banner} role="dialog" aria-label="Install Market Cockpit">
      <img src="/icon-192.png" alt="" className={s.bannerIcon} />
      <div className={s.bannerText}>
        <strong>Get the Market Cockpit app</strong>
        {st.canPrompt
          ? <span>Opens full-screen from your home screen.</span>
          : <span>Tap <Share size={13} style={{ verticalAlign: '-2px' }} aria-label="Share" /> Share, then <b>Add to Home Screen</b>.</span>}
      </div>
      {st.canPrompt && (
        <button type="button" className={s.toastBtn} onClick={async () => { const r = await promptInstall(); if (r === 'accepted') close(); }}>
          Install
        </button>
      )}
      <button type="button" className={s.toastClose} aria-label="Not now" onClick={close}>✕</button>
    </div>
  );
}

export function InstallAppCard({ compact = false }: { compact?: boolean }) {
  const st = useInstallState();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className={s.card} style={compact ? { margin: 0 } : undefined} aria-label="Install app">
      <h2 className={s.cardTitle}><Smartphone size={18} aria-hidden /> Market Cockpit on your phone</h2>
      {st.standalone ? (
        <div className={s.ok}>✓ You&rsquo;re using the installed app.</div>
      ) : st.canPrompt ? (
        <>
          <div className={s.muted}>Install it once and open it from your home screen like any other app.</div>
          <button type="button" className={s.toastBtn} style={{ marginTop: 10 }}
            onClick={async () => {
              const r = await promptInstall();
              setMsg(r === 'accepted' ? 'Installed — look for “Cockpit” on your home screen.' : r === 'dismissed' ? 'No problem — you can install it later from here.' : null);
            }}>
            <Download size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} aria-hidden />Install app
          </button>
          {msg && <div className={s.muted} style={{ marginTop: 8 }}>{msg}</div>}
        </>
      ) : st.ios ? (
        <ol className={s.cardSteps}>
          <li>Open this site in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button (square with an arrow).</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open <b>Cockpit</b> from your home screen and log in once.</li>
        </ol>
      ) : (
        <ol className={s.cardSteps}>
          <li>Open this site in <b>Chrome</b>.</li>
          <li>Tap the <b>⋮</b> menu (top right).</li>
          <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li>
          <li>Open <b>Cockpit</b> from your home screen. Press and hold the icon for quick links to your main pages.</li>
        </ol>
      )}
    </section>
  );
}
