/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // disable double-render in dev to avoid chunk race conditions
  swcMinify: true,
  // Keep compiled pages in dev server memory much longer to prevent chunk 404s on refresh
  onDemandEntries: {
    maxInactiveAge: 3600 * 1000,  // keep pages alive for 1 hour (default 15s)
    pagesBufferLength: 20,        // keep 20 pages in buffer (default 5)
  },
  images: {
    domains: [
      'api.example.com',
      'images.example.com',
      'cdn.financialdata.com',
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.example.com',
      },
    ],
  },
  async headers() {
    return [
      {
        // Only apply security headers to non-static paths
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  // Proxy /api/v1/* to FastAPI backend ONLY in local dev (Vercel has no Python backend).
  // On Vercel, Next.js API routes at /api/v1/* handle everything natively.
  async rewrites() {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      return []; // No rewrite on Vercel — Next.js API routes serve /api/v1/*
    }
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.FASTAPI_URL || 'http://127.0.0.1:8000'}/api/v1/:path*`,
      },
    ];
  },
  env: {
    // Point to same-origin proxy (Next.js rewrites handle the rest)
    NEXT_PUBLIC_API_URL: '/api/v1',
  },
};

module.exports = nextConfig;
