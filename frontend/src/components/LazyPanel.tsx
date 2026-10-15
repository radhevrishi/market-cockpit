'use client';
// zzz1052 — mount a below-the-fold panel (and so start its data requests) only when it comes near the screen.
// Before: every home panel fetched on load (~48 requests) even though most sit several screens down.
// Once mounted a panel stays mounted (scrolling away never throws its data away). Without IntersectionObserver
// (very old browsers) the panel mounts at once, exactly as before.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/** True once the element has come within `rootMargin` of the viewport (sticky: never goes back to false). */
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '400px', enabled = true): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (typeof window === 'undefined') return;
    const IO = (window as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!el || typeof IO !== 'function') { setNear(true); return; }
    const io = new IO((entries) => {
      if (entries.some((e) => e.isIntersecting || e.intersectionRatio > 0)) { setNear(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, enabled, near]);
  return near;
}

export interface LazyPanelProps {
  children: ReactNode;
  /** reserved height while waiting, so the page does not jump when the panel mounts */
  minHeight?: number;
  /** how far below (or above) the screen the panel starts loading */
  rootMargin?: string;
  /** shown while waiting (default: an empty box of `minHeight`) */
  placeholder?: ReactNode;
  style?: CSSProperties;
  /** short name for the placeholder's accessible label */
  label?: string;
}

export default function LazyPanel({ children, minHeight = 120, rootMargin = '400px', placeholder, style, label }: LazyPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(ref, rootMargin);
  if (near) return <>{children}</>;
  return (
    <div ref={ref} data-lazy-panel="waiting" aria-busy="true" aria-label={label ? `${label} (loads when scrolled into view)` : undefined}
      style={{ minHeight, ...style }}>
      {placeholder ?? null}
    </div>
  );
}
