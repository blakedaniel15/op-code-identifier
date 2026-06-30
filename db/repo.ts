// neon's tagged-template sql is typed loosely; rows come back as any[].
type Sql = any;

export async function listServiceLineRuns(sql: Sql) {
  return sql`select store_id, max(store_name) as store_name, batch_id, count(*)::int as total,
    count(distinct op_code)::int as op_codes, max(ingested_at) as ingested_at
    from service_lines group by store_id, batch_id order by max(ingested_at) desc limit 200`;
}

export async function loadRunOpLines(sql: Sql, storeId: string, batchId: string) {
  return sql`select store_id, op_code, op_description, labor_sale, tech_hours
    from service_lines where store_id = ${storeId} and batch_id = ${batchId}`;
}

export async function loadStoreName(sql: Sql, storeId: string): Promise<string> {
  const rows = await sql`select store_name from service_lines
    where store_id = ${storeId} and store_name is not null limit 1`;
  return rows[0]?.store_name ?? storeId;
}

// Returns a Map keyed by engine itemKey "${storeId}::${op_code}" -> menu_item_id.
export async function loadLearnedMappings(sql: Sql, storeId: string): Promise<Map<string, string>> {
  const rows = await sql`select op_code, menu_item_id from opcode_learned_mappings where store_id = ${storeId}`;
  return new Map(rows.map((r: any) => [`${storeId}::${String(r.op_code).toUpperCase()}`, r.menu_item_id]));
}

export async function saveRunSnapshot(sql: Sql, s: {
  runId: string; storeId: string; storeName: string; batchId: string;
  total: number; matched: number; review: number; unmatched: number;
  snapshot: unknown; status: 'in_progress' | 'reviewed';
}) {
  await sql`insert into opcode_run_snapshots
    (run_id, store_id, store_name, batch_id, total, matched, review, unmatched, snapshot, status, ran_at)
    values (${s.runId}, ${s.storeId}, ${s.storeName}, ${s.batchId}, ${s.total}, ${s.matched}, ${s.review}, ${s.unmatched}, ${JSON.stringify(s.snapshot)}, ${s.status}, now())
    on conflict (run_id) do update set total=excluded.total, matched=excluded.matched,
      review=excluded.review, unmatched=excluded.unmatched, snapshot=excluded.snapshot,
      status=excluded.status, ran_at=now()`;
}

export async function loadRunSummaries(sql: Sql) {
  // ran_at cast to text: neon returns timestamptz as a Date, but the stats engine sorts
  // ranAt with String.localeCompare — a Date there throws. Text keeps it a sortable string.
  return sql`select rs.run_id, rs.store_id, rs.store_name, rs.batch_id, rs.total, rs.matched, rs.review,
    rs.unmatched, rs.status, rs.ran_at::text as ran_at,
    (select count(distinct d.op_code) from opcode_decisions d where d.run_id = rs.run_id) as decided
    from opcode_run_snapshots rs order by rs.ran_at desc limit 200`;
}

export async function loadRunDecisions(sql: Sql, runId: string): Promise<Record<string, string>> {
  const rows = await sql`select distinct on (op_code) op_code, outcome
    from opcode_decisions where run_id = ${runId} order by op_code, ts desc`;
  return Object.fromEntries(rows.map((r: any) => [r.op_code, r.outcome]));
}

export async function recordDecision(sql: Sql, d: {
  opCode: string; opDescription?: string; matchType?: string | null; confidence?: string | null;
  outcome: string; menuItemId?: string | null; runId?: string | null; storeId?: string | null;
}) {
  await sql`insert into opcode_decisions
    (op_code, op_description, match_type, confidence, outcome, menu_item_id, run_id, store_id)
    values (${d.opCode}, ${d.opDescription ?? ''}, ${d.matchType ?? null}, ${d.confidence ?? null},
            ${d.outcome}, ${d.menuItemId ?? null}, ${d.runId ?? null}, ${d.storeId ?? null})`;
}

export async function upsertLearnedMapping(sql: Sql, m: {
  storeId: string; opCode: string; menuItemId: string; opDescription?: string;
}) {
  await sql`insert into opcode_learned_mappings (store_id, op_code, menu_item_id, op_description)
    values (${m.storeId}, ${m.opCode}, ${m.menuItemId}, ${m.opDescription ?? ''})
    on conflict (store_id, op_code) do update set menu_item_id = excluded.menu_item_id,
      op_description = excluded.op_description`;
}

export async function addBlock(sql: Sql, storeId: string, opCode: string) {
  await sql`insert into opcode_blocked (store_id, op_code) values (${storeId}, ${opCode})
    on conflict (store_id, op_code) do nothing`;
}

// op_code mapped to the generic `sku` field the stats engine expects.
export async function loadDecisions(sql: Sql) {
  return sql`select run_id as "runId", op_code as sku, op_description, match_type as "matchType",
    confidence, outcome, store_id as dealer, ts::text as ts from opcode_decisions order by ts asc`;
}
