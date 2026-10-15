'use client';
// zzz1054 — "Create alert on …" dialog, modelled on TradingView's: target (one ticker or a whole list), conditions (AND,
// "+ Add condition"), interval, trigger, session, expiration, message, notifications. White / light, plain English.
// Saving waits for the server's answer: the dialog closes only when the alert is really saved.
import { useEffect, useMemo, useState } from 'react';
import {
  COND_TYPES, MA_LENGTHS, DEFAULT_MESSAGE, DEFAULT_EXPIRY_DAYS, condLabel, valueRange, targetKindLabel, toMid, parseMid,
  type AlertCondition, type AlertTarget, type CondType, type PriceAlert, type TargetKind, type AlertInput,
} from '@/lib/alerts/types';
import { renderMessage } from '@/lib/alerts/trigger';
import { createAlertApi, updateAlertApi, loadChannels } from '@/lib/alerts/client';

export interface ChartListOption { id: string; name: string; count: number }
export interface CreateAlertDialogProps {
  onClose: () => void;
  onSaved?: (a: PriceAlert) => void;
  /** pre-selected target (a list, or one ticker) */
  initialTarget?: AlertTarget;
  /** the /charts watchlists, so a chart list can be picked */
  chartLists?: ChartListOption[];
  /** the ticker on screen (offered as "This ticker") */
  currentTicker?: { m: 'IN' | 'US'; t: string; x?: string } | null;
  /** edit an existing alert */
  editing?: PriceAlert | null;
}

const TYPE_GROUPS: Array<{ label: string; types: CondType[] }> = [
  { label: 'Price', types: ['price_cross', 'price_cross_up', 'price_cross_down', 'price_above', 'price_below'] },
  { label: 'Move', types: ['move_up_pct', 'move_down_pct', 'gap_up', 'gap_down'] },
  { label: 'Trend', types: ['ma_cross', 'ma_cross_up', 'ma_cross_down', 'high_52w', 'low_52w', 'near_52w_high'] },
  { label: 'Volume / momentum', types: ['rel_volume', 'rsi_cross_up', 'rsi_cross_down'] },
];
const TYPE_NAME: Record<CondType, string> = {
  price_cross: 'Price — crossing', price_cross_up: 'Price — crossing up', price_cross_down: 'Price — crossing down',
  price_above: 'Price — greater than', price_below: 'Price — less than',
  move_up_pct: 'Moving up %', move_down_pct: 'Moving down %', gap_up: 'Gap up % at the open', gap_down: 'Gap down % at the open',
  ma_cross: 'Price crossing a moving average', ma_cross_up: 'Price crossing up a moving average', ma_cross_down: 'Price crossing down a moving average',
  high_52w: 'New 52-week high', low_52w: 'New 52-week low', near_52w_high: 'Within % of the 52-week high',
  rel_volume: 'Volume ≥ × 50-day average', rsi_cross_up: 'RSI(14) crossing up', rsi_cross_down: 'RSI(14) crossing down',
};
const DEFAULT_VALUE: Partial<Record<CondType, number>> = { move_up_pct: 1, move_down_pct: 1, gap_up: 3, gap_down: 3, rel_volume: 2, rsi_cross_up: 70, rsi_cross_down: 30, near_52w_high: 5 };
const UNIT: Partial<Record<CondType, string>> = { move_up_pct: '%', move_down_pct: '%', gap_up: '%', gap_down: '%', rel_volume: '×', near_52w_high: '%' };

