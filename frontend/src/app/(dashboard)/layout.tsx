import { Suspense } from 'react';
import DashboardClient from './DashboardClient';

// Force all dashboard routes to be dynamically rendered (never pre-rendered at build time).
// This prevents "prerendering" errors when the backend API is unavailable during `next build`.
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <DashboardClient>{children}</DashboardClient>
    </Suspense>
  );
}
