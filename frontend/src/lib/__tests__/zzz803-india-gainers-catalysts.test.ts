// zzz803 — India AI Daily Gainers: catalysts the page called "no catalyst".
// The owner's reference ranking for the day — Whirlpool India (parent may
// sell its remaining promoter stake, press, unconfirmed), Shanti Gold (strong
// Q1, restatement, promoter stake movement, AGM), Taneja Aerospace (latest
// quarterly numbers), Allied Digital (Q1 revenue +19% to ₹260 crore; a senior
// executive resigned), Avadh Sugar (back to profit, only ₹0.24 crore —
// turnaround, small), Bhageria (clarification: volume market-driven, nothing
// undisclosed), Steelcast / TCI / Advit (routine) — against the India event
// taxonomy (in-event-taxonomy.ts), the India card and its rendering on the
// view, the triage components and the PDF.
//
// Rules held: a figure only when the source sentence states it; unknown is
// never negative; silence never passes ("No catalyst found in filings or
// news"); filed vs "reported, not confirmed by the company"; weak stays weak;
// routine stays routine; the clarification is shown as the event; the latest
// result within 60 days is the dated backdrop. No trade words, no scores.
// The filing / press sentences below are realistic fixtures (the press lines
// mirror headline wording seen on 2026-09-23/25), not live data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import {
  classifyIndiaEvents, inFiguresIn, inSentences, figureCrore, buildIndiaCard, countInByCategory,
  IN_EVENT_RULE_IDS, IN_EVENT_CATEGORIES, IN_BACKDROP_DAYS, inEventMeta, type InCardFiling, type InCardPress,
} from '../ai-gainers/in-event-taxonomy';
import { buildFinding, compactInputs, rescoreFromInputs, isBackdropFiling, RULES_VERSION, type AnnouncementLite, type Finding } from '../ai-gainers/catalyst-research';
import { buildNewsContext } from '../ai-gainers/news-context';
import { buildResearchView, type ResearchItem, type ResearchView } from '../ai-gainers/research-view';
import { buildGainersPdf } from '../ai-gainers/gainers-pdf';
import { classifyUsEvents } from '../ai-gainers/us-event-taxonomy';
import { InCatalystList, UsCatalystList } from '../../components/ai-gainers/Badges';

(globalThis as any).React = React;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const ids = (t: string, headline = false) => classifyIndiaEvents(t, { headline }).map((h) => h.id);
const nonRoutine = (t: string, headline = false) => classifyIndiaEvents(t, { headline }).filter((h) => !h.routine);
const NOW = new Date('2026-09-25T10:00:00.000Z');          // 15:30 IST
const CLOSE = '2026-09-25T15:30:00+05:30';
const d = (daysAgo: number, hh = '10:15') => new Date(Date.parse(`2026-09-25T${hh}:00+05:30`) - daysAgo * 86_400_000).toISOString().replace('.000Z', 'Z');
const TRADE_WORDS = /\b(buy|sell|strong buy|accumulate|target price|stop[- ]loss)\b/i;

// ── 1. the taxonomy: realistic Indian filing / press sentences ────────────────

const CASES: Array<[string, string, boolean?]> = [
  ['promoter_stake_sale', 'Whirlpool of India promoter set to sell entire stake, reports CNBC-Awaaz; shares hit 20% upper circuit', true],
  ['promoter_stake_sale', 'Whirlpool Mauritius Holdings is exploring the sale of its remaining 39.76% promoter stake in Whirlpool of India, according to people familiar with the matter.'],
  ['open_offer', 'The Acquirer has made a public announcement of an open offer to acquire up to 26% of the voting share capital of the Target Company under Regulations 3(1) and 4 of the SEBI (SAST) Regulations, 2011.'],
  ['restatement', 'The figures for the corresponding quarter of the previous year have been restated pursuant to a change in accounting policy for inventory valuation from FIFO to weighted average cost.'],
  ['promoter_selling', 'Disclosure under Regulation 29(2) of SEBI (SAST) Regulations, 2011: Mr. Pankaj Soni, a member of the promoter group, sold 1,25,000 equity shares representing 0.56% of the paid-up capital on September 19, 2026.'],
  ['promoter_buying', 'Mrs. Meena Jain, promoter, acquired 50,000 equity shares of the Company through open market purchase, increasing the promoter shareholding to 62.40%.'],
  ['revenue_growth', 'Revenue from operations for Q1 FY27 grew 19% YoY to ₹260 crore, driven by the digital infrastructure business.'],
  ['revenue_growth', 'Allied Digital Services Q1FY27 Results: Revenue up 19% YoY to ₹260 crore', true],
  ['profit_growth', 'Consolidated net profit rose 42.5% year-on-year to ₹18.30 crore in the quarter ended June 30, 2026.'],
  ['turnaround_profit', 'Avadh Sugar & Energy turns profitable in Q1FY27 with ₹0.24 Cr net profit', true],
  ['turnaround_profit', 'The Company reported a net profit of ₹0.24 crore for the quarter as against a net loss of ₹6.12 crore in Q1 FY26.'],
  ['kmp_resignation', 'Mr. Rajesh Kumar has resigned from the position of Chief Financial Officer (Key Managerial Personnel) of the Company with effect from the close of business hours on September 20, 2026.'],
  ['kmp_resignation', 'Intimation of resignation of Mr. Anil Mehta, Senior Management Personnel (President – Global Sales), effective September 22, 2026.'],
  ['price_clarification', 'With reference to the clarification sought by the Exchange on the significant increase in volume, the Company confirms that there is no undisclosed information and the volume movement is purely market driven.'],
  ['order_win', 'Pursuant to Regulation 30 of SEBI (LODR) Regulations, 2015, we wish to inform you that the Company has received a Letter of Award (LOA) from NTPC Limited worth ₹126.40 crore for supply and erection of ash handling systems.'],
  ['order_win', 'The Company has bagged a work order worth Rs. 48.75 crore from Rail Vikas Nigam Limited for traction substation works.'],
  ['capacity_commissioned', 'The Company has successfully commissioned its new 1.2 GW solar module line at Sanand and commercial production commenced on September 22, 2026.'],
  ['capacity_expansion', 'The Board approved a capex of ₹350 crore for capacity expansion of the Dahej plant from 60,000 TPA to 1,00,000 TPA.'],
  ['equity_raise', 'The Board approved raising up to ₹500 crore through a Qualified Institutions Placement (QIP) of equity shares.'],
  ['acquisition', 'The Company has entered into a share purchase agreement to acquire 100% stake in Nova Castings Private Limited for a consideration of ₹85 crore.'],
  ['regulatory_approval', 'The Company has received final approval from the USFDA for its ANDA for Dapagliflozin Tablets, 5 mg and 10 mg.'],
  ['auditor_resignation', 'M/s ABC & Associates, Statutory Auditors of the Company, have tendered their resignation citing pre-occupation with other assignments.'],
  ['media_clarification', "Not party to parent's talks with potential stake buyers: Whirlpool of India", true],
  ['record_results', 'The Company recorded its highest-ever quarterly revenue of ₹1,204 crore in Q1 FY27.'],
  ['revenue_decline', 'Net sales declined 14.2% YoY to ₹88.6 crore on lower realisations.'],
  ['net_loss', 'The Company posted a net loss of ₹12.40 crore in Q1 FY27.'],
  ['stake_disclosure', 'Disclosure under Regulation 29(1) of SEBI (SAST) Regulations, 2011 received from the promoter group.'],
  ['tax_demand', 'The Company has received a GST demand order of ₹4.18 crore including interest and penalty from the Assistant Commissioner, CGST.'],
];

