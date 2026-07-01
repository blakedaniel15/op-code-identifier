import { randomUUID } from 'node:crypto';
import { db } from '@/db/client';
import { insertUploadedLines } from '@/db/repo';
import { storeIdFromDealer } from '@/lib/upload';
import { runId as makeRunId } from '@/lib/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 10_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const dealerName = typeof body?.dealerName === 'string' ? body.dealerName.trim() : '';
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  if (!dealerName) return Response.json({ error: 'Dealer name is required.' }, { status: 400 });
  if (rows.length === 0) return Response.json({ error: 'No rows to upload.' }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return Response.json({ error: `Too many rows (${rows.length}); the limit is ${MAX_ROWS}.` }, { status: 400 });
  }

  const storeId = storeIdFromDealer(dealerName);
  if (!storeId) return Response.json({ error: 'Dealer name has no usable characters.' }, { status: 400 });
  const batchId = randomUUID();

  const sql = db();
  await insertUploadedLines(sql, { storeId, storeName: dealerName, batchId, rows });

  return Response.json({ runId: makeRunId(storeId, batchId), storeId, batchId });
}
