import { seedDecisions, bucketFilter } from './results-table';
test('seedDecisions keeps approve/reject/correct (all real outcomes)', () => {
  expect(seedDecisions({ A4: 'approve', WBF: 'reject', X: 'correct', Y: 'bogus' })).toEqual({ A4: 'approve', WBF: 'reject', X: 'correct' });
});
test('bucketFilter buckets a row by matchType/confidence', () => {
  expect(bucketFilter({ matchType: 'RULE', confidence: 'HIGH' })).toBe('matched');
  expect(bucketFilter({ matchType: 'AI', confidence: 'LOW' })).toBe('review');
  expect(bucketFilter({ matchType: 'UNMATCHED', confidence: 'LOW' })).toBe('unmatched');
});
