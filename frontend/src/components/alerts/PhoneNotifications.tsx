'use client';
// zzz1064 — "📱 Phone notifications" card: shows whether THIS device gets price alerts as phone notifications and turns them
// on / off with one tap. Full card on /price-alerts; `compact` is the small row in the header bell's panel.
// White / light, plain English. The permission prompt is only ever asked for after a tap (iPhone requires that).
import { useCallback, useEffect, useState } from 'react';
import {
  detectPushEnv, pushState, pushStateText, turnOnPush, turnOffPush, sendTestPush, IOS_INSTALL_STEPS, PUSH_CHANGED_EVENT, type PushState,
} from '@/lib/push-client';

const DOT: Record<PushState, string> = {
  checking: '#9ca3af', on: '#16a34a', off: '#9ca3af', blocked: '#dc2626', 'ios-install': '#d97706', unsupported: '#9ca3af', 'server-missing': '#d97706',
};

const CSS = `
.mcpn{background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:14px}
.mcpn.on{border-color:#bbf7d0;background:#f0fdf4}
.mcpn h2{font-size:16px;margin:0;font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mcpn-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.mcpn-state{font-size:14px;font-weight:700}
.mcpn-detail{color:#4b5563;font-size:13px;margin:6px 0 0;line-height:1.45}
.mcpn-steps{margin:8px 0 0;padding-left:20px;font-size:14px;line-height:1.5;color:#111827}
.mcpn-steps li{margin-bottom:4px}
.mcpn-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.mcpn-btn{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:10px;padding:9px 14px;cursor:pointer;font-weight:700;font-size:14px;min-height:42px}
.mcpn-btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.mcpn-btn:disabled{opacity:.6;cursor:default}
.mcpn-note{margin-top:10px;font-size:13px;white-space:pre-line;border-radius:8px;padding:8px 10px;background:#f3f4f6;color:#111827}
.mcpn-note.bad{background:#fef2f2;color:#991b1b}
.mcpn-note.good{background:#ecfdf5;color:#065f46}
.mcpn-c{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;flex-wrap:wrap}
.mcpn-c .mcpn-btn{padding:5px 10px;min-height:32px;font-size:12px}
@media (max-width:520px){.mcpn-btns .mcpn-btn{flex:1 1 100%}}
`;

export default function PhoneNotifications({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'good' | 'bad' | 'plain' } | null>(null);

  const read = useCallback(async () => { setState(pushState(await detectPushEnv())); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void read(); }, 0);
    const h = () => { void read(); };
    window.addEventListener(PUSH_CHANGED_EVENT, h);
    document.addEventListener('visibilitychange', h);   // e.g. back from the phone's Settings app
    return () => { window.clearTimeout(t); window.removeEventListener(PUSH_CHANGED_EVENT, h); document.removeEventListener('visibilitychange', h); };
  }, [read]);

  const on = async () => {
    setBusy('on'); setNote(null);
    const r = await turnOnPush();
    setBusy(null); setState(r.state); setNote({ text: r.message, tone: r.ok ? 'good' : 'bad' });
  };
  const off = async () => {
    setBusy('off'); setNote(null);
    const r = await turnOffPush();
    setBusy(null); setNote({ text: r.message, tone: 'plain' }); void read();
  };
  const test = async () => {
    setBusy('test'); setNote(null);
    const r = await sendTestPush();
    setBusy(null); setNote({ text: r.text, tone: r.ok ? 'good' : 'bad' });
  };

  const t = pushStateText(state);
  const canTurnOn = state === 'off';
  const buttons = (
    <>
      {canTurnOn && <button type="button" className="mcpn-btn pri" disabled={!!busy} onClick={() => void on()}>{busy === 'on' ? 'Turning on…' : 'Turn on'}</button>}
      {state === 'blocked' && <button type="button" className="mcpn-btn" disabled={!!busy} onClick={() => void read()}>I changed it — check again</button>}
      {state === 'on' && <button type="button" className="mcpn-btn pri" disabled={!!busy} onClick={() => void test()}>{busy === 'test' ? 'Sending…' : 'Send test to my phone'}</button>}
      {state === 'on' && <button type="button" className="mcpn-btn" disabled={!!busy} onClick={() => void off()}>{busy === 'off' ? 'Turning off…' : 'Turn off'}</button>}
    </>
  );

  if (compact) {
    return (
      <div className="mcpn-c">
        <style>{CSS}</style>
        <span className="mcpn-dot" style={{ background: DOT[state] }} aria-hidden />
        <span style={{ fontWeight: 700 }}>📱 Phone:</span>
        <span style={{ color: '#374151' }}>{state === 'on' ? 'on' : state === 'off' ? 'off' : t.title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canTurnOn ? <button type="button" className="mcpn-btn pri" disabled={!!busy} onClick={() => void on()}>{busy === 'on' ? '…' : 'Turn on'}</button>
            : state === 'on' ? <button type="button" className="mcpn-btn" disabled={!!busy} onClick={() => void test()}>{busy === 'test' ? '…' : 'Test'}</button>
            : <a href="/price-alerts#phone" style={{ color: '#2563eb', fontWeight: 700 }}>How?</a>}
        </span>
        {note && <div className={`mcpn-note ${note.tone === 'bad' ? 'bad' : note.tone === 'good' ? 'good' : ''}`} style={{ flexBasis: '100%', marginTop: 4 }} role="status">{note.text}</div>}
      </div>
    );
  }

  return (
    <section id="phone" className={`mcpn${state === 'on' ? ' on' : ''}`} aria-labelledby="mcpn-title">
      <style>{CSS}</style>
      <h2 id="mcpn-title">📱 Phone notifications <span className="mcpn-dot" style={{ background: DOT[state] }} aria-hidden /> <span className="mcpn-state">{t.title}</span></h2>
      {t.detail && <p className="mcpn-detail">{t.detail}</p>}
      {state === 'ios-install' && (
        <ol className="mcpn-steps">
          {IOS_INSTALL_STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}
      {state !== 'checking' && state !== 'ios-install' && state !== 'unsupported' && (
        <p className="mcpn-detail">Turn this on once on each phone or computer you want alerts on. Each device is remembered separately.</p>
      )}
      <div className="mcpn-btns">{buttons}</div>
      {note && <div className={`mcpn-note ${note.tone === 'bad' ? 'bad' : note.tone === 'good' ? 'good' : ''}`} role="status">{note.text}</div>}
    </section>
  );
}
