import type { Metadata } from 'next';
import { Providers } from '@/app/providers';
import '@/app/globals.css';
import '@/styles/design-system.css';
import { ToastProvider, CommandPalette } from '@/components/design-system';
import PwaRegister from '@/components/pwa/PwaRegister';
import { pwaBuildVersion } from '@/components/pwa/build-version';
import { SCREEN_THEME_EARLY } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Market Cockpit — Bloomberg-lite for India + US Markets',
  description: 'Real-time financial dashboard for active equity investors',
};

// zzz796 — runs before React: remembers Chrome's install offer (it fires once,
// early) and marks the page when it is running as the installed app, so the
// first paint already has the right spacing. No data, no network.
const PWA_EARLY = "try{window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__mcBip=e;});var sa=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;document.documentElement.setAttribute('data-pwa',sa?'standalone':'browser');}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pwaVersion = pwaBuildVersion();
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0A0E1A" />
        {/* PWA / iOS Home Screen (zzz796) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Cockpit" />
        <meta name="application-name" content="Market Cockpit" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <script dangerouslySetInnerHTML={{ __html: PWA_EARLY }} />
        <script dangerouslySetInnerHTML={{ __html: SCREEN_THEME_EARLY }} />
      </head>
      <body className="font-sans antialiased" style={{
        backgroundColor: 'var(--mc-bg, var(--mc-bg-0))',
        color: 'var(--mc-text, var(--mc-text-0))',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}>
        <Providers>
          <ToastProvider>
            <CommandPalette />
            {children}
            <PwaRegister version={pwaVersion} />
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
