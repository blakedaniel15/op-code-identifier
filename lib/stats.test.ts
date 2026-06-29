import { computeStats, bucketOf } from './stats';
const d = (sku: string, matchType: string, confidence: string|null, outcome: string, runId = 'r1') =>
  ({ runId, sku, matchType, confidence, outcome, ts: sku });
test('bucketOf maps matchType/confidence to buckets', () => {
  expect(bucketOf({ matchType: 'RULE', confidence: 'HIGH' })).toBe('matched');
  expect(bucketOf({ matchType: 'AI', confidence: 'LOW' })).toBe('review');
  expect(bucketOf({ matchType: 'AI', confidence: 'HIGH' })).toBe('matched');
  expect(bucketOf({ matchType: 'UNMATCHED', confidence: 'LOW' })).toBe('unmatched');
});
test('10 EXACT-approve + 1 AI/LOW-approve + 1 unmatched-correct => id rate 10/12', () => {
  const decisions = [
    ...Array.from({ length: 10 }, (_, i) => d('E'+i, 'EXACT', 'EXACT', 'approve')),
    d('R1', 'AI', 'LOW', 'approve'), d('U1', 'UNMATCHED', null, 'correct'),
  ];
  const { overall } = computeStats(decisions, [{ runId: 'r1', dealer: 'x', review: 1, total: 12, ranAt: null }]);
  expect(overall.hits).toBe(10); expect(overall.denominator).toBe(12);
  expect(overall.rate).toBeCloseTo(10/12);
});
test('approve then reject same item -> later wins (hits 0, falsePositives 1)', () => {
  const decisions = [ d('X', 'EXACT', 'EXACT', 'approve'), { ...d('X', 'EXACT', 'EXACT', 'reject'), ts: 'zzz' } ];
  const { overall } = computeStats(decisions, []);
  expect(overall.hits).toBe(0); expect(overall.falsePositives).toBe(1);
});
test('snapshot review:2,total:15 with ZERO decisions -> reviewFlagged 2, parts 15', () => {
  const { overall } = computeStats([], [{ runId: 'r1', dealer: 'x', review: 2, total: 15, ranAt: null }]);
  expect(overall.reviewFlagged).toBe(2); expect(overall.parts).toBe(15);
});
