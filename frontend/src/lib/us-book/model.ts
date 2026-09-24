// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — THE DOCUMENT.                                  (zzz790)
//
// Pure shapes and transforms for the US book. The store (lib/us-book-store)
// persists exactly this document under its OWN KV key, apart from the India
// book (`book:v1:*`, `portfolio:*`) — the two books never share a key.
//
// THE ENGINE SEES A PROJECTION, NOT THE BOOK. `thesisUniverse` returns
// ticker / listing / origin and nothing else: no quantity, no cost, no
// price. The catalyst engine is fed from that projection only, so a price
// cannot reach it even by accident.
// ═══════════════════════════════════════════════════════════════════════════

import { classifyListing, normalizeExchange, normalizeUsTicker, type UsCash, type UsHoldingInput, type UsImportResult, type UsListing } from './import';

export interface UsHolding extends UsHoldingInput {
  addedAt: string;
  updatedAt: string;
  note?: string | null;
}

export interface UsBenchEntry {
  ticker: string;
  exchange: string;
  listing: UsListing;
  listingNote: string;
  note?: string | null;
  addedAt: string;
}

export interface UsBook {
  version: 1;
  owner: string;
  updatedAt: string;
  holdings: UsHolding[];
  /** Cash per currency — USD, EUR, BASE (IBKR base-currency total), … Never a holding. */
  cash: UsCash;
  bench: UsBenchEntry[];
  /** The last import's audit line, so the page can say what was loaded. */
  lastImport?: { at: string; format: string; mode: 'replace' | 'merge'; holdings: number; cash: string[]; warnings: string[]; rejected: number } | null;
}

export const US_BOOK_MAX_HOLDINGS = 500;
export const US_BOOK_MAX_BENCH = 500;

export function emptyUsBook(owner: string, now = new Date().toISOString()): UsBook {
  return { version: 1, owner, updatedAt: now, holdings: [], cash: {}, bench: [], lastImport: null };
}

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: any, n = 200): string => String(v ?? '').slice(0, n);

/** Coerce anything that came over the wire into a well-formed holding, or null. */
export function sanitizeHolding(raw: any, now = new Date().toISOString()): UsHolding | null {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = normalizeUsTicker(raw.ticker);
  const quantity = num(raw.quantity);
  if (!ticker || quantity == null || quantity === 0) return null;
  const exchange = normalizeExchange(raw.exchange);
  const currency = str(raw.currency, 8).toUpperCase().trim() || 'USD';
  const { listing, note } = classifyListing(exchange, currency);
  return {
    ticker, rawTicker: str(raw.rawTicker || raw.ticker, 24), exchange, currency, quantity,
    avgPrice: num(raw.avgPrice), listing, listingNote: note,
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : now,
    updatedAt: now,
    note: raw.note ? str(raw.note, 300) : null,
  };
}

export function sanitizeCash(raw: any): UsCash {
  const out: UsCash = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).toUpperCase().trim().slice(0, 8);
    if (!/^[A-Z]{3,4}$/.test(key)) continue;
    const n = num(v);
    if (n != null) out[key] = Math.round(n * 100) / 100;
  }
  return out;
}

export function sanitizeBenchEntry(raw: any, now = new Date().toISOString()): UsBenchEntry | null {
  const ticker = normalizeUsTicker(typeof raw === 'string' ? raw : raw?.ticker);
  if (!ticker) return null;
  const exchange = normalizeExchange(typeof raw === 'string' ? '' : raw?.exchange);
  const { listing, note } = classifyListing(exchange, typeof raw === 'string' ? 'USD' : (raw?.currency || 'USD'));
  return { ticker, exchange, listing, listingNote: note, note: raw?.note ? str(raw.note, 300) : null, addedAt: typeof raw?.addedAt === 'string' ? raw.addedAt : now };
}

/** A stored document read back from KV, normalised to the current shape. */
export function sanitizeUsBook(raw: any, owner: string): UsBook {
  if (!raw || typeof raw !== 'object') return emptyUsBook(owner);
  const now = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
  const holdings = (Array.isArray(raw.holdings) ? raw.holdings : []).map((h: any) => {
    const s = sanitizeHolding(h, now);
    if (s && typeof h?.updatedAt === 'string') s.updatedAt = h.updatedAt;   // keep the stored timestamp
    return s;
  }).filter(Boolean).slice(0, US_BOOK_MAX_HOLDINGS) as UsHolding[];
  return {
    version: 1, owner, updatedAt: now, holdings,
    cash: sanitizeCash(raw.cash),
    bench: (Array.isArray(raw.bench) ? raw.bench : []).map((b: any) => sanitizeBenchEntry(b, now)).filter(Boolean).slice(0, US_BOOK_MAX_BENCH) as UsBenchEntry[],
    lastImport: raw.lastImport && typeof raw.lastImport === 'object' ? raw.lastImport : null,
  };
}

const keyOf = (h: { ticker: string; exchange: string }) => `${h.ticker}|${h.exchange}`;

/**
 * Apply an import. `replace` swaps the positions and the cash for the
 * imported ones (the bench is untouched); `merge` upserts by ticker+venue and
 * replaces only the cash currencies the import carries.
 */
