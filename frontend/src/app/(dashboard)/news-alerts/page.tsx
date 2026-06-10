'use client';

/**
 * PATCH 0237 — Client-side News Alert Rules v0.
 *
 * Distinct from the existing /alerts page (which is server-backed earnings
 * / market alerts). This page lets the user define rules that watch the
 * /news live stream and fire a browser Notification + on-screen toast
 * when a new article matches. Rules persist in localStorage.
 *
 * Real cross-channel delivery (Slack/Email/Webhook) needs the proper
 * server-side Alert Rules engine — frontend v0 here, fires only while
 * this tab is open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { TOKENS } from '@/lib/design-tokens';

interface AlertCondition {
  article_type?: string;
  region?: 'IN' | 'US' | 'ALL';
  min_importance?: number;
  ticker?: string;
  theme_substring?: string;
  headline_substring?: string;
}
interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: AlertCondition;
  lastFiredArticleIds: string[];
  lastFiredAt: number;
  createdAt: number;
}

const STORE_KEY = 'mc:news-alerts:v1';

function loadRules(): AlertRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveRules(rules: AlertRule[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rules)); } catch {}
}
function matches(article: any, c: AlertCondition): boolean {
  if (c.article_type && article.article_type !== c.article_type) return false;
  if (c.region && c.region !== 'ALL' && article.region !== c.region) return false;
  if (c.min_importance && (article.importance_score || 0) < c.min_importance) return false;
  if (c.ticker) {
    const haystack = (article.ticker_symbols || []).map((t: any) => (typeof t === 'string' ? t : t?.ticker || '')).join(' ').toUpperCase();
    if (!haystack.includes(c.ticker.toUpperCase())) return false;
  }
  if (c.theme_substring && !((article.bottleneck_sub_tag || '').toLowerCase().includes(c.theme_substring.toLowerCase()))) return false;
  if (c.headline_substring) {
    const h = (article.headline || article.title || '').toLowerCase();
    if (!h.includes(c.headline_substring.toLowerCase())) return false;
  }
  return true;
}

function useNewsStream() {
  return useQuery<any[]>({
    queryKey: ['news-alerts', 'stream'],
    queryFn: async () => {
      const { data } = await api.get('/news?limit=100');
      return Array.isArray(data) ? data : (data?.items || []);
    },
    refetchInterval: 90_000 /* PATCH 0818: 60s→5m */,
    staleTime: 30_000,
  });
}

