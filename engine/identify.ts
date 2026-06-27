import type { Adjudicator } from './adjudicator';
import type { Item, MenuItem, Verdict } from './types';
import { itemKey } from './types';
import { MENU_ITEMS } from './catalog';
import { exactPass } from './passes/exact';
import { blockPass } from './passes/block';
import { deterministicPass } from './passes/deterministic';
import { preAiFilterPass } from './passes/preAiFilter';
import { reclassifyPass } from './passes/reclassify';

export interface IdentifyOptions {
  catalog?: MenuItem[];
  learned?: Map<string, string>;
  adjudicator: Adjudicator;
  batchSize?: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function identify(items: Item[], opts: IdentifyOptions): Promise<Map<string, Verdict>> {
  const catalog = opts.catalog ?? MENU_ITEMS;
  const learned = opts.learned ?? new Map<string, string>();
  const batchSize = opts.batchSize ?? 25;
  const verdicts = new Map<string, Verdict>();
  const unresolved: Item[] = [];

  for (const item of items) {
    const v = exactPass(item, learned) ?? blockPass(item) ?? deterministicPass(item, catalog) ?? preAiFilterPass(item);
    if (v) verdicts.set(itemKey(item), v);
    else unresolved.push(item);
  }

  for (const batch of chunk(unresolved, batchSize)) {
    const out = await opts.adjudicator.adjudicate(batch);
    batch.forEach((item, i) => {
      const v = out[i] ?? { menuItemId: null, matchType: 'UNMATCHED' as const, confidence: 'LOW' as const, reason: 'Adjudicator returned no verdict.' };
      verdicts.set(itemKey(item), v.matchType === 'UNMATCHED' ? (reclassifyPass(item, catalog) ?? v) : v);
    });
  }
  return verdicts;
}
