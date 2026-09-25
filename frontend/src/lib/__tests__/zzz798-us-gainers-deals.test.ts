// zzz798 — US AI Daily Gainers: M&A cards read from the filed documents.
// Fixtures are trimmed verbatim excerpts of public SEC filings:
//   CDNA  8-K/A filed 2026-09-16 (cdna-20260630.htm — an 8-K/A, not a 10-Q),
//         the original 8-K filed 2026-07-07 (Items 2.01 / 7.01) and its
//         EX-99.2 press release, and the 8-K/A pro forma exhibit;
//   VCYT  8-K filed 2026-09-14 (Items 1.01 / 2.01 / 7.01) + EX-99.1;
//   CRML  6-K filed 2026-09-16 (cover, EX-99.2 press release, EX-99.1 scheme booklet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsCard, readUsDeal, targetOf, type UsCardDoc } from '../ai-gainers/us-card';
import { originalOf, usDocRole } from '../ai-gainers/us-card-fetch';

const D = (role: string, name: string, text: string): UsCardDoc => ({ role, url: `https://www.sec.gov/Archives/edgar/data/0/0/${name}`, text });

// ── CDNA ──
const CDNA_8KA = 'FORM 8-K/A (Amendment No. 1) CURRENT REPORT Date of Report (Date of earliest event reported): June 30, 2026 CAREDX, INC. Item 2.01 Completion of Acquisition or Disposition of Assets. On July 7, 2026, CareDx, Inc. (the “Company”) filed a Current Report on Form 8-K (the “Original 8-K”) with the Securities and Exchange Commission (the “SEC”) reporting the completion of its acquisition of Naveris, Inc., a Delaware corporation (“Naveris”). In order to comply with the rules and regulations promulgated by the SEC under the Securities Exchange Act of 1934, as amended, the Company hereby amends Item 9.01 of the Original 8-K for the purpose of filing the historical financial statements of Naveris and the related pro forma financial information in accordance with Article 11 of Regulation S-X, which were not previously filed with the Original 8-K. Item 9.01 Financial Statements and Exhibits.';
const CDNA_PROFORMA = 'Unaudited Pro Forma Condensed Combined Financial Information. The merger consideration under the Merger Agreement is based on base consideration of $160.0 million, subject to certain adjustments related to cash, indebtedness, transaction expenses, and net working capital. The preliminary fair value of the purchase price consideration was approximately $203.4 million, consisting of the following (in thousands): Cash consideration transferred to securityholders on Closing $ 146,715.';
const CDNA_ORIG = 'Item 2.01. Completion of Acquisition or Disposition of Assets. Eurobio Transaction On June 30, 2026, CareDx, Inc. (the “Company”) completed the previously announced sale of the shares of CareDx AB, a wholly-owned Swedish subsidiary of the Company, and certain assets relating to the Company’s kitted laboratory products business and related software to Eurobio Scientific S.A. (“Eurobio”), pursuant to and subject to the terms and conditions of the Purchase Agreement. The aggregate purchase price received by the Company was $171.7 million in cash, subject to certain customary adjustments specified in the Purchase Agreement for working capital, cash and indebtedness. The foregoing description of the Purchase Agreement does not purport to be complete and is qualified in its entirety by reference to the full text of the Purchase Agreement, which is filed as Exhibit 2.1 to the Current Report on Form 8-K filed by the Company on April 16, 2026, and is incorporated herein by reference. Naveris Transaction On July 1, 2026, the Company and Nautilus Merger Sub, Inc., a Delaware corporation and wholly owned subsidiary of the Company (“Merger Sub”), completed the previously announced acquisition of Naveris, Inc., a Delaware corporation (“Naveris”), pursuant to the Agreement and Plan of Merger (the “Merger Agreement”). The aggregate purchase price paid by the Company consisted of $161.8 million in cash, subject to certain customary adjustments specified in the Merger Agreement for Naveris’ cash, indebtedness, transaction expenses and net working capital. Additionally, under the terms and subject to the conditions set forth in the Merger Agreement, Naveris’ equityholders will be eligible to receive up to $100.0 million in additional cash consideration contingent upon the achievement of specified revenue-based milestones in respect of fiscal years ending December 31, 2026 and December 31, 2027.';
const CDNA_PR = 'EX-99.2 3 naveris-pressrelease.htm EX-99.2 Document Exhibit 99.2 CareDx Completes Acquisition of Naveris, Extending Leadership into High-Growth Specialty Oncology NavDx® is the only Medicare-covered MRD test for HPV-positive Head & Neck and Anal Cancers. CareDx, Inc. (Nasdaq: CDNA), a leading precision medicine diagnostics company in transplant, specialty oncology, and cell therapy today announced the successful completion of its previously announced acquisition of Naveris, following the satisfaction of all closing conditions. Over 130,000 NavDx tests have been commercially reported to date. In 2025, Naveris generated approximately $35 million in revenue, more than doubling year-over-year.';

