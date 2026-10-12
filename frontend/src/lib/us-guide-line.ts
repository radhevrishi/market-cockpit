// ═══════════════════════════════════════════════════════════════════════════
// zzz971 — ONE LINE: DID MANAGEMENT RAISE, KEEP OR LOWER ITS GUIDANCE?
//
// Owner: "use ai to know if company raised or lowered guidance, also show me that
// in one liner … if lowered, BLOCKBUSTER or STRONG goes to MIXED; if raised also
// show in one line".
//
// Every US card gets one thin line. It is built from, in this order:
//   1. the outside check (lib/us-guide-check): the filing's exhibits, the
//      earnings-call write-ups (free), then AI with a web search (extra, small
//      daily ceiling) — a LOWERED found there always wins, because that is the
//      case the release hides (Park Aerospace cut its GE-program outlook on the
//      call; the 8-K said nothing);
//   2. the release's own guided figures, compared with the previous release's
//      ranges line by line (`ownGuideVerdict`) — the same verdict as the chip;
//   3. what the outside check found when the release said nothing (raised /
//      kept / no guidance).
// `lowered` is the one decision the grader uses: a top-tier row with it set is
// MIXED. A revision that raised some main lines and CUT another (revenue, EPS,
// operating income, net income, free cash flow, EBITDA) counts as lowered —
// the owner's rule is "reduced any guidance". A margin-only trim does not.
//
// Pure: no fetch, no React. Used by the server overlay and by the card.
// ═══════════════════════════════════════════════════════════════════════════

import { ownGuideMove, ownGuideVerdict, type GuideFigLike, type GuideChangeLike } from './us-guide-verdict';
import { fmtGuideRange, GUIDE_METRIC_LABEL, type GuideMetric } from './us-guidance-figures';
import { guideLoweredInText, guideRaisedInText, guideKeptInText, focusQuote } from './us-guide-text';

/** The clearest sentence of the release's guidance quotes for one direction — not the headline block in front of it. */
function snippetFor(snips: string[], kind: 'raised' | 'lowered' | 'maintained' | 'any'): string {
  // one quote at a time: a headline block with no full stop would otherwise run into the next quote
  // a plain sentence beats the headline block ("Press Release FOR IMMEDIATE RELEASE Penguin Solutions Announces …")
  const headline = (q: string) => /FOR IMMEDIATE RELEASE|Press Release|\bAnnounces\b|\bReports\b[^.]{0,80}\bResults\b/.test(q) || (q.replace(/[^A-Z]/g, '').length / Math.max(1, q.replace(/[^A-Za-z]/g, '').length)) > 0.35;
  let fallback = '';
  for (const sn of snips) {
    const hit = kind === 'raised' ? guideRaisedInText(sn) : kind === 'lowered' ? guideLoweredInText(sn) : kind === 'maintained' ? guideKeptInText(sn) : null;
    if (!hit) continue;
    if (!headline(hit.quote)) return hit.quote;
    fallback ||= hit.quote;
  }
  if (fallback) return fallback;
  if (kind !== 'any') return '';
  for (const sn of snips) {
    const m = /\b(?:outlook|guidance|expects?|forecast)\b/i.exec(sn);
    if (m) return focusQuote(sn, m.index, m[0].length, 160);
  }
  return '';
}

export type GuideDirection = 'raised' | 'lowered' | 'mixed' | 'cautious' | 'maintained' | 'withdrawn' | 'none' | 'not-lowered' | 'unknown';

export interface GuideCheckLike {
  lowered?: boolean;
  direction?: string | null;
  scope?: string | null;
  what?: string | null;
  quote?: string | null;
  source?: 'filing' | 'call-coverage' | 'ai-web' | string | null;
  url?: string | null;
}

