// ═══════════════════════════════════════════════════════════════════════════
// COMMENTARY SCORE — HOW MUCH MANAGEMENT ACTUALLY TOLD YOU.          (zzz693)
//
// The India side has had a Concall Score since 0700: it reads the transcript
// or the investor presentation and scores how informative management was.
// The US side was asked for the same thing, and the first honest answer is
// that MOST US ISSUERS FILE NO TRANSCRIPT WITH THE SEC. SMTC's own card says
// so. There is no document to score, and inventing a number from a document
// that does not exist is exactly the failure this portal is built against.
//
// So this does not pretend to score a call. It scores THE MANAGEMENT
// COMMENTARY IN THE EARNINGS RELEASE — which does exist, for every 8-K Item
// 2.02, and which is where a US issuer puts its guidance, its segment
// commentary, its mix language and its capital-allocation decisions. The UI
// names the source in the chip's own tooltip. A reader must never be able to
// mistake this for a transcript reading.
//
// IT IS COMPUTED FROM THE VERIFIED SUMMARY, NOT FROM THE MODEL'S OPINION.
// The input is the `structured` object the AI Summary route has already
// checked figure-by-figure against the release text. So the score inherits
// that verification: a field that was dropped for carrying an unsupported
// number cannot contribute to the score. Nothing here calls a model, nothing
// here touches the network, and the same input always gives the same score —
// which is the property that lets it be compared across names and quarters.
//
// WHAT IT MEASURES, and deliberately what it does not. It measures DISCLOSURE
// QUALITY, not result quality. A company can print a poor quarter and score
// well by explaining it in detail with guidance attached; a company can print
// a superb quarter and score badly by saying almost nothing about it. That is
// the intended behaviour and it is the whole point of having the number next
// to the tier: the tier grades the result, this grades the telling. A high
// tier with a low commentary score is a real signal — a good print the
// company declined to stand behind with any forward statement.
//
// THE FOUR AXES mirror the India module's so the letters mean the same thing
// on both sides of the portal. India scores sentiment balance, topic
// coverage, sector-KPI hits and quote signal-density. Here:
//
//   Guidance    0-30  the single most price-relevant thing a release contains,
//                     and the one axis worth more than a quarter of the score.
//                     `none` earns zero — silence is not neutral.
//   Coverage    0-25  five buckets of five: segments, mix, capital, people,
//                     new business. Breadth of what management addressed.
//   Candour     0-25  whether the release states its own bad news, and states
//                     it with figures. See the note below — this axis was
//                     originally sentiment balance, and that was wrong.
//   Specificity 0-20  the share of items carrying an actual figure. A release
//                     that says "margins improved" scores below one that says
//                     "gross margin 31.2% from 28.4%".
//
// THE AXIS THAT HAD ITS SIGN BACKWARDS. The third axis was first written as
// sentiment balance — positives minus negatives, exactly as the India module
// scores tone. Tested against four realistic releases it did something this
// score must never do: a company that disclosed three substantiated negatives
// was marked DOWN, and a company that disclosed none was marked UP. The block
// header promises "how much management disclosed, not how good the quarter
// was", and an axis rewarding curated good news is the opposite of that
// promise. Worse, it is backwards as a signal: the releases that cost money
// are the ones that bury the bad news, not the ones that print it.
//
// So the axis measures CANDOUR instead. Stating negatives earns points;
// stating them with figures earns more. A release with no stated negative at
// all does not score zero — a quarter with genuinely nothing wrong does
// happen — but it scores below one that owns three, because silence there is
// more often curation than cleanliness. Tone has not been thrown away: it is
// reported as `toneNote`, beside the score rather than inside it, so the
// reader still sees the positive/negative count without it moving the number.
//
//   Penalty    up to -9  three per item the release does not disclose, capped,
//                     because absence is evidence but a summary that found
//                     four gaps should not be driven to the floor by them.
//
// The grade ladder lives here and india-concall.ts imports it, so the two
// cannot drift apart into two different meanings for the letter B.
// ═══════════════════════════════════════════════════════════════════════════