const cdna = () => buildUsCard({
  ticker: 'CDNA', company: 'CareDx, Inc.', marketCapM: 3175,
  filing: { form: '8-K/A', items: ['2.01', '9.01'], date: '2026-09-16T16:06:00-04:00', url: 'https://www.sec.gov/Archives/edgar/data/1217234/000121723426000052/cdna-20260630.htm', subject: '8-K/A: Acquisition or disposition completed [Item 2.01, Item 9.01]' },
  docs: [D('primary', 'cdna-20260630.htm', CDNA_8KA), D('proforma', 'cdna-20260916proformafs.htm', CDNA_PROFORMA)],
  original: { form: '8-K', date: '2026-07-07', url: 'https://www.sec.gov/Archives/edgar/data/1217234/000121723426000038/cdna-20260630.htm', docs: [D('primary', 'cdna-20260630.htm', CDNA_ORIG), D('ex99', 'naveris-pressrelease.htm', CDNA_PR)] },
  secChecked: true,
});

test('CDNA: the 8-K/A reads the original 8-K for the Naveris terms — not the Eurobio sale in the same 8-K', () => {
  const c = cdna()!;
  assert.equal(c.kind, 'acquisition');
  assert.equal(c.kindWord, 'Cash acquisition');
  assert.equal(c.deal!.target, 'Naveris');
  assert.equal(c.deal!.upfrontM, 161.8);
  assert.equal(c.deal!.contingentM, 100);
  assert.equal(c.deal!.targetRevenueM, 35);
  assert.equal(c.deal!.fairValueM, 203.4);
  assert.equal(c.deal!.stageText, 'completed July 1, 2026');
  assert.match(c.whatChanged, /^Naveris: \$161\.8M cash up front ÷ \$3\.175B market cap = 5\.1% · \+ up to \$100M more if milestones are met · target revenue ≈ \$35M \(price ≈ 4\.6× sales\)$/);
  assert.doesNotMatch(c.whatChanged, /171\.7/);
  assert.equal(c.material.label, 'MODERATE');
  assert.deepEqual(c.material.ratios.map((r) => r.text), ['$161.8M ÷ $3.175B market cap = 5.1%', 'with the full earn-out: $261.8M ÷ $3.175B = 8.2%']);
  assert.equal(c.stage, 'EXECUTED');
});

test('CDNA: SOURCE names the 8-K/A AND the original 8-K it amends — never a 10-Q', () => {
  const c = cdna()!;
  assert.equal(c.source.tier, 'SEC');
  assert.equal(c.source.label, 'VERIFIED DOCUMENT (SEC 8-K/A, filed 2026-09-16) + original 8-K filed 2026-07-07');
  assert.doesNotMatch(c.source.label, /10-Q/);
  assert.equal(c.headline, 'CareDx Completes Acquisition of Naveris, Extending Leadership into High-Growth Specialty Oncology');
});

test('originalOf: the 8-K the amendment names by date', () => {
  const recent = [
    { form: '8-K/A', date: '2026-09-16', items: ['2.01', '9.01'], url: 'a' },
    { form: '8-K', date: '2026-07-30', items: ['2.02', '7.01', '9.01'], url: 'b' },
    { form: '8-K', date: '2026-07-07', items: ['2.01', '7.01', '9.01'], url: 'c' },
  ];
  assert.equal(originalOf({ date: '2026-09-16', items: ['2.01', '9.01'], text: CDNA_8KA }, recent)!.url, 'c');
  assert.equal(originalOf({ date: '2026-09-16', items: ['2.01', '9.01'], text: 'no date named' }, recent)!.url, 'c');   // overlapping item 2.01
});

