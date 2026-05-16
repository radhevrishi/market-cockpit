// PATCH 0434 (BUG-008) — HTML entity decode utility.
// User reported: "Top Gainers &amp; Losers" rendered as literal text with
// '&amp;' visible. Headlines come from RSS feeds + NSE/BSE which often
// double-encode entities. Decode at render boundary.
//
// Covers the common entities seen in financial news + an iterative pass
// to handle double-encoded strings ('&amp;amp;' → '&amp;' → '&').

const ENTITY_MAP: Record<string, string> = {
  '&amp;':   '&',
  '&lt;':    '<',
  '&gt;':    '>',
  '&quot;':  '"',
  '&apos;':  "'",
  '&#39;':   "'",
  '&nbsp;':  ' ',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&#x27;':  "'",
  '&#x2F;':  '/',
  '&#x60;':  '`',
  '&#x3D;':  '=',
  '&Rs;':    '₹',
  '&rupee;': '₹',
};

export function decodeHTMLEntities(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  // Iterate up to 3 passes to handle double-encoded strings
  for (let i = 0; i < 3; i++) {
    let changed = false;
    // Named entities
    s = s.replace(/&[a-zA-Z][a-zA-Z0-9]+;/g, (match) => {
      const lower = match.toLowerCase();
      if (ENTITY_MAP[lower] !== undefined) { changed = true; return ENTITY_MAP[lower]; }
      if (ENTITY_MAP[match] !== undefined) { changed = true; return ENTITY_MAP[match]; }
      return match;
    });
    // Numeric entities — decimal
    s = s.replace(/&#(\d+);/g, (_m, n) => {
      changed = true;
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _m; }
    });
    // Numeric entities — hex
    s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => {
      changed = true;
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _m; }
    });
    if (!changed) break;
  }
  return s;
}
