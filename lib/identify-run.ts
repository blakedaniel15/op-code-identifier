import { identify } from '@/engine/identify';
import { RecordedAdjudicator, type Adjudicator } from '@/engine/adjudicator';
import { MENU_ITEMS } from '@/engine/catalog';
import { dominantCluster } from '@/engine/normalize';
import { itemKey, type Item } from '@/engine/types';

export interface ResultRow {
  opCode: string; topDescription: string; matchType: string; confidence: string;
  menuItemId: string | null; quantity?: number; reason: string; rowCount: number;
  repetition: number | null; laborMean: number | null; hoursMean: number | null;
}
const mean = (v: number[]) => { const c = v.filter((x) => Number.isFinite(x) && x > 0); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };

export async function identifyRun(
  items: Item[],
  learned: Map<string, string>,
  adjudicator: Adjudicator = new RecordedAdjudicator(new Map()),
  batchSize = 30,
): Promise<ResultRow[]> {
  const verdicts = await identify(items, { learned, adjudicator, catalog: MENU_ITEMS, batchSize });
  return items.map((it) => {
    const v = verdicts.get(itemKey(it))!;
    return {
      opCode: it.opCode, topDescription: dominantCluster(it.descriptions).raw,
      matchType: v.matchType, confidence: v.confidence, menuItemId: v.menuItemId,
      quantity: v.quantity, reason: v.reason, rowCount: it.rowCount,
      repetition: null, laborMean: mean(it.laborValues), hoursMean: mean(it.hoursValues),
    };
  });
}
