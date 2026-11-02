// Lightweight route fallback: renders immediately without requesting market data.
// A skeleton never invents prices, ranking scores or a successful connection.
export default function DashboardRouteLoading() {
  return (
    <main role="status" aria-live="polite" aria-busy="true"
      style={{ width: '100%', maxWidth: 1240, margin: '0 auto', padding: 'clamp(14px,3vw,28px)', color: 'var(--mc-text-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700 }}>MARKET COCKPIT</p>
          <h1 style={{ margin: 0, fontSize: 20, color: 'var(--mc-text-1)' }}>Loading research workspace…</h1>
        </div>
        <span style={{ fontSize: 12 }}>Retrieving saved results</span>
      </div>
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px,100%), 1fr))', gap: 14 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 12, padding: 16, background: 'var(--mc-bg-1)', minHeight: 140 }}>
            <div style={{ height: 12, width: '56%', borderRadius: 6, background: 'var(--mc-bg-4)', marginBottom: 24 }} />
            <div style={{ height: 20, width: '75%', borderRadius: 6, background: 'var(--mc-bg-4)', marginBottom: 12 }} />
            <div style={{ height: 11, width: '90%', borderRadius: 6, background: 'var(--mc-bg-4)' }} />
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, marginTop: 18 }}>Financial figures are shown only after the data source responds.</p>
    </main>
  );
}
