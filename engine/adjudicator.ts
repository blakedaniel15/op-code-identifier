import type { Item, Verdict } from './types';
import { itemKey } from './types';

export interface Adjudicator {
  adjudicate(items: Item[]): Promise<Verdict[]>;
}

export class RecordedAdjudicator implements Adjudicator {
  constructor(private readonly recorded: Map<string, Verdict>) {}
  async adjudicate(items: Item[]): Promise<Verdict[]> {
    return items.map((item) =>
      this.recorded.get(itemKey(item)) ?? {
        menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW',
        reason: 'No recorded adjudication; defaulted to UNMATCHED.',
      });
  }
}
