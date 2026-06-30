import { matchTypeColor } from './chip';
test('bucket-to-color mapping matches the spec', () => {
  expect(matchTypeColor('EXACT')).toBe('exact');
  expect(matchTypeColor('RULE')).toBe('fuzzy');
  expect(matchTypeColor('AI')).toBe('ai');
  expect(matchTypeColor('UNMATCHED')).toBe('unmatched');
});
