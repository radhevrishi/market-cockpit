// zzz800 — AI Daily Gainers "⬇ Download PDF": the page's research view for the
// selected market, written to an A4 research note with real (selectable) text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { buildGainersPdf, gainersPdfFilename, gainersSessionYmd, pdfText, type GainersPdfInput } from '../ai-gainers/gainers-pdf';
import type { ResearchView } from '../ai-gainers/research-view';
import { DEMO_VIEW } from '../../components/ai-gainers/__fixture__';
import { indiaPdfView, usPdfView, PDF_GENERATED_AT } from './fixtures/zzz800-gainers-pdf.fixture';

/** The text a reader would select / search: every string drawn on every page. */
function drawnText(doc: jsPDF): string {
  const out: string[] = [];
  // Page streams are deflated (compress: true) — inflate them to read the text operators.
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
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  }
  // Mixed-weight runs are drawn word by word; read them back as one flow of words.
  return out.join(' ').replace(/\s+/g, ' ');
}
const build = (p: Partial<GainersPdfInput> & Pick<GainersPdfInput, 'view' | 'market'>) =>
  buildGainersPdf(jsPDF as any, { generatedAt: PDF_GENERATED_AT, ...p });
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;

test('India: builds from fixture data, key fields and the footer are in the text', () => {
  const v = indiaPdfView();
  const doc = build({ view: v, market: 'IN', sessionNote: 'Moves are intraday and will change until 15:30 IST.' });
  assert.ok(doc.getNumberOfPages() >= 1);
  const t = drawnText(doc);
  assert.ok(v.queue.length > 0, 'fixture has a research queue');
  for (const it of v.queue) assert.ok(t.includes(it.displayTicker || it.ticker), `queue ticker ${it.ticker} is printed`);
  assert.match(t, /WHAT CHANGED/);
  assert.match(t, /WHY RESEARCH/);
  assert.match(t, /RESEARCH QUEUE/);
  assert.match(t, /MARKET SUMMARY/);
  assert.match(t, /HOW TO READ THIS/);
  assert.match(t, /Market Cockpit · AI Daily Gainers · India · generated 25 Sep 2026 14:35 IST · Research only, not investment advice/);
  assert.match(t, new RegExp(`Page 1 of ${doc.getNumberOfPages()}`));
  assert.match(t, /14:12 IST/);   // scan time in IST
});

test('USA: builds, New York scan time plus India time, criteria line, verified vs press only', () => {
  const v = usPdfView();
  const doc = build({ view: v, market: 'US', criteria: 'change >= 4% · cap $300M-$10B · avg vol (30d) >= 300k', sessionNote: 'US session Thu, 24 Sep 2026 (New York time) — it is already Fri, 25 Sep 2026 in India' });
  assert.ok(doc.getNumberOfPages() >= 1);
  const t = drawnText(doc);
  assert.match(t, /CBRL/);
  assert.match(t, /WHAT CHANGED/);
  assert.match(t, /17:12 New York time \(02:42 IST, 25 Sep 2026 in India\)/);
  assert.match(t, /SCAN CRITERIA/);
  assert.match(t, /SEC 8-K/);
  assert.match(t, /Press only/);
  assert.match(t, /Market Cockpit · AI Daily Gainers · USA · generated 25 Sep 2026 05:05 ET · Research only, not investment advice/);
  assert.doesNotMatch(t, /\bRs\b|₹/);
});

test('no ₹ glyph and no emoji anywhere; India amounts read "Rs"', () => {
  for (const [view, market] of [[indiaPdfView(), 'IN'], [DEMO_VIEW, 'IN'], [usPdfView(), 'US']] as Array<[ResearchView, 'IN' | 'US']>) {
    const t = drawnText(build({ view, market, sessionNote: '⚠ 🟢 stale ▲ ▼ →' }));
    assert.doesNotMatch(t, /₹/);
    assert.doesNotMatch(t, EMOJI);
    assert.ok([...t].every((c) => c.charCodeAt(0) < 0x2200 || c === '€'), 'only WinAnsi text reaches the font');
  }
  const demo = drawnText(build({ view: DEMO_VIEW, market: 'IN' }));
  assert.match(demo, /Rs 488 Cr/);
  assert.equal(pdfText('₹488 Cr ≈ 47.8% → 🟢 ▲ up ⚠ late'), 'Rs 488 Cr ~ 47.8% -> up up Caution: late');
});