export function applyImport(book: UsBook, imp: UsImportResult, mode: 'replace' | 'merge', now = new Date().toISOString()): UsBook {
  const incoming: UsHolding[] = imp.holdings.map((h) => ({ ...h, addedAt: now, updatedAt: now, note: null }));
  let holdings: UsHolding[];
  let cash: UsCash;
  if (mode === 'replace') {
    // A name already in the book keeps its first-added date and note.
    const prev = new Map(book.holdings.map((h) => [keyOf(h), h]));
    holdings = incoming.map((h) => { const p = prev.get(keyOf(h)); return p ? { ...h, addedAt: p.addedAt, note: p.note ?? null } : h; });
    cash = { ...imp.cash };
  } else {
    const byKey = new Map(book.holdings.map((h) => [keyOf(h), h]));
    for (const h of incoming) {
      const p = byKey.get(keyOf(h));
      byKey.set(keyOf(h), p ? { ...h, addedAt: p.addedAt, note: p.note ?? null } : h);
    }
    holdings = Array.from(byKey.values());
    cash = { ...book.cash, ...imp.cash };
  }
  return {
    ...book, updatedAt: now,
    holdings: holdings.slice(0, US_BOOK_MAX_HOLDINGS),
    cash,
    lastImport: { at: now, format: imp.format, mode, holdings: imp.holdings.length, cash: Object.keys(imp.cash), warnings: imp.warnings.slice(0, 40), rejected: imp.rejected.length },
  };
}

export function upsertHolding(book: UsBook, h: UsHolding, now = new Date().toISOString()): UsBook {
  const rest = book.holdings.filter((x) => keyOf(x) !== keyOf(h));
  const prev = book.holdings.find((x) => keyOf(x) === keyOf(h));
  const next = { ...h, addedAt: prev?.addedAt || h.addedAt || now, updatedAt: now };
  return { ...book, updatedAt: now, holdings: [...rest, next].slice(0, US_BOOK_MAX_HOLDINGS) };
}

export function removeHolding(book: UsBook, ticker: string, exchange?: string | null, now = new Date().toISOString()): UsBook {
  const t = normalizeUsTicker(ticker);
  const x = exchange == null ? null : normalizeExchange(exchange);
  return { ...book, updatedAt: now, holdings: book.holdings.filter((h) => !(h.ticker === t && (x == null || h.exchange === x))) };
}

export function setCash(book: UsBook, currency: string, amount: number | null, now = new Date().toISOString()): UsBook {
  const k = String(currency || '').toUpperCase().trim();
  if (!/^[A-Z]{3,4}$/.test(k)) return book;
  const cash = { ...book.cash };
  if (amount == null) delete cash[k]; else cash[k] = Math.round(amount * 100) / 100;
  return { ...book, updatedAt: now, cash };
}

export function addBench(book: UsBook, entry: UsBenchEntry, now = new Date().toISOString()): UsBook {
  if (book.bench.some((b) => b.ticker === entry.ticker)) return book;
  return { ...book, updatedAt: now, bench: [...book.bench, entry].slice(0, US_BOOK_MAX_BENCH) };
}

export function removeBench(book: UsBook, ticker: string, now = new Date().toISOString()): UsBook {
  const t = normalizeUsTicker(ticker);
  return { ...book, updatedAt: now, bench: book.bench.filter((b) => b.ticker !== t) };
}

// ── THE ENGINE'S VIEW ──────────────────────────────────────────────────────

export type UsOrigin = 'book' | 'bench' | 'both';

export interface UsUniverseEntry {
  ticker: string;
  origin: UsOrigin;
  listing: UsListing;
  exchange: string;
  /** Why a NON_US name is excluded from the engine, in words. */
  excludedReason: string | null;
}

/**
 * The catalyst engine's input: which names, from where, and whether SEC
 * covers them. Carries NO quantity, cost or price — by construction.
 */
export function thesisUniverse(book: Pick<UsBook, 'holdings' | 'bench'>): UsUniverseEntry[] {
  const out = new Map<string, UsUniverseEntry>();
  for (const h of book.holdings) {
    const prev = out.get(h.ticker);
    // A ticker held on a US venue AND on Frankfurt is one US company.
    const listing: UsListing = prev?.listing === 'US' || h.listing === 'US' ? 'US' : 'NON_US';
    out.set(h.ticker, {
      ticker: h.ticker, origin: 'book', listing,
      exchange: listing === 'US' && h.listing !== 'US' ? (prev?.exchange || h.exchange) : h.exchange,
      excludedReason: listing === 'NON_US' ? `${h.ticker} is held on ${h.listingNote}` : null,
    });
  }
  for (const b of book.bench) {
    const prev = out.get(b.ticker);
    if (prev) { out.set(b.ticker, { ...prev, origin: 'both' }); continue; }
    out.set(b.ticker, { ticker: b.ticker, origin: 'bench', listing: b.listing, exchange: b.exchange,
      excludedReason: b.listing === 'NON_US' ? `${b.ticker} (bench) is on ${b.listingNote}` : null });
  }
  return Array.from(out.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}
