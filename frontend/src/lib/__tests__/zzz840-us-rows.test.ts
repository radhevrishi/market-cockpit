// zzz841 — the compact rows (watch, older filings, no catalyst, negative, large / technical moves)
// carry the same kind of detail as the research-queue cards, in BOTH markets, on the page and in the PDF.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsPDF } from 'jspdf';
import { buildResearchView, type ResearchItem, type ResearchView } from '../ai-gainers/research-view';
import { whyWatchText, watchLines, olderLines, noCatalystLines, negativeLines, technicalLines, catalystLines, NOT_NEGATIVE_TEXT } from '../ai-gainers/row-detail';
import { buildGainersPdf } from '../ai-gainers/gainers-pdf';
import { fixtureInput, fixtureInputUS } from './fixtures/gainers-view.fixture';
import { indiaPdfView, usPdfView, PDF_GENERATED_AT } from './fixtures/zzz800-gainers-pdf.fixture';
import { ResearchTriage, OneLiner, OlderTable } from '../../components/ai-gainers/ResearchTriage';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const LEAK = /\bundefined\b|\bNaN\b|\bnull\b/;
const TRADE = /\b(buy|sell|hold|accumulate|reduce|target price|stop.?loss|entry (?:price|point))\b/i;

function pdfFlow(view: ResearchView, market: 'IN' | 'US'): string {
  const doc = buildGainersPdf(jsPDF as any, { view, market, generatedAt: PDF_GENERATED_AT } as any);
  const buf = Buffer.from(doc.output('arraybuffer'));
  const bin = buf.toString('latin1');
  let raw = '';
  const sre = /stream\r?\n/g; let sm: RegExpExecArray | null;
  while ((sm = sre.exec(bin))) {
    const start = sm.index + sm[0].length; const end = bin.indexOf('endstream', start); if (end < 0) break;
    try { raw += inflateSync(buf.subarray(start, end)).toString('latin1') + '\n'; } catch { raw += bin.slice(start, end) + '\n'; }
    sre.lastIndex = end + 9;
  }
  const out: string[] = []; const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g; let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1].replace(/\\([()\\])/g, '$1'));
  return out.join(' ').replace(/\s+/g, ' ');
}

// Synthetic names only. Cards carry 4 catalysts so "and N more" shows.
const usCats = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n, i) => ({ id: `u${i}`, label: `${n} supply agreement`, category: 'Contract', direction: 'positive', sentence: `${n} Co signed a supply agreement worth $${i + 2} million.`, figures: [`$${i + 2} million`], planned: false, source: i === 1 ? 'PRESS' : 'SEC', sourceLabel: 'src', date: '2026-09-2' + i, url: null }));
const inCats = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n, i) => ({ id: `i${i}`, label: `${n} order`, category: 'Order', direction: 'positive', sentence: `${n} Ltd received an order of Rs ${i + 5} crore.`, figures: [`Rs ${i + 5} crore`], planned: false, source: i === 1 ? 'PRESS' : 'FILING', confirmedByFiling: false, sourceLabel: 'src', date: '2026-09-2' + i, url: null, title: 't', ageDays: 1 }));
const searched = { sources: ['SEC EDGAR', 'press headlines'], lookbackDays: 21, filings: 2, press: 1 };
const news = { narrative: null, items: [{ title: 'Synthetic Co says nothing specific', url: 'https://news.example/x', date: '2026-09-28', source: 'Example' }] };

const MARKETS = [
  { market: 'IN' as const, mk: () => buildResearchView(fixtureInput()), pdf: () => indiaPdfView(), cats: { inCard: { catalysts: inCats, routine: [], backdrop: null, clarification: null } } },
  { market: 'US' as const, mk: () => buildResearchView(fixtureInputUS()), pdf: () => usPdfView(), cats: { usCard: { catalysts: usCats } } },
];

