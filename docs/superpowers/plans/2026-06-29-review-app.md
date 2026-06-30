# Review App (UI + Stats + Data Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js 14 review app (in this repo) that reads `service_lines` from the shared Neon DB, lets the team review the op-code identifier's per-batch output (Yes/No/resolve), and shows accuracy stats — mirroring the parts-matcher sibling and writing only `opcode_`-prefixed tables.

**Architecture:** A run = one store's batch (`service_lines` grouped by `(store_id, batch_id)`). Routes aggregate that batch's rows into engine `Item[]`, inject the store's learned mappings, run the existing `engine/` (`RecordedAdjudicator`, no live AI), and bucket the verdicts. Each review click writes `opcode_decisions` immediately + updates the learned/blocked stores; stats read decisions (id/FP) + run snapshots (review load).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind, Vitest, Neon serverless Postgres (tagged-template). Reuses the built `engine/`. Custom UI primitives (no shadcn/Radix), mirroring `~/Projects/moc-part-matcher`.

## Global Constraints

- **Mirror the sibling** at `~/Projects/moc-part-matcher` for all framework/DB/UI patterns; map parts terms → op-code terms. The full map is in `scratchpad/sibling-map.md`. When a task says "mirror sibling file X", read that exact file and adapt as specified.
- **Shared DB, read-only `service_lines`/`service_parts`/`dealers`.** `/setup` creates ONLY `opcode_`-prefixed tables. Never migrate shared tables.
- **Dealer key = `service_lines.store_id`** (do NOT join `dealers`; `store_id ≠ dealers.key`). Display name from `service_lines.store_name`. `opcode_learned_mappings` PK = `(store_id, op_code)`. All `opcode_` rows carry `store_id`.
- **Run = `(store_id, batch_id)`; `run_id = "${store_id}|${batch_id}"`.**
- **Domain column names** in our tables: `op_code`, `op_description`, `menu_item_id` (NOT the sibling's `sku`/`part_name`/`bare_part_number`). The stats engine's `DecisionRow.sku` is a generic item-key field — map `op_code → sku` ONLY at the `loadDecisions` boundary.
- **`engine/` stays pure** (no DB imports). `catalog.ts` `MENU_ITEMS` is the matching source of truth; `opcode_menu_items` is just an id+name registry.
- **No CSV upload, no live AI, no ingest endpoint** this cycle. Snapshots store PII-free aggregated results only (never raw `service_lines` rows).
- **DB-URL resolver precedence:** `VERCEL_ENV==="preview"` → `PREVIEW_DATABASE_URL`; else `DATABASE_URL → POSTGRES_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL_UNPOOLED → POSTGRES_URL_NO_SSL`.
- **Migration discipline:** one DDL per tagged-template call; `ADD COLUMN IF NOT EXISTS`; backfill-correct defaults (`status` → `'reviewed'`); reads tolerant of a not-yet-added column; `/setup` re-runnable.
- **Routes:** `export const runtime = "nodejs"`; data routes also `export const dynamic = "force-dynamic"`.

### Toolchain (ephemeral sandbox; npm is broken)
- Node on PATH: `export NB=/private/tmp/node-v20.11.1-darwin-arm64/bin` then prefix commands with `PATH=$NB:$PATH`.
- Install deps (bundled npm is broken — use the downloaded one): `PATH=$NB:$PATH node /private/tmp/package/bin/npm-cli.js install` (and `... npm-cli.js install <pkg> --save[-dev]` to add deps). If `node_modules` is missing (sandbox was wiped), reinstall first.
- Vitest: `PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run <file>`
- Typecheck: `PATH=$NB:$PATH node node_modules/typescript/bin/tsc --noEmit`
- Next build (best-effort local only): `PATH=$NB:$PATH node node_modules/next/dist/bin/next build`

### Verification strategy
- **Automated gate (local Vitest):** the pure-logic tasks — stats engine, `service_lines`→`Item[]` aggregation, run-id, gap split, `bucketOf`. These MUST pass.
- **App gate (Vercel preview):** DB routes + UI are verified by deploying to a **Vercel preview** (against the Neon preview branch) and checking in the browser / via curl. `tsc --noEmit` must be clean for every task. Do not block a task on a flaky local `next build`; rely on tsc + the Vercel preview build.

---

## File Structure

```
PHASE 1 — Spine
  package.json, next.config.mjs, postcss.config.mjs, tsconfig.json (Next)   Task 1
  lib/config.ts          dbUrl() tolerant resolver                          Task 2
  db/client.ts           lazy Neon tagged-template singleton                Task 2
  app/api/admin/setup/route.ts + db/migrate.ts   opcode_ DDL                Task 3
  db/repo.ts             service_lines read, aggregation, gap, opcode_ CRUD Tasks 4-6,9
  lib/run.ts             runId helpers + service_lines->Item[] aggregation  Task 4
  lib/gap.ts             learned-vs-classify split                          Task 5
  lib/identify-run.ts    wire engine over a run's items                     Task 6
  lib/stats.ts           bucketOf / tally / computeStats (ported)           Task 7
  app/api/runs/route.ts + [runId]/route.ts                                  Task 8
  app/api/decision/route.ts                                                 Task 9
  app/api/stats/route.ts                                                    Task 10
  app/api/admin/seed-menu-items (or in /setup)                              Task 3
PHASE 2 — UI
  app/globals.css, tailwind.config.ts, app/layout.tsx  tokens+fonts        Task 11
  lib/ui.ts (cn), components/ui/* primitives, MatchTypeChip, StatusChip    Task 12
  components/shell/*  page shell/header/nav                                 Task 13
  app/(runs)/page.tsx  run list + history                                  Task 14
  components/review/results-table.tsx + app/runs/[runId]/page.tsx          Task 15
  app/stats/page.tsx   3 KPIs + per-run table                              Task 16
  Final: Vercel preview wiring + env walkthrough                           Task 17
```

All tests co-located as `*.test.ts`.

---

# PHASE 1 — SPINE (testable logic + DB + APIs)

### Task 1: Next.js scaffold + deps

**Files:** Create `next.config.mjs`, `postcss.config.mjs`; modify `package.json`, `tsconfig.json`; create `app/layout.tsx`, `app/page.tsx` (placeholder).

**Interfaces:** Produces a buildable Next app; later tasks add routes/components.

- [ ] **Step 1: Add Next deps to `package.json`** (merge into existing `scripts`/`devDependencies`)

```jsonc
// scripts: add
"dev": "next dev", "build": "next build", "start": "next start"
// dependencies: add
"next": "14.2.5", "react": "18.3.1", "react-dom": "18.3.1",
"@neondatabase/serverless": "^0.9.4", "clsx": "^2.1.1", "tailwind-merge": "^2.4.0"
// devDependencies: add
"tailwindcss": "^3.4.7", "postcss": "^8.4.40", "autoprefixer": "^10.4.19",
"@types/react": "^18.3.3", "@types/react-dom": "^18.3.0", "@types/node": "^20.14.0"
```

- [ ] **Step 2: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

- [ ] **Step 3: Create `postcss.config.mjs`**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: Update `tsconfig.json`** — add Next/JSX settings, keep strict.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext", "moduleResolution": "Bundler", "strict": true,
    "noUncheckedIndexedAccess": true, "esModuleInterop": true, "skipLibCheck": true,
    "jsx": "preserve", "allowJs": true, "noEmit": true, "incremental": true,
    "resolveJsonModule": true, "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }, "types": ["vitest/globals"]
  },
  "include": ["engine", "eval", "scripts", "lib", "db", "app", "components", "next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create minimal `app/layout.tsx` and `app/page.tsx`**

```tsx
// app/layout.tsx
export const metadata = { title: 'Op-Code Identifier' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
```
```tsx
// app/page.tsx
export default function Home() { return <main>Op-Code Identifier — review app</main>; }
```

- [ ] **Step 6: Install and verify**

Run: `export NB=/private/tmp/node-v20.11.1-darwin-arm64/bin; PATH=$NB:$PATH node /private/tmp/package/bin/npm-cli.js install`
Then: `PATH=$NB:$PATH node node_modules/typescript/bin/tsc --noEmit`
Expected: install completes; tsc exits 0. (A local `next build` is optional; the Vercel preview is the real build gate.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Next.js 14 app scaffold + deps"
```

---

### Task 2: DB URL resolver + Neon client

**Files:** Create `lib/config.ts`, `db/client.ts`; Test `lib/config.test.ts`.

**Interfaces:** Produces `dbUrl(env?): string` and `db(): NeonSql`. Mirror sibling `lib/config.ts` + `db/client.ts`.

- [ ] **Step 1: Write the failing test `lib/config.test.ts`**

```ts
import { resolveDbUrl } from './config';

test('preview env prefers PREVIEW_DATABASE_URL', () => {
  expect(resolveDbUrl({ VERCEL_ENV: 'preview', PREVIEW_DATABASE_URL: 'p', DATABASE_URL: 'd' })).toBe('p');
});
test('non-preview falls through DATABASE_URL -> POSTGRES_URL -> non-pooling chain', () => {
  expect(resolveDbUrl({ DATABASE_URL: 'd', POSTGRES_URL: 'pg' })).toBe('d');
  expect(resolveDbUrl({ POSTGRES_URL: 'pg' })).toBe('pg');
  expect(resolveDbUrl({ POSTGRES_URL_NON_POOLING: 'np' })).toBe('np');
  expect(resolveDbUrl({ DATABASE_URL_UNPOOLED: 'un' })).toBe('un');
  expect(resolveDbUrl({ POSTGRES_URL_NO_SSL: 'ns' })).toBe('ns');
});
test('throws a clear error when no url is configured', () => {
  expect(() => resolveDbUrl({})).toThrow(/no database url/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run lib/config.test.ts` — Expected: FAIL (no `./config`).

- [ ] **Step 3: Write `lib/config.ts`** (pure resolver + thin env wrapper)

```ts
type Env = Record<string, string | undefined>;

export function resolveDbUrl(env: Env): string {
  if (env.VERCEL_ENV === 'preview' && env.PREVIEW_DATABASE_URL) return env.PREVIEW_DATABASE_URL;
  const url = env.DATABASE_URL ?? env.POSTGRES_URL ?? env.POSTGRES_URL_NON_POOLING
    ?? env.DATABASE_URL_UNPOOLED ?? env.POSTGRES_URL_NO_SSL;
  if (!url) throw new Error('No database URL configured (set DATABASE_URL / POSTGRES_URL / PREVIEW_DATABASE_URL).');
  return url;
}

export function dbUrl(): string { return resolveDbUrl(process.env as Env); }
export function adminSecret(): string { return process.env.ADMIN_SECRET ?? ''; }
```

- [ ] **Step 4: Write `db/client.ts`** (lazy Neon singleton, tagged-template only — mirror sibling `db/client.ts`)

```ts
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { dbUrl } from '@/lib/config';

let _sql: NeonQueryFunction<false, false> | null = null;
export function db(): NeonQueryFunction<false, false> {
  if (!_sql) _sql = neon(dbUrl());
  return _sql;
}
```

- [ ] **Step 5: Run test to verify it passes** — Expected: PASS (3 tests). Then `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts lib/config.test.ts db/client.ts && git commit -m "feat: tolerant DB-URL resolver + Neon client"
```

---

### Task 3: /setup migration — opcode_ tables + menu-item seed

**Files:** Create `db/migrate.ts`, `app/api/admin/setup/route.ts`. Test `db/migrate.test.ts` (DDL-string assertions only — no live DB).

**Interfaces:** Produces `migrationStatements(): string[]` (one DDL per element) and `menuItemSeedRows(): {id,name}[]`. Mirror sibling `app/api/admin/setup/route.ts` structure (secret-gated, run statements one-by-one).

- [ ] **Step 1: Write the failing test `db/migrate.test.ts`**

```ts
import { migrationStatements } from './migrate';

test('creates only opcode_-prefixed tables, never the shared ones', () => {
  const ddl = migrationStatements().join('\n').toLowerCase();
  for (const t of ['opcode_menu_items','opcode_learned_mappings','opcode_aliases','opcode_decisions','opcode_run_snapshots','opcode_ai_verdict_cache','opcode_blocked','opcode_known'])
    expect(ddl).toContain(t);
  // must NOT create/alter shared tables
  expect(ddl).not.toMatch(/create table (if not exists )?(service_lines|service_parts|dealers)\b/);
});
test('learned mappings keyed by (store_id, op_code)', () => {
  const stmt = migrationStatements().find(s => s.includes('opcode_learned_mappings'))!;
  expect(stmt.toLowerCase()).toMatch(/primary key\s*\(\s*store_id\s*,\s*op_code\s*\)/);
});
test('each statement is a single DDL (no semicolons-joined batch)', () => {
  for (const s of migrationStatements()) expect(s.trim().split(';').filter(x => x.trim()).length).toBe(1);
});
```

- [ ] **Step 2: Run test → FAIL** (`PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run db/migrate.test.ts`).

- [ ] **Step 3: Write `db/migrate.ts`** — `migrationStatements()` returns the `opcode_` DDL array (domain columns; `store_id` scoping; `add column if not exists` where evolving) and `menuItemSeedRows()` maps `MENU_ITEMS` → `{id,name}`. Plus `runMigration(sql)` that executes each statement via tagged template and upserts seed rows.

```ts
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
  for (const stmt of migrationStatements()) await sql.query(stmt);   // neon: raw DDL via .query()
  for (const r of menuItemSeedRows())
    await sql`insert into opcode_menu_items (id, name) values (${r.id}, ${r.name}) on conflict (id) do update set name = excluded.name`;
}
```
> Note: neon's `sql` runs parameterless raw DDL via `sql.query(text)`; interpolated writes use the tagged template (`sql\`...${v}...\``).

- [ ] **Step 4: Write `app/api/admin/setup/route.ts`** (mirror sibling: POST, `{secret}` vs `adminSecret()`, call `runMigration(db())`, return counts).

```ts
import { db } from '@/db/client';
import { adminSecret } from '@/lib/config';
import { runMigration, migrationStatements } from '@/db/migrate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  if (!secret || secret !== adminSecret()) return new Response('forbidden', { status: 403 });
  await runMigration(db());
  return Response.json({ ok: true, tables: migrationStatements().length });
}
```

- [ ] **Step 5: Run test → PASS**; `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add db/migrate.ts db/migrate.test.ts app/api/admin/setup/route.ts && git commit -m "feat: /setup migration for opcode_ tables + menu-item seed"
```

---

### Task 4: Run id + service_lines → Item[] aggregation

**Files:** Create `lib/run.ts`; Test `lib/run.test.ts`.

**Interfaces:** Produces `runId(storeId, batchId): string`, `parseRunId(id): {storeId,batchId}`, and `serviceLinesToItems(rows: ServiceLineRow[]): Item[]` where `ServiceLineRow = { store_id, op_code, op_description, labor_sale, tech_hours }` (extra cols ignored). Reuses `engine/aggregate.ts` shape.

- [ ] **Step 1: Write the failing test `lib/run.test.ts`**

```ts
import { runId, parseRunId, serviceLinesToItems } from './run';

test('runId round-trips store+batch', () => {
  expect(runId('citrus', 'b1')).toBe('citrus|b1');
  expect(parseRunId('citrus|b1')).toEqual({ storeId: 'citrus', batchId: 'b1' });
});
test('aggregates service_lines by op_code into engine Items keyed by store_id', () => {
  const items = serviceLinesToItems([
    { store_id: 'citrus', op_code: 'A4', op_description: '4 WHEEL ALIGNMENT', labor_sale: '159.95', tech_hours: '1.0' },
    { store_id: 'citrus', op_code: 'A4', op_description: '4 WHEEL ALIGNMENT', labor_sale: '159.95', tech_hours: '1.0' },
    { store_id: 'citrus', op_code: 'WBF', op_description: 'BRAKE FLUID EXCHANGE', labor_sale: '122.00', tech_hours: '1.0' },
  ]);
  const a4 = items.find(i => i.opCode === 'A4')!;
  expect(a4.dealerKey).toBe('citrus');
  expect(a4.rowCount).toBe(2);
  expect(a4.descriptions).toEqual([{ text: '4 WHEEL ALIGNMENT', count: 2 }]);
  expect(a4.laborValues).toEqual([159.95, 159.95]);
  expect(items).toHaveLength(2);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `lib/run.ts`**

```ts
import { aggregateRows, type RawRow } from '@/engine/aggregate';
import type { Item } from '@/engine/types';

export interface ServiceLineRow {
  store_id: string; op_code: string; op_description: string;
  labor_sale?: string | number | null; tech_hours?: string | number | null;
}

export function runId(storeId: string, batchId: string): string { return `${storeId}|${batchId}`; }
export function parseRunId(id: string): { storeId: string; batchId: string } {
  const i = id.indexOf('|');
  return { storeId: i >= 0 ? id.slice(0, i) : id, batchId: i >= 0 ? id.slice(i + 1) : '' };
}

export function serviceLinesToItems(rows: ServiceLineRow[]): Item[] {
  const storeId = rows[0]?.store_id ?? 'unknown';
  const raw: RawRow[] = rows.map((r) => ({
    opCode: r.op_code, description: r.op_description ?? '',
    laborSale: r.labor_sale ?? undefined, techHours: r.tech_hours ?? undefined,
  }));
  return aggregateRows(raw, storeId);
}
```

- [ ] **Step 4: Run test → PASS**; tsc clean.

- [ ] **Step 5: Commit** — `git add lib/run.ts lib/run.test.ts && git commit -m "feat: run-id helpers + service_lines->Item aggregation"`

---

### Task 5: Gap split (learned vs classify)

**Files:** Create `lib/gap.ts`; Test `lib/gap.test.ts`.

**Interfaces:** Produces `splitGap(items: Item[], learned: Map<string,string>): { learnedItems: Item[]; toClassify: Item[] }` — partitions by whether `itemKey(item)` is in the learned map.

- [ ] **Step 1: Write the failing test `lib/gap.test.ts`**

```ts
import { splitGap } from './gap';
import type { Item } from '@/engine/types';
const it = (op: string): Item => ({ dealerKey: 'citrus', opCode: op, descriptions: [], laborValues: [], hoursValues: [], rowCount: 1 });

test('partitions items into already-learned vs to-classify by (store,opCode) key', () => {
  const learned = new Map([['citrus::A4', 'alignment']]);
  const { learnedItems, toClassify } = splitGap([it('A4'), it('WBF')], learned);
  expect(learnedItems.map(i => i.opCode)).toEqual(['A4']);
  expect(toClassify.map(i => i.opCode)).toEqual(['WBF']);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `lib/gap.ts`**

```ts
import type { Item } from '@/engine/types';
import { itemKey } from '@/engine/types';

export function splitGap(items: Item[], learned: Map<string, string>): { learnedItems: Item[]; toClassify: Item[] } {
  const learnedItems: Item[] = [], toClassify: Item[] = [];
  for (const it of items) (learned.has(itemKey(it)) ? learnedItems : toClassify).push(it);
  return { learnedItems, toClassify };
}
```

- [ ] **Step 4: Run test → PASS**; tsc clean.

- [ ] **Step 5: Commit** — `git add lib/gap.ts lib/gap.test.ts && git commit -m "feat: gap split (learned vs to-classify)"`

---

### Task 6: Identify a run (engine wiring)

**Files:** Create `lib/identify-run.ts`; Test `lib/identify-run.test.ts`.

**Interfaces:** Produces `identifyRun(items: Item[], learned: Map<string,string>): Promise<ResultRow[]>` where `ResultRow = { opCode, topDescription, matchType, confidence, menuItemId, quantity?, reason, rowCount, repetition? , laborMean?, hoursMean? }` — runs learned items through `exactPass` and the rest through `identify()` with `RecordedAdjudicator(∅)` + `MENU_ITEMS`, then flattens each verdict + its item's display fields into a PII-free `ResultRow`.

- [ ] **Step 1: Write the failing test `lib/identify-run.test.ts`**

```ts
import { identifyRun } from './identify-run';
import type { Item } from '@/engine/types';
const mk = (op: string, desc: string, labor = [160,160], hours = [1,1]): Item => ({
  dealerKey: 'citrus', opCode: op, descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length });

test('learned op code resolves EXACT; unknown is classified by the engine', async () => {
  const rows = await identifyRun(
    [mk('ZZ', 'MYSTERY'), mk('A4', '4 WHEEL ALIGNMENT')],
    new Map([['citrus::ZZ', 'coolant']]));
  const zz = rows.find(r => r.opCode === 'ZZ')!;
  const a4 = rows.find(r => r.opCode === 'A4')!;
  expect(zz).toMatchObject({ matchType: 'EXACT', menuItemId: 'coolant' });
  expect(a4).toMatchObject({ matchType: 'RULE', menuItemId: 'alignment' });
});
test('result rows are PII-free (op fields + verdict + stats only)', async () => {
  const [row] = await identifyRun([mk('A4', '4 WHEEL ALIGNMENT')], new Map());
  expect(Object.keys(row!).sort()).toEqual(
    ['confidence','hoursMean','laborMean','matchType','menuItemId','quantity','reason','repetition','rowCount','topDescription'].sort());
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `lib/identify-run.ts`** — call `identify(items, { learned, adjudicator: new RecordedAdjudicator(new Map()), catalog: MENU_ITEMS })`; for each item map its `Verdict` + dominant description + mean labor/hours into `ResultRow`. (Reuse `engine/normalize.ts dominantCluster` for `topDescription`; `engine/stats.ts coefficientOfVariation` and a mean helper for display stats. `quantity` defaults to `undefined`.)

```ts
import { identify } from '@/engine/identify';
import { RecordedAdjudicator } from '@/engine/adjudicator';
import { MENU_ITEMS } from '@/engine/catalog';
import { dominantCluster } from '@/engine/normalize';
import { itemKey, type Item } from '@/engine/types';

export interface ResultRow {
  opCode: string; topDescription: string; matchType: string; confidence: string;
  menuItemId: string | null; quantity?: number; reason: string; rowCount: number;
  repetition: number | null; laborMean: number | null; hoursMean: number | null;
}
const mean = (v: number[]) => { const c = v.filter((x) => Number.isFinite(x) && x > 0); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };

export async function identifyRun(items: Item[], learned: Map<string, string>): Promise<ResultRow[]> {
  const verdicts = await identify(items, { learned, adjudicator: new RecordedAdjudicator(new Map()), catalog: MENU_ITEMS });
  return items.map((it) => {
    const v = verdicts.get(itemKey(it))!;
    return {
      opCode: it.opCode, topDescription: dominantCluster(it.descriptions).raw,
      matchType: v.matchType, confidence: v.confidence, menuItemId: v.menuItemId,
      quantity: v.quantity, reason: v.reason, rowCount: it.rowCount,
      repetition: null, laborMean: mean(it.laborValues), hoursMean: mean(it.hoursValues),
    };
  });
}
```

- [ ] **Step 4: Run test → PASS**; tsc clean.

- [ ] **Step 5: Commit** — `git add lib/identify-run.ts lib/identify-run.test.ts && git commit -m "feat: identify a run's items via the engine (learned + classify)"`

---

### Task 7: Stats engine (port verbatim) + seed tests

**Files:** Create `lib/stats.ts`; Test `lib/stats.test.ts`.

**Interfaces:** Produces `bucketOf`, `computeStats(decisions, runSummaries)` exactly as the handoff/sibling `lib/stats.ts`. `DecisionRow` = `{ runId: string|null; sku: string; matchType: string|null; confidence: string|null; outcome: string; dealer?: string; ts?: string }`.

- [ ] **Step 1: Write the failing test `lib/stats.test.ts`** (the three handoff seed tests)

```ts
import { computeStats, bucketOf } from './stats';
const d = (sku: string, matchType: string, confidence: string|null, outcome: string, runId = 'r1') =>
  ({ runId, sku, matchType, confidence, outcome, ts: sku });

test('bucketOf maps matchType/confidence to buckets', () => {
  expect(bucketOf({ matchType: 'RULE', confidence: 'HIGH' })).toBe('matched');
  expect(bucketOf({ matchType: 'AI', confidence: 'LOW' })).toBe('review');
  expect(bucketOf({ matchType: 'AI', confidence: 'HIGH' })).toBe('matched');
  expect(bucketOf({ matchType: 'UNMATCHED', confidence: 'LOW' })).toBe('unmatched');
});
test('10 EXACT-approve + 1 AI/LOW-approve + 1 unmatched-correct => id rate 10/12', () => {
  const decisions = [
    ...Array.from({ length: 10 }, (_, i) => d('E'+i, 'EXACT', 'EXACT', 'approve')),
    d('R1', 'AI', 'LOW', 'approve'), d('U1', 'UNMATCHED', null, 'correct'),
  ];
  const { overall } = computeStats(decisions, [{ runId: 'r1', dealer: 'x', review: 1, total: 12, ranAt: null }]);
  expect(overall.hits).toBe(10); expect(overall.denominator).toBe(12);
  expect(overall.rate).toBeCloseTo(10/12);
});
test('approve then reject same item -> later wins (hits 0, falsePositives 1)', () => {
  const decisions = [ d('X', 'EXACT', 'EXACT', 'approve'), { ...d('X', 'EXACT', 'EXACT', 'reject'), ts: 'zzz' } ];
  const { overall } = computeStats(decisions, []);
  expect(overall.hits).toBe(0); expect(overall.falsePositives).toBe(1);
});
test('snapshot review:2,total:15 with ZERO decisions -> reviewFlagged 2, parts 15', () => {
  const { overall } = computeStats([], [{ runId: 'r1', dealer: 'x', review: 2, total: 15, ranAt: null }]);
  expect(overall.reviewFlagged).toBe(2); expect(overall.parts).toBe(15);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `lib/stats.ts`** — port `bucketOf` / `tally` / `computeStats` verbatim from the handoff doc §4b (and the sibling `lib/stats.ts`). Keep the `__earlier__` grouping, latest-per-(run,item) dedup, snapshot-sourced `reviewFlagged`/`parts`.

- [ ] **Step 4: Run test → PASS** (all 4); tsc clean.

- [ ] **Step 5: Commit** — `git add lib/stats.ts lib/stats.test.ts && git commit -m "feat: stats engine (bucketOf/tally/computeStats) + seed tests"`

---

### Task 8: Run repo + run-list/run-detail routes

**Files:** Create `db/repo.ts` (run-related fns), `app/api/runs/route.ts`, `app/api/runs/[runId]/route.ts`. (No local unit test — DB-bound; verify via tsc + Vercel preview curl.)

**Interfaces:** Mirror sibling `db/repo.ts` + `app/api/runs/*`, adapted: source runs from `service_lines` grouped by `(store_id, batch_id)` joined with `opcode_run_snapshots`. Produces `listServiceLineRuns(sql)`, `loadRunOpLines(sql, storeId, batchId)`, `loadLearnedMappings(sql, storeId)`, `saveRunSnapshot(sql, {...})`, `loadRunSummaries(sql)`, `loadRunDecisions(sql, runId)`.

- [ ] **Step 1: Write `db/repo.ts` run functions** — e.g.:

```ts
export async function listServiceLineRuns(sql: any) {
  return sql`select store_id, max(store_name) as store_name, batch_id, count(*)::int as total,
    count(distinct op_code)::int as op_codes, max(sale_date) as last_date
    from service_lines group by store_id, batch_id order by max(ingested_at) desc limit 200`;
}
export async function loadRunOpLines(sql: any, storeId: string, batchId: string) {
  return sql`select store_id, op_code, op_description, labor_sale, tech_hours
    from service_lines where store_id = ${storeId} and batch_id = ${batchId}`;
}
export async function loadLearnedMappings(sql: any, storeId: string) {
  return sql`select op_code, menu_item_id from opcode_learned_mappings where store_id = ${storeId}`;
}
export async function saveRunSnapshot(sql: any, s: { runId: string; storeId: string; storeName: string; batchId: string; total: number; matched: number; review: number; unmatched: number; snapshot: unknown; status: 'in_progress'|'reviewed' }) {
  await sql`insert into opcode_run_snapshots (run_id, store_id, store_name, batch_id, total, matched, review, unmatched, snapshot, status, ran_at)
    values (${s.runId}, ${s.storeId}, ${s.storeName}, ${s.batchId}, ${s.total}, ${s.matched}, ${s.review}, ${s.unmatched}, ${JSON.stringify(s.snapshot)}, ${s.status}, now())
    on conflict (run_id) do update set total=excluded.total, matched=excluded.matched, review=excluded.review, unmatched=excluded.unmatched, snapshot=excluded.snapshot, status=excluded.status, ran_at=now()`;
}
export async function loadRunSummaries(sql: any) {
  return sql`select rs.run_id, rs.store_id, rs.store_name, rs.batch_id, rs.total, rs.matched, rs.review, rs.unmatched, rs.status, rs.ran_at,
    (select count(distinct d.op_code) from opcode_decisions d where d.run_id = rs.run_id) as decided
    from opcode_run_snapshots rs order by rs.ran_at desc limit 200`;
}
export async function loadRunDecisions(sql: any, runId: string): Promise<Record<string,string>> {
  const rows = await sql`select distinct on (op_code) op_code, outcome from opcode_decisions where run_id = ${runId} order by op_code, ts desc`;
  return Object.fromEntries(rows.map((r: any) => [r.op_code, r.outcome]));
}
```

- [ ] **Step 2: Write `GET /api/runs`** — merge `listServiceLineRuns` (available batches) with `loadRunSummaries` (status/decided), returning a unified run list (store_name, run_id, total, op_codes, status, decided). `runtime="nodejs"`, `dynamic="force-dynamic"`.

- [ ] **Step 3: Write `GET /api/runs/[runId]`** — parse runId → `(storeId, batchId)`; `loadRunOpLines` → `serviceLinesToItems` → `loadLearnedMappings` → `splitGap`/`identifyRun` → results; load `loadRunDecisions` for restore; return `{ runId, storeName, results, decisions }`. (Compute is idempotent; the client POSTs the snapshot — Task 9 — to persist `in_progress`.)

- [ ] **Step 4: Verify** — `tsc --noEmit` clean. (Runtime verified on Vercel preview in Task 17.)

- [ ] **Step 5: Commit** — `git add db/repo.ts app/api/runs && git commit -m "feat: run repo + run-list/run-detail routes (service_lines-sourced)"`

---

### Task 9: Decision route + snapshot persist + feedback stores

**Files:** Modify `db/repo.ts` (add `recordDecision`, `upsertLearnedMapping`, `addBlock`); Create `app/api/decision/route.ts`, `app/api/runs/route.ts` POST (snapshot upsert) if not already. (tsc + preview verification.)

**Interfaces:** Mirror sibling `recordDecision` + `/api/decision`, adapted to `opcode_decisions` (domain columns) and `(store_id, op_code)` learned/blocked. `POST /api/decision` body `{ storeId, runId, outcome, row: { opCode, topDescription, matchType, confidence, menuItemId }, chosenMenuItemId? }`.

- [ ] **Step 1: Add repo fns** `recordDecision(sql, {...})` (insert into `opcode_decisions`), `upsertLearnedMapping(sql, { storeId, opCode, menuItemId, opDescription })` (`on conflict (store_id, op_code) do update`), `addBlock(sql, storeId, opCode)`.

- [ ] **Step 2: Write `POST /api/decision`** — compute `targetMenuItem = outcome==='approve' ? row.menuItemId : outcome==='correct' ? chosenMenuItemId : null`; `recordDecision`; on approve/correct + target → `upsertLearnedMapping`; on reject → `addBlock`. Always include `runId`.

- [ ] **Step 3: Write `POST /api/runs`** — `saveRunSnapshot` with the posted status (`in_progress` on first compute, `reviewed` on Done).

- [ ] **Step 4: Verify** — `tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add db/repo.ts app/api/decision app/api/runs && git commit -m "feat: decision route (immediate write) + snapshot lifecycle + learned/blocked"`

---

### Task 10: Stats route

**Files:** Create `app/api/stats/route.ts`. (tsc + preview verification.)

**Interfaces:** Mirror sibling `app/api/stats/route.ts`: `loadDecisions` (map `op_code → sku`) + `loadRunSummaries` → `computeStats` → JSON.

- [ ] **Step 1: Add `loadDecisions(sql)`** to `db/repo.ts` — `select run_id as "runId", op_code as sku, op_description, match_type as "matchType", confidence, outcome, store_id as dealer, ts from opcode_decisions order by ts asc` (the `op_code → sku` mapping lives here, per the constraint).

- [ ] **Step 2: Write `GET /api/stats`**

```ts
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
```

- [ ] **Step 3: Verify** — `tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git add db/repo.ts app/api/stats && git commit -m "feat: stats route (decisions + snapshots)"`

---

# PHASE 2 — UI (mirror the sibling design system)

### Task 11: Design tokens, fonts, globals, Tailwind

**Files:** Create `app/globals.css`, `tailwind.config.ts`; modify `app/layout.tsx`. (tsc + preview/visual verification.)

**Interfaces:** Establishes the exact visual identity. Use the EXACT token values below (from the sibling — do not invent).

- [ ] **Step 1: Create `app/globals.css`**

```css
@tailwind base; @tailwind components; @tailwind utilities;
:root{
  --background:248 250 252; --foreground:2 6 23; --card:255 255 255;
  --primary:15 23 42; --primary-foreground:255 255 255;
  --accent:3 105 161; --accent-foreground:255 255 255;
  --muted:232 236 241; --muted-foreground:100 116 139;
  --border:226 232 240; --ring:15 23 42;
  --destructive:220 38 38; --destructive-foreground:255 255 255;
  --exact:5 150 105; --fuzzy:217 119 6; --ai:124 58 237; --unmatched:100 116 139;
}
*{border-color:rgb(var(--border));}
body{background:rgb(var(--background));color:rgb(var(--foreground));}
.tnum{font-variant-numeric:tabular-nums;}
```

- [ ] **Step 2: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      background: c('--background'), foreground: c('--foreground'), card: c('--card'),
      primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground') },
      accent: { DEFAULT: c('--accent'), foreground: c('--accent-foreground') },
      muted: { DEFAULT: c('--muted'), foreground: c('--muted-foreground') },
      border: c('--border'), ring: c('--ring'),
      destructive: { DEFAULT: c('--destructive'), foreground: c('--destructive-foreground') },
      exact: c('--exact'), fuzzy: c('--fuzzy'), ai: c('--ai'), unmatched: c('--unmatched'),
    },
    fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'], mono: ['var(--font-mono)', 'ui-monospace', 'monospace'] },
    borderRadius: { lg: '0.75rem', md: '0.5rem', sm: '0.375rem' },
  } },
} satisfies Config;
```

- [ ] **Step 3: Update `app/layout.tsx`** — load fonts + globals.

```tsx
import './globals.css';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
export const metadata = { title: 'Op-Code Identifier' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" className={`${sans.variable} ${mono.variable}`}><body className="font-sans antialiased">{children}</body></html>);
}
```

- [ ] **Step 4: Verify** — `tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add app/globals.css tailwind.config.ts app/layout.tsx && git commit -m "feat: design tokens, fonts, Tailwind (mirror sibling identity)"`

---

### Task 12: UI primitives + MatchTypeChip + StatusChip

**Files:** Create `lib/ui.ts` (`cn`), `components/ui/chip.tsx` (MatchTypeChip, StatusChip), plus button/card primitives as needed. Test `components/ui/chip.test.ts` (pure class-mapping helper).

**Interfaces:** Produces `cn(...)`, `matchTypeClasses(matchType): string` mapping EXACT→exact, RULE→fuzzy, AI→ai, UNMATCHED→unmatched, and a `StatusChip` (amber `in_progress` / emerald `reviewed`).

- [ ] **Step 1: Write the failing test `components/ui/chip.test.ts`**

```ts
import { matchTypeColor } from './chip';
test('bucket-to-color mapping matches the spec', () => {
  expect(matchTypeColor('EXACT')).toBe('exact');
  expect(matchTypeColor('RULE')).toBe('fuzzy');
  expect(matchTypeColor('AI')).toBe('ai');
  expect(matchTypeColor('UNMATCHED')).toBe('unmatched');
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `lib/ui.ts` + `components/ui/chip.tsx`**

```ts
// lib/ui.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...i: ClassValue[]) { return twMerge(clsx(i)); }
```
```tsx
// components/ui/chip.tsx
import { cn } from '@/lib/ui';
export function matchTypeColor(mt: string): 'exact'|'fuzzy'|'ai'|'unmatched' {
  return mt === 'EXACT' ? 'exact' : mt === 'RULE' ? 'fuzzy' : mt === 'AI' ? 'ai' : 'unmatched';
}
const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset';
export function MatchTypeChip({ matchType }: { matchType: string }) {
  const t = matchTypeColor(matchType);
  return <span className={cn(CHIP, `bg-${t}/10 text-${t} ring-${t}/20`)}>{matchType}</span>;
}
export function StatusChip({ status }: { status: 'in_progress'|'reviewed' }) {
  const inProg = status === 'in_progress';
  return <span className={cn(CHIP, inProg ? 'bg-fuzzy/10 text-fuzzy ring-fuzzy/20' : 'bg-exact/10 text-exact ring-exact/20')}>{inProg ? 'In progress' : 'Reviewed'}</span>;
}
```
> Note: because chip color classes are dynamic (`bg-${t}/10`), add a Tailwind safelist in `tailwind.config.ts` for `exact|fuzzy|ai|unmatched` × `bg/text/ring` opacities, or enumerate the 4 variants as static class strings. Enumerate statically to be safe (no purge surprises).

- [ ] **Step 4: Run test → PASS**; tsc clean.

- [ ] **Step 5: Commit** — `git add lib/ui.ts components/ui && git commit -m "feat: cn + MatchTypeChip/StatusChip (bucket color mapping)"`

---

### Task 13: App shell / header

**Files:** Create `components/shell/page-shell.tsx` (header with brand + nav links: Runs / Stats). Modify `app/page.tsx` to redirect to `/` run list. (tsc + visual verification.)

**Interfaces:** Mirror sibling `components/shell/*`. Produces `<PageShell>` wrapper.

- [ ] **Step 1: Write `components/shell/page-shell.tsx`** — header (`bg-card border-b`), brand mark, nav (`Runs`, `Stats`), `max-w-[1200px] mx-auto px-6` content. Mirror sibling shell classes.
- [ ] **Step 2: Verify** — tsc clean.
- [ ] **Step 3: Commit** — `git add components/shell app/page.tsx && git commit -m "feat: app shell + header nav"`

---

### Task 14: Run list + history page

**Files:** Create `app/(home)/page.tsx` or `app/page.tsx` (run list). (tsc + preview verification.)

**Interfaces:** Mirror sibling `app/results/page.tsx` history mode + sibling run-list. Fetches `GET /api/runs`; renders rows with store_name, op-code count, `StatusChip`, "N of M reviewed", linking to `/runs/[runId]`.

- [ ] **Step 1: Write the page** — server component fetching `/api/runs` (or direct repo call); table of runs with status chip + decided/total; empty state. Mirror sibling list styling (`hover:bg-muted/30`, `thead bg-muted/50`).
- [ ] **Step 2: Verify** — tsc clean.
- [ ] **Step 3: Commit** — `git add app && git commit -m "feat: run list + history page"`

---

### Task 15: ResultsTable + run review page

**Files:** Create `components/review/results-table.tsx`, `app/runs/[runId]/page.tsx`. Test `components/review/results-table.helpers.test.ts` (pure `pickYesNo` + bucket-filter helpers).

**Interfaces:** Mirror sibling `components/match/results-table.tsx` + `app/results/page.tsx` (active-run mode), adapted to op-code domain + `/api/decision`. Decision state lifted to the table keyed by `opCode`, seeded from `initialDecisions`, optimistic-after-POST, `key={runId}` remount, filter tabs (All/Matched/Review/Unmatched), persist snapshot `in_progress` on mount.

- [ ] **Step 1: Write the failing test `components/review/results-table.helpers.test.ts`**

```ts
import { pickYesNo, bucketFilter } from './results-table';
test('pickYesNo keeps only approve/reject outcomes', () => {
  expect(pickYesNo({ A4: 'approve', WBF: 'reject', X: 'correct' })).toEqual({ A4: 'approve', WBF: 'reject' });
});
test('bucketFilter buckets a row by matchType/confidence', () => {
  expect(bucketFilter({ matchType: 'RULE', confidence: 'HIGH' })).toBe('matched');
  expect(bucketFilter({ matchType: 'AI', confidence: 'LOW' })).toBe('review');
  expect(bucketFilter({ matchType: 'UNMATCHED', confidence: 'LOW' })).toBe('unmatched');
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement** the table component (export the pure helpers `pickYesNo`, `bucketFilter` = re-use `bucketOf`) + the `[runId]` page (fetch run detail, persist `in_progress` snapshot on mount, render `ResultsTable` with `key={runId}` + `initialDecisions`, Done button → POST `reviewed`). Mirror the sibling's two hard-won lessons (state in table; reopen restores).

- [ ] **Step 4: Run test → PASS**; tsc clean.

- [ ] **Step 5: Commit** — `git add components/review app/runs && git commit -m "feat: ResultsTable + run review page (lifted state, reopen restore)"`

---

### Task 16: Stats page

**Files:** Create `app/stats/page.tsx`. (tsc + visual verification.)

**Interfaces:** Mirror sibling stats page: fetch `/api/stats`; 3 KPI cards (Identification green, Review amber, False-positive — green at 0%) using `idRate`/`reviewRate`/`fpRate` (review from snapshots); per-run table (Identify%/Review%/False+%/menu-item count); empty state when `overall.decided === 0`.

- [ ] **Step 1: Write the page** with the three rate helpers (verbatim from handoff §4d) and the KPI + per-file table. `.tnum` on all numbers.
- [ ] **Step 2: Verify** — tsc clean.
- [ ] **Step 3: Commit** — `git add app/stats && git commit -m "feat: stats page (3 KPIs + per-run table)"`

---

### Task 17: Vercel preview wiring + end-to-end verification

**Files:** none (ops). This task is the **app gate**: deploy to a Vercel preview against the Neon preview branch and verify the full flow.

- [ ] **Step 1:** Confirm env vars copied into the new Vercel project (controller provides the walkthrough): the DB-URL set (`DATABASE_URL`/`POSTGRES_URL`/`*_NON_POOLING`/`*_UNPOOLED`/`*_NO_SSL` as present in the parts project), `ADMIN_SECRET` (fresh), `PREVIEW_DATABASE_URL` (Neon preview branch).
- [ ] **Step 2:** Push the branch; let Vercel build the preview. Confirm the build is green (this is the real `next build` gate).
- [ ] **Step 3:** `POST /api/admin/setup` with the secret → confirm `opcode_` tables created + menu items seeded (query the preview branch).
- [ ] **Step 4:** Seed `service_lines` on the preview branch by POSTing sample nested op-line JSON to the parts `/api/v1/sales` (Bearer `INGEST_API_KEY`) pointed at preview — a couple of stores/batches.
- [ ] **Step 5:** In the browser: run list shows the seeded batches → open one → buckets render with correct chip colors → click Yes/No → reload shows decisions restored → Done flips status → Stats page shows non-zero KPIs. Fix any issues, then mark complete.

---

## Self-Review

**1. Spec coverage:**
- Next app in repo, mirrors sibling → Task 1, 11-16. ✓
- Shared DB read-only, opcode_ only, store_id key, store_name display → Tasks 3, 8 (DDL + queries). ✓
- Run = (store_id,batch_id), run_id scheme → Task 4. ✓
- Gap split (learned vs classify) → Task 5; engine wiring (RecordedAdjudicator, MENU_ITEMS) → Task 6. ✓
- Domain columns + op_code→sku stats mapping → Tasks 3, 10. ✓
- Tolerant DB-URL resolver (exact precedence) → Task 2. ✓
- /setup migration discipline → Task 3. ✓
- Decisions per click + learned/blocked + snapshot lifecycle → Task 9. ✓
- Stats engine verbatim + 3 seed tests + review-from-snapshots → Task 7; stats route/page → Tasks 10, 16. ✓
- Exact design tokens + match-type chip mapping → Tasks 11, 12. ✓
- ResultsTable lessons (lifted state, reopen restore, optimistic-after-POST) → Task 15. ✓
- PII-free snapshots → Task 6 (ResultRow shape test) + Task 8 (snapshot = results, not raw rows). ✓
- Preview branch + seeding via /api/v1/sales + env walkthrough → Task 17. ✓
- Out of scope (live AI, ingest, in-app auth) → nothing in plan adds them. ✓

**2. Placeholder scan:** Logic tasks carry full code + tests. Framework/DB/UI tasks reference exact sibling files to mirror with named adaptations + concrete verification (tsc + Vercel preview) — actionable, not placeholders. Task 8/9/13/14/16 lean on the sibling for bulk JSX/SQL by design (DRY); the adaptations and signatures are specified.

**3. Type consistency:** `Item`/`itemKey` from `engine/types`; `ResultRow` defined Task 6 and consumed in Tasks 8/15; `DecisionRow` (with generic `sku`) defined Task 7, fed by `loadDecisions`' `op_code as sku` (Task 10); `runId` scheme consistent (Task 4 ↔ 8 ↔ 9). Repo function names consistent across Tasks 8-10.