test('the research-queue cards carry the source link as a clickable URL', () => {
  const doc = build({ view: DEMO_VIEW, market: 'IN' });
  const raw = doc.output();
  assert.match(raw, /\/URI \(https:\/\/www\.bseindia\.com\/\)/);
});

test('filename: AI-Gainers-India-<IST session date>.pdf / AI-Gainers-USA-<New York session date>.pdf', () => {
  assert.equal(gainersPdfFilename(indiaPdfView(), 'IN', PDF_GENERATED_AT), 'AI-Gainers-India-2026-09-25.pdf');
  assert.equal(gainersPdfFilename(usPdfView(), 'US', PDF_GENERATED_AT), 'AI-Gainers-USA-2026-09-24.pdf');
  // No session date on the view: the scan instant in the market's own time zone.
  const late = { ...DEMO_VIEW, session: { ...DEMO_VIEW.session, date: null, scanAt: '2026-09-25T02:30:00Z' } };
  assert.equal(gainersSessionYmd(late, 'US'), '2026-09-24');
  assert.equal(gainersSessionYmd(late, 'IN'), '2026-09-25');
});

test('empty sections are omitted — no heading printed over nothing', () => {
  const lean: ResearchView = {
    ...DEMO_VIEW, watch: [], negative: [], context: [], noCatalyst: [], dataQuality: [], sourceFailures: [], partialFailures: [], portfolio: [], needsReading: [], immaterialNegative: [],
  };
  const t = drawnText(build({ view: lean, market: 'IN' }));
  assert.match(t, /RESEARCH QUEUE/);
  for (const h of ['WATCH / INVESTIGATE', 'OLDER FILINGS', 'NO IDENTIFIED CATALYST', 'DATA QUALITY / NEW LISTINGS', 'DATA-SOURCE FAILURES', 'Findings, not omissions', 'Position reviews against your thesis', 'PRICE-BAND MOVES']) {
    assert.ok(!t.includes(h), `${h} is omitted when empty`);
  }
  const full = drawnText(build({ view: DEMO_VIEW, market: 'IN' }));
  for (const h of ['WATCH / INVESTIGATE', 'OLDER FILINGS (CONTEXT)', 'NO IDENTIFIED CATALYST', 'DATA QUALITY / NEW LISTINGS', 'DATA-SOURCE FAILURES']) assert.ok(full.includes(h), `${h} is printed when present`);
  // No US criteria for India, and none when the US scan gave none.
  assert.ok(!full.includes('SCAN CRITERIA'));
  assert.ok(!drawnText(build({ view: usPdfView(), market: 'US' })).includes('SCAN CRITERIA'));
});

test('an empty board still builds one honest page', () => {
  const none: ResearchView = { ...DEMO_VIEW, summary: { ...DEMO_VIEW.summary, scanned: 0 }, top3: [], queue: [] };
  const doc = build({ view: none, market: 'US' });
  assert.equal(doc.getNumberOfPages(), 1);
  assert.match(drawnText(doc), /No gainers on this board for this session/);
});

test('the button sits next to RESCAN; while loading it is disabled and says why', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ResearchTriage } = await import('../../components/ai-gainers/ResearchTriage');
  const { GainersPdfButton } = await import('../../components/ai-gainers/GainersPdfButton');
  (globalThis as any).React = React;
  const html = (reason: string | null) => renderToStaticMarkup(React.createElement(ResearchTriage, {
    view: DEMO_VIEW, market: 'IN', onRescan: () => {},
    pdfAction: React.createElement(GainersPdfButton, { view: DEMO_VIEW, market: 'IN', disabledReason: reason }),
  }));
  const busy = html('Wait — the research is still running.');
  assert.match(busy, /RESCAN[\s\S]*⬇ Download PDF/);
  const btn = (h: string) => /<button[^>]*data-testid="gainers-pdf"[^>]*>/.exec(h)?.[0] || '';
  assert.match(btn(busy), /disabled=""/);
  assert.match(busy, /Wait — the research is still running\./);
  const ready = html(null);
  assert.ok(btn(ready));
  assert.doesNotMatch(btn(ready), /disabled=""/);
  // India's page is otherwise unchanged when no button is passed.
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ResearchTriage, { view: DEMO_VIEW, market: 'IN' })), /Download PDF/);
});
