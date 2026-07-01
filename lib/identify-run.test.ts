import { identifyRun } from './identify-run';
import type { Item } from '@/engine/types';
import type { Adjudicator } from '@/engine/adjudicator';
const mk = (op: string, desc: string, labor = [160,160], hours = [1,1]): Item => ({
  dealerKey: 'citrus', opCode: op, descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length });
test('learned op code resolves EXACT; unknown is classified by the engine', async () => {
  const rows = await identifyRun(
    [mk('ZZ', 'MYSTERY'), mk('A4', '4 WHEEL ALIGNMENT')],
    new Map([['citrus::ZZ', 'coolant']]));
  const zz = rows.find(r => r.opCode === 'ZZ')!;
  const a4 = rows.find(r => r.opCode === 'A4')!;
  expect(zz).toMatchObject({ matchType: 'EXACT', menuItemId: 'coolant' });
  expect(a4).toMatchObject({ matchType: 'RULE', menuItemId: 'alignment' });
});
test('result rows are PII-free (op fields + verdict + stats only)', async () => {
  const [row] = await identifyRun([mk('A4', '4 WHEEL ALIGNMENT')], new Map());
  expect(Object.keys(row!).sort()).toEqual(
    ['opCode','confidence','hoursMean','laborMean','matchType','menuItemId','quantity','reason','repetition','rowCount','topDescription'].sort());
});

test('an injected adjudicator classifies the unresolved op codes', async () => {
  const it = { dealerKey: 'd', opCode: 'ZZ', descriptions: [{ text: 'MYSTERY CODE', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 };
  const adj: Adjudicator = { async adjudicate(items) { return items.map(() => ({ menuItemId: 'coolant', matchType: 'AI' as const, confidence: 'MEDIUM' as const, reason: 'ai' })); } };
  const rows = await identifyRun([it], new Map(), adj);
  const zz = rows.find((r) => r.opCode === 'ZZ')!;
  expect(zz).toMatchObject({ matchType: 'AI', menuItemId: 'coolant', confidence: 'MEDIUM' });
});
