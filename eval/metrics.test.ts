import { classifyOutcome, computeMetrics } from './metrics';
import type { Verdict } from '../engine/types';

const v = (menuItemId: string | null, matchType: Verdict['matchType'], quantity?: number): Verdict =>
  ({ menuItemId, matchType, confidence: 'HIGH', reason: '', quantity });

test('auto RULE match to correct label is a hit', () => {
  expect(classifyOutcome(v('alignment', 'RULE'), 'Alignment')).toBe('hit');
});
test('auto match to wrong label is a false positive', () => {
  expect(classifyOutcome(v('coolant', 'RULE'), 'Alignment')).toBe('falsePositive');
});
test('real service left UNMATCHED is a miss', () => {
  expect(classifyOutcome(v(null, 'UNMATCHED'), 'Alignment')).toBe('miss');
});
test('non-service correctly not auto-identified is a true negative', () => {
  expect(classifyOutcome(v(null, 'UNMATCHED'), null)).toBe('trueNegative');
});
test('tire quantity must match the expected label', () => {
  expect(classifyOutcome(v('tire', 'RULE', 4), '4 Tires')).toBe('hit');
  expect(classifyOutcome(v('tire', 'RULE', 2), '4 Tires')).toBe('falsePositive');
});
test('metrics compute identification and false-positive rates', () => {
  const m = computeMetrics([
    { verdict: v('alignment', 'RULE'), expected: 'Alignment' },
    { verdict: v(null, 'UNMATCHED'), expected: 'Coolant' },
    { verdict: v('coolant', 'RULE'), expected: 'Brake Fluid' },
    { verdict: v(null, 'UNMATCHED'), expected: null },
  ]);
  expect(m.identification).toBeCloseTo(1 / 2);
  expect(m.falsePositive).toBeCloseTo(1 / 2);
});
