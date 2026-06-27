import { reclassifyPass } from './reclassify';
import { MENU_ITEMS } from '../catalog';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 2 }], laborValues: [], hoursValues: [], rowCount: 2 });

test('partial brake signal surfaces as AI/LOW review', () => {
  const v = reclassifyPass(mk('BRAKE CONCERN CHECK'), MENU_ITEMS)!;
  expect(v).toMatchObject({ matchType: 'AI', confidence: 'LOW' });
  expect(v.menuItemId).toBe('brake_fluid');
});
test('no signal returns null', () => {
  expect(reclassifyPass(mk('CONFIRM FRAME VIN'), MENU_ITEMS)).toBeNull();
});
