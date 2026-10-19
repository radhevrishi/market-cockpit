// zzz1123 (guidance audit: page design) — the Guidance Upgrades page as four workspaces over one dataset, instead of one long stack:
//   Focus · Guidance changes · Active guidance · Coverage & review, plus "Everything" (the old long page). The choice is in the URL
//   (?ws=) and remembered in this browser. Sections stay mounted when hidden (their data keeps loading and stays consistent). Pure.
export type GuWorkspace = 'focus' | 'changes' | 'active' | 'review' | 'all';
export const GU_WORKSPACES: ReadonlyArray<{ id: GuWorkspace; label: string; hint: string }> = [
  { id: 'focus', label: 'Focus', hint: 'The companies to look at first: a guidance raise and/or 30%+ growth guided, with fair value and scores.' },
  { id: 'changes', label: 'Guidance changes', hint: 'Formal raises in the chosen time window, each with its full check.' },
  { id: 'active', label: 'Active guidance', hint: 'Every guidance still in force (company and segment targets), ranked by trust and horizon, with a full search.' },
  { id: 'review', label: 'Coverage & review', hint: 'Names not read yet, questionable points, the review queue and how much of the market was read.' },
  { id: 'all', label: 'Everything', hint: 'All sections on one page.' },
];
export const GU_WS_KEY = 'mc:gu-workspace:v1';
export function parseWorkspace(v: unknown): GuWorkspace | null {
  return typeof v === 'string' && GU_WORKSPACES.some((w) => w.id === v) ? (v as GuWorkspace) : null;
}
/** Which workspace(s) a section belongs to. */
export const GU_SECTION_WS: Record<'focus' | 'events' | 'summary' | 'browser' | 'namecheck' | 'checks', GuWorkspace> = {
  focus: 'focus', events: 'changes', summary: 'active', browser: 'active', namecheck: 'review', checks: 'review',
};
export const sectionShown = (ws: GuWorkspace, section: keyof typeof GU_SECTION_WS) => ws === 'all' || GU_SECTION_WS[section] === ws;
