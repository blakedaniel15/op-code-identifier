import { preAiFilterPass } from './preAiFilter';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 4 }], laborValues: [], hoursValues: [], rowCount: 4 });

test('filters a component replacement', () => {
  expect(preAiFilterPass(mk('REPLACE WATER PUMP'))?.matchType).toBe('UNMATCHED');
});
test('filters pure labor', () => {
  expect(preAiFilterPass(mk('SHOP LABOR CHARGE'))?.matchType).toBe('UNMATCHED');
});
test('leaves an ambiguous fluid description for the adjudicator', () => {
  expect(preAiFilterPass(mk('SYSTEM FLUSH SERVICE'))).toBeNull();
});
