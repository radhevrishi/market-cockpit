'use client';
import ConcallPro from './ConcallPro';
import MultibaggerStrips from './MultibaggerStrips';
// PATCH 1080 — Turnaround scoring view (per-company panel + top-level tab).
import TurnaroundStrips from './TurnaroundStrips';
// PATCH 1080b — pure scorer reused for the top-level Turnaround tab ranking.
import { scoreTurnaround, type TurnaroundResult } from '@/lib/turnaround-scoring';
// PATCH 1081d — Acronym tooltips on table headers (HANDOFF §10 item E).
import { AutoAcronyms } from '@/components/bottom-nav';
// PATCH 1081g — moved from /multibagger page (this tab has the rich Fin series).
import { AssetRichFilter, type AssetRichStock } from '@/components/asset-rich-filter';
import { PromoterRisingFilter, type PromoterFilterRow } from '@/components/promoter-trajectory';
import CapexPlaybook from './CapexPlaybook';

// ════════════════════════════════════════════════════════════════════════════
// CAPEX TRACKER v5.0 — Company Intelligence Engine.
// Four lenses on ONE dataset: capex QUALITY × TIMING (v4.3 engine, untouched)
// + 🚀 MULTIBAGGER DNA (12-component SQGLP-style score from 10y workbook data)
// + 🔬 FORENSICS (12 fraud-checklist checks codified) + 🎙 CONCALL (local
// transcripts, heuristic extraction → one-click apply to the capex engine)
// → 🧭 VERDICT (fused ranked call with forensic veto).
//
// v4.3 core below — QUALITY × TIMING engine.
// QUALITY: "The CAPEX Masterclass" (200 cases) Ch.12 verbatim — 21 weighted
//   factors (100 pts) → industry multiplier → deal-breaker override (3+ of 6
//   ⇒ cap 30) → ANCHOR/CORE/SATELLITE/WATCHLIST/AVOID/REJECT bands.
// TIMING: "Capex-Utilization Multibagger Framework" (~250 cases) — T0→T5
//   inflections, Stage A-F entry classification (Stage C ≈40% util = modal
//   winner entry, 55% of winners; Stage F = documented anti-pattern), sell
//   staircase + mechanical risk rules.
// ENTRY VERDICT = quality band ∩ stage. Screener.in workbooks are mined for
// telemetry + '(est)' fills; rows merge by company and persist locally.
// ════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SectionHead, StageChip, Timeline, CapexStrip, HandbookChip, SignalCards, markText, ScoreRow, ModelTab } from './components';
import { C, F, VERDICT_COLOR, TEMPLATE_HEADERS, TEMPLATE_SAMPLE, KD, KN, KC, KU } from './constants';
import { resolveHeaders, num, scoreRow, parseFin, computeMultibagger } from './helpers';
import { computeForensic, extractConcall } from './helpers2';
import { computeVerdict, parseCSV, loadSheetJS, capTranscript, extractPdfText, extractPptxText, findPeriod, transcriptLabel, matchCompanies, uid, parseScreenerWorkbook } from './helpers3';
import { type Row, type Scored, type ConcallEntry, type CCState } from './types';

