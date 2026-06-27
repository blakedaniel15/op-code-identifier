import type { Item, MenuItem, Verdict } from '../types';
import { dominantCluster } from '../normalize';
import { evaluateMenuItem } from '../matching';

export function reclassifyPass(item: Item, catalog: MenuItem[]): Verdict | null {
  const dom = dominantCluster(item.descriptions);
  if (!dom.raw) return null;
  const partial = catalog.find((m) => evaluateMenuItem(dom.raw, m) === 'partial');
  if (!partial) return null;
  return {
    menuItemId: partial.id, matchType: 'AI', confidence: 'LOW',
    reason: `Partial signal for ${partial.name} in "${dom.raw}" — possible new menu item, needs review.`,
  };
}
