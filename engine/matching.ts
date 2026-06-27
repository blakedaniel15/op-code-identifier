import type { MenuItem } from './types';
import { normalizeForComparison } from './normalize';

export function containsKeyword(normDesc: string, keyword: string): boolean {
  return normDesc.includes(keyword.toLowerCase());
}

export function evaluateMenuItem(
  rawDesc: string,
  item: MenuItem,
): 'match' | 'partial' | 'disqualified' | 'none' {
  const norm = normalizeForComparison(rawDesc);
  if (item.disqualify.some((k) => containsKeyword(norm, k))) return 'disqualified';
  const req = item.required.some((k) => containsKeyword(norm, k));
  const also = item.requiredAlso.length === 0 ? req : item.requiredAlso.some((k) => containsKeyword(norm, k));
  if (req && also) return 'match';
  if (req || (item.requiredAlso.length > 0 && also)) return 'partial';
  return 'none';
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, single: 1 };

export function detectTireQuantity(rawDesc: string): number | null {
  const d = rawDesc.toLowerCase();
  let m = d.match(/(\d+)\s*\b(?:tires?|wheels?)\b/);
  if (m && m[1]) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 4) return n; }
  for (const [w, n] of Object.entries(WORD_NUM)) {
    if (new RegExp(`\\b${w}\\s+tires?\\b`).test(d)) return n;
  }
  if (/\b(?:all|set\s+of)\s+four\b/.test(d)) return 4;
  return null;
}
