import type { Item } from '@/engine/types';
import { itemKey } from '@/engine/types';
export function splitGap(items: Item[], learned: Map<string, string>): { learnedItems: Item[]; toClassify: Item[] } {
  const learnedItems: Item[] = [], toClassify: Item[] = [];
  for (const it of items) (learned.has(itemKey(it)) ? learnedItems : toClassify).push(it);
  return { learnedItems, toClassify };
}
