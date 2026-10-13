'use client';
// zzz1006 — "Manage list": renaming, sections, import / export and deleting live here, apart from daily chart review. Every action
// uses the same list operations as before (renameList, addSection, patchSection, removeSection, serializeTradingView, removeList).
import { useEffect, useRef, useState } from 'react';
import {
  addList, addSection, listCount, patchSection, removeList, removeSection, renameList, serializeTradingView, updateList,
  type WlList, type WlStore,
} from '@/lib/chart-watchlist';
import { displaySectionName } from '@/lib/watchlist-display';

export default function WatchlistManageDrawer({ store, list, update, onClose, onImport, onExport, say }: {
  store: WlStore; list: WlList; update: (fn: (s: WlStore) => WlStore) => void; onClose: () => void;
  onImport: () => void; onExport: () => void; say: (m: string) => void;
}) {
  const setList = (fn: (l: WlList) => WlList) => update((s) => updateList(s, list.id, fn));
  const [name, setName] = useState(list.name);
  const [newSec, setNewSec] = useState('');
  const [secNames, setSecNames] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  const commitName = () => { const n = name.trim(); if (n && n !== list.name) { setList((l) => renameList(l, n)); say(`Renamed to “${n}”.`); } };
  const commitSec = (id: string, raw: string) => {
    const n = (secNames[id] ?? raw).trim();
    if (n && n !== raw) setList((l) => patchSection(l, id, { name: n }));
    setSecNames((m) => { const { [id]: _drop, ...rest } = m; return rest; });
  };
  return (
    <div ref={ref} className="mcwl-drawer" role="dialog" aria-modal="true" aria-label="Manage list" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="mcwl-bar" style={{ height: 44, borderBottom: '1px solid var(--mc-border-3)' }}>
        <h3 style={{ flex: 1 }}>Manage list</h3>
        <button type="button" className="mcwl-btn on" onClick={onClose}>Done</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div className="grp">
          <label className="lab" htmlFor="mcwl-list-name">List name</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="mcwl-list-name" className="mcwl-input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }} />
          </div>
          <span className="lab">{listCount(list)} symbols in {list.sections.length} section{list.sections.length === 1 ? '' : 's'}</span>
        </div>
        <div className="grp">
          <span className="lab">Sections — the list shows them with readable capitals; the saved names stay as typed</span>
          {list.sections.map((sec) => (
            <div key={sec.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 6, alignItems: 'center' }}>
              <input className="mcwl-input" aria-label={`Section name ${sec.name || '(no name)'}`} value={secNames[sec.id] ?? sec.name} placeholder="(no section name)"
                onChange={(e) => setSecNames((m) => ({ ...m, [sec.id]: e.target.value }))} onBlur={() => commitSec(sec.id, sec.name)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSec(sec.id, sec.name); }} title={sec.name ? `Shown as “${displaySectionName(sec.name)}”` : undefined} />
              <span className="lab" style={{ fontVariantNumeric: 'tabular-nums' }}>{sec.items.length}</span>
              {list.sections.length > 1 ? (
                <button type="button" className="mcwl-ib" aria-label={`Remove section ${sec.name || '(no name)'}`} title="Remove this section — its symbols move to the section next to it"
                  onClick={() => { if (window.confirm(`Remove the section “${sec.name || '(no name)'}”? Its symbols move to the section next to it.`)) setList((l) => removeSection(l, sec.id)); }}>Remove</button>
              ) : <span />}
            </div>
          ))}
          <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); const n = newSec.trim(); if (n) { setList((l) => addSection(l, n)); setNewSec(''); } }}>
            <input className="mcwl-input" style={{ flex: 1 }} aria-label="New section name" placeholder="New section name" value={newSec} onChange={(e) => setNewSec(e.target.value)} />
            <button type="submit" className="mcwl-btn" disabled={!newSec.trim()}>Add section</button>
          </form>
        </div>
        <div className="grp">
          <span className="lab">Import and export (TradingView’s list format)</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="mcwl-btn" onClick={onImport}>Import (TradingView list)…</button>
            <button type="button" className="mcwl-btn" onClick={onExport}>Export as .txt</button>
            <button type="button" className="mcwl-btn" onClick={() => {
              navigator.clipboard?.writeText(serializeTradingView(list)).then(() => say('Copied — paste it into TradingView’s “Import list”.'), () => say('Copy did not work in this browser — use Export instead.'));
            }}>Copy as TradingView list</button>
          </div>
        </div>
        <div className="grp">
          <span className="lab">Lists</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="mcwl-btn" onClick={() => { const n = window.prompt('Name for the new list:', 'New list'); if (n && n.trim()) { update((s) => addList(s, n)); onClose(); } }}>New list</button>
            <button type="button" className="mcwl-btn" style={{ color: 'var(--mc-bearish, #DC2626)' }} disabled={store.lists.length < 1}
              onClick={() => { if (window.confirm(`Delete the list “${list.name}” (${listCount(list)} symbols)?`)) { update((s) => removeList(s, list.id)); onClose(); } }}>Delete list</button>
          </div>
        </div>
      </div>
    </div>
  );
}
