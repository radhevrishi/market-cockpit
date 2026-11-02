// zzz1212 — Transformation Radar document classification + honest counters.
// Cases are the real NSE filings of 2 Nov 2026 that the radar labelled "transcript · no pattern" or
// "announcement · no transcript yet" (texts shortened from the actual PDFs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  preClassifyRadarFiling, classifyRadarContent, shouldReadRadarDoc, coverageSentence, emptyFunnel, isRetryableFailure,
} from '../radar-doc-class';
import { periodInQuote } from '../concall-evidence-ledger';

const NSE = 'https://nsearchives.nseindia.com/corporate/';
const CC = 'Analysts/Institutional Investor Meet/Con. Call Updates — ';
const pre = (subject: string, file: string) => preClassifyRadarFiling({ subject, attachment_urls: [NSE + file] });
const COVER_HEAD = 'November 2, 2026 To BSE Limited Phiroze Jeejeebhoy Towers Dalal Street Mumbai National Stock Exchange of India Limited Exchange Plaza Bandra Kurla Complex Scrip Code: 542857 Dear Sirs, ';

test('routine notices are classified from the subject and never downloaded', () => {
  const cases: Array<[string, string, string]> = [
    [CC + 'Websol Energy System Limited has informed the Exchange about Schedule of meet', 'WEBELSOLAR_Reg_30_-_Intimation.pdf', 'MEETING_SCHEDULE'],
    [CC + 'RITES Limited has informed the Exchange about Intimation regarding Investors Meet', 'RITES_Intimationsigned.pdf', 'MEETING_SCHEDULE'],
    [CC + 'Intimation of schedule of Investor Meet', 'THELEELA_Investor_Meet_Intimation.pdf', 'MEETING_SCHEDULE'],
    [CC + 'Updated link for the Post Results Conference Call', 'APLLTD_APLPost_Result_Concall-Intimation.pdf', 'CALL_INVITE'],
    [CC + 'Greenpanel Industries Limited has informed the Exchange about Link of Recording', 'GREENPANEL_Audio_Concall.pdf', 'RECORDING_LINK'],
    [CC + 'Finolex Industries Limited has informed the Exchange about Audio Recording of the Conference Call held on November 2, 2026', 'FINPIPE2_Audio_Recording_of_the_Investors.pdf', 'RECORDING_LINK'],
    [CC + 'Gabriel India Limited has informed the Exchange about Link of Recording', 'GABRIEL_SE_Intimation_signed_1_.pdf', 'RECORDING_LINK'],
    ['Record Date — XYZ Limited has informed the Exchange about Record Date', 'XYZ_record.pdf', 'ADMIN_NOTICE'],
  ];
  for (const [s, f, want] of cases) {
    const v = pre(s, f);
    assert.equal(v.cls, want, s);
    assert.equal(shouldReadRadarDoc(v), false, s);
    assert.equal(v.analyzable, false);
    assert.equal(v.basis, 'SUBJECT');
  }
});

test('transcripts, presentations and results are read; the file name can rescue an "intimation" subject', () => {
  assert.equal(pre(CC + 'Maruti Suzuki India Limited has informed the Exchange about Transcript', 'MARUTI_Transcript_27Oct026.pdf').cls, 'TRANSCRIPT');
  assert.equal(pre('Investor Presentation — Sanghvi Movers Limited has informed the Exchange about Investor Presentation', 'SANGHVIMOV_SEIntimation_InvestorPPT.pdf').cls, 'PRESENTATION');
  assert.equal(pre(CC + 'Amara Raja Energy & Mobility Limited has informed the Exchange about Presentation', 'AMARARAJA_Earnings_presentation.pdf').cls, 'PRESENTATION');
  // a "schedule of meet" whose attachment is named as a transcript is read, not skipped
  assert.equal(pre(CC + 'ABC Limited has informed the Exchange about Schedule of meet', 'ABC_Earnings_Call_Transcript.pdf').cls, 'TRANSCRIPT');
  assert.equal(pre('Press Release — ABC Limited has informed the Exchange about press release', 'ABC_PR.pdf').cls, 'RESULTS');
  assert.equal(pre('Bagging/Receiving of orders/contracts — ABC', 'ABC_order.pdf').cls, 'OUT_OF_SCOPE');
  assert.equal(preClassifyRadarFiling({ subject: CC + 'about Transcript', attachment_urls: [] }).cls, 'NO_ATTACHMENT');
});

test('a "Transcript" filing whose PDF is only a covering letter with a website link is NOT a transcript', () => {
  const p = pre(CC + 'Maruti Suzuki India Limited has informed the Exchange about Transcript', 'MARUTI_Transcript.pdf');
  const v = classifyRadarContent(p, { text: COVER_HEAD + 'Subject: Transcript of investors’ call. The transcript of investors’ call held on 27th October 2026 on the financial results for the quarter ended on 30th September 2026, has been uploaded on the Company’s website at the below link: https://www.marutisuzuki.com/corporate/investors/company-updates Kindly take the same on record.', pages: 1 });
  assert.equal(v.cls, 'TRANSCRIPT_LINK_ONLY');
  assert.equal(v.analyzable, false);
  assert.equal(v.link, 'https://www.marutisuzuki.com/corporate/investors/company-updates');
});

