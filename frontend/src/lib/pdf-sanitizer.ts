// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0391 — PDF text sanitizer for Concall Intel.
//
// Cleans extracted PDF text before scoring + evidence-quote display.
// User feedback: "03Where Platform Meets Possibilitiescms.com..." was
// surfacing as evidence — junk slide template + URL artifacts from
// pdf-parse output.
//
// Removes:
//   - Page numbers ("Page 12 of 24", "12 / 24", bare "12")
//   - Header/footer repeats (company name appearing >10x at line start)
//   - URLs and email artifacts within sentences
//   - OCR garbage (lines with >40% non-alphanumeric, or single-letter chunks)
//   - Slide template duplicates (same short line appearing 4+ times)
//   - Investor-relations contact blocks
//   - Disclaimer / safe-harbor blocks
//   - Excess whitespace, dehyphenation across lines
// Preserves sentence boundaries (don't merge sentences across cleanups).
// ═══════════════════════════════════════════════════════════════════════════

export interface SanitizationStats {
  before_chars: number;
  after_chars: number;
  removed_pct: number;
  removed_categories: string[];
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}/gi;
const PAGE_NUM_RE = /^\s*(?:page\s+)?(\d+)\s*(?:\/|of)\s*\d+\s*$/i;
const BARE_PAGE_NUM_RE = /^\s*\d{1,3}\s*$/;
const DISCLAIMER_RE = /(this\s+(?:presentation|document)\s+(?:contains|may\s+contain)\s+forward[\s-]?looking|safe\s+harbo[u]?r\s+statement|cautionary\s+statement\s+regarding\s+forward)/i;
const COPYRIGHT_RE = /(©|copyright)\s*\d{4}/i;

const OCR_GARBAGE_RE = /[^\x20-\x7E\n]/g;  // strip non-printable
const REPEATED_PUNCT_RE = /([.,;:!?-]){3,}/g;

function isOCRGarbage(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4) return true;
  // Lines with mostly numbers/special chars
  const alphas = trimmed.match(/[A-Za-z]/g)?.length || 0;
  if (alphas < 3) return true;
  const ratio = alphas / trimmed.length;
  if (ratio < 0.4) return true;
  // Lines that look like template fragments (eg "03Where Platform Meets Possibilitiescms.com")
  // Heuristic: a digit immediately followed by camelCase or all-lowercase concatenation = junk
  if (/^\d+\s*[A-Z][a-z]+[A-Z][a-z]+/.test(trimmed)) return true;
  return false;
}

function dehyphenate(text: string): string {
  // PDF line breaks often leave "manage-\nment" — fix to "management"
  return text.replace(/(\w+)-\n(\w+)/g, '$1$2');
}

function stripHeaderFooterRepeats(lines: string[]): { kept: string[]; removed: number } {
  // A line that appears at the START or END of pages 10+ times is likely
  // a recurring header/footer (company name, slide URL, IR contact).
  const counts = new Map<string, number>();
  for (const ln of lines) {
    const t = ln.trim();
    if (t.length < 5 || t.length > 80) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const totalLines = lines.length;
  const repeatThreshold = Math.max(4, Math.floor(totalLines / 50));  // 1 per ~50 lines
  const headerFooterSet = new Set<string>();
  for (const [line, n] of counts.entries()) {
    if (n >= repeatThreshold) headerFooterSet.add(line);
  }
  const kept = lines.filter(l => !headerFooterSet.has(l.trim()));
  return { kept, removed: lines.length - kept.length };
}

function stripDisclaimerBlock(text: string): string {
  // Cut off everything after the disclaimer trigger to end of next 2KB
  const m = text.match(DISCLAIMER_RE);
  if (!m || m.index == null) return text;
  // Disclaimers are usually at start or end. Keep the longer half.
  const head = text.slice(0, m.index);
  // Find next paragraph break after disclaimer
  const after = text.slice(m.index);
  // Skip ~1500 chars typical for disclaimer block
  const tail = after.length > 2500 ? after.slice(2000) : '';
  return head.length > tail.length ? head : tail;
}

export function sanitizePdfText(raw: string): { text: string; stats: SanitizationStats } {
  const before = raw.length;
  const removed: string[] = [];

  let text = raw;

  // 1. Dehyphenate line-broken words
  text = dehyphenate(text);

  // 2. Strip non-printables
  text = text.replace(OCR_GARBAGE_RE, ' ');

  // 3. Strip URLs + emails — they appear in headers / footers and pollute evidence
  if (URL_RE.test(text)) removed.push('URLs');
  text = text.replace(URL_RE, ' ');
  text = text.replace(EMAIL_RE, ' ');

  // 4. Cut disclaimer / safe-harbor blocks
  const beforeDisclaimer = text.length;
  text = stripDisclaimerBlock(text);
  if (text.length < beforeDisclaimer * 0.9) removed.push('disclaimer block');

  // 5. Line-by-line cleanup
  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  let pageNumCount = 0;
  let ocrGarbCount = 0;
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (PAGE_NUM_RE.test(t) || BARE_PAGE_NUM_RE.test(t)) { pageNumCount++; continue; }
    if (COPYRIGHT_RE.test(t)) continue;
    if (isOCRGarbage(t)) { ocrGarbCount++; continue; }
    cleanedLines.push(t);
  }
  if (pageNumCount > 0) removed.push(`${pageNumCount} page-numbers`);
  if (ocrGarbCount > 0) removed.push(`${ocrGarbCount} OCR-garbage lines`);

  // 6. Strip recurring header/footer
  const { kept, removed: hfRemoved } = stripHeaderFooterRepeats(cleanedLines);
  if (hfRemoved > 0) removed.push(`${hfRemoved} header/footer repeats`);

  // 7. Join + normalize whitespace; preserve sentence boundaries
  let joined = kept.join(' ');
  joined = joined.replace(REPEATED_PUNCT_RE, '$1');
  joined = joined.replace(/\s+([,.;:!?])/g, '$1');
  joined = joined.replace(/\s{2,}/g, ' ');
  joined = joined.replace(/([.!?])\s*([A-Z])/g, '$1 $2');  // ensure space after sentence end

  const after = joined.length;
  return {
    text: joined.trim(),
    stats: {
      before_chars: before,
      after_chars: after,
      removed_pct: before > 0 ? Math.round(((before - after) / before) * 100) : 0,
      removed_categories: removed,
    },
  };
}
