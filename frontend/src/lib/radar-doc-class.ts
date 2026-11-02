// ═══════════════════════════════════════════════════════════════════════════
// zzz1212 — Transformation Radar: what KIND of document is this filing?
//
// Why. The radar labelled a "Schedule of meet" intimation, a "Link of Recording"
// letter and a one-page "Transcript is on our website" cover letter all as
// "transcript · no pattern", counted them as analysed, and spent the scan budget
// on them, while 5–11 MB investor presentations were never read (5 MB limit) and
// were shown as "announcement · no transcript yet".
//
// Two steps, both pure:
//   1. preClassifyRadarFiling — from the exchange subject + attachment file name,
//      BEFORE any download. Routine notices (meeting schedules, call invites,
//      recording links, AGM / record-date / trading-window notices) are never read.
//   2. classifyRadarContent — from the extracted PDF text. Decides whether the
//      attachment really is a transcript / presentation / results document, or
//      only a covering letter (with a link), or unreadable. Only the readable
//      substantive classes count as "analysed".
// ═══════════════════════════════════════════════════════════════════════════

import { classifyConcallFiling } from './concall-feed';

export type RadarDocClass =
  | 'MEETING_SCHEDULE'          // intimation / schedule of an analyst or investor meet
  | 'CALL_INVITE'               // invitation, dial-in, updated link for an upcoming call
  | 'RECORDING_LINK'            // audio / video recording link letter
  | 'ADMIN_NOTICE'              // AGM, record date, trading window, board meeting …
  | 'OUT_OF_SCOPE'              // other announcement (order, rating, allotment …) — not a concall document
  | 'TRANSCRIPT'                // substantive call transcript
  | 'PRESENTATION'              // investor / earnings presentation with business figures
  | 'PRESENTATION_NO_FIGURES'   // presentation text with few figures (still read, lower confidence)
  | 'RESULTS'                   // financial results / earnings press release
  | 'TRANSCRIPT_LINK_ONLY'      // covering letter saying the transcript is on the company website
  | 'COVER_LETTER_ONLY'         // covering letter, the document itself is not attached
  | 'UNREADABLE'                // download failed, too large, scanned image, garbled text
  | 'NO_ATTACHMENT';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RadarDocVerdict {
  cls: RadarDocClass;
  /** short label for the page */
  label: string;
  /** one plain sentence: why this class */
  reason: string;
  confidence: Confidence;
  /** true only for documents whose full text was read and is worth scoring */
  analyzable: boolean;
  /** decided from the subject only (no download) or from the document text */
  basis: 'SUBJECT' | 'CONTENT';
  /** a web link found in a covering letter (where the transcript / recording lives) */
  link?: string;
}

export const ANALYZABLE: ReadonlySet<RadarDocClass> = new Set(['TRANSCRIPT', 'PRESENTATION', 'PRESENTATION_NO_FIGURES', 'RESULTS']);

export const CLASS_LABEL: Record<RadarDocClass, string> = {
  MEETING_SCHEDULE: 'Meeting schedule',
  CALL_INVITE: 'Call invitation',
  RECORDING_LINK: 'Recording link',
  ADMIN_NOTICE: 'Routine notice',
  OUT_OF_SCOPE: 'Other announcement',
  TRANSCRIPT: 'Transcript',
  PRESENTATION: 'Investor presentation',
  PRESENTATION_NO_FIGURES: 'Presentation (few figures)',
  RESULTS: 'Results document',
  TRANSCRIPT_LINK_ONLY: 'Transcript link only',
  COVER_LETTER_ONLY: 'Covering letter only',
  UNREADABLE: 'Unreadable PDF',
  NO_ATTACHMENT: 'No attachment',
};

const ADMIN_RE = /management change|change in (?:management|director|kmp)|record date|book closure|board meeting|annual general meeting|\bAGM\b|postal ballot|voting result|scrutini[sz]er|newspaper (?:publication|advertisement|clipping)|loss of (?:share|certificate)|duplicate (?:share|certificate)|sub[- ]division|stock split|dividend distribution|trading window|compliance certificate|reg\.?\s?74|reconciliation of share/i;
const INVITE_RE = /\binvit(?:e|ation)\b|\bdial[- ]?in\b|\bupdated link\b|\blink for (?:the )?(?:post[- ]results? )?(?:conference|earnings|con\.?)?\s*call\b|\bwebinar link\b|\bjoining link\b|\bregistration link\b/i;
const SCHEDULE_RE = /\bschedule(?:d)? of\b|\bschedule of (?:analyst|investor|meet)|\bintimation\b|\binvestors? meet\b|\banalyst(?:s)? meet\b|\bto be held\b|\bwill be held\b|\bupcoming\b|\bscheduled\b/i;
const RESULTS_RE = /\b(?:financial|quarterly|half[- ]yearly|un-?audited|audited)\s+results?\b|\bpress release\b|\bearnings (?:release|update)\b|\boutcome of (?:the )?board meeting\b.*\bresults?\b/i;
// What the attached FILE NAME says. Exchanges keep the company's own name for the file, which is often more honest than the subject.
const FILE_TRANSCRIPT_RE = /transcript/i;
const FILE_PRESENTATION_RE = /presentation|\bppt\b|_ppt|ppt_|invppt|investorppt|investor_?deck|earnings_?deck/i;
const FILE_RECORDING_RE = /audio|recording|recordings/i;

function fileNameOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return String(url).split('/').pop() || ''; }
}

const verdict = (cls: RadarDocClass, reason: string, confidence: Confidence, basis: 'SUBJECT' | 'CONTENT', link?: string): RadarDocVerdict => ({
  cls, label: CLASS_LABEL[cls], reason, confidence, analyzable: ANALYZABLE.has(cls), basis, ...(link ? { link } : {}),
});

/**
 * Step 1 — before any download. Returns the expected class. Routine classes
 * (schedule / invite / recording / admin / out of scope) are not read at all.
 */
export function preClassifyRadarFiling(f: { subject?: string | null; detail?: string | null; attachment_urls?: string[] | null }): RadarDocVerdict {
  const subject = String(f.subject || '');
  const url = Array.isArray(f.attachment_urls) ? f.attachment_urls.find(Boolean) || '' : '';
  if (!url) return verdict('NO_ATTACHMENT', 'The exchange filing has no attached document.', 'HIGH', 'SUBJECT');
  const file = fileNameOf(url);
  const c = classifyConcallFiling(subject, f.detail);
  const fileSaysTranscript = FILE_TRANSCRIPT_RE.test(file);
  const fileSaysPresentation = FILE_PRESENTATION_RE.test(file);
  if (c.kind === 'AGM_TRANSCRIPT') return verdict('ADMIN_NOTICE', 'Shareholder-meeting (AGM / EGM) transcript, not an earnings or investor call.', 'MEDIUM', 'SUBJECT');
  if (c.is_transcript || fileSaysTranscript) return verdict('TRANSCRIPT', 'Subject or file name says transcript; the text decides whether the transcript itself is attached.', 'MEDIUM', 'SUBJECT');
  if (c.kind === 'INVESTOR_PRESENTATION' || fileSaysPresentation) return verdict('PRESENTATION', 'Subject or file name says investor presentation; the text decides whether it holds figures.', 'MEDIUM', 'SUBJECT');
  if (c.kind === 'AUDIO_RECORDING' || (FILE_RECORDING_RE.test(file) && /\b(?:con\.?\s*call|conference|earnings|analyst|investor)/i.test(subject))) {
    return verdict('RECORDING_LINK', 'Audio / video recording link — a recording has no text to read; the transcript arrives as a separate filing.', 'HIGH', 'SUBJECT');
  }
  if (ADMIN_RE.test(subject)) return verdict('ADMIN_NOTICE', 'Routine corporate notice (meeting, record date, trading window or similar).', 'HIGH', 'SUBJECT');
  if (c.kind === 'CALL_INTIMATION' || (/\bcon(?:ference)?\.?\s*call|\banalyst|\binvestor/i.test(subject) && (SCHEDULE_RE.test(subject) || INVITE_RE.test(subject)))) {
    if (INVITE_RE.test(subject)) return verdict('CALL_INVITE', 'Invitation or joining link for an upcoming call.', 'HIGH', 'SUBJECT');
    return verdict('MEETING_SCHEDULE', 'Notice of a scheduled analyst / investor meeting; nothing has been said yet.', 'HIGH', 'SUBJECT');
  }
  if (RESULTS_RE.test(subject)) return verdict('RESULTS', 'Subject says results or press release.', 'MEDIUM', 'SUBJECT');
  return verdict('OUT_OF_SCOPE', 'Not a concall, presentation or results document.', 'MEDIUM', 'SUBJECT');
}

/** True when step 1 says the document is worth downloading. */
export function shouldReadRadarDoc(pre: RadarDocVerdict): boolean {
  return pre.cls === 'TRANSCRIPT' || pre.cls === 'PRESENTATION' || pre.cls === 'RESULTS';
}

