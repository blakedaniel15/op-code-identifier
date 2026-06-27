import type { Item, Verdict } from '../types';
import { itemKey } from '../types';

export function exactPass(item: Item, learned: Map<string, string>): Verdict | null {
  const menuItemId = learned.get(itemKey(item));
  if (!menuItemId) return null;
  return {
    menuItemId, matchType: 'EXACT', confidence: 'EXACT',
    reason: `Learned mapping for ${item.dealerKey} op code ${item.opCode}.`,
  };
}