test('every case: the named event is found, with its evidence sentence', () => {
  for (const [id, text, headline] of CASES) {
    const hits = classifyIndiaEvents(text, { headline: !!headline });
    const h = hits.find((x) => x.id === id);
    assert.ok(h, `${id} not found in: ${text}\n got: ${hits.map((x) => x.id).join(', ')}`);
    assert.ok(text.includes(h!.sentence.replace(/…$/, '')) || h!.sentence.length > 0, 'sentence is from the text');
    assert.ok(inEventMeta(id), `${id} is a known rule`);
  }
});

test('never an invented figure: every figure is a literal substring of its own sentence AND of the input', () => {
  for (const [, text, headline] of CASES) {
    for (const h of classifyIndiaEvents(text, { headline: !!headline })) {
      for (const f of h.figures) {
        assert.ok(h.sentence.includes(f), `figure "${f}" not in sentence "${h.sentence}"`);
        assert.ok(text.includes(f), `figure "${f}" not in the source text`);
      }
    }
  }
  // no figure where the sentence states none
  assert.deepEqual(classifyIndiaEvents('Mr. Rajesh Kumar has resigned as Chief Financial Officer of the Company.')[0].figures, []);
  assert.deepEqual(classifyIndiaEvents('Whirlpool of India promoter set to sell entire stake', { headline: true })[0].figures, []);
  // literal ₹ crore / % extraction; a count is not money
  assert.deepEqual(inFiguresIn('Revenue up 19% YoY to ₹260 crore'), ['19%', '₹260 crore']);
  assert.deepEqual(inFiguresIn('allotment of 2 crore equity shares'), []);
  assert.equal(figureCrore('₹0.24 Cr'), 0.24);
  assert.equal(figureCrore('Rs 24 lakh'), 0.24);
  assert.equal(figureCrore('20%'), null);
});

test('Allied Digital result: growth figures exactly as stated (19%, ₹260 crore)', () => {
  const h = classifyIndiaEvents('Allied Digital Services Q1FY27 Results: Revenue up 19% YoY to ₹260 crore', { headline: true }).find((x) => x.id === 'revenue_growth')!;
  assert.deepEqual(h.figures, ['19%', '₹260 crore']);
  assert.equal(h.direction, 'positive');
});

test('Avadh Sugar: a ₹0.24 crore turnaround is labelled "turnaround, small" — never plain growth', () => {
  for (const t of ['Avadh Sugar & Energy turns profitable in Q1FY27 with ₹0.24 Cr net profit', 'The Company reported a net profit of ₹0.24 crore for the quarter as against a net loss of ₹6.12 crore in Q1 FY26.']) {
    const hits = classifyIndiaEvents(t, { headline: t.length < 90 });
    const h = hits.find((x) => x.id === 'turnaround_profit')!;
    assert.equal(h.strength, 'small');
    assert.equal(h.note, 'turnaround, small');
    assert.ok(!hits.some((x) => x.id === 'net_loss'), 'the year-ago loss is not reported as a loss event');
  }
  // a large turnaround is not "small": the profit is read before "as against"
  const big = classifyIndiaEvents('Net profit stood at ₹48.20 crore as against a net loss of ₹2.10 crore a year ago.').find((x) => x.id === 'turnaround_profit')!;
  assert.equal(big.strength, null);
});

test('weak results stay weak: decline / loss carry strength "weak" and read negative', () => {
  for (const t of ['Net sales declined 14.2% YoY to ₹88.6 crore on lower realisations.', 'The Company posted a net loss of ₹12.40 crore in Q1 FY27.']) {
    const h = nonRoutine(t)[0];
    assert.equal(h.strength, 'weak');
    assert.equal(h.direction, 'negative');
  }
});

test('Whirlpool: a press stake-sale report is a PLANNED event (reported, not a done deal); the company response is its own type', () => {
  const h = classifyIndiaEvents('Whirlpool of India shares surge 20% as promoter Whirlpool Mauritius eyes full exit: Sources', { headline: true })[0];
  assert.equal(h.id, 'promoter_stake_sale');
  assert.equal(h.planned, true);
  assert.equal(h.direction, 'mixed');
  const r = classifyIndiaEvents("Not party to parent's talks with potential stake buyers: Whirlpool of India", { headline: true });
  assert.ok(r.some((x) => x.id === 'media_clarification'));
});

