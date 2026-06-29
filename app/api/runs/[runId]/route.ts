import { db } from '@/db/client';
import { loadRunOpLines, loadLearnedMappings, loadStoreName, loadRunDecisions } from '@/db/repo';
import { parseRunId, serviceLinesToItems } from '@/lib/run';
import { identifyRun } from '@/lib/identify-run';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { runId: string } }) {
  const sql = db();
  const id = params.runId;
  const { storeId, batchId } = parseRunId(id);
  const [rows, learned, storeName, decisions] = await Promise.all([
    loadRunOpLines(sql, storeId, batchId),
    loadLearnedMappings(sql, storeId),
    loadStoreName(sql, storeId),
    loadRunDecisions(sql, id),
  ]);
  const results = await identifyRun(serviceLinesToItems(rows), learned);
  return Response.json({ runId: id, storeId, storeName, batchId, results, decisions });
}