for (const { market, mk, pdf, cats } of MARKETS) {
  describe(`zzz841 ${market}: watch rows`, () => {
    const v = mk();
    const w = (v.watch[0] as ResearchItem);
    test('the page shows why watch, the question, the key unknown, the score chip and max 3 catalysts with "and N more"', () => {
      assert.ok(w, 'fixture has a watch row');
      const item = { ...w, ...cats, unknowns: ['Issue price: Not disclosed', 'Dilution: Unknown'] } as ResearchItem;
      const t = strip(html(React.createElement(ResearchTriage, { view: { ...v, watch: [item] }, market } as any)));
      const sec = t.slice(t.indexOf('WATCH / INVESTIGATE'));
      assert.match(sec, /WHY WATCH, NOT QUEUE\s+\S/);
      if (item.researchQuestion) assert.ok(sec.includes('RESEARCH QUESTION') && sec.includes(String(item.researchQuestion).slice(0, 40)));
      assert.match(sec, /KEY UNKNOWN\s+Issue price: Not disclosed/);
      assert.ok(!/KEY UNKNOWN[^A-Z]*Dilution: Unknown/.test(sec.slice(0, sec.indexOf('CATALYST'))), 'only the first unknown');
      const h = html(React.createElement(ResearchTriage, { view: { ...v, watch: [item] }, market } as any));
      assert.ok(item.catalystScore ? /data-testid="score-chip"/.test(h.slice(h.indexOf('watch-detail'))) : true, 'score chip in the watch row');
      const lines = catalystLines(item, 3);
      assert.equal(lines.filter((l) => l.key === 'catalyst').length, 3);
      assert.equal(lines[lines.length - 1].text, 'and 1 more');
      assert.match(sec, /Alpha (supply agreement|order)/);
      assert.match(sec, market === 'US' ? /Contract · SEC · 2026-09-20 · stated: \$2 million · "Alpha Co signed/ : /Order · exchange filing · 2026-09-20 · stated: Rs 5 crore · "Alpha Ltd received/);
      assert.match(sec, market === 'US' ? /press only, not verified in a filing/ : /press only, reported not confirmed/);
      assert.ok(/and 1 more/.test(sec));
      assert.doesNotMatch(sec, LEAK);
    });
    test('the reason is built from real fields and never invented', () => {
      const clean = { ...w, sourceExistence: undefined, evidenceVerification: undefined, economicsUnknown: null, flags: { band: null, listing: false, dilution: false, denial: false, turnover: null }, direction: 'POSITIVE', materiality: { ...w.materiality, label: 'UNKNOWN' }, stageBadge: null, conflicts: [], catalystFor: undefined } as unknown as ResearchItem;
      const press = whyWatchText({ ...clean, sourceExistence: 'press_only', evidenceVerification: 'secondary_only' });
      assert.match(press, /^Press only, no official filing found for it/);
      const filed = whyWatchText({ ...clean, sourceExistence: 'official_filing', evidenceVerification: 'document_not_read', economicsUnknown: { label: 'x', missing: ['dilution'] } });
      assert.match(filed, /official filing exists but its document has not been read/);
      assert.match(filed, /size not established \(missing: dilution\)/);
      const cap = whyWatchText({ ...clean, flags: { ...clean.flags, dilution: true } });
      assert.match(cap, /equity raise/);
      const old = whyWatchText({ ...clean, catalystFor: 'CONTEXT' });
      assert.match(old, /[Oo]lder than the move window/);
      const bare = whyWatchText(clean);
      assert.match(bare, /[Rr]anked below the research queue on the evidence in hand/);
      for (const s of [press, filed, cap, old, bare]) assert.doesNotMatch(s, TRADE);
    });
    test('an item with no unknowns shows no KEY UNKNOWN line (nothing invented)', () => {
      const ls = watchLines({ ...w, unknowns: [] } as ResearchItem);
      assert.ok(!ls.some((l) => l.key === 'key-unknown'));
    });
  });

  describe(`zzz841 ${market}: older-context rows`, () => {
    const v = mk();
    test('the older table says context only, and names the catalyst label and stated values', () => {
      assert.ok((v.context || []).length > 0 && (v.olderFilings || []).length > 0);
      const ctx = (v.context || []).map((c) => ({ ...c, ...cats }) as ResearchItem);
      const t = strip(html(React.createElement(OlderTable, { rows: v.olderFilings!, items: ctx, onOpen: () => {} } as any)));
      assert.ok(t.includes("Context only, not this move's catalyst."), t);
      assert.match(t, /Alpha (supply agreement|order)/);
      assert.match(t, /stated: (\$2 million|Rs 5 crore)/);
      assert.match(t, /\d{4}-\d{2}-\d{2}/, 'filed date column');
      assert.match(t, /\d+ days/, 'age column');
      assert.doesNotMatch(t, LEAK);
    });
    test('the card-list lines also carry the event, filed date and age', () => {
      const it = (v.context || [])[0];
      const ls = olderLines({ ...it, ageDays: 40, filedDate: '2026-08-14' } as ResearchItem, { withEvent: true });
      assert.match(ls[0].text, /filed 2026-08-14 \(40 days ago\)/);
      assert.equal(ls[1].text, "Context only, not this move's catalyst.");
      assert.doesNotMatch(ls.map((l) => l.text).join(' '), TRADE);
    });
  });

  describe(`zzz841 ${market}: no-catalyst rows`, () => {
    const v = mk();
    const nc = v.noCatalyst.filter((i) => i.eventClass === 'NO_CATALYST');
    test('every row says "not negative", shows what was searched (or the scan note), and the first press headline as unverified', () => {
      assert.ok(nc.length > 0);
      for (const it of nc) {
        const t = strip(html(React.createElement(OneLiner, { it, kind: 'nocat' } as any)));
        assert.ok(t.includes('Not negative - nothing in the filings or news names one.'), t);
        assert.ok(/SEARCHED|SCANNED/.test(t), `searched or scanned line for ${it.ticker}: ${t}`);
        assert.doesNotMatch(t, LEAK);
      }
      const it = { ...nc[0], searched, news } as ResearchItem;
      const t = strip(html(React.createElement(OneLiner, { it, kind: 'nocat' } as any)));
      assert.match(t, /SEARCHED Searched SEC EDGAR, press headlines, last 21 days \(2 filings, 1 press item\)\./);
      assert.match(t, /PRESS \(UNVERIFIED\) 2026-09-28: Synthetic Co says nothing specific/);
    });
    test('without a record of the search the row says so instead of guessing', () => {
      const ls = noCatalystLines({ ...nc[0], searched: null, scanNote: null, catalystStatusSentence: null } as ResearchItem);
      assert.equal(ls[0].text, 'What was searched is not recorded for this name.');
      assert.equal(ls[1].text, NOT_NEGATIVE_TEXT);
      assert.doesNotMatch(ls.map((l) => l.text).join(' '), TRADE);
    });
  });

  describe(`zzz841 ${market}: negative evidence and large / technical moves`, () => {
    const v = mk();
    const base = (v.negative[0] || v.watch[0]) as ResearchItem;
    test('a negative row shows the direction reason, the facts and the research question', () => {
      const it = { ...base, eventClass: 'NEGATIVE', direction: 'NEGATIVE', directionNote: 'Synthetic reason the direction reads negative.', whatChanged: 'Synthetic fact: revenue fell against a year ago.', researchQuestion: 'Is the fall a one-off?' } as ResearchItem;
      const t = strip(html(React.createElement(ResearchTriage, { view: { ...v, negative: [it] }, market } as any)));
      const sec = t.slice(t.indexOf('NEGATIVE EVIDENCE'));
      assert.match(sec, /DIRECTION Synthetic reason the direction reads negative\./);
      assert.match(sec, /FACTS Synthetic fact: revenue fell against a year ago\./);
      assert.match(sec, /RESEARCH QUESTION Is the fall a one-off\?/);
      assert.doesNotMatch(sec, LEAK);
    });
    test('an earnings row uses the earnings mini for the facts', () => {
      const e = { revenueYoY: -12, revenueQoQ: null, ebitdaYoY: null, marginNow: null, marginPrior: null, patYoY: -45, cfoToPat: null, guidance: 'NOT_STATED', orderBook: 'NOT_STATED', keyChange: null, filedDaysAgo: 3, quarter: 'Q1 FY27' };
      const ls = negativeLines({ ...base, whatChanged: null, earnings: e } as unknown as ResearchItem);
      assert.ok(ls.some((l) => l.key === 'facts' && /Q1 FY27: revenue -12\.0% YoY, PAT -45\.0% YoY/.test(l.text)));
    });
    test('a large-move row shows what was searched, the facts and the open question, and nothing causal', () => {
      const it = { ...base, eventClass: 'MARKET_MOVE_ONLY', searched, news, flags: { ...base.flags, band: 20 } } as ResearchItem;
      const t = strip(html(React.createElement(OneLiner, { it, kind: 'technical' } as any)));
      assert.match(t, /SEARCHED Searched SEC EDGAR/);
      assert.match(t, /FACTS Price band 20%; a large move by itself does not establish demand\./);
      assert.match(t, /RESEARCH QUESTION/);
      assert.doesNotMatch(t, LEAK);
      assert.doesNotMatch(technicalLines(it).map((l) => l.text).join(' '), /caused by|driven by|behind the/i);
    });
  });

  describe(`zzz841 ${market}: the PDF`, () => {
    test('watch, older and no-catalyst rows print the same detail', () => {
      const v = pdf();
      assert.ok(v.watch.length > 0 && (v.context || []).length > 0 && v.noCatalyst.length > 0);
      const t = pdfFlow(v, market);
      assert.match(t, /WHY WATCH, NOT QUEUE/);
      assert.match(t, /KEY UNKNOWN/);
      assert.match(t, /CATALYST SCORE/);
      assert.ok(t.includes("Context only, not this move's catalyst."), 'older');
      assert.match(t, /EVENT .* filed \d{4}-\d{2}-\d{2}/);
      assert.ok(t.includes('Not negative: nothing in the filings or news names one.'), 'no catalyst');
      assert.doesNotMatch(t, LEAK);
    });
    test('searched sources, counts and the first press headline print for a no-catalyst row', () => {
      const v = pdf();
      const nc = { ...v.noCatalyst.find((i) => i.eventClass === 'NO_CATALYST')!, searched, news } as ResearchItem;
      const t = pdfFlow({ ...v, noCatalyst: [nc] }, market);
      assert.match(t, /Searched SEC EDGAR, press headlines, last 21 days \(2 filings, 1 press item\)\./);
      assert.match(t, /PRESS \(UNVERIFIED\) 2026-09-28: Synthetic Co says nothing specific/);
    });
    test('a negative row prints direction, facts and the question', () => {
      const v = pdf();
      const it = { ...v.watch[0], eventClass: 'NEGATIVE', direction: 'NEGATIVE', directionNote: 'Synthetic reason it reads negative.', whatChanged: 'Synthetic fact.', researchQuestion: 'Is it a one-off?' } as ResearchItem;
      const t = pdfFlow({ ...v, negative: [it] }, market);
      assert.match(t, /DIRECTION Synthetic reason it reads negative\./);
      assert.match(t, /FACTS Synthetic fact\./);
      assert.match(t, /RESEARCH QUESTION Is it a one-off\?/);
    });
  });

  describe(`zzz841 ${market}: wording`, () => {
    test('none of the authored lines uses trade wording', () => {
      const v = mk();
      const items = [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || [])];
      for (const it of items) {
        const authored = [whyWatchText(it), ...olderLines(it).filter((l) => l.key === 'older-context').map((l) => l.text), ...noCatalystLines(it).filter((l) => l.key === 'not-negative').map((l) => l.text), ...technicalLines(it).filter((l) => l.key === 'facts').map((l) => l.text)];
        for (const s of authored) { assert.doesNotMatch(s, TRADE, s); assert.doesNotMatch(s, LEAK, s); }
      }
    });
  });
}