// ── content signals ─────────────────────────────────────────────────────────
const COVER_RE = /\bregulation\s*30\b|listing obligations|take (?:the same|this|the above|the aforesaid)[^.]{0,30}on record|kindly take|scrip code|exchange plaza|phiroze|listing (?:department|compliance)|dear sir/i;
const TRANSCRIPT_MARKERS: RegExp[] = [
  /\bmoderator\s*:/i, /\bladies and gentlemen\b/i, /question[- ]and[- ]answer session|q\s*&\s*a session/i,
  /\bnext question\b/i, /\bthank you(?:,)? (?:sir|ma'?am|very much)\b/i, /\bover to you\b/i, /\bopening remarks\b/i,
];
const FIGURE_RE = /(?:₹|rs\.?|inr|usd|\$)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|cr\b|crores?\b|mn\b|million\b|bn\b|billion\b|lakhs?\b|bps\b|mw\b|mtpa\b|tonnes?\b)|\by-?o-?y\b|\bq-?o-?q\b|\bq[1-4]\s?fy\s?'?\d{2}\b|\bh[12]\s?fy\s?'?\d{2}\b|\bebitda\b|\bpat\b/gi;
const RESULTS_CONTENT_RE = /statement of (?:standalone |consolidated )?(?:un-?audited|audited)?\s*(?:standalone |consolidated )?financial results|segment(?:-| )wise revenue, results/i;
const URL_RE = /https?:\/\/[^\s"'<>)]+/i;

function transcriptMarkerCount(t: string): number { return TRANSCRIPT_MARKERS.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0); }
function figureCount(t: string): number { return (t.match(FIGURE_RE) || []).length; }
function letterShare(t: string): number {
  const s = t.replace(/\s+/g, '');
  if (!s.length) return 0;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters / s.length;
}

/** What a covering letter says it is about (independent of the exchange subject). */
function coverLetterTopic(raw: string): 'TRANSCRIPT' | 'RECORDING' | 'SCHEDULE' | 'PRESENTATION' | 'OTHER' {
  const t = raw.replace(/https?:\/\/\S+/gi, ' ');   // a link's path ("…?tab=Conference+Call+Transcript") says nothing about this letter
  if (/\btranscript\b/i.test(t) && /\b(?:uploaded|available|hosted|placed|published|accessed)\b/i.test(t) && !/transcript[^.]{0,80}\b(?:will|shall) be\b/i.test(t)) return 'TRANSCRIPT';
  if (/\b(?:audio|video)\s*(?:\/\s*video\s*)?recording\b|\brecording of\b/i.test(t)) return 'RECORDING';
  if (/\bscheduled to be held\b|\bwill be held\b|\bis scheduled\b|\bintimation of\b[^.]{0,60}\b(?:call|meet)|\bschedule of\b/i.test(t)) return 'SCHEDULE';
  if (/\bpresentation\b/i.test(t)) return 'PRESENTATION';
  return 'OTHER';
}

export interface ContentInput {
  text?: string | null;
  pages?: number | null;
  bytes?: number | null;
  /** extractor failure reason when no text came back */
  failure?: string | null;
}

/**
 * Step 2 — from the extracted text. `pre` is step 1's verdict for the same filing.
 */
export function classifyRadarContent(pre: RadarDocVerdict, inp: ContentInput): RadarDocVerdict {
  const text = String(inp.text || '').replace(/\s+/g, ' ').trim();
  const pages = Number(inp.pages || 0);
  const failure = String(inp.failure || '');
  if (!text || text.length < 200) {
    if (/too large/i.test(failure)) return verdict('UNREADABLE', `${failure} — above the reading limit; open the original.`, 'HIGH', 'CONTENT');
    if (/HTTP \d|abort|timeout|fetch|network/i.test(failure)) return verdict('UNREADABLE', `Exchange PDF could not be downloaded (${failure.slice(0, 80)}); retried on a later scan.`, 'HIGH', 'CONTENT');
    if (pages >= 3) return verdict('UNREADABLE', `Scanned image PDF (${pages} pages, no text layer); it needs OCR.`, 'MEDIUM', 'CONTENT');
    return verdict('UNREADABLE', failure ? `PDF text could not be extracted (${failure.slice(0, 80)}).` : 'PDF has no readable text.', 'MEDIUM', 'CONTENT');
  }
  if (letterShare(text) < 0.45) return verdict('UNREADABLE', 'Extracted text is garbled (mostly symbols); open the original.', 'MEDIUM', 'CONTENT');
  if (pages >= 6 && text.length / pages < 120) return verdict('UNREADABLE', `Mostly images: ${pages} pages but only ${text.length} characters of text.`, 'MEDIUM', 'CONTENT');

  const markers = transcriptMarkerCount(text);
  const figures = figureCount(text);
  const looksCover = COVER_RE.test(text.slice(0, 1500)) && text.length < 5000 && markers < 2;
  const link = (text.match(URL_RE) || [])[0]?.replace(/[.,;]+$/, '');

  if (looksCover) {
    const topic = coverLetterTopic(text);
    if (topic === 'TRANSCRIPT') return verdict('TRANSCRIPT_LINK_ONLY', 'Covering letter only: it says the transcript is on the company website; the transcript text is not attached.', 'HIGH', 'CONTENT', link);
    if (topic === 'RECORDING') return verdict('RECORDING_LINK', 'Covering letter for an audio recording; there is no transcript text in this filing.', 'HIGH', 'CONTENT', link);
    if (topic === 'SCHEDULE') return verdict('MEETING_SCHEDULE', 'Covering letter announcing a call or meeting date; nothing has been said yet.', 'HIGH', 'CONTENT', link);
    const what = pre.cls === 'PRESENTATION' ? 'presentation' : pre.cls === 'TRANSCRIPT' ? 'transcript' : 'document';
    return verdict('COVER_LETTER_ONLY', `Covering letter only (${text.length} characters); the ${what} itself is not in this PDF.`, 'MEDIUM', 'CONTENT', link);
  }
  if (markers >= 2 && text.length >= 6000) return verdict('TRANSCRIPT', `Call transcript text (${markers} transcript markers, ${Math.round(text.length / 1000)}k characters).`, 'HIGH', 'CONTENT');
  if (RESULTS_CONTENT_RE.test(text)) return verdict('RESULTS', 'Financial results statement.', 'HIGH', 'CONTENT');
  if (pre.cls === 'TRANSCRIPT') {
    if (text.length >= 6000) return verdict('TRANSCRIPT', 'Long document filed as a transcript, but the usual call markers (moderator, Q&A) were not found.', 'MEDIUM', 'CONTENT');
    return verdict('COVER_LETTER_ONLY', `Filed as a transcript but only ${text.length} characters of text; the transcript itself is not attached.`, 'MEDIUM', 'CONTENT', link);
  }
  if (figures >= 20 && text.length >= 3000) return verdict('PRESENTATION', `Presentation with business figures (${figures} figures found).`, 'HIGH', 'CONTENT');
  if (text.length >= 3000) return verdict('PRESENTATION_NO_FIGURES', `Readable presentation / document with few figures (${figures}); conclusions from it are weaker.`, 'LOW', 'CONTENT');
  return verdict('COVER_LETTER_ONLY', `Short document (${text.length} characters) without transcript or figures.`, 'MEDIUM', 'CONTENT', link);
}

