// Instant skeleton shown while the route segment chunk + first data load.
// Server component (no hooks) so it paints immediately inside the dashboard layout.
export default function Loading() {
  const bg = '#0a0e14', panel = '#111722', line = '#1e2733';
  const bar = (w: string, h = 12): any => ({
    width: w, height: h, borderRadius: 6,
    background: 'linear-gradient(90deg,#141b26,#1f2a3a,#141b26)',
    backgroundSize: '200% 100%', animation: 'mcskel 1.2s ease-in-out infinite',
  });
  const card: any = { background: panel, border: '1px solid ' + line, borderRadius: 10, padding: 14, marginBottom: 12 };
  return (
    <div style={{ background: bg, minHeight: '100vh', padding: '24px 22px', color: '#e6edf3' }}>
      <style>{'@keyframes mcskel{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
      <div style={{ maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ ...bar('260px', 26), marginBottom: 10 }} />
        <div style={{ ...bar('420px', 13), marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={card}>
              <div style={{ ...bar('45%', 12), marginBottom: 12 }} />
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                  <div style={bar('22px', 22)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ ...bar('70%', 11), marginBottom: 6 }} />
                    <div style={bar('40%', 9)} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
