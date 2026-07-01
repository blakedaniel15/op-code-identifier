import { buildSystemPrompt, buildUserBatch } from './prompt';
import { MENU_ITEMS } from './catalog';
import type { Item } from './types';

test('system prompt carries policy, every catalog id, and the examples', () => {
  const p = buildSystemPrompt(MENU_ITEMS, [{ description: 'BRAKE FLUID EXCHANGE', menuItemId: 'brake_fluid' }]);
  expect(p).toMatch(/primary signal/i);
  expect(p).toMatch(/repair or replacement/i);
  expect(p).toContain('alignment');
  expect(p).toContain('brake_fluid');
  expect(p).toContain('"BRAKE FLUID EXCHANGE" → brake_fluid');
});

test('user batch numbers each line 1-based with op code + description', () => {
  const items: Item[] = [
    { dealerKey: 'd', opCode: 'A4', descriptions: [{ text: '4 WHEEL ALIGNMENT', count: 2 }], laborValues: [], hoursValues: [], rowCount: 2 },
  ];
  const b = buildUserBatch(items);
  expect(b).toContain('1. op_code=A4');
  expect(b).toContain('4 WHEEL ALIGNMENT');
});
