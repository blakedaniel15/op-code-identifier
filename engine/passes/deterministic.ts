import type { Item, MenuItem, Verdict } from '../types';
import { dominantCluster } from '../normalize';
import { evaluateMenuItem, detectTireQuantity } from '../matching';
import { applyStatsModifier } from '../stats';

export function deterministicPass(item: Item, catalog: MenuItem[]): Verdict | null {
  const dom = dominantCluster(item.descriptions);
  if (!dom.raw) return null;
  const matches = catalog.filter((m) => evaluateMenuItem(dom.raw, m) === 'match');
  if (matches.length !== 1) return null; // zero or conflicting -> let later passes handle
  const matched = matches[0]!;
  const { confidence, stats } = applyStatsModifier('HIGH', item);
  const verdict: Verdict = {
    menuItemId: matched.id, matchType: 'RULE', confidence,
    reason: `Dominant description "${dom.raw}" matches ${matched.name} keyword rules.`,
    supportingStats: stats,
  };
  if (matched.isTire) {
    const qty = detectTireQuantity(dom.raw);
    if (qty !== null) verdict.quantity = qty;
  }
  return verdict;
}
