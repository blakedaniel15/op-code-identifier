import { normalizeForComparison, tokenize, dominantCluster } from './normalize';

test('expands a/c and strips numbers/punctuation', () => {
  expect(normalizeForComparison('Recharge A/C $69.95')).toBe('recharge ac');
  expect(normalizeForComparison('4 WHEEL ALIGNMENT')).toBe('wheel alignment');
});

test('tokenize drops stopwords and applies synonyms', () => {
  expect(tokenize('REPLACE FUEL INJECTION SERVICE')).toEqual(['fuel', 'injector']);
});

test('dominantCluster picks the most repeated normalized description', () => {
  const d = dominantCluster([
    { text: 'REPLACE CABIN FILTER = $69.95', count: 3 },
    { text: 'REPLACE CABIN FILTER = $55.00', count: 2 },
    { text: 'CONFIRM FRAME VIN', count: 1 },
  ]);
  expect(d.normalized).toBe('replace cabin filter');
  expect(d.count).toBe(5);
  expect(d.uniqueNormalized).toBe(2);
});
