'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

export function Providers({ children }: { children: ReactNode }) {
  // useState ensures each request gets its own QueryClient in SSR
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,      // 1 min
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
