// zzz858 — Special Situations: not-yet-checked events are shown (marked) instead of an empty page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nothingVerifiedBanner, aiRunPhrase } from '../../components/special-situations/ss-counts';
import { pendingMapOf } from '../../components/special-situations/pending-context';

test('banner names the shown-but-not-checked events and the next run', () => {
  const t = nothingVerifiedBanner({ shown: 120 } as any, { available: true, lastRunAt: null, nextRunEta: '2026-10-02T09:35:00.000Z', shownNotChecked: 100, awaiting: 20 } as any, 20);
  assert.ok(t && t.includes('100 of the 120 events shown are not checked yet'));
  assert.ok(t!.includes('next run ~09:35 UTC'));
});

test('next run is read from nextRunEta (was shown as unknown)', () => {
  assert.match(aiRunPhrase({ available: true, lastRunAt: null, nextRunEta: '2026-10-02T09:35:00.000Z' } as any), /not run yet, next run ~09:35 UTC/);
});

test('strict banner unchanged when nothing is shown', () => {
  const t = nothingVerifiedBanner({ shown: 0 } as any, { available: true, lastRunAt: null, awaiting: 5 } as any, 5);
  assert.match(t || '', /^Nothing verified yet\. 5 items/);
});

test('pending map: only shown events with verification_pending, never held-back ones', () => {
  const m = pendingMapOf([
    { event_id: 'a', verification_pending: { reason: 'queued', reasonText: 'Not checked yet' } },
    { event_id: 'b' },
    { event_id: 'c', verification_pending: { reason: 'queued' }, quarantine_reason: 'AWAITING_VERIFICATION' },
  ]);
  assert.deepEqual([...m.keys()], ['a']);
});