test('exhibit roles: a press release or pro forma exhibit is found whatever it is called', () => {
  assert.equal(usDocRole('naveris-pressrelease.htm', 'cdna-20260630.htm', 9302), 'ex99');
  assert.equal(usDocRole('vcyt-09x14x20268xkpressrel.htm', 'vcyt-20260910.htm', 13909), 'ex99');
  assert.equal(usDocRole('cdna-20260916proformafs.htm', 'cdna-20260630.htm', 476079), 'proforma');
  assert.equal(usDocRole('tm2625926d1_ex99-1.htm', 'tm2625926d1_8k.htm', 352091), 'ex99');
  assert.equal(usDocRole('ea030552301ex99-1.htm', 'ea0305523-6k_critical.htm', 4766297), 'booklet');
  assert.equal(usDocRole('ea030552301ex99-2.htm', 'ea0305523-6k_critical.htm', 14107), 'ex992');
  assert.equal(usDocRole('cdna-20260630.htm', 'cdna-20260630.htm', 33826), 'primary');
  assert.equal(usDocRole('R1.htm', 'x.htm', 100), null);
});

// ── VCYT ──
const VCYT_8K = 'Item 2.01 Completion of Acquisition or Disposition of Assets. On September 14, 2026, Veracyte completed its acquisition of Convergent pursuant to the terms of the Merger Agreement. Under the terms of the Merger Agreement and in accordance with the terms set forth therein, at the effective time of the Merger, Veracyte paid to the securityholders of Convergent aggregate cash consideration of $150 million in cash, subject to customary purchase price adjustments for Convergent’s cash, indebtedness, transaction expenses and net working capital. In addition, Veracyte may pay to the securityholders of Convergent up to an aggregate of $30 million in additional cash consideration based on the achievement of specified milestones related to UroAmp publications and reimbursement efforts.';
const VCYT_PR = 'EX-99.1 3 vcyt-09x14x20268xkpressrel.htm EX-99.1 Document Exhibit 99.1 Veracyte Acquires Convergent Genomics, Expanding its Urology Diagnostics Portfolio with a Urinary Tumor DNA Testing Platform Acquisition positions Veracyte to deliver powerful genomic insights from urine, tissue, and blood SOUTH SAN FRANCISCO, Calif., - Sept. 14, 2026 — Veracyte, Inc. (Nasdaq: VCYT), a leading cancer diagnostics company, today announced its acquisition of Convergent Genomics. The acquisition includes $150 million in upfront cash consideration and up to $30 million in additional cash consideration tied to key milestones related to UroAmp reimbursement efforts. Veracyte contemplated the ongoing operating expenses of Convergent in its previously provided 2026 adjusted EBITDA guidance and is not updating such guidance at this time.';

test('VCYT: a cash acquisition is labelled a cash acquisition — never "merger / swap terms, dilution per share"', () => {
  const c = buildUsCard({
    ticker: 'VCYT', company: 'Veracyte, Inc.', marketCapM: 3902,
    filing: { form: '8-K', items: ['1.01', '2.01', '7.01', '9.01'], date: '2026-09-14', url: 'https://www.sec.gov/Archives/edgar/data/1384101/000138410126000049/vcyt-20260910.htm', subject: '8-K: Acquisition or disposition completed [Item 1.01, Item 2.01, Item 7.01, Item 9.01]' },
    docs: [D('primary', 'vcyt-20260910.htm', VCYT_8K), D('ex99', 'vcyt-09x14x20268xkpressrel.htm', VCYT_PR)], secChecked: true,
  })!;
  assert.equal(c.kindWord, 'Cash acquisition');
  assert.equal(c.eventType, 'Acquisition');
  assert.equal(c.deal!.structure, 'cash');
  assert.equal(c.deal!.target, 'Convergent Genomics');
  assert.equal(c.deal!.upfrontM, 150);
  assert.equal(c.deal!.contingentM, 30);
  assert.match(c.whatChanged, /^Convergent Genomics: \$150M cash up front ÷ \$3\.902B market cap = 3\.8% · \+ up to \$30M more if milestones are met$/);
  assert.equal(c.material.label, 'SMALL');
  assert.doesNotMatch(`${c.kindWord} ${c.whyResearch}`, /merger|swap|dilution per share/i);
  assert.equal(c.deal!.stageText, 'completed September 14, 2026');
});