test('a recording letter whose link path mentions "Transcript" is still a recording letter', () => {
  const p = pre(CC + 'Greenpanel Industries Limited has informed the Exchange about Link of Recording', 'GREENPANEL_Audio_Concall.pdf');
  const v = classifyRadarContent(p, { text: COVER_HEAD + 'Sub: Audio recording of the conference call with Investors and Analysts held on November 2, 2026. Pursuant to Regulation 30 we wish to inform you that the audio recording has been uploaded on the Company’s website: https://www.greenpanel.com/Investor-Relations/Detail.aspx?tab=Investor+Conference+Call+Transcript Kindly take the above information on record.', pages: 1 });
  assert.equal(v.cls, 'RECORDING_LINK');
});

test('"transcript will be intimated subsequently" is a recording letter, not a transcript link', () => {
  const v = classifyRadarContent(pre(CC + 'Pursuant to Regulation 30 the audio recording of the earnings conference call', 'marico_Covering_letter.pdf'),
    { text: COVER_HEAD + 'Sub: Audio recording of earnings conference call. Pursuant to Regulation 30 the audio recording of the earnings conference call held today is available on the Company’s website at https://marico.com/india/investors#quarterly. Further, the transcript of the aforesaid conference call will be intimated to the stock exchanges subsequently. This is for your information and records.', pages: 1 });
  assert.equal(v.cls, 'RECORDING_LINK');
});

test('a real transcript is recognised by its call markers', () => {
  const body = 'Moderator: Ladies and gentlemen, good day and welcome to the Q2 FY27 earnings conference call. ' +
    'Revenue grew 24% year on year and EBITDA margin expanded to 9.6%. '.repeat(120) +
    'We will now begin the question-and-answer session. The next question is from the line of an analyst. Thank you very much.';
  const v = classifyRadarContent(pre(CC + 'Panache Digilife Limited has informed the Exchange about Transcript', 'PANACHE_Earnings_Call_Transcript.pdf'), { text: body, pages: 14 });
  assert.equal(v.cls, 'TRANSCRIPT');
  assert.equal(v.confidence, 'HIGH');
  assert.equal(v.analyzable, true);
});

test('a presentation is read when it carries figures; a 5–11 MB deck is not "too large"', () => {
  const deck = 'Q2 FY27 Investor Presentation. Revenue ₹1,234 Cr up 18% YoY; EBITDA ₹210 Cr, margin 17.0% (+120 bps); PAT ₹98 Cr. Order book ₹4,500 Cr. '.repeat(40);
  const v = classifyRadarContent(pre('Investor Presentation — KEC International Limited has informed the Exchange about Investor Presentation', 'KEC_Investor_Presentation_Q2_FY27.pdf'), { text: deck, pages: 25, bytes: 5_283_639 });
  assert.equal(v.cls, 'PRESENTATION');
  assert.equal(v.analyzable, true);
  const route = readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
  assert.match(route, /READ_MAX_BYTES = 25 \* 1024 \* 1024/);
});

test('unreadable PDFs say why; only download failures are retried', () => {
  const p = pre('Investor Presentation — Rupa & Company about Presentation', 'RUPA_Inv_Presentation.pdf');
  const big = classifyRadarContent(p, { text: '', failure: 'PDF too large (32.6 MB > 25 MB)' });
  assert.equal(big.cls, 'UNREADABLE'); assert.match(big.reason, /too large/); assert.equal(isRetryableFailure(big), false);
  const net = classifyRadarContent(p, { text: '', failure: 'HTTP 503' });
  assert.equal(net.cls, 'UNREADABLE'); assert.equal(isRetryableFailure(net), true);
  const scan = classifyRadarContent(p, { text: '', pages: 30 });
  assert.match(scan.reason, /Scanned image PDF/);
  const garbled = classifyRadarContent(p, { text: '%%$#@ 12 34 ## ** ((( ))) '.repeat(40), pages: 3 });
  assert.equal(garbled.cls, 'UNREADABLE');
});

test('coverage sentence never claims more than was examined and says unread is not negative', () => {
  const f = { ...emptyFunnel(), eligible: 600, examined: 140, read_full: 110, cover_only: 25, unreadable: 5, not_yet_read: 460 };
  const s = coverageSentence(f);
  assert.match(s, /140 of 600/);
  assert.match(s, /110 read in full/);
  assert.match(s, /460 not read yet/);
  assert.match(s, /unchecked, not negative/);
  assert.match(coverageSentence({ ...emptyFunnel(), eligible: 10, examined: 10, read_full: 10 }), /Every eligible document/);
});

test('the radar page no longer claims notices are transcripts or that it re-reads them automatically', () => {
  const ui = readFileSync(new URL('../../app/(dashboard)/concall-intel/components2.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /transcript · no pattern/);
  assert.doesNotMatch(ui, /announcement · no transcript yet/);
  assert.doesNotMatch(ui, /re-reads them automatically/);
  assert.match(ui, /PROCESSING AND EXCLUDED DOCUMENTS/);
  assert.match(ui, /hidden by the SHOW \/ size filter/);
  const route = readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
  // routine classes are excluded before any download; subject-only text is never scored
  assert.match(route, /if \(shouldReadRadarDoc\(pre\)\) \{ eligible\.push/);
  assert.doesNotMatch(route, /text = `\$\{f\.company_name/);
});

test('a comparison-base period is not the claim period', () => {
  assert.equal(periodInQuote("Operating EBITDA margin expanded by 313 basis points to 9.6% from 6.4% in Q2 FY '26."), null);
  assert.equal(periodInQuote('EBITDA margin expanded by 300 basis points in Q2 FY27 on stronger mix.'), 'Q2 FY27');
  assert.equal(periodInQuote('Revenue in Q2 FY27 was ₹500 Cr versus ₹400 Cr in Q2 FY26.'), 'Q2 FY27');
});
