'use client';
// zzz954 — the white / dark switch on Charts, Watchlists and the Stock Screener (one shared choice, remembered in this browser).
export default function WorkspaceThemeToggle({ light, onToggle, style }: { light: boolean; onToggle: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={light} aria-label={light ? 'Switch to dark view' : 'Switch to white view'}
      title="White or dark view for Charts, Watchlists and the Stock Screener (remembered in this browser)"
      style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', ...style }}>
      {light ? '🌙 Dark' : '☀ White'}
    </button>
  );
}
