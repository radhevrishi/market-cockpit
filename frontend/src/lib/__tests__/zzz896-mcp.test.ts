// zzz896 — read-only MCP server: JSON-RPC dispatch, input validation, tool output. No network (all readers injected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage, handleMcpBody, buildEventsSql, filterGuidance, normTickerInput, TOOLS, MCP_PROTOCOL_VERSION, ERR, MAX_ROWS, type McpDeps, type EventQuery } from '../mcp-server';

const guidanceRec = (ticker: string, market: 'IN' | 'US', growth: number | null, extra: Record<string, unknown> = {}) => ({
  record: { ticker, company: `${ticker} Ltd`, market, verification: 'VERIFIED', primary: { period: 'FY27' } },
  tickers: [ticker], names: [`${ticker} Ltd`], metric: 'REVENUE', display: growth == null ? 'n/a' : `+${growth}%`, period: 'FY27',
  statement: `We expect ${growth}% growth`, sourceName: 'Concall', sourceUrl: 'https://example.com/x.pdf', sourceDate: '2026-08-01',
  points: growth == null ? [] : [{ compareValue: growth, counted: true }, { compareValue: 999, counted: false }],
  ...extra,
});

function makeDeps(over: Partial<McpDeps> = {}) {
  const calls: { events: EventQuery[]; company: string[] } = { events: [], company: [] };
  const deps: McpDeps = {
    getCompany: async (t) => { calls.company.push(t); return { ticker: t, summary: ['ok'] }; },
    getGuidanceRecords: async () => [guidanceRec('MTARTECH', 'IN', 40), guidanceRec('NVDA', 'US', 55), guidanceRec('KPL', 'IN', 12)],
    getEvents: async (q) => { calls.events.push(q); return [{ id: 'e1', ticker: q.ticker ?? 'X' }]; },
    getBench: async (m) => (m === 'IN'
      ? { entries: [{ ticker: 'MTARTECH', company: 'MTAR Technologies', tier: 'BLOCKBUSTER', composite_score: 82, quarter: 'Q1 FY27', sales_yoy_pct: 40, net_profit_yoy_pct: 60, guidance: 'Positive' }] }
      : { entries: [{ ticker: 'NVDA', tier: 'STRONG', composite_score: 75, sales_yoy_pct: 50 }] }),
    ...over,
  };
  return { deps, calls };
}
const call = (deps: McpDeps, name: string, args: unknown, id: number | string = 1) => handleMcpMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, deps);
const parse = (r: any) => JSON.parse(r.result.content[0].text);

test('initialize returns protocol version, server info and tools capability', async () => {
  const { deps } = makeDeps();
  const r: any = await handleMcpMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } } }, deps);
  assert.equal(r.jsonrpc, '2.0'); assert.equal(r.id, 0);
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.equal(r.result.serverInfo.name, 'market-cockpit');
  assert.ok(r.result.capabilities.tools);
});

test('notifications get no answer; ping answers {}', async () => {
  const { deps } = makeDeps();
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
  assert.equal(await handleMcpBody([{ jsonrpc: '2.0', method: 'notifications/initialized' }], deps), null);
  const r: any = await handleMcpMessage({ jsonrpc: '2.0', id: 'p', method: 'ping' }, deps);
  assert.deepEqual(r.result, {}); assert.equal(r.id, 'p');
});

test('tools/list lists the four read-only tools with schemas', async () => {
  const { deps } = makeDeps();
  const r: any = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps);
  assert.deepEqual(r.result.tools.map((t: any) => t.name).sort(), ['explain_score', 'get_company', 'get_events', 'get_guidance']);
  for (const t of TOOLS) { assert.equal(t.inputSchema.type, 'object'); assert.equal(t.annotations.readOnlyHint, true); }
});

test('unknown method → -32601; bad envelope → -32600; unknown tool / bad args → -32602', async () => {
  const { deps } = makeDeps();
  const a: any = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'resources/write' }, deps);
  assert.equal(a.error.code, ERR.METHOD_NOT_FOUND);
  const b: any = await handleMcpMessage({ id: 4, method: 'ping' }, deps);
  assert.equal(b.error.code, ERR.INVALID_REQUEST);
  const c: any = await call(deps, 'drop_table', {});
  assert.equal(c.error.code, ERR.INVALID_PARAMS);
  const d: any = await call(deps, 'get_company', {});
  assert.equal(d.error.code, ERR.INVALID_PARAMS);
  const e: any = await call(deps, 'get_company', { ticker: "X'; DROP TABLE intel_event;--" });
  assert.equal(e.error.code, ERR.INVALID_PARAMS);
  const f: any = await call(deps, 'get_events', { limit: MAX_ROWS + 1 });
  assert.equal(f.error.code, ERR.INVALID_PARAMS);
  const g: any = await call(deps, 'get_events', { since: '2026/01/01' });
  assert.equal(g.error.code, ERR.INVALID_PARAMS);
  const h: any = await call(deps, 'get_guidance', { market: 'EU' });
  assert.equal(h.error.code, ERR.INVALID_PARAMS);
  const i: any = await call(deps, 'get_guidance', { extra: 1 });
  assert.equal(i.error.code, ERR.INVALID_PARAMS);
  const j: any = await call(deps, 'get_guidance', { min_growth: '30' });
  assert.equal(j.error.code, ERR.INVALID_PARAMS);
});

