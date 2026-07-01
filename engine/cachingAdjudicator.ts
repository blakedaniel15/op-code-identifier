import { createHash } from 'node:crypto';
import type { Adjudicator } from './adjudicator';
import type { Item, Verdict } from './types';
import { dominantCluster } from './normalize';

export function verdictCacheKey(item: Item, catalogVersion: string): string {
  const dom = dominantCluster(item.descriptions).normalized;
  return createHash('sha256').update(`${item.opCode}|${dom}|${catalogVersion}`).digest('hex');
}

export interface CachingAdjudicatorDeps {
  inner: Adjudicator;
  getCached: (hashes: string[]) => Promise<Map<string, Verdict>>;
  setCached: (entries: { hash: string; verdict: Verdict }[]) => Promise<void>;
  catalogVersion: string;
}

export class CachingAdjudicator implements Adjudicator {
  constructor(private readonly deps: CachingAdjudicatorDeps) {}

  async adjudicate(items: Item[]): Promise<Verdict[]> {
    if (items.length === 0) return [];
    const keys = items.map((it) => verdictCacheKey(it, this.deps.catalogVersion));
    let cached = new Map<string, Verdict>();
    try { cached = await this.deps.getCached([...new Set(keys)]); } catch { /* best-effort */ }

    const missIdx: number[] = [];
    for (let i = 0; i < items.length; i++) if (!cached.has(keys[i]!)) missIdx.push(i);

    const freshByKey = new Map<string, Verdict>();
    if (missIdx.length) {
      const fresh = await this.deps.inner.adjudicate(missIdx.map((i) => items[i]!));
      missIdx.forEach((i, j) => { const v = fresh[j]; if (v) freshByKey.set(keys[i]!, v); });
      try {
        const writes = [...freshByKey.entries()].map(([hash, verdict]) => ({ hash, verdict }));
        if (writes.length) await this.deps.setCached(writes);
      } catch { /* best-effort */ }
    }

    return items.map((_, i) =>
      cached.get(keys[i]!) ?? freshByKey.get(keys[i]!) ?? { menuItemId: null, matchType: 'UNMATCHED' as const, confidence: 'LOW' as const, reason: 'No verdict.' },
    );
  }
}
