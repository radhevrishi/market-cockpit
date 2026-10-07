// zzz957 — screener builds run inside the web server's own process: a long synchronous stretch (thousands of companies
// worked out in one go) holds every other request — the site's pages and the status checks timed out while a build ran.
// Awaiting this between slices lets waiting requests run first.
export const yieldToServer = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
