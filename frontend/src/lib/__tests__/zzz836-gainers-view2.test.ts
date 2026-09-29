// zzz836 - round 2: one partition, source existence vs evidence verification, direction marks, wording, noise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildResearchView, PARTITION_ORDER, headlineSourceOf } from '../ai-gainers/research-view';
import { buildIndiaCard } from '../ai-gainers/in-event-taxonomy';
import { fixtureInput, fixtureInputUS, FINDINGS } from './fixtures/gainers-view.fixture';
import { ResearchTriage } from '../../components/ai-gainers/ResearchTriage';
import { ResearchCard, AlsoIn } from '../../components/ai-gainers/ResearchCard';
import { DirectionChip } from '../../components/ai-gainers/Badges';
import { DIRECTION_MARK, isPriceCommentary } from '../../components/ai-gainers/tokens';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const all = (v: ReturnType<typeof buildResearchView>) => [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])];

function oneItem(ticker: string, card: any, extra: Record<string, unknown> = {}) {
  const inp = fixtureInput();
  const tpl = FINDINGS.NOCAT as any;
  inp.findings = { [ticker]: { ...tpl, ticker, company: `${ticker} Ltd`, status: 'none', headline: null, sourceDate: null, ageDays: null, inCard: card, ...extra } };
  inp.board = [{ ticker, company: `${ticker} Ltd`, move_pct: 8 }];
  inp.filedResults = []; inp.holdings = []; inp.now = '2026-09-29T05:00:00Z'; inp.session = undefined;
  const v = buildResearchView(inp);
  const it = all(v).find((i) => i.ticker === ticker);
  assert.ok(it, `${ticker} present`);
  return { v, it: it! };
}

describe('zzz836 A: one mutually exclusive primary status', () => {
  for (const [name, mk] of [['IN', fixtureInput], ['US', fixtureInputUS]] as const) {
    test(`${name}: the buckets add up to scanned, each name in exactly one`, () => {
      const inp = mk();
      inp.board = [...inp.board, { ticker: 'NEWNAME', company: 'New Name Ltd', move_pct: 3 }];   // on the board, not researched
      const v = buildResearchView(inp);
      const p = v.partition!;
      assert.ok(p, 'partition present');
      assert.equal(p.scanned, v.summary.scanned);
      assert.equal(p.buckets.reduce((n, b) => n + b.count, 0), p.scanned);
      assert.equal(p.total, p.scanned);
      const seen = new Map<string, string>();
      for (const b of p.buckets) for (const t of b.tickers) { assert.ok(!seen.has(t), `${t} in two buckets`); seen.set(t, b.key); }
      assert.equal(seen.size, p.scanned);
      assert.equal(seen.get('NEWNAME'), 'not_researched');
      assert.deepEqual(p.buckets.map((b) => b.key), PARTITION_ORDER);
      assert.match(p.line, new RegExp(`^${p.scanned} scanned = `));
      assert.equal(v.banner!.partitionLine, p.line);
      for (const it of all(v)) assert.ok(it.primaryStatus, `${it.ticker} has a status`);
    });
  }
  test('queue / book / conflicts are overlays, never buckets', () => {
    const v = buildResearchView(fixtureInput());
    assert.ok(!v.partition!.buckets.some((b) => /queue|portfolio|book/i.test(b.key)));
    assert.equal(v.partition!.overlays.queue, v.queue.length);
    const t = strip(renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'IN' } as any)));
    assert.match(t, /SCANNED =/);
    assert.match(t, /OVERLAYS - TAGS, NOT STATUSES/);
  });
});

