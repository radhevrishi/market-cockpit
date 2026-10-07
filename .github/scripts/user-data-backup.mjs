import { createHash, randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';

const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null);
export const backupHash = v => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 24);

export function verifyBackup(data) {
  if (!data?.ok || data.formatVersion !== 2 || !Array.isArray(data.items) || !data.usBook) throw new Error('Incomplete backup: version 2 and explicit US book coverage required');
  const keys = new Set();
  for (const item of data.items) {
    if (typeof item.key !== 'string' || !item.key || keys.has(item.key) || !Object.hasOwn(item, 'value') || !Number.isSafeInteger(item.version) || item.version < 1 || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('Invalid or duplicate saved-state record');
    if (item.hash !== backupHash(item.value)) throw new Error('Saved-state integrity mismatch');
    keys.add(item.key);
  }
  const book = data.usBook;
  if (!/^us-book:v1:[A-Za-z0-9_-]+$/.test(book.key) || !Object.hasOwn(book, 'value') || book.hash !== backupHash(book.value)) throw new Error('US book integrity mismatch');
  if (book.value !== null && (book.value?.version !== 1 || !Array.isArray(book.value.holdings) || !Array.isArray(book.value.bench) || !book.value.cash || typeof book.value.cash !== 'object')) throw new Error('Invalid US book document');
  return data;
}

export function encryptBackup(data, password) {
  verifyBackup(data);
  if (!password) throw new Error('Backup encryption password is required');
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  cipher.setAAD(Buffer.from('MCBK2'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({ format: 'MCBK2', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

export function decryptBackup(encrypted, password) {
  if (!password) throw new Error('Backup encryption password is required');
  const e = JSON.parse(String(encrypted));
  if (e.format !== 'MCBK2') throw new Error('Unsupported encrypted backup format');
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, Buffer.from(e.salt, 'base64'), 32), Buffer.from(e.iv, 'base64'));
  decipher.setAAD(Buffer.from('MCBK2')); decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]);
  return verifyBackup(JSON.parse(plaintext.toString('utf8')));
}

/** Restore to an isolated schema and KV key, then read every record back. */
export async function restoreCheck(db, kv, data, migrations) {
  verifyBackup(data);
  const schema = `backup_drill_${randomUUID().replaceAll('-', '')}`;
  const bookKey = `${schema}:us-book`;
  let begun = false;
  try {
    await db.query('BEGIN'); begun = true;
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    for (const migration of migrations) await db.query(migration.sql);
    for (const item of data.items) {
      const value = JSON.stringify(item.value);
      await db.query('INSERT INTO user_state (key,value,hash,version,bytes,device,updated_at) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7)', [item.key, value, item.hash, item.version, Buffer.byteLength(value), item.device ?? null, item.updatedAt]);
      await db.query('INSERT INTO user_state_history (key,value,hash,version,device) VALUES ($1,$2::jsonb,$3,$4,$5)', [item.key, value, item.hash, item.version, item.device ?? null]);
    }
    const restored = (await db.query('SELECT key,value,hash,version FROM user_state')).rows;
    const expected = new Map(data.items.map(item => [item.key, item]));
    if (restored.length !== expected.size) throw new Error('Restored record count mismatch');
    for (const item of restored) {
      const want = expected.get(item.key);
      if (!want || backupHash(item.value) !== want.hash || item.hash !== want.hash || Number(item.version) !== want.version) throw new Error('Restored database record mismatch');
    }
    if (await kv.set(bookKey, JSON.stringify(data.usBook.value)) !== 'OK') throw new Error('Restore KV write was not acknowledged');
    const book = JSON.parse(await kv.get(bookKey));
    if (backupHash(book) !== data.usBook.hash) throw new Error('Restored US book mismatch');
    return { records: restored.length, usBookPresent: data.usBook.value !== null };
  } finally {
    try { if (begun) await db.query('ROLLBACK'); } finally { await kv.del(bookKey); }
  }
}

// A minimal RESP2 client for the disposable local Redis service; no production credentials.
export function redisCommand(url, args) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.password || u.username) throw new Error('Restore drill requires disposable loopback Redis');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: u.hostname, port: Number(u.port || 6379) }); let buffer = Buffer.alloc(0); let finished = false;
    const fail = error => { finished = true; socket.destroy(); reject(error); };
    const done = value => { finished = true; socket.destroy(); resolve(value); };
    socket.setTimeout(10000, () => fail(new Error('Restore Redis timed out'))); socket.on('error', fail);
    socket.on('connect', () => {
      const parts = args.map(String).map(a => Buffer.from(a));
      socket.write(Buffer.concat([Buffer.from(`*${parts.length}\r\n`), ...parts.flatMap(p => [Buffer.from(`$${p.length}\r\n`), p, Buffer.from('\r\n')])]));
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]); const end = buffer.indexOf('\r\n'); if (end < 0) return;
      const type = String.fromCharCode(buffer[0]), line = buffer.subarray(1, end).toString();
      if (type === '-') return fail(new Error('Restore Redis rejected the command'));
      if (type === '$') {
        const size = Number(line); if (size === -1) done(null);
        else if (buffer.length >= end + 2 + size + 2) done(buffer.subarray(end + 2, end + 2 + size).toString());
      } else done(type === ':' ? Number(line) : line);
    });
    socket.on('close', () => { if (!finished) fail(new Error('Restore Redis closed without acknowledgement')); });
  });
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'decrypt') { writeFileSync(output, JSON.stringify(decryptBackup(readFileSync(input, 'utf8'), process.env.PASS)), { mode: 0o600 }); return; }
  const data = verifyBackup(JSON.parse(readFileSync(input, 'utf8')));
  if (command === 'verify') { console.log(`Verified ${data.items.length} state records; US book explicitly covered`); return; }
  if (command === 'encrypt') {
    const encrypted = encryptBackup(data, process.env.PASS);
    // Authenticate and parse the actual artifact bytes before accepting it.
    writeFileSync(output, encrypted, { mode: 0o600 }); decryptBackup(readFileSync(output, 'utf8'), process.env.PASS); return;
  }
  if (command === 'restore-check') {
    const url = new URL(process.env.RESTORE_DATABASE_URL || '');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Restore drill requires disposable loopback PostgreSQL');
    const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
    const { Client } = require('pg'); const db = new Client({ connectionString: url.href });
    const { MIGRATIONS } = await import('../../frontend/src/lib/db-migrate.ts');
    const redis = process.env.RESTORE_REDIS_URL;
    await db.connect();
    try { console.log(await restoreCheck(db, { set: (k,v) => redisCommand(redis,['SET',k,v]), get: k => redisCommand(redis,['GET',k]), del: k => redisCommand(redis,['DEL',k]) }, data, MIGRATIONS)); }
    finally { await db.end(); }
    return;
  }
  throw new Error('Use verify, encrypt, decrypt or restore-check');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Backup operation failed; artifact was not accepted.'); process.exitCode = 1; });
