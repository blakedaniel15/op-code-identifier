import type { Verdict } from '../engine/types';
import { businessLabel } from '../engine/catalog';

export type Outcome = 'hit' | 'miss' | 'falsePositive' | 'trueNegative';

function isAutoIdentified(v: Verdict): boolean {
  return v.matchType === 'EXACT' || v.matchType === 'RULE';
}

export function classifyOutcome(verdict: Verdict, expected: string | null): Outcome {
  const auto = isAutoIdentified(verdict) && verdict.menuItemId !== null;
  const predicted = auto ? businessLabel(verdict.menuItemId!, verdict.quantity) : null;
  if (expected === null) return auto ? 'falsePositive' : 'trueNegative';
  if (!auto) return 'miss';
  return predicted === expected ? 'hit' : 'falsePositive';
}

export function computeMetrics(pairs: { verdict: Verdict; expected: string | null }[]) {
  const counts: Record<Outcome, number> = { hit: 0, miss: 0, falsePositive: 0, trueNegative: 0 };
  let flagged = 0;
  for (const { verdict, expected } of pairs) {
    counts[classifyOutcome(verdict, expected)]++;
    if (verdict.matchType === 'AI' && verdict.confidence === 'LOW') flagged++;
  }
  const idDen = counts.hit + counts.miss;
  const fpDen = counts.hit + counts.falsePositive;
  return {
    identification: idDen > 0 ? counts.hit / idDen : 1,
    reviewRate: pairs.length > 0 ? flagged / pairs.length : 0,
    falsePositive: fpDen > 0 ? counts.falsePositive / fpDen : 0,
    counts, flagged, total: pairs.length,
  };
}
