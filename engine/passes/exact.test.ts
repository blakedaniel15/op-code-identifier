import { exactPass } from './exact';
import type { Item } from '../types';

const item: Item = { dealerKey: 'deacon', opCode: 'WBF', descriptions: [], laborValues: [], hoursValues: [], rowCount: 3 };

test('returns EXACT verdict for a learned mapping', () => {
  const v = exactPass(item, new Map([['deacon::WBF', 'brake_fluid']]));
  expect(v).toMatchObject({ menuItemId: 'brake_fluid', matchType: 'EXACT', confidence: 'EXACT' });
});
test('returns null when not learned', () => {
  expect(exactPass(item, new Map())).toBeNull();
});
