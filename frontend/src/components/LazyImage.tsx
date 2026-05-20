'use client';

// AUDIT_100 #100 (UX) — IntersectionObserver-based lazy-load for below-fold
// images (super-investors photos, news article thumbnails). Native browser
// API, no library. Falls back to native loading="lazy" when IO unavailable.
//
// Usage:
//   <LazyImage src="…" alt="…" style={{…}} />

import React, { useEffect, useRef, useState } from 'react';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  placeholder?: string;
  rootMargin?: string;
};

export default function LazyImage({ src, placeholder, rootMargin = '200px', style, alt = '', ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
          break;
        }
      }
    }, { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  return (
    <img
      ref={ref}
      src={visible ? src : (placeholder || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=')}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={style}
      {...rest}
    />
  );
}
