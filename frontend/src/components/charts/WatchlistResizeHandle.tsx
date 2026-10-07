'use client';
import { useEffect, useRef, useState } from 'react';

export const clampWatchlistWidth = (n: number) => Math.max(280, Math.min(620, Math.round(n)));

export default function WatchlistResizeHandle({ width, onChange }: { width: number; onChange: (width: number, persist: boolean) => void }) {
  const element = useRef<HTMLDivElement | null>(null);
  const [maximum, setMaximum] = useState(620);
  useEffect(() => {
    const parent = element.current?.parentElement;
    const measure = () => { const available = parent?.getBoundingClientRect().width || 0; if (available > 0) setMaximum(Math.max(280, Math.min(620, Math.floor(available * 0.55)))); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (parent) observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const visibleWidth = Math.min(width, maximum);
  const clamp = (n: number) => Math.min(maximum, clampWatchlistWidth(n));
  const drag = useRef<{ x: number; width: number } | null>(null);
  const current = useRef(width);
  current.current = visibleWidth;
  const finish = () => { if (drag.current) onChange(current.current, true); drag.current = null; };
  return <div ref={element} className="mc-watchlist-resize" role="separator" aria-label="Watchlist width" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={maximum} aria-valuenow={visibleWidth} tabIndex={0}
    onPointerDown={(e) => { if (e.button !== 0) return; drag.current = { x: e.clientX, width: visibleWidth }; e.currentTarget.setPointerCapture?.(e.pointerId); }}
    onPointerMove={(e) => { const start = drag.current; if (start) { const next = clamp(start.width + start.x - e.clientX); current.current = next; onChange(next, false); } }}
    onPointerUp={finish} onLostPointerCapture={finish}
    onPointerCancel={() => { const start = drag.current; drag.current = null; if (start) onChange(start.width, false); }}
    onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onChange(clamp(visibleWidth + (e.key === 'ArrowLeft' ? 20 : -20)), true); } }}
    onDoubleClick={() => onChange(400, true)} />;
}
