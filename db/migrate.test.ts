import { migrationStatements } from './migrate';

test('migration creates the opcode_uploaded_lines table and its index', () => {
  const stmts = migrationStatements();
  const table = stmts.find((s) => s.includes('create table if not exists opcode_uploaded_lines'));
  expect(table).toBeTruthy();
  // PII-free: exactly the four engine fields plus the run keys — no VIN/customer/advisor columns.
  expect(table).toContain('op_code');
  expect(table).toContain('op_description');
  expect(table).toContain('labor_sale');
  expect(table).toContain('tech_hours');
  expect(table).not.toMatch(/vin|customer|advisor/i);
  expect(stmts.some((s) => s.includes('opcode_uploaded_lines_run_idx'))).toBe(true);
});

test('creates only opcode_-prefixed tables, never the shared ones', () => {
  const ddl = migrationStatements().join('\n').toLowerCase();
  for (const t of ['opcode_menu_items','opcode_learned_mappings','opcode_aliases','opcode_decisions','opcode_run_snapshots','opcode_ai_verdict_cache','opcode_blocked','opcode_known','opcode_uploaded_lines'])
    expect(ddl).toContain(t);
  expect(ddl).not.toMatch(/create table (if not exists )?(service_lines|service_parts|dealers)\b/);
});
test('learned mappings keyed by (store_id, op_code)', () => {
  const stmt = migrationStatements().find(s => s.includes('opcode_learned_mappings'))!;
  expect(stmt.toLowerCase()).toMatch(/primary key\s*\(\s*store_id\s*,\s*op_code\s*\)/);
});
test('each statement is a single DDL (no semicolon-joined batch)', () => {
  for (const s of migrationStatements()) expect(s.trim().split(';').filter(x => x.trim()).length).toBe(1);
});
