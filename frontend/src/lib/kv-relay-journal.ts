/** zzz1288 — which journal script this is (the collector's ENQUEUE_LUA / ACK_LUA), by what it does; null for anything else. */
export function journalScript(src: string): 'enqueue' | 'ack' | null {
  const t = src.replace(/\s+/g, '');
  if (t === "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]);redis.call('SADD',KEYS[2],ARGV[3]);redis.call('EXPIRE',KEYS[2],ARGV[2]);return1") return 'enqueue';
  if (t === "redis.call('SREM',KEYS[2],ARGV[1]);redis.call('DEL',KEYS[1]);return1") return 'ack';
  return null;
}
