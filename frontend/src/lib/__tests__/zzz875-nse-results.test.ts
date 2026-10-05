// zzz875 — NSE financial-results list collected by GitHub, read by the hub before the (refused) direct NSE call.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNseDay, rowBroadcastDay, rowKey, groupRowsByDay, mergeDayRows, mergeCoverage, dayRange, ingestNseResults, readNseResults, NSE_RESULTS_DAY_KEY, NSE_RESULTS_COVERAGE_KEY } from '../nse-results-store';

const now = new Date('2026-10-05T15:00:00Z');
function memKv() {
  const store = new Map<string, any>();
  return { store, get: async <T,>(k: string) => (store.has(k) ? (store.get(k) as T) : null), set: async (k: string, v: any) => { store.set(k, v); }, mget: async <T,>(ks: string[]) => ks.map((k) => (store.has(k) ? (store.get(k) as T) : null)) };
}
const row = (symbol: string, bc: string, seq = '') => ({ symbol, companyName: `${symbol} Ltd`, broadCastDate: bc, seqNumber: seq, toDate: '30-Sep-2026', period: 'Quarterly' });

describe('zzz875 — NSE results store', () => {
  test('dates: NSE formats → ISO day', () => {
    assert.equal(parseNseDay('03-Oct-2026 21:42:15'), '2026-10-03');
    assert.equal(parseNseDay('03-10-2026'), '2026-10-03');
    assert.equal(parseNseDay('2026-10-03T16:12:15'), '2026-10-03');
    assert.equal(parseNseDay('3 Oct 2026'), '2026-10-03');
    assert.equal(parseNseDay(''), null); assert.equal(parseNseDay('n/a'), null);
    assert.equal(rowBroadcastDay({ re_broadcastDt: '04-Oct-2026 10:00:00' }), '2026-10-04');
    assert.equal(rowBroadcastDay({}), null);
  });
  test('row identity prefers the sequence number; rows without a symbol or day are dropped', () => {
    assert.equal(rowKey(row('HAWAENG', '03-Oct-2026 21:42:15', '12345')), 'HAWAENG|12345');
    assert.equal(rowKey(row('hiil', '03-Oct-2026 20:00:00')), 'HIIL|30-Sep-2026|2026-10-03');
    const g = groupRowsByDay([row('HAWAENG', '03-Oct-2026 21:42:15', '1'), row('HIIL', '03-Oct-2026 20:00:00'), { symbol: '', broadCastDate: '03-Oct-2026' }, null, row('X', '')]);
    assert.equal(g.byDay.get('2026-10-03')!.length, 2); assert.equal(g.dropped, 3);
  });
  test('merging a day: a re-read never loses rows, a newer row with the same identity replaces the old', () => {
    const d1 = mergeDayRows(null, '2026-10-03', [row('HAWAENG', '03-Oct-2026 21:42:15', '1'), row('HIIL', '03-Oct-2026 20:00:00', '2')], now);
    const d2 = mergeDayRows(d1, '2026-10-03', [{ ...row('HAWAENG', '03-Oct-2026 21:42:15', '1'), audited: 'Un-Audited' }], now);
    assert.equal(d2.rows.length, 2); assert.equal(d2.rows.find((r) => r.symbol === 'HAWAENG').audited, 'Un-Audited');
  });
  test('coverage keeps read days (zero rows is a real answer) and drops days older than the keep window', () => {
    const c = mergeCoverage({ v: 1, updatedAt: '', days: { '2026-01-01': { rows: 5, at: 'x' } } }, { '2026-10-04': 0, '2026-10-03': 2 }, now);
    assert.deepEqual(Object.keys(c.days).sort(), ['2026-10-03', '2026-10-04']);
    assert.equal(c.days['2026-10-04'].rows, 0);
  });
  test('dayRange is inclusive, oldest first, empty when inverted or too long', () => {
    assert.deepEqual(dayRange('2026-10-03', '2026-10-05'), ['2026-10-03', '2026-10-04', '2026-10-05']);
    assert.deepEqual(dayRange('2026-10-05', '2026-10-03'), []);
    assert.deepEqual(dayRange('2026-01-01', '2026-10-05'), []);
  });
  test('ingest → read: the hub gets the rows of the range and knows which days the collector has not read', async () => {
    const kv = memKv();
    const r = await ingestNseResults(kv, [row('HAWAENG', '03-Oct-2026 21:42:15', '1'), row('HIIL', '03-Oct-2026 20:10:00', '2'), row('ANSALAPI', '03-Oct-2026 19:00:00', '3'), row('LCC', '05-Oct-2026 18:00:00', '4')], ['2026-10-05', '2026-10-04', '2026-10-03'], now);
    assert.deepEqual(r.daysWritten, ['2026-10-03', '2026-10-05']); assert.equal(r.rowsStored, 4); assert.equal(r.dropped, 0);
    assert.equal(kv.store.get(NSE_RESULTS_DAY_KEY('2026-10-03')).rows.length, 3);
    assert.equal(kv.store.get(NSE_RESULTS_COVERAGE_KEY).days['2026-10-04'].rows, 0);
    const got = await readNseResults(kv, '2026-10-01', '2026-10-05');
    assert.equal(got.rows.length, 4);
    assert.deepEqual(got.daysRead, ['2026-10-03', '2026-10-04', '2026-10-05']);
    assert.deepEqual(got.daysMissing, ['2026-10-01', '2026-10-02']);
    assert.ok(got.rows.some((x) => x.symbol === 'HAWAENG' && x.broadCastDate.startsWith('03-Oct-2026')), 'the Saturday filing is there, in NSE\'s own field names');
    const empty = await readNseResults(memKv(), '2026-10-01', '2026-10-05');
    assert.equal(empty.rows.length, 0); assert.equal(empty.daysMissing.length, 5);
  });
});
