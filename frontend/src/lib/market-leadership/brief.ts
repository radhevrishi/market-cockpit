// zzz1290 — the Daily Market Brief: every line is built from a figure on the page, tagged as observed data, a calculated
// indicator, an interpretation or unknown. No narrative is invented and no reason for a market move is guessed.
import type { MarketPayload } from './server';
import { fmtN, fmtP } from './core';

export type Kind = 'data' | 'calc' | 'read' | 'unknown';
export interface BriefLine { label: string; text: string; kind: Kind }
export interface ThemeBrief { mostDamaged: string[]; holdingUp: string[]; early: string[]; emerging: string[]; failed: string[] }

export function dailyBrief(p: MarketPayload | null, th: ThemeBrief | null): BriefLine[] {
  const L: BriefLine[] = [];
  if (!p) return [{ label: 'Market condition', text: 'Not loaded yet.', kind: 'unknown' }];
  const b = p.bench;
  L.push({ label: 'Market condition', kind: 'read', text: `${p.regime.label} — ${p.regime.reasons.join('; ')}.${p.regime.complete ? '' : ` Missing: ${p.regime.missing.join(', ')}.`}` });
  if (p.health) L.push({ label: 'Leadership', kind: 'calc', text: `${p.health.healthy} of ${p.health.n} leaders healthy, ${p.health.pressure} under pressure, ${p.health.broken} broken, ${p.health.recovering} recovering — leadership ${p.health.concentration}.` });
  else L.push({ label: 'Leadership', kind: 'unknown', text: 'Leader universe not available (screener snapshot missing).' });
  L.push({ label: 'Most damaged themes', kind: th ? 'calc' : 'unknown', text: th?.mostDamaged.length ? th.mostDamaged.slice(0, 4).join(', ') : th ? 'none stands out' : 'Theme Rotation still loading.' });
  L.push({ label: 'Themes holding up', kind: th ? 'calc' : 'unknown', text: th?.holdingUp.length ? `${th.holdingUp.slice(0, 4).join(', ')} (holding up is not leading)` : th ? 'none' : '—' });
  L.push({ label: 'Early improvement', kind: th ? 'calc' : 'unknown', text: th?.early.length ? th.early.slice(0, 4).join(', ') : th ? 'no theme is improving on two independent measures' : '—' });
  L.push({ label: 'Emerging leaders', kind: 'calc', text: [th?.emerging.length ? `themes: ${th.emerging.slice(0, 3).join(', ')}` : null, p.emerging.length ? `stocks: ${p.emerging.slice(0, 5).map((e) => e.t).join(', ')}` : null].filter(Boolean).join(' · ') || 'none qualify' });
  if (b) {
    const dist = b.dist.volumeOk ? `${b.dist.count} distribution days (${b.dist.trend})` : 'distribution unknown (no volume)';
    L.push({ label: 'Risk', kind: 'calc', text: `${p.posture.label}, risk ${p.posture.level.toLowerCase()} — ${dist}, ${b.dd.toFixed(1)}% off the high, volatility ${b.vol20 ?? 'n/a'}% vs ${b.volMedian ?? 'n/a'}% normal.` });
  }
  // what changed: last two breadth records + distribution vs 5 sessions ago
  const h = p.breadthHistory;
  const ch: string[] = [];
  if (h.length >= 2) {
    const a = h[h.length - 2], z = h[h.length - 1];
    if (a.a50 != null && z.a50 != null) ch.push(`stocks above their 50-day ${fmtN(a.a50)}% → ${fmtN(z.a50)}%`);
    if (a.lh != null && z.lh != null && a.lh !== z.lh) ch.push(`healthy leaders ${a.lh}% → ${z.lh}%`);
    if (a.rg && z.rg && a.rg !== z.rg) ch.push(`regime changed (${a.rg.replace(/_/g, ' ').toLowerCase()} → ${z.rg.replace(/_/g, ' ').toLowerCase()})`);
  } else if (p.breadth?.a50Prev != null && p.breadth.a50 != null) ch.push(`stocks above their 50-day ${p.breadth.a50Prev}% → ${p.breadth.a50}% (vs yesterday's close)`);
  if (b?.dist.volumeOk && b.dist.ago5 != null && b.dist.ago5 !== b.dist.count) ch.push(`distribution days ${b.dist.ago5} → ${b.dist.count} over 5 sessions`);
  if (b?.ret.d1 != null) ch.push(`${b.name} ${fmtP(b.ret.d1, 2)} last session`);
  L.push({ label: 'What changed', kind: ch.length ? 'data' : 'unknown', text: ch.length ? ch.join('; ') : 'Not enough history yet (one record a day builds from today).' });
  L.push({ label: 'Watch next', kind: 'read', text: p.posture.watch[0] || p.posture.improve[0] || '—' });
  L.push({ label: 'Invalidation', kind: 'read', text: p.posture.worsen[0] || '—' });
  const dq: string[] = [];
  if (p.benchMissing.length) dq.push(`missing: ${p.benchMissing.join(', ')}`);
  if (p.snapshotAt) dq.push(`stocks as of ${p.snapshotAt.slice(0, 16).replace('T', ' ')} UTC`);
  if (b) dq.push(`index to ${b.last}${p.liveSession ? ` (today's ${p.liveSession} session left out until it closes)` : ''}`);
  if (p.breadth) dq.push(`${p.breadth.n} liquid stocks`);
  L.push({ label: 'Data quality', kind: p.regime.complete ? 'data' : 'unknown', text: dq.join(' · ') || 'unknown' });
  return L;
}
