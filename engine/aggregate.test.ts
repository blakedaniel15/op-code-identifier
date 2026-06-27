import { aggregateRows } from './aggregate';

test('aggregates rows by op code with description counts and numeric values', () => {
  const items = aggregateRows([
    { opCode: 'A4', description: '4 WHEEL ALIGNMENT', laborSale: '$159.95', techHours: '1.0' },
    { opCode: 'A4', description: '4 WHEEL ALIGNMENT', laborSale: '159.95', techHours: '1.0' },
    { opCode: 'WBF', description: 'BRAKE FLUID EXCHANGE', laborSale: '122.00', techHours: '1.0' },
  ], 'deacon');
  const a4 = items.find((i) => i.opCode === 'A4')!;
  expect(a4.rowCount).toBe(2);
  expect(a4.descriptions).toEqual([{ text: '4 WHEEL ALIGNMENT', count: 2 }]);
  expect(a4.laborValues).toEqual([159.95, 159.95]);
  expect(a4.dealerKey).toBe('deacon');
  expect(items).toHaveLength(2);
});