test('open offer: fires on SAST wording, not on "no open offer" / "exempt from open offer"', () => {
  assert.ok(ids('The Acquirer shall make an open offer to the public shareholders under SEBI (SAST) Regulations.').includes('open_offer'));
  assert.ok(!ids('The inter-se transfer among promoters is exempt from the open offer requirement under Regulation 10.').includes('open_offer'));
  assert.ok(!ids('The transaction will not trigger an open offer.').includes('open_offer') || !ids('No open offer is triggered by this transaction.').includes('open_offer'));
});

test('negatives: routine analyst meet, trading window, board meeting intimation, AGM stay routine — never a catalyst', () => {
  const ROUTINE: Array<[string, string]> = [
    ['analyst_meet', 'Intimation of Analyst / Institutional Investor Meet scheduled on September 26, 2026 under Regulation 30 of SEBI (LODR) Regulations, 2015.'],
    ['trading_window', 'Closure of Trading Window for dealing in securities of the Company from October 1, 2026 till 48 hours after the declaration of financial results for the quarter ended September 30, 2026.'],
    ['board_meeting_intimation', 'Intimation of Board Meeting to be held on November 10, 2026 to consider and approve the unaudited financial results for the quarter ended September 30, 2026.'],
    ['agm_record_date', 'Notice of the 41st Annual General Meeting to be held on September 28, 2026 and record date for final dividend.'],
  ];
  for (const [id, t] of ROUTINE) {
    const hits = classifyIndiaEvents(t);
    assert.ok(hits.some((h) => h.id === id && h.routine), `${id} named as routine: ${hits.map((h) => h.id)}`);
    const card = buildIndiaCard({ filings: [{ subject: t, summary: null, url: `https://x/${id}`, dateIso: d(2) }], press: [], now: NOW, windowDays: 21 });
    assert.equal(card.lead, null, `${id}: no lead`);
    assert.equal(card.backdrop, null, `${id}: a routine letter that mentions "financial results" is not a result`);
    assert.equal(card.catalysts.length, 0);
    assert.match(card.summary, /Routine filings only/);
  }
});

test('boilerplate never triggers: safe-harbour / disclaimer sentences are dropped, letter furniture is cut', () => {
  assert.deepEqual(nonRoutine('This press release contains forward-looking statements; actual results may differ materially and revenue growth of 20% is not assured.'), []);
  assert.deepEqual(nonRoutine('Disclaimer: the Company does not undertake to update any forward-looking information including the order book of ₹900 crore.'), []);
  assert.deepEqual(nonRoutine('This is for your information and records. Thanking you, Yours faithfully, For and on behalf of the Board.'), []);
  // the Reg 30 preamble is cut, the event after it is read
  const h = nonRoutine('Dear Sir/Madam, Pursuant to Regulation 30 of SEBI (LODR) Regulations, 2015, we wish to inform you that the Company has received a purchase order worth ₹32.5 crore from BHEL.')[0];
  assert.equal(h.id, 'order_win');
  assert.deepEqual(h.figures, ['₹32.5 crore']);
});

test('tax / court "orders" are not order wins; a cancelled order is negative', () => {
  assert.ok(!ids('The Company has received a GST demand order of ₹4.18 crore from the Assistant Commissioner.').includes('order_win'));
  assert.ok(!ids('The Hon\'ble NCLT passed an order in the matter on September 12, 2026.').includes('order_win'));
  const c = classifyIndiaEvents('The customer has cancelled the purchase order of ₹22 crore placed in March 2026.');
  assert.equal(c[0].id, 'order_cancellation');
  assert.equal(c[0].direction, 'negative');
});

test('sentence split keeps "Rs." / "Ltd." / decimals inside a sentence', () => {
  const s = inSentences('The Company received an order of Rs. 12.5 crore from ABC Ltd. for supply of valves. The order is to be executed in 6 months.');
  assert.equal(s.length, 2);
  assert.match(s[0], /Rs\. 12\.5 crore from ABC Ltd\. for supply/);
});

test('rule set: ~60 India event types over ten categories; counts cover every category', () => {
  assert.ok(IN_EVENT_RULE_IDS.length >= 55, `${IN_EVENT_RULE_IDS.length} rules`);
  const cnt = countInByCategory(classifyIndiaEvents('Revenue grew 19% YoY. The CFO resigned from the post of Chief Financial Officer.'));
  assert.deepEqual(Object.keys(cnt).sort(), [...IN_EVENT_CATEGORIES].sort());
  assert.equal(IN_BACKDROP_DAYS, 60);
});

// ── 2. the India card: the owner's nine names ─────────────────────────────────

