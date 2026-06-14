import { Suspense } from 'react';
import DashboardClient from './DashboardClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Force all dashboard routes to be dynamically rendered (never pre-rendered at build time).
// This prevents "prerendering" errors when the backend API is unavailable during `next build`.
export const dynamic = 'force-dynamic';

const LoadingSpinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--mc-bg-0)' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: '40px', height: '40px', border: '3px solid var(--mc-bg-4)', borderTopColor: 'var(--mc-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
      <p style={{ color: 'var(--mc-text-4)', fontSize: '13px' }}>Loading dashboard...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ErrorBoundary context="Dashboard">
        <DashboardClient>
          <ErrorBoundary context="Page">
            {children}
          </ErrorBoundary>
        </DashboardClient>
      </ErrorBoundary>
    </Suspense>
  );
}
