// PATCH 0443 BUG-024 — Multibagger shell wipeout fix.
//
// Audit reported: navigating to /multibagger replaces the entire app shell
// (top navbar + sidebar + chrome) with a blank dark screen + centered
// 'Loading...' spinner for 4-6 seconds. Disorienting because the user loses
// all navigation context mid-session.
//
// Next.js App Router treats a `loading.tsx` co-located with a `page.tsx` as
// a route-segment-level Suspense fallback. It renders INSIDE the parent
// layout (DashboardClient) instead of replacing the entire app. While the
// 8000-line multibagger client component is being parsed and bootstrapped,
// the user sees this scoped skeleton sitting inside the dashboard shell —
// so navbar/sidebar/sessionContinuity are preserved.

export default function MultibaggerLoading() {
  return (
    <div style={{ padding: '24px', minHeight: 'calc(100vh - 80px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          border: '2px solid #1A2840',
          borderTopColor: '#22D3EE',
          animation: 'mb-spin 0.9s linear infinite',
        }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#E6EDF3', letterSpacing: '0.5px' }}>
          📊 Multibagger Ranking
        </span>
        <span style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>
          parsing scoring engine and reading uploaded CSVs…
        </span>
      </div>

      {/* Skeleton header row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {[120, 100, 100, 90, 90].map((w, i) => (
          <div key={i} style={{
            height: 38, width: w,
            background: 'linear-gradient(90deg, #0D1623 0%, #1A2840 50%, #0D1623 100%)',
            backgroundSize: '200% 100%',
            animation: 'mb-shimmer 1.4s linear infinite',
            borderRadius: 6,
          }} />
        ))}
      </div>

      {/* Skeleton table */}
      <div style={{ border: '1px solid #1A2840', borderRadius: 8, overflow: 'hidden' }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '10px 14px',
            borderBottom: i < 11 ? '1px solid #1A2840' : 'none',
            background: i % 2 === 0 ? '#0A1422' : '#0D1623',
          }}>
            {[80, 200, 60, 60, 60, 80, 60, 100].map((w, j) => (
              <div key={j} style={{
                height: 14, width: w,
                background: 'linear-gradient(90deg, #1A2840 0%, #2A3B4C 50%, #1A2840 100%)',
                backgroundSize: '200% 100%',
                animation: `mb-shimmer 1.4s linear infinite ${i * 0.03}s`,
                borderRadius: 3,
                opacity: 0.6,
              }} />
            ))}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes mb-spin { to { transform: rotate(360deg); } }
        @keyframes mb-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
