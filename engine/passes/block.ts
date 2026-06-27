import type { Item, Verdict } from '../types';
import { dominantCluster } from '../normalize';

export const BLOCK_PATTERNS: RegExp[] = [
  /oil change/, /oil and filter/, /lube oil filter/, /\blof\b/,
  /multi ?point (?:inspection|vehicle)/, /multipoint/, /\bmpvi?\b/,
  /tire rotation/, /rotate tires/, /rotate and balance/,
  /state inspection/, /safety inspection/, /emissions test/, /\brecall\b/,
  /shop supplies/, /loaner/, /rental/, /wash vehicle/, /\bdetail\b/,
  /diagnos/, /inspect only/,
];

export function blockPass(item: Item): Verdict | null {
  const norm = dominantCluster(item.descriptions).normalized;
  if (norm && BLOCK_PATTERNS.some((p) => p.test(norm))) {
    return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: 'Dominant description is a blocked non-service (oil/MPI/rotation/recall/etc.).' };
  }
  return null;
}
