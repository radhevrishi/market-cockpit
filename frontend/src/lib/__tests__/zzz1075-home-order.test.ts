// zzz1075 — home page order (owner request): status strip → 🔥 In-Play News → 📡 Signals → everything else as before.
// The panels are moved, not rewritten: same data, same logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('In-Play News, then Signals, come right after the status strip', () => {
  const s = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'page.tsx'), 'utf8');
  const strip = s.indexOf('<HomeStatusStrip now={now} />');
  const inPlay = s.indexOf('🔥 IN-PLAY NEWS — top');
  const signals = s.indexOf('📡 SIGNALS (');
  const next = s.indexOf('<NextBestActions />');
  const inbox = s.indexOf('<DailySignalInbox />');
  const movers = s.indexOf('<UsMovers />');
  assert.ok(strip > 0 && inPlay > strip && signals > inPlay, 'strip → in-play → signals');
  assert.ok(next > signals && inbox > signals && movers > signals, 'the rest follows');
  assert.equal(s.split('📡 SIGNALS (').length - 1, 1, 'one Signals panel');
  assert.equal(s.split('🔥 IN-PLAY NEWS — top').length - 1, 1, 'one In-Play panel');
});

test('zzz1082: Favourites sit right under In-Play News and before Signals', () => {
  const s = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'page.tsx'), 'utf8');
  const inPlay = s.indexOf('🔥 IN-PLAY NEWS — top');
  const fav = s.indexOf('data-home-section="favourites"');
  const sig = s.indexOf('📡 SIGNALS (');
  assert.ok(inPlay > 0 && fav > inPlay && sig > fav, 'order: In-Play → Favourites → Signals');
  assert.equal(s.split('<FavouritesGrid />').length - 1, 1, 'shown once');
});