export interface GuideLine {
  direction: GuideDirection;
  /** the line itself, ≤ ~170 characters */
  text: string;
  /** a longer explanation for the tooltip */
  title: string;
  /** where the verdict came from, in plain words */
  source: string;
  url: string | null;
  /** true = a BLOCKBUSTER / STRONG row must be MIXED */
  lowered: boolean;
}

const MAIN: GuideMetric[] = ['revenue', 'product_revenue', 'subscription_revenue', 'eps', 'operating_income', 'net_income', 'free_cash_flow', 'ebitda', 'comparable_sales'];
const SOURCE_WORD: Record<string, string> = { filing: 'the filing', 'call-coverage': 'earnings-call write-up', 'ai-web': 'AI web check' };
const clip = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

type Fig = GuideFigLike & { low?: number | null; high?: number | null; unit?: 'usd' | 'usd_share' | 'pct' };

function moves(figs: Fig[], changes: GuideChangeLike[]): { up: string[]; down: string[]; mainDown: boolean } {
  const up: string[] = [], down: string[] = [];
  let mainDown = false;
  for (const f of figs) {
    const m = ownGuideMove(f, changes);
    if (!m || (m.dir !== 'raised' && m.dir !== 'lowered')) continue;
    const name = `${f.period_label ? `${f.period_label} ` : ''}${f.basis === 'adjusted' ? 'adj. ' : ''}${(GUIDE_METRIC_LABEL as any)[f.metric] || f.metric}`;
    const unit = f.unit || 'usd';
    const now = f.low != null && f.high != null ? fmtGuideRange({ low: f.low, high: f.high, unit }) : '';
    const was = m.lo != null ? fmtGuideRange({ low: m.lo, high: m.hi ?? m.lo, unit }) : '';
    const s = `${name}${now ? ` ${now}` : ''}${was ? ` (was ${was})` : ''}`;
    if (m.dir === 'raised') up.push(s); else { down.push(s); if (MAIN.includes(f.metric as GuideMetric)) mainDown = true; }
  }
  // a change row with no figure left to hang it on still says which way it went
  if (!up.length && !down.length) {
    for (const c of changes) {
      if (!c || (c.direction !== 'raised' && c.direction !== 'lowered')) continue;
      const s = `${c.period_label ? `${c.period_label} ` : ''}${(GUIDE_METRIC_LABEL as any)[c.metric] || c.metric}`;
      if (c.direction === 'raised') up.push(s); else { down.push(s); if (MAIN.includes(c.metric as GuideMetric)) mainDown = true; }
    }
  }
  return { up, down, mainDown };
}

