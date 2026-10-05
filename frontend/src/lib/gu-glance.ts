// zzz880 — the one-word verdict per market on the guidance page's "At a glance" table. Pure.
export interface GlanceIn { active: number | null; high: number | null; pending: number | null }
export interface GlanceVerdict { word: string; tone: 'good' | 'reading' | 'thin' | 'none'; why: string }
export function glanceVerdict(x: GlanceIn): GlanceVerdict {
  if (x.active == null) return { word: 'Not loaded', tone: 'none', why: 'The guidance list did not load.' };
  if ((x.pending ?? 0) > 50) return { word: 'Still reading documents', tone: 'reading', why: `${x.pending} company documents are waiting for the AI reader (it runs every hour); more names will appear as they are read.` };
  if (x.active === 0) return { word: 'No guidance yet', tone: 'none', why: 'No company guidance is in force in the data read so far.' };
  if ((x.high ?? 0) === 0) return { word: 'Read — no high-growth names', tone: 'thin', why: 'Documents are read; none guides growth at or above the threshold.' };
  return { word: 'Up to date', tone: 'good', why: 'Documents are read and the ranked list is current.' };
}
