// zzz1084 — retest improvement 2: a warning says WHICH companies it is about. The build's price-source note counts the whole
// market ("91 companies …"); with one company handed over from the Stock Screener that read as if it were about that company.
// When the Pine Screener is limited to a list, the note is rewritten: the count inside the list first, the universe count after,
// labelled as such. Pure.
import type { ScreenMarket } from './types';
import { normTicker } from './pine-handoff';

export const UNIVERSE_NOTE_RE = /^Across the full (India|USA) universe \((\d+) companies\): (\d+) companies show/;

export function scopedNotes(notes: readonly string[], rows: readonly { t: string; pxConflict?: unknown }[], list: ReadonlySet<string> | null, listName: string, market: ScreenMarket): string[] {
  return notes.map((n) => {
    const m = n.match(UNIVERSE_NOTE_RE);
    if (!m) return n;
    if (!list) return n;
    let inList = 0, hit = 0;
    for (const r of rows) {
      if (!list.has(normTicker(r.t))) continue;
      inList++;
      if (r.pxConflict) hit++;
    }
    const where = market === 'IN' ? 'India' : 'USA';
    const head = hit
      ? `In ${listName || 'your list'}: ${hit} of ${inList} compan${inList === 1 ? 'y shows' : 'ies show'} a latest quote more than 2% from the close the patterns were read from (different price sources) — pattern distances use the scan close; the quote distance is shown apart.`
      : `In ${listName || 'your list'}: none of the ${inList} compan${inList === 1 ? 'y' : 'ies'} has a price-source gap.`;
    return `${head} (Across the full ${where} universe: ${m[3]} of ${m[2]}.)`;
  });
}
