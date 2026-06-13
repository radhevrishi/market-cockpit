import type { Metadata } from 'next';
import { Providers } from '@/app/providers';
import '@/app/globals.css';
import '@/styles/design-system.css';
import { ToastProvider, CommandPalette } from '@/components/design-system';

export const metadata: Metadata = {
  title: 'Market Cockpit — Bloomberg-lite for India + US Markets',
  description: 'Real-time financial dashboard for active equity investors',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0A0E1A" />
        {/* PWA / iOS Home Screen */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Market Cockpit" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="font-sans antialiased" style={{
        // Theme-aware via ThemeContext, which sets --mc-bg / --mc-text on
        // <html> data-theme. Hardcoded values used as fallback before
        // hydration so the very first paint isn't a white flash.
        backgroundColor: 'var(--mc-bg, #0A0E1A)',
        color: 'var(--mc-text, #F5F7FA)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}>
        <Providers>
          <ToastProvider>
            <CommandPalette />
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
