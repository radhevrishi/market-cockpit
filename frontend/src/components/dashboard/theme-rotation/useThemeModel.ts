'use client';
// zzz1290 — the Theme Rotation model (board + evidence inputs + view model) as one hook, so the Theme Rotation tab and the
// Market Leadership & Risk page read the SAME engine. Moved verbatim out of ThemeRotationTab; no logic change.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Market, PrintInput } from '@/lib/theme-rotation/types';
import { buildViewModel } from '@/lib/theme-rotation/view-model';
import { membershipFrom, catalystsByTheme, themesForTicker, sanitizeTicker, earningsFromBench, earningsFromGraded } from '@/lib/theme-rotation/evidence-inputs';
import { buildListEntries, isCashLine, type ListEntry } from '@/lib/theme-rotation/lists';
import { isoWeek } from '@/lib/theme-rotation/history';
import { smallMidBeneficiaries, type Candidate } from '@/lib/theme-rotation/analytics';
import { splitPrints } from '@/lib/theme-rotation/layers';
import { classifyThemeDetailed, type ClassifyResult } from '@/lib/theme-classify';
import { themesForRegion, drillSymbolsFor, sizeClass } from '@/lib/theme-universe';
import { useBoard, useHistory, useClientLists, useNseIndustry, useCatalysts, useGradedHistory, useUsProfiles, CATALYST_WINDOW_DAYS } from './useThemeRotationData';