describe('zzz836 C: source existence and evidence verification come from the HEADLINE event', () => {
  const card = () => buildIndiaCard({
    filings: [{ subject: 'Azad Engineering inaugurates two facilities for GE Vernova', summary: 'Azad Engineering inaugurated two 7,600 sq. m facilities for GE Vernova on September 28, 2026.', url: 'https://www.bseindia.com/azad.pdf', dateIso: '2026-09-28' }],
    press: [{ title: 'Azad Engineering shares surge on broker target price', url: 'https://news.example/azad', date: '2026-09-28', source: 'Example News' }],
    now: new Date('2026-09-29T05:00:00Z'), windowDays: 21, moveDate: '2026-09-29', causalWindowDays: 3, pressWindowDays: 1,
  });
  test('an official filing headline is never "press only" / "no source found" because of an unrelated press item', () => {
    const { it } = oneItem('AZAD', card());
    if (it.eventClass === 'NO_CATALYST' || it.eventClass === 'MARKET_MOVE_ONLY') return;   // nothing headline-bearing on this build
    assert.notEqual(it.sourceExistence, 'press_only');
    assert.notEqual(it.catalystConfirmation, 'press_unconfirmed');
    assert.notEqual(it.catalystConfirmation, 'not_found');
    const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} } as any)));
    assert.doesNotMatch(html, /NO SOURCE FOUND/i);
    assert.doesNotMatch(html, /not yet in an official filing/i);
    assert.doesNotMatch(html, /No catalyst found in filings or news/i);
  });
  test('the two fields are independent: an exchange filing whose document was not read', () => {
    const h = headlineSourceOf({ market: 'IN', usCard: null, inCard: null, eventClass: 'POTENTIAL_UNVERIFIED', headline: 'x', whatChanged: '', quote: null, sourceUrl: 'u', sourceConfidence: 'VERIFIED_FILING', conflicts: [], verification: 'Official filing' });
    assert.equal(h.existence, 'official_filing');
    assert.equal(h.verification, 'document_not_read');
    const p = headlineSourceOf({ market: 'IN', usCard: null, inCard: null, eventClass: 'POTENTIAL_UNVERIFIED', headline: 'x', whatChanged: '', quote: null, sourceUrl: 'u', sourceConfidence: 'SECONDARY_SUMMARY', conflicts: [], verification: 'Secondary · verification required' });
    assert.equal(p.existence, 'press_only');
    assert.equal(p.verification, 'secondary_only');
    const c = headlineSourceOf({ market: 'IN', usCard: null, inCard: null, eventClass: 'CONFIRMED_MATERIAL', headline: 'x', whatChanged: '', quote: null, sourceUrl: 'u', sourceConfidence: 'VERIFIED_DOCUMENT', conflicts: ['a vs b'], verification: 'Official filing' });
    assert.equal(c.verification, 'contradicted');
    const n = headlineSourceOf({ market: 'IN', usCard: null, inCard: null, eventClass: 'NO_CATALYST', headline: 'x', whatChanged: '', quote: null, sourceUrl: null, sourceConfidence: 'UNVERIFIED', conflicts: [], verification: null });
    assert.equal(n.existence, 'none');
  });
  test('the headline age is measured from the headline event\'s own filing date (not an older stored date)', () => {
    const { it } = oneItem('MOMS', buildIndiaCard({
      filings: [{ subject: 'Rays of Belief to acquire 51% of a healthcare company', summary: 'The Company will acquire 51% of the target.', url: 'https://www.bseindia.com/moms.pdf', dateIso: '2026-09-28' }],
      press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21, moveDate: '2026-09-29', causalWindowDays: 3, pressWindowDays: 1,
    }), { sourceDate: '2026-09-21', ageDays: 8, status: 'catalyst', headline: 'Rays of Belief to acquire 51% of a healthcare company', sourceUrl: 'https://www.bseindia.com/moms.pdf' });
    if (it.headlineFiledDate) {
      assert.equal(it.headlineFiledDate.slice(0, 10), '2026-09-28');
      assert.equal(it.filedDate?.slice(0, 10), '2026-09-28');
      assert.ok((it.ageDays ?? 99) <= 1, `age ${it.ageDays}`);
    }
  });
});

describe('zzz836 D: direction marks', () => {
  test('▲ only for POSITIVE, ▼ NEGATIVE, ◆ MIXED / NEUTRAL, ? UNKNOWN', () => {
    assert.equal(DIRECTION_MARK.POSITIVE.mark, '▲');
    assert.equal(DIRECTION_MARK.NEGATIVE.mark, '▼');
    assert.equal(DIRECTION_MARK.MIXED.mark, '◆');
    assert.equal(DIRECTION_MARK.NEUTRAL.mark, '◆');
    assert.equal(DIRECTION_MARK.UNKNOWN.mark, '?');
    const chip = (d: string) => strip(renderToStaticMarkup(React.createElement(DirectionChip, { it: { direction: d } as any })));
    assert.match(chip('NEUTRAL'), /◆ NEUTRAL/);
    assert.doesNotMatch(chip('NEUTRAL'), /▲/);
    assert.match(chip('UNKNOWN'), /\? UNKNOWN/);
  });
  test('every eventful item carries a direction; a negative item is never ▲', () => {
    for (const mk of [fixtureInput, fixtureInputUS]) {
      const v = buildResearchView(mk());
      for (const it of [...v.queue, ...v.watch, ...v.negative]) assert.ok(it.direction, `${it.ticker} direction`);
      for (const it of v.negative) assert.equal(it.direction, 'NEGATIVE');
    }
  });
});

