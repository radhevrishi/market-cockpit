'use client';
// zzz1052 — drop-in replacement for next/link for navigation lists (sidebar, phone menu, home chip rows, favourites,
// result-table rows). It never prefetches because the link scrolled into view (that fired ~160 server renders on the
// home page and made real clicks wait); it prefetches when the owner points at it, focuses it or presses on it.
// Everything else (href, className, style, onClick, ref …) is passed straight to next/link.
import Link from 'next/link';
import { forwardRef, useContext, useRef, type ComponentProps, type FocusEvent, type MouseEvent, type PointerEvent, type TouchEvent } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { makeIntentPrefetcher, type IntentPrefetcher } from '@/lib/intent-prefetch';

type LinkProps = ComponentProps<typeof Link>;

function hrefString(href: LinkProps['href']): string | null {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    const u = href as { pathname?: string | null; search?: string | null; query?: unknown };
    if (!u.pathname) return null;
    let q = u.search || '';
    if (!q && u.query && typeof u.query === 'object') {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(u.query as Record<string, unknown>)) if (v != null) sp.set(k, String(v));
      const s = sp.toString();
      q = s ? `?${s}` : '';
    }
    return u.pathname + q;
  }
  return null;
}

const NavLink = forwardRef<HTMLAnchorElement, LinkProps>(function NavLink(props, ref) {
  const { href, prefetch, onMouseEnter, onMouseLeave, onFocus, onPointerDown, onTouchStart, ...rest } = props;
  // Read from context (null outside the App Router, e.g. in tests) instead of useRouter(), which throws there.
  const router = useContext(AppRouterContext);
  const latest = useRef({ href, router });
  latest.current = { href, router };
  const intent = useRef<IntentPrefetcher | null>(null);
  if (!intent.current) {
    intent.current = makeIntentPrefetcher(
      () => hrefString(latest.current.href),
      (url) => { latest.current.router?.prefetch(url); },
    );
  }
  const it = intent.current;
  return (
    <Link
      ref={ref}
      href={href}
      // Viewport prefetch stays off unless a caller explicitly asks for it (prefetch / prefetch={true}).
      prefetch={prefetch === true ? true : false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => { onMouseEnter?.(e); it.hoverStart(); }}
      onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => { onMouseLeave?.(e); it.hoverEnd(); }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => { onFocus?.(e); it.now(); }}
      onPointerDown={(e: PointerEvent<HTMLAnchorElement>) => { onPointerDown?.(e); if (e.button === 0) it.now(); }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => { onTouchStart?.(e); it.now(); }}
      {...rest}
    />
  );
});

export default NavLink;
