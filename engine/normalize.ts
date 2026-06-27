import type { DescriptionCount } from './types';

const STOPWORDS = new Set([
  'a','an','the','and','or','of','to','in','on','for','per','with','without','at','by','from','up','as',
  'is','are','was','were','be','been','being','perform','performed','performing','complete','completed',
  'replace','replaced','replacing','install','installed','installing','new','done','all','this','that',
  'these','those','change','changed','changing','customer','vehicle','work','order','also','full','every',
  'each','only','will','need','needs','part','parts','service',
]);

const SYNONYMS: Record<string, string> = {
  injection: 'injector', injections: 'injector', injectors: 'injector', inject: 'injector',
  transmisssion: 'transmission', tranmission: 'transmission', tranny: 'transmission',
  differentials: 'differential', diffrential: 'differential', differenial: 'differential',
  filters: 'filter', flushed: 'flush', flushing: 'flush', align: 'alignment', alignments: 'alignment',
  coolants: 'coolant', antifreeze: 'coolant', tires: 'tire', maint: 'maintenance',
};

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

export function tokenize(desc: string): string[] {
  return normalizeForComparison(desc)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => SYNONYMS[t] ?? t);
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
