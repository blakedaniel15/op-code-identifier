import { deterministicPass } from './deterministic';
import { MENU_ITEMS } from '../catalog';
import type { Item } from '../types';

const mk = (desc: string, labor: number[] = [160, 160], hours: number[] = [1, 1]): Item => ({
  dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('alignment matches RULE and tight stats keep it HIGH', () => {
  const v = deterministicPass(mk('4 WHEEL ALIGNMENT'), MENU_ITEMS)!;
  expect(v).toMatchObject({ menuItemId: 'alignment', matchType: 'RULE', confidence: 'HIGH' });
});
test('tire match carries quantity', () => {
  const v = deterministicPass(mk('MOUNT AND BALANCE 4 TIRES'), MENU_ITEMS)!;
  expect(v.menuItemId).toBe('tire');
  expect(v.quantity).toBe(4);
});
test('brake pad job does not match brake fluid', () => {
  expect(deterministicPass(mk('REPLACE BRAKE PADS'), MENU_ITEMS)).toBeNull();
});
test('scattered stats cap an alignment match to MEDIUM', () => {
  const v = deterministicPass(mk('4 WHEEL ALIGNMENT', [10, 400, 90], [0.2, 5, 1]), MENU_ITEMS)!;
  expect(v.confidence).toBe('MEDIUM');
});
