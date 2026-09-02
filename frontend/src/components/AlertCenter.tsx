'use client';

// ════════════════════════════════════════════════════════════════════════════
// AlertCenter — Home card: user-defined alerts (🔔 ALERTS). Rules are managed
// inline; quotes are polled every 5 minutes and evaluated via lib/alerts.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  AlertHit, AlertKind, AlertRule,
  addRule, evaluateAlerts, getRules, notify, removeRule, requestNotifyPermission,
} from '@/lib/alerts';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const HITS_KEY = 'mc:alerts:hits:v1';

const KIND_LABELS: Record<AlertKind, string> = {
  ma50_touch: 'touches 50DMA',
  ma200_touch: 'touches 200DMA',
  price_below: 'price below…',
  price_above: 'price above…',
  drop_day: 'falls ≥X% in a day',
  decay_flag: 'decay flag fires',
};
const LEVEL_KINDS: AlertKind[] = ['price_below', 'price_above', 'drop_day'];

interface StoredHit { at: number; message: string }

function describe(r: AlertRule): string {
  switch (r.kind) {
    case 'price_below': return `price below ${r.level ?? '?'}`;
    case 'price_above': return `price above ${r.level ?? '?'}`;
    case 'drop_day': return `falls ≥${r.level ?? 5}% in a day`;
    default: return KIND_LABELS[r.kind];
  }
}

async function fetchMarket(market: 'india' | 'us'): Promise<Array<{ ticker: string; price: number; changePercent: number | null }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`/api/market/quotes?market=${market}&fields=ticker,price,changePercent`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.stocks) ? data.stocks : [];
  } catch { return []; } finally { clearTimeout(timer); }
}

export default function AlertCenter() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [hits, setHits] = useState<StoredHit[]>([]);
  const [ticker, setTicker] = useState('');
  const [kind, setKind] = useState<AlertKind>('ma50_touch');
  const [level, setLevel] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);

  const poll = useCallback(async () => {
    const [ind, us] = await Promise.all([fetchMarket('india'), fetchMarket('us')]);
    const live = new Map<string, { price: number; chg: number | null }>();
    for (const s of [...ind, ...us]) {
      const t = String(s?.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '');
      const p = Number(s?.price);
      if (t && Number.isFinite(p) && p > 0) {
        live.set(t, { price: p, chg: Number.isFinite(Number(s?.changePercent)) ? Number(s.changePercent) : null });
      }
    }
    const fired = notify(evaluateAlerts(live));
    setRules(getRules()); // pick up lastFiredAt stamps
    if (fired.length) {
      setHits((prev) => {
        const next = [...fired.map((h: AlertHit) => ({ at: Date.now(), message: h.message })), ...prev].slice(0, 20);
        try { localStorage.setItem(HITS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setRules(getRules());
    try {
      const stored = JSON.parse(localStorage.getItem(HITS_KEY) || '[]');
      if (Array.isArray(stored)) setHits(stored.slice(0, 20));
    } catch { /* ignore */ }
    if ('Notification' in window && Notification.permission === 'default') setNeedsPermission(true);
    poll();
    const id = setInterval(poll, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [poll]);

  const onAdd = () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    const lv = parseFloat(level);
    addRule({ ticker: t, kind, level: Number.isFinite(lv) ? lv : undefined });
    setRules(getRules());
    setTicker(''); setLevel('');
  };

  const chip: React.CSSProperties = {
    fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '2px 6px',
    borderRadius: 6, border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)', color: 'var(--mc-text-2)',
  };
  const input: React.CSSProperties = {
    fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: '4px 6px',
    borderRadius: 6, border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)',
    outline: 'none',
  };

  return (
    <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 9, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 900, letterSpacing: 1, color: 'var(--mc-text-2)' }}>🔔 ALERTS</div>
        {needsPermission && (
          <button
            onClick={() => requestNotifyPermission().then(() => setNeedsPermission(false))}
            style={{ ...chip, cursor: 'pointer', color: 'var(--mc-cyan)' }}
          >
            enable notifications
          </button>
        )}
      </div>

      {/* Rules */}
      {rules.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)', marginBottom: 8 }}>
          e.g. NVDA touches 50DMA · RELIANCE falls 5% in a day
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {rules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)' }}>{r.ticker}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-3)', flex: 1 }}>{describe(r)}</span>
              <button
                onClick={() => { removeRule(r.id); setRules(getRules()); }}
                title="remove"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'var(--mc-text-4)', padding: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="TICKER"
          style={{ ...input, width: 90, textTransform: 'uppercase' }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} style={{ ...input, cursor: 'pointer' }}>
          {(Object.keys(KIND_LABELS) as AlertKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        {LEVEL_KINDS.includes(kind) && (
          <input
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder={kind === 'drop_day' ? 'X %' : 'level'}
            type="number"
            style={{ ...input, width: 70 }}
          />
        )}
        <button
          onClick={onAdd}
          style={{ ...input, cursor: 'pointer', fontWeight: 900, color: 'var(--mc-accent)', borderColor: 'var(--mc-border-1)' }}
        >
          ADD
        </button>
      </div>

      {/* Recent hits */}
      {hits.length > 0 && (
        <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {hits.map((h, i) => (
            <div key={`${h.at}_${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--mc-text-4)', flexShrink: 0 }}>
                {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: 'var(--mc-warn)' }}>{h.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