const F = (subject: string, daysAgo: number, summary: string | null = null, docText: string | null = null): InCardFiling => ({ subject, summary, url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${encodeURIComponent(subject.slice(0, 20))}-${daysAgo}.pdf`, dateIso: d(daysAgo), docText });
const P = (title: string, daysAgo: number, source = 'Moneycontrol'): InCardPress => ({ title, url: `https://news.example/${encodeURIComponent(title.slice(0, 24))}`, date: d(daysAgo).slice(0, 10), source });
const card = (filings: InCardFiling[], press: InCardPress[] = []) => buildIndiaCard({ filings, press, now: NOW, windowDays: 21, sessionCloseIso: CLOSE });

const NAMES = {
  WHIRLPOOL: {
    company: 'Whirlpool of India Limited',
    filings: [F('Clarification on news item appearing in media', 1, "The Company is not a party to the discussions of its parent with potential stake buyers and has no information to disclose."), F('Outcome of Board Meeting - Unaudited Financial Results for the quarter ended June 30, 2026', 47)],
    press: [P('Whirlpool of India promoter set to sell entire stake, reports CNBC-Awaaz; shares hit 20% upper circuit', 2), P("Not party to parent's talks with potential stake buyers: Whirlpool of India", 1, 'Business Standard')],
  },
  SHANTIGOLD: {
    company: 'Shanti Gold International Limited',
    filings: [
      F('Outcome of Board Meeting - Unaudited Financial Results for the quarter ended June 30, 2026', 44, 'Revenue from operations grew 58% YoY to ₹402.6 crore; net profit rose 71% to ₹21.4 crore.', 'The figures of the corresponding quarter of the previous year have been restated pursuant to a change in accounting policy for inventory valuation'),
      F('Disclosure under Regulation 29(2) of SEBI (SAST) Regulations, 2011', 6),
      F('Notice of 18th Annual General Meeting to be held on September 28, 2026', 9),
    ],
    press: [],
  },
  TANAA: {
    company: 'Taneja Aerospace & Aviation Ltd',
    filings: [F('Financial Results for the quarter ended June 30, 2026', 45)],
    press: [P('Taneja Aerospac Consolidated June 2026 Net Sales at Rs 10.31 crore, up 20.99% Y-o-Y', 38), P('Four aerospace stocks to watch as India builds its MRO industry', 6, 'TradingView')],
  },
  ADSL: {
    company: 'Allied Digital Services Limited',
    filings: [F('Financial Results for the quarter ended June 30, 2026', 43), F('Resignation of Senior Management Personnel', 3, 'Mr. Anil Mehta, President – Global Delivery (Senior Management Personnel), has resigned with effect from September 22, 2026.')],
    press: [P('Allied Digital Services Q1FY27 Results: Revenue up 19% YoY to ₹260 crore', 2, 'scanx.trade')],
  },
  AVADHSUGAR: {
    company: 'Avadh Sugar & Energy Limited',
    filings: [F('Unaudited Financial Results for the quarter ended June 30, 2026', 42)],
    press: [P('Avadh Sugar & Energy turns profitable in Q1FY27 with ₹0.24 Cr net profit', 2, 'scanx.trade')],
  },
  BHAGERIA: {
    company: 'Bhageria Industries Limited',
    filings: [F('Clarification sought from Bhageria Industries Ltd on increase in volume', 1, 'The Company has informed the Exchange that there is no undisclosed information and the increase in volume is purely market driven.')],
    press: [P('Chemical Stocks In Focus: Dye Intermediate Prices See Massive Surge — Check Details', 1, 'NDTV Profit')],
  },
  STEELCAS: { company: 'Steelcast Limited', filings: [F('Intimation of Analyst / Institutional Investor Meet', 2)], press: [] },
  TCIEXP: { company: 'TCI Express Limited', filings: [F('Intimation of Board Meeting to consider unaudited financial results', 4), F('Unaudited Financial Results for the quarter ended June 30, 2026', 48)], press: [] },
  ADVIT: { company: 'Advit Jewels Limited', filings: [F('Closure of Trading Window', 5)], press: [] },
};

test('1 Whirlpool India: lead = promoter / parent stake sale, reported, not confirmed by the company', () => {
  const c = card(NAMES.WHIRLPOOL.filings, NAMES.WHIRLPOOL.press);
  assert.equal(c.lead?.id, 'promoter_stake_sale');
  assert.equal(c.lead?.source, 'PRESS');
  assert.equal(c.lead?.confirmedByFiling, false);
  assert.equal(c.lead?.sourceLabel, 'reported, not confirmed by the company');
  assert.equal(c.lead?.planned, true);
  assert.ok(c.catalysts.some((x) => x.id === 'media_clarification' && x.source === 'FILING'), 'the company response is listed as filed');
  assert.match(c.summary, /Promoter \/ parent stake sale \(reported plan\) — reported, not confirmed by the company/);
  assert.ok(c.backdrop, 'the result 47 days ago is the backdrop');
});

test('2 Shanti Gold: Q1 growth backdrop with the stated figures; restatement; SAST stake movement filed; AGM routine', () => {
  const c = card(NAMES.SHANTIGOLD.filings);
  assert.equal(c.backdrop?.tone, 'growth');
  assert.equal(c.backdrop?.filing?.ageDays, 44);
  assert.ok(['revenue_growth', 'profit_growth'].includes(c.backdrop!.lead!.id));
  assert.ok(c.backdrop!.lead!.figures.every((f) => /58%|₹402\.6 crore|71%|₹21\.4 crore/.test(f)));
  assert.ok(c.backdrop!.also.some((x) => x.id === 'restatement'), 'restatement read from the document');
  assert.ok(c.catalysts.some((x) => x.id === 'stake_disclosure' && x.source === 'FILING'));
  assert.ok(c.routine.some((r) => /AGM/.test(r.label)));
});

test('3 Taneja Aerospace: the latest quarterly numbers (press report of the filed result) are the backdrop, figures as stated', () => {
  const c = card(NAMES.TANAA.filings, NAMES.TANAA.press);
  assert.equal(c.lead, null);
  assert.equal(c.backdrop?.tone, 'growth');
  assert.equal(c.backdrop?.filing?.ageDays, 45);
  assert.equal(c.backdrop?.lead?.source, 'PRESS');
  assert.deepEqual(c.backdrop?.lead?.figures, ['Rs 10.31 crore', '20.99%']);
  assert.match(c.summary, /No fresher event · Quarterly result: growth \(filed 2026-08-11, 45d ago\)/);
});

test('4 Allied Digital: revenue +19% to ₹260 crore (press of the filed result) + a senior executive resignation (filed)', () => {
  const c = card(NAMES.ADSL.filings, NAMES.ADSL.press);
  assert.equal(c.backdrop?.tone, 'growth');
  assert.deepEqual(c.backdrop?.lead?.figures, ['19%', '₹260 crore']);
  const res = c.catalysts.find((x) => x.id === 'kmp_resignation');
  assert.ok(res && res.source === 'FILING', 'resignation is on file');
});

test('5 Avadh Sugar: turnaround, small — ₹0.24 crore, never dressed up as growth', () => {
  const c = card(NAMES.AVADHSUGAR.filings, NAMES.AVADHSUGAR.press);
  assert.equal(c.backdrop?.tone, 'turnaround_small');
  assert.match(c.backdrop!.label, /^Turnaround, small/);
  assert.deepEqual(c.backdrop?.lead?.figures, ['₹0.24 Cr']);
  assert.equal(c.backdrop?.lead?.note, 'turnaround, small');
});

test('6 Bhageria: the clarification is the event — company says no undisclosed information; no fundamental catalyst', () => {
  const c = card(NAMES.BHAGERIA.filings, NAMES.BHAGERIA.press);
  assert.equal(c.clarification?.id, 'price_clarification');
  assert.equal(c.clarification?.note, 'company says no undisclosed information');
  assert.match(c.summary, /Exchange clarification on price \/ volume movement.*company says no undisclosed information; no fundamental catalyst filed/);
});

test('7–9 Steelcast / TCI / Advit: routine only; TCI\'s older result is a dated backdrop, never a fresh catalyst', () => {
  const s = card(NAMES.STEELCAS.filings);
  assert.equal(s.lead, null); assert.equal(s.backdrop, null);
  assert.match(s.summary, /^Routine filings only \(analyst \/ investor meet\) — no fresh catalyst$/);
  const t = card(NAMES.TCIEXP.filings);
  assert.equal(t.lead, null);
  assert.equal(t.backdrop?.tone, 'filed');
  assert.match(t.backdrop!.label, /figures not stated in the text read/);
  assert.ok(t.routine.some((r) => r.label === 'Board meeting intimation'));
  const a = card(NAMES.ADVIT.filings);
  assert.equal(a.lead, null);
  assert.match(a.summary, /trading window/);
});

test('silence never passes: nothing filed, nothing in press → "No catalyst found in filings or news"', () => {
  const c = card([], [P('Advit Jewels share price today live updates', 1)]);
  assert.equal(c.summary, 'No catalyst found in filings or news');
  assert.equal(c.catalysts.length, 0);
});

test('a filing after the session close never explains the move; a result older than 60 days is not a backdrop', () => {
  const late = buildIndiaCard({ filings: [{ subject: 'Receipt of Letter of Award worth ₹90 crore from NHAI', summary: null, url: 'u1', dateIso: '2026-09-25T18:40:00+05:30' }], press: [], now: new Date('2026-09-25T14:00:00Z'), windowDays: 21, sessionCloseIso: CLOSE });
  assert.equal(late.lead, null);
  const old = card([F('Unaudited Financial Results for the quarter ended March 31, 2026', 120, 'Revenue grew 30% to ₹90 crore.')]);
  assert.equal(old.backdrop, null);
});

test('press confirmed by a filing is labelled so; unconfirmed press never reads as filed', () => {
  const c = card([F('Receipt of Letter of Award', 1, 'The Company has received a Letter of Award worth ₹126.40 crore from NTPC Limited.')], [P('XYZ Engineering bags ₹126.40 crore order from NTPC', 1)]);
  assert.equal(c.lead?.source, 'FILING');
  assert.deepEqual(c.lead?.figures, ['₹126.40 crore']);
  const c2 = card([], [P('XYZ Engineering bags ₹126 crore order from NTPC', 1)]);
  assert.equal(c2.lead?.sourceLabel, 'reported, not confirmed by the company');
});

// ── 3. the finding → the view: what the page shows for each name ─────────────

function finding(tkr: keyof typeof NAMES, movePct: number, opts: { marketCap?: number } = {}): Finding {
  const n = NAMES[tkr];
  const announcements: AnnouncementLite[] = n.filings.map((f) => ({ subject: f.subject, summary: f.summary, url: f.url!, dateIso: f.dateIso, ageDays: null }));
  const news = buildNewsContext(n.press.map((p) => ({ title: `${p.title} - ${p.source}`, url: p.url!, published_at: `${p.date}T09:00:00+05:30` })), { ticker: tkr, company: n.company, now: NOW });
  const docs = n.filings.filter((f) => f.docText).map((f) => ({ url: f.url!, date: f.dateIso, title: f.subject, seq: null, hash: `h-${f.url}`, access: 'DOCUMENT_READ' as const, facts: [{ source: { kind: 'EXCHANGE_FILING', access: 'DOCUMENT_READ', issuer: tkr, date: f.dateIso, url: f.url, title: f.subject }, event: { kind: 'results', counterparty: null, product: null, geography: null, stage: null }, economics: {} as any, time: {} as any, quotes: [f.docText!], unknowns: [], verificationRequired: false, polarity: 'neutral', headline: f.subject } as any], routineReason: null, classified: true, valuesSeen: [], relation: 'current' as const }));
  return { ...buildFinding({ ticker: tkr, company: n.company, market: 'IN', movePct, marketCap: opts.marketCap ?? 1500, turnover: 20, announcements, returns: null, holding: false, sources: ['BSE corporate announcements'], sourceFailed: false, windowDays: 21, now: NOW, sessionCloseIso: CLOSE, news, docs: docs as any }), rulesVersion: RULES_VERSION };
}

const MOVES: Record<keyof typeof NAMES, number> = { WHIRLPOOL: 12.1, SHANTIGOLD: 11.4, TANAA: 9.8, ADSL: 8.7, AVADHSUGAR: 7.9, BHAGERIA: 7.2, STEELCAS: 6.4, TCIEXP: 5.6, ADVIT: 5.1 };
function view(): ResearchView {
  const findings: Record<string, Finding> = {};
  for (const t of Object.keys(NAMES) as Array<keyof typeof NAMES>) findings[t] = finding(t, MOVES[t]);
  const board = (Object.keys(NAMES) as Array<keyof typeof NAMES>).map((t) => ({ ticker: t, company: NAMES[t].company, move_pct: MOVES[t], market_cap: 1500 }));
  return buildResearchView({ market: 'IN', findings, board, filedResults: [], holdings: [], now: NOW.toISOString(), session: { date: '2026-09-25', scanAt: '2026-09-25T08:42:00Z', status: 'closed', cached: false } as any });
}
const allItems = (v: ResearchView): ResearchItem[] => {
  const m = new Map<string, ResearchItem>();
  for (const k of ['queue', 'watch', 'negative', 'immaterialNegative', 'noCatalyst', 'dataQuality', 'context'] as const) for (const i of ((v as any)[k] || []) as ResearchItem[]) m.set(i.ticker, i);
  return Array.from(m.values());
};
const itemOf = (v: ResearchView, t: string) => allItems(v).find((i) => i.ticker === t)!;

test('findings carry the India card (window 21 days kept; backdrop reaches 60 days)', () => {
  const f = finding('AVADHSUGAR', 7.9);
  assert.ok(f.inCard, 'India finding has a card');
  assert.equal(f.windowDays, 21);
  assert.equal(f.status, 'none', 'the 42-day-old result is outside the finding window — the card, not the status, carries it');
  assert.equal(f.inCard!.backdrop?.tone, 'turnaround_small');
});

test('the view: none of the owner\'s six catalyst names reads "no catalyst"; the three routine names do', () => {
  const v = view();
  const w = itemOf(v, 'WHIRLPOOL');
  assert.equal(w.eventClass, 'POTENTIAL_UNVERIFIED');
  assert.match(w.eventLabel!, /Promoter \/ parent stake sale — reported plan · reported, not confirmed by the company/);
  assert.equal(w.sourceConfidence, 'SECONDARY_SUMMARY');
  assert.match(w.verification!, /Reported, not confirmed by the company/);
  assert.match(w.whyResearch, /buyer, the price and whether an open offer is triggered/);
  assert.ok(v.queue.some((i) => i.ticker === 'WHIRLPOOL') || v.watch.some((i) => i.ticker === 'WHIRLPOOL'), 'Whirlpool is in the queue / watch');

  const s = itemOf(v, 'SHANTIGOLD');
  assert.equal(s.eventType, 'Earnings');
  assert.match(s.eventLabel!, /Quarterly result — growth/);
  assert.match(s.whatChanged!, /58%|71%/);
  assert.match(s.whatChanged!, /restatement/i);
  assert.match(s.whatChanged!, /stake movement/i);
  assert.equal(s.catalystFor, 'CONTEXT');
  assert.match(s.headline, /^Older context \(44d\): Quarterly result: growth \(filed 2026-08-12, 44d ago\)/);

  const tn = itemOf(v, 'TANAA');
  assert.equal(tn.eventType, 'Earnings');
  assert.match(tn.whatChanged!, /Rs 10\.31 crore, 20\.99%/);

  const a = itemOf(v, 'ADSL');
  assert.equal(a.eventType, 'Earnings');
  assert.match(a.whatChanged!, /₹260 crore/);
  assert.match(a.whatChanged!, /key management resignation \(filed/);

  const av = itemOf(v, 'AVADHSUGAR');
  assert.match(av.eventLabel!, /^Turnaround, small/);
  assert.equal(av.eventClass, 'CONFIRMED_LOW_MATERIALITY');
  assert.match(av.whatChanged!, /₹0\.24 Cr/);

  const b = itemOf(v, 'BHAGERIA');
  assert.equal(b.eventClass, 'NO_CATALYST');
  assert.match(b.eventLabel!, /Exchange clarification on price \/ volume movement — no fundamental catalyst/);
  assert.match(b.headline, /company says no undisclosed information; says the movement is market-driven/);

  for (const t of ['STEELCAS', 'ADVIT']) {
    const it = itemOf(v, t);
    assert.equal(it.eventClass, 'NO_CATALYST', t);
    assert.match(it.headline, /No catalyst found in filings or news — routine filings only/);
  }
  const tci = itemOf(v, 'TCIEXP');
  assert.equal(tci.catalystFor, 'CONTEXT', 'TCI: older result is context, never a fresh catalyst');
  assert.match(tci.eventLabel!, /Quarterly result filed · fundamental backdrop/);
  assert.match(tci.whyResearch, /No fresher event/);
});

test('no trade words and no visible 0–100 score in any India card text', () => {
  const v = view();
  for (const it of allItems(v)) {
    const txt = [it.headline, it.eventLabel, it.whatChanged, it.whyResearch, it.scanNote, it.verification, it.inCard?.summary, ...(it.inCard?.catalysts || []).map((c) => `${c.label} ${c.sourceLabel} ${c.note || ''}`)].filter(Boolean).join(' ');
    assert.ok(!TRADE_WORDS.test(txt.replace(/stake buyers?|potential stake buyers|sell (?:entire|its|remaining) stake|selling|sell[- ]side/gi, '')), `${it.ticker}: ${txt}`);
    assert.ok(!/\bscore\b|\/100\b/i.test(txt), `${it.ticker}: no score shown`);
  }
});

test('stored inputs keep the backdrop result; a re-score rebuilds the same card (zero-spend path)', () => {
  const n = NAMES.AVADHSUGAR;
  const anns: AnnouncementLite[] = [...n.filings.map((f) => ({ subject: f.subject, summary: f.summary, url: f.url!, dateIso: f.dateIso, ageDays: null })), { subject: 'Unaudited Financial Results for the quarter ended December 31, 2025', summary: null, url: 'old', dateIso: d(130), ageDays: null }];
  const news = buildNewsContext(n.press.map((p) => ({ title: p.title, url: p.url!, published_at: `${p.date}T09:00:00+05:30` })), { ticker: 'AVADHSUGAR', company: n.company, now: NOW });
  const stored = compactInputs({ announcements: anns, returns: null, marketCap: 1500, turnover: 10, sources: ['BSE corporate announcements'], sourceFailed: false, fetchedAt: NOW.toISOString(), news }, 21, NOW);
  assert.equal(stored.announcements.length, 1, 'only the ≤60-day result is kept beyond the window');
  assert.ok(isBackdropFiling(stored.announcements[0]));
  const f = rescoreFromInputs(stored, { ticker: 'AVADHSUGAR', company: n.company, market: 'IN', movePct: 7.9, holding: false, windowDays: 21, sessionCloseIso: CLOSE });
  assert.equal(f.inCard?.backdrop?.tone, 'turnaround_small');
  assert.ok(!isBackdropFiling({ subject: 'Closure of Trading Window', summary: 'till 48 hours after the declaration of financial results' }));
});

// ── 4. rendering: the triage list component and the PDF ─────────────────────

test('InCatalystList: filed vs "reported, not confirmed by the company"; empty says so plainly; US items render nothing', () => {
  const v = view();
  const w = strip(renderToStaticMarkup(React.createElement(InCatalystList, { it: itemOf(v, 'WHIRLPOOL') })));
  assert.match(w, /CATALYSTS FOUND/);
  assert.match(w, /REPORTED, NOT CONFIRMED BY THE COMPANY/);
  assert.match(w, /EXCHANGE FILING/);
  assert.match(w, /BACKDROP/);
  const av = strip(renderToStaticMarkup(React.createElement(InCatalystList, { it: itemOf(v, 'AVADHSUGAR') })));
  assert.match(av, /Turnaround, small/);
  const b = strip(renderToStaticMarkup(React.createElement(InCatalystList, { it: itemOf(v, 'BHAGERIA') })));
  assert.match(b, /EXCHANGE CLARIFICATION.*company says no undisclosed information/);
  const empty = { ...itemOf(v, 'ADVIT'), inCard: { ...itemOf(v, 'ADVIT').inCard!, routine: [], catalysts: [], backdrop: null, clarification: null } };
  assert.match(strip(renderToStaticMarkup(React.createElement(InCatalystList, { it: empty }))), /No catalyst found in filings or news/);
  assert.equal(renderToStaticMarkup(React.createElement(InCatalystList, { it: { ...itemOf(v, 'ADVIT'), market: 'US' } as any })), '');
  assert.equal(renderToStaticMarkup(React.createElement(UsCatalystList, { it: itemOf(v, 'WHIRLPOOL') })), '', 'the US list stays US-only');
});

function drawnText(doc: jsPDF): string {
  const buf = Buffer.from(doc.output('arraybuffer'));
  const bin = buf.toString('latin1');
  let raw = '';
  const sre = /stream\r?\n/g;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(bin))) {
    const start = sm.index + sm[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    try { raw += inflateSync(buf.subarray(start, end)).toString('latin1') + '\n'; } catch { raw += bin.slice(start, end) + '\n'; }
    sre.lastIndex = end + 9;
  }
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  return out.join(' ').replace(/\s+/g, ' ');
}

test('India PDF still builds and shows the catalyst: stake sale (reported, not confirmed), backdrop, clarification, plain no-catalyst', () => {
  const v = view();
  const doc = buildGainersPdf(jsPDF as any, { view: v, market: 'IN', generatedAt: '2026-09-25T09:05:00Z' } as any);
  assert.ok(doc.getNumberOfPages() >= 1);
  const t = drawnText(doc);
  assert.match(t, /WHIRLPOOL/);
  assert.match(t, /CATALYSTS FOUND/);
  assert.match(t, /reported, not confirmed by the company/);
  assert.match(t, /Promoter \/ parent stake sale/);
  assert.match(t, /OLDER FILINGS \(CONTEXT\)/i);
  assert.match(t, /Turnaround, small/);
  assert.match(t, /company says no undisclosed information/);
  assert.match(t, /No catalyst found in filings or news/);
  assert.ok(!/\bBUY\b|\bSELL\b/.test(t), 'no trade words in the PDF');
});

// ── 5. US unchanged ──────────────────────────────────────────────────────────

test('US behaviour unchanged: the US taxonomy still reads its own sentences; US findings carry no India card', () => {
  assert.equal(classifyUsEvents('Total revenue increased 47% year-over-year to $31.2 million.')[0].id, 'revenue_growth');
  const us = buildFinding({ ticker: 'ACME', company: 'Acme Corp', market: 'US', movePct: 9, marketCap: 800, turnover: 5, announcements: [], returns: null, holding: false, sources: ['SEC EDGAR'], sourceFailed: false, windowDays: 21, now: NOW });
  assert.equal(us.inCard, undefined);
});

// ── 6. live wording (NSE corporate announcements / filed PDFs, fetched 2026-09-25) ──
// The exchange texts below were read live from NSE for WHIRLPOOL, BHAGERIA and
// AVADHSUGAR during this patch (BSE's API refused the sandbox); they are kept
// here verbatim so the rules are held to the real wording.

test('live NSE wording: Whirlpool news-verification quotes the press — reported, not confirmed; the reply is the company\'s', () => {
  const filings: InCardFiling[] = [
    { subject: 'News Verification', summary: 'The Exchange has sought clarification from Whirlpool of India Limited with respect to recent news item captioned Whirlpool of India promoter set to sell entire stake, reports CNBC-Awaaz; shares surge 17%.  The response from the Company is attached.', url: 'https://nsearchives.nseindia.com/corporate/llogesh_24092026113320_SE_intimation_marketrumour_signed.pdf', dateIso: '2026-09-24T11:35:53+05:30' },
    { subject: 'Rumour Verification - Regulation 30(11)', summary: 'Whirlpool of India Limited has informed the Exchange about Rumour Verification - Regulation 30(11)', url: 'https://nsearchives.nseindia.com/corporate/WHIRLPOOL_24092026074633_SE_intimation_marketrumour_signed.pdf', dateIso: '2026-09-24T07:47:02+05:30',
      docText: 'The Company clarifies that the said news article relates to its promoter company and not to Whirlpool of India Limited. However, the Company has not been a party to any negotiations that Whirlpool Corporation may have been having with potential buyers' },
    { subject: 'Shareholders meeting', summary: 'Whirlpool of India Limited has submitted the Exchange a copy Srutinizers report of  Annual General Meeting held on September 09, 2026. Further, the company has informed the Exchange regarding voting results.', url: 'https://nsearchives.nseindia.com/corporate/WHIRLPOOL_10092026154059_Intimation_Voting_Results_signed.pdf', dateIso: '2026-09-10T15:41:19+05:30' },
  ];
  const c = card(filings);
  assert.equal(c.lead?.id, 'promoter_stake_sale');
  assert.equal(c.lead?.source, 'PRESS', 'an exchange query quoting a news caption is not the company confirming it');
  assert.match(c.lead!.sourceLabel, /not confirmed by the company/);
  assert.deepEqual(c.lead?.figures, ['17%']);
  const mc = c.catalysts.find((x) => x.id === 'media_clarification');
  assert.ok(mc && mc.source === 'FILING');
  assert.ok(c.routine.some((r) => /AGM|record/i.test(r.label)));
});

test('live NSE wording: Avadh Sugar press release — PAT ₹0.24 Cr as against (-) 8.41 Cr → turnaround, small; income up vs year-ago as stated', () => {
  const lines = ['Total Income in Q1 FY27 at Rs. 781.05 Cr as against Rs. 716.91 Cr in Q1 FY26.', 'EBITDA in Q1 FY27 at Rs. 38.25 Cr as against Rs. 28.53 Cr in Q1 FY26.', 'PAT in Q1 FY27 at Rs. 0.24 Cr as against Rs. (-) 8.41 Cr in Q1 FY26.'];
  const hits = classifyIndiaEvents(lines.join(' ▪ '));
  const t = hits.find((h) => h.id === 'turnaround_profit')!;
  assert.equal(t.strength, 'small');
  assert.equal(t.note, 'turnaround, small');
  assert.ok(t.figures.includes('Rs. 0.24 Cr'));
  const r = hits.find((h) => h.id === 'revenue_vs_prior')!;
  assert.equal(r.direction, 'positive', '781.05 vs 716.91, as stated — no % computed');
  assert.deepEqual(r.figures, ['Rs. 781.05 Cr', 'Rs. 716.91 Cr']);
  for (const h of hits) for (const f of h.figures) assert.ok(lines.join(' ').includes(f));
  const c = card([
    { subject: 'Press Release', summary: 'Avadh Sugar & Energy Limited has informed the Exchange regarding a press release dated August 03, 2026, titled "Quarterly Earnings Release Q1 FY27".', url: 'https://nsearchives.nseindia.com/corporate/AVADHSUGAR_03082026171847_Aselprjun26.pdf', dateIso: '2026-08-03T17:18:55+05:30', docText: lines.join(' ') },
    { subject: 'Outcome of Board Meeting', summary: 'Avadh Sugar & Energy Limited has submitted to the Exchange, the financial results for the period ended Jun 30, 2026.', url: 'https://nsearchives.nseindia.com/corporate/AVADHSUGAR_03082026134358_aseljun26se.pdf', dateIso: '2026-08-03T13:47:09+05:30' },
    { subject: 'Copy of Newspaper Publication', summary: 'Avadh Sugar & Energy Limited has informed the Exchange about Copy of Newspaper Publication', url: 'https://nsearchives.nseindia.com/corporate/AVADHSUGAR_26082026183251_Aselswinaug.pdf', dateIso: '2026-08-26T18:33:02+05:30' },
  ]);
  assert.equal(c.backdrop?.tone, 'turnaround_small');
  assert.equal(c.backdrop?.lead?.source, 'FILING');
  assert.equal(c.backdrop?.lead?.sourceLabel, 'exchange filing (document read)');
  assert.match(c.summary, /Turnaround, small — quarterly result \(filed 2026-08-03, 52d ago\)/);
});

test('live NSE wording: Bhageria — the exchange\'s price-movement letter is a query; the reply is the clarification', () => {
  const c = card([
    { subject: 'Price movement', summary: 'Significant movement in price has been observed in Bhageria Industries Limited. The Exchange, in order to ensure that investors have latest relevant information about the company and to inform the market place so that the interest of the investors is safeguarded, has written to the company. The response from the company is awaited.', url: 'https://www.nseindia.com/q', dateIso: '2026-09-21T17:36:49+05:30' },
    { subject: 'General Updates', summary: 'Bhageria Industries Limited has informed the Exchange about General Updates', url: 'https://nsearchives.nseindia.com/corporate/BHAGERIA_22092026104702_21092026_QUERY.pdf', dateIso: '2026-09-22T10:47:15+05:30', docText: 'The Company confirms that there is no undisclosed information and the increase in volume is purely market driven' },
    { subject: 'General Updates', summary: 'Bhageria Industries Limited has informed the Exchange about General Updates regarding trading window closure  from 1 October 2026 till 48 hours after declaration of Unaudited Financial result for Quarter ended 30 September, 2026 for all designated person and their immediate Relative.', url: 'https://nsearchives.nseindia.com/corporate/BHAGERIA_19092026150333_Sign-Trading_Window_Closure.pdf', dateIso: '2026-09-19T15:03:45+05:30' },
  ]);
  assert.equal(c.lead, null);
  assert.equal(c.clarification?.id, 'price_clarification');
  assert.equal(c.backdrop, null, 'a trading-window letter naming "financial result" is not a result');
  assert.ok(c.catalysts.some((x) => x.id === 'exchange_query'));
  assert.ok(c.routine.some((r) => r.label === 'Trading window closure'));
});
