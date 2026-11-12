// zzz1053 — after a restart / deploy, read the things the first page loads wait on BEFORE anyone asks: the Postgres connection +
// schema check, both screener snapshots (stock screener, Pine screener, TradingView-replacement CSVs, chart float) and the guidance
// documents index (graded days). Started a few seconds after boot so the server is listening first; best-effort, never throws.
let started = false;

export function warmOnBoot(delayMs = 5_000): void {
  if (started) return;
  started = true;
  const timer = setTimeout(() => { void run(); }, delayMs);
  (timer as any).unref?.();
}

async function run(): Promise<void> {
  const t0 = Date.now();
  const done: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); done.push(name); } catch (e: any) { console.warn(`[boot-warm] ${name} skipped: ${e?.message || e}`); }
  };
  await step('postgres', async () => {
    const db = await import('./db');
    if (!db.getPool()) return;
    await (await import('./db-migrate')).ensureSchema();
  });
  const snap = await import('./screener/snapshot-cache');
  await Promise.all([
    step('snapshot US', () => snap.getSnapshot('US')),
    step('snapshot IN', () => snap.getSnapshot('IN')),
    step('guidance index', async () => (await import('./in-guide-check')).prewarmInGuideIndex()),
  ]);
  // zzz1265 — the guidance universe took ~19 s on the first Guidance Upgrades visit after every deploy; build it now
  // (after the snapshots, one thing at a time) so the first visit reads the kept bundle
  await step('guidance universe', async () => { await (await import('./guidance-universe-service')).getUniverseBundle(Date.now(), false); });
  // zzz1266 — the bundle alone left the first Guidance Upgrades visit slow (18.6 s measured): the two list ROUTES do more
  // (claim checks, pipeline evidence, the lean bodies, compression). Ask them once here, through the server itself, so their
  // kept answers exist before the first visitor. Public GETs; a failure only means the first visit builds them.
  await step('guidance lists', async () => {
    const base = `http://127.0.0.1:${process.env.PORT || '3000'}`;
    // exactly the page's own first requests (guUniverseUrl defaults; the 7-day window), so the kept answers are the ones it asks for
    for (const path of ['/api/v1/guidance-universe?market=ALL&threshold=30&view=active&lean=1', '/api/v1/guidance-upgrades?window=7D&market=ALL&lean=1']) {
      const r = await fetch(base + path, { headers: { 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(90_000) });
      await r.arrayBuffer();
      if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
    }
  });
  console.log(`[boot-warm] ${done.join(', ') || 'nothing'} ready in ${Date.now() - t0} ms`);
}
