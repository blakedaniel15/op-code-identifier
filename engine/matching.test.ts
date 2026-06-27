import { evaluateMenuItem, detectTireQuantity } from './matching';
import type { MenuItem } from './types';

const brakeFluid: MenuItem = {
  id: 'brake_fluid', name: 'Brake Fluid',
  required: ['BRAKE'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE'],
  disqualify: ['PAD', 'ROTOR', 'CALIPER'],
};

test('full keyword match', () => {
  expect(evaluateMenuItem('BRAKE FLUID EXCHANGE', brakeFluid)).toBe('match');
});
test('disqualifier blocks a pad job even though BRAKE is present', () => {
  expect(evaluateMenuItem('REPLACE BRAKE PADS', brakeFluid)).toBe('disqualified');
});
test('only one gate satisfied is partial', () => {
  expect(evaluateMenuItem('BRAKE INSPECTION', brakeFluid)).toBe('partial');
});
test('no signal is none', () => {
  expect(evaluateMenuItem('ROTATE TIRES', brakeFluid)).toBe('none');
});
test('detectTireQuantity reads count from raw text', () => {
  expect(detectTireQuantity('MOUNT AND BALANCE 4 TIRES')).toBe(4);
  expect(detectTireQuantity('MOUNT ONE TIRE')).toBe(1);
  expect(detectTireQuantity('TIRE ROTATION')).toBeNull();
});
