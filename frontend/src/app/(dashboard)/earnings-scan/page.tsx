// PATCH 0435 BUG-023 — Sidebar "Earnings Scan" link routed to /earnings-scan
// which 404'd. Real page lives at /earnings-hub?tab=scan. Server-side redirect
// preserves the click without breaking history/bookmarks.
import { redirect } from 'next/navigation';

export default function EarningsScanRedirect() {
  redirect('/earnings-hub?tab=scan');
}
