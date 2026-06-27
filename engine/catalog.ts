import type { MenuItem } from './types';

export const MENU_ITEMS: MenuItem[] = [
  { id: 'alignment', name: 'Alignment', required: ['ALIGN'], requiredAlso: [], disqualify: ['SENSOR', 'CAMERA', 'STEERING WHEEL', 'CALIBRAT'] },
  { id: 'air_filter', name: 'Air Filter', required: ['ENGINE FILTER', 'AIR FILTER', 'ENGINE AIR'], requiredAlso: [], disqualify: ['CABIN'] },
  { id: 'cabin_filter', name: 'Cabin Filter', required: ['CABIN', 'MICROFILTER'], requiredAlso: [], disqualify: ['ENGINE'] },
  { id: 'brake_fluid', name: 'Brake Fluid', required: ['BRAKE', 'BRK'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE', 'BLEED'], disqualify: ['PAD', 'ROTOR', 'CALIPER', 'SHOE', 'HARDWARE'] },
  { id: 'transmission', name: 'Transmission', required: ['TRANSMISSION', 'ATF', 'CVT'], requiredAlso: ['FLUID', 'EXCHANGE', 'FLUSH', 'SERVICE', 'DRAIN'], disqualify: ['REBUILD', 'OVERHAUL', 'MOUNT', 'SOLENOID'] },
  { id: 'coolant', name: 'Coolant', required: ['COOLANT', 'COOLING', 'RADIATOR'], requiredAlso: ['FLUSH', 'EXCHANGE', 'SERVICE', 'FILL', 'DRAIN'], disqualify: ['HOSE', 'PUMP', 'LEAK', 'THERMOSTAT'] },
  { id: 'fuel_service', name: 'Fuel Service', required: ['FUEL', 'INDUCTION', 'INJECTOR', 'GDI'], requiredAlso: ['SERVICE', 'CLEAN', 'FLUSH', 'INDUCTION'], disqualify: ['PUMP', 'FILTER', 'TANK', 'SENDER', 'LINE'] },
  { id: 'rear_diff', name: 'Rear Differential', required: ['REAR DIFF'], requiredAlso: [], disqualify: ['FRONT'] },
  { id: 'front_diff', name: 'Front Differential', required: ['FRONT DIFF'], requiredAlso: [], disqualify: ['REAR'] },
  { id: 'transfer_case', name: 'Transfer Case', required: ['TRANSFER CASE', 'TCASE'], requiredAlso: ['FLUID', 'SERVICE', 'FLUSH', 'EXCHANGE', 'DRAIN'], disqualify: ['REBUILD'] },
  { id: 'power_steering', name: 'Power Steering', required: ['POWER STEERING', 'PSF'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE', 'SERVICE'], disqualify: ['PUMP', 'RACK', 'HOSE', 'PINION', 'LEAK'] },
  { id: 'awd', name: 'All Wheel Drive', required: ['ALL WHEEL DRIVE', 'AWD', 'DRIVELINE', 'FOUR WHEEL DRIVE'], requiredAlso: ['SERVICE', 'FLUID'], disqualify: ['REBUILD'] },
  { id: 'ac_service', name: 'AC Service', required: ['FRIGIFRESH', 'AC REFRESH', 'AC RECHARGE', 'EVAPORATOR', 'REFRIGERANT'], requiredAlso: [], disqualify: ['COMPRESSOR', 'CONDENSER', 'LINE', 'REPAIR', 'DIAGNOSE'] },
  { id: 'tire', name: 'Tire Service', required: ['TIRE'], requiredAlso: ['MOUNT', 'BALANCE', 'INSTALL'], disqualify: ['ROTATE', 'ROTATION', 'TPMS', 'PRESSURE', 'REPAIR', 'PATCH', 'FLAT', 'SPARE', 'NITROGEN', 'STEM'], isTire: true },
  { id: 'service_packages', name: 'Service Packages', required: ['SCHEDULED MAINTENANCE', 'FACTORY SCHEDULED', 'MAINTENANCE PACKAGE', 'SERVICE PACKAGE', 'MAINTENANCE MINDER', 'MINDER'], requiredAlso: [], disqualify: [] },
];

const TIRE_PLURAL: Record<number, string> = { 1: '1 Tire', 2: '2 Tires', 3: '3 Tires', 4: '4 Tires' };

export function getMenuItem(id: string): MenuItem | undefined {
  return MENU_ITEMS.find((m) => m.id === id);
}

export function businessLabel(menuItemId: string, quantity?: number): string {
  const item = getMenuItem(menuItemId);
  if (item?.isTire && quantity && TIRE_PLURAL[quantity]) return TIRE_PLURAL[quantity];
  return item?.name ?? menuItemId;
}
