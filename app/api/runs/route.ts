import { db } from '@/db/client';
import { listServiceLineRuns, loadRunSummaries, saveRunSnapshot } from '@/db/repo';
import { runId as makeRunId } from '@/lib/run';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = db();
  const [batches, summaries] = await Promise.all([listServiceLineRuns(sql), loadRunSummaries(sql)]);
  const byRun = new Map(summaries.map((s: any) => [s.run_id, s]));
  const runs = batches.map((b: any) => {
    const rid = makeRunId(b.store_id, b.batch_id);
    const s: any = byRun.get(rid);
    return {
      runId: rid, storeId: b.store_id, storeName: b.store_name ?? b.store_id, batchId: b.batch_id,
      total: b.total, opCodes: b.op_codes,
      status: s?.status ?? 'new', decided: Number(s?.decided ?? 0),
      review: s?.review ?? null, matched: s?.matched ?? null,
    };
  });
  return Response.json({ runs });
}

export async function POST(req: Request) {
  const sql = db();
  const b = await req.json();
  await saveRunSnapshot(sql, {
    runId: b.runId, storeId: b.storeId, storeName: b.storeName, batchId: b.batchId,
    total: b.total ?? 0, matched: b.matched ?? 0, review: b.review ?? 0, unmatched: b.unmatched ?? 0,
    snapshot: b.snapshot ?? null, status: b.status === 'reviewed' ? 'reviewed' : 'in_progress',
  });
  return Response.json({ ok: true });
}
