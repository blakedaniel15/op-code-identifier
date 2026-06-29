import { db } from '@/db/client';
import { loadDecisions, loadRunSummaries } from '@/db/repo';
import { computeStats } from '@/lib/stats';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = db();
  const [decisions, runs] = await Promise.all([loadDecisions(sql), loadRunSummaries(sql)]);
  const summaries = runs.map((r: any) => ({ runId: r.run_id, dealer: r.store_name ?? r.store_id, review: r.review, total: r.total, ranAt: r.ran_at }));
  return Response.json(computeStats(decisions as any, summaries));
}
