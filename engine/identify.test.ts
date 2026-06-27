import { identify } from './identify';
import { RecordedAdjudicator } from './adjudicator';
import type { Adjudicator } from './adjudicator';
import type { Item, Verdict } from './types';
import { itemKey } from './types';

const mk = (op: string, desc: string, labor: number[] = [160, 160], hours: number[] = [1, 1]): Item => ({
  dealerKey: 'd', opCode: op, descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('deterministic match resolves before the adjudicator is consulted', async () => {
  const spy = { calls: 0, async adjudicate(items: Item[]) { this.calls++; return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: '' } as Verdict)); } };
  const out = await identify([mk('A4', '4 WHEEL ALIGNMENT')], { adjudicator: spy as Adjudicator });
  expect(out.get('d::A4')!.menuItemId).toBe('alignment');
  expect(spy.calls).toBe(0);
});

test('learned mapping wins via exact pass', async () => {
  const out = await identify([mk('ZZ', 'MYSTERY CODE')], {
    learned: new Map([['d::ZZ', 'coolant']]),
    adjudicator: new RecordedAdjudicator(new Map()),
  });
  expect(out.get('d::ZZ')!).toMatchObject({ menuItemId: 'coolant', matchType: 'EXACT' });
});

test('batching: 60 unresolved items at batchSize 25 -> 3 bounded batches', async () => {
  const sizes: number[] = [];
  const adj: Adjudicator = { async adjudicate(items) { sizes.push(items.length); return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: '' })); } };
  const items = Array.from({ length: 60 }, (_, i) => mk(`OP${i}`, 'CONFIRM FRAME VIN'));
  await identify(items, { adjudicator: adj, batchSize: 25 });
  expect(sizes).toEqual([25, 25, 10]);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(25);
});
