import { MENU_ITEMS } from '@/engine/catalog';

export function migrationStatements(): string[] {
  return [
    `create table if not exists opcode_menu_items (id text primary key, name text not null)`,
    `create table if not exists opcode_learned_mappings (store_id text not null, op_code text not null, menu_item_id text not null, op_description text default '', created_at timestamptz not null default now(), primary key (store_id, op_code))`,
    `create table if not exists opcode_aliases (id bigserial primary key, menu_item_id text not null, phrase text not null, store_id text, created_at timestamptz not null default now())`,
    `create table if not exists opcode_decisions (id bigserial primary key, op_code text not null, op_description text not null default '', match_type text, confidence text, outcome text not null, menu_item_id text, run_id text, store_id text, ts timestamptz not null default now())`,
    `create table if not exists opcode_run_snapshots (run_id text primary key, store_id text, store_name text, batch_id text, total integer not null default 0, matched integer not null default 0, review integer not null default 0, unmatched integer not null default 0, snapshot jsonb, status text not null default 'reviewed', ran_at timestamptz not null default now())`,
    `create table if not exists opcode_ai_verdict_cache (hash text primary key, verdict jsonb, created_at timestamptz not null default now())`,
    `create table if not exists opcode_blocked (store_id text not null, op_code text not null, created_at timestamptz not null default now(), primary key (store_id, op_code))`,
    `create table if not exists opcode_known (store_id text not null, op_code text not null, primary key (store_id, op_code))`,
  ];
}
export function menuItemSeedRows(): { id: string; name: string }[] {
  return MENU_ITEMS.map((m) => ({ id: m.id, name: m.name }));
}
export async function runMigration(sql: any): Promise<void> {
  // neon's HTTP client (neon()) is tagged-template-only and has no .query(); calling it with a
  // plain string runs that string as a parameterless query (verified: builds {query, params:[]}).
  for (const stmt of migrationStatements()) await sql(stmt);
  for (const r of menuItemSeedRows())
    await sql`insert into opcode_menu_items (id, name) values (${r.id}, ${r.name}) on conflict (id) do update set name = excluded.name`;
}