export default function NewsAlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules());
  const [draft, setDraft] = useState<Partial<AlertRule>>({});
  const [permission, setPermission] = useState<NotificationPermission>(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default');
  const [toasts, setToasts] = useState<Array<{ id: string; rule: string; headline: string; ts: number }>>([]);
  const lastSeenIds = useRef<Set<string>>(new Set());

  const { data: stream } = useNewsStream();

  useEffect(() => { saveRules(rules); }, [rules]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STORE_KEY) setRules(loadRules()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!stream || stream.length === 0) return;
    // PATCH 0608 — fix "rule matches 38 but never fires" bug.
    // Old logic seeded lastSeenIds with every existing article on first
    // mount and EARLY-RETURNED, so any rule created BEFORE the user
    // refreshed the page would never fire for the historical stream —
    // every article was already 'seen'. New logic separates concerns:
    //   1. Per-RULE: `rule.lastFiredArticleIds` prevents double-firing
    //      the same article through the same rule (this was always there).
    //   2. NEW: a rule with `lastFiredAt === 0` (brand new, never fired)
    //      sweeps the entire current stream once on first encounter.
    //      After the sweep its lastFiredArticleIds are populated, so
    //      subsequent ticks only re-fire on truly new articles.
    //   3. lastSeenIds gate now ONLY suppresses toast spam (avoid showing
    //      the same article twice in one session) — not rule processing.
    const newToasts: { id: string; rule: string; headline: string; ts: number }[] = [];
    const hitsByRule = new Map<string, string[]>(); // ruleId → article ids hit this pass
    const firedAt = Date.now();

    for (const article of stream) {
      // Per-article toast-dedup (cosmetic only — does NOT gate rule firing)
      const articleSeenThisSession = lastSeenIds.current.has(article.id);
      if (!articleSeenThisSession) {
        lastSeenIds.current.add(article.id);
        if (lastSeenIds.current.size > 500) {
          const arr = Array.from(lastSeenIds.current);
          lastSeenIds.current = new Set(arr.slice(-300));
        }
      }
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (rule.lastFiredArticleIds.includes(article.id)) continue;
        if (!matches(article, rule.conditions)) continue;
        const headline = article.headline || article.title || '(no headline)';
        // Only push a toast if we haven't shown this article this session
        // (the rule still fires + lastFiredArticleIds still updates).
        if (!articleSeenThisSession) {
          newToasts.push({ id: `${rule.id}-${article.id}`, rule: rule.name, headline, ts: firedAt });
          if (permission === 'granted' && 'Notification' in window) {
            try {
              new Notification(`Alert: ${rule.name}`, { body: headline.slice(0, 200), tag: rule.id });
            } catch {}
          }
          // PATCH 0726 — fire-and-forget server-side dispatch to Slack / SMTP /
          // generic webhook. Each channel no-ops when its env vars aren't set,
          // so this is safe to call unconditionally. Don't block the UI on
          // the result; just log failures.
          try {
            fetch('/api/v1/alerts/dispatch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                rule: { id: rule.id, name: rule.name },
                article: {
                  title: headline,
                  url: article.url,
                  source: article.source,
                  published_at: article.published_at || article.publishedAt,
                  ticker_symbols: (article.ticker_symbols || []).map((t: any) =>
                    typeof t === 'string' ? t : t?.ticker || ''
                  ).filter(Boolean),
                  importance_score: article.importance_score,
                },
                triggeredAt: new Date(firedAt).toISOString(),
              }),
            }).catch((err) => {
              // 401 (no secret on client) is expected — endpoint is gated.
              // Silently drop; users running a server-side rule engine
              // would call this endpoint directly with the secret.
              if (process.env.NODE_ENV !== 'production') {
                console.debug('[alert-dispatch] fire-and-forget failed', err);
              }
            });
          } catch {}
        }
        const arr = hitsByRule.get(rule.id) || [];
        arr.push(article.id);
        hitsByRule.set(rule.id, arr);
      }
    }

    // Batch all UI state updates into single renders (React doesn't auto-batch
    // outside event handlers in v17 — and this is a useEffect callback).
    if (newToasts.length > 0) {
      setToasts(t => [...newToasts, ...t].slice(0, 20));
    }
    if (hitsByRule.size > 0) {
      // PATCH 0453 P1-15 — 2000-item ring (an active rule firing every minute
      // for 24h still fits comfortably).
      setRules(rs => rs.map(r => {
        const hits = hitsByRule.get(r.id);
        if (!hits || hits.length === 0) return r;
        return {
          ...r,
          lastFiredAt: firedAt,
          lastFiredArticleIds: [...hits, ...r.lastFiredArticleIds].slice(0, 2000),
        };
      }));
    }
  }, [stream, rules, permission]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const id = setTimeout(() => setToasts(t => t.slice(0, -1)), 8000);
    return () => clearTimeout(id);
  }, [toasts]);

  const requestPerm = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const addRule = () => {
    if (!draft.name?.trim()) return;
    const r: AlertRule = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: draft.name.trim().slice(0, 60),
      enabled: true,
      conditions: draft.conditions || {},
      lastFiredArticleIds: [],
      lastFiredAt: 0,
      createdAt: Date.now(),
    };
    setRules(rs => [r, ...rs]);
    setDraft({});
  };

  // PATCH 0620 — preset alert templates. One-click add to the user's rules.
  // Curated around the portal's thesis: bottleneck transmission, capacity
  // signals, special-situation catalysts, marquee-capital entry, etc.
  const PRESET_ALERTS: Array<{ label: string; emoji: string; conditions: any }> = [
    { label: 'AI Infra · HIGH only', emoji: '🤖', conditions: { article_type: 'BOTTLENECK', min_importance: 0.6, headline_contains: 'AI|HBM|GPU|data center|CoWoS|silicon|semiconductor' } },
    { label: 'Power Grid Bottleneck', emoji: '⚡', conditions: { article_type: 'BOTTLENECK', min_importance: 0.5, headline_contains: 'power|transformer|grid|transmission|nuclear|HVDC' } },
    { label: 'Order Wins (PSU)', emoji: '📑', conditions: { headline_contains: 'order|letter of award|receipt of order|contract worth|order book|LoA' } },
    { label: 'Rating Upgrade', emoji: '🏛', conditions: { headline_contains: 'ICRA|CRISIL|CARE|upgrade|outlook revised|rating action' } },
    { label: 'Marquee PE Entry', emoji: '💎', conditions: { headline_contains: 'preferential|stake|KKR|Blackstone|Bain|ChrysCapital|Tata Capital' } },
    { label: 'Capacity Expansion', emoji: '🏗', conditions: { headline_contains: 'capacity|capex|new plant|expansion|commission|debottlenecking' } },
    { label: 'Earnings Surprise', emoji: '📊', conditions: { article_type: 'EARNINGS', min_importance: 0.5 } },
    { label: 'Promoter Buying', emoji: '👀', conditions: { headline_contains: 'promoter|insider|stake hike|increased holding' } },
  ];
  const addPreset = (p: typeof PRESET_ALERTS[0]) => {
    const r: AlertRule = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: p.label,
      enabled: true,
      conditions: p.conditions,
      lastFiredArticleIds: [],
      lastFiredAt: 0,
      createdAt: Date.now(),
    };
    setRules(rs => [r, ...rs]);
    toast.success(`Added "${p.label}" to your alerts.`);
  };

  const toggleRule = (id: string) => setRules(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  // AUDIT_100 #67 — "Test fire" button. Runs the rule against the last 100
  // articles in the live stream and shows a summary toast of how many would
  // have matched + the top 3 headlines. Doesn't push to lastFiredArticleIds
  // (a test should be observable without polluting the real fire log).
  const testFireRule = (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    if (!stream || stream.length === 0) { toast('No articles in current stream to test against.'); return; }
    const hits = stream.filter(a => matches(a, rule.conditions));
    if (hits.length === 0) { toast(`"${rule.name}": 0 matches in last ${stream.length} articles.`, { icon: '🔕' }); return; }
    const preview = hits.slice(0, 3).map((a: any) => `• ${(a.headline || a.title || '').slice(0, 90)}`).join('\n');
    toast.success(`"${rule.name}": ${hits.length} matches in last ${stream.length} articles\n${preview}`, { duration: 8000, style: { whiteSpace: 'pre-line', maxWidth: 560 } });
  };
  // AUDIT_100 #5 — replace native window.confirm with toast confirm; iframe-safe + consistent with the rest of the app.
  const deleteRule = (id: string) => {
    toast((t) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Delete this alert rule?</span>
        <button onClick={() => { setRules(rs => rs.filter(r => r.id !== id)); toast.dismiss(t.id); toast.success('Rule deleted'); }}
          style={{ padding: '4px 10px', background: '#EF4444', color: '#fff', borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 12 }}>
          Delete
        </button>
        <button onClick={() => toast.dismiss(t.id)}
          style={{ padding: '4px 10px', background: 'transparent', color: '#94A3B8', borderRadius: 4, border: '1px solid #2A3B4C', cursor: 'pointer', fontSize: 12 }}>
          Cancel
        </button>
      </div>
    ), { duration: 8000 });
  };

  // PATCH 0279 — Import / export rules as JSON so users can move them across
  // browsers and machines without depending on cloud sync. Export downloads
  // a timestamped file; import merges by `id` (existing rules with the same
  // id are overwritten; new ids are appended).
  const exportRules = () => {
    try {
      const payload = JSON.stringify(rules, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `news-alerts-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // AUDIT_100 #5 — toast instead of native alert (iframe-safe).
      console.error('exportRules failed', err);
      toast.error('Export failed. See console.');
    }
  };
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importRules = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text) as AlertRule[];
        if (!Array.isArray(parsed)) throw new Error('Not an array');
        // AUDIT_100 #16 — schema-validate condition sub-fields. A malicious or
        // malformed JSON can pass id/name string checks but inject objects /
        // arrays into conditions.ticker / theme_substring / headline_substring,
        // which then crash `.toLowerCase()` / `.includes(...)` at matches().
        const isStrOpt = (x: any) => x === undefined || typeof x === 'string';
        const isCondOk = (c: any) =>
          c && typeof c === 'object' &&
          isStrOpt(c.article_type) &&
          (c.region === undefined || c.region === 'IN' || c.region === 'US' || c.region === 'ALL') &&
          (c.min_importance === undefined || typeof c.min_importance === 'number') &&
          isStrOpt(c.ticker) &&
          isStrOpt(c.theme_substring) &&
          isStrOpt(c.headline_substring);
        const valid = parsed.filter((r) =>
          r && typeof r === 'object' &&
          typeof r.id === 'string' &&
          typeof r.name === 'string' &&
          isCondOk(r.conditions)
        );
        // AUDIT_100 #5 — toast.error in place of native alert (iframe-safe).
        if (valid.length === 0) { toast.error('No valid rules found in file.'); return; }
        setRules((current) => {
          const byId = new Map(current.map(r => [r.id, r]));
          for (const r of valid) {
            byId.set(r.id, {
              ...r,
              enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
              lastFiredArticleIds: Array.isArray(r.lastFiredArticleIds) ? r.lastFiredArticleIds : [],
            } as AlertRule);
          }
          return Array.from(byId.values());
        });
        toast.success(`Imported ${valid.length} rules.`);
      } catch (err) {
        console.error('importRules failed', err);
        toast.error('Import failed — invalid JSON or wrong shape.');
      }
    };
    reader.readAsText(file);
  };

  const testCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rules) out[r.id] = (stream || []).filter(a => matches(a, r.conditions)).length;
    return out;
  }, [rules, stream]);

  return (
    <div style={{
      padding: '24px 32px', minHeight: '100vh',
      backgroundColor: TOKENS.surface.canvas, color: TOKENS.surface.text,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 4 }}>News Alert Rules</h1>
          <p style={{ fontSize: 13, color: TOKENS.surface.textDim, margin: '0 0 16px', maxWidth: 760 }}>
            Watch the live /news stream from this tab. When a new article matches one of your rules,
            a browser notification + on-screen toast fires. Rules persist locally; cross-channel
            delivery (Slack/Email/Webhook) is coming next.
          </p>
        </div>
        {/* PATCH 0279 — Import / Export controls so rules portable across browsers. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={exportRules}
            disabled={rules.length === 0}
            title={rules.length === 0 ? 'No rules to export yet.' : `Download ${rules.length} rules as JSON.`}
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${TOKENS.surface.cardBorder}`,
              color: rules.length === 0 ? TOKENS.surface.textMuted : TOKENS.surface.text,
              borderRadius: 6, padding: '6px 12px',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
              cursor: rules.length === 0 ? 'not-allowed' : 'pointer',
              opacity: rules.length === 0 ? 0.5 : 1,
            }}
          >↓ EXPORT JSON ({rules.length})</button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="Merge rules from a previously-exported JSON file."
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${TOKENS.surface.cardBorder}`,
              color: TOKENS.surface.text,
              borderRadius: 6, padding: '6px 12px',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
              cursor: 'pointer',
            }}
          >↑ IMPORT JSON</button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importRules(f);
              if (importInputRef.current) importInputRef.current.value = '';
            }}
          />
        </div>
      </div>

      {permission !== 'granted' && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          backgroundColor: TOKENS.severity.high.bg, border: `1px solid ${TOKENS.severity.high.border}`,
          color: TOKENS.severity.high.solid, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap',
        }}>
          <span>⚠ Browser notifications are {permission}. On-screen toasts still work; enable notifications for background alerts.</span>
          {permission === 'default' && (
            <button onClick={requestPerm} style={{ marginLeft: 'auto', backgroundColor: 'transparent', border: `1px solid ${TOKENS.severity.high.solid}`, color: TOKENS.severity.high.solid, borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              Enable notifications
            </button>
          )}
          {/* AUDIT_100 #37 — inline mock notification preview so the user sees
              exactly what a fired alert looks like before they grant permission. */}
          <div style={{
            flex: '1 1 100%', marginTop: 6, padding: '10px 12px',
            backgroundColor: '#0A1422', borderRadius: 6,
            border: '1px dashed #1E2D45', display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: 18, lineHeight: 1 }}>🔔</div>
            <div style={{ flex: 1, fontFamily: 'system-ui', color: '#E6EDF3' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.3px', marginBottom: 2 }}>
                MARKET COCKPIT · just now (preview)
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Alert: AI Infrastructure · HIGH severity</div>
              <div style={{ fontSize: 12, color: '#C9D4E0', marginTop: 2 }}>
                Nvidia memory costs soar 485% as HBM supply remains constrained — Indian transmission proxies surface…
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PATCH 0620 — RECOMMENDED ALERT PRESETS. One-click add curated rules
          aligned with the portal's bottleneck-transmission thesis. */}
      <div style={{
        marginBottom: 20,
        padding: '12px 14px',
        backgroundColor: TOKENS.surface.card,
        borderRadius: 8,
        border: `1px solid ${TOKENS.surface.cardBorder}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.surface.text, letterSpacing: '0.4px', marginBottom: 4 }}>
          🎯 RECOMMENDED ALERT PRESETS
        </div>
        <div style={{ fontSize: 11, color: TOKENS.surface.textDim, marginBottom: 10 }}>
          One-click templates curated for institutional research. Click any to add it to your rules. You can edit conditions afterwards.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_ALERTS.map(p => (
            <button
              key={p.label}
              onClick={() => addPreset(p)}
              style={{
                fontSize: 11,
                padding: '5px 11px',
                border: `1px solid ${TOKENS.surface.cardBorder}`,
                background: 'transparent',
                color: TOKENS.surface.text,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title={`Conditions: ${JSON.stringify(p.conditions)}`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        {rules.length === 0 ? (
          <p style={{ fontSize: 13, color: TOKENS.surface.textDim, fontStyle: 'italic' }}>No rules yet. Click a preset above or add one below.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map(r => (
              <div key={r.id} style={{
                backgroundColor: TOKENS.surface.card,
                border: `1px solid ${TOKENS.surface.cardBorder}`,
                borderLeft: `3px solid ${r.enabled ? TOKENS.state.live.solid : TOKENS.state.archived.solid}`,
                borderRadius: 8, padding: '10px 14px',
                display: 'grid', gridTemplateColumns: '1fr 1fr 100px 70px 100px 80px',
                gap: 12, alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                    {Object.entries(r.conditions).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ') || '(no conditions — matches all)'}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: TOKENS.surface.textDim, fontFamily: 'ui-monospace, monospace' }}>
                  {r.lastFiredAt
                    ? `last fired ${new Date(r.lastFiredAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                    : 'never fired'}
                </div>
                <div style={{ fontSize: 11, color: TOKENS.surface.textDim, fontFamily: 'ui-monospace, monospace', textAlign: 'center' }}>
                  matches now: <strong style={{ color: TOKENS.surface.text }}>{testCounts[r.id] ?? 0}</strong>
                </div>
                {/* AUDIT_100 #67 — test fire button: run against last 100 articles. */}
                <button onClick={() => testFireRule(r.id)} title="Run this rule against the last 100 articles and show how many match (without firing real notifications)" style={{
                  backgroundColor: 'transparent',
                  border: `1px solid ${TOKENS.surface.cardBorder}`,
                  color: TOKENS.surface.textDim,
                  borderRadius: 5, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>⚡ TEST</button>
                <button onClick={() => toggleRule(r.id)} style={{
                  backgroundColor: r.enabled ? `${TOKENS.state.live.solid}20` : 'transparent',
                  border: `1px solid ${r.enabled ? TOKENS.state.live.solid : TOKENS.surface.cardBorder}`,
                  color: r.enabled ? TOKENS.state.live.solid : TOKENS.surface.textDim,
                  borderRadius: 5, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>{r.enabled ? '● ARMED' : '○ paused'}</button>
                <button onClick={() => deleteRule(r.id)} style={{
                  background: 'none', border: 'none', color: TOKENS.semantic.bearish.solid,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}>delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{
        backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
        borderRadius: 10, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.surface.accent, letterSpacing: '0.6px', marginBottom: 10 }}>
          NEW RULE
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input
            placeholder="Rule name (e.g. 'AI Infrastructure · HIGH only')"
            value={draft.name || ''}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            style={{ gridColumn: '1 / -1', backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          />
          <select
            value={draft.conditions?.article_type || ''}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, article_type: e.target.value || undefined } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          >
            <option value="">Any article type</option>
            <option value="BOTTLENECK">BOTTLENECK</option>
            <option value="EARNINGS">EARNINGS</option>
            <option value="RATING_CHANGE">RATING CHANGE</option>
            <option value="MACRO">MACRO</option>
            <option value="GEOPOLITICAL">GEOPOLITICAL</option>
            <option value="TARIFF">TARIFF</option>
            <option value="CORPORATE">CORPORATE</option>
          </select>
          <select
            value={draft.conditions?.region || 'ALL'}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, region: e.target.value as any } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          >
            <option value="ALL">Any region</option>
            <option value="IN">India only</option>
            <option value="US">US only</option>
          </select>
          <input
            placeholder="Ticker substring (e.g. HAL, BEL)"
            value={draft.conditions?.ticker || ''}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, ticker: e.target.value || undefined } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          />
          <input
            placeholder="Theme substring (e.g. memory_storage)"
            value={draft.conditions?.theme_substring || ''}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, theme_substring: e.target.value || undefined } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          />
          <input
            placeholder="Headline contains…"
            value={draft.conditions?.headline_substring || ''}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, headline_substring: e.target.value || undefined } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          />
          <select
            value={draft.conditions?.min_importance ?? ''}
            onChange={e => setDraft({ ...draft, conditions: { ...draft.conditions, min_importance: e.target.value ? Number(e.target.value) : undefined } })}
            style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
          >
            <option value="">Any importance</option>
            <option value="5">≥ 5 (critical)</option>
            <option value="4">≥ 4</option>
            <option value="3">≥ 3</option>
            <option value="2">≥ 2</option>
          </select>
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={addRule}
            disabled={!draft.name?.trim()}
            style={{
              backgroundColor: TOKENS.surface.accent, border: 'none', color: '#000',
              borderRadius: 6, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: draft.name?.trim() ? 'pointer' : 'not-allowed',
              opacity: draft.name?.trim() ? 1 : 0.5,
            }}
          >Add Rule</button>
        </div>
      </div>

      <p style={{ fontSize: 11, color: TOKENS.surface.textMuted, marginTop: 16, lineHeight: 1.6 }}>
        Alerts v0 — fires from this browser tab while it's open. Slack / Email / Webhook delivery
        and server-side rule evaluation require the proper Alert Rules engine (coming next).
      </p>

      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              backgroundColor: TOKENS.surface.card,
              border: `1px solid ${TOKENS.severity.high.border}`,
              borderLeft: `3px solid ${TOKENS.severity.high.solid}`,
              borderRadius: 8, padding: '10px 14px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TOKENS.severity.high.solid, letterSpacing: '0.5px' }}>
                ★ ALERT · {t.rule}
              </div>
              <div style={{ fontSize: 12, color: TOKENS.surface.text, marginTop: 4, lineHeight: 1.4 }}>
                {t.headline.slice(0, 200)}
              </div>
              <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
                {new Date(t.ts).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
