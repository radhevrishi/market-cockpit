import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chanceOf, aiIsCurrent, AI_READ_VERSION, nonEventReason, fixIndiaQuarterLabel, type AiMb, type MbView } from '../transformational/core';

const mb = (score: number): MbView => ({ score, label: score >= 65 ? 'HIGH' : score >= 45 ? 'MEDIUM' : score >= 25 ? 'LOW' : 'UNLIKELY', plus: [], minus: [] });
const ai = (label: AiMb['label'], v?: number): AiMb => ({ label, probabilityPct: 20, why: [], risks: [], verifyNext: [], theme: null, at: '2026-11-18T00:00:00Z', model: null, v });

test('zzz1278 an AI read from the old prompt is not blended; the rules read ranks until it is read again', () => {
  assert.equal(aiIsCurrent(ai('LOW')), false);
  assert.equal(aiIsCurrent(ai('LOW', AI_READ_VERSION)), true);
  assert.deepEqual(chanceOf({ mb: mb(82), ai: ai('LOW') }), { score: 82, label: 'HIGH', from: 'rules' });
  assert.equal(chanceOf({ mb: mb(76), ai: ai('MEDIUM', AI_READ_VERSION) }).label, 'HIGH');   // ROTO-like: rules High + AI Medium
  assert.equal(chanceOf({ mb: mb(82), ai: ai('LOW', AI_READ_VERSION) }).label, 'MEDIUM');
  assert.equal(chanceOf({ mb: mb(40), ai: ai('UNLIKELY', AI_READ_VERSION) }).label, 'LOW');
});

test('zzz1278 the AI prompt judges the company, uses the whole scale, and is versioned', () => {
  const src = readFileSync(join(__dirname, '..', 'transformational', 'ai.ts'), 'utf8');
  assert.doesNotMatch(src, /often say LOW or UNLIKELY/);
  assert.match(src, /Judge the COMPANY/);
  assert.match(src, /v: AI_READ_VERSION/);
  const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'transformational', 'ai', 'route.ts'), 'utf8');
  assert.match(route, /stale/);
});

test('zzz1278 non-events are held back', () => {
  const r = (kind: any, headline: string) => nonEventReason({ kind, headline, whatChanged: null, quote: null });
  assert.match(String(r('ORDERS', 'As filed: "the Board Meeting commenced today at 10:30 AM IST and concluded at 03:45 PM IST"')), /procedural/);
  assert.match(String(r('CAPACITY', 'ICRA upgrades Aye Finance to A+ Stable Outlook from A.')), /credit-rating/);
  assert.match(String(r('CAPACITY', "CareEdge reaffirmed Muthoot Microfin's BB- rating and revised outlook to Positive")), /credit-rating/);
  assert.match(String(r('ORDERS', 'Jupiter Wagons signs MoU with PESA Bydgoszcz to explore passenger rolling stock collaboration')), /MoU/);
  assert.match(String(r('APPROVAL', 'Wockhardt reported Q2 FY27 PAT of Rs 73 crore; revenue rose 24% to Rs 969 crore.')), /results/);
  assert.match(String(r('CAPACITY', 'As filed: "announced its financial results for the quarter and half- year ended September 30"')), /results/);
  assert.match(String(r('ORDERS', 'CDSL Receives Great Place To Work® Certification')), /award|procedural/);
  // real events stay
  assert.equal(r('ORDERS', 'Company awarded Rs. 138.37 Crore contract from MORTH for treatment of landslide locations'), null);
  assert.equal(r('CAPACITY', 'Precision Wires started commercial copper cathode production at Zaroli, Gujarat on 29 Oct 2026.'), null);
  assert.equal(r('APPROVAL', 'USFDA final approval for Olopatadine Hydrochloride Ophthalmic Solution USP, 0.7% (OTC).'), null);
  assert.equal(r('CAPACITY', 'Xpro India reported Q2 FY27 PAT of Rs. 9.5 crore; Barjora line commissioned and UAE installation nears completion.'), null);
});

test('zzz1278 India quarter labels follow the filing date', () => {
  assert.equal(fixIndiaQuarterLabel('Board approved Q2 FY26 results', '2026-11-05'), 'Board approved Q2 FY27 results');
  assert.equal(fixIndiaQuarterLabel('Q2 FY27 result filed', '2026-11-05'), 'Q2 FY27 result filed');
  assert.equal(fixIndiaQuarterLabel('Q4 FY26 results', '2026-05-20'), 'Q4 FY26 results');
  assert.equal(fixIndiaQuarterLabel('Q4 FY25 results', '2026-05-20'), 'Q4 FY26 results');
  assert.equal(fixIndiaQuarterLabel('Q1 FY26 results', '2026-11-05'), 'Q1 FY26 results');   // a different quarter: left alone
});