/** The one-line guidance verdict for a graded US row. */
export function guideLine(r: any): GuideLine {
  const figs: Fig[] = Array.isArray(r?.guidance_figures) ? r.guidance_figures.filter(Boolean) : [];
  const changes: GuideChangeLike[] = Array.isArray(r?.guide_change) ? r.guide_change.filter(Boolean) : [];
  const label = String(r?.guidance || '').toUpperCase();
  const gc: GuideCheckLike | null = r?.guide_check && typeof r.guide_check === 'object' ? r.guide_check : null;
  let gcDir = gc ? String(gc.direction || (gc.lowered ? 'lowered' : '')) : '';
  // a stored free-source "raised" is re-read with today's rules (records made before a detector fix stay honest)
  if (gc && gcDir === 'raised' && gc.source !== 'ai-web' && !guideRaisedInText(String(gc.quote || gc.what || ''))) gcDir = '';
  const gcSrc = gc?.source ? (SOURCE_WORD[String(gc.source)] || String(gc.source)) : '';
  const gcUrl = gc?.url || null;
  const releaseUrl = r?.guidance_url || r?.release_url || null;
  const mv = moves(figs, changes);
  const gv = ownGuideVerdict(figs, changes, label || null);
  const snips: string[] = Array.isArray(r?.guidance_snippets) ? r.guidance_snippets.filter((x: any) => typeof x === 'string') : [];
  const firstSnippet = snippetFor(snips, 'any');

  // 1. a cut found outside the release (or inside its other exhibits) — always wins
  if (gc && (gcDir === 'lowered' || gcDir === 'withdrawn' || gc.lowered)) {
    const what = clip(gc.what || gc.quote || 'management lowered its outlook', 140).replace(/^call coverage:\s*/i, '');
    const alsoUp = gv?.verdict === 'RAISED' && mv.up.length ? ` · release raised ${clip(mv.up[0], 60)}` : '';
    return {
      direction: gcDir === 'withdrawn' ? 'withdrawn' : 'lowered',
      text: `Guidance ${gcDir === 'withdrawn' ? 'withdrawn' : 'lowered'}${gc.scope === 'segment' ? ' (segment / programme)' : ''} — ${what}${alsoUp}`,
      title: `${gc.quote ? `“${clip(gc.quote, 400)}”\n\n` : ''}Source: ${gcSrc || 'outside check'}${gcUrl ? ` — ${gcUrl}` : ''}`,
      source: gcSrc || 'outside check', url: gcUrl, lowered: true,
    };
  }
  // 1b. outside check: one line better, a profit line guided down (CarMax) — or a profit line guided below last year
  if (gc && (gcDir === 'mixed' || gcDir === 'cautious')) {
    const what = clip(gc.what || gc.quote || '', 150);
    return {
      direction: gcDir as GuideDirection,
      text: gcDir === 'mixed' ? `Guidance mixed — ${what}` : `Guidance cautious — ${what}`,
      title: `${gc.quote ? `“${clip(gc.quote, 400)}”\n\n` : ''}A profit line is guided below last year${gcDir === 'mixed' ? ' while another line improved' : ''}, so a BLOCKBUSTER or STRONG quarter is shown as MIXED.\nSource: ${gcSrc}${gcUrl ? ` — ${gcUrl}` : ''}`,
      source: gcSrc, url: gcUrl, lowered: true,
    };
  }
  // 2. the release's own figures against the previous release
  if (label === 'WITHDRAWN') {
    const said = snippetFor(snips, 'lowered') || firstSnippet;
    return { direction: 'withdrawn', text: `Guidance withdrawn${said ? ` — ${clip(said, 130)}` : ''}`, title: said, source: 'the release', url: releaseUrl, lowered: true };
  }
  if (gv?.verdict === 'MIXED') {
    const t = `Guidance mixed — raised ${clip(mv.up.join('; '), 70)}; cut ${clip(mv.down.join('; '), 70)}`;
    return {
      direction: 'mixed', text: t,
      title: `Line by line against the company's previous outlook.\nRaised: ${mv.up.join('; ')}\nCut: ${mv.down.join('; ')}${mv.mainDown ? '\n\nA main line (revenue, EPS, operating income, cash flow) was cut, so a BLOCKBUSTER or STRONG quarter is shown as MIXED.' : '\n\nOnly a margin line was cut — the tier is not changed for that.'}`,
      source: 'the release', url: releaseUrl, lowered: mv.mainDown,
    };
  }
  if (gv?.verdict === 'LOWERED') {
    const said = snippetFor(snips, 'lowered');
    const what = mv.down.length ? clip(mv.down.join('; '), 140) : clip(said || firstSnippet, 140);
    return { direction: 'lowered', text: `Guidance lowered${what ? ` — ${what}` : ''}`, title: said || firstSnippet || mv.down.join('\n'), source: 'the release', url: releaseUrl, lowered: true };
  }
  if (gv?.verdict === 'RAISED') {
    const said = snippetFor(snips, 'raised');
    // the release's wording alone (no ranges to compare) must actually say it raised — "revenue exceeded guidance" is not a raise
    if (!gv.computed && !said && !(gc && gcDir === 'raised')) {
      return { direction: 'unknown', text: 'Guidance direction unclear — the release is read as raised, but no sentence says so', title: firstSnippet, source: 'the release', url: releaseUrl, lowered: false };
    }
    const what = mv.up.length ? clip(mv.up.join('; '), 140) : clip(said || (gc?.what ?? ''), 140);
    return { direction: 'raised', text: `Guidance raised${what ? ` — ${what}` : ''}`, title: said || mv.up.join('\n'), source: 'the release', url: releaseUrl, lowered: false };
  }
  // 3. the release said nothing that settles it — what the outside check found
  if (gc && gcDir === 'raised') {
    return { direction: 'raised', text: `Guidance raised — ${clip(gc.what || gc.quote || '', 140)}`, title: `${gc.quote ? `“${clip(gc.quote, 400)}”\n\n` : ''}Source: ${gcSrc}${gcUrl ? ` — ${gcUrl}` : ''}`, source: gcSrc, url: gcUrl, lowered: false };
  }
  if (gv?.verdict === 'REITERATED') {
    const saysRaise = snippetFor(snips, 'raised');
    if (gv.computed && saysRaise) {
      return { direction: 'maintained', text: 'Guidance kept — ranges about the same as last time (the release calls it a raise)', title: `${saysRaise}\n\nLine by line, the new ranges are within rounding of the previous release's.`, source: 'the release', url: releaseUrl, lowered: false };
    }
    const said = snippetFor(snips, 'maintained');
    return { direction: 'maintained', text: `Guidance kept — ${said ? clip(said, 130) : 'same ranges as last time'}`, title: said || firstSnippet, source: 'the release', url: releaseUrl, lowered: false };
  }
  if (gc && gcDir === 'maintained') {
    return { direction: 'maintained', text: `Guidance kept — ${clip(gc.what || gc.quote || 'outlook reaffirmed', 140)}`, title: `${gc.quote ? `“${clip(gc.quote, 400)}”\n\n` : ''}Source: ${gcSrc}`, source: gcSrc, url: gcUrl, lowered: false };
  }
  if (figs.length && label === 'PROVIDED') {
    const f = figs[0];
    const s = `${f.period_label ? `${f.period_label} ` : ''}${(GUIDE_METRIC_LABEL as any)[f.metric] || f.metric}${f.low != null && f.high != null ? ` ${fmtGuideRange({ low: f.low, high: f.high, unit: f.unit || 'usd' })}` : ''}`;
    return { direction: 'none', text: `Guidance given, no earlier range to compare — ${clip(s, 120)}`, title: 'The release states an outlook, but there is no earlier stated range for the same period, so it is neither raised nor lowered.', source: 'the release', url: releaseUrl, lowered: false };
  }
  if (gc && gcDir === 'not-lowered') {
    return { direction: 'not-lowered', text: 'No lowered guidance found (release, call write-ups and web checked)', title: `Source: ${gcSrc}${gcUrl ? ` — ${gcUrl}` : ''}`, source: gcSrc, url: gcUrl, lowered: false };
  }
  if (gc && gcDir === 'none') {
    return { direction: 'none', text: 'No forward guidance given', title: `Checked: ${gcSrc}${gc.what ? ` — ${gc.what}` : ''}`, source: gcSrc, url: gcUrl, lowered: false };
  }
  if (r?.guidance_absent_reason === 'none-given') {
    return { direction: 'none', text: 'No forward guidance in the release', title: 'The release gives no outlook. The call has not been checked yet.', source: 'the release', url: releaseUrl, lowered: false };
  }
  return { direction: 'unknown', text: 'Guidance direction not checked yet', title: 'The release did not settle it. The call write-ups (free) and, within a small daily allowance, an AI web check run every two hours in market days.', source: '', url: null, lowered: false };
}

export const GUIDE_LINE_GLYPH: Record<GuideDirection, string> = {
  raised: '📈', lowered: '📉', mixed: '↕', cautious: '⚠', maintained: '➖', withdrawn: '⛔', none: '◌', 'not-lowered': '✓', unknown: '…',
};
