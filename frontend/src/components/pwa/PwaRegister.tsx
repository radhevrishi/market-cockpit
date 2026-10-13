'use client';
// zzz796 — registers the service worker (production only) and offers the new
// version after a deploy: "Update available — tap to reload".
// zzz1006 — shown as a small chip in the site header's status area (beside the theme / PDF / search controls) instead of a
// toast floating over the chart or table; pages without the header get a small corner chip. Same function: Reload / Later.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { startInstallCapture, isStandalone } from './pwa-state';
import s from './pwa.module.css';
import { swUpdateDue, whenIdle } from '@/lib/shell-fetch';

/** zzz1006 — the dashboard header's status area (its chips row), or null on pages without the header. */
function headerSlot(): Element | null {
  const cls = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s.chips) : s.chips;
  return cls ? document.querySelector(`header .${cls}`) : null;
}

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
    // zzz855: each update check downloads /sw.js; check at most once an hour when the tab comes back.
    let lastCheck: number | null = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !reg) return;
      const now = Date.now();
      if (!swUpdateDue(lastCheck, now)) return;
      lastCheck = now;
      reg.update().catch(() => {});
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
    // zzz855: register after the page has loaded AND the browser is idle, so the
    // worker's install (offline page fetch) never competes with first-load requests.
    let cancelIdle = () => {};
    const afterLoad = () => { cancelIdle = whenIdle(register, 5000); };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });

    return () => {
      cancelIdle();
      window.removeEventListener('load', afterLoad);
      sw.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [version]);

  // the header's status area (the chips row of the dashboard header): looked up again shortly if the shell is still mounting
  const [, setRetry] = useState(0);
  useEffect(() => {
    if (!waiting || headerSlot()) return;
    const t = window.setTimeout(() => setRetry((n) => n + 1), 1500);
    return () => window.clearTimeout(t);
  }, [waiting]);

  if (!waiting) return null;
  const apply = () => {
    userAsked.current = true;
    try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { /* ignore */ }
    // Fallback in case controllerchange never arrives.
    setTimeout(() => { if (!reloading.current) { reloading.current = true; window.location.reload(); } }, 3000);
  };
  const slot = headerSlot();
  const chip = (
    <div className={slot ? s.updateChip : s.updateDock} role="status" aria-live="polite">
      <span className={s.updateDot} aria-hidden />
      <span className={s.updateText}>Update available</span>
      <button type="button" className={s.updateBtn} onClick={apply} title="Reload to use the new version">Reload</button>
      <button type="button" className={s.updateClose} aria-label="Later" title="Later" onClick={() => setWaiting(null)}>✕</button>
    </div>
  );
  return slot ? createPortal(chip, slot) : chip;
}