// ── CRML ──
const CRML_6K = 'FORM 6-K REPORT OF FOREIGN PRIVATE ISSUER Critical Metals Corp. EXPLANATORY NOTE Court Orders Grant Convening of Scheme Meetings; Scheme Booklet Registered with ASIC On May 18, 2026, Critical Metals Corp. (“Critical Metals”) entered into a binding Scheme Implementation Deed under which Critical Metals will acquire all of the issued shares and listed options of European Lithium Ltd. (ASX: EUR) (“European Lithium”) by way of two interdependent schemes of arrangement under Australian law (the “Schemes”). On September 15, 2026, the Supreme Court of Western Australia made orders directing European Lithium to convene meetings of its shareholders and optionholders to consider and vote on the Schemes.';
const CRML_PR = 'EX-99.2 3 ea030552301ex99-2.htm PRESS RELEASE, DATED SEPTEMBER 15, 2026 Exhibit 99.2 CRITICAL METALS CORP. MERGER WITH EUROPEAN LITHIUM ADVANCES TO SHAREHOLDER VOTE FOLLOWING COURT RULING Court orders granted convening scheme meetings; Scheme Booklet registered with ASIC New York, NY – September 15, 2026 – Critical Metals Corp. (Nasdaq: CRML) today provided an update on its proposed acquisition of European Lithium Limited (ASX: EUR). The consideration payable under each Scheme is to be satisfied by the issue of new ordinary shares in Critical Metals Corp. The general meeting and the Scheme Meetings are scheduled to be held on Thursday, October 22, 2026 in West Leederville, Western Australia. Subject to the approval of European Lithium securityholders, the approval of the Court, and the satisfaction or waiver of the remaining conditions precedent, the Schemes are expected to be implemented in November 2026.';
const CRML_BOOKLET = 'Consideration Share Scheme Consideration Under the terms of the Share Scheme, Share Scheme Participants will be entitled to receive between 0.025 and 0.045 New CRML Shares for each EUR Share held as at the Record Date. The Share Scheme Transaction Ratio is determined by the Scheme VWAP. As at the Last Practicable Date, the Share Scheme Consideration represents a total implied value of A$0.41 per EUR Share. The Share Scheme Consideration represents a premium of approximately: ● 67.3% to EUR’s last uninterrupted closing share price of A$0.245 per EUR Share prior to announcement of the Schemes on 22 April 2026; ● 71.6% to EUR’s 20-day VWAP. (b) Pro forma ownership On the Implementation Date, EUR Shareholders and EUR Optionholders will own approximately 38.0% of the Combined Group on an undiluted basis and 35.2% on a fully diluted basis. If you are a Small Shareholder you will receive cash at $8.81 per share from the Sale Agent.';

const crml = () => buildUsCard({
  ticker: 'CRML', company: 'Critical Metals Corp.', marketCapM: 1200,
  filing: { form: '6-K', items: [], date: '2026-09-16', url: 'https://www.sec.gov/Archives/edgar/data/1951089/000121390026100366/ea0305523-6k_critical.htm', subject: '6-K' },
  docs: [D('primary', 'ea0305523-6k_critical.htm', CRML_6K), D('ex992', 'ea030552301ex99-2.htm', CRML_PR), D('booklet', 'ea030552301ex99-1.htm', CRML_BOOKLET)], secChecked: true,
});

test('CRML: the scheme booklet terms are extracted — share swap, ratio, ownership, stage and vote date', () => {
  const c = crml()!;
  assert.equal(c.kind, 'merger');
  assert.equal(c.kindWord, 'Share-swap merger (paid in new shares)');
  assert.equal(c.deal!.structure, 'stock');
  assert.equal(c.deal!.exchangeRatio, 'between 0.025 and 0.045 new shares for each EUR Share');
  assert.equal(c.deal!.ownershipPct, 38);
  assert.equal(c.deal!.premiumPct, 67.3);
  assert.equal(c.deal!.perShare, null);                          // a Small-Holder cash-out price is not the deal price
  assert.equal(c.deal!.stage, 'signed');
  assert.equal(c.deal!.stageText, 'signed, not yet completed · holder vote October 22, 2026 · expected to complete November 2026');
  assert.equal(c.stage, 'SIGNED');
  assert.match(c.whatChanged, /sellers would own 38% of the combined company → deal ≈ 61\.3% of CRML's current size/);
  assert.equal(c.material.label, 'SIGNIFICANT');
  assert.match(c.material.how, /38 ÷ 62/);
  assert.match(c.headline, /^Critical Metals Corp\. Merger with European Lithium Advances to Shareholder Vote/);
});

test('deal helpers: target names, no target → no invented price', () => {
  assert.equal(targetOf('Veracyte Acquires Convergent Genomics, Expanding its Urology'), 'Convergent Genomics');
  assert.equal(targetOf('today announced the successful completion of its previously announced acquisition of Naveris, following'), 'Naveris');
  const d = readUsDeal([{ role: 'primary', text: 'The Company entered into a merger agreement. Terms were not disclosed in this report.' }], { items: ['1.01'] });
  assert.equal(d, null);
});
