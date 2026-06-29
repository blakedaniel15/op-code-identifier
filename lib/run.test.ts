import { runId, parseRunId, serviceLinesToItems } from './run';
test('runId round-trips store+batch', () => {
  expect(runId('citrus', 'b1')).toBe('citrus|b1');
  expect(parseRunId('citrus|b1')).toEqual({ storeId: 'citrus', batchId: 'b1' });
});
test('aggregates service_lines by op_code into engine Items keyed by store_id', () => {
  const items = serviceLinesToItems([
    { store_id: 'citrus', op_code: 'A4', op_description: '4 WHEEL ALIGNMENT', labor_sale: '159.95', tech_hours: '1.0' },
    { store_id: 'citrus', op_code: 'A4', op_description: '4 WHEEL ALIGNMENT', labor_sale: '159.95', tech_hours: '1.0' },
    { store_id: 'citrus', op_code: 'WBF', op_description: 'BRAKE FLUID EXCHANGE', labor_sale: '122.00', tech_hours: '1.0' },
  ]);
  const a4 = items.find(i => i.opCode === 'A4')!;
  expect(a4.dealerKey).toBe('citrus');
  expect(a4.rowCount).toBe(2);
  expect(a4.descriptions).toEqual([{ text: '4 WHEEL ALIGNMENT', count: 2 }]);
  expect(a4.laborValues).toEqual([159.95, 159.95]);
  expect(items).toHaveLength(2);
});
