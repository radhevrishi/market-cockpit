/**
 * THE OWN-GUIDE VERDICT — one function, so the top of a card cannot contradict
 * its middle.
 *
 * SentinelOne's Q2 FY27 release is the filer that exposed this. Its chip row
 * read "📣 Own outlook raised" while the guidance block four lines below it
 * read "FY27 GUIDE · MIXED VS OWN PRIOR GUIDE" — and the block was right:
 * SentinelOne raised its FY27 revenue and operating-income ranges and CUT its
 * FY27 adjusted-EPS range by 11.4%, all in the same table. Salesforce and
 * Autodesk carried the same contradiction on the same day; HP Inc. carried it
 * on a quarter guide rather than a year guide.
 *
 * The two statements had two different authors. The chip came from the
 * release's PROSE ("we are raising our outlook…"), classified in
 * lib/us-guidance.ts; the block came from ARITHMETIC on two releases' stated
 * ranges. When prose and arithmetic disagree the arithmetic wins — that
 * principle was already written down in the graded-us route for the Okta case
 * ("Okta's release reads as a cut and every FY line in it went up") — but the
 * route's version could only ever land on RAISED or LOWERED: it compared the
 * count of raised lines against the count of cut lines and took the majority,
 * which turns "raised two, cut one" into an unqualified "raised". A revision
 * that went both ways is a THIRD verdict, not a vote to be won.
 *
 * So the direction of a single guided figure, and the verdict over a set of
 * them, live here — imported by the card (chip AND block) and by the route
 * (tags and the published verdict). There is exactly one implementation, so
 * there is nothing left to diverge.
 */

/** "FY27", "FY2027", "fiscal 2027" and "Q3 FY27" all reduce to a comparable
 *  key. Two consecutive releases spell the same period differently often
 *  enough that matching on the raw string silently loses the pairing. */
export const fyLike = (s: string | null | undefined): string => {
  const t = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const q = /\bQ([1-4])\b/.exec(t);
  const y = /(?:FY|FISCAL(?:\s+YEAR)?)?\s*'?(\d{4}|\d{2})\b/.exec(t);
  const yy = y ? (y[1].length === 4 ? y[1].slice(2) : y[1]) : '';
  return `${q ? `Q${q[1]}` : 'FY'}:${yy}`;
};

/** The direction one guided line moved against the same line in the previous
 *  release. `narrowed` / `widened` are deliberately neither up nor down: a
 *  range that tightened around the same midpoint is not a revision. */
export type OwnGuideDir = 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';

/** The shape of a guided figure this module needs — a structural subset of the
 *  route's `GuidanceFigure`, so both the route and the card can pass theirs. */
export interface GuideFigLike {
  metric: string;
  basis?: 'gaap' | 'adjusted' | null;
  period?: 'quarter' | 'year' | string | null;
  period_label?: string | null;
  /** A "prior" column inside THIS release's own outlook table, when it has one. */
  prior_low?: number | null;
  prior_high?: number | null;
  raised?: boolean | null;
}

/** The shape of a cross-release change this module needs — a structural subset
 *  of the route's `guideChange` output. */
export interface GuideChangeLike {
  metric: string;
  basis?: string | null;
  period_label?: string | null;
  prev_low?: number | null;
  prev_high?: number | null;
  direction: OwnGuideDir;
}

/**
 * How one guided figure moved against the company's own previous guide.
 *
 * The cross-release arithmetic (`guide_change`) is the first authority because
 * it is computed from two filed documents. A "prior" column printed inside this
 * release's own table is the fallback — most filers, SentinelOne included, do
 * not print one, which is why the cross-release comparison exists at all.
 * Returns null when neither is available: a figure with nothing to be compared
 * against gets no verb rather than a borrowed one.
 */
export function ownGuideMove(
  f: GuideFigLike,
  changes: GuideChangeLike[] | null | undefined,
): { dir: OwnGuideDir; lo: number | null; hi: number | null } | null {
  const chg = Array.isArray(changes) ? changes : [];
  const c = chg.find((x) => x && x.metric === f.metric
    && (x.basis == null || f.basis == null || x.basis === f.basis)
    && fyLike(x.period_label) === fyLike(f.period_label));
  if (c) return { dir: c.direction, lo: c.prev_low ?? null, hi: c.prev_high ?? null };
  if (f.prior_low != null || f.prior_high != null) {
    return {
      dir: f.raised === true ? 'raised' : f.raised === false ? 'lowered' : 'reiterated',
      lo: f.prior_low ?? null, hi: f.prior_high ?? null,
    };
  }
  return null;
}

export type OwnGuideVerdict = 'RAISED' | 'LOWERED' | 'MIXED' | 'REITERATED';

/**
 * The verdict over a set of guided figures — what the card's chip says and what
 * every heading inside the guidance block says, from one rule:
 *
 *   • at least one line up AND at least one line down → MIXED
 *   • only up → RAISED · only down → LOWERED
 *   • lines compared, none moved → REITERATED
 *   • nothing comparable at all → null (the caller may fall back to the
 *     release's own words, and must say that is what it is doing)
 *
 * `computed` distinguishes the two: true when the arithmetic decided it, false
 * when this is only the prose label passed through.
 */
export function ownGuideVerdict(
  figs: GuideFigLike[] | null | undefined,
  changes: GuideChangeLike[] | null | undefined,
  proseLabel?: string | null,
): { verdict: OwnGuideVerdict; computed: boolean } | null {
  const list = (Array.isArray(figs) ? figs : []).filter(Boolean);
  const dirs: OwnGuideDir[] = [];
  for (const f of list) {
    const m = ownGuideMove(f, changes);
    if (m) dirs.push(m.dir);
  }
  // A change row with no surviving figure to hang it on still counts: the
  // route publishes `guide_change` for the full-year lines whether or not the
  // card is rendering every one of them.
  if (!dirs.length) {
    for (const c of (Array.isArray(changes) ? changes : [])) if (c) dirs.push(c.direction);
  }
  if (dirs.length) {
    const up = dirs.filter((d) => d === 'raised').length;
    const down = dirs.filter((d) => d === 'lowered').length;
    if (up && down) return { verdict: 'MIXED', computed: true };
    if (up) return { verdict: 'RAISED', computed: true };
    if (down) return { verdict: 'LOWERED', computed: true };
    return { verdict: 'REITERATED', computed: true };
  }
  const lbl = String(proseLabel || '').toUpperCase();
  if (lbl === 'RAISED') return { verdict: 'RAISED', computed: false };
  if (lbl === 'LOWERED' || lbl === 'WITHDRAWN') return { verdict: 'LOWERED', computed: false };
  if (lbl === 'MAINTAINED') return { verdict: 'REITERATED', computed: false };
  return null;
}
