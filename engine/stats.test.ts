import { coefficientOfVariation, applyStatsModifier } from './stats';
import type { Item } from './types';

const base = (labor: number[], hours: number[]): Item => ({
  dealerKey: 'd', opCode: 'X', descriptions: [], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('cv is 0 for identical values, null for empty', () => {
  expect(coefficientOfVariation([5, 5, 5])).toBe(0);
  expect(coefficientOfVariation([])).toBeNull();
});
test('tight stats bump MEDIUM to HIGH', () => {
  const r = applyStatsModifier('MEDIUM', base([160, 160, 159], [1, 1, 1]));
  expect(r.confidence).toBe('HIGH');
  expect(r.stats.effect).toBe('bumped');
});
test('scattered stats cap HIGH to MEDIUM', () => {
  const r = applyStatsModifier('HIGH', base([10, 200, 90, 400], [0.2, 3, 1, 5]));
  expect(r.confidence).toBe('MEDIUM');
  expect(r.stats.effect).toBe('capped');
});
