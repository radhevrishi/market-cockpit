// zzz1291 — regime-change alert. After each market's close the Market Leadership payload is rebuilt (the same cache the page
// reads) and its regime compared with the last one on file. A change is sent once to the owner (Telegram / e-mail via
// notifyOwnerOnce, topic ALERTS) with the reasons behind the new label. A run whose data is incomplete (INSUFFICIENT_DATA) never
// alerts and never replaces the stored regime. Flip-backs within 3 days are said as such ("back to …").
export interface RegimeMemo { regime: string; label: string; since: string; prev?: { regime: string; label: string; until: string } | null }
export interface RegimeDecision { alert: boolean; next: RegimeMemo | null; why: string; flipBack: boolean }

/** Pure: what to do with a newly read regime. `today` = YYYY-MM-DD. */
export function regimeDecision(last: RegimeMemo | null, cur: { regime: string; label: string } | null, today: string): RegimeDecision {
  if (!cur || cur.regime === 'INSUFFICIENT_DATA') return { alert: false, next: null, why: 'regime not readable (data missing) — nothing stored', flipBack: false };
  if (!last) return { alert: false, next: { regime: cur.regime, label: cur.label, since: today, prev: null }, why: 'first reading stored', flipBack: false };
  if (last.regime === cur.regime) return { alert: false, next: null, why: `unchanged (${cur.label} since ${last.since})`, flipBack: false };
  const days = (Date.parse(today) - Date.parse(last.since)) / 86_400_000;
  const flipBack = !!last.prev && last.prev.regime === cur.regime && days <= 3;
  return { alert: true, next: { regime: cur.regime, label: cur.label, since: today, prev: { regime: last.regime, label: last.label, until: today } }, why: `${last.label} → ${cur.label}`, flipBack };
}

const NAME: Record<'US' | 'IN', string> = { US: 'USA (S&P 500)', IN: 'India (Nifty 50)' };
export async function regimeWatchJob(ctx: { log: (m: string) => void }, market: 'US' | 'IN'): Promise<{ ok: boolean; status: number; error?: string | null }> {
  const { kvGetStrict, kvSet } = await import('../kv');
  const { swrGet } = await import('../swr-cache');
  const { buildMarket, LR_VERSION } = await import('./server');
  const r = await swrGet<any>({ key: `leadership-risk:v${LR_VERSION}:${market}`, freshMs: 30 * 60_000, maxStaleMs: 3 * 86_400_000, force: true, waitMs: 120_000, build: () => buildMarket(market), isUsable: (v: any) => !!v?.regime }).catch(() => null);
  const p = r?.value;
  if (!p?.regime) { ctx.log(`regime watch ${market}: payload not built`); return { ok: false, status: 503, error: 'payload not built' }; }
  const key = `mlr:regime-last:v1:${market}`;
  let last: RegimeMemo | null = null;
  try { last = await kvGetStrict<RegimeMemo>(key); } catch { ctx.log(`regime watch ${market}: store unreadable — skipped`); return { ok: false, status: 503, error: 'store unreadable' }; }
  const today = new Date().toISOString().slice(0, 10);
  const d = regimeDecision(last, { regime: p.regime.regime, label: p.regime.label }, today);
  ctx.log(`regime watch ${market}: ${d.why}`);
  if (d.next) await kvSet(key, d.next, 400 * 86_400).catch(() => null);
  if (!d.alert || !d.next) return { ok: true, status: 200 };
  const { notifyOwnerOnce } = await import('../owner-notify');
  const reasons: string[] = (p.regime.reasons || []).slice(0, 5);
  const bits = [
    `${NAME[market]}: ${d.next.prev?.label} → ${d.next.label}${d.flipBack ? ' (back again within 3 days — treat as unsettled)' : ''}`,
    ...reasons.map((x: string) => `• ${x}`),
    p.posture?.label ? `Risk posture: ${p.posture.label}` : '',
    p.health ? `Leaders: ${p.health.healthy}/${p.health.n} healthy, ${p.health.n - p.health.above200} below their 200-day line` : '',
    'Open: /market-leadership — a reading of conditions, not a buy or sell signal.',
  ].filter(Boolean);
  await notifyOwnerOnce(`mlr-regime:${market}:${today}:${d.next.regime}`, { subject: `Market regime change — ${NAME[market]}: ${d.next.label}`, text: bits.join('\n'), topic: 'ALERTS' }).catch((e) => ctx.log(`regime watch ${market}: send failed ${String(e?.message || e).slice(0, 80)}`));
  return { ok: true, status: 200 };
}
