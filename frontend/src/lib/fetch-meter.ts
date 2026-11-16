// zzz1273 — where the memory and the outbound traffic go. Hosting is billed by memory held and bytes sent, and the live-memory
// profile showed ~480 MB of response bodies (JSON and text) still held, but an async read hides who asked for them. This meter
// notes, for every response body of 512 KB or more read on the server, WHICH code read it (the first app frame of the stack at the
// moment `.json()` / `.text()` is called — that call is synchronous in the caller) and how big it was. It also counts requests
// that reach the server by route family and caller kind (owner / service / anonymous), for the egress question.
// Counters only; no bodies, URLs with secrets or personal data are kept. Kept on globalThis because the start-up hook and the
// routes are separate bundles. Read by /api/v1/system-status (memory.fetchBig, memory.traffic).

type Big = { n: number; mb: number; maxMb: number; last: string; kind: string };
type Store = { since: string; big: Map<string, Big>; traffic: Map<string, number>; installed: boolean };
const G = globalThis as any;
function store(): Store {
  if (!G.__MC_FETCH_METER__) G.__MC_FETCH_METER__ = { since: new Date().toISOString(), big: new Map(), traffic: new Map(), installed: false };
  return G.__MC_FETCH_METER__ as Store;
}

const MIN_CHARS = 512 * 1024;

/** Pure: the first frame of a stack that is app code (a server chunk named after a source file), shortened. */
export function appFrame(stack: string): string {
  const lines = String(stack || '').split('\n').slice(1);
  for (const l of lines) {
    if (/fetch-meter/.test(l)) continue;
    const m = l.match(/(src_(?:lib|app)_[A-Za-z0-9_\-[\]().]+?)_[0-9a-z\-_]{4,}\._\.js:(\d+):(\d+)/);
    if (m) return `${m[1].replace(/_ts$|_tsx$/, '')}:${m[3]}`;
    const n = l.match(/\/(src\/(?:lib|app)\/[^:)]+):(\d+)/);
    if (n) return `${n[1]}:${n[2]}`;
  }
  const first = lines.find((l) => /chunks|node_modules/.test(l)) || lines[0] || '';
  return first.trim().replace(/^at\s+/, '').slice(0, 90);
}

export function noteBody(site: string, kind: string, chars: number): void {
  if (!(chars >= MIN_CHARS)) return;
  const s = store();
  const mb = chars / 1048576;
  const b = s.big.get(site) || { n: 0, mb: 0, maxMb: 0, last: '', kind };
  b.n += 1; b.mb += mb; b.maxMb = Math.max(b.maxMb, mb); b.last = new Date().toISOString(); b.kind = kind;
  s.big.set(site, b);
  if (s.big.size > 400) { const k = s.big.keys().next().value; if (k !== undefined) s.big.delete(k); }
}

/** Install once (server start). Wraps Response#json / #text; behaviour is unchanged (json = text + JSON.parse). */
export function installFetchMeter(): void {
  const s = store();
  if (s.installed) return;
  const R: any = (globalThis as any).Response;
  if (!R?.prototype?.text || !R?.prototype?.json) return;
  const origText = R.prototype.text;
  R.prototype.text = function (this: any) {
    const site = appFrame(new Error().stack || '');
    return origText.call(this).then((t: string) => { try { noteBody(site, 'text', t.length); } catch { /* meter never breaks a read */ } return t; });
  };
  R.prototype.json = function (this: any) {
    const site = appFrame(new Error().stack || '');
    return origText.call(this).then((t: string) => { try { noteBody(site, 'json', t.length); } catch { /* ignore */ } return JSON.parse(t); });
  };
  s.installed = true;
}

/** Pure: the family of a request path for the traffic count ('/api/v1/guidance-universe/x' → '/api/v1/guidance-universe'). */
export function routeFamily(path: string): string {
  const p = String(path || '/').split('?')[0];
  if (!p.startsWith('/api/')) return p.startsWith('/_next') ? '/_next' : 'page';
  const parts = p.split('/').filter(Boolean);
  return '/' + parts.slice(0, parts[1] === 'v1' ? 3 : 2).join('/');
}

export function noteRequest(path: string, who: 'owner' | 'service' | 'anon'): void {
  try {
    const s = store();
    const k = `${who} ${routeFamily(path)}`;
    s.traffic.set(k, (s.traffic.get(k) || 0) + 1);
    if (s.traffic.size > 600) { const first = s.traffic.keys().next().value; if (first !== undefined) s.traffic.delete(first); }
  } catch { /* ignore */ }
}

export function fetchMeterReport(top = 25): { since: string; installed: boolean; bigBodies: Array<{ site: string } & Big>; traffic: Array<{ key: string; n: number }>; trafficByWho: Record<string, number> } {
  const s = store();
  const bigBodies = Array.from(s.big.entries()).map(([site, b]) => ({ site, ...b, mb: Math.round(b.mb), maxMb: Math.round(b.maxMb * 10) / 10 }))
    .sort((a, b) => b.mb - a.mb).slice(0, top);
  const traffic = Array.from(s.traffic.entries()).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, top);
  const trafficByWho: Record<string, number> = {};
  for (const [k, n] of s.traffic) { const w = k.split(' ')[0]; trafficByWho[w] = (trafficByWho[w] || 0) + n; }
  return { since: s.since, installed: s.installed, bigBodies, traffic, trafficByWho };
}
