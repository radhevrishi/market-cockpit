'use client';
// zzz841 — the "★ Multibagger Radar" tab body of Special Situations.
//
// Built from the events the feed already carries. Buckets are separate
// sections (never one merged list). Ranked by research value; PRICE IS NEVER
// USED. Research priority is a category with a reason, not a recommendation.
// Where the feed carries no numbers the card says "Not established".

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUCKET_LABEL, BUCKET_ORDER, EVIDENCE_LABEL, KIND_LABEL, PRIORITY_LABEL,
  type CatalystKind, type EvidenceStatus, type LedgerEntry, type RadarBucket, type RadarItem, type ResearchPriority, type ThesisStatus,
} from '@/lib/multibagger-radar-types';
import { buildRadar } from '@/lib/multibagger-radar';
import { splitRadarInputs } from '@/lib/multibagger-radar-adapter';
import type { RadarFeedEvent } from '@/lib/multibagger-radar-feed-types';
import {
  LEDGER_EVENT, LEDGER_KEY, TAGS_KEY, loadLedger, loadTags, removeEntry, saveEntry, setTag, updateStatus, type OwnerTag,
} from '@/lib/multibagger-ledger-store';
import { normSymbol } from '@/lib/portfolio-symbols';
import { readLocalBookInput, fetchSavedHoldings } from '@/lib/thesis/book-sources';
import { BUCKET_MEANING, EVIDENCE_ORDER, KIND_LEGEND, PRIORITY_RANK, QUARANTINE_HEADER, R, box, isOneLine, isQuarantined } from './radar-tokens';
import { Chip, btn, input } from './RadarBits';
import { RadarCard, RadarRow } from './RadarCard';
import { LedgerPanel } from './LedgerPanel';
import { HoldingsMonitor } from './HoldingsMonitor';

