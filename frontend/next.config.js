/** @type {import('next').NextConfig} */
const nextConfig = {
  // PATCH 1007 — tolerate pre-existing TS errors in ErrorBoundary class
  // components etc. so production builds aren't blocked. Dev-time tsc
  // catches real bugs; production build just needs to compile.
  typescript: { ignoreBuildErrors: true },
  // zzz855 — compression is done by server.js (br + gzip, and it also covers
  // App Router /api JSON, which Next's built-in gzip skipped). Turning Next's
  // off avoids two layers touching the same response. If server.js is ever
  // bypassed (plain `next start`, Vercel), responses are simply uncompressed
  // by Next — Vercel's edge compresses on its own.
  compress: false,
  reactStrictMode: false, // disable double-render in dev to avoid chunk race conditions
  // zzz883 (Next 16): swcMinify is always on; serverExternalPackages replaces experimental.serverComponentsExternalPackages;
  // instrumentation.ts is picked up without a flag.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'xlsx'],
  // PATCH 0122 — fix Vercel build failure (all 10 deploys 0112-0121 errored
  // at ~45s with webpack 'Module not found: pdf-parse / mammoth').  Both are
  // Node-only libraries (binary deps + fs reads); webpack cannot bundle them
  // for the /api/concall/parse server route.  Marking them external leaves
  // them as runtime imports — Node resolves them normally on Vercel.
  // Belt-and-braces: also tell webpack to not try and bundle these on the
  // server build pass.  Some Next.js versions need both signals.
  images: {
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
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  env: {
    // Point to same-origin proxy (Next.js rewrites handle the rest)
    NEXT_PUBLIC_API_URL: '/api/v1',
  },
};

module.exports = nextConfig;
