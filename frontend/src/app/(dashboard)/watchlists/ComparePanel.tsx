'use client';
// zzz1045d — "Compare with chart lists…": a preview of the names only in this list, only in a chart list, and in both, with
// buttons to copy the missing names one way or the other. Nothing is copied until a button is clicked. Sections linked to
// My Book are left out and never written to; holdings are not touched; symbols are copied as they are (no remapping).
import { useMemo, useState } from 'react';
import { CHART_WATCHLISTS_KEY, sanitizeStore, type WlStore } from '@/lib/chart-watchlist';
import { compareWithChartList, chartListSource, defaultCompareListId, planCopyToChart, planCopyToStandalone } from '@/lib/watchlist-compare';
import type { Market } from '@/lib/chart-math';

function readChartStore(): WlStore | null {
  try {
    const raw = window.localStorage.getItem(CHART_WATCHLISTS_KEY);
    return raw ? sanitizeStore(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function ComparePanel({ tickers, marketOf, onAddToStandalone, onClose }: {
  tickers: string[];
  marketOf: (t: string) => Market | undefined;
  onAddToStandalone: (tickers: string[]) => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the chart lists after a copy
  const store = useMemo(() => (typeof window === 'undefined' ? null : readChartStore()), [version]);
  const [listId, setListId] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const list = store ? store.lists.find((l) => l.id === listId) || store.lists.find((l) => l.id === defaultCompareListId(store)) || null : null;
  const cmp = useMemo(() => (list ? compareWithChartList(tickers, list, marketOf) : null), [list, tickers, marketOf]);   // zzz1076 (B01) — by market

  if (!store || !list || !cmp) {
    return (
      <section className="wlp-cmp" aria-label="Compare with chart lists">
        <h3>Compare with chart lists</h3>
        <p style={{ margin: 0 }}>No chart lists in this browser yet. Open Charts once; its watchlist panel starts a “My Watchlist” chart list from this list.</p>
        <div style={{ marginTop: 10 }}><button type="button" className="wlp-btn" onClick={onClose}>Close</button></div>
      </section>
    );
  }

  const toStandalone = planCopyToStandalone(cmp.onlyChart);
  const blocked = cmp.onlyChart.filter((r) => !r.copyable);
  const src = chartListSource(list);

  const copyToStandalone = () => {
    if (!toStandalone.length) return;
    onAddToStandalone(toStandalone);
    setMsg(`Adding ${toStandalone.length} name${toStandalone.length === 1 ? '' : 's'} to this list: ${toStandalone.join(', ')}.`);
  };
  const copyToChart = () => {
    const fresh = readChartStore();   // the latest chart lists (another tab may have changed them)
    if (!fresh) { setMsg('Chart lists could not be read. Nothing was copied.'); return; }
    const r = planCopyToChart(fresh, list.id, cmp.onlyStandalone, marketOf);
    if (!r.added.length) { setMsg(r.skipped.length ? `Nothing copied: ${r.skipped.map((x) => `${x.symbol} (${x.reason})`).join(', ')}.` : 'Nothing to copy.'); return; }
    try { window.localStorage.setItem(CHART_WATCHLISTS_KEY, JSON.stringify(r.store)); }
    catch { setMsg('Not saved: this browser’s storage is full or blocked. Nothing was copied.'); return; }
    setMsg(`Added ${r.added.length} to the chart list “${list.name}”${r.sectionName ? ` (section “${r.sectionName}”)` : ''}: ${r.added.join(', ')}.${r.skipped.length ? ` Skipped: ${r.skipped.map((x) => `${x.symbol} (${x.reason})`).join(', ')}.` : ''}`);
    setVersion((v) => v + 1);
  };

  return (
    <section className="wlp-cmp" aria-label="Compare with chart lists" data-testid="watchlist-compare">
      <h3>Compare with chart lists</h3>
      <p style={{ margin: 0 }}>A preview only. Nothing is copied until you click a button. Symbols are copied exactly as they are, by market (a USA name is written US:X here); sections linked to My Book are left out.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <label htmlFor="wlp-cmp-list" style={{ fontWeight: 600, color: 'var(--mc-text-1)' }}>Chart list</label>
        <select id="wlp-cmp-list" value={list.id} onChange={(e) => { setListId(e.target.value); setMsg(null); }}>
          {store.lists.map((l) => <option key={l.id} value={l.id}>{l.name} — {chartListSource(l).label}</option>)}
        </select>
        <span title={src.detail}>{src.label}</span>
        {cmp.bookSectionsLeftOut > 0 && <span>· {cmp.bookSectionsLeftOut} name{cmp.bookSectionsLeftOut === 1 ? '' : 's'} in My Book sections not compared</span>}
      </div>
      <div className="wlp-cmp-cols">
        <div>
          <h4>Only in this list ({cmp.onlyStandalone.length})</h4>
          <ul aria-label="Only in this list">{cmp.onlyStandalone.map((t) => <li key={t}>{t}</li>)}</ul>
          <button type="button" className="wlp-btn" disabled={!cmp.onlyStandalone.length} onClick={copyToChart}>
            Copy {cmp.onlyStandalone.length} to chart list “{list.name}” →
          </button>
        </div>
        <div>
          <h4>Only in chart list “{list.name}” ({cmp.onlyChart.length})</h4>
          <ul aria-label="Only in the chart list">
            {cmp.onlyChart.map((r) => <li key={r.symbol} className={r.copyable ? undefined : 'off'} title={r.reason}>{r.symbol}{r.copyable ? '' : ' (not copied)'}</li>)}
          </ul>
          <button type="button" className="wlp-btn" disabled={!toStandalone.length} onClick={copyToStandalone}>
            ← Copy {toStandalone.length} to this list
          </button>
          {blocked.length > 0 && <p style={{ margin: '6px 0 0', fontSize: 11.5 }}>{blocked.length} BSE letter symbol{blocked.length === 1 ? '' : 's'} not copied: this list has no exchange field, so it would turn into the NSE symbol.</p>}
        </div>
        <div>
          <h4>In both ({cmp.both.length})</h4>
          <ul aria-label="In both lists">{cmp.both.map((t) => <li key={t}>{t}</li>)}</ul>
          {cmp.unresolved.length > 0 && (<>
            {/* zzz1076 (B01) — a name without a market is never matched or copied by its text alone */}
            <h4 style={{ marginTop: 10 }}>Market unclear ({cmp.unresolved.length})</h4>
            <ul aria-label="Market unclear">{cmp.unresolved.map((u) => <li key={u.symbol} className="off" title={u.reason}>{u.symbol}</li>)}</ul>
            <p style={{ margin: '6px 0 0', fontSize: 11.5 }}>The same symbol can be two companies (NSE:HAL is Hindustan Aeronautics, NYSE:HAL is Halliburton). These are not compared or copied until the market is written: NSE:X or US:X.</p>
          </>)}
        </div>
      </div>
      {msg && <p role="status" style={{ margin: '0 0 8px', color: 'var(--mc-text-1)' }}>{msg}</p>}
      <button type="button" className="wlp-btn" onClick={onClose}>Close</button>
    </section>
  );
}