export type CommentaryGrade =
  | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

/** The shared ladder. India's concall score and the US commentary score both
 *  use it, so a B- means the same standard of disclosure on either side. */
export function commentaryGradeFor(score: number): CommentaryGrade {
  if (score >= 90) return 'A+';
  if (score >= 82) return 'A';
  if (score >= 75) return 'A-';
  if (score >= 68) return 'B+';
  if (score >= 60) return 'B';
  if (score >= 53) return 'B-';
  if (score >= 46) return 'C+';
  if (score >= 38) return 'C';
  if (score >= 30) return 'C-';
  if (score >= 20) return 'D';
  return 'F';
}

export interface CommentaryComponent {
  key: 'guidance' | 'coverage' | 'candour' | 'specificity' | 'gaps';
  label: string;
  points: number;   // signed — `gaps` is negative
  max: number;      // the axis ceiling (for `gaps`, the floor, as a negative)
  /** Plain-English reason for exactly this number, shown in the tooltip. */
  because: string;
}

export interface CommentaryScore {
  score: number;              // 0-100
  grade: CommentaryGrade;
  components: CommentaryComponent[];
  /** What was actually read. The UI must print this, not imply a transcript. */
  source: string;
  /** The positive/negative count, reported beside the score and deliberately
   *  NOT inside it — tone is result quality, which the tier already grades. */
  toneNote: string;
  /** True when a real call transcript backed the score (India), false when it
   *  was read from the earnings release only (US, and India without a deck). */
  fromTranscript: boolean;
}

const hasDigit = (s: unknown): boolean => typeof s === 'string' && /\d/.test(s);
const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 1;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Guidance points. Ordered by how much the release commits management to. */
const GUIDANCE_POINTS: Record<string, { pts: number; why: string }> = {
  raised:     { pts: 30, why: 'guidance raised — the strongest forward statement a release can make' },
  initiated:  { pts: 25, why: 'guidance initiated where there was none before' },
  maintained: { pts: 18, why: 'guidance maintained — a commitment, but not a new one' },
  lowered:    { pts: 7,  why: 'guidance lowered; management still put a number on the future' },
  withdrawn:  { pts: 2,  why: 'guidance withdrawn — the forward number was taken away' },
  none:       { pts: 0,  why: 'no forward guidance of any kind in this release' },
};

/**
 * Score the management commentary carried by a verified earnings-release
 * summary. `d` is the `structured` object from /api/v1/us/ai-summary, already
 * figure-checked against the release text.
 */