test('ticker normalisation strips exchange prefix / suffix and upper-cases', () => {
  assert.equal(normTickerInput('nse:mtartech'), 'MTARTECH');
  assert.equal(normTickerInput('RELIANCE.NS'), 'RELIANCE');
  assert.equal(normTickerInput('3IINFOLTD'), '3IINFOLTD');
  assert.equal(normTickerInput('M&M'), 'M&M');
  assert.throws(() => normTickerInput(''));
  assert.throws(() => normTickerInput('A'.repeat(21)));
});

test('get_company passes the normalised ticker to the reader', async () => {
  const { deps, calls } = makeDeps();
  const r: any = await call(deps, 'get_company', { ticker: 'nse:mtartech' });
  assert.equal(r.result.isError, false);
  assert.deepEqual(calls.company, ['MTARTECH']);
  assert.equal(parse(r).ticker, 'MTARTECH');
});

test('get_guidance filters by market, ticker and counted growth, and compacts rows', async () => {
  const { deps } = makeDeps();
  const all = parse(await call(deps, 'get_guidance', {}));
  assert.equal(all.count, 3);
  const inOnly = parse(await call(deps, 'get_guidance', { market: 'IN' }));
  assert.deepEqual(inOnly.rows.map((x: any) => x.ticker), ['MTARTECH', 'KPL']);
  const big = parse(await call(deps, 'get_guidance', { min_growth: 30 }));
  assert.deepEqual(big.rows.map((x: any) => x.ticker), ['MTARTECH', 'NVDA']);   // KPL 12% out; uncounted 999 ignored
  const one = parse(await call(deps, 'get_guidance', { ticker: 'NVDA' }));
  assert.equal(one.count, 1);
  assert.deepEqual(Object.keys(one.rows[0]).sort(), ['company', 'display', 'market', 'metric', 'period', 'sourceDate', 'sourceName', 'sourceUrl', 'statement', 'ticker', 'verification']);
  assert.equal(one.rows[0].period, 'FY27');
});

test('get_guidance caps at 200 rows', () => {
  const many = Array.from({ length: 250 }, (_, i) => guidanceRec(`T${i}`, 'IN', 50));
  const out = filterGuidance(many, { ticker: null, market: null, minGrowth: null });
  assert.equal(out.rows.length, MAX_ROWS); assert.equal(out.total, 250); assert.equal(out.truncated, true);
});

test('get_events passes validated query; SQL is parameterised (no values inlined)', async () => {
  const { deps, calls } = makeDeps();
  const r = parse(await call(deps, 'get_events', { ticker: 'mtartech', market: 'IN', since: '2026-01-01', status: 'raised', limit: 10 }));
  assert.equal(r.count, 1);
  assert.deepEqual(calls.events[0], { ticker: 'MTARTECH', market: 'IN', since: '2026-01-01', status: 'RAISED', limit: 10 });
  const { text, values } = buildEventsSql(calls.events[0]);
  assert.deepEqual(values, ['MTARTECH', 'IN', '2026-01-01', 'RAISED', 10]);
  assert.ok(!text.includes('MTARTECH') && !text.includes('2026-01-01'));
  assert.match(text, /FROM intel_event WHERE ticker = \$1 AND market = \$2 AND event_date >= \$3::date AND upper\(status\) = \$4 .*LIMIT \$5$/);
  const bare = buildEventsSql({ ticker: null, market: null, since: null, status: null, limit: 50 });
  assert.ok(!bare.text.includes('WHERE')); assert.deepEqual(bare.values, [50]);
});

test('a failing data store becomes a tool error (isError), not a crash', async () => {
  const { deps } = makeDeps({ getEvents: async () => { throw new Error('Postgres not configured'); } });
  const r: any = await call(deps, 'get_events', {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Postgres not configured/);
});

test('explain_score returns the new-information breakdown (India first, then USA)', async () => {
  const { deps } = makeDeps();
  const a = parse(await call(deps, 'explain_score', { ticker: 'MTARTECH' }));
  assert.equal(a.market, 'IN'); assert.equal(a.tier, 'BLOCKBUSTER'); assert.equal(a.composite, 82);
  assert.equal(typeof a.newInfo.score, 'number');
  assert.ok(a.newInfo.parts.some((p: any) => p.key === 'beat'));
  assert.ok(a.newInfo.parts.some((p: any) => p.key === 'guidance'));
  const b = parse(await call(deps, 'explain_score', { ticker: 'NVDA' }));
  assert.equal(b.market, 'US'); assert.equal(b.growth.sales_yoy_pct, 50);
  const c: any = await call(deps, 'explain_score', { ticker: 'NOTHERE' });
  assert.equal(c.result.isError, true);
});

test('batch: answers requests, drops notifications', async () => {
  const { deps } = makeDeps();
  const out: any = await handleMcpBody([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], deps);
  assert.equal(out.length, 2); assert.deepEqual(out.map((x: any) => x.id), [1, 2]);
});