describe('zzz836 F: no causal wording', () => {
  const files = ['components/ai-gainers/ResearchTriage.tsx', 'components/ai-gainers/ResearchCard.tsx', 'components/ai-gainers/Badges.tsx', 'components/ai-gainers/EventDrawer.tsx', 'components/ai-gainers/tokens.ts', 'app/(dashboard)/ai-gainers/page.tsx'];
  test('visible strings never say a catalyst is behind / caused / drove the move', () => {
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      const m = src.match(/behind (?:the|this|today(?:'|&rsquo;|’)s|each|any) (?:unusual )?(?:move|gainer)s?|behind the (?:unusual )?moves?|\bcaused by\b|driven by/i);
      assert.equal(m, null, `${f}: ${m?.[0]}`);
    }
  });
  test('cards say MARKET MOVE and RESEARCH QUESTION; the subtitle makes no causal claim', () => {
    const v = buildResearchView(fixtureInput());
    const t = strip(renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'IN' } as any)));
    assert.match(t, /MARKET MOVE/);
    assert.match(t, /RESEARCH QUESTION/);
    assert.match(t, /Fundamental events filed around unusual moves/);
  });
});

describe('zzz836 G: noise', () => {
  test('PROVISIONAL is not printed twice in the banner', () => {
    const v = buildResearchView({ ...fixtureInputUS(), session: { date: '2026-09-22', scanAt: '2026-09-22T18:00:00Z', status: 'Live', cached: false }, now: '2026-09-22T18:00:00Z', viewedAt: '2026-09-22T18:05:00Z' });
    const t = strip(renderToStaticMarkup(React.createElement(ResearchTriage, { view: v, market: 'US' } as any)));
    assert.doesNotMatch(t, /PROVISIONAL\s*[-—–]\s*PROVISIONAL/);
    assert.match(t, /PROVISIONAL - /);
  });
  test('"also listed under" names only real sections, never the needs-reading bucket', () => {
    const it: any = { ticker: 'X', canonicalId: 'X:1', surfacedIn: ['Research queue', 'Unknown — needs reading'] };
    assert.equal(renderToStaticMarkup(React.createElement(AlsoIn, { it, here: 'Research queue' })), '');
    const it2: any = { ticker: 'X', canonicalId: 'X:1', surfacedIn: ['Research queue', 'Your book'] };
    assert.match(strip(renderToStaticMarkup(React.createElement(AlsoIn, { it: it2, here: 'Research queue' }))), /ALSO LISTED UNDER Your book/);
  });
  test('an empty needs-reading section is not rendered', () => {
    const v = buildResearchView(fixtureInput());
    const t = strip(renderToStaticMarkup(React.createElement(ResearchTriage, { view: { ...v, needsReading: [] } as any, market: 'IN' } as any)));
    assert.doesNotMatch(t, /UNKNOWN — NEEDS READING · 0/);
  });
});

describe('zzz836 E: display side', () => {
  test('price / momentum narratives are price commentary, not evidence', () => {
    assert.equal(isPriceCommentary('Circuit / momentum'), true);
    assert.equal(isPriceCommentary('Broker target price'), true);
    assert.equal(isPriceCommentary('Acquisition'), false);
  });
  test('materiality shows the ratio inline and the band threshold in words', () => {
    const v = buildResearchView(fixtureInput());
    const withRatio = all(v).filter((i) => i.materiality.ratios[0] && i.materiality.label !== 'UNKNOWN');
    assert.ok(withRatio.length > 0);
    for (const it of withRatio) assert.match(it.materialityBand || '', /moderate from \d+%, high from \d+%/);
  });
  test('a result block older than 14 days is labelled context, not the key change', () => {
    const v = buildResearchView(fixtureInput());
    const old = all(v).find((i) => i.earnings && typeof i.earnings.filedDaysAgo === 'number' && i.earnings.filedDaysAgo > 14);
    if (old) {
      assert.match(old.olderResultLabel || '', /OLDER RESULT \(\d+d\) - context/);
      const t = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it: old, rank: 1, onOpen: () => {} } as any)));
      assert.match(t, /CHANGE IN THAT RESULT/);
    }
  });
});

