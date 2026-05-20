'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { ThemeProvider } from '@/contexts/ThemeContext';

export function Providers({ children }: { children: ReactNode }) {
  // useState ensures each request gets its own QueryClient in SSR
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,      // 1 min
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  // PATCH 0543 — Render outage hardening. lib/api.ts retries 5xx/network
  // errors and dispatches 'mc:backend-recovering' on the first retry.
  // Subscribe once globally so any axios call surfaces a soft toast.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastShown = 0;
    const onRecover = () => {
      const now = Date.now();
      if (now - lastShown < 4000) return; // de-dupe within 4s
      lastShown = now;
      toast('Backend recovering — retrying...', {
        icon: '↺',
        duration: 2200,
        style: {
          background: '#1E2D45',
          color: '#F5F7FA',
          border: '1px solid #F59E0B',
          borderRadius: '12px',
          fontSize: '13px',
        },
      });
    };
    window.addEventListener('mc:backend-recovering', onRecover);
    return () => window.removeEventListener('mc:backend-recovering', onRecover);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#111B35',
            color: '#F5F7FA',
            border: '1px solid #1E2D45',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { duration: 3000, iconTheme: { primary: '#10B981', secondary: '#111B35' } },
          error:   { duration: 5000, iconTheme: { primary: '#EF4444', secondary: '#111B35' } },
        }}
      />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
