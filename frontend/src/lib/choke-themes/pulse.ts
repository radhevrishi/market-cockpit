// zzz1179 — THEME PULSE: how a choke-point theme is doing RIGHT NOW, from data the site already holds — no AI, no cost.
// Four plain readings, each 0–100, and one Strength score:
//   News heat      — how much important news the theme drew in the last 7 days, and whether that is rising vs the 3 weeks before
//   Bottleneck     — how often that news speaks of a squeeze (sold out, shortage, lead times, price hikes, allocation, record backlog)
//   Company proof  — the theme's own companies in the stock screener: revenue accelerating, growth level, margins; plus filed
//                    transformational events and signed key contracts in the last 60 days
//   Crowding       — how far the theme's shares already ran in a year (higher = more priced in; it LOWERS strength)
// Strength = 30% heat + 30% bottleneck + 40% company proof, minus a crowding haircut. Trend: rising / steady / cooling.
// Pure (the loader passes the inputs in), so the panel, the API and the tests share one rule.
import type { ChokeRegion, ChokeTheme } from './core';

export interface PulseNews { id: string; publishedAt: string; title: string; summary: string | null; source: string | null; url: string | null; region: string | null; tickers: string[]; importance: number | null; bottleneck: string | null; sentiment: string | null }
export interface PulseCo { t: string; revQ: number | null; revA: number | null; opm: number | null; p1y: number | null; p5y?: number | null }
export interface PulseEvent { ticker: string; date: string; headline: string; kind: string; strength: string }
export interface PulseItem { title: string; date: string; source: string | null; url: string | null; tickers: string[]; squeeze: boolean; why: string }
export interface ThemePulse {
  strength: number; label: 'STRONG' | 'BUILDING' | 'QUIET'; trend: 'RISING' | 'STEADY' | 'COOLING';
  heat: number; bottleneck: number; proof: number; crowding: number;
  news7: number; news28: number; news60: number; squeeze30: number;
  accelerating: string[]; coverage: number; medianRevQ: number | null; medianP1y: number | null;
  reasons: string[]; news: PulseItem[]; events: PulseEvent[];
}

export const SQUEEZE_RE = /\b(sold[- ]out|shortages?|short supply|tight(?:ening)? supply|supply (?:crunch|constraints?|deficit|gap)|lead[- ]times?|allocation|price (?:hikes?|increases?|rises?)|raises? prices|pricing power|record (?:backlog|orders?|order book|bookings)|backlog|capacity (?:constrain\w*|crunch|sold)|bottlenecks?|waitlists?|scarc\w+|booked (?:through|until|out)|demand outstrip\w*|can'?t keep up|rationing)\b/i;

const STOP = new Set('the and for with into from that this are its their over new next more than will have been only also such near major across driven shift shifting layer scale build connect upgrade revival services stack generation grid power policy based backed'.split(' '));
/** Search terms for a theme: the AI's keywords when given, else meaningful words of its name and choke-point text. */
export function themeTerms(t: ChokeTheme): string[] {
  const own = (t as any).keywords as string[] | undefined;
  if (own?.length) return own.map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 3);
  const src = `${t.name} ${t.why.split(/choke ?points? (?:are|is)/i)[1] || ''} ${t.signals || ''}`.toLowerCase().replace(/[^a-z0-9&\s/-]/g, ' ');
  const words = src.split(/[\s/]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)].slice(0, 16);
}

const homeT = (ticker: string) => ticker.replace(/,.*$/, '').trim().toUpperCase();