// ════════════════════════════════════════════════════════════════════════════
export default function CapexTrackerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tab, setTab] = useState<'board' | 'analytics' | 'multibagger' | 'turnaround' | 'forensics' | 'concall' | 'verdict' | 'model' | 'playbook' | 'concallpro'>('board');
  // PATCH — hydrate tab from the tab URL param (home 🧭 Verdict chip deep link).
  // Mount-effect (not useState initializer) to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && ['board','analytics','multibagger','turnaround','forensics','concall','verdict','model','playbook','concallpro'].includes(p)) setTab(p as any);
    } catch { /* noop */ }
  }, []);
  const [q, setQ] = useState('');
  const [band, setBand] = useState('ALL');
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState('final');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // v5 state
  const [concalls, setConcalls] = useState<Record<string, ConcallEntry[]>>({});
  const [openMB, setOpenMB] = useState<string | null>(null);
  const [openFX, setOpenFX] = useState<string | null>(null);
  const [ccCompany, setCcCompany] = useState('');
  const [ccLabel, setCcLabel] = useState('');
  const [ccText, setCcText] = useState('');
  const [ccView, setCcView] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const ccFileRef = useRef<HTMLInputElement>(null);

  // refs mirror rows/files so multi-file uploads (an awaited loop) never merge
  // against a stale closure — file 2 must see file 1's rows, not the initial state
  const rowsRef = useRef<Row[]>([]);
  const filesRef = useRef<string[]>([]);
  const concallsRef = useRef<Record<string, ConcallEntry[]>>({}); // same staleness guard for transcript batches

  useEffect(() => {
    try {
      const d = localStorage.getItem(KD); const n = localStorage.getItem(KN);
      if (d) { const pr = JSON.parse(d); rowsRef.current = pr; setRows(pr); }
      if (n) { const pf = JSON.parse(n); filesRef.current = pf; setFiles(pf); }
      const cc = localStorage.getItem(KC); if (cc) {
        const pc = JSON.parse(cc);
        // v5.3 — re-extract stored transcripts when the extractor version bumps
        // (old extracts carried bugs like 'from 30% to 65%' reading 30).
        try {
          let changed = false;
          for (const compKey of Object.keys(pc)) {
            const arr = pc[compKey];
            if (!Array.isArray(arr)) continue;
            for (const e of arr) {
              if (e && e.text && (!e.extract || e.extract.__v !== 3)) { e.extract = extractConcall(e.text); changed = true; }
            }
          }
          if (changed) localStorage.setItem(KC, JSON.stringify(pc));
        } catch {}
        concallsRef.current = pc; setConcalls(pc);
      }
    } catch {}
  }, []);

  const persist = (r: Row[], f: string[]) => {
    rowsRef.current = r; filesRef.current = f;
    setRows(r); setFiles(f);
    try { localStorage.setItem(KD, JSON.stringify(r)); localStorage.setItem(KN, JSON.stringify(f)); } catch {}
  };

  const mergeRows = (incoming: Row[], fname: string) => {
    if (!incoming.length) { setMsg('No data rows found in ' + fname); return; }
    const h = resolveHeaders(Object.keys(incoming[0]));
    if (!h['name']) { setMsg('Could not read ' + fname + ': plain tables need a Company Name column (Screener.in Excel exports are auto-detected). Download the template for the flat format.'); return; }
    const key = (r: Row, hh: Record<string, string>) => (r[hh['name']] || '').trim().toLowerCase();
    const merged = [...rowsRef.current];
    let updated = 0, added = 0;
    for (const inc of incoming) {
      const k = key(inc, h); if (!k) continue;
      const idx = merged.findIndex((r) => key(r, resolveHeaders(Object.keys(r))) === k);
      if (idx >= 0) {
        // field-level merge: incoming non-empty overwrites (so a re-upload of
        // the same workbook regenerates telemetry); manual inputs survive
        // because the parser never emits clean qualitative headers.
        const patch = Object.fromEntries(Object.entries(inc).filter(([, v]) => String(v ?? '').trim() !== ''));
        merged[idx] = { ...merged[idx], ...patch }; updated++;
      } else { merged.push(inc); added++; }
    }
    persist(merged, [...filesRef.current.filter((f) => f !== fname), fname]);
    setMsg('Loaded ' + fname + ': ' + added + ' added · ' + updated + ' updated · ' + merged.length + ' total (saved — survives reloads)');
  };

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const XLSX = await loadSheetJS();
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
          const screener = parseScreenerWorkbook(XLSX, wb, f.name);
          if (screener) { mergeRows([screener], f.name); continue; }
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json: Row[] = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
          mergeRows(json.map((r) => { const o: Row = {}; Object.keys(r).forEach((k) => { o[String(k).trim()] = String((r as any)[k] ?? '').trim(); }); return o; }), f.name);
        } else if (/\.(pdf|pptx|ppt|txt)$/i.test(f.name)) {
          await onTranscriptFile(f); // concall pipeline — mixed picks (xlsx + pdf) both route correctly
        } else {
          mergeRows(parseCSV(await f.text()), f.name);
        }
      } catch (e: any) { setMsg('Failed to read ' + f.name + ': ' + (e?.message || e)); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── v5.1: transcript file → extract text → auto-attach to a company ───────
  const attachMsg = (company: string, en: ConcallEntry): string => {
    const ex = en.extract; const sig: string[] = [];
    if (ex.utilization !== null) sig.push('utilization ' + ex.utilization + '% detected');
    if (ex.orderBook !== null) sig.push('order book ' + ex.orderBook.toLocaleString() + ' Cr');
    if (ex.capexGuidance !== null) sig.push('capex guide ' + ex.capexGuidance.toLocaleString() + ' Cr');
    if (ex.tone !== null) sig.push('tone ' + Math.round(ex.tone * 100) + '% positive');
    return '🎙 Transcript attached to ' + company + ' ("' + en.label + '")' +
      (sig.length ? ' · ' + sig.join(' · ') + ' — Apply chips ready on the 🎙 Concall tab.' : ' · no numeric signals found — open the 🎙 Concall tab to review.');
  };
  const onTranscriptFile = async (f: File) => {
    if (/\.ppt$/i.test(f.name)) {
      setMsg('⚠ ' + f.name + ' is a legacy binary .ppt that browsers cannot parse — export it as PDF (or .pptx) and re-upload. The rest of the batch continues.');
      return;
    }
    const raw = (/\.pdf$/i.test(f.name) ? await extractPdfText(await f.arrayBuffer())
      : /\.pptx$/i.test(f.name) ? await extractPptxText(await f.arrayBuffer())
      : await f.text()).trim();
    if (!raw) { setMsg('⚠ No text found in ' + f.name + (/\.pdf$/i.test(f.name) ? ' — likely a scanned/image-only PDF. ' : ' — ') + 'paste the text on the 🎙 Concall tab instead.'); return; }
    const body = capTranscript(raw);
    const names = rowsRef.current.map((r) => { const h = resolveHeaders(Object.keys(r)); return (r[h['name']] || '').trim(); }).filter(Boolean);
    const matches = matchCompanies(names, f.name, body.slice(0, 2048));
    const entry: ConcallEntry = {
      id: uid(), label: transcriptLabel(f.name, body), addedAt: new Date().toISOString(),
      chars: body.length, text: body, extract: extractConcall(body),
    };
    if (matches.length === 1) {
      const k = ckey(matches[0]);
      const list = concallsRef.current[k] ?? [];
      if (list.length >= 8) { setMsg('⚠ ' + matches[0] + ' already has 8 transcripts (the cap) — delete one on the 🎙 Concall tab, then re-upload ' + f.name + '.'); return; }
      if (persistConcalls({ ...concallsRef.current, [k]: [...list.filter((e) => e.chars !== entry.chars || e.text.slice(0, 200) !== entry.text.slice(0, 200)), entry] })) setMsg(attachMsg(matches[0], entry));
    } else {
      const pool = concallsRef.current[KU] ?? [];
      if (pool.length >= 12) { setMsg('⚠ 12 transcripts already parked in UNASSIGNED — assign or delete some on the 🎙 Concall tab first.'); return; }
      if (persistConcalls({ ...concallsRef.current, [KU]: [...pool, entry] })) {
        setMsg('🎙 ' + f.name + ' parsed (' + body.length.toLocaleString() + ' chars) but ' +
          (matches.length === 0 ? 'no stored company matched' : matches.length + ' companies matched (' + matches.slice(0, 3).join(', ') + (matches.length > 3 ? '…' : '') + ')') +
          ' — parked in UNASSIGNED on the 🎙 Concall tab; pick the company there.');
      }
    }
  };
  const assignUnassigned = (id: string, company: string) => {
    if (!company) { setMsg('Pick a company to assign this transcript to.'); return; }
    const pool = concallsRef.current[KU] ?? [];
    const en = pool.find((e) => e.id === id); if (!en) return;
    const k = ckey(company);
    const list = concallsRef.current[k] ?? [];
    if (list.length >= 8) { setMsg('⚠ ' + company + ' already has 8 transcripts (the cap) — delete one first.'); return; }
    const next = { ...concallsRef.current, [k]: [...list, en] };
    const rest = pool.filter((e) => e.id !== id);
    if (rest.length) next[KU] = rest; else delete next[KU];
    if (persistConcalls(next)) setMsg(attachMsg(company, en));
  };

  const clearAll = () => {
    if (!confirm('Clear ALL saved capex data AND transcripts? This cannot be undone.')) return;
    persist([], []);
    try { localStorage.removeItem(KC); } catch {}
    concallsRef.current = {};
    setConcalls({});
    setMsg('All data and transcripts cleared.');
  };

  const scored = useMemo(() => {
    if (!rows.length) return [] as Scored[];
    return rows.map((r) => { const cc = concalls[r.name]?.slice(-1)[0]?.extract; const extras = cc ? { orderBookCr: cc.orderBook, customerCount: cc.customerCount, exportPct: cc.exportPct, utilization: cc.utilization } : undefined; return scoreRow(r, resolveHeaders(Object.keys(r)), extras); }).sort((a, b) => b.final - a.final);
  }, [rows, concalls]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'ANCHOR BUY': 0, 'CORE BUY': 0, SATELLITE: 0, 'NEEDS DATA': 0, WATCHLIST: 0, AVOID: 0, REJECT: 0 };
    scored.forEach((s) => { c[s.decision] = (c[s.decision] || 0) + 1; });
    return c;
  }, [scored]);

  // ── v5: concall store (separate key — survives 'Clear all') ────────────────
  const ckey = (name: string) => name.trim().toLowerCase();
  const persistConcalls = (next: Record<string, ConcallEntry[]>): boolean => {
    const json = JSON.stringify(next);
    if (json.length > 2_500_000) { setMsg('⚠ Transcript store would exceed 2.5MB — delete old transcripts first. NOT saved.'); return false; }
    try { localStorage.setItem(KC, json); } catch { setMsg('⚠ Browser storage quota exceeded — transcript NOT saved.'); return false; }
    concallsRef.current = next;
    setConcalls(next);
    return true;
  };
  const addTranscript = (company: string, label: string, text: string) => {
    if (!company) { setMsg('Pick a company for the transcript.'); return; }
    const body = text.trim();
    if (!body) { setMsg('Paste the transcript text first.'); return; }
    if (body.length > 300000) { setMsg('⚠ Transcript too large — trim to the management+Q&A section (max 300k chars).'); return; }
    const k = ckey(company);
    let list = [...(concallsRef.current[k] ?? [])];
    if (list.length >= 8) {
      if (!confirm('This company already has 8 transcripts (the cap). Delete the oldest to make room?')) return;
      list = list.slice(1);
    }
    // never "untitled": derive period from the text head, else "{Company short} · {date}"
    const coShort = company.split(/\s+/).slice(0, 2).join(' ');
    const period = findPeriod(body);
    const autoLabel = (period ? period + ' · ' : '') + coShort + (period ? '' : ' · ' + new Date().toLocaleDateString());
    const entry: ConcallEntry = {
      id: uid(), label: label.trim() || autoLabel, addedAt: new Date().toISOString(),
      chars: body.length, text: body, extract: extractConcall(body),
    };
    if (persistConcalls({ ...concallsRef.current, [k]: [...list.filter((e) => e.chars !== entry.chars || e.text.slice(0, 200) !== entry.text.slice(0, 200)), entry] })) {
      setMsg('🎙 Saved transcript for ' + company + ' — ' + body.length.toLocaleString() + ' chars, extraction below.');
      setCcLabel(''); setCcText('');
    }
  };
  const deleteTranscript = (k: string, id: string) => {
    if (!confirm('Delete this transcript?')) return;
    const list = (concallsRef.current[k] ?? []).filter((e) => e.id !== id);
    const next = { ...concallsRef.current };
    if (list.length) next[k] = list; else delete next[k];
    persistConcalls(next);
  };
  const clearTranscripts = () => {
    if (!confirm('Clear ALL saved concall transcripts? (Company data is untouched.)')) return;
    try { localStorage.removeItem(KC); } catch {}
    concallsRef.current = {};
    setConcalls({}); setMsg('All transcripts cleared.');
  };
  const ccStateFor = (name: string): CCState & { latest: ConcallEntry | null } => {
    const list = concalls[ckey(name)] ?? [];
    if (!list.length) return { freshness: 'NONE', tone: null, utilization: null, latest: null };
    const latest = list[list.length - 1];
    const ageDays = (Date.now() - +new Date(latest.addedAt)) / 86400000;
    return {
      freshness: ageDays < 120 ? 'FRESH' : ageDays <= 365 ? 'STALE' : 'NONE',
      tone: latest.extract.tone, utilization: latest.extract.utilization, latest,
    };
  };

  // ── v5: per-company intelligence (derived, never persisted) ────────────────
  const intel = useMemo(() => scored.map((s) => {
    const fin = parseFin(s.raw);
    const fx = computeForensic(fin, s.raw);
    const mb = computeMultibagger(fin, s, s.raw, fx.grade);
    const cc = ccStateFor(s.name);
    const verdict = computeVerdict(s, mb, fx, cc);
    // PATCH 1080b — turnaround result available to every tab/row.
    const ta = scoreTurnaround(fin as any, s.name);
    return { s, fin, mb, fx, cc, verdict, ta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scored, concalls]);
  const intelByName = useMemo(() => { const m: Record<string, (typeof intel)[number]> = {}; intel.forEach((it) => { m[ckey(it.s.name)] = it; }); return m; }, [intel]);

  const visible = useMemo(() => {
    let v = scored.filter((s) => s.final >= minScore);
    if (band !== 'ALL') v = v.filter((s) => s.decision === band);
    if (q.trim()) { const qq = q.trim().toLowerCase(); v = v.filter((s) => s.name.toLowerCase().includes(qq) || s.industry.toLowerCase().includes(qq)); }
    const get = (s: Scored): number | string => (s as any)[sortKey] ?? 0;
    v = [...v].sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * sortDir; });
    return v;
  }, [scored, band, q, minScore, sortKey, sortDir]);

  const setSort = (k: string) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); } };
  const fmt = (n: number, d = 1) => (isNaN(n) ? '—' : n.toFixed(d));
  const card: any = { background: C.panel, border: '1px solid ' + C.line, borderRadius: 12, padding: 16 };
  const pill = (active: boolean, color: string): any => ({
    fontSize: F.xs, padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontWeight: 800,
    background: active ? color + '26' : C.panel2, border: '1px solid ' + (active ? color : C.line), color: active ? color : C.dim,
  });
  const TH = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th onClick={() => setSort(k)} style={{ padding: '7px 8px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: right ? 'right' : 'left', color: sortKey === k ? C.cyan : C.dim, fontSize: F.xs, fontWeight: 800 }}>
      {label}{sortKey === k ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  );

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_HEADERS + '\n' + TEMPLATE_SAMPLE + '\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'capex-tracker-template.csv'; a.click();
  };

  // manual edits always write the CLEAN canonical header (wins over est)
  const updateRow = (name: string, canonical: string, value: string) => {
    const next = rows.map((r) => {
      const h = resolveHeaders(Object.keys(r));
      if ((r[h['name']] || '').trim().toLowerCase() !== name.trim().toLowerCase()) return r;
      return { ...r, [canonical]: value };
    });
    persist(next, files);
  };

  const EDIT_FIELDS: [string, string, 'num' | string[]][] = [
    ['Capacity Utilization %', 'util', 'num'], ['Anchor Demand %', 'anchor', 'num'],
    ['Internal funding %', 'internalPct', 'num'], ['Promoter Holding %', 'promoter', 'num'],
    ['Promoter Pledge %', 'pledge', 'num'], ['PE vs 5-yr Mean', 'peVsMean', 'num'],
    ['Brownfield', 'brownfield', ['', 'Brownfield', 'Hybrid', 'Greenfield']],
    ['Cycle Position', 'cycle', ['', 'Mid', 'Early', 'Peak']],
    ['Cost Overrun History', 'overrun', ['', 'No', 'Minor <10%', 'Yes >20%']],
    ['Working Capital Trend', 'wc', ['', 'Stable', 'Improving', 'Deteriorating']],
    ['Policy Support', 'policy', ['', 'PLI/Mandate', 'Indirect', 'None']],
    ['Import Substitution', 'importSub', ['', 'Y', 'N']], ['Export Opportunity', 'exportOpp', ['', 'Y', 'N']],
    ['Competitive Moat', 'moat', ['', 'Y', 'N']], ['Prior Capex Success', 'mgmtHistory', ['', 'Y', 'N']],
    ['Industry', 'industry', 'num'],
  ];

  // v5: one-click apply of concall-extracted numbers → clean canonical headers
  // (writes "82 (concall)" — num() reads 82, provenance stays visible, manual-
  // equivalent so it survives re-uploads exactly like an inline edit)
  const ConcallChips = ({ s }: { s: Scored }) => {
    const st = ccStateFor(s.name);
    if (!st.latest) return null;
    const ex = st.latest.extract;
    const sug: { label: string; canonical: string; value: number; quote: string }[] = [];
    const curUtil = num(String(s.raw['Capacity Utilization %'] ?? ''));
    if (ex.utilization !== null && (!isFinite(curUtil) || Math.abs(curUtil - ex.utilization) >= 1)) {
      const q = ex.quotes.find((x) => x.field === 'utilization');
      sug.push({ label: '🎙 util ' + ex.utilization + '% (concall)', canonical: 'Capacity Utilization %', value: ex.utilization, quote: q ? q.snippet : '' });
    }
    const curAnchor = num(String(s.raw['Anchor Demand %'] ?? ''));
    let anchorSug: number | null = ex.anchorPct;
    let anchorQ = ex.quotes.find((x) => x.field === 'anchorPct');
    if (anchorSug === null && ex.orderBook !== null) {
      const rev = num(String(s.raw['Annual Revenue'] ?? ''));
      if (isFinite(rev) && rev > 0) { anchorSug = Math.min(100, Math.round((ex.orderBook / rev) * 100)); anchorQ = ex.quotes.find((x) => x.field === 'orderBook'); }
    }
    if (anchorSug !== null && (!isFinite(curAnchor) || Math.abs(curAnchor - anchorSug) >= 1)) {
      sug.push({ label: '🎙 anchor ~' + anchorSug + '% ' + (ex.anchorPct !== null ? '(concall)' : '(order book ÷ revenue)'), canonical: 'Anchor Demand %', value: anchorSug, quote: anchorQ ? anchorQ.snippet : '' });
    }
    if (!sug.length) return null;
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
        <span style={{ fontSize: F.xs, color: C.gold, fontWeight: 800 }}>🎙 from "{st.latest.label}":</span>
        {sug.map((g) => (
          <span key={g.canonical} title={g.quote ? '…' + g.quote + '…' : ''} style={{ fontSize: F.xs, padding: '3px 8px', borderRadius: 8, background: C.gold + '14', border: '1px solid ' + C.gold + '55', color: C.gold, fontWeight: 700 }}>
            {g.label}{' '}
            <button onClick={(e) => { e.stopPropagation(); updateRow(s.name, g.canonical, g.value + ' (concall)'); setMsg('Applied ' + g.canonical + ' = ' + g.value + ' from the concall — rescored.'); }}
              style={{ fontSize: 10, fontWeight: 900, padding: '1px 7px', borderRadius: 6, cursor: 'pointer', background: C.gold + '33', border: '1px solid ' + C.gold, color: C.txt }}>Apply</button>
          </span>
        ))}
      </div>
    );
  };

  // current value precedence mirrors the engine: clean → resolver → (est).
  // Inputs are grouped under DEMAND / OWNERSHIP / PROJECT / CONTEXT mini-headers
  // with one uniform 28px control height and ≥11px labels.
  const EDIT_GROUPS: [string, string[]][] = [
    ['Demand', ['Capacity Utilization %', 'Anchor Demand %']],
    ['Ownership', ['Promoter Holding %', 'Promoter Pledge %']],
    ['Project', ['Internal funding %', 'Brownfield', 'Cycle Position', 'Cost Overrun History', 'Working Capital Trend', 'Prior Capex Success']],
    ['Context', ['Policy Support', 'PE vs 5-yr Mean', 'Import Substitution', 'Export Opportunity', 'Competitive Moat', 'Industry']],
  ];
  const Editor = ({ s }: { s: Scored }) => {
    const h = resolveHeaders(Object.keys(s.raw));
    const inputStyle: any = { background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '0 8px', fontSize: F.xs, width: '100%', height: 28, boxSizing: 'border-box' };
    const renderField = (canonical: string) => {
      const tuple = EDIT_FIELDS.find(([cn]) => cn === canonical);
      if (!tuple) return null;
      const [, hkey, kind] = tuple;
      const clean = String(s.raw[canonical] ?? '').trim();
      const col = h[hkey];
      const resolved = col && col !== canonical + ' (est)' ? String(s.raw[col] ?? '').trim() : '';
      const est = String(s.raw[canonical + ' (est)'] ?? '').trim();
      const cur = clean || resolved || est;
      const isEst = !clean && !resolved && !!est;
      return (
        <label key={canonical} style={{ fontSize: 11, fontWeight: 600, color: isEst ? C.amber : C.body, display: 'grid', gap: 3 }}>
          <span>{canonical}{isEst ? ' · est' : ''}</span>
          {kind === 'num' ? (
            <input defaultValue={cur} onBlur={(e) => { if (e.target.value !== cur) updateRow(s.name, canonical, e.target.value); }} style={inputStyle} />
          ) : (
            <select value={cur} onChange={(e) => updateRow(s.name, canonical, e.target.value)} style={inputStyle}>
              {(kind as string[]).map((o) => <option key={o} value={o}>{o || '—'}</option>)}
              {cur && !(kind as string[]).includes(cur) && <option value={cur}>{cur}</option>}
            </select>
          )}
        </label>
      );
    };
    return (
      <div style={{ marginTop: 2, borderTop: '1px dashed ' + C.line, paddingTop: 10 }}>
        <SectionHead label="✍️ Editor" color={C.violet} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>auto-saves · rescores instantly · manual beats (est)</span>} />
        <ConcallChips s={s} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, alignItems: 'start' }}>
          {EDIT_GROUPS.map(([g, fields]) => (
            <div key={g}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase' as const, borderBottom: '1px solid ' + C.line, paddingBottom: 3, marginBottom: 7 }}>{g}</div>
              <div style={{ display: 'grid', gap: 7 }}>{fields.map(renderField)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── expanded detail: VERDICT → TIMELINE → TELEMETRY → CAPEX BY YEAR →
  //    21-FACTOR BREAKDOWN → TRIGGERS → EDITOR, one section-header style ──────
  const Detail = ({ s }: { s: Scored }) => {
    const chip = (txt: string, col: string): any => ({
      fontSize: F.xs, padding: '4px 10px', borderRadius: 8, fontWeight: 700, lineHeight: 1.45,
      background: col + '14', border: '1px solid ' + col + '44', color: col,
    });
    const tile = (label: string, val: string, col: string) => (
      <div key={label} style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 8, padding: '8px 10px 7px', display: 'grid', gap: 3, alignContent: 'start' }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 0.7, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: col, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{val}</div>
      </div>
    );
    return (
      <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 16, margin: '6px 0 10px', display: 'grid', gap: 14 }}>
        {/* ── VERDICT ── */}
        <div>
          <SectionHead label="Verdict" color={s.entryColor} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: s.entryColor + '10', border: '1px solid ' + s.entryColor + '55', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: s.decisionColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.final}</div>
            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision}</span>
                <StageChip stage={s.stage} />
                <span style={{ fontSize: F.xs, fontWeight: 700, color: C.dim, letterSpacing: 0.5 }}>{s.stageLabel}</span>
              </div>
              <div style={{ fontSize: F.sm, color: s.entryColor, fontWeight: 700, lineHeight: 1.5 }}>{s.entry}</div>
            </div>
          </div>
        </div>
        {/* ── TIMELINE ── */}
        <div>
          <SectionHead label="Timeline — T0→T5 arc" color={C.violet} />
          <Timeline s={s} />
        </div>
        {/* ── TELEMETRY ── */}
        <div>
          <SectionHead label="Telemetry" color={C.cyan} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8 }}>
            {s.phase ? tile('PHASE', s.phase, s.phase === 'BUILDING' ? C.orange : s.phase === 'RAMPING' ? C.green : C.txt) : null}
            {!isNaN(s.capexToSales) && tile('CAPEX / SALES', s.capexToSales.toFixed(1) + '%', C.txt)}
            {!isNaN(s.cwipRatio) && tile('CWIP / BLOCK', s.cwipRatio.toFixed(0) + '%', s.cwipRatio > 30 ? C.amber : C.txt)}
            {!isNaN(s.capexAccel) && tile('SPEND ACCEL', s.capexAccel.toFixed(1) + 'x', s.capexAccel > 1.6 ? C.orange : C.txt)}
            {!isNaN(s.netDebtEbitda) && tile('NET DEBT / EBITDA', s.netDebtEbitda < 0 ? 'net cash' : s.netDebtEbitda.toFixed(2) + 'x', s.netDebtEbitda > 2 ? C.red : C.green)}
            {!isNaN(s.capexPreRev) && tile('CYCLE CAPEX / PRE-REV', s.capexPreRev.toFixed(0) + '%', s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber)}
            {!isNaN(s.utilEff) && tile('EFF. UTIL (EST)', s.utilEff.toFixed(0) + '%', s.utilEff > 90 ? C.red : s.utilEff >= 30 && s.utilEff < 70 ? C.gold : C.txt)}
            {!isNaN(s.selfFund) && tile('OCF / CAPEX 3Y', s.selfFund.toFixed(0) + '%', s.selfFund >= 70 ? C.green : s.selfFund >= 40 ? C.amber : C.red)}
            {!isNaN(s.deChange) && tile('Δ D/E 2Y', (s.deChange >= 0 ? '+' : '') + s.deChange.toFixed(2), s.deChange > 0.3 ? C.red : C.txt)}
          </div>
          {!isNaN(s.capexPreRev) && (
            <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6, marginTop: 8 }}>
              Framework sweet spot: cycle capex 30-60% of pre-capex revenue.{' '}
              <b style={{ color: s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber }}>
                {s.capexPreRev < 30 ? 'Below 30% — lever too small for multibagger math.' : s.capexPreRev <= 60 ? 'IN the sweet spot.' : s.capexPreRev <= 100 ? 'Above 60% — execution + leverage risk rising.' : 'Way above — bet-the-company build.'}
              </b>{' '}Net Debt/EBITDA rule: &lt;2x clean at peak capex; &gt;3x for 2 quarters = mechanical reject.
            </div>
          )}
        </div>
        {/* ── CAPEX BY YEAR ── */}
        <CapexStrip s={s} />
        {/* ── 21-FACTOR BREAKDOWN ── */}
        <div>
          <SectionHead label="21-factor quality breakdown" color={C.cyan}
            extra={<span style={{ fontSize: F.xs, color: C.dim, whiteSpace: 'nowrap' }}>measured {s.base}/{s.availMax} ({s.measuredPct}%) × industry {s.mult.toFixed(2)}{s.dbCount >= 3 ? ' → capped 30' : ''} = <b style={{ color: s.decisionColor, fontSize: F.sm }}>{s.final}</b> · conf {s.confidence}{s.gaps ? ' · ' + s.gaps + ' gaps' : ''}{s.estUsed ? ' · ' + s.estUsed + ' est' : ''}</span>} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', columnGap: 18, rowGap: 2 }}>
            {s.factors.map((f) => {
              const nd = f.note === 'no data';
              const pct = f.max ? f.pts / f.max : 0;
              const col = nd ? C.muted : pct >= 0.7 ? C.green : pct > 0 ? C.amber : C.red;
              return (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', borderBottom: '1px solid ' + C.line, fontSize: F.xs, fontStyle: nd ? 'italic' : 'normal', opacity: nd ? 0.75 : 1 }}>
                  <span style={{ color: nd ? C.dim : C.txt, fontWeight: 600, whiteSpace: 'nowrap' }}><span style={{ color: C.muted, fontWeight: 700 }}>T{f.tier}·F{f.id}</span> {f.label}</span>
                  <span style={{ color: C.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.note}>{!nd && f.note ? f.note : nd ? 'no data' : ''}</span>
                  <span style={{ width: 38, height: 4, borderRadius: 2, background: C.line, overflow: 'hidden', flexShrink: 0 }}>
                    <span style={{ display: 'block', width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
                  </span>
                  <span style={{ fontWeight: 900, color: col, fontVariantNumeric: 'tabular-nums', width: 42, textAlign: 'right', flexShrink: 0 }}>{nd ? 'n/a' : f.pts + '/' + f.max}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: F.sm, color: C.amber, lineHeight: 1.55, marginTop: 8 }}>{s.comment}</div>
        </div>
        {/* ── TRIGGERS ── */}
        {(s.watch.length > 0 || s.sells.length > 0) && (
          <div>
            <SectionHead label="Triggers" color={C.red} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {s.watch.map((w, i) => <span key={'w' + i} style={chip('🚨 ' + w, C.red)}>🚨 {w}</span>)}
              {s.sells.map((w, i) => <span key={'s' + i} style={chip('📤 ' + w, C.amber)}>📤 {w}</span>)}
            </div>
          </div>
        )}
        {/* ── EDITOR ── */}
        <Editor s={s} />
      </div>
    );
  };

  const BAND_ORDER = ['ALL', 'ANCHOR BUY', 'CORE BUY', 'SATELLITE', 'NEEDS DATA', 'WATCHLIST', 'AVOID', 'REJECT'];
  const bandColor = (b: string) => b === 'ANCHOR BUY' ? C.gold : b === 'CORE BUY' ? C.green : b === 'SATELLITE' ? C.cyan : b === 'NEEDS DATA' ? C.violet : b === 'WATCHLIST' ? C.amber : b === 'AVOID' ? C.orange : b === 'REJECT' ? C.red : C.blue;

  const buyNow = useMemo(() => scored.filter((s) => {
    if (!((s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY') && (s.stage === 'B' || s.stage === 'C' || s.stage === 'D'))) return false;
    // forensic veto reaches the decision board — a ☠ name is never a BUY NOW
    const it = intelByName[ckey(s.name)];
    return !(it && (it.fx.grade === 'AVOID' || it.fx.critical));
  }), [scored, intelByName]);
  const wrongStage = useMemo(() => scored.filter((s) => (s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY') && !(s.stage === 'B' || s.stage === 'C' || s.stage === 'D')), [scored]);
  // 'needs:' must only list factors the owner can actually fill/verify —
  // F2 anchor, F6 utilization, F7 promoter, F15 policy, F16 industry growth,
  // F17 import-sub, F20 moat. Never structural ones (capex size, valuation,
  // revenue CAGR, cycle timing) the owner cannot change by research.
  const ACTIONABLE_FACTORS = useMemo(() => new Set([2, 6, 7, 15, 16, 17, 20]), []);
  const upgradeWatch = useMemo(() => scored.filter((s) => s.decision === 'WATCHLIST' || s.decision === 'SATELLITE')
    .map((s) => ({ s, need: s.factors.filter((f) => ACTIONABLE_FACTORS.has(f.id) && f.pts === 0).slice(0, 2) }))
    .sort((a, b) => b.s.final - a.s.final).slice(0, 10), [scored, ACTIONABLE_FACTORS]);

  return (
    <div style={{ maxWidth: 2100, margin: '0 auto', padding: '14px 18px', color: C.txt, fontFamily: 'inherit' }}>
      <style>{'table.cxt { font-variant-numeric: tabular-nums; } '
        + 'table.cxt thead th { background: ' + C.panel2 + '; position: sticky; top: 0; z-index: 2; } '
        + 'table.cxt tbody tr.cxr:hover { background: #15213A; }'}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: C.dim, textDecoration: 'none', fontSize: F.sm }}>← Home</Link>
        <span style={{ fontSize: F.xl, fontWeight: 900, color: C.orange }}>🏗 CAPEX TRACKER <span style={{ fontSize: F.xs, color: C.dim, fontWeight: 700 }}>v5.4</span></span>
        <span style={{ fontSize: F.sm, color: C.body }}>four lenses, one dataset: capex quality × timing · 🚀 multibagger DNA · 🔬 forensics · 🎙 concall → 🧭 one fused verdict</span>
        <span style={{ fontSize: F.xs, color: C.dim }}>{files.length} file{files.length === 1 ? '' : 's'} · {scored.length} companies (saved locally)</span>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span onClick={() => setTab('board')} style={pill(tab === 'board', C.cyan)}>☰ Scoreboard</span>
        <span onClick={() => setTab('analytics')} style={pill(tab === 'analytics', C.green)}>🎯 Decision Board</span>
        <span onClick={() => setTab('multibagger')} style={pill(tab === 'multibagger', C.violet)}>🚀 Multibagger</span>
        <span onClick={() => setTab('turnaround')} style={pill(tab === 'turnaround', C.amber)} title="Turnaround scoring — Phase/Archetype/Score from the 10y workbook">🔄 Turnaround</span>
        <span onClick={() => setTab('playbook')} style={pill(tab === 'playbook', C.violet)}>📚 Playbook</span>
        <span onClick={() => setTab('forensics')} style={pill(tab === 'forensics', C.red)}>🔬 Forensics</span>
        <span onClick={() => setTab('concall')} style={pill(tab === 'concall', C.gold)}>🎙 Concall</span>
        <span onClick={() => setTab('concallpro')} style={pill(tab === 'concallpro', C.gold)} title="Concall reading mastery">🎓 Concall Pro</span>
        <span onClick={() => setTab('verdict')} style={pill(tab === 'verdict', C.orange)}>🧭 Verdict</span>
        <span onClick={() => setTab('model')} style={pill(tab === 'model', C.blue)}>📐 The Model</span>
        <span style={{ flex: 1 }} />
        <span onClick={() => setAllOpen(o => !o)} style={pill(allOpen, C.amber)} title="Toggle expand all rows across every tab">⇕ {allOpen ? 'Collapse' : 'Expand'} all</span>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf,.pptx,.ppt,.txt" multiple onChange={(e) => onFiles(e.target.files)} style={{ fontSize: F.xs, color: C.dim }} />
        <button onClick={downloadTemplate} style={{ ...pill(false, C.blue), background: C.panel2 }}>⬇ Input template</button>
        {rows.length > 0 && <button onClick={clearAll} style={{ ...pill(false, C.red) }}>Clear all</button>}
      </div>
      {msg && <div style={{ fontSize: F.sm, color: C.teal, marginBottom: 8 }}>{msg}</div>}

      {!scored.length && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: F.lg, fontWeight: 800 }}>Upload your capex universe (Screener.in Excel/CSV) — concall PDFs/PPTX can ride in the same pick</div>
          <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.65, marginTop: 8, maxWidth: 780, margin: '8px auto' }}>
            Screener workbooks are mined automatically: quantitative factors, capex telemetry, prior-cycle history, stage classification — with (est) fills for what the statements imply.
            Concall transcripts (.pdf / .pptx / .txt) are parsed in this browser and auto-attached to the matching company; unmatched ones park in the 🎙 Concall tab for one-click assignment.
            Qualitative edges (anchor %, promoter/pledge, policy) are yours to fill inline. Data persists in this browser; re-upload any time to refresh — nothing is lost unless you press Clear all.
          </div>
        </div>
      )}

      {/* ═══ SCOREBOARD ═══ */}
      {tab === 'board' && scored.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px', alignItems: 'center' }}>
            {BAND_ORDER.map((b) => (
              <span key={b} onClick={() => setBand(b)} style={pill(band === b, bandColor(b))}>
                {b === 'ALL' ? 'All ' + scored.length : b + ' · ' + (counts[b] || 0)}
              </span>
            ))}
            <input placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ background: C.panel2, border: '1px solid ' + C.line, color: C.txt, borderRadius: 8, padding: '4px 10px', fontSize: F.sm }} />
            <span style={{ fontSize: F.xs, color: C.dim }}>min score {minScore}</span>
            <input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(+e.target.value)} />
          </div>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                <TH k="name" label="COMPANY" />
                <TH k="final" label="SCORE" right /><TH k="decision" label="QUALITY" />
                <TH k="stage" label="STAGE" /><TH k="base" label="T1·T2·T3·T4" />
                <th style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>🚀 MB · 🔬 FX</th>
                <TH k="entryShort" label="ENTRY VERDICT" />
                <TH k="confidence" label="CONF" /><TH k="dbCount" label="⛔" right />
                <TH k="roce" label="ROCE%" right /><TH k="de" label="D/E" right />
                <TH k="netDebtEbitda" label="ND/EBITDA" right /><TH k="util" label="UTIL%" right />
                <TH k="anchor" label="ANCHOR%" right />
              </tr></thead>
              <tbody>
                {visible.map((s) => {
                  const it = intelByName[ckey(s.name)];
                  const lens = it ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span title={'Multibagger ' + (it.mb.grade === 'NR' ? 'not rated — upload Screener workbook' : it.mb.score + '/100')} style={{ fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 7, background: it.mb.color + '22', color: it.mb.color, border: '1px solid ' + it.mb.color + '55' }}>{it.mb.grade}</span>{' '}
                      <span title={'Forensic ' + (it.fx.grade === 'NR' ? 'not rated' : it.fx.score + '/100 · ' + it.fx.flags.length + ' flags')} style={{ fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 7, background: it.fx.color + '22', color: it.fx.color, border: '1px solid ' + it.fx.color + '55' }}>{it.fx.grade === 'NR' ? 'NR' : it.fx.score}</span>
                    </span>
                  ) : null;
                  return <ScoreRow key={s.name} s={s} open={open === s.name || allOpen} toggle={() => setOpen(open === s.name ? null : s.name)} fmt={fmt} Detail={Detail} lens={lens} veto={it ? it.fx.grade === 'AVOID' || it.fx.critical : false} />;
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            Click any row: T0→T5 timeline, capex-by-year strip, 21-factor bars, telemetry, inline editor. Quality = masterclass score; Stage = where on the utilization arc; the entry verdict is the intersection. Not investment advice.
          </div>
        </>
      )}

      {/* ═══ DECISION BOARD ═══ */}
      {tab === 'analytics' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <div style={{ ...card, border: '1px solid ' + C.gold + '66' }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 4 }}>🎯 BUY NOW — quality ∩ stage · {buyNow.length}</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>ANCHOR/CORE quality AND Stage B/C/D — both models agree. Stage C is the modal winner entry (~55% of 250-case winners).</div>
            {buyNow.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.dim }}>{s.industry || s.sector}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision), whiteSpace: 'nowrap' }}>{s.final}{s.confidence === 'LOW' ? ' ⚠' : ''}</span>
              </div>
            ))}
            {!buyNow.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No name clears BOTH filters yet — that is the discipline working.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.blue, marginBottom: 4 }}>⏳ RIGHT QUALITY, WRONG STAGE · {wrongStage.length}</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Masterclass quality clears but the timing window isn't open — too early (A), too late (E/F) or no cycle. Watch for Stage B/C.</div>
            {wrongStage.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.dim, fontSize: F.xs }}>{s.entryShort}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision) }}>{s.final}</span>
              </div>
            ))}
            {!wrongStage.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>Empty — every quality name is also in its window.</div>}
          </div>
          {(['ANCHOR BUY', 'CORE BUY', 'SATELLITE'] as const).map((b) => (
            <div key={b} style={card}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: bandColor(b), marginBottom: 4 }}>
                {b === 'ANCHOR BUY' ? '🥇' : b === 'CORE BUY' ? '🟢' : '🛰'} {b} · {counts[b] || 0}
              </div>
              <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>
                {b === 'ANCHOR BUY' ? '85-100 · 4-6% position · 88% historical hit rate' : b === 'CORE BUY' ? '70-84 · 3-4% · 72% hit rate · verify anchor on concall' : '55-69 · wait for Q1 post-capex confirmation, then 1.5-2.5% · 55%'}
              </div>
              {scored.filter((s) => s.decision === b).slice(0, 10).map((s) => (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                  <span><b>{s.name}</b> <StageChip stage={s.stage} />{s.theme && <span style={{ color: C.violet, fontSize: F.xs }}> {s.theme}</span>}</span>
                  <span style={{ fontWeight: 900, color: bandColor(b), whiteSpace: 'nowrap' }}>{s.final}{s.confidence === 'LOW' ? ' ⚠' : ''}</span>
                </div>
              ))}
              {!(counts[b] || 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>None in this band.</div>}
            </div>
          ))}
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 4 }}>⛔ Deal-breaker board</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>3+ deal-breakers ⇒ score capped at 30. Historically 80%+ default within 5-7 years.</div>
            {scored.filter((s) => s.dbCount > 0).sort((a, b) => b.dbCount - a.dbCount).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.red, fontSize: F.xs }}>{s.dbList.join(' · ')}</span></span>
                <span style={{ fontWeight: 900, color: s.dbCount >= 3 ? C.red : C.amber }}>{s.dbCount} DB</span>
              </div>
            ))}
            {!scored.some((s) => s.dbCount > 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No deal-breakers in the set — clean universe.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🧩 NEEDS DATA — judged on measured evidence only · {counts['NEEDS DATA'] || 0}</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>% = score on factors Screener can prove. Open the row, fill anchor/promoter/pledge for the real verdict.</div>
            {scored.filter((s) => s.decision === 'NEEDS DATA').sort((a, b) => b.measuredPct - a.measuredPct).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.dim }}>· {s.gaps} gaps{s.stage ? ' · Stage ' + s.stage : ''}</span></span>
                <span style={{ fontWeight: 900, color: s.measuredPct >= 70 ? C.green : s.measuredPct >= 50 ? C.amber : C.red }}>{s.measuredPct}% measured</span>
              </div>
            ))}
            {!(counts['NEEDS DATA'] || 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>All names carry enough evidence for a verdict.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>📈 Upgrade watch — what would change the call</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Watchlist/Satellite names and the exact factors holding them back.</div>
            {upgradeWatch.map(({ s, need }) => (
              <div key={s.name} style={{ padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <b>{s.name}</b> <span style={{ fontWeight: 900, color: C.amber }}>{s.final}</span>
                <span style={{ color: C.body }}> — needs: {need.length ? need.map((f) => f.label).join(' + ') : 'data gaps filled'}</span>
              </div>
            ))}
            {!upgradeWatch.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>Nothing on watch.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🔮 2026-2030 theme map (Masterclass Ch.11 Tier-1)</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Your names matched to the highest-probability forward themes.</div>
            {scored.filter((s) => s.theme).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.violet }}>{s.theme}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision) }}>{s.final}</span>
              </div>
            ))}
            {!scored.some((s) => s.theme) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No theme matches yet.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 4 }}>⏱ The playbook — entry, sell, monitoring (both docs)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.75 }}>
              <b style={{ color: C.gold }}>ENTRY:</b> Stage C (~40% util) is the modal winner entry · Stage B strongest hit rate · Stage A only for proven executors with net cash · Stage F = net-negative cohort, never chase.<br />
              <b style={{ color: C.amber }}>SELL (staircase — ⅓ per signal, full exit at 4):</b> ① util &gt;90% ② new larger capex announced ③ EBITDA margin at historical peak ④ ROCE prints &gt;35-40% ⑤ multiple above prior-cycle peak ⑥ "they can't make enough" is consensus.<br />
              <b style={{ color: C.red }}>MECHANICAL EXITS:</b> pledge crosses 50% · Net Debt/EBITDA &gt;3x for 2 quarters · receivables outgrow revenue 3 quarters · foreign acquisition &gt;12x EV/EBITDA.<br />
              <b style={{ color: C.cyan }}>QUARTERLY (Appendix A):</b> spend vs schedule · utilization ramp · D/E creep &gt;+0.3x = flag · OCF stays positive · <b>2 guidance moderations = TRIM 50%, 3 = EXIT FULL.</b>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 📚 PLAYBOOK ═══ */}
      {tab === 'playbook' && <CapexPlaybook />}

      {/* ═══ 🚀 MULTIBAGGER ═══ */}
      {tab === 'multibagger' && scored.length > 0 && (
        <>
          {/* PATCH 1081g — Asset-rich + promoter-rising filters built from the
              uploaded Fin series (Excel workbook). PromoterRisingFilter shows
              0 matches if the workbook lacks promoter-holding history rows. */}
          <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
            <AssetRichFilter
              universe={intel.map(({ s: stock, fin, ta }): AssetRichStock => {
                const li = ta && ta.derived.years.length > 0 ? ta.derived.years.length - 1 : -1;
                const cash = li >= 0 && ta ? ta.derived.cash[li] : NaN;
                const bor = li >= 0 && ta ? ta.derived.borrowings[li] : NaN;
                const netCashCr = (isFinite(cash) && isFinite(bor)) ? cash - bor : undefined;
                const ocfCr = li >= 0 && ta && isFinite(ta.derived.cfo[li]) ? ta.derived.cfo[li] : undefined;
                const de = li >= 0 && ta && isFinite(ta.derived.debtToEquity[li]) ? ta.derived.debtToEquity[li] : undefined;
                const rocePct = li >= 0 && ta && isFinite(ta.derived.roce[li]) ? ta.derived.roce[li] : undefined;
                return {
                  ticker: stock.name,
                  marketCapCr: typeof fin?.mcap === 'number' ? fin.mcap : 0,
                  netCashCr, ocfCr, de, rocePct,
                  pledgePct: undefined,
                  currentRatio: undefined,
                  divYieldPct: undefined,
                  structuralDecline: false,
                };
              })}
            />
            {/* PATCH 1085 — PromoterRisingFilter hidden until a real promoter-holding
                history data source is wired in. The Excel workbook doesn't carry
                a promoter-holding column, so passing promoterHistory: [] makes the
                filter permanently empty and just adds visual noise. Re-enable when
                a shareholding-pattern source is connected. */}
          </div>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                {['COMPANY', 'SCORE', 'GRADE', 'TOP DRIVERS', 'WEAKEST', 'MCAP Cr', 'PE', 'PEG'].map((hh, i) => (
                  <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 || i >= 5 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}><AutoAcronyms text={hh} /></th>
                ))}
              </tr></thead>
              <tbody>
                {[...intel].sort((a, b) => (b.mb.grade === 'NR' ? -1 : b.mb.score) - (a.mb.grade === 'NR' ? -1 : a.mb.score)).map(({ s, fin, mb }) => {
                  const measured = mb.components.filter((cmp) => cmp.pts !== null);
                  const top3 = [...measured].sort((a, b) => (b.pts! / b.w) - (a.pts! / a.w)).slice(0, 3).filter((cmp) => cmp.pts! > 0);
                  const weak = [...measured].sort((a, b) => (a.pts! / a.w) - (b.pts! / b.w))[0];
                  const isOpen = openMB === s.name || allOpen;
                  return (
                    <Fragment key={s.name}>
                      <tr className="cxr" onClick={() => setOpenMB(isOpen ? null : s.name)} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: isOpen ? '#16233B' : undefined }}>
                        <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: mb.color, background: mb.color + '14', border: '1px solid ' + mb.color + '44', borderRadius: 9, padding: '3px 10px' }}>{mb.grade === 'NR' ? '—' : mb.score}</span>
                        </td>
                        <td style={{ padding: '8px 8px' }}><span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: mb.color + '22', color: mb.color, border: '1px solid ' + mb.color + '55' }}>{mb.grade}</span></td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.green }}>{mb.grade === 'NR' ? <span style={{ color: C.dim }}>{fin ? 'insufficient series' : 'upload the Screener workbook to unlock multibagger/forensic scores'}</span> : top3.map((cmp) => cmp.label).join(' · ') || '—'}</td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.red }}>{mb.grade !== 'NR' && weak ? weak.label : '—'}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fin && fin.mcap ? Math.round(fin.mcap).toLocaleString() : '—'}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(mb.pe, 1)}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: mb.peg < 1.2 ? C.green : mb.peg > 2 ? C.red : C.txt }}>{fmt(mb.peg, 2)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={s.name + ':d'}><td colSpan={8} style={{ padding: '0 8px' }}>
                          <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px', display: 'grid', gap: 8 }}>
                            <MultibaggerStrips fin={fin} name={s.name} mbScore={mb.score} mbGrade={mb.grade} />
                            {/* PATCH 1080 — Turnaround scorecard (consumes the same Fin series) */}
                            <TurnaroundStrips fin={fin} name={s.name} />
                            <div style={{ fontSize: F.xs, fontWeight: 800, color: C.violet }}>
                              12-COMPONENT MULTIBAGGER BREAKDOWN — measured {mb.available}/100 weight → score <b style={{ color: mb.color }}>{mb.grade === 'NR' ? 'NR' : mb.score}</b>
                              {mb.grade === 'NR' && <span style={{ color: C.dim, fontWeight: 400 }}> · below the 40-weight floor — {fin ? 'series too thin' : 'upload the Screener workbook'}</span>}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 6 }}>
                              {mb.components.map((cmp) => {
                                const nd = cmp.pts === null;
                                const pct = nd ? 0 : cmp.pts! / cmp.w;
                                const col = nd ? C.muted : pct >= 0.7 ? C.green : pct > 0 ? C.amber : C.red;
                                return (
                                  <div key={cmp.id} style={{ background: nd ? C.panel : C.bg, border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs }}>
                                      <span style={{ color: C.body }}>{cmp.label}{cmp.detail ? ' · ' + cmp.detail : ''}</span>
                                      <span style={{ fontWeight: 900, color: col, whiteSpace: 'nowrap' }}>{nd ? 'n/a' : cmp.pts!.toFixed(1) + '/' + cmp.w}</span>
                                    </div>
                                    <div style={{ height: 3, borderRadius: 2, background: C.line, marginTop: 3, overflow: 'hidden' }}>
                                      <div style={{ width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            Recomputed from the 10-year workbook series (SQGLP-style: growth consistency · ROCE trajectory · operating leverage · self-funded reinvestment · dilution · runway · PEG · promoter). Growth and PEG use blended 3y/5y/10y horizons (v5.2). Absolute bands A+ ≥80 … D &lt;38; grade capped at B+ on forensic FLAGS and at B on pledge &gt;15% / D/E &gt;1.5. Click a row for the component bars.
          </div>
        </>
      )}

      {/* ═══ 🔄 TURNAROUND (PATCH 1080b) — full ranking of every uploaded company ═══ */}
      {tab === 'turnaround' && scored.length > 0 && (() => {
        const rows = intel
          .map((it) => ({ it, ta: it.ta as TurnaroundResult | null }))
          .filter((x) => x.ta != null);
        const gradeRank: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, NR: 0 };
        const phaseRank: Record<string, number> = {
          PHASE_3_INFLECTION: 4, PHASE_4_RE_RATING: 3, PHASE_2_STABILISATION: 2,
          PHASE_1_COLLAPSE: 1, UNCLASSIFIED: 0,
        };
        rows.sort((a, b) => {
          // Best first: thesisAlive desc, gradeRank desc, phaseRank desc, totalScore desc
          if (a.ta!.thesisAlive !== b.ta!.thesisAlive) return a.ta!.thesisAlive ? -1 : 1;
          const g = (gradeRank[b.ta!.grade] || 0) - (gradeRank[a.ta!.grade] || 0);
          if (g !== 0) return g;
          const p = (phaseRank[b.ta!.phase] || 0) - (phaseRank[a.ta!.phase] || 0);
          if (p !== 0) return p;
          return b.ta!.totalScore - a.ta!.totalScore;
        });
        // PATCH 1080d (BUG A) — mutually exclusive buckets: each company appears in
        // exactly one bucket. We assign to the first matching bucket in priority order.
        const used = new Set<string>();
        const take = (pred: (x: typeof rows[number]) => boolean) => {
          const picked = rows.filter((x) => !used.has(x.it.s.name) && pred(x));
          picked.forEach((x) => used.add(x.it.s.name));
          return picked;
        };
        const buckets: { id: string; label: string; sub: string; rows: typeof rows; color: string }[] = [
          { id: 'best', label: '🏆 BEST TURNAROUNDS — A-grade · Phase 3 / Phase 4', sub: 'Inflection or re-rating with all gates clear', color: C.green,
            rows: take((x) => x.ta!.action === 'BUY' || (x.ta!.thesisAlive && x.ta!.grade === 'A' && (x.ta!.phase === 'PHASE_3_INFLECTION' || x.ta!.phase === 'PHASE_4_RE_RATING'))) },
          { id: 'starter', label: '🟢 STARTER — A/B grade · early inflection', sub: 'Building the position, not full size yet', color: C.amber,
            rows: take((x) => x.ta!.action === 'STARTER') },
          { id: 'watch', label: '👀 WATCH — stabilisation or marginal grade', sub: 'Decline decelerating, no position yet', color: C.amber,
            rows: take((x) => x.ta!.action === 'WATCH') },
          // PATCH 1080c — HEALTHY = cash-generative compounder, not a turnaround setup.
          // PATCH 1081 NICE-TO-HAVE 2 — split into A/B-grade compounders and C-grade
          // so the high-quality ones surface first.
          { id: 'healthy_ab', label: '🏥 HEALTHY-AB — premium cash compounders', sub: 'A or B grade · no distress episode · use Multibagger DNA for entry call', color: C.cyan,
            rows: take((x) => x.ta!.action === 'HEALTHY' && (x.ta!.grade === 'A' || x.ta!.grade === 'B')) },
          { id: 'healthy_c', label: '🏥 HEALTHY-C — steady but marginal score', sub: 'C grade · no distress but turnaround framework not the right lens', color: C.cyan,
            rows: take((x) => x.ta!.action === 'HEALTHY') },
          { id: 'avoid', label: '⛔ AVOID — survival gate FAIL', sub: 'Capital impairment risk — thesis dead-on-arrival', color: C.red,
            rows: take((x) => x.ta!.action === 'AVOID') },
          { id: 'skip', label: '— SKIP — thin score, no edge', sub: 'Different opportunity better', color: C.muted,
            rows: take((x) => x.ta!.action === 'SKIP') },
        ];
        return (
          <>
            <div style={{ ...card, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>🔄 Turnaround Scorecard — every company ranked</div>
              <div style={{ fontSize: F.xs, color: C.body, lineHeight: 1.5 }}>
                Six-section Playbook score /42 + phase classifier (Collapse → Stabilisation → Inflection → Re-rating) + archetype (Cyclical / Operational / Distressed) + 6 survival gates + 10-killer trap radar. Best candidates surface at the top. Click any row for the full per-company strips.
              </div>
            </div>
            {buckets.map((b) => b.rows.length === 0 ? null : (
              <div key={b.id} style={{ ...card, padding: 0, marginBottom: 10, overflowX: 'auto', borderColor: b.color + '55' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid ' + C.line, background: b.color + '10' }}>
                  <div style={{ fontSize: F.sm, fontWeight: 800, color: b.color }}>{b.label} <span style={{ color: C.body }}>· {b.rows.length}</span></div>
                  <div style={{ fontSize: F.xs, color: C.dim, marginTop: 2 }}>{b.sub}</div>
                </div>
                <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
                  <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                    {['COMPANY', 'GRADE', 'SCORE', 'PHASE', 'ARCHETYPE', 'TROUGH', 'GATES', '🚩 TRAPS', 'MCAP Cr'].map((hh, i) => (
                      <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 2 || i === 8 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}><AutoAcronyms text={hh} /></th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {b.rows.map(({ it, ta }) => {
                      const isOpen = openMB === it.s.name || allOpen;
                      const passes = ta!.gates.filter((g) => g.status === 'PASS').length;
                      const fails = ta!.gateFailCount;
                      const warns = ta!.gates.filter((g) => g.status === 'WARN').length;
                      const traps = ta!.redFlagTrippedCount;
                      return (
                        <Fragment key={it.s.name}>
                          <tr className="cxr" onClick={() => setOpenMB(isOpen ? null : it.s.name)} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: isOpen ? '#16233B' : undefined }}>
                            <td style={{ padding: '8px 8px', fontWeight: 800 }}>{it.s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{it.s.industry || it.s.sector}</div></td>
                            <td style={{ padding: '8px 8px' }}><span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: ta!.gradeColor + '22', color: ta!.gradeColor, border: '1px solid ' + ta!.gradeColor + '55' }}>{ta!.grade}</span></td>
                            <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                              <span style={{ fontSize: 14, fontWeight: 900, color: ta!.gradeColor }}>{ta!.totalScore.toFixed(0)}<span style={{ color: C.dim, fontSize: 11, fontWeight: 600 }}>/{ta!.totalMax}</span></span>
                            </td>
                            <td style={{ padding: '8px 8px', fontSize: F.xs, color: ta!.phaseColor, fontWeight: 800 }}>{ta!.phaseLabel}</td>
                            <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.body }}>{ta!.archetypeLabel.split(' · ')[0]}</td>
                            <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.dim }}>{ta!.troughYearByMetric.opm ? `${ta!.troughYearByMetric.opm.slice(-4)} · ${ta!.yearsSinceTrough}y ago` : '—'}</td>
                            <td style={{ padding: '8px 8px', fontSize: F.xs }}>
                              <span style={{ color: C.green }}>{passes}P</span>
                              <span style={{ color: C.amber, marginLeft: 4 }}>{warns}W</span>
                              <span style={{ color: C.red, marginLeft: 4, fontWeight: fails > 0 ? 900 : 400 }}>{fails}F</span>
                            </td>
                            <td style={{ padding: '8px 8px', fontSize: F.xs, color: traps > 0 ? C.red : C.dim, fontWeight: traps > 0 ? 800 : 400 }}>{traps > 0 ? `${traps}/10` : '0/10'}</td>
                            <td style={{ padding: '8px 8px', textAlign: 'right' }}>{it.fin && it.fin.mcap ? Math.round(it.fin.mcap).toLocaleString() : '—'}</td>
                          </tr>
                          {isOpen && (
                            <tr key={it.s.name + ':td'}><td colSpan={9} style={{ padding: '0 8px' }}>
                              <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px' }}>
                                <TurnaroundStrips fin={it.fin} name={it.s.name} />
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            <div style={{ fontSize: F.xs, color: C.dim, marginTop: 4, lineHeight: 1.6 }}>
              Scoring framework synthesised from <i>Indian_Turnaround_Research</i> + <i>Turnaround Investor Master Playbook</i> §VIII. Sort priority: thesis-alive (no gate FAIL) → letter grade → phase → composite score. Click any company for the 11-tile per-row breakdown.
            </div>
          </>
        );
      })()}

      {/* ═══ 🔬 FORENSICS ═══ */}
      {tab === 'forensics' && scored.length > 0 && (
        <>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                {['COMPANY', 'SCORE', 'GRADE', '🚩 FLAGS', 'WORST FLAG'].map((hh, i) => (
                  <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 || i === 3 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>{hh}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...intel].sort((a, b) => (b.fx.grade === 'NR' ? -1 : b.fx.score) - (a.fx.grade === 'NR' ? -1 : a.fx.score)).map(({ s, fin, fx }) => {
                  const isOpen = openFX === s.name || allOpen;
                  return (
                    <Fragment key={s.name}>
                      <tr className="cxr" onClick={() => setOpenFX(isOpen ? null : s.name)} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: isOpen ? '#16233B' : undefined }}>
                        <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: fx.color, background: fx.color + '14', border: '1px solid ' + fx.color + '44', borderRadius: 9, padding: '3px 10px' }}>{fx.grade === 'NR' ? '—' : fx.score}</span>
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: fx.color + '22', color: fx.color, border: '1px solid ' + fx.color + '55', whiteSpace: 'nowrap' }}>{fx.grade}{fx.critical ? ' ☠' : ''}</span>
                          {fx.grade === 'NR' && <span style={{ fontSize: F.xs, color: C.dim }}> upload the Screener workbook to unlock</span>}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, color: fx.flags.length >= 4 ? C.red : fx.flags.length ? C.amber : C.green }}>{fx.grade === 'NR' ? '—' : fx.flags.length}</td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.red }}>{fx.flags[0] || (fx.grade === 'NR' ? '' : '—')}</td>
                      </tr>
                      {isOpen && (
                        <tr key={s.name + ':d'}><td colSpan={5} style={{ padding: '0 8px' }}>
                          <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px', display: 'grid', gap: 8 }}>
                            <div style={{ fontSize: F.xs, fontWeight: 800, color: C.red }}>
                              12 FORENSIC CHECKS (higher = cleaner) — grade is the WORST of score band vs flag count{fx.critical ? ' · ☠ CRITICAL flag present ⇒ AVOID' : ''}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
                              {fx.checks.map((ch) => {
                                const nd = ch.pts === null;
                                const col = nd ? C.muted : ch.pts === ch.w ? C.green : ch.pts! > 0 ? C.amber : C.red;
                                return (
                                  <div key={ch.id} style={{ background: nd ? C.panel : C.bg, border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs }}>
                                      <span style={{ color: C.body }}><span style={{ color: col }}>●</span> {ch.label} · {ch.detail}</span>
                                      <span style={{ fontWeight: 900, color: col, whiteSpace: 'nowrap' }}>{nd ? 'n/a' : ch.pts + '/' + ch.w}</span>
                                    </div>
                                    {ch.flag && <div style={{ fontSize: F.xs, color: C.red, marginTop: 2 }}>🚩 {ch.flag}</div>}
                                  </div>
                                );
                              })}
                            </div>
                            {fx.workbook.length > 0 && (
                              <div style={{ borderTop: '1px dashed ' + C.line, paddingTop: 6 }}>
                                <div style={{ fontSize: F.xs, fontWeight: 800, color: C.amber }}>FRAUD-CHECKLIST ANSWERS (your workbook) — each adverse −3, cap −15</div>
                                {fx.workbook.map((wkb) => (
                                  <div key={wkb.row} style={{ fontSize: F.xs, color: wkb.answer === 'adverse' ? C.red : C.green }}>
                                    {wkb.answer === 'adverse' ? '⚠' : '✓'} {wkb.label} <span style={{ color: C.dim }}>(row {wkb.row})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            The fraud-checklist tab of your workbook, codified: cash conversion · receivable/inventory games · other-income crutch · tax sanity · phantom cash · stuck CWIP · dilution · dividend funding · depreciation games. CLEAN ≥80 · WATCH 60-79 · FLAGS 40-59 · AVOID &lt;40 — but flags override: 1 flag caps at WATCH, 2-3 at FLAGS, ≥4 or any CRITICAL ⇒ AVOID.
          </div>
        </>
      )}

      {/* ═══ 🎙 CONCALL ═══ */}
      {tab === 'concall' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ ...card, border: '1px solid ' + C.gold + '55' }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>➕ Add a transcript</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <select value={ccCompany} onChange={(e) => setCcCompany(e.target.value)} style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.sm }}>
                <option value="">— pick a company —</option>
                {scored.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <input placeholder='label, e.g. "Q2 FY26 — 12 Nov 2025"' value={ccLabel} onChange={(e) => setCcLabel(e.target.value)}
                style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.sm }} />
              <textarea placeholder="paste the management commentary + Q&A here…" value={ccText} onChange={(e) => setCcText(e.target.value)} rows={9}
                style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.xs, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => addTranscript(ccCompany, ccLabel, ccText)} style={{ ...pill(true, C.gold), border: '1px solid ' + C.gold }}>💾 Save + extract</button>
                <input ref={ccFileRef} type="file" accept=".txt,.pdf,.pptx,.ppt" style={{ fontSize: F.xs, color: C.dim, maxWidth: 180 }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      try {
                        if (/\.ppt$/i.test(f.name)) setMsg('⚠ Legacy binary .ppt cannot be parsed in the browser — export it as PDF (or .pptx) and upload that.');
                        else setCcText(capTranscript((/\.pdf$/i.test(f.name) ? await extractPdfText(await f.arrayBuffer()) : /\.pptx$/i.test(f.name) ? await extractPptxText(await f.arrayBuffer()) : await f.text()).trim()));
                      } catch (err: any) { setMsg('Failed to read ' + f.name + ': ' + (err?.message || err)); }
                    }
                    if (ccFileRef.current) ccFileRef.current.value = '';
                  }} />
              </div>
              <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6 }}>
                .pdf / .pptx / .txt or paste (legacy .ppt → export as PDF first) · max 300k chars · 8 transcripts per company · stored ONLY in this browser (separate from company data — survives "Clear all").
                Extraction is sentence-scoped and heuristic: utilization %, order book (Cr), capex guidance, commissioning timeline, anchor/booked %, tone. Tip: drop PDFs straight on the main upload — they auto-attach by company name.
              </div>
              {Object.keys(concalls).length > 0 && <button onClick={clearTranscripts} style={{ ...pill(false, C.red), justifySelf: 'start' }}>Clear transcripts</button>}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {(concalls[KU] ?? []).length > 0 && (
              <div style={{ ...card, border: '1px solid ' + C.amber + '88' }}>
                <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>📎 UNASSIGNED uploads · {(concalls[KU] ?? []).length}</div>
                <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>These files matched zero (or several) stored companies. Pick the company and Assign — extraction is already done and applies instantly.</div>
                {(concalls[KU] ?? []).map((en) => (
                  <div key={en.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid ' + C.line, padding: '6px 0' }}>
                    <b style={{ fontSize: F.sm }}>{en.label}</b>
                    <span style={{ fontSize: F.xs, color: C.dim }}>{new Date(en.addedAt).toLocaleDateString()} · {(en.chars / 1000).toFixed(1)}k chars</span>
                    <span style={{ fontSize: F.xs, color: C.dim }}>
                      {en.extract.utilization !== null && <>util <b style={{ color: C.gold }}>{en.extract.utilization}%</b> · </>}
                      {en.extract.orderBook !== null && <>order book <b style={{ color: C.gold }}>{en.extract.orderBook.toLocaleString()} Cr</b></>}
                    </span>
                    <span style={{ flex: 1 }} />
                    <select value={assignSel[en.id] ?? ''} onChange={(e) => setAssignSel({ ...assignSel, [en.id]: e.target.value })}
                      style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '4px 6px', fontSize: F.xs, maxWidth: 220 }}>
                      <option value="">— pick company —</option>
                      {scored.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                    <button onClick={() => assignUnassigned(en.id, assignSel[en.id] ?? '')} style={{ ...pill(true, C.amber), border: '1px solid ' + C.amber }}>Assign</button>
                    <button onClick={() => deleteTranscript(KU, en.id)} style={{ ...pill(false, C.red), padding: '2px 8px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {intel.filter(({ s }) => (concalls[ckey(s.name)] ?? []).length > 0).map(({ s, cc }) => (
              <div key={s.name} style={card}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: F.md, fontWeight: 800 }}>{s.name}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 800, color: cc.freshness === 'FRESH' ? C.green : cc.freshness === 'STALE' ? C.amber : C.muted }}>
                    {cc.freshness === 'FRESH' ? '🟢 FRESH' : cc.freshness === 'STALE' ? '🟡 STALE' : '⚪ OLD'}
                  </span>
                  {cc.tone !== null && <span style={{ fontSize: F.xs, color: cc.tone >= 0.65 ? C.green : cc.tone < 0.4 ? C.red : C.amber }}>tone {(cc.tone * 100).toFixed(0)}% positive</span>}
                </div>
                <ConcallChips s={s} />
                {(concalls[ckey(s.name)] ?? []).map((en) => {
                  const isOpen = ccView === en.id;
                  const ex = en.extract;
                  return (
                    <div key={en.id} style={{ borderTop: '1px solid ' + C.line, padding: '6px 0' }}>
                      <div onClick={() => setCcView(isOpen ? null : en.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: F.sm }}>{en.label}</b>
                        <span style={{ fontSize: F.xs, color: C.dim }}>{new Date(en.addedAt).toLocaleDateString()} · {(en.chars / 1000).toFixed(1)}k chars</span>
                        {ex.tone !== null && (
                          <span style={{ width: 70, height: 5, borderRadius: 3, background: C.red + '55', overflow: 'hidden', display: 'inline-block' }} title={ex.optimism + ' positive / ' + ex.caution + ' cautious sentences'}>
                            <span style={{ display: 'block', width: (ex.tone * 100) + '%', height: '100%', background: C.green }} />
                          </span>
                        )}
                        {ex.anchorPct !== null && <span style={{ fontSize: F.xs, color: C.dim }}>booked <b style={{ color: C.gold }}>{ex.anchorPct}%</b></span>}
                        <span style={{ fontSize: F.xs, fontWeight: 700, color: C.dim }}>{isOpen ? '▲ close transcript' : '▼ read transcript'}</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={(e) => { e.stopPropagation(); deleteTranscript(ckey(s.name), en.id); }} style={{ ...pill(false, C.red), padding: '2px 8px' }}>✕</button>
                      </div>
                      <HandbookChip text={en.text} />
                      <SignalCards ex={ex} />
                      {ex.timeline.length > 1 && (
                        <div style={{ fontSize: F.xs, color: C.teal, lineHeight: 1.6, marginTop: 2 }}>
                          {ex.timeline.slice(1).map((tl, ti) => <div key={ti}>📅 <i style={{ color: C.body }}>“{tl}”</i></div>)}
                        </div>
                      )}
                      {isOpen && (
                        <pre style={{ maxHeight: 420, overflowY: 'auto', fontSize: F.sm, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: C.bg, border: '1px solid ' + C.line, borderRadius: 8, padding: 12, marginTop: 6, color: C.body, fontFamily: 'inherit' }}>
                          {markText(en.text, ex.quotes)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!intel.some(({ s }) => (concalls[ckey(s.name)] ?? []).length > 0) && !(concalls[KU] ?? []).length && (
              <div style={{ ...card, textAlign: 'center', padding: 30, color: C.body, fontSize: F.sm, lineHeight: 1.65 }}>
                No transcripts yet. Upload the concall PDF/PPTX on the main file picker (it auto-attaches by company name) or paste it on the left — the page extracts utilization, order book, capex guidance and tone, and suggests one-click updates to the capex engine (provenance preserved as "(concall)").
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 🧭 VERDICT ═══ */}
      {tab === 'concallpro' && <ConcallPro C={C} />}
      {tab === 'verdict' && scored.length > 0 && (() => {
        const ranked = [...intel].sort((a, b) => (a.verdict.veto === b.verdict.veto ? b.verdict.composite - a.verdict.composite : a.verdict.veto ? 1 : -1));
        const vCounts: Record<string, number> = {};
        ranked.forEach(({ verdict }) => { vCounts[verdict.call] = (vCounts[verdict.call] || 0) + 1; });
        const top5 = ranked.filter(({ verdict }) => !verdict.veto && verdict.call !== '🧩 NEEDS DATA' && verdict.call !== '🔍 FORENSIC REVIEW FIRST').slice(0, 5);
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(300px, 380px)', gap: 12, marginBottom: 12, alignItems: 'stretch' }}>
              <div style={card}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: C.orange, textTransform: 'uppercase' as const, marginBottom: 8 }}>Call distribution</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignContent: 'flex-start' }}>
                  {Object.entries(vCounts).map(([call, n]) => (
                    <span key={call} style={{ fontSize: F.xs, padding: '4px 10px', borderRadius: 14, fontWeight: 800, background: (VERDICT_COLOR[call] || C.dim) + '1A', border: '1px solid ' + (VERDICT_COLOR[call] || C.dim) + '66', color: VERDICT_COLOR[call] || C.dim }}>
                      {call} · {n}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6, marginTop: 10 }}>
                  One fused call per name: capex quality × timing, multibagger DNA and forensics, with the forensic veto on top. Composite ranks the table; the WHY column is the action line.
                </div>
              </div>
              <div style={{ ...card, border: '1px solid ' + C.gold + '66' }}>
                <div style={{ fontSize: F.sm, fontWeight: 800, color: C.gold, marginBottom: 4 }}>🏆 TOP 5 — highest composite, no vetoes</div>
                {top5.map(({ s, verdict }, i) => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.sm, padding: '3px 0', borderTop: i ? '1px solid ' + C.line : 'none' }}>
                    <span><b style={{ color: C.muted }}>{i + 1}.</b> <b>{s.name}</b> <span style={{ fontSize: F.xs, color: verdict.color }}>{verdict.call}</span></span>
                    <b style={{ color: C.gold }}>{verdict.composite.toFixed(0)}</b>
                  </div>
                ))}
                {!top5.length && <div style={{ fontSize: F.xs, color: C.dim }}>Nothing clears the vetoes yet.</div>}
              </div>
            </div>
            <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
              <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
                <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                  {['COMPANY', 'COMPOSITE', 'CAPEX', 'STAGE / ENTRY', '🚀 MB', '🔬 FORENSIC', '🎙 CONCALL', 'VERDICT', 'WHY / ACTION'].map((hh, i) => (
                    <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>{hh}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ranked.map(({ s, mb, fx, cc, verdict }) => (
                    <tr className="cxr" key={s.name} style={{ borderBottom: '1px solid ' + C.line, opacity: verdict.veto ? 0.75 : 1 }}>
                      <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, fontSize: 19, fontVariantNumeric: 'tabular-nums', color: verdict.veto ? C.muted : C.txt }}>{verdict.composite.toFixed(0)}</td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision} {s.final}</span>
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}><StageChip stage={s.stage} /> <span style={{ fontSize: 10, color: s.entryColor, fontWeight: 700 }}>{s.entryShort}</span></td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: mb.color + '22', color: mb.color, border: '1px solid ' + mb.color + '55' }}>{mb.grade === 'NR' ? 'NR' : mb.score + ' ' + mb.grade}</span>
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: fx.color + '22', color: fx.color, border: '1px solid ' + fx.color + '55' }}>{fx.grade === 'NR' ? 'NR' : fx.score + ' ' + fx.grade}</span>
                        {fx.flags.length > 0 && <span style={{ fontSize: 10, color: C.red }}> {fx.flags.length}🚩</span>}
                      </td>
                      <td style={{ padding: '8px 8px', fontSize: F.xs, whiteSpace: 'nowrap', color: cc.freshness === 'FRESH' ? C.green : cc.freshness === 'STALE' ? C.amber : C.muted }}>
                        {cc.freshness === 'NONE' && !cc.latest ? '—' : (cc.freshness === 'FRESH' ? '🟢' : cc.freshness === 'STALE' ? '🟡' : '⚪') + (cc.tone !== null ? ' ' + (cc.tone! * 100).toFixed(0) + '%+' : '')}
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: F.xs, fontWeight: 900, padding: '3px 10px', borderRadius: 10, background: verdict.color + '1E', color: verdict.color, border: '1px solid ' + verdict.color + '66' }}>{verdict.call}</span>
                      </td>
                      <td style={{ padding: '8px 8px', fontSize: F.sm, color: C.body, lineHeight: 1.55, minWidth: 300 }}>{verdict.why} <span style={{ color: C.body }}>{verdict.note}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
              Composite = 0.40×capex + 0.35×multibagger + 0.25×forensic (renormalized when a lens is NR) − 15 on forensic FLAGS; forensic AVOID/critical vetoes everything and pins to the bottom. Fresh cautious concalls demote one rung; fresh bullish calls with util ≥75% get the 🔥 tag. Not investment advice.
            </div>
          </>
        );
      })()}

      {/* ═══ MODEL ═══ */}
      {tab === 'model' && <ModelTab card={card} />}
    </div>
  );
}


