// PATCH 1037 BUG-018 v2 — /signals + /orders previously double-mounted the same
// 4,834-line orders component (duplicate /api/market/intelligence and /api/v1/news
// fires on either URL). Make /signals a server redirect to /orders so the
// canonical slug renders once. Keeps bookmarks working via the redirect.
import { redirect } from 'next/navigation';
export default function SignalsPage() {
  redirect('/orders');
}
