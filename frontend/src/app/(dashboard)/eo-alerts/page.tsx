// PATCH 0840 — EO Alerts page. Enable browser push notifications for
// new BB / STRONG earnings landings. Free, no external service.
'use client';

import { useEffect, useState } from 'react';
import { eoAlertsEnabled, setEoAlertsEnabled, requestNotificationPermission, pollAndAlert, type EOAlert } from '@/lib/eo-alerts';

export default function EOAlertsPage() {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [polling, setPolling] = useState(false);
  const [lastResult, setLastResult] = useState<{ checked: number; newBB: EOAlert[] } | null>(null);
  const [intervalId, setIntervalId] = useState<any>(null);

  useEffect(() => {
    setEnabled(eoAlertsEnabled());
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    } else {
      setPermission('unsupported');
    }
  }, []);

  useEffect(() => {
    if (enabled && permission === 'granted') {
      // poll immediately + every 30 min
      pollAndAlert().then(setLastResult);
      const id = setInterval(() => {
        pollAndAlert().then(setLastResult);
      }, 30 * 60_000);
      setIntervalId(id);
      return () => { clearInterval(id); setIntervalId(null); };
    }
    return undefined;
  }, [enabled, permission]);

  const enable = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setPermission('granted');
      setEoAlertsEnabled(true);
      setEnabled(true);
    } else {
      setPermission(Notification.permission);
    }
  };

  const disable = () => {
    setEoAlertsEnabled(false);
    setEnabled(false);
    if (intervalId) { clearInterval(intervalId); setIntervalId(null); }
  };

  const testPoll = async () => {
    setPolling(true);
    const result = await pollAndAlert();
    setLastResult(result);
    setPolling(false);
  };

  return (
    <div style={{ padding: 20, color: '#E6EDF3', maxWidth: 900, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>🔔 EO Alerts</h1>
      <p style={{ color: '#94A3B8', fontSize: 13, marginBottom: 24 }}>
        Browser-push notifications when new BLOCKBUSTER earnings land. Zero infra cost — uses the standard Web Notifications API.
        Tab needs to be open for polling to run (every 30 min). Add to Home Screen on mobile for background polling.
      </p>

      <div style={{ padding: 16, background: '#0D1623', border: '1px solid #1A2540', borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Status: {' '}
              <span style={{ color: enabled && permission === 'granted' ? '#10B981' : '#94A3B8' }}>
                {enabled && permission === 'granted' ? '✓ ACTIVE — polling every 30 min' : 'INACTIVE'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#8A95A3' }}>
              Browser permission: <strong>{permission}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!enabled && (
              <button onClick={enable} disabled={permission === 'unsupported'}
                style={{ padding: '8px 16px', background: '#0F7ABF', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                Enable alerts
              </button>
            )}
            {enabled && (
              <button onClick={disable}
                style={{ padding: '8px 16px', background: '#1A2540', color: '#E6EDF3', border: '1px solid #2A3550', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                Disable
              </button>
            )}
            <button onClick={testPoll} disabled={polling || !enabled}
              style={{ padding: '8px 16px', background: 'transparent', color: '#22D3EE', border: '1px solid #22D3EE', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {polling ? '...' : 'Test now'}
            </button>
          </div>
        </div>
      </div>

      {lastResult && (
        <div style={{ padding: 14, background: '#0D1623', border: '1px solid #1A2540', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', marginBottom: 8 }}>Last poll: {lastResult.checked} BBs scanned · {lastResult.newBB.length} new</div>
          {lastResult.newBB.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lastResult.newBB.map(b => (
                <div key={b.ticker} style={{ fontSize: 12, padding: '6px 10px', background: '#10B98115', borderLeft: '3px solid #10B981', borderRadius: 4 }}>
                  <strong>{b.ticker}</strong> — sales {Math.round(b.sales_yoy_pct || 0)}% · PAT {Math.round(b.net_profit_yoy_pct || 0)}% · EPS {Math.round(b.eps_yoy_pct || 0)}% · score {b.composite_score}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#8A95A3', fontStyle: 'italic' }}>No new BBs since last check.</div>
          )}
        </div>
      )}

      {permission === 'unsupported' && (
        <div style={{ padding: 12, background: '#F59E0B15', border: '1px solid #F59E0B55', borderRadius: 6, color: '#F59E0B', fontSize: 12, marginTop: 12 }}>
          ⚠ Your browser does not support Web Notifications. Try Chrome / Edge / Safari.
        </div>
      )}
      {permission === 'denied' && (
        <div style={{ padding: 12, background: '#EF444415', border: '1px solid #EF444455', borderRadius: 6, color: '#EF4444', fontSize: 12, marginTop: 12 }}>
          ⚠ Notifications are blocked. Re-enable in your browser site settings, then refresh.
        </div>
      )}
    </div>
  );
}
