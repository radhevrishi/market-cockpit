'use client';
// zzz954 — the white / dark switch on Charts, Watchlists and the Stock Screener (one shared choice, remembered in this browser).
// zzz1013 — optional `className` + `icon`: the chart toolbar shows it as an icon button (label and tooltip unchanged).
export default function WorkspaceThemeToggle({ light, onToggle, style, className, icon }: { light: boolean; onToggle: () => void; style?: React.CSSProperties; className?: string; icon?: React.ReactNode }) {
  const label = light ? 'Switch to dark view' : 'Switch to white view';
  if (icon) {
    return (
      <button type="button" onClick={onToggle} aria-label={label} className={className} data-tip={light ? 'Dark view' : 'White view'} style={style}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-pressed={light} aria-label={label} className={className}
      title="White or dark view for Charts, Watchlists and the Stock Screener (remembered in this browser)"
      style={className ? style : { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--mc-border-1)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', ...style }}>
      {light ? '🌙 Dark' : '☀ White'}
    </button>
  );
}
