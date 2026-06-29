import { db } from '@/db/client';
import { recordDecision, upsertLearnedMapping, addBlock } from '@/db/repo';
import { parseRunId } from '@/lib/run';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sql = db();
  const { storeId, runId, outcome, row, chosenMenuItemId } = await req.json();
  const sid: string | null = storeId ?? (runId ? parseRunId(runId).storeId : null);
  const target = outcome === 'approve' ? row?.menuItemId : outcome === 'correct' ? chosenMenuItemId : null;
  await recordDecision(sql, {
    opCode: row.opCode, opDescription: row.topDescription ?? '', matchType: row.matchType ?? null,
    confidence: row.confidence ?? null, outcome, menuItemId: target ?? null, runId: runId ?? null, storeId: sid,
  });
  if ((outcome === 'approve' || outcome === 'correct') && target && sid) {
    await upsertLearnedMapping(sql, { storeId: sid, opCode: row.opCode, menuItemId: target, opDescription: row.topDescription ?? '' });
  } else if (outcome === 'reject' && sid) {
    await addBlock(sql, sid, row.opCode);
  }
  return Response.json({ ok: true });
}
