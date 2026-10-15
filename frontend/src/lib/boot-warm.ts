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
  console.log(`[boot-warm] ${done.join(', ') || 'nothing'} ready in ${Date.now() - t0} ms`);
}
