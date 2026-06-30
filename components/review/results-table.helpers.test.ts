import { pickYesNo, bucketFilter } from './results-table';

test('pickYesNo keeps only approve/reject outcomes', () => {
  expect(pickYesNo({ A4: 'approve', WBF: 'reject', X: 'correct' })).toEqual({
    A4: 'approve',
    WBF: 'reject',
  });
});

test('bucketFilter buckets a row by matchType/confidence', () => {
  expect(bucketFilter({ matchType: 'RULE', confidence: 'HIGH' })).toBe('matched');
  expect(bucketFilter({ matchType: 'AI', confidence: 'LOW' })).toBe('review');
  expect(bucketFilter({ matchType: 'UNMATCHED', confidence: 'LOW' })).toBe('unmatched');
});
