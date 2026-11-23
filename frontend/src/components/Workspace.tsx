'use client';
// ═══════════════════════════════════════════════════════════════════════════
// WORKSPACE (zzz1296) — one page that holds several tools as tabs.
//
// Pages that did the same job were spread over many addresses (four alert pages, four valuation pages, seven simulators).
// A workspace keeps every one of them, unchanged, as a tab of ONE page: each tab is the existing page module loaded on
// demand, so no feature is lost and nothing is re-written. The old addresses forward here (lib/page-merges + proxy).
//
//   · the tab lives in the address (?view=…, or ?tab=… on pages that always used it), so refresh / bookmarks keep it
//   · other address values (?theme=, ?ticker=, ?p= …) are left alone — the tools read them as before
//   · a tool that rewrites the address without ?view= keeps its tab (the current one is put back)
//   · `keep` tabs stay mounted once opened (calculators keep their inputs); live tabs unmount (no hidden polling)
// ═══════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface WorkspaceTab {
  id: string;
  label: string;
  /** one plain line: what this tab is for */
  hint: string;
  C: ComponentType;
  /** stay mounted after the first visit (inputs kept when switching) */
  keep?: boolean;
  /** open this tab when the address carries one of these values and no tab is named (old deep links) */
  when?: string[];
}

export default function Workspace({ title, blurb, tabs, param = 'view' }: { title: string; blurb: string; tabs: WorkspaceTab[]; param?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname() || '/';
  const ids = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);
  const fromUrl = (): string | null => {
    const v = sp?.get(param);
    if (v && ids.has(v)) return v;
    for (const t of tabs) if (t.when?.some((k) => sp?.has(k))) return t.id;
    return null;
  };
  const [active, setActive] = useState<string>(() => fromUrl() || tabs[0].id);
  const [seen, setSeen] = useState<Set<string>>(() => new Set([active]));
  const activeRef = useRef(active);
  activeRef.current = active;

  // address → tab (a link to another tab of this page); address without a tab → put the current one back
  useEffect(() => {
    const v = sp?.get(param);
    if (v && ids.has(v)) { if (v !== activeRef.current) setActive(v); return; }
    const q = new URLSearchParams(sp?.toString() || '');
    q.set(param, activeRef.current);
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  }, [sp, param, ids, path, router]);

  const open = (id: string) => {
    if (id === active) return;
    setActive(id);
    setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
    // a new tab starts clean: the other tab's own address values (filters, ticker…) would confuse it
    router.replace(`${path}?${param}=${encodeURIComponent(id)}`, { scroll: false });
  };
  useEffect(() => { setSeen((s) => (s.has(active) ? s : new Set(s).add(active))); }, [active]);

  const cur = tabs.find((t) => t.id === active) || tabs[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div data-testid="workspace-tabs" style={{ background: 'var(--mc-bg-1)', borderBottom: '1px solid var(--mc-border-1)', padding: '10px 16px 8px', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--mc-text-1)' }}>{title}</h1>
          <span style={{ fontSize: 12.5, color: 'var(--mc-text-3)' }}>{blurb}</span>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button key={t.id} role="tab" aria-selected={on} title={t.hint} onClick={() => open(t.id)} style={{
                whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 13, fontWeight: on ? 900 : 700, padding: '5px 12px', borderRadius: 8,
                border: `1px solid ${on ? 'var(--mc-cyan)' : 'var(--mc-border-2)'}`, color: on ? 'var(--mc-cyan)' : 'var(--mc-text-2)',
                background: on ? 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)' : 'transparent',
              }}>{t.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>{cur.hint}</div>
      </div>
      <div style={{ flex: 1 }}>
        {tabs.map((t) => {
          const show = t.id === active;
          if (!show && !(t.keep && seen.has(t.id))) return null;
          return (
            <div key={t.id} role="tabpanel" hidden={!show} style={{ display: show ? 'block' : 'none' }}>
              <Suspense fallback={<div style={{ padding: 24, color: 'var(--mc-text-4)', fontSize: 12 }}>Loading {t.label}…</div>}>
                <t.C />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Loading line for next/dynamic tabs. */
export function TabLoading({ label }: { label: string }) {
  return <div style={{ padding: 24, color: 'var(--mc-text-4)', fontSize: 12 }}>Loading {label}…</div>;
}
