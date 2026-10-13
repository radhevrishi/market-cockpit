// zzz1006 — renders the real Stock Screener (JSDOM) on the synthetic snapshot for every built-in screen and records what the owner
// gets out of it: the match line, the table order, the copied tickers and the CSV (hashed). Used once against the page BEFORE the
// redesign (golden file) and by the zzz1006 test against the page after it.
import { createHash } from 'node:crypto';
import { BUILT_IN_SCREENS, SCREENS_KEY } from '../../screener/filters';
import { fixtureRows, FIXED_NOW } from './zzz1006-screener-rows';

export interface ScreenOutput { match: string; order: string[]; copy: string; csv: string; csvRows: number }
export interface Driver {
  /** run Copy tickers on the current screen */
  copy: (h: Helpers) => Promise<void>;
  /** run Download CSV on the current screen */
  csv: (h: Helpers) => Promise<void>;
}
export interface Helpers { act: any; settle: () => Promise<void>; click: (pred: (b: HTMLElement) => boolean) => Promise<void> }

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export async function runScreens(driver: Driver, only?: string[], prefs: Record<string, string> = {}): Promise<Record<string, ScreenOutput>> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/stock-screener', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'Blob', 'Date'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  const clip: string[] = [], blobs: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t: string) => { clip.push(t); } }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: class { constructor(parts: string[]) { blobs.push(parts.join('')); } }, configurable: true, writable: true });
  const oldCreate = (URL as any).createObjectURL, oldRevoke = (URL as any).revokeObjectURL;
  (dom.window as any).URL.createObjectURL = () => 'blob:x'; (dom.window as any).URL.revokeObjectURL = () => {};
  (URL as any).createObjectURL = () => 'blob:x'; (URL as any).revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  (dom.window as any).scrollTo = () => {};
  // a fixed clock: the date filters (this month / last N years) then give the same answer on every day the test runs
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...a: any[]) { if (a.length) super(...(a as [])); else super(FIXED_NOW); } static now() { return FIXED_NOW; } }
  Object.defineProperty(globalThis, 'Date', { value: FixedDate, configurable: true, writable: true });
  const rows = { US: fixtureRows('US'), IN: fixtureRows('IN') };
  (globalThis as any).fetch = async (url: string) => ({ ok: true, json: async () => ({ ok: true, builtAt: '2026-10-12T22:00:00Z', rows: url.includes('market=IN') ? rows.IN : rows.US, notes: ['fixture note'], sources: ['fixture'] }) });
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  const { default: Screener } = await import('../../../components/stock-screener/StockScreener');
  const settle = () => new Promise<void>((r) => setTimeout(r, 15));
  const click = async (pred: (b: HTMLElement) => boolean) => {
    const b = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')).find(pred);
    if (!b) throw new Error('control not found');
    await act(async () => { b.click(); await settle(); });
  };
  const saved = [
    { id: 'all-us', name: 'All fixtures US', market: 'US', filters: [] },
    { id: 'all-in', name: 'All fixtures IN', market: 'IN', filters: [] },
    { id: 'paused-us', name: 'Paused US', market: 'US', filters: [{ kind: 'num', key: 'revQYoY', op: 'gt', v: 25 }, { kind: 'num', key: 'pe', op: 'lt', v: 30, off: true }, { kind: 'cmp', key: 'px', op: 'above', other: 'sma50' }] },
  ];
  const ids = [...BUILT_IN_SCREENS.map((s) => s.id), ...saved.map((s) => s.id)].filter((id) => !only || only.includes(id));
  const out: Record<string, ScreenOutput> = {};
  try {
    for (const id of ids) {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem(SCREENS_KEY, JSON.stringify(saved));
      localStorage.setItem('mc:stock-screener:last:v1', id);
      for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
      const root = createRoot(document.getElementById('root')!);
      await act(async () => { root.render(React.createElement(Screener)); await settle(); });
      const match = (document.body.textContent || '').match(/\d[\d,]* of \d[\d,]* companies match/)?.[0] || '';
      const order = Array.from(document.querySelectorAll('a[title^="Open the chart"]')).map((a) => a.textContent || '');
      clip.length = 0; blobs.length = 0;
      let copy = '', csv = '';
      if (order.length) {
        await driver.copy({ act, settle, click }); copy = clip.at(-1) || '';
        await driver.csv({ act, settle, click }); csv = blobs.at(-1) || '';
      }
      out[id] = { match, order, copy: sha(copy), csv: sha(csv), csvRows: csv ? csv.split('\n').length : 0 };
      await act(async () => { root.unmount(); });
    }
  } finally {
    await new Promise<void>((r) => setTimeout(r, 2800));
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    (URL as any).createObjectURL = oldCreate; (URL as any).revokeObjectURL = oldRevoke;
    dom.window.close();
  }
  return out;
}