function defaultCond(type: CondType): AlertCondition {
  const c: AlertCondition = { type };
  if (valueRange(type)) c.value = DEFAULT_VALUE[type];
  if (type === 'move_up_pct' || type === 'move_down_pct') c.bars = 1;
  if (type.startsWith('ma_')) { c.ma = 'SMA'; c.len = 50; }
  return c;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const targetValue = (t: AlertTarget) => (t.kind === 'chart-list' ? `chart-list:${t.id}` : t.kind);

const CSS = `
.mcpa-back{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
.mcpa{background:#fff;color:#111827;border-radius:12px;width:100%;max-width:560px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-size:14px}
.mcpa h2{margin:0;font-size:17px;font-weight:700}
.mcpa-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e5e7eb}
.mcpa-body{padding:16px 20px;display:grid;gap:14px}
.mcpa-row{display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:start}
.mcpa-row>label,.mcpa-lab{color:#4b5563;font-weight:600;padding-top:7px}
.mcpa input,.mcpa select,.mcpa textarea{border:1px solid #d1d5db;border-radius:8px;padding:6px 8px;font-size:14px;background:#fff;color:#111827;min-width:0}
.mcpa input:focus,.mcpa select:focus,.mcpa textarea:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb}
.mcpa-cond{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb}
.mcpa-cond select{max-width:100%}
.mcpa-num{width:90px}
.mcpa-x{border:none;background:none;color:#6b7280;cursor:pointer;font-size:16px;margin-left:auto}
.mcpa-link{border:none;background:none;color:#2563eb;cursor:pointer;font-weight:600;padding:4px 0;text-align:left}
.mcpa-seg{display:inline-flex;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;flex-wrap:wrap}
.mcpa-seg button{border:none;background:#fff;padding:6px 10px;cursor:pointer;color:#374151;font-size:13px}
.mcpa-seg button[aria-pressed=true]{background:#2563eb;color:#fff}
.mcpa-hint{color:#6b7280;font-size:12px;line-height:1.4}
.mcpa-checks{display:flex;flex-wrap:wrap;gap:12px}
.mcpa-checks label{display:flex;gap:6px;align-items:center;color:#111827;font-weight:500}
.mcpa-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #e5e7eb;align-items:center}
.mcpa-btn{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:600}
.mcpa-btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.mcpa-btn:disabled{opacity:.6;cursor:default}
.mcpa-err{color:#b91c1c;font-size:13px;margin-right:auto}
.mcpa-prev{background:#f3f4f6;border-radius:6px;padding:6px 8px;font-size:12px;color:#374151}
@media (max-width:520px){.mcpa-row{grid-template-columns:1fr}.mcpa-row>label{padding-top:0}}
`;

export default function CreateAlertDialog({ onClose, onSaved, initialTarget, chartLists = [], currentTicker, editing }: CreateAlertDialogProps) {
  const curMid = currentTicker ? toMid(currentTicker.m, currentTicker.t, currentTicker.x) : null;
  const startTarget: AlertTarget = editing?.target || initialTarget || (curMid ? { kind: 'ticker', id: curMid } : chartLists[0] ? { kind: 'chart-list', id: chartLists[0].id, label: chartLists[0].name } : { kind: 'watchlist' });
  const [target, setTarget] = useState<AlertTarget>(startTarget);
  const [tickerText, setTickerText] = useState(() => (startTarget.kind === 'ticker' ? parseMid(startTarget.id)?.ticker || '' : currentTicker?.t || ''));
  const [tickerMkt, setTickerMkt] = useState<'IN' | 'US'>(() => (startTarget.kind === 'ticker' ? parseMid(startTarget.id)?.market || 'IN' : currentTicker?.m || 'IN'));
  const [conds, setConds] = useState<AlertCondition[]>(editing?.conditions || [defaultCond('move_up_pct')]);
  const [interval, setInterval_] = useState<'D' | 'W'>(editing?.interval || 'D');
  const [trigger, setTrigger] = useState(editing?.trigger || 'per_bar');
  const [session, setSession] = useState(editing?.session || 'regular');
  const [openEnded, setOpenEnded] = useState(editing ? editing.expiresAt == null : false);
  const [expiry, setExpiry] = useState(() => editing?.expiresAt ? editing.expiresAt.slice(0, 10) : ymd(new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000)));
  const [message, setMessage] = useState(editing?.message || DEFAULT_MESSAGE);
  const [name, setName] = useState(editing?.name || '');
  const [notify, setNotify] = useState(editing?.notify || { app: true as const, toast: true, browser: false, telegram: false, email: false });
  const [channels, setChannels] = useState<{ telegram: boolean; email: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // zzz1062 — a NEW alert ticks Telegram / email by default when that channel is set up on the server (edits keep their choice).
  useEffect(() => {
    void loadChannels().then((c) => {
      setChannels(c);
      if (c && !editing) setNotify((n) => ({ ...n, telegram: n.telegram || c.telegram, email: n.email || c.email }));
    });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const effectiveTarget: AlertTarget | null = useMemo(() => {
    if (target.kind !== 'ticker') return target;
    const mid = toMid(tickerMkt, tickerText);
    return mid ? { kind: 'ticker', id: mid, label: parseMid(mid)?.ticker } : null;
  }, [target, tickerMkt, tickerText]);

  const condText = conds.map((c) => condLabel(c, interval)).join(' and ');
  const previewTicker = effectiveTarget?.kind === 'ticker' ? parseMid(effectiveTarget.id)?.ticker || 'HAL' : 'HAL';
  const preview = renderMessage(message, { ticker: previewTicker, name: null, price: null, change: null, condition: condText, list: effectiveTarget?.kind === 'ticker' ? null : effectiveTarget?.label || targetKindLabel(target.kind), time: new Date(), interval, exchange: tickerMkt === 'US' ? 'US' : 'NSE', market: tickerMkt });

  const onTargetChange = (v: string) => {
    if (v.startsWith('chart-list:')) { const id = v.slice(11); setTarget({ kind: 'chart-list', id, label: chartLists.find((l) => l.id === id)?.name }); }
    else setTarget({ kind: v as TargetKind, label: targetKindLabel(v as TargetKind) });
  };
  const patch = (i: number, p: Partial<AlertCondition>) => setConds((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));

  async function save() {
    setErr(null);
    if (!effectiveTarget) { setErr('Enter a valid ticker (India: NSE symbol or BSE code; USA: symbol).'); return; }
    const input: AlertInput = {
      name: name.trim(), target: effectiveTarget, conditions: conds, interval, trigger, session,
      expiresAt: openEnded ? null : new Date(`${expiry}T23:59:00`).toISOString(), message, notify,
    };
    setSaving(true);
    const r = editing ? await updateAlertApi(editing.id, editing.version, input) : await createAlertApi(input);
    setSaving(false);
    if (!r.ok || !r.alert) {
      setErr(r.conflict ? 'This alert was changed in another tab — close and reopen it, then save again.' : r.error || 'Not saved.');
      return;
    }
    onSaved?.(r.alert);
    onClose();
  }

  const askBrowser = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
    setNotify((n) => ({ ...n, browser: on }));
  };

  return (
    <div className="mcpa-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="mcpa" role="dialog" aria-modal="true" aria-labelledby="mcpa-title">
        <div className="mcpa-head">
          <h2 id="mcpa-title">{editing ? 'Edit alert' : 'Create alert'}</h2>
          <button type="button" className="mcpa-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="mcpa-body">
          <div className="mcpa-row">
            <label htmlFor="mcpa-target">Create alert on</label>
            <div style={{ display: 'grid', gap: 6 }}>
              <select id="mcpa-target" value={targetValue(target)} onChange={(e) => onTargetChange(e.target.value)}>
                <option value="ticker">One ticker{curMid ? ` (${currentTicker!.t})` : ''}</option>
                {chartLists.length > 0 && <optgroup label="Chart watchlists">{chartLists.map((l) => <option key={l.id} value={`chart-list:${l.id}`}>{l.name} ({l.count})</option>)}</optgroup>}
                <optgroup label="Other lists">
                  {(['watchlist', 'book-in', 'book-us', 'cb-in', 'cb-us'] as TargetKind[]).map((k) => <option key={k} value={k}>{targetKindLabel(k)}</option>)}
                </optgroup>
              </select>
              {target.kind === 'ticker' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select aria-label="Market" value={tickerMkt} onChange={(e) => setTickerMkt(e.target.value as 'IN' | 'US')}><option value="IN">India</option><option value="US">USA</option></select>
                  <input aria-label="Ticker" value={tickerText} onChange={(e) => setTickerText(e.target.value.toUpperCase())} placeholder={tickerMkt === 'IN' ? 'HAL' : 'NVDA'} style={{ flex: 1 }} />
                </div>
              ) : (
                <span className="mcpa-hint">A list alert follows the list as it is at each check: tickers you add later are watched too, removed ones stop.</span>
              )}
            </div>
          </div>

          <div className="mcpa-row">
            <span className="mcpa-lab">Condition{conds.length > 1 ? 's (all)' : ''}</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {conds.map((c, i) => {
                const range = valueRange(c.type);
                return (
                  <div className="mcpa-cond" key={i}>
                    <select aria-label={`Condition ${i + 1}`} value={c.type} onChange={(e) => setConds((cs) => cs.map((x, k) => (k === i ? defaultCond(e.target.value as CondType) : x)))}>
                      {TYPE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.types.filter((t) => COND_TYPES.includes(t)).map((t) => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}</optgroup>)}
                    </select>
                    {c.type.startsWith('ma_') && (<>
                      <select aria-label="Average type" value={c.ma} onChange={(e) => patch(i, { ma: e.target.value as 'SMA' | 'EMA' })}><option>SMA</option><option>EMA</option></select>
                      <select aria-label="Average length" value={c.len} onChange={(e) => patch(i, { len: Number(e.target.value) as AlertCondition['len'] })}>{MA_LENGTHS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                    </>)}
                    {range && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input className="mcpa-num" type="number" inputMode="decimal" step="any" min={range[0]} max={range[1]} aria-label="Value" value={c.value ?? ''} onChange={(e) => patch(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      {UNIT[c.type] && <span>{UNIT[c.type]}</span>}
                    </span>)}
                    {(c.type === 'move_up_pct' || c.type === 'move_down_pct') && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      in <input className="mcpa-num" style={{ width: 60 }} type="number" min={1} max={50} step={1} aria-label="Bars" value={c.bars ?? 1} onChange={(e) => patch(i, { bars: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /> {interval === 'W' ? 'week(s)' : 'bar(s)'}
                    </span>)}
                    {conds.length > 1 && <button type="button" className="mcpa-x" aria-label={`Remove condition ${i + 1}`} onClick={() => setConds((cs) => cs.filter((_, k) => k !== i))}>✕</button>}
                  </div>
                );
              })}
              {conds.length < 5 && <button type="button" className="mcpa-link" onClick={() => setConds((cs) => [...cs, defaultCond('price_above')])}>+ Add condition</button>}
              <span className="mcpa-hint">{condText}. Moving averages, RSI, 52-week and volume use daily bars with today&apos;s live price as the current bar. &ldquo;1 bar&rdquo; on 1 day = since the previous close.</span>
            </div>
          </div>

          <div className="mcpa-row">
            <span className="mcpa-lab">Interval</span>
            <div className="mcpa-seg" role="group" aria-label="Interval">
              <button type="button" aria-pressed={interval === 'D'} onClick={() => setInterval_('D')}>1 day</button>
              <button type="button" aria-pressed={interval === 'W'} onClick={() => setInterval_('W')}>1 week</button>
            </div>
          </div>
          <div className="mcpa-row">
            <span className="mcpa-lab">Trigger</span>
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="mcpa-seg" role="group" aria-label="Trigger">
                <button type="button" aria-pressed={trigger === 'once'} onClick={() => setTrigger('once')}>Only once</button>
                <button type="button" aria-pressed={trigger === 'per_bar'} onClick={() => setTrigger('per_bar')}>Once per bar</button>
                <button type="button" aria-pressed={trigger === 'per_minute'} onClick={() => setTrigger('per_minute')}>Once per minute</button>
              </div>
              <span className="mcpa-hint">Counted per ticker. {trigger === 'once' ? 'Each ticker fires once; a one-ticker alert then stops.' : trigger === 'per_bar' ? `At most once per ${interval === 'W' ? 'week' : 'day'} per ticker.` : 'At most once a minute per ticker while it stays true.'}</span>
            </div>
          </div>
          <div className="mcpa-row">
            <span className="mcpa-lab">Session</span>
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="mcpa-seg" role="group" aria-label="Session">
                <button type="button" aria-pressed={session === 'regular'} onClick={() => setSession('regular')}>Regular</button>
                <button type="button" aria-pressed={session === 'extended'} onClick={() => setSession('extended')}>Extended</button>
              </div>
              <span className="mcpa-hint">Regular: NSE 09:15–15:30 IST, US 09:30–16:00 New York. Extended: NSE 09:00–16:00, US 04:00–20:00 (pre / after-hours prices). Exchange holidays are skipped.</span>
            </div>
          </div>
          <div className="mcpa-row">
            <label htmlFor="mcpa-exp">Expiration</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input id="mcpa-exp" type="date" value={expiry} disabled={openEnded} min={ymd(new Date())} onChange={(e) => setExpiry(e.target.value)} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} /> Open-ended</label>
            </div>
          </div>
          <div className="mcpa-row">
            <label htmlFor="mcpa-name">Name</label>
            <input id="mcpa-name" value={name} maxLength={80} placeholder="(optional — made from the target and conditions)" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="mcpa-row">
            <label htmlFor="mcpa-msg">Message</label>
            <div style={{ display: 'grid', gap: 4 }}>
              <textarea id="mcpa-msg" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
              <span className="mcpa-hint">Placeholders: {'{{ticker}} {{name}} {{price}} {{change}} {{condition}} {{list}} {{time}} {{interval}} {{exchange}}'}</span>
              <span className="mcpa-prev" aria-label="Message preview">{preview}</span>
            </div>
          </div>
          <div className="mcpa-row">
            <span className="mcpa-lab">Notifications</span>
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="mcpa-checks">
                <label><input type="checkbox" checked disabled /> In app</label>
                <label><input type="checkbox" checked={notify.toast} onChange={(e) => setNotify((n) => ({ ...n, toast: e.target.checked }))} /> Toast</label>
                <label><input type="checkbox" checked={notify.browser} onChange={(e) => void askBrowser(e.target.checked)} /> Browser</label>
                <label><input type="checkbox" checked={notify.telegram} onChange={(e) => setNotify((n) => ({ ...n, telegram: e.target.checked }))} /> Telegram</label>
                <label><input type="checkbox" checked={notify.email} onChange={(e) => setNotify((n) => ({ ...n, email: e.target.checked }))} /> Email</label>
              </div>
              {channels && ((notify.telegram && !channels.telegram) || (notify.email && !channels.email)) && (
                <span className="mcpa-hint" style={{ color: '#b45309' }}>{[notify.telegram && !channels.telegram ? 'Telegram' : '', notify.email && !channels.email ? 'Email' : ''].filter(Boolean).join(' and ')} is not set up on the server yet — the alert still shows in the app.</span>
              )}
              <span className="mcpa-hint">Toast and browser notifications appear while a Market Cockpit tab is open; Telegram / email work with no tab open.</span>
            </div>
          </div>
        </div>
        <div className="mcpa-foot">
          {err && <span className="mcpa-err" role="alert">{err}</span>}
          <button type="button" className="mcpa-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mcpa-btn pri" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
