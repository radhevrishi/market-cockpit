/** Redis executes this entire compare-and-set atomically, including first insert. */
export const VERSIONED_SET_LUA = `
local raw = redis.call('GET', KEYS[1])
local next = cjson.decode(ARGV[1])
local current = nil
if raw then current = cjson.decode(raw) end
if current and current.hash == next.hash then return {2, raw} end
local version = current and tonumber(current.version) or 0
local base = tonumber(ARGV[2])
if base ~= version then return {0, raw or ''} end
if tonumber(next.version) ~= version + 1 then return redis.error_reply('Invalid next version') end
-- Preserve original JSON bytes: cjson re-encoding changes empty arrays and float precision.
redis.call('SET', KEYS[1], ARGV[1])
return {1, ARGV[1]}
`;

export interface VersionedValue { version: number; hash: string }
export function parseVersionedResult<T extends VersionedValue>(result: unknown): { ok: boolean; unchanged: boolean; row: T | null } {
  if (!Array.isArray(result) || ![0, 1, 2].includes(Number(result[0]))) throw new Error('Invalid durable compare-and-set acknowledgement');
  const row = result[1] ? (typeof result[1] === 'string' ? JSON.parse(result[1]) : result[1]) as T : null;
  if (row && (!Number.isSafeInteger(row.version) || row.version < 1 || typeof row.hash !== 'string')) throw new Error('Invalid durable state version');
  if (Number(result[0]) !== 0 && !row) throw new Error('Missing durable state acknowledgement');
  return { ok: Number(result[0]) !== 0, unchanged: Number(result[0]) === 2, row };
}
