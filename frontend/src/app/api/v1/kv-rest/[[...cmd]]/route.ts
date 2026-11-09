// zzz1230 — Upstash-REST-compatible relay onto the app's key-value store, for the GitHub collectors and the Cloudflare movers
// worker. They keep speaking the Upstash REST protocol (GET /get/<key>, POST /set/<key>?EX=<s> with the value as the body,
// POST / with a command array, POST /pipeline) and only point their URL here, so their writes land in Postgres instead of
// a metered Upstash database. Auth: "Authorization: Bearer <token>" where the token is the existing Upstash REST token
// (so the GitHub secrets need no change), KV_RELAY_TOKEN, or a service key.
import { NextResponse } from 'next/server';
import { kvBackend, kvGetRaw, kvSet, kvDel, kvExistsMany } from '@/lib/kv';
import { hasServiceKey, safeEqual } from '@/lib/site-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const h = req.headers.get('authorization') || '';
  const tok = h.replace(/^Bearer\s+/i, '').trim();
  if (tok.length < 12) return false;
  const accepted = [process.env.KV_RELAY_TOKEN, process.env.UPSTASH_REDIS_REST_TOKEN, process.env.KV_REST_API_TOKEN]
    .filter((x): x is string => typeof x === 'string' && x.length >= 12);
  return accepted.some((a) => safeEqual(a, tok)) || hasServiceKey(tok);
}
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'no-store' } });
const ok = (result: unknown) => NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });

/** One command, Upstash-style answer. Only what the collectors use; anything else is an error. */
async function run(cmd: Array<string | number>): Promise<{ result?: unknown; error?: string }> {
  const op = String(cmd[0] || '').toUpperCase();
  const key = cmd[1] == null ? '' : String(cmd[1]);
  try {
    if (op === 'PING') return { result: 'PONG' };
    if (op === 'GET') return { result: await kvGetRaw(key) };
    if (op === 'MGET') return { result: await Promise.all(cmd.slice(1).map((k) => kvGetRaw(String(k)))) };
    if (op === 'EXISTS') { const r = await kvExistsMany(cmd.slice(1).map(String)); return { result: r ? r.filter(Boolean).length : 0 }; }
    if (op === 'DEL') { for (const k of cmd.slice(1)) await kvDel(String(k)); return { result: cmd.length - 1 }; }
    if (op === 'SET') {
      let ex: number | undefined;
      for (let i = 3; i < cmd.length - 1; i++) if (String(cmd[i]).toUpperCase() === 'EX') ex = Number(cmd[i + 1]) || undefined;
      await kvSet(key, String(cmd[2] ?? ''), ex);
      return { result: 'OK' };
    }
    return { error: `ERR command ${op} not supported by the relay` };
  } catch (e: any) { return { error: `ERR ${String(e?.message || e).slice(0, 160)}` }; }
}

export async function GET(req: Request, ctx: { params: Promise<{ cmd?: string[] }> }) {
  if (!authorized(req)) return bad('Unauthorized', 401);
  const parts = ((await ctx.params).cmd || []).map(decodeURIComponent);
  if (!parts.length || parts[0].toLowerCase() === 'ping') return NextResponse.json({ result: 'PONG', backend: kvBackend() });
  const r = await run(parts);
  return r.error ? bad(r.error) : ok(r.result);
}

export async function POST(req: Request, ctx: { params: Promise<{ cmd?: string[] }> }) {
  if (!authorized(req)) return bad('Unauthorized', 401);
  const parts = ((await ctx.params).cmd || []).map(decodeURIComponent);
  const url = new URL(req.url);
  const body = await req.text();
  if (parts[0]?.toLowerCase() === 'pipeline' || parts[0]?.toLowerCase() === 'multi-exec') {
    let cmds: any; try { cmds = JSON.parse(body); } catch { return bad('ERR body is not JSON'); }
    if (!Array.isArray(cmds)) return bad('ERR pipeline body must be an array');
    const out = [];
    for (const c of cmds) out.push(Array.isArray(c) ? await run(c) : { error: 'ERR bad command' });
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!parts.length) {
    let cmd: any; try { cmd = JSON.parse(body); } catch { return bad('ERR body is not JSON'); }
    if (!Array.isArray(cmd)) return bad('ERR body must be a command array');
    const r = await run(cmd);
    return r.error ? bad(r.error) : ok(r.result);
  }
  // path style: /set/<key>[/<value>]?EX=n — the value is the body when not in the path
  if (parts[0].toLowerCase() === 'set') {
    const ex = Number(url.searchParams.get('EX') || url.searchParams.get('ex')) || undefined;
    const value = parts.length > 2 ? parts.slice(2).join('/') : body;
    const r = await run(['SET', parts[1] || '', value, ...(ex ? ['EX', ex] : [])]);
    return r.error ? bad(r.error) : ok(r.result);
  }
  const r = await run(parts);
  return r.error ? bad(r.error) : ok(r.result);
}
