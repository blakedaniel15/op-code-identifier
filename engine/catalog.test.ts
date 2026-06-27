import { MENU_ITEMS, getMenuItem, businessLabel } from './catalog';

test('ids and names are unique', () => {
  expect(new Set(MENU_ITEMS.map((m) => m.id)).size).toBe(MENU_ITEMS.length);
  expect(new Set(MENU_ITEMS.map((m) => m.name)).size).toBe(MENU_ITEMS.length);
});
test('brake fluid guards against pad jobs', () => {
  expect(getMenuItem('brake_fluid')!.disqualify).toContain('PAD');
});
test('businessLabel renders tire quantity', () => {
  expect(businessLabel('tire', 1)).toBe('1 Tire');
  expect(businessLabel('tire', 4)).toBe('4 Tires');
  expect(businessLabel('alignment')).toBe('Alignment');
});
