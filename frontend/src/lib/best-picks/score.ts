// zzz1305 — DAILY BEST PICKS: the confluence score. Pure (no I/O), unit-tested in lib/__tests__/zzz1305-best-picks.test.ts.
//
// A pick needs EVIDENCE from at least two independent families, one of them a catalyst:
//   EARNINGS  BLOCKBUSTER 25 / STRONG 18 (Earnings Opportunities, last 45 days)
//   GUIDANCE  verified formal raise 20, unverified raise 12 (Guidance Upgrades archive)
//   EVENT     Transformational Gainers: multibagger chance HIGH 20 / MEDIUM 12
//   RADAR     Transformation Radar: CONFIRMED 20 / research WATCH 10
//   SETUP     chart: Options Ideas A+ 15 / A 10, or on a rising 50 / 200-day / breakout retest 10
// Quality adds a little (RS ≥ 70 +5, Rule of 40 ≥ 40 or ROCE ≥ 20 +5) but is never a family. Price is never a catalyst.
// A result and the guidance given with it (dates ≤ 5 days apart) are close to one fact: they count as 1.5 families, not 2.
// 3 or more families → × 1.15.
// Vetoes keep a name off the top list and say why; a large company is left out altogether (owner's small / mid rule).
import { cheatSetup } from '@/lib/cheat-entry-setup';
import { rewardedWhy } from '@/lib/rewarded';

export type Mkt = 'IN' | 'US';
export type Family = 'EARNINGS' | 'GUIDANCE' | 'EVENT' | 'RADAR' | 'SETUP';
export const CATALYST_FAMILIES: readonly Family[] = ['EARNINGS', 'GUIDANCE', 'EVENT', 'RADAR'];
export const FAMILY_WORD: Record<Family, string> = { EARNINGS: 'Earnings', GUIDANCE: 'Guidance', EVENT: 'Business event', RADAR: 'Transformation Radar', SETUP: 'Chart setup' };

export const MAX_CATALYST_AGE_DAYS = 45;
export const LARGE_CAP: Record<Mkt, number> = { IN: 30_000, US: 10_000 };      // ₹ Cr / $ million
export const MIN_TRADED: Record<Mkt, number> = { IN: 3, US: 3 };               // ₹ Cr / $ million a day
export const RESULTS_SOON_DAYS = 7;                                            // ≈ 5 sessions
export const MAX_TOP = 7;
export const REPEAT_AFTER_DAYS = 14;

export interface Evidence {
  family: Family; tool: string; points: number; line: string;
  /** YYYY-MM-DD of the event (the filing / result / setup day) */
  date: string | null;
  /** stable id — a new id is a new catalyst for the repeat rule */
  id: string;
  url?: string | null;
  /** SETUP only: the setup has triggered (price through the trigger) */
  triggered?: boolean;
  /** SETUP only: entry plan from the chart setup */
  plan?: { trigger: number; stop: number; target1: number | null; riskPct: number } | null;
}
export interface Tech {
  px: number | null; chg: number | null; mc: number | null; sma50: number | null; sma200: number | null; ema21: number | null;
  stage: number | null; health: number | null; rs: number | null; p3m: number | null; p1y: number | null;
  /** traded value a day: ₹ Cr (IN) / $ million (US) */
  traded: number | null;
  r40: number | null; roce: number | null; de: number | null; name: string | null; industry: string | null;
}
export interface Candidate {
  market: Mkt; ticker: string; company: string; evidence: Evidence[]; tech: Tech | null;
  held: boolean;
  /** logbook REJECTED mark (date) — vetoes unless a catalyst is newer */
  rejectedOn: string | null;
  /** next results date, if known */
  resultsOn: string | null;
  /** cut guidance in the window */
  guidanceCut: string | null;
}
export type RegimeKind = 'BULL' | 'RECOVERY' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'UNKNOWN';
export interface MarketRegime { kind: RegimeKind; note: string | null; drawdownPct: number | null; vix: number | null; vixBand: string | null; above50: number | null; above200: number | null; indexName: string | null; indexChg: number | null }

