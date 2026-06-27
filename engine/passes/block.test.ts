import { blockPass } from './block';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 5 }], laborValues: [], hoursValues: [], rowCount: 5 });

test('blocks oil change', () => {
  expect(blockPass(mk('LUBE OIL FILTER'))?.matchType).toBe('UNMATCHED');
});
test('blocks multipoint inspection', () => {
  expect(blockPass(mk('MULTIPOINT INSPECTION'))?.matchType).toBe('UNMATCHED');
});
test('does not block a real service', () => {
  expect(blockPass(mk('BRAKE FLUID EXCHANGE'))).toBeNull();
});
