// zzz896 — READ-ONLY MCP server endpoint (JSON-RPC 2.0 over Streamable HTTP, plain JSON answers).
// PROTECTED by the proxy: owner login cookie or the `x-mc-key` service key (see PROTECTED_API_PREFIXES in lib/site-auth.ts).
// The dispatch, validation and tool schemas live in lib/mcp-server.ts; this file only wires the production readers.
import { NextRequest, NextResponse } from 'next/server';
import { handleMcpBody, buildEventsSql, ERR, type McpDeps } from '@/lib/mcp-server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY = 256 * 1024;

const deps: McpDeps = {
  getCompany: async (t) => (await import('@/lib/company-record')).getCompanyRecord(t),
  getGuidanceRecords: async () => {
    const s = await import('@/lib/guidance-universe-service');
    const b = await s.getUniverseBundle(Date.now());
    return b.build.defaultRecords ?? [];
  },
  getEvents: async (q) => {
    const { getPool } = await import('@/lib/db');
    const { ensureSchema } = await import('@/lib/db-migrate');
    if (!getPool()) throw new Error('Postgres not configured');
    if (!(await ensureSchema())) throw new Error('Postgres schema not ready');
    const { text, values } = buildEventsSql(q);
    return (await getPool()!.query(text, values)).rows;
  },
  getBench: (m) => kvGet<any>(m === 'IN' ? 'bench:server:v1' : 'bench:us:server:v1'),
};

const rpcError = (code: number, message: string, status = 200) => NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status });

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return rpcError(ERR.INVALID_REQUEST, 'Request too large', 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return rpcError(ERR.PARSE, 'Parse error', 400); }
  const out = await handleMcpBody(body, deps);
  if (out === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  return NextResponse.json({ error: 'This MCP endpoint answers JSON-RPC over POST only (no SSE stream).' }, { status: 405, headers: { Allow: 'POST' } });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Sessions are not used.' }, { status: 405, headers: { Allow: 'POST' } });
}
