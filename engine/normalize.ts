import type { DescriptionCount } from './types';

export function normalizeForComparison(desc: string): string {
  if (!desc) return '';
  let d = String(desc).toLowerCase();
  d = d.replace(/\ba\s*\/\s*c\b/g, 'ac');
  d = d.replace(/\bair[\s-]+conditioning\b/g, 'ac');
  d = d.replace(/\bfrigi[\s-]*fresh\b/g, 'frigifresh');
  d = d.replace(/\bmicro[\s-]+filters?\b/g, 'microfilter');
  return d
    .replace(/\$[\d,.]+/g, ' ')
    .replace(/\d+\s*(?:\/\s*\d+)?/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dominantCluster(descriptions: DescriptionCount[]): {
  raw: string; normalized: string; count: number; uniqueNormalized: number;
} {
  const clusters = new Map<string, { raw: string; count: number }>();
  for (const { text, count } of descriptions) {
    const n = normalizeForComparison(text);
    if (!n) continue;
    const existing = clusters.get(n);
    if (existing) existing.count += count;
    else clusters.set(n, { raw: text, count });
  }
  if (clusters.size === 0) return { raw: '', normalized: '', count: 0, uniqueNormalized: 0 };
  let best: { raw: string; count: number } | null = null;
  let bestNorm = '';
  for (const [norm, c] of clusters) {
    if (!best || c.count > best.count) { best = c; bestNorm = norm; }
  }
  return { raw: best!.raw, normalized: bestNorm, count: best!.count, uniqueNormalized: clusters.size };
}
