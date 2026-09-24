'use client';
// zzz796 — registers the service worker (production only) and offers the new
// version after a deploy: "Update available — tap to reload".
import { useEffect, useRef, useState } from 'react';
import { startInstallCapture, isStandalone } from './pwa-state';
import s from './pwa.module.css';

export default function PwaRegister({ version }: { version: string }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);
  const userAsked = useRef(false);

  useEffect(() => {
    startInstallCapture();
    // Mark the page when it runs as the installed app (used for spacing).
    const mark = () => {
      try { document.documentElement.setAttribute('data-pwa', isStandalone() ? 'standalone' : 'browser'); } catch { /* ignore */ }
    };
    mark();

    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const sw = navigator.serviceWorker;
    const onControllerChange = () => {
      // Only reload when the owner tapped "reload" — never on the very first
      // install, and never twice.
      if (!userAsked.current || reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    sw.addEventListener('controllerchange', onControllerChange);

    let reg: ServiceWorkerRegistration | null = null;
    const offer = (w: ServiceWorker | null) => {
      if (w && sw.controller) setWaiting(w);   // an update, not a first install
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    };

    const register = () => {
      sw.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: '/', updateViaCache: 'none' })
        .then((r) => {
          reg = r;
          offer(r.waiting);
          r.addEventListener('updatefound', () => {
            const nw = r.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed') offer(r.waiting || nw);
            });
          });
          document.addEventListener('visibilitychange', onVisible);
        })
        .catch(() => { /* no service worker: the site still works normally */ });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      sw.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('load', register);
    };
  }, [version]);

  if (!waiting) return null;
  const apply = () => {
    userAsked.current = true;
    try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { /* ignore */ }
    // Fallback in case controllerchange never arrives.
    setTimeout(() => { if (!reloading.current) { reloading.current = true; window.location.reload(); } }, 3000);
  };
  return (
    <div className={s.toast} role="status" aria-live="polite">
      <span>Update available</span>
      <button type="button" className={s.toastBtn} onClick={apply}>Tap to reload</button>
      <button type="button" className={s.toastClose} aria-label="Later" onClick={() => setWaiting(null)}>✕</button>
    </div>
  );
}