type Region = 'ALL' | 'IN' | 'US' | 'GLOBAL';
type SubView = 'radar' | 'holdings' | 'ledger';
const CARD_CAP = 30;
const KINDS = Object.keys(KIND_LABEL) as CatalystKind[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as ResearchPriority[];

/** Holdings the page already has: the Portfolio page's saved list (this browser + server copy). */
function useHoldings(prop?: string[]): { holdings: string[]; loaded: boolean } {
  const [found, setFound] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (prop) return;
    let alive = true;
    (async () => {
      const acc: string[] = [];
      try { acc.push(...(readLocalBookInput().browser || [])); } catch { /* ignore */ }
      try { const s = await fetchSavedHoldings(); if (s.ok) acc.push(...s.symbols); } catch { /* ignore */ }
      if (!alive) return;
      const seen = new Set<string>();
      setFound(acc.filter((x) => { const k = normSymbol(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [prop]);
  if (prop) return { holdings: prop, loaded: true };
  return { holdings: found, loaded };
}

function useLedgerState() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [tags, setTags] = useState<Record<string, OwnerTag>>({});
  const refresh = useCallback(() => { setEntries(loadLedger()); setTags(loadTags()); }, []);
  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === LEDGER_KEY || e.key === TAGS_KEY) refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LEDGER_EVENT, refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(LEDGER_EVENT, refresh); };
  }, [refresh]);
  return { entries, tags, refresh };
}

export interface MultibaggerRadarProps {
  events: ReadonlyArray<RadarFeedEvent>;
  holdings?: string[];
  region?: Region;
  onRegionChange?: (r: Region) => void;
  isLoading?: boolean;
  error?: unknown;
}

export default function MultibaggerRadar({ events, holdings: holdingsProp, region = 'ALL', onRegionChange, isLoading, error }: MultibaggerRadarProps) {
  const { holdings, loaded } = useHoldings(holdingsProp);
  const { entries, tags, refresh } = useLedgerState();
  const [now] = useState(() => new Date().toISOString());
  const [view, setView] = useState<SubView>('radar');
  const [bucketF, setBucketF] = useState<RadarBucket | 'ALL'>('ALL');
  const [minPri, setMinPri] = useState<ResearchPriority | 'ALL'>('ALL');
  const [evF, setEvF] = useState<EvidenceStatus | 'ALL'>('ALL');
  const [kindF, setKindF] = useState<CatalystKind | 'ALL'>('ALL');
  const [heldOnly, setHeldOnly] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const built = useMemo(() => {
    try {
      const split = splitRadarInputs((events || []).filter((e) => region === 'ALL' || (e.region || e.primary_filing?.region) === region));
      return { radar: buildRadar(split.inputs, { holdings }), failed: null as string | null, heldBackLine: split.heldBack?.line || '' };
    } catch (e: any) { return { radar: null, failed: String(e?.message || e), heldBackLine: '' }; }
  }, [events, region, holdings]);

  const heldSet = useMemo(() => new Set(holdings.map(normSymbol)), [holdings]);
  const isHeld = (i: RadarItem) => !!i.ticker && heldSet.has(normSymbol(i.ticker));
  const ledgerIds = useMemo(() => new Set(entries.map((e) => e.id)), [entries]);

  const passes = (i: RadarItem) =>
    (minPri === 'ALL' || PRIORITY_RANK[i.priority] >= PRIORITY_RANK[minPri]) &&
    (evF === 'ALL' || i.evidence.status === evF) &&
    (kindF === 'ALL' || i.kind === kindF) &&
    (!heldOnly || isHeld(i));

  const banner = (
    <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.5, border: `1px solid ${R.border}`, borderRadius: 8, padding: '8px 12px', background: R.bg2 }}>
      Built from filings and headlines in the feed; where the feed has no numbers the card says Not established. Existing Special Situations views are unchanged in the other tabs.
      {built.heldBackLine ? <div style={{ marginTop: 4 }}>{built.heldBackLine}</div> : null}
    </div>
  );
  const footer = <div style={{ fontSize: 11, color: R.faint, textAlign: 'center', padding: '8px 0' }}>Not investment advice. Research priority tells you what to read first. It is not a recommendation.</div>;

  if (isLoading && !(events && events.length)) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{banner}<div style={{ fontSize: 13, color: R.dim }}>Loading the feed...</div>{footer}</div>;
  }
  if (error && !(events && events.length)) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{banner}<div style={{ fontSize: 13, color: R.red }}>The feed could not be loaded. Try again in a moment. Nothing here is a sign about any company.</div>{footer}</div>;
  }
  if (built.failed || !built.radar) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{banner}<div style={{ fontSize: 13, color: R.red }}>The radar could not be built from this feed ({built.failed || 'unknown error'}).</div>{footer}</div>;
  }
  const radar = built.radar;

  const onSave = (e: LedgerEntry) => { saveEntry(e); refresh(); };
  const onStatus = (id: string, to: ThesisStatus, reason: string, extra?: { postMortem?: { detectionFailureWhy?: string; failurePoint?: string } }) => { const r = updateStatus(id, to, reason, new Date(), undefined, extra || {}); refresh(); return r.error; };
  const onTag = (t: string, tag: OwnerTag | null) => { setTag(t, tag); refresh(); };

  const subBtn = (v: SubView, label: string) => (
    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
      style={{ ...btn(view === v ? R.cyan : R.dim, view === v), fontSize: 12, padding: '5px 12px' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {banner}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {subBtn('radar', `Radar (${radar.items.length})`)}
        {subBtn('holdings', 'Your holdings - catalyst monitor')}
        {subBtn('ledger', `Thesis ledger (${entries.length})`)}
      </div>

      {view === 'radar' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Counts per bucket">
            {BUCKET_ORDER.map((b) => (
              <button key={b} type="button" onClick={() => setBucketF(bucketF === b ? 'ALL' : b)} aria-pressed={bucketF === b}
                style={{ ...btn(bucketF === b ? R.cyan : R.dim, bucketF === b), fontSize: 11 }}>
                {BUCKET_LABEL[b]} <b>{(radar.byBucket[b] || []).length}</b>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select aria-label="Minimum research priority" value={minPri} onChange={(e) => setMinPri(e.target.value as any)} style={{ ...input, width: 'auto' }}>
              <option value="ALL">Any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]} or higher</option>)}
            </select>
            <select aria-label="Evidence status" value={evF} onChange={(e) => setEvF(e.target.value as any)} style={{ ...input, width: 'auto' }}>
              <option value="ALL">Any evidence</option>
              {EVIDENCE_ORDER.map((s) => <option key={s} value={s}>{EVIDENCE_LABEL[s]}</option>)}
            </select>
            <select aria-label="Catalyst type" value={kindF} onChange={(e) => setKindF(e.target.value as any)} style={{ ...input, width: 'auto' }}>
              <option value="ALL">Any catalyst type</option>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <select aria-label="Region" value={region} onChange={(e) => onRegionChange?.(e.target.value as Region)} style={{ ...input, width: 'auto' }} disabled={!onRegionChange}>
              <option value="ALL">All regions</option><option value="IN">India</option><option value="US">US</option><option value="GLOBAL">Global</option>
            </select>
            <label style={{ fontSize: 12, color: R.dim, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={heldOnly} onChange={(e) => setHeldOnly(e.target.checked)} /> Holdings only
            </label>
          </div>
          <div style={{ fontSize: 12, color: R.dim }}><b>Ranked by research value - price never used.</b> A price move, volume spike or analyst target never puts a name on this list.</div>

          <details style={{ fontSize: 12, color: R.dim }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Legend: kinds of catalyst</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
              {KIND_LEGEND.map((g) => <div key={g.group}><b>{g.group}:</b> {g.kinds.map((k) => KIND_LABEL[k]).join(', ')}</div>)}
            </div>
          </details>

          {radar.items.length === 0 && (
            <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>
              No events in the feed right now to build a radar from.{' '}
              <a href="/special-situations?tab=all" style={{ color: R.cyan }}>Open All Situations</a>
            </div>
          )}

          {radar.items.length > 0 && BUCKET_ORDER.filter((b) => bucketF === 'ALL' || bucketF === b).map((b) => {
            const all = radar.byBucket[b] || [];
            const list = all.filter(passes);
            const expanded = !!showAll[b];
            const shown = expanded ? list : list.slice(0, CARD_CAP);
            const quarantined = isQuarantined(b);
            const secondary = b === 'SPECIAL_SITUATION';
            const heading = (
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', borderBottom: `1px solid ${R.border}`, paddingBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: quarantined || secondary ? 12 : 14, fontWeight: 900, letterSpacing: 0.4, color: quarantined ? R.dim : R.text, textTransform: 'uppercase' }}>{BUCKET_LABEL[b]}</h3>
                <Chip color={R.dim}>{list.length}{list.length !== all.length ? ` of ${all.length}` : ''}</Chip>
                <span style={{ fontSize: 12, color: R.dim }}>{BUCKET_MEANING[b]}</span>
              </div>
            );
            const body = (
              <>
                {list.length === 0 && <div style={{ fontSize: 12, color: R.faint }}>Nothing here{all.length ? ' with these filters' : ' right now'}.{!all.length && radar.diagnostics && (b === 'BOTTLENECK' || b === 'MULTIBAGGER') ? <span data-radar-empty-reason> {b === 'BOTTLENECK' ? radar.diagnostics.lines.bottleneck : radar.diagnostics.lines.structural}.</span> : null}</div>}
                {shown.map((i) => (isOneLine(i)
                  ? <RadarRow key={i.id} item={i} />
                  : <RadarCard key={i.id} item={i} held={isHeld(i)} ownerTag={i.ticker ? tags[normSymbol(i.ticker)] : undefined} ledgerIds={ledgerIds} onSaveLedger={onSave} now={now} />))}
                {list.length > shown.length && <button type="button" style={btn(R.cyan)} onClick={() => setShowAll((s) => ({ ...s, [b]: true }))}>Show all {list.length}</button>}
              </>
            );
            return (
              <section key={b} data-radar-bucket={b} data-radar-tier={quarantined ? 'quarantine' : secondary ? 'secondary' : 'primary'} aria-label={BUCKET_LABEL[b]} style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: quarantined ? 0.9 : 1 }}>
                {quarantined ? (
                  <details open={bucketF === b}>
                    <summary style={{ cursor: 'pointer', listStyle: 'revert' }}>{heading}</summary>
                    <div style={{ fontSize: 12, color: R.faint, padding: '6px 0' }}>{QUARANTINE_HEADER}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{body}</div>
                  </details>
                ) : (<>{heading}{body}</>)}
              </section>
            );
          })}
          {radar.items.length > 0 && radar.diagnostics && (
            <details data-radar-diagnostics style={{ fontSize: 12, color: R.dim }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Radar diagnostics</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                <div>These lines only explain what was screened. They do not change what is promoted.</div>
                <div>{radar.diagnostics.lines.bottleneck}.</div>
                <div>{radar.diagnostics.lines.structural}.</div>
                <div>{radar.diagnostics.lines.noLink}.</div>
                {radar.diagnostics.bottleneck.examples.length > 0 && <div>Examples: {radar.diagnostics.bottleneck.examples.map((x) => `${x.id} (${x.why})`).join('; ')}</div>}
              </div>
            </details>
          )}
        </>
      )}

      {view === 'holdings' && (
        <HoldingsMonitor holdings={holdings} holdingsLoaded={loaded} items={radar.items} entries={entries} tags={tags} onTag={onTag} sharedDrivers={radar.sharedDrivers} />
      )}
      {view === 'ledger' && (
        <LedgerPanel entries={entries} onEdit={onSave} onDelete={(id) => { removeEntry(id); refresh(); }} onStatus={onStatus} now={now} />
      )}
      {footer}
    </div>
  );
}
