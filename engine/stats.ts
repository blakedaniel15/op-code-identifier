import type { Confidence, Item, StatsEffect } from './types';

const TIGHT = 0.15;
const SCATTERED = 0.35;
const ORDER: ('LOW' | 'MEDIUM' | 'HIGH')[] = ['LOW', 'MEDIUM', 'HIGH'];

export function coefficientOfVariation(values: number[]): number | null {
  // Zero/negative labor or hours (warranty, internal, free lines) are excluded so they don't skew CV.
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length === 0) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  if (mean === 0) return null;
  const variance = clean.reduce((a, v) => a + (v - mean) ** 2, 0) / clean.length;
  return Math.sqrt(variance) / mean;
}

function bump(c: 'LOW' | 'MEDIUM' | 'HIGH'): 'LOW' | 'MEDIUM' | 'HIGH' {
  const i = ORDER.indexOf(c);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : c;
}
function cap(c: 'LOW' | 'MEDIUM' | 'HIGH'): 'LOW' | 'MEDIUM' | 'HIGH' {
  const i = ORDER.indexOf(c);
  return i > 0 ? ORDER[i - 1]! : c;
}

// NOTE (sub-project A): confidence — including a scattered-stats cap from HIGH to MEDIUM — is
// RECORDED on the verdict but does not by itself route to a review queue here; auto-identification
// keys on matchType only. Consuming confidence for review routing is deferred to the UI sub-project.
export function applyStatsModifier(
  confidence: Confidence,
  item: Item,
): { confidence: Confidence; stats: StatsEffect } {
  if (confidence === 'EXACT') {
    return { confidence, stats: { laborCv: null, hoursCv: null, effect: 'none' } };
  }
  const laborCv = coefficientOfVariation(item.laborValues);
  const hoursCv = coefficientOfVariation(item.hoursValues);
  const cvs = [laborCv, hoursCv].filter((v): v is number => v !== null);
  let effect: StatsEffect['effect'] = 'none';
  let out = confidence;
  if (cvs.length > 0) {
    const tightest = Math.min(...cvs);
    const loosest = Math.max(...cvs);
    if (tightest < TIGHT) { out = bump(confidence); effect = out !== confidence ? 'bumped' : 'none'; }
    else if (loosest > SCATTERED) { out = cap(confidence); effect = out !== confidence ? 'capped' : 'none'; }
  }
  return { confidence: out, stats: { laborCv, hoursCv, effect } };
}