/** Does an article belong to the theme? A theme company named in it, or two distinct theme terms (one if it is a multi-word term). */
export function matchTheme(a: PulseNews, terms: string[], tickers: Set<string>): { hit: boolean; why: string } {
  const tk = a.tickers.find((t) => tickers.has(t));
  if (tk) return { hit: true, why: tk };
  const hay = ` ${`${a.title} ${a.summary || ''}`.toLowerCase()} `;
  const hits = terms.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay));
  if (hits.length >= 2 || hits.some((h) => h.includes(' '))) return { hit: true, why: hits.slice(0, 3).join(', ') };
  return { hit: false, why: '' };
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const median = (a: Array<number | null>) => { const v = a.filter((x): x is number => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

export function themePulse(t: ChokeTheme, region: ChokeRegion, news: PulseNews[], cos: Map<string, PulseCo>, events: PulseEvent[], now = Date.now()): ThemePulse {
  const tickers = new Set([...t.leaders, ...(t.smallMid || [])].map((l) => homeT(l.ticker)));
  const terms = themeTerms(t);
  const day = 86_400_000;
  const matched: Array<PulseNews & { why: string; age: number; squeeze: boolean }> = [];
  for (const a of news) {
    const m = matchTheme(a, terms, tickers);
    if (!m.hit) continue;
    const age = (now - Date.parse(a.publishedAt)) / day;
    if (age < -1 || age > 60) continue;
    matched.push({ ...a, why: m.why, age, squeeze: SQUEEZE_RE.test(`${a.title} ${a.summary || ''}`) || /HIGH|CRITICAL/i.test(a.bottleneck || '') });
  }
  const w = (a: { importance: number | null }) => 0.5 + Math.min(1.5, Math.max(0, a.importance ?? 0.3) * 1.5);
  const n7 = matched.filter((a) => a.age <= 7), n28 = matched.filter((a) => a.age > 7 && a.age <= 28), n30 = matched.filter((a) => a.age <= 30);
  const heat7 = n7.reduce((s, a) => s + w(a), 0);
  const ratePrev = n28.reduce((s, a) => s + w(a), 0) / 3;   // per 7 days
  const heat = clamp(Math.log2(1 + heat7) * 22 + (ratePrev > 0 ? Math.max(-15, Math.min(15, (heat7 / ratePrev - 1) * 12)) : heat7 > 0 ? 10 : 0));
  const sq = n30.filter((a) => a.squeeze);
  const bottleneck = clamp(n30.length ? (sq.length / n30.length) * 70 + Math.min(30, sq.length * 6) : 0);

  const theseCos = [...tickers].map((k) => cos.get(k)).filter((c): c is PulseCo => !!c);
  const accel = theseCos.filter((c) => c.revQ != null && c.revA != null && c.revQ >= c.revA + 5);
  const mRevQ = median(theseCos.map((c) => c.revQ)), mOpm = median(theseCos.map((c) => c.opm)), mP1y = median(theseCos.map((c) => c.p1y));
  const ev60 = events.filter((e) => tickers.has(e.ticker) && (now - Date.parse(e.date)) / day <= 60);
  const proof = clamp(theseCos.length
    ? (accel.length / theseCos.length) * 40 + Math.max(0, Math.min(30, (mRevQ ?? 0) * 0.6)) + Math.max(0, Math.min(10, (mOpm ?? 0) / 3)) + Math.min(20, ev60.length * 7)
    : Math.min(20, ev60.length * 7));
  // zzz1180 — crowding reads the 5-year run too: a theme already up 3x+ in 5 years is priced, whatever the last year did
  const mP5y = median(theseCos.map((c) => c.p5y ?? null));
  const crowding = clamp(Math.max(mP1y == null ? 0 : mP1y <= 20 ? 0 : (mP1y - 20) / 2.3, mP5y == null ? 0 : mP5y <= 60 ? 0 : (mP5y - 60) / 2.4));
  const strength = clamp(0.3 * heat + 0.3 * bottleneck + 0.4 * proof - Math.max(0, crowding - 40) * 0.25);
  const trend: ThemePulse['trend'] = ratePrev === 0 ? (heat7 > 0 ? 'RISING' : 'STEADY') : heat7 >= ratePrev * 1.3 ? 'RISING' : heat7 <= ratePrev * 0.7 ? 'COOLING' : 'STEADY';

  const reasons: string[] = [];
  reasons.push(`${n7.length} news items in 7 days vs ${n28.length} in the 3 weeks before (${trend === 'RISING' ? 'rising' : trend === 'COOLING' ? 'cooling' : 'steady'})`);
  if (n30.length) reasons.push(`${sq.length} of ${n30.length} items in 30 days speak of a squeeze (sold out, shortage, lead times, price hikes, backlog)`);
  if (theseCos.length) reasons.push(`${accel.length} of ${theseCos.length} theme companies have revenue accelerating${mRevQ != null ? `; median quarterly sales growth ${Math.round(mRevQ)}%` : ''}`);
  if (ev60.length) reasons.push(`${ev60.length} filed transformational event${ev60.length === 1 ? '' : 's'} in 60 days (${[...new Set(ev60.map((e) => e.ticker))].slice(0, 5).join(', ')})`);
  if (mP1y != null || mP5y != null) reasons.push(`theme shares${mP1y != null ? ` ${mP1y >= 0 ? '+' : ''}${Math.round(mP1y)}% in 1 year` : ''}${mP5y != null ? `, ${mP5y >= 0 ? '+' : ''}${Math.round(mP5y)}% in 5 years` : ''} (median)${crowding >= 50 ? ' — much is priced in' : ''}`);

  const top = matched.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 20)
    .map((a) => ({ title: a.title, date: a.publishedAt.slice(0, 10), source: a.source, url: a.url, tickers: a.tickers.filter((x) => tickers.has(x)).slice(0, 4), squeeze: a.squeeze, why: a.why }));
  return {
    strength, label: strength >= 60 ? 'STRONG' : strength >= 35 ? 'BUILDING' : 'QUIET', trend, heat, bottleneck, proof, crowding,
    news7: n7.length, news28: n28.length, news60: matched.length, squeeze30: sq.length,
    accelerating: accel.map((c) => c.t), coverage: theseCos.length, medianRevQ: mRevQ, medianP1y: mP1y, reasons, news: top,
    events: ev60.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
  };
}
