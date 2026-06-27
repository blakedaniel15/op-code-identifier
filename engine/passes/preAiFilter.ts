import type { Item, Verdict } from '../types';
import { dominantCluster } from '../normalize';

const COMPONENT = /(pump|rack|hose|compressor|condenser|caliper|rotor|\bpad\b|solenoid|sensor|actuator|valve|gasket|seal|bearing|belt|alternator|starter)/;
const REPAIR = /(replace|replacement|rebuild|overhaul|\br and r\b|remove and replace|install new)/;
export const REPAIR_PATTERNS: RegExp[] = [
  /shop labor/, /labor charge/, /\bdiagnos/, /tech time/, /sublet/,
];

export function preAiFilterPass(item: Item): Verdict | null {
  const norm = dominantCluster(item.descriptions).normalized;
  if (!norm) return null;
  const isRepair = REPAIR.test(norm) && COMPONENT.test(norm);
  const isLabor = REPAIR_PATTERNS.some((p) => p.test(norm));
  if (isRepair || isLabor) {
    return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: isRepair ? 'Dominant description is a component repair/replacement, not a fluid/menu service.' : 'Dominant description is pure labor/diagnosis.' };
  }
  return null;
}
