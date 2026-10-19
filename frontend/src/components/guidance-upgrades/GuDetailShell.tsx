'use client';
// zzz1112 (guidance audit G01) — opening an event never crashes the page. A list row is LEAN (gu-lean drops the detail-only
// fields: chain, risks, evidenceGaps …); the full detail panel is shown only once the full record has arrived and passed a shape
// check. Until then a small drawer says "Loading …" (with a 20 s deadline), or "Could not load" with Retry. Any error inside the
// detail is caught here and shown in the drawer — the list, filters and the rest of the page keep working.
import React from 'react';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { GuDetail } from './GuDetail';
import { R } from './gu-tokens';
import { btn } from './GuBits';

import { normalizeFullEvent, type DetailLoad } from './detail-normalize';
export { normalizeFullEvent, type DetailLoad };

class DetailBoundary extends React.Component<{ resetKey: string; onClose: () => void; children: React.ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String((e as any)?.message || e) }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return <Shell title="This detail could not be shown" onClose={this.props.onClose}>
      <div role="alert" style={{ fontSize: 13 }}>Something in this company&apos;s detail is missing or malformed ({this.state.err}). The list and filters still work.</div>
    </Shell>;
  }
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="gu-drawer" role="dialog" aria-label={title} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px,100vw)', overflowY: 'auto', zIndex: 60,
      background: R.bg, color: R.text, borderLeft: `1px solid ${R.border}`, padding: 16, boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 16 }}>{title}</b>
        <button type="button" style={{ ...btn(), marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      {children}
    </aside>
  );
}

export function GuDetailShell({ lean, load, onClose, onRetry, now }: { lean: GuidanceEvent; load: DetailLoad | undefined; onClose: () => void; onRetry: () => void; now: Date }) {
  React.useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const name = `${lean.company}`;
  if (!load || load.status === 'loading') return <Shell title={name} onClose={onClose}><div role="status" style={{ fontSize: 13, color: R.dim }}>Loading the full check for {name} …</div></Shell>;
  if (load.status === 'error') return (
    <Shell title={name} onClose={onClose}>
      <div role="alert" style={{ fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>The full detail could not be loaded ({load.text}). The list still works.</span>
        <button type="button" style={btn(R.cyan, true)} onClick={onRetry}>Retry</button>
      </div>
    </Shell>
  );
  return <DetailBoundary resetKey={load.event.guidance_event_id} onClose={onClose}><GuDetail e={load.event} onClose={onClose} now={now} /></DetailBoundary>;
}