/** Classes whose failure is temporary (download failed) — not remembered, retried next scan. */
export function isRetryableFailure(v: RadarDocVerdict): boolean {
  return v.cls === 'UNREADABLE' && /could not be downloaded/.test(v.reason);
}

// ── funnel: honest counters for the page ───────────────────────────────────
export interface RadarFunnel {
  /** all exchange announcements in the window (NSE + BSE), from the feed status */
  announcements_total: number | null;
  /** rows the concall feed passed to the radar (already de-duplicated across NSE / BSE) */
  feed_rows: number;
  /** routine notices that are never read */
  routine: { meeting_schedule: number; call_invite: number; recording_link: number; admin_notice: number; no_attachment: number };
  /** other announcements (orders, ratings, allotments …) — not concall documents */
  out_of_scope: number;
  /** transcripts + presentations + results by subject — what the radar wants to read */
  eligible: number;
  /** eligible documents whose text has been looked at (now or on an earlier scan) */
  examined: number;
  /** of those: substantive documents fully read and scored (the only "analysed" number) */
  read_full: number;
  /** of those: covering letters / transcript links (no document text) */
  cover_only: number;
  /** of those: unreadable (too large, download failed, scanned, garbled) */
  unreadable: number;
  /** eligible documents not looked at yet (read in the background, newest first) */
  not_yet_read: number;
  /** read in full and with at least one transformation pattern */
  with_signal: number;
  /** read this scan from the exchange (not from the stored result) */
  fresh_reads: number;
}

export function emptyFunnel(): RadarFunnel {
  return {
    announcements_total: null, feed_rows: 0,
    routine: { meeting_schedule: 0, call_invite: 0, recording_link: 0, admin_notice: 0, no_attachment: 0 },
    out_of_scope: 0, eligible: 0, examined: 0, read_full: 0, cover_only: 0, unreadable: 0, not_yet_read: 0, with_signal: 0, fresh_reads: 0,
  };
}

/** Coverage in plain words, never more than the documents actually read. */
export function coverageSentence(f: RadarFunnel): string {
  if (f.eligible === 0) return 'No transcripts, presentations or results documents in this window yet.';
  const pct = Math.round((100 * f.examined) / f.eligible);
  const parts = [`${f.examined} of ${f.eligible} transcripts / presentations / results documents examined (${pct}%)`, `${f.read_full} read in full`];
  if (f.cover_only) parts.push(`${f.cover_only} were only a covering letter or link`);
  if (f.unreadable) parts.push(`${f.unreadable} unreadable`);
  const tail = f.not_yet_read > 0 ? ` ${f.not_yet_read} not read yet — reading continues in the background, newest first; unread companies are unchecked, not negative.` : ' Every eligible document in this window has been examined.';
  return `${parts.join(' · ')}.${tail}`;
}