export function scoreReleaseCommentary(d: any): CommentaryScore | null {
  if (!d || typeof d !== 'object') return null;

  const pos: any[] = Array.isArray(d.positives) ? d.positives : [];
  const neg: any[] = Array.isArray(d.negatives) ? d.negatives : [];
  const segs: any[] = Array.isArray(d.segments) ? d.segments : [];
  const nb: string[] = Array.isArray(d.new_business) ? d.new_business : [];
  const nd: string[] = Array.isArray(d.not_disclosed) ? d.not_disclosed : [];
  const cap = d.capital && typeof d.capital === 'object' ? d.capital : {};

  // A summary with nothing in it at all is not a zero — it is an absence, and
  // the caller should show no chip rather than an F the reader would read as
  // a judgement on the company.
  if (pos.length === 0 && neg.length === 0 && segs.length === 0 && !nonEmpty(d.verdict_line)) {
    return null;
  }

  // ── 1. Guidance (0-30) ──
  const action = typeof d.guidance?.action === 'string' ? d.guidance.action : 'none';
  const gp = GUIDANCE_POINTS[action] || GUIDANCE_POINTS.none;
  let guidancePts = gp.pts;
  let guidanceWhy = gp.why;
  // A guidance action with no figures behind it is worth less than one with
  // them. "We expect a strong year" is not guidance in the sense that counts.
  if (guidancePts > 0 && !hasDigit(d.guidance?.detail)) {
    guidancePts = Math.round(guidancePts * 0.6);
    // The reasons already contain an "and"/"but" clause of their own, so this
    // is appended as its own sentence rather than chained onto them.
    guidanceWhy += '. Stated without a figure, so worth 60% of the axis';
  }

  // ── 2. Coverage (0-25) — five buckets of five ──
  const capLines = (['capex', 'buyback', 'dividend', 'debt'] as const).filter((k) => nonEmpty(cap[k]));
  const buckets: Array<{ name: string; hit: boolean }> = [
    { name: 'segments', hit: segs.length > 0 },
    { name: 'mix', hit: nonEmpty(d.mix_shift) },
    { name: 'capital allocation', hit: capLines.length > 0 },
    { name: 'management', hit: nonEmpty(d.management) },
    { name: 'new business', hit: nb.length > 0 },
  ];
  const hitNames = buckets.filter((b) => b.hit).map((b) => b.name);
  const coveragePts = hitNames.length * 5;

  // ── 3. Candour (0-25) ──
  // Does the release state its own bad news, and state it with figures?
  const negCount = neg.length;
  const negWithNum = neg.filter((it) => hasDigit(it?.detail)).length;
  let candourPts =
    negCount === 0 ? 6
      : negCount === 1 ? 14
      : negCount === 2 ? 19
      : 22;
  let candourWhy: string;
  if (negCount === 0) {
    candourWhy = 'the release states no negative at all — sometimes true, more often curated';
  } else {
    // All of them substantiated is worth the last three points.
    if (negWithNum === negCount) {
      candourPts = Math.min(25, candourPts + 3);
      candourWhy = `states ${negCount} negative${negCount === 1 ? '' : 's'}, all with figures`;
    } else {
      candourWhy = `states ${negCount} negative${negCount === 1 ? '' : 's'}, ${negWithNum} with a figure`;
    }
  }

  // ── 4. Specificity (0-20) ──
  const details: unknown[] = [
    ...pos.map((x) => x?.detail),
    ...neg.map((x) => x?.detail),
    ...segs.map((x) => x?.detail),
    ...capLines.map((k) => cap[k]),
    ...nb,
  ].filter(nonEmpty);
  const withNum = details.filter(hasDigit).length;
  const specPts = details.length > 0 ? Math.round((withNum / details.length) * 20) : 0;

  // ── 5. Gaps (0 to -9) ──
  const gapPts = -Math.min(9, nd.length * 3);

  const raw = guidancePts + coveragePts + candourPts + specPts + gapPts;
  const score = Math.round(clamp(raw, 0, 100));

  const components: CommentaryComponent[] = [
    {
      key: 'guidance', label: 'Guidance', points: guidancePts, max: 30,
      because: guidanceWhy,
    },
    {
      key: 'coverage', label: 'Coverage', points: coveragePts, max: 25,
      because: hitNames.length
        ? `addressed ${hitNames.join(', ')}`
        : 'addressed none of segments, mix, capital, people or new business',
    },
    {
      key: 'candour', label: 'Candour', points: candourPts, max: 25,
      because: candourWhy,
    },
    {
      key: 'specificity', label: 'Specificity', points: specPts, max: 20,
      because: details.length
        ? `${withNum} of ${details.length} points carry a figure from the release`
        : 'no itemised points to check for figures',
    },
    {
      key: 'gaps', label: 'Gaps', points: gapPts, max: -9,
      because: gapPts === 0
        ? 'nothing a reader would expect was found missing'
        : nd.length === 1
          ? 'one thing a reader would expect is not disclosed'
          : `${nd.length} things a reader would expect are not disclosed`,
    },
  ];

  return {
    score,
    grade: commentaryGradeFor(score),
    components,
    source: 'the management commentary in this earnings release — no call transcript was filed with the SEC',
    toneNote: `${pos.length} positive${pos.length === 1 ? '' : 's'}, ${neg.length} negative${neg.length === 1 ? '' : 's'}`,
    fromTranscript: false,
  };
}
