import { splitGap } from './gap';
import type { Item } from '@/engine/types';
const it = (op: string): Item => ({ dealerKey: 'citrus', opCode: op, descriptions: [], laborValues: [], hoursValues: [], rowCount: 1 });
test('partitions items into already-learned vs to-classify by (store,opCode) key', () => {
  const learned = new Map([['citrus::A4', 'alignment']]);
  const { learnedItems, toClassify } = splitGap([it('A4'), it('WBF')], learned);
  expect(learnedItems.map(i => i.opCode)).toEqual(['A4']);
  expect(toClassify.map(i => i.opCode)).toEqual(['WBF']);
});