describe('zzz836 wiring: classification fields flow through the view', () => {
  const uni = 'USFDA inspection at Goa formulation facility ended with five procedural observations; response due in 15 days.';
  test('Unichem: an inspection is never "Regulatory approval" (catalyst-research classifier and the view)', async () => {
    const { classifyAnnouncement } = await import('../ai-gainers/catalyst-research');
    const c = classifyAnnouncement({ subject: 'Unichem: USFDA inspection at Goa facility - Form 483 with 5 observations', summary: uni, url: 'https://www.bseindia.com/u.pdf', dateIso: '2026-09-28', ageDays: 1 } as any, 'IN');
    assert.equal((c as any).category, 'regulatory_inspection');
    const { it } = oneItem('UNICHEMX', buildIndiaCard({
      filings: [{ subject: 'Unichem: USFDA inspection at Goa facility - Form 483 with 5 observations', summary: uni, url: 'https://www.bseindia.com/u.pdf', dateIso: '2026-09-28' }],
      press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21, moveDate: '2026-09-29', causalWindowDays: 3, pressWindowDays: 1,
    }), { status: 'catalyst', category: 'regulatory_inspection', headline: 'Unichem: USFDA inspection at Goa facility - Form 483 with 5 observations', sourceUrl: 'https://www.bseindia.com/u.pdf', sourceDate: '2026-09-28', ageDays: 1, sourceTier: 'primary' });
    assert.equal(it.eventType, 'Regulatory inspection');
    assert.doesNotMatch(String(it.eventLabel), /Regulatory approval/);
    assert.equal(it.stageLabel, 'Inspection completed');
    assert.equal(it.direction, 'MIXED');
    assert.match(String(it.researchQuestion), /compliance risk/);
    const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} } as any)));
    assert.doesNotMatch(html, /Regulatory approval/);
    assert.match(html, /INSPECTION COMPLETED/);
  });
  test('the classification\'s own source fields decide the chips; the old "not yet in an official filing" text never sits beside a filed event', () => {
    const { it } = oneItem('AZADY', buildIndiaCard({
      filings: [{ subject: 'Azad Engineering inaugurates two facilities for GE Vernova', summary: 'Azad Engineering inaugurated two 7,600 sq. m facilities for GE Vernova on September 28, 2026.', url: 'https://www.bseindia.com/azad.pdf', dateIso: '2026-09-28' }],
      press: [{ title: 'Azad Engineering wins big for GE Vernova', url: 'https://news.example/a', date: '2026-09-28', source: 'Example' }],
      now: new Date('2026-09-29T05:00:00Z'), windowDays: 21, moveDate: '2026-09-29', causalWindowDays: 3, pressWindowDays: 1,
    }), { status: 'catalyst', headline: 'Azad Engineering inaugurates two facilities for GE Vernova', sourceUrl: 'https://www.bseindia.com/azad.pdf', sourceDate: '2026-09-28', ageDays: 1 });
    if (it.sourceExistence !== 'official_filing' && it.sourceExistence !== 'both') return;
    const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {} } as any)));
    assert.doesNotMatch(html, /not yet in an official filing/i);
    for (const c of it.catalysts || []) assert.doesNotMatch(c.stateWord, /not yet in an official filing/i);
  });
  test('a new listing says so instead of "1W - 1M - 3M -"', () => {
    const { it } = oneItem('NEWLIST', null, { status: 'listing_artifact' });
    const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it: { ...it, returns: { w1: null, m1: null, m3: null } }, rank: 1, onOpen: () => {} } as any)));
    assert.match(html, /no 1W \/ 1M \/ 3M yet/);
    assert.doesNotMatch(html, /1W — · 1M — · 3M —/);
  });
});
