// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — KV STORE.                                      (zzz790)
//
// Server-only. One document per owner under `us-book:v1:<owner>`, apart from
// every India key (`book:v1:*`, `portfolio:*`, `evidence:*`): the India book
// is not read or written here, and India code never reads this key.
//
// No TTL — a book is a record, not a cache. A write is read back before it
// is reported as saved (the same rule the evidence store follows: kvSet logs
// a Redis error and returns, so a quota-exhausted store would "succeed").
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet as realKvGet, kvSet as realKvSet } from '@/lib/kv';
import { emptyUsBook, sanitizeUsBook, type UsBook } from '@/lib/us-book/model';
import type { UsProfile } from '@/lib/us-book/profile';

export const US_BOOK_KEY = (owner: string) => `us-book:v1:${String(owner || 'owner').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'owner'}`;
/** The single-tenant owner id, the same default the India book uses. */
export const US_BOOK_OWNER = process.env.NEXT_PUBLIC_CHAT_ID || '5057319640';

type KvLike = { get: <T = any>(k: string) => Promise<T | null>; set: (k: string, v: any) => Promise<void> };
let kv: KvLike = { get: realKvGet, set: (k, v) => realKvSet(k, v) };
/** Test-only: swap the store's KV (null restores the real one). */
export function setUsBookKvForTests(fake: KvLike | null): void {
  kv = fake || { get: realKvGet, set: (k, v) => realKvSet(k, v) };
}

export async function readUsBook(owner: string = US_BOOK_OWNER): Promise<{ book: UsBook; error: string | null; exists: boolean }> {
  try {
    const raw = await kv.get<UsBook>(US_BOOK_KEY(owner));
    return { book: raw ? sanitizeUsBook(raw, owner) : emptyUsBook(owner), error: null, exists: !!raw };
  } catch (e: any) {
    return { book: emptyUsBook(owner), error: String(e?.message || e), exists: false };
  }
}

// zzz793 — company name + SEC industry per ticker (not personal data: no
// quantity, no cost). One small document, apart from the book itself.
export const US_PROFILE_KEY = 'us-book-profile:v1';

export async function readUsProfiles(): Promise<Record<string, UsProfile>> {
  try { return (await kv.get<Record<string, UsProfile>>(US_PROFILE_KEY)) || {}; } catch { return {}; }
}

export async function writeUsProfiles(p: Record<string, UsProfile>): Promise<void> {
  try { await kv.set(US_PROFILE_KEY, p); } catch { /* a cache — the page still shows what it fetched */ }
}

export async function writeUsBook(book: UsBook): Promise<{ ok: boolean; error: string | null }> {
  try {
    const clean = sanitizeUsBook(book, book.owner);
    clean.updatedAt = book.updatedAt || new Date().toISOString();
    await kv.set(US_BOOK_KEY(book.owner), clean);
    const back = await kv.get<UsBook>(US_BOOK_KEY(book.owner));
    if (!back || back.updatedAt !== clean.updatedAt) return { ok: false, error: 'write did not land in KV (read-back mismatch)' };
    return { ok: true, error: null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
