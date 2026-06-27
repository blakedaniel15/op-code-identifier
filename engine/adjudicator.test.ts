import { RecordedAdjudicator } from './adjudicator';
import type { Item } from './types';

const item = (op: string): Item => ({ dealerKey: 'd', opCode: op, descriptions: [], laborValues: [], hoursValues: [], rowCount: 1 });

test('returns recorded verdicts in input order, UNMATCHED when missing', async () => {
  const adj = new RecordedAdjudicator(new Map([
    ['d::A', { menuItemId: 'coolant', matchType: 'AI', confidence: 'MEDIUM', reason: 'recorded' }],
  ]));
  const out = await adj.adjudicate([item('A'), item('B')]);
  expect(out[0]!.menuItemId).toBe('coolant');
  expect(out[1]!.matchType).toBe('UNMATCHED');
});
