'use client';
// zzz796 — tiny shared state for the installable app: the Android/Chrome
// install prompt (it fires once, early, so it is captured globally), the
// "is this running as an installed app" check, and the iOS hint dismissal.
import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

let captureStarted = false;
/** Call once, as early as possible (PwaRegister does). */
export function startInstallCapture(): void {
  if (captureStarted || typeof window === 'undefined') return;
  captureStarted = true;
  // The tiny inline script in layout.tsx may have caught it before React ran.
  const early = (window as any).__mcBip as BeforeInstallPromptEvent | undefined;
  if (early && !deferred) { deferred = early; (window as any).__mcBip = undefined; }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // we show our own "Install app" button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null;
  emit();
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  } catch { /* old browser */ }
  return (window.navigator as any).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac with touch.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
}

/** Safari (not Chrome/Firefox/Edge on iOS, which can't add to Home Screen the same way before iOS 16.4). */
export function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = navigator.userAgent || '';
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

export interface InstallState {
  canPrompt: boolean;      // Android / desktop Chrome: our button can open the install dialog
  standalone: boolean;     // already running as the installed app
  ios: boolean;
  iosSafari: boolean;
  installed: boolean;
}

export function useInstallState(): InstallState {
  const [s, setS] = useState<InstallState>({ canPrompt: false, standalone: false, ios: false, iosSafari: false, installed: false });
  useEffect(() => {
    const read = () => setS({
      canPrompt: !!deferred,
      standalone: isStandalone(),
      ios: isIos(),
      iosSafari: isIosSafari(),
      installed,
    });
    read();
    listeners.add(read);
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(display-mode: standalone)'); mq.addEventListener?.('change', read); } catch { mq = null; }
    return () => { listeners.delete(read); try { mq?.removeEventListener?.('change', read); } catch { /* ignore */ } };
  }, []);
  return s;
}

// ── one-time hint, remembered on this phone ──────────────────────────────
export const HINT_KEY = 'mc.pwa.installHint.dismissed.v1';

export function hintDismissed(): boolean {
  try { return window.localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
}
export function dismissHint(): void {
  try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode: hint may show again */ }
}
