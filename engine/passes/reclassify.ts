import type { Item, MenuItem, Verdict } from '../types';
import { dominantCluster, normalizeForComparison } from '../normalize';
import { evaluateMenuItem, containsKeyword } from '../matching';

export function reclassifyPass(item: Item, catalog: MenuItem[]): Verdict | null {
  const dom = dominantCluster(item.descriptions);
  if (!dom.raw) return null;
  const norm = normalizeForComparison(dom.raw);
  // Strong partial only: the item's REQUIRED signal must be present (a requiredAlso-only
  // hit like a bare "SERVICE" is too weak and mislabels e.g. "BATTERY SERVICE" as Transmission).
  const partial = catalog.find(
    (m) => evaluateMenuItem(dom.raw, m) === 'partial' && m.required.some((k) => containsKeyword(norm, k)),
  );
  if (!partial) return null;
  return {
    menuItemId: partial.id, matchType: 'AI', confidence: 'LOW',
    reason: `Partial signal for ${partial.name} in "${dom.raw}" — possible new menu item, needs review.`,
  };
}
