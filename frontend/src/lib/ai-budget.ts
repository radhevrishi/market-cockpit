// Atomic admission and settlement. Spend and outstanding reservations must be read/written in ONE Redis operation:
// releasing an allowance before recording usage, or checking a cached total, admits calls against money already spent.
import { randomUUID } from 'node:crypto';
import { kvEvalDurable } from './kv';

export interface Reservation { usd: number; month: string; settled: boolean; id?: string; spentKey?: string; reservedKey?: string }
export type BudgetEval = (script: string, keys: string[], args: Array<string | number>) => Promise<unknown | null>;

export const RESERVE_BUDGET_LUA = `
local spent = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), tonumber(ARGV[1]))
local reserved = math.max(0, tonumber(redis.call('GET', KEYS[2]) or '0'))
local amount = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local existing = redis.call('GET', KEYS[3])
if existing then
  if amount > 0 and tonumber(existing) == amount then return {'ok', tostring(spent), tostring(reserved)} end
  return {'store', tostring(spent), tostring(reserved)}
end
if spent + reserved + amount > cap or (amount == 0 and spent + reserved >= cap) then
  return {'cap', tostring(spent), tostring(reserved)}
end
if amount > 0 then
  redis.call('SET', KEYS[1], tostring(spent), 'EX', ARGV[4])
  redis.call('SET', KEYS[2], tostring(reserved + amount), 'EX', ARGV[4])
  redis.call('SET', KEYS[3], tostring(amount), 'EX', ARGV[4])
end
return {'ok', tostring(spent), tostring(reserved + amount)}
`;

export const SETTLE_BUDGET_LUA = `
local entry = redis.call('GET', KEYS[3])
if not entry then return 0 end
if entry == 'done' then return 1 end
local amount = tonumber(entry)
if not amount then return 0 end
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = math.max(0, tonumber(redis.call('GET', KEYS[2]) or '0'))
redis.call('SET', KEYS[1], tostring(spent + tonumber(ARGV[1])), 'EX', ARGV[2])
redis.call('SET', KEYS[2], tostring(math.max(0, reserved - amount)), 'EX', ARGV[2])
redis.call('SET', KEYS[3], 'done', 'EX', ARGV[2])
return 1
`;

export interface BudgetInput { spentKey: string; reservedKey: string; month: string; spentFloor: number; estimate: number; cap: number; ttl: number }
export interface BudgetResult { allowed: boolean; spent: number; reserved: number; reason?: 'cap' | 'store'; reservation?: Reservation }
export async function reserveBudget(p: BudgetInput, evaluate: BudgetEval = kvEvalDurable): Promise<BudgetResult> {
  const fail: BudgetResult = { allowed: false, spent: p.spentFloor, reserved: 0, reason: 'store' };
  if (![p.estimate, p.spentFloor, p.cap, p.ttl].every(Number.isFinite) || p.estimate < 0 || p.spentFloor < 0 || p.cap <= 0 || p.ttl <= 0) return fail;
  const id = `${p.reservedKey}:call:${randomUUID()}`;
  let reply: unknown;
  try { reply = await evaluate(RESERVE_BUDGET_LUA, [p.spentKey, p.reservedKey, id], [p.spentFloor, p.estimate, p.cap, p.ttl]); } catch { return fail; }
  if (!Array.isArray(reply) || reply.length !== 3 || !['ok', 'cap', 'store'].includes(String(reply[0]))) return fail;
  const spent = Number(reply[1]), reserved = Number(reply[2]);
  if (!Number.isFinite(spent) || !Number.isFinite(reserved) || spent < 0 || reserved < 0) return fail;
  if (reply[0] !== 'ok') return { allowed: false, spent, reserved, reason: reply[0] === 'cap' ? 'cap' : 'store' };
  return { allowed: true, spent, reserved, ...(p.estimate > 0 ? { reservation: { id, usd: p.estimate, month: p.month, settled: false, spentKey: p.spentKey, reservedKey: p.reservedKey } } : {}) };
}

/** Unknown usage is not settled. Retry after an accounting failure is safe; the durable marker prevents double charges. */
export async function settleBudget(r: Reservation | undefined, actualUsd = 0, ttl = 400 * 86400, evaluate: BudgetEval = kvEvalDurable): Promise<boolean> {
  if (!r) return false;
  if (r.settled) return true;
  if (!(r.usd > 0) || !r.id || !r.spentKey || !r.reservedKey || !Number.isFinite(actualUsd) || actualUsd < 0) return false;
  try {
    const reply = await evaluate(SETTLE_BUDGET_LUA, [r.spentKey, r.reservedKey, r.id], [actualUsd, ttl]);
    if (Number(reply) !== 1) return false;
    r.settled = true;
    return true;
  } catch { return false; }
}
