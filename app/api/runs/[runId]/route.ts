import { db } from '@/db/client';
import { loadRunOpLines, loadUploadedOpLines, loadLearnedMappings, loadStoreName, loadRunDecisions, getAiVerdicts, putAiVerdict, buildExamples } from '@/db/repo';
import { parseRunId, serviceLinesToItems } from '@/lib/run';
import { identifyRun } from '@/lib/identify-run';
import { MENU_ITEMS } from '@/engine/catalog';
import { buildSystemPrompt, buildUserBatch } from '@/engine/prompt';
import { AnthropicAdjudicator } from '@/engine/anthropicAdjudicator';
import { CachingAdjudicator } from '@/engine/cachingAdjudicator';
import { RecordedAdjudicator, type Adjudicator } from '@/engine/adjudicator';
import type { Verdict } from '@/engine/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
// Model is part of the verdict-cache version so switching ANTHROPIC_MODEL invalidates
// old-model verdicts instead of serving them stale forever.
const CATALOG_VERSION = `${MODEL}|v${MENU_ITEMS.length}`;

async function buildAdjudicator(sql: any, storeId: string): Promise<Adjudicator> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new RecordedAdjudicator(new Map());
  const examples = await buildExamples(sql, storeId);
  const inner = new AnthropicAdjudicator({
    fetchImpl: (u, i) => fetch(u, i),
    apiKey,
    model: MODEL,
    systemPrompt: buildSystemPrompt(MENU_ITEMS, examples),
    menuItemIds: new Set(MENU_ITEMS.map((m) => m.id)),
    buildUserBatch,
  });
  return new CachingAdjudicator({
    inner,
    catalogVersion: CATALOG_VERSION,
    getCached: (hashes) => getAiVerdicts(sql, hashes) as Promise<Map<string, Verdict>>,
    setCached: async (entries) => {
      for (const e of entries) await putAiVerdict(sql, { hash: e.hash, verdict: e.verdict, model: MODEL, catalogVersion: CATALOG_VERSION });
    },
  });
}

export async function GET(_req: Request, { params }: { params: { runId: string } }) {
  const sql = db();
  const id = params.runId;
  const { storeId, batchId } = parseRunId(id);
  const [dbRows, learned, storeName, decisions] = await Promise.all([
    loadRunOpLines(sql, storeId, batchId),
    loadLearnedMappings(sql, storeId),
    loadStoreName(sql, storeId),
    loadRunDecisions(sql, id),
  ]);
  // Service-line batches win; an uploaded run has no service_lines rows, so fall back to its table.
  const rows = dbRows.length > 0 ? dbRows : await loadUploadedOpLines(sql, storeId, batchId);
  const adjudicator = await buildAdjudicator(sql, storeId);
  const results = await identifyRun(serviceLinesToItems(rows), learned, adjudicator);
  return Response.json({ runId: id, storeId, storeName, batchId, results, decisions });
}
