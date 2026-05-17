// PATCH 0445 BUG-018 — Reverse the canonical direction. /signals now renders
// the actual page (was previously redirecting to /orders); /orders becomes
// the redirect target. The page semantically does corporate signal
// intelligence, not order management, so /signals is the correct slug.
// Both URLs continue to render the same content for bookmark compatibility.
'use client';
import OrdersPage from '../orders/page';

export default function SignalsPage() {
  return <OrdersPage />;
}
