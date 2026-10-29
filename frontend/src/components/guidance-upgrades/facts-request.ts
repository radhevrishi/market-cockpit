/** Bound headers AND JSON parsing; cancellation also closes superseded page requests. */
export async function fetchFacts(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch, deadlineMs = 45_000): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Company figures did not answer in time')); }, deadlineMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const r = await fetcher(url, { cache: 'no-store', signal: controller.signal });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(`Company figures request failed (HTTP ${r.status})`);
      return j;
    })()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
