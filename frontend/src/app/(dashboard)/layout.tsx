import { Suspense } from 'react';
import DashboardClient from './DashboardClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Force all dashboard routes to be dynamically rendered (never pre-rendered at build time).
// This prevents "prerendering" errors when the backend API is unavailable during `next build`.
export const dynamic = 'force-dynamic';

const LoadingSpinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0A0E1A' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTopColor: '#0F7ABF', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
      <p style={{ color: '#4A5B6C', fontSize: '13px' }}>Loading dashboard...</p>
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
