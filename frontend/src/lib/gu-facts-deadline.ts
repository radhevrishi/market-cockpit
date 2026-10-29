/** A slow source must not hold already-read companies behind it. Late work can still fill its cache. */
export async function waitForFacts(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
