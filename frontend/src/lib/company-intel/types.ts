// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE — shared types.
//
// PATCH 0458 — Next.js route files reject any export that isn't a recognised
// handler (GET/POST/PATCH/DELETE/runtime/dynamic/maxDuration etc). Originally
// `IntelDocument` and `IntelCorpus` lived in the [ticker] route and broke
// the Vercel build. Now they live here so anyone — routes, libs, components
// — can import them safely.
// ═══════════════════════════════════════════════════════════════════════════

import type { GuidanceItem } from './guidance-extractor';

export interface IntelDocument {
  id: string;
  kind: 'concall_transcript' | 'earnings_ppt' | 'guidance_doc' | 'investor_presentation' | 'manual' | 'other';
  title: string;
  text: string;
  uploaded_at: string;
  size_chars: number;
}

export interface IntelCorpus {
  ticker: string;
  company?: string;
  documents: IntelDocument[];
  guidance: (GuidanceItem & { source_doc_id?: string })[];
  summary?: string;
  updated_at: string;
}