export interface Scored {
  market: Mkt; ticker: string; company: string; held: boolean;
  score: number; families: Family[]; familyCount: number;
  evidence: Evidence[];               // counted evidence (best per family first)
  quality: string[];
  vetoes: string[];                   // block the top list
  warnings: string[];                 // shown as risks
  excluded: string | null;            // left out of the email altogether
  entry: { kind: string; stop: number | null; riskPct: number | null; trigger: number | null } | null;
  rewarded: string | null;
  resultsOn: string | null;
  tech: Tech | null;
  breakdown: string[];                // every point and every veto, for the dry run
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toString();

/** Regime rules: how many top picks, whether only support / retest entries count, and the size note. */
export function regimeRule(k: RegimeKind): { maxTop: number; supportOnly: boolean; size: string; word: string } {
  switch (k) {
    case 'BULL': return { maxTop: MAX_TOP, supportOnly: false, size: 'normal size', word: 'aggressive — dips are buyable' };
    case 'RECOVERY': return { maxTop: MAX_TOP, supportOnly: false, size: 'normal size', word: 'post-sell-off window — best time for new longs' };
    case 'PULLBACK': return { maxTop: 4, supportOnly: true, size: 'half size', word: 'careful — support entries only' };
    case 'CORRECTION': return { maxTop: 4, supportOnly: true, size: 'half size', word: 'defensive — support / retest entries only' };
    case 'BEAR': return { maxTop: 0, supportOnly: true, size: 'no new longs', word: 'defensive — no new long picks, watch only' };
    default: return { maxTop: 4, supportOnly: true, size: 'half size', word: 'regime unknown — treated as CORRECTION' };
  }
}

export function scoreCandidate(c: Candidate, today: string): Scored {
  const breakdown: string[] = [];
  const vetoes: string[] = []; const warnings: string[] = []; const quality: string[] = [];
  const t = c.tech;
  let excluded: string | null = null;

  // fresh evidence only; best item per family
  const fresh = c.evidence.filter((e) => e.family === 'SETUP' || !e.date || daysBetween(e.date, today) <= MAX_CATALYST_AGE_DAYS);
  for (const e of c.evidence) if (!fresh.includes(e)) breakdown.push(`· ${e.tool}: older than ${MAX_CATALYST_AGE_DAYS} days — not counted`);
  const best = new Map<Family, Evidence>();
  for (const e of fresh) { const b = best.get(e.family); if (!b || e.points > b.points) best.set(e.family, e); }
  // the chart setup we can check ourselves: a rising 50 / 200-day under the price
  if (t && t.px != null && t.sma50 != null && t.sma200 != null) {
    const cs = cheatSetup(t.px, t.sma50, t.sma200);
    if (cs && (cs.setup === 'AT_50' || cs.setup === 'AT_200')) {
      const e: Evidence = { family: 'SETUP', tool: 'Entry Desk', points: 10, line: `${cs.setup === 'AT_200' ? 'retesting the 200-day' : 'resting on the 50-day'} (stop ${fmt1(cs.riskPct ?? 0)}% away)`, date: today, id: `entry:${cs.setup}`, plan: null };
      const b = best.get('SETUP');
      if (!b || b.points < 10) best.set('SETUP', e);
    }
  }
  const counted = [...best.values()].sort((a, b) => b.points - a.points);
  let score = 0;
  for (const e of counted) { score += e.points; breakdown.push(`+${e.points} ${FAMILY_WORD[e.family]} · ${e.tool}: ${e.line}`); }

  // quality points (never a family)
  if (t?.rs != null && t.rs >= 70) { score += 5; quality.push(`RS ${Math.round(t.rs)}`); breakdown.push(`+5 relative strength ${Math.round(t.rs)}`); }
  if ((t?.r40 != null && t.r40 >= 40) || (t?.roce != null && t.roce >= 20)) {
    score += 5;
    const w = t!.r40 != null && t!.r40 >= 40 ? `Rule of 40 ${Math.round(t!.r40)}` : `ROCE ${Math.round(t!.roce!)}%`;
    quality.push(w); breakdown.push(`+5 ${w}`);
  }

  // confluence
  const fams = counted.map((e) => e.family);
  let familyCount = fams.length;
  const er = best.get('EARNINGS'), gu = best.get('GUIDANCE');
  if (er && gu && er.date && gu.date && Math.abs(daysBetween(er.date, gu.date)) <= 5) { familyCount -= 0.5; breakdown.push('· result + guidance from the same filing: counted as 1.5 families'); }
  const catalysts = fams.filter((f) => CATALYST_FAMILIES.includes(f)).length;
  if (familyCount >= 3) { score = Math.round(score * 1.15); breakdown.push(`× 1.15 — ${familyCount} families agree`); }

  // ── exclusions (left out entirely)
  const mc = t?.mc ?? null;
  if (mc != null && mc > LARGE_CAP[c.market]) excluded = `large company (${c.market === 'IN' ? `₹${Math.round(mc).toLocaleString('en-IN')} Cr` : `$${fmt1(mc / 1000)}B`}) — small / mid only`;
  if (c.rejectedOn) {
    const newer = counted.some((e) => e.family !== 'SETUP' && e.date && e.date > c.rejectedOn!.slice(0, 10));
    if (!newer) excluded = excluded || `you marked it REJECTED on ${c.rejectedOn.slice(0, 10)} and nothing new since`;
    else warnings.push(`you rejected it on ${c.rejectedOn.slice(0, 10)} — new evidence since`);
  }

  // ── vetoes (watch list, with the reason)
  if (catalysts < 1) vetoes.push('no catalyst — chart only');
  else if (familyCount < 2) vetoes.push('only one family of evidence');
  if (!t) vetoes.push('no price / trend data to confirm');
  else {
    if (t.stage != null && t.stage !== 2) vetoes.push(`weekly Stage ${t.stage}, not Stage 2`);
    if (t.stage === 2 && t.health === 0) vetoes.push('Stage 2 is weakening (topping risk)');
    if (t.px != null && t.sma200 != null && t.px < t.sma200) vetoes.push('below its 200-day line');
    if (t.traded != null && t.traded < MIN_TRADED[c.market]) vetoes.push(`thin trading (${c.market === 'IN' ? `₹${fmt1(t.traded)} Cr` : `$${fmt1(t.traded)}M`} a day)`);
  }
  if (c.guidanceCut) vetoes.push(`guidance cut on ${c.guidanceCut}`);
  const rw = t ? rewardedWhy({ p3m: t.p3m, p1y: t.p1y, rs: t.rs }) : { rewarded: null, why: [] };
  const rewarded = rw.rewarded ? rw.why.join(' · ') || 'already ran' : null;
  if (rewarded) vetoes.push(`already rewarded (${rewarded}) — wait for a pullback`);
  if (c.resultsOn) {
    const d = daysBetween(today, c.resultsOn);
    if (d >= 0 && d <= RESULTS_SOON_DAYS) warnings.push(`results ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`} (${c.resultsOn})`);
  }
  if (t?.de != null && t.de > 1) warnings.push(`debt ÷ equity ${fmt1(t.de)}`);
  for (const v of vetoes) breakdown.push(`✕ ${v}`);
  for (const w of warnings) breakdown.push(`! ${w}`);
  if (excluded) breakdown.push(`⊘ left out: ${excluded}`);

  // entry: a chart setup's own plan first, else the moving average under the price
  let entry: Scored['entry'] = null;
  const st = best.get('SETUP');
  if (st?.plan) entry = { kind: st.line, stop: st.plan.stop, riskPct: st.plan.riskPct, trigger: st.plan.trigger };
  else if (t && t.px != null && t.sma50 != null && t.sma200 != null) {
    const cs = cheatSetup(t.px, t.sma50, t.sma200);
    if (cs && cs.stopMa && cs.riskPct != null) entry = { kind: cs.setup === 'EXTENDED' ? 'extended above the 50-day — wait' : cs.setup === 'DRIFT' ? 'between averages' : cs.setup === 'AT_200' ? '200-day retest' : '50-day pullback', stop: t.px * (1 - cs.riskPct / 100), riskPct: cs.riskPct, trigger: null };
  }
  if (entry?.riskPct != null && entry.riskPct < 1.5 && !vetoes.length) {
    const w = `stop only ${fmt1(entry.riskPct)}% away — normal daily moves can hit it; use a closing-price stop`;
    warnings.push(w); breakdown.push(`! ${w}`);
  }
  return { market: c.market, ticker: c.ticker, company: c.company, held: c.held, score, families: fams, familyCount, evidence: counted, quality, vetoes, warnings, excluded, entry, rewarded, resultsOn: c.resultsOn, tech: t, breakdown };
}

/** A support-type entry for the defensive regimes: on the 50 / 200-day, or a breakout retest. */
export function hasSupportEntry(s: Scored): boolean {
  const st = s.evidence.find((e) => e.family === 'SETUP');
  return !!st && (st.tool === 'Entry Desk' || /retest/i.test(st.line));
}

// ── repeat rule ─────────────────────────────────────────────────────────────
export interface SentRecord { date: string; score: number; ids: string[]; triggered: boolean }
export type SentMap = Record<string, SentRecord>;
export const sentKey = (s: Pick<Scored, 'market' | 'ticker'>) => `${s.market}:${s.ticker}`;
export type Freshness = 'NEW' | 'NEW CATALYST' | 'UPGRADED' | 'TRIGGERED' | 'REPEAT';
export function freshnessOf(s: Scored, prev: SentRecord | undefined, today: string): Freshness {
  if (!prev || daysBetween(prev.date, today) >= REPEAT_AFTER_DAYS) return 'NEW';
  const ids = s.evidence.map((e) => e.id);
  if (ids.some((id) => !id.startsWith('entry:') && !prev.ids.includes(id))) return 'NEW CATALYST';
  if (s.score >= prev.score + 10) return 'UPGRADED';
  if (s.evidence.some((e) => e.triggered) && !prev.triggered) return 'TRIGGERED';
  return 'REPEAT';
}

export interface Selection {
  top: Array<Scored & { fresh: Freshness }>;
  addOn: Array<Scored & { fresh: Freshness }>;     // already held, qualifies
  stillValid: Scored[];                            // qualifies, sent before, nothing new
  nearMiss: Scored[];                              // best names that missed by one check
  newCatalysts: Scored[];                          // fresh catalyst (≤ 3 days), not on the top list
  rewardedWatch: Scored[];
  regimeHeld: Scored[];                            // would qualify, held back by the market regime
  excluded: Scored[];
}

/** Choose the email's lists from scored candidates. Pure. */
export function selectPicks(all: Scored[], regimes: Record<Mkt, MarketRegime | null>, sent: SentMap, today: string): Selection {
  const sel: Selection = { top: [], addOn: [], stillValid: [], nearMiss: [], newCatalysts: [], rewardedWatch: [], regimeHeld: [], excluded: [] };
  const ranked = [...all].sort((a, b) => b.score - a.score || b.familyCount - a.familyCount || a.ticker.localeCompare(b.ticker));
  const perMarket: Record<Mkt, number> = { IN: 0, US: 0 };
  let resultsSoon = 0;
  const onTop = new Set<string>();
  for (const s of ranked) {
    if (s.excluded) { sel.excluded.push(s); continue; }
    const qualifies = s.vetoes.length === 0;
    if (!qualifies) continue;
    const rule = regimeRule(regimes[s.market]?.kind ?? 'UNKNOWN');
    if (rule.supportOnly && !hasSupportEntry(s)) { sel.regimeHeld.push(s); continue; }
    const fresh = freshnessOf(s, sent[sentKey(s)], today);
    if (s.held) { sel.addOn.push({ ...s, fresh }); onTop.add(sentKey(s)); continue; }
    if (fresh === 'REPEAT') { sel.stillValid.push(s); onTop.add(sentKey(s)); continue; }
    if (perMarket[s.market] >= rule.maxTop || sel.top.length >= MAX_TOP) { sel.regimeHeld.push(s); continue; }
    const soon = s.warnings.some((w) => w.startsWith('results '));
    if (soon && resultsSoon >= 2) { sel.nearMiss.push(s); continue; }
    if (soon) resultsSoon++;
    sel.top.push({ ...s, fresh }); perMarket[s.market]++; onTop.add(sentKey(s));
  }
  for (const s of ranked) {
    if (s.excluded || onTop.has(sentKey(s))) continue;
    if (s.rewarded && s.evidence.some((e) => e.family !== 'SETUP')) { sel.rewardedWatch.push(s); continue; }
    const catalystFresh = s.evidence.some((e) => e.family !== 'SETUP' && e.date && daysBetween(e.date, today) <= 3);
    if (s.vetoes.length === 1 && s.score >= 30 && !s.vetoes[0].startsWith('already rewarded')) sel.nearMiss.push(s);
    else if (catalystFresh) sel.newCatalysts.push(s);
  }
  sel.nearMiss = sel.nearMiss.slice(0, 5);
  sel.newCatalysts = sel.newCatalysts.slice(0, 10);
  sel.rewardedWatch = sel.rewardedWatch.slice(0, 6);
  sel.stillValid = sel.stillValid.slice(0, 12);
  sel.regimeHeld = sel.regimeHeld.slice(0, 8);
  return sel;
}

/** What gets stored after a send: the top + add-on names (still-valid names keep their old record). */
export function nextSent(prev: SentMap, sel: Selection, today: string): SentMap {
  const out: SentMap = {};
  for (const [k, v] of Object.entries(prev)) if (daysBetween(v.date, today) < 60) out[k] = v;
  for (const s of [...sel.top, ...sel.addOn]) out[sentKey(s)] = { date: today, score: s.score, ids: s.evidence.map((e) => e.id), triggered: s.evidence.some((e) => e.triggered) };
  return out;
}