export function useThemeRotationModel(region: Market, reloadKey: number) {
  const board = useBoard(region);
  const history = useHistory(region, reloadKey);
  const lists = useClientLists(region, reloadKey);
  const catalysts = useCatalysts(region, reloadKey);
  const [missing, setMissing] = useState<string[]>([]);
  const { map: nse, pending: nsePending } = useNseIndustry(region, missing);

  const payload = board.payload && !board.payload.error && Array.isArray(board.payload.themes) ? board.payload : null;
  const defs = useMemo(() => themesForRegion(region), [region]);
  const themeMembers = useMemo(() => Object.fromEntries(defs.map((t) => [t.id, drillSymbolsFor(t)])), [defs]);
  const membership = useMemo(() => membershipFrom(themeMembers), [themeMembers]);

  // ── names on your lists, classified ────────────────────────────────────
  // zzz797 — a held name on no list carries no sector, so it went unmatched.
  // Now, after the sector / industry rungs: the SEC industry code (US), then
  // theme-universe membership (the name is a declared constituent), and only
  // then the company-name / ticker guesses.
  const makeClassify = useCallback((sec: Record<string, { sic?: string | null; sicDescription?: string | null; status?: string }>) => (e: { ticker: string; sector?: string | null; industry?: string | null; company?: string | null }): ClassifyResult | null => {
    const n = region === 'india' ? nse[e.ticker] : undefined;
    const p = region === 'us' ? sec[e.ticker] : undefined;
    const c = classifyThemeDetailed(e.sector || n, e.industry || n, region, e.ticker, e.company, p ? { sic: p.sic, description: p.sicDescription } : null);
    if (c && c.via !== 'name' && c.via !== 'ticker') return c;
    const m = membership.get(sanitizeTicker(e.ticker));
    if (m && m.size) return { theme: [...m][0], via: 'constituent' };
    return c;
  }, [region, nse, membership]);
  const preEntries: ListEntry[] = useMemo(() => buildListEntries(lists.tech, lists.fundo, lists.bench, lists.held, makeClassify({})), [lists, makeClassify]);
  // SEC look-ups: holdings first (they matter most), then unplaced list names.
  const secWanted = useMemo(() => region !== 'us' ? [] : [
    ...preEntries.filter((e) => e.held && !lists.nonUs.has(e.ticker) && !isCashLine(e.ticker)).map((e) => e.ticker),
    ...preEntries.filter((e) => !e.held && !e.theme).map((e) => e.ticker),
    // zzz797 — the US bench's own labels are coarse ("IT"), which piled its
    // prints into a handful of themes and left the rest "no data"; the SEC
    // code places each bench name properly.
    ...preEntries.filter((e) => e.inBench && e.theme && e.via !== 'override').map((e) => e.ticker),
  ], [region, preEntries, lists.nonUs]);
  const { map: secMap } = useUsProfiles(region, secWanted);
  const entries: ListEntry[] = useMemo(() => (region === 'us' ? buildListEntries(lists.tech, lists.fundo, lists.bench, lists.held, makeClassify(secMap)) : preEntries), [region, lists, makeClassify, secMap, preEntries]);
  useEffect(() => {
    // Unplaced names, and names placed only by their company name or ticker:
    // a real industry is a better answer, so both are looked up (India).
    const m = entries.filter((e) => !e.theme || e.via === 'name' || e.via === 'ticker').map((e) => e.ticker);
    setMissing((prev) => (prev.length === m.length && prev.every((x, i) => x === m[i]) ? prev : m));
  }, [entries]);
  const entryTheme = useMemo(() => new Map(entries.map((e) => [e.ticker, e.theme])), [entries]);
  const themesOf = useCallback((ticker: string) => themesForTicker(ticker, membership, entryTheme.get(sanitizeTicker(ticker)) ?? null), [membership, entryTheme]);

  // ── browser-side evidence ──────────────────────────────────────────────
  const graded = useGradedHistory(region, reloadKey);
  // Graded results carry their own sector; classify each company once.
  const gradedTheme = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of graded.rows || []) {
      const t = sanitizeTicker(r.ticker); if (!t || m.has(t)) continue;
      const n = nse[t];
      const c = entryTheme.get(t) ?? classifyThemeDetailed(r.sector || n, r.sector || n, region, t, r.company)?.theme ?? null;
      m.set(t, c);
    }
    return m;
  }, [graded.rows, nse, entryTheme, region]);
  const gradedThemesOf = useCallback((ticker: string) => themesForTicker(ticker, membership, gradedTheme.get(sanitizeTicker(ticker)) ?? entryTheme.get(sanitizeTicker(ticker)) ?? null), [membership, gradedTheme, entryTheme]);

  const benchLoaded = region === 'us' ? lists.benchReady && lists.bench.length > 0 : lists.bench.length > 0;
  const benchPrints = useMemo(() => lists.bench.filter((b) => /BLOCK|STRONG/i.test(b.tier || '') && b.filing_date)
    .map((b) => ({ ticker: b.ticker, tier: String(b.tier), filingDate: String(b.filing_date), company: b.company, url: b.url, pe: b.pe } as PrintInput)), [lists.bench]);
  const themeIds = useMemo(() => defs.map((d) => d.id), [defs]);
  const earningsSource: 'graded' | 'bench' | 'none' = region === 'india' && graded.rows ? 'graded' : benchLoaded ? 'bench' : 'none';
  const earningsByTheme = useMemo(() => {
    const now = new Date();
    if (earningsSource === 'graded') return earningsFromGraded(graded.rows!, gradedThemesOf, themeIds, now);
    if (earningsSource === 'bench') return earningsFromBench(benchPrints, themesOf, themeIds, now);
    return null;
  }, [earningsSource, graded.rows, gradedThemesOf, themeIds, benchPrints, themesOf]);
  const cats = useMemo(() => (catalysts.items ? catalystsByTheme(catalysts.items, themesOf) : null), [catalysts.items, themesOf]);
  const { pesByTheme, allPEs } = useMemo(() => {
    const by: Record<string, number[]> = {}; const all: number[] = [];
    for (const b of lists.bench) {
      if (typeof b.pe !== 'number' || !(b.pe > 0)) continue;
      all.push(b.pe);
      for (const th of themesOf(b.ticker)) (by[th] ||= []).push(b.pe);
    }
    return { pesByTheme: by, allPEs: all };
  }, [lists.bench, themesOf]);

  // ── market caps on file (US $M, India ₹ Cr) — for the small / mid filter ──
  const capMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of graded.rows || []) { const t = sanitizeTicker(r.ticker); if (t && typeof r.mcap === 'number' && r.mcap > 0) m.set(t, r.mcap); }
    for (const e of entries) if (typeof e.mcap === 'number' && e.mcap > 0) m.set(e.ticker, e.mcap);
    return m;
  }, [graded.rows, entries]);
  const capOf = useCallback((sym: string) => capMap.get(sanitizeTicker(sym)) ?? null, [capMap]);

  // Candidate small / mid names per theme: recent strong prints (graded
  // history or bench), names on your lists, declared constituents.
  const candidatesByTheme = useMemo(() => {
    const out = new Map<string, Candidate[]>();
    const push = (th: string, c: Candidate) => { (out.get(th) || out.set(th, []).get(th)!).push(c); };
    const now = new Date();
    const strong = earningsSource === 'graded'
      ? (graded.rows || []).filter((r) => /BLOCK|STRONG/i.test(r.tier)).map((r) => ({ ticker: r.ticker, tier: r.tier, filingDate: r.filingDate } as PrintInput))
      : benchPrints;
    const recent = splitPrints(strong, now).recent.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const ofT = earningsSource === 'graded' ? gradedThemesOf : themesOf;
    for (const p of recent) for (const th of ofT(p.ticker)) push(th, { ticker: sanitizeTicker(p.ticker), cap: capOf(p.ticker), strongPrint: p.filingDate.slice(0, 10) });
    for (const e of entries) if (e.theme) push(e.theme, { ticker: e.ticker, cap: e.mcap ?? capOf(e.ticker), onList: true });
    for (const d of defs) for (const s of drillSymbolsFor(d)) push(d.id, { ticker: sanitizeTicker(s), cap: capOf(s) });
    return out;
  }, [earningsSource, graded.rows, benchPrints, gradedThemesOf, themesOf, entries, defs, capOf]);
  const beneficiariesOf = useCallback((id: string) => smallMidBeneficiaries(candidatesByTheme.get(id) || [], region), [candidatesByTheme, region]);
  // Small / mid names to price alongside the declared constituents in a drill.
  const extraFor = useCallback((id: string) => {
    const declared = new Set((defs.find((d) => d.id === id) ? drillSymbolsFor(defs.find((d) => d.id === id)!) : []).map(sanitizeTicker));
    const out: string[] = [];
    for (const c of candidatesByTheme.get(id) || []) {
      const t = sanitizeTicker(c.ticker);
      if (!t || declared.has(t) || out.includes(t) || /^\d+$/.test(t)) continue;
      if (sizeClass(t, region, c.cap ?? null) === 'large') continue;
      if (!c.strongPrint && !c.onList) continue;
      out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }, [candidatesByTheme, defs, region]);

  const currentWeek = history.currentWeek || isoWeek(new Date());
  const vm = useMemo(() => {
    if (!payload) return null;
    return buildViewModel({
      payload, now: new Date(),
      earningsByTheme,
      benchLabel: earningsSource === 'graded' ? 'India graded results history (all tiers, ~6 months)' : `${region === 'us' ? 'US' : 'India'} Conviction bench (BLOCKBUSTER / STRONG prints)`,
      catalystsByTheme: cats, catalystWindowDays: CATALYST_WINDOW_DAYS, catalystCoverageDays: catalysts.coverageDays,
      pesByTheme, allPEs, snapshots: history.snapshots, currentWeek, beneficiariesOf,
    });
  }, [payload, earningsByTheme, earningsSource, cats, catalysts.coverageDays, pesByTheme, allPEs, history.snapshots, currentWeek, beneficiariesOf, region]);

  return { board, history, lists, catalysts, nse, nsePending, payload, defs, entries, secMap, graded, earningsSource, benchLoaded, capOf, extraFor, currentWeek, vm };
}
