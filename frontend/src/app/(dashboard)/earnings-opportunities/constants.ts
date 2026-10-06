// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';
import type { EarningsTier } from './types';

// AUDIT_100 #10 — strict YYYY-MM-DD shape before lexical compare.
// Lexical `<` is only safe for canonical zero-padded ISO. Any source that
// emits `2026-5-9` (single-digit month/day) sorts wrong and silently drops
// or misplaces filings. Reject malformed dates instead of letting them slip.
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

// zzz814 — engine label for the "previous rules" note (the current namespace).
export const GRADED_ENGINE_LABEL = GRADED_CACHE_VERSION;
