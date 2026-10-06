// zzz857 — shared contract for guidance RECALL work (India + US).
//
// Pipeline:
//   1. Collectors (GitHub Actions for India BSE/NSE; EDGAR backfill for US)
//      find the company's OWN documents that usually carry guidance
//      (earnings-call transcript, investor presentation, results press
//      release / 8-K exhibit 99.1, AGM speech) and store them as GuidanceDoc.
//   2. The AI extractor reads each GuidanceDoc's text and returns
//      ExtractedGuidance rows. Every row must carry a quote that is found
//      verbatim (whitespace-normalised) in the document text, and every
//      number in the row must appear in that quote; otherwise the row is
//      dropped. The document is the company's own, so a passing row is
//      PRIMARY-VERIFIED by construction.
//   3. The guidance universe and the events pipeline consume the rows.
//
// KV keys (all JSON):
//   guidance-docs:v1:index            -> GuidanceDocIndex (newest first, capped)
//   guidance-docs:v1:doc:<docId>      -> GuidanceDoc (text capped, TTL 120 days)
//   guidance-extract:v1:<docId>       -> GuidanceExtractResult
//   guidance-extract:v1:index         -> string[] docIds with a result (newest first)

export type GuidanceDocKind =
  | 'TRANSCRIPT'          // earnings / analyst call transcript
  | 'PRESENTATION'        // investor / earnings presentation
  | 'RESULTS_RELEASE'     // results press release, SEC 8-K exhibit 99.1
  | 'AGM_SPEECH'          // chairman / AGM speech, annual-report letter
  | 'OTHER_COMPANY_DOC';  // other company-authored disclosure

export interface GuidanceDoc {
  docId: string;                 // stable: sha1(url) hex, first 20 chars
  market: 'IN' | 'US';
  ticker: string | null;         // NSE symbol / US ticker when known
  bseCode?: string | null;
  cik?: string | null;
  company: string;
  kind: GuidanceDocKind;
  title: string;                 // filing subject / document title
  url: string;                   // the company's own document (exchange attachment, sec.gov, company IR)
  sourceHost: string;            // e.g. bseindia.com, nseindia.com, sec.gov, mangroup.com
  filedAt: string;               // ISO date the exchange/SEC received it (or published)
  periodHint?: string | null;    // e.g. 'Q1 FY27' from the title, if stated
  textChars: number;
  text?: string;                 // plain text, capped (e.g. 120k chars); omitted in the index
  collectedAt: string;
  collector: string;             // which job collected it
  // zzz857 (collector, additive): when `url` is on the company's own domain
  // (e.g. mangroup.com) because the exchange filing only linked to it, this is
  // the exchange filing / SEC page that pointed there. Required for a
  // non-exchange host to pass the ingest host check.
  exchangeUrl?: string | null;
  // zzz857 wave 2 (store, additive): `text` holds only the guidance-relevant
  // passages (verbatim excerpts joined by "\n[…]\n", ≤ 30k chars — see
  // selectGuidancePassages in guidance-docs-store); this is the length of the
  // document text before selection. textChars is the stored (selected) length.
  originalChars?: number;
}

export interface GuidanceDocIndexRow {
  docId: string; market: 'IN' | 'US'; ticker: string | null; company: string;
  kind: GuidanceDocKind; filedAt: string; url: string; textChars: number;
  extracted?: boolean;           // set once an extract result exists
  textBytes?: number;            // zzz857 wave 2: compressed bytes held in KV (0 once the text was dropped after a final extract)
}
export interface GuidanceDocIndex { updatedAt: string; rows: GuidanceDocIndexRow[] }

export type GuidanceBasisX = 'GAAP' | 'ADJUSTED' | 'REPORTED' | 'UNSTATED';
export type GuidanceMetricX =
  | 'REVENUE' | 'REVENUE_GROWTH' | 'EBITDA' | 'EBITDA_MARGIN' | 'PAT' | 'EPS'
  | 'ADJ_EPS' | 'FCF' | 'ORDER_INFLOW' | 'VOLUME' | 'OTHER';

export interface ExtractedGuidance {
  metric: GuidanceMetricX;
  metricLabel: string;           // as the company words it
  period: string;                // normalised: 'FY27', 'Q3 FY27', 'CY2026', 'FY27-FY29'
  periodKind: 'ANNUAL' | 'QUARTER' | 'MULTI_YEAR';
  basis: GuidanceBasisX;
  currency: string | null;       // 'INR', 'USD' ...
  unit: string | null;           // 'crore', 'million', 'billion', '%', 'per_share'
  low: number | null;
  high: number | null;
  growthPctLow?: number | null;  // only when the company states a growth %
  growthPctHigh?: number | null;
  status: 'NEW' | 'RAISED' | 'REITERATED' | 'LOWERED' | 'NARROWED' | 'WITHDRAWN' | 'UNCLEAR';
  prior?: { low: number | null; high: number | null; statedIn: string | null } | null; // only if the doc states it
  // zzz857 (universe consumer, additive, optional): the PRIOR fiscal year's ACTUAL for the same metric, ONLY when the
  // document itself states it (e.g. 'FY26 revenue of ₹3,592 crore'); same currency/unit convention as low/high; the
  // number must appear in `quote`. The universe derives growth vs this base ('(derived)'); absent = not established.
  priorActual?: { period: string; value: number; quote: string } | null;
  quote: string;                 // verbatim from the document, <= 300 chars
  speaker?: string | null;       // for transcripts: who said it
  confidence: number;            // model's 0..1 (internal only, never shown as a score)
}

export interface GuidanceExtractResult {
  docId: string;
  market: 'IN' | 'US';
  ticker: string | null;
  company: string;
  docUrl: string;
  docKind: GuidanceDocKind;
  filedAt: string;
  extractedAt: string;
  model: string | null;
  /** zzz883: fingerprint of the system prompt + answer schema used (changes automatically when either is edited). Absent on older records. */
  promptVersion?: string;
  status: 'ok' | 'no_guidance' | 'unreadable' | 'unavailable' | 'error';
  rows: ExtractedGuidance[];     // only rows that passed quote + number checks
  dropped: number;               // rows the checks removed
  /** zzz920: the first few dropped rows (reason + quote ≤ 220 chars) — diagnostics only */
  dropSamples?: Array<{ reason: string; quote: string }>;
  note?: string;
}
