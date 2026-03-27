import type { Metadata } from 'next';
import { Providers } from '@/app/providers';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Market Cockpit — Bloomberg-lite for India + US Markets',
  description: 'Real-time financial dashboard for active equity investors',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0A0E1A" />
      </head>
      <body className="font-sans antialiased" style={{
        backgroundColor: '#0A0E1A',
        color: '#F5F7FA',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
