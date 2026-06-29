export type Bucket = 'matched' | 'review' | 'unmatched';

export function bucketOf(d: { matchType: string | null; confidence: string | null }): Bucket {
  const mt = d.matchType;
  if (mt === 'EXACT' || mt === 'RULE') return 'matched';
  if (mt === 'AI') return d.confidence === 'HIGH' || d.confidence === 'MEDIUM' ? 'matched' : 'review';
  return 'unmatched';
}

export interface DecisionRow {
  runId: string | null; sku: string; matchType: string | null; confidence: string | null;
  outcome: string; dealer?: string; ts?: string;
}
export interface Tally {
  hits: number; rescuedReview: number; rescuedUnmatched: number; falsePositives: number;
  denominator: number; rate: number; decided: number; reviewFlagged: number; parts: number;
}

function tally(decisions: DecisionRow[]): Tally {
  const latest = new Map<string, DecisionRow>();
  for (const d of decisions) latest.set((d.runId ?? '') + '|' + d.sku, d);
  let hits = 0, rescuedReview = 0, rescuedUnmatched = 0, falsePositives = 0, decided = 0;
  for (const d of latest.values()) {
    const b = bucketOf(d);
    if (d.outcome === 'approve' || d.outcome === 'correct') {
      decided++;
      if (b === 'matched') hits++;
      else if (b === 'review') rescuedReview++;
      else rescuedUnmatched++;
    } else if (d.outcome === 'reject') {
      decided++;
      if (b === 'matched') falsePositives++;
    }
  }
  const denominator = hits + rescuedReview + rescuedUnmatched;
  return { hits, rescuedReview, rescuedUnmatched, falsePositives, denominator,
    rate: denominator ? hits / denominator : 0, decided, reviewFlagged: 0, parts: 0 };
}

export interface RunSummaryInput { runId: string; dealer: string; review: number; total: number; ranAt: string | null; }

export function computeStats(decisions: DecisionRow[], runSummaries: RunSummaryInput[] = []) {
  const overall: Tally = {
    ...tally(decisions),
    reviewFlagged: runSummaries.reduce((a, s) => a + (s.review || 0), 0),
    parts: runSummaries.reduce((a, s) => a + (s.total || 0), 0),
  };
  const EARLIER = '__earlier__';
  const byRun = new Map<string, DecisionRow[]>();
  for (const d of decisions) {
    const key = d.runId || EARLIER;
    let arr = byRun.get(key);
    if (!arr) { arr = []; byRun.set(key, arr); }
    arr.push(d);
  }
  const summaryByRun = new Map(runSummaries.map((s) => [s.runId, s]));
  const runIds = new Set<string>([...summaryByRun.keys(), ...byRun.keys()]);
  const runs = [...runIds].map((runId) => {
    const ds = byRun.get(runId) ?? [];
    const s = summaryByRun.get(runId);
    return {
      runId,
      dealer: runId === EARLIER ? 'Earlier reviews' : (s?.dealer || ds.find((d) => d.dealer)?.dealer || 'unknown'),
      ranAt: s?.ranAt ?? ds[ds.length - 1]?.ts ?? null,
      ...tally(ds),
      reviewFlagged: s?.review ?? 0,
      parts: s?.total ?? 0,
    };
  }).sort((a, b) => (b.ranAt ?? '').localeCompare(a.ranAt ?? ''));
  return { overall, runs };
}
