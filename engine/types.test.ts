import { itemKey } from './types';
test('itemKey joins dealer and op code', () => {
  expect(itemKey({ dealerKey: 'deacon', opCode: 'A4' })).toBe('deacon::A4');
});
