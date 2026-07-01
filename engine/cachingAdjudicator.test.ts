import { CachingAdjudicator, verdictCacheKey } from './cachingAdjudicator';
import type { Adjudicator } from './adjudicator';
import type { Item, Verdict } from './types';

const item = (op: string): Item => ({ dealerKey: 'd', opCode: op, descriptions: [{ text: op + ' DESC', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 });

test('cache hit skips inner; miss calls inner and is written; order preserved', async () => {
  const A = item('A'), B = item('B');
  const keyA = verdictCacheKey(A, 'v16'), keyB = verdictCacheKey(B, 'v16');
  const innerCalls: string[][] = [];
  const inner: Adjudicator = { async adjudicate(items) { innerCalls.push(items.map((i) => i.opCode)); return items.map(() => ({ menuItemId: 'coolant', matchType: 'AI', confidence: 'MEDIUM', reason: 'inner' } as Verdict)); } };
  const cachedA: Verdict = { menuItemId: 'alignment', matchType: 'AI', confidence: 'HIGH', reason: 'cached' };
  const writes: { hash: string; verdict: Verdict }[] = [];
  const adj = new CachingAdjudicator({ inner, catalogVersion: 'v16', getCached: async () => new Map([[keyA, cachedA]]), setCached: async (e) => { writes.push(...e); } });
  const out = await adj.adjudicate([A, B]);
  expect(innerCalls).toEqual([['B']]);
  expect(out[0]).toEqual(cachedA);
  expect(out[1]!.reason).toBe('inner');
  expect(writes.map((w) => w.hash)).toEqual([keyB]);
});

test('cache backend errors are swallowed (still returns verdicts)', async () => {
  const inner: Adjudicator = { async adjudicate(items) { return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: 'x' } as Verdict)); } };
  const adj = new CachingAdjudicator({ inner, catalogVersion: 'v16', getCached: async () => { throw new Error('db'); }, setCached: async () => { throw new Error('db'); } });
  const out = await adj.adjudicate([item('A')]);
  expect(out).toHaveLength(1);
});
