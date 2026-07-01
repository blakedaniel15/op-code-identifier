# CSV Upload as a Real Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a dealer's raw-data CSV and have it become a first-class run — identical review loop, AI adjudicator, learned-mappings, and stats — reading op-lines from a new `opcode_uploaded_lines` table instead of `service_lines`.

**Architecture:** The browser parses the CSV (papaparse), strips it to the four fields the engine needs (PII never leaves the machine), and POSTs `{ dealerName, rows }` to `/api/uploads`. The route slugs the dealer name into a `store_id`, generates a `batch_id`, and bulk-inserts into `opcode_uploaded_lines`. The existing run-detail route reads op-lines from `service_lines` OR (on empty) `opcode_uploaded_lines`; everything downstream (identify → AI → review → decisions → learned-mappings → snapshot → stats) is unchanged.

**Tech Stack:** Next.js 14 App Router, Neon serverless Postgres (tagged-template `sql` only — no `.query`), Vitest (globals on), papaparse (already a dependency).

## Global Constraints

- **Shared DB — never write to `service_lines`, `service_parts`, or `dealers`.** Uploaded op-lines go only into the new `opcode_uploaded_lines` table. `/setup` creates ONLY `opcode_`-prefixed tables.
- **`store_id` is the dealer key — no `dealers` join.** `store_id = storeIdFromDealer(dealerName)` so re-uploading the same dealer reuses its `opcode_learned_mappings`.
- **`run_id = "${storeId}|${batchId}"`** — neither part may contain `|` (`parseRunId` splits on the first `|`). Slugs contain only `A-Z0-9-`; `batchId` is a UUID.
- **PII boundary:** only `op_code`, `op_description`, `labor_sale`, `tech_hours` are sent to the server or stored. VIN, customer number, advisor/tech names, etc. are parsed in the browser and never sent. Raw CSVs stay gitignored under `data/`.
- **Row cap:** reject uploads over 10,000 rows.
- **Toolchain (npm/npx are broken — use these exact commands):**
  - Vitest: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/vitest/vitest.mjs run <file>`
  - Typecheck: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/typescript/bin/tsc --noEmit`
  - Build: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/next/dist/bin/next build`
- **Test pattern:** `.test.ts` colocated with source; Vitest globals (`test`, `expect`) — no imports needed for them.
- Routes and client pages have **no unit tests** in this repo (established pattern). Their gate is `tsc --noEmit` plus the Vercel end-to-end in Task 6. Pure logic is extracted into `lib/upload.ts` (Task 1) so it CAN be unit-tested.

---

### Task 1: `lib/upload.ts` — pure CSV helpers

**Files:**
- Create: `lib/upload.ts`
- Test: `lib/upload.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface UploadColumns { opCode: number; opDescription: number; laborSale: number; techHours: number }` — column indices; `opCode` always ≥ 0, the others may be `-1` (missing).
  - `interface UploadRow { opCode: string; opDescription: string; laborSale: string; techHours: string }`
  - `dealerNameFromFilename(name: string): string`
  - `storeIdFromDealer(name: string): string`
  - `pickUploadColumns(headers: string[]): UploadColumns | null` — `null` when no op-code column is found.
  - `extractRows(rows: string[][], cols: UploadColumns): UploadRow[]` — the PII boundary; keeps only the four fields, drops rows with a blank op code.

- [ ] **Step 1: Write the failing test**

Create `lib/upload.test.ts`:

```ts
import { dealerNameFromFilename, storeIdFromDealer, pickUploadColumns, extractRows } from './upload';

// The real 50-column Singing River / Deacon Jones export header (trimmed to what matters).
const HEADERS = [
  'Dealer ID', 'Team Name', 'Customer Number', 'Op Code', 'Operations Line Number',
  'Operations Cwi', 'Operations Description', 'Service Name', 'Advisor Name', 'Advisor Number',
  'Tech Name', 'Tech Number', 'Repair Order Number', 'Repair Order Open Date', 'Repair Order Close Date',
  'Repair Order Mileage', 'Vehicle Make', 'Vehicle Model', 'Vehicle Vin Number', 'Vehicle Year',
  'Labor Cost', 'Labor Sale', 'Tech Hours', 'Parts Cost', 'Parts Sale',
];

test('dealerNameFromFilename strips extension + export suffix and title-cases', () => {
  expect(dealerNameFromFilename('singing_river_cdjr_raw_data_2026_06_01_to_2026_06_30.csv'))
    .toBe('Singing River Cdjr');
  expect(dealerNameFromFilename('Deacon Jones.csv')).toBe('Deacon Jones');
});

test('storeIdFromDealer slugs to UPPER-KEBAB regardless of casing', () => {
  expect(storeIdFromDealer('Singing River CDJR')).toBe('SINGING-RIVER-CDJR');
  expect(storeIdFromDealer('Singing River Cdjr')).toBe('SINGING-RIVER-CDJR');
  expect(storeIdFromDealer('  Toyota of Gallatin! ')).toBe('TOYOTA-OF-GALLATIN');
});

test('pickUploadColumns finds the four columns in the real header set', () => {
  expect(pickUploadColumns(HEADERS)).toEqual({ opCode: 3, opDescription: 6, laborSale: 21, techHours: 22 });
});

test('pickUploadColumns returns null when there is no op-code column', () => {
  expect(pickUploadColumns(['Team Name', 'Service Name'])).toBeNull();
});

test('extractRows keeps only the four fields and drops blank-op-code rows', () => {
  const cols = pickUploadColumns(HEADERS)!;
  const row = new Array(25).fill('');
  row[1] = 'Singing River CDJR'; row[3] = '90'; row[6] = 'MULTI-POINT INSPECTION';
  row[18] = '2C3CDZAGXHH548679'; row[21] = '$0.00'; row[22] = '0.00';
  const blank = new Array(25).fill(''); blank[6] = 'ORPHAN DESCRIPTION';
  expect(extractRows([row, blank], cols)).toEqual([
    { opCode: '90', opDescription: 'MULTI-POINT INSPECTION', laborSale: '$0.00', techHours: '0.00' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/vitest/vitest.mjs run lib/upload.test.ts`
Expected: FAIL — `Failed to resolve import "./upload"` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

Create `lib/upload.ts`:

```ts
export interface UploadColumns {
  opCode: number;
  opDescription: number;
  laborSale: number;
  techHours: number;
}

export interface UploadRow {
  opCode: string;
  opDescription: string;
  laborSale: string;
  techHours: string;
}

export function dealerNameFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');           // strip extension
  const noSuffix = base.replace(/_raw_data_.*$/i, '');  // strip a trailing export suffix
  const spaced = noSuffix.replace(/[_-]+/g, ' ').trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function storeIdFromDealer(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Exact header match first, then an all-tokens-present substring fallback.
function findCol(headers: string[], exact: string[], contains: string[][]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const e of exact) {
    const i = norm.indexOf(e);
    if (i >= 0) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    for (const group of contains) if (group.every((t) => norm[i].includes(t))) return i;
  }
  return -1;
}

export function pickUploadColumns(headers: string[]): UploadColumns | null {
  const opCode = findCol(headers, ['op code'], [['op', 'code']]);
  if (opCode < 0) return null;
  return {
    opCode,
    opDescription: findCol(headers, ['operations description', 'op description'], [['description']]),
    laborSale: findCol(headers, ['labor sale'], [['labor', 'sale']]),
    techHours: findCol(headers, ['tech hours'], [['tech', 'hour']]),
  };
}

export function extractRows(rows: string[][], cols: UploadColumns): UploadRow[] {
  const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
  const out: UploadRow[] = [];
  for (const row of rows) {
    const opCode = at(row, cols.opCode);
    if (!opCode) continue;
    out.push({
      opCode,
      opDescription: at(row, cols.opDescription),
      laborSale: at(row, cols.laborSale),
      techHours: at(row, cols.techHours),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/vitest/vitest.mjs run lib/upload.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add lib/upload.ts lib/upload.test.ts
git commit -m "feat: pure CSV-upload helpers (filename→dealer, slug, column detection, PII-strip)"
```

---

### Task 2: `opcode_uploaded_lines` table + repo functions

**Files:**
- Modify: `db/migrate.ts` (add two statements to `migrationStatements()`)
- Modify: `db/repo.ts` (add `insertUploadedLines`, `loadUploadedOpLines`, `listUploadedRuns`; extend `loadStoreName` with an uploaded-table fallback)
- Test: `db/migrate.test.ts`

**Interfaces:**
- Consumes: `UploadRow` field shape from Task 1 (`{ opCode, opDescription, laborSale, techHours }`) — accepted inline, not imported, to keep `db/repo.ts` dependency-free (matching its current style).
- Produces:
  - `insertUploadedLines(sql, a: { storeId: string; storeName: string; batchId: string; rows: { opCode: string; opDescription: string; laborSale: string; techHours: string }[] }): Promise<number>` — returns rows inserted.
  - `loadUploadedOpLines(sql, storeId: string, batchId: string)` — returns rows with columns `store_id, op_code, op_description, labor_sale, tech_hours` (same shape as `loadRunOpLines`, so `serviceLinesToItems` works unchanged).
  - `listUploadedRuns(sql)` — returns `store_id, store_name, batch_id, total, op_codes, ingested_at` (same columns as `listServiceLineRuns`, `ingested_at` is `max(uploaded_at)::text`).
  - `loadStoreName(sql, storeId)` — unchanged signature; now falls back to `opcode_uploaded_lines` when `service_lines` has no name.

- [ ] **Step 1: Write the failing test**

Create `db/migrate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/vitest/vitest.mjs run db/migrate.test.ts`
Expected: FAIL — no statement contains `opcode_uploaded_lines`.

- [ ] **Step 3a: Add the DDL to `migrationStatements()`**

In `db/migrate.ts`, add these two entries to the returned array, immediately before the two `alter table opcode_ai_verdict_cache ...` lines:

```ts
    `create table if not exists opcode_uploaded_lines (id bigserial primary key, store_id text not null, store_name text, batch_id text not null, op_code text not null, op_description text default '', labor_sale text, tech_hours text, uploaded_at timestamptz not null default now())`,
    `create index if not exists opcode_uploaded_lines_run_idx on opcode_uploaded_lines (store_id, batch_id)`,
```

- [ ] **Step 3b: Add the repo functions**

In `db/repo.ts`, add these functions (place after `loadRunOpLines`):

```ts
export async function loadUploadedOpLines(sql: Sql, storeId: string, batchId: string) {
  return sql`select store_id, op_code, op_description, labor_sale, tech_hours
    from opcode_uploaded_lines where store_id = ${storeId} and batch_id = ${batchId}`;
}

export async function insertUploadedLines(sql: Sql, a: {
  storeId: string; storeName: string; batchId: string;
  rows: { opCode: string; opDescription: string; laborSale: string; techHours: string }[];
}): Promise<number> {
  if (a.rows.length === 0) return 0;
  const opCodes = a.rows.map((r) => r.opCode);
  const descs = a.rows.map((r) => r.opDescription);
  const labors = a.rows.map((r) => r.laborSale);
  const hours = a.rows.map((r) => r.techHours);
  // Bulk insert: three constants + the four unnest columns → the seven table columns, in order.
  await sql`insert into opcode_uploaded_lines
    (store_id, store_name, batch_id, op_code, op_description, labor_sale, tech_hours)
    select ${a.storeId}, ${a.storeName}, ${a.batchId}, *
    from unnest(${opCodes}::text[], ${descs}::text[], ${labors}::text[], ${hours}::text[])`;
  return a.rows.length;
}

export async function listUploadedRuns(sql: Sql) {
  return sql`select store_id, max(store_name) as store_name, batch_id, count(*)::int as total,
    count(distinct op_code)::int as op_codes, max(uploaded_at)::text as ingested_at
    from opcode_uploaded_lines group by store_id, batch_id order by max(uploaded_at) desc limit 200`;
}
```

Then replace the existing `loadStoreName` with this fallback-aware version:

```ts
export async function loadStoreName(sql: Sql, storeId: string): Promise<string> {
  const rows = await sql`select store_name from service_lines
    where store_id = ${storeId} and store_name is not null limit 1`;
  if (rows[0]?.store_name) return rows[0].store_name;
  const up = await sql`select store_name from opcode_uploaded_lines
    where store_id = ${storeId} and store_name is not null limit 1`;
  return up[0]?.store_name ?? storeId;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/vitest/vitest.mjs run db/migrate.test.ts`
Expected: PASS (1/1).

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors (the new repo functions typecheck).

- [ ] **Step 5: Commit**

```bash
git add db/migrate.ts db/migrate.test.ts db/repo.ts
git commit -m "feat: opcode_uploaded_lines table + repo (insert/load/list, store-name fallback)"
```

---

### Task 3: `POST /api/uploads` route

**Files:**
- Create: `app/api/uploads/route.ts`

**Interfaces:**
- Consumes: `storeIdFromDealer` (Task 1), `insertUploadedLines` (Task 2), `runId as makeRunId` (`lib/run.ts`), `db` (`db/client.ts`).
- Produces: `POST /api/uploads` — body `{ dealerName: string, rows: UploadRow[] }` → `200 { runId, storeId, batchId }` or `400 { error }`.

- [ ] **Step 1: Create the route**

Create `app/api/uploads/route.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/uploads/route.ts
git commit -m "feat: POST /api/uploads — slug dealer, insert uploaded lines, return runId"
```

---

### Task 4: Run pipeline reads uploaded lines + run list union + Uploaded chip

**Files:**
- Modify: `db/repo.ts:4-8` (`listServiceLineRuns` — cast `ingested_at` to text)
- Modify: `app/api/runs/[runId]/route.ts:45-52` (op-lines fallback)
- Modify: `app/api/runs/route.ts:7-22` (GET — union uploaded runs, tag `source`, sort)
- Modify: `app/page.tsx` (`RunListItem` gets `source`; render an "Uploaded" chip)

**Interfaces:**
- Consumes: `loadUploadedOpLines`, `listUploadedRuns` (Task 2).
- Produces: `GET /api/runs` runs now carry `source: 'db' | 'upload'`; run-detail resolves op-lines from `service_lines` else `opcode_uploaded_lines`.

- [ ] **Step 1: Cast `ingested_at` to text in `listServiceLineRuns`**

So DB and uploaded runs share one sortable string type. In `db/repo.ts`, change the `listServiceLineRuns` select from `max(ingested_at) as ingested_at` to `max(ingested_at)::text as ingested_at`. Full replacement:

```ts
export async function listServiceLineRuns(sql: Sql) {
  return sql`select store_id, max(store_name) as store_name, batch_id, count(*)::int as total,
    count(distinct op_code)::int as op_codes, max(ingested_at)::text as ingested_at
    from service_lines group by store_id, batch_id order by max(ingested_at) desc limit 200`;
}
```

- [ ] **Step 2: Op-lines fallback in the run-detail route**

In `app/api/runs/[runId]/route.ts`, add `loadUploadedOpLines` to the repo import, then change the data-loading block. Replace lines 45–52 (the `Promise.all` through `identifyRun`) with:

```ts
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
```

Update the import on line 2 to include `loadUploadedOpLines`:

```ts
import { loadRunOpLines, loadUploadedOpLines, loadLearnedMappings, loadStoreName, loadRunDecisions, getAiVerdicts, putAiVerdict, buildExamples } from '@/db/repo';
```

- [ ] **Step 3: Union uploaded runs in `GET /api/runs`**

Replace the `GET` function in `app/api/runs/route.ts` with:

```ts
export async function GET() {
  const sql = db();
  const [batches, uploaded, summaries] = await Promise.all([
    listServiceLineRuns(sql),
    listUploadedRuns(sql),
    loadRunSummaries(sql),
  ]);
  const byRun = new Map(summaries.map((s: any) => [s.run_id, s]));
  const mk = (b: any, source: 'db' | 'upload') => {
    const rid = makeRunId(b.store_id, b.batch_id);
    const s: any = byRun.get(rid);
    return {
      runId: rid, storeId: b.store_id, storeName: b.store_name ?? b.store_id, batchId: b.batch_id,
      total: b.total, opCodes: b.op_codes, ingestedAt: b.ingested_at ?? '', source,
      status: s?.status ?? 'new', decided: Number(s?.decided ?? 0),
      review: s?.review ?? null, matched: s?.matched ?? null,
    };
  };
  const runs = [...batches.map((b: any) => mk(b, 'db')), ...uploaded.map((b: any) => mk(b, 'upload'))]
    .sort((a, b) => (b.ingestedAt ?? '').localeCompare(a.ingestedAt ?? ''));
  return Response.json({ runs });
}
```

Update the import on line 2 to include `listUploadedRuns`:

```ts
import { listServiceLineRuns, listUploadedRuns, loadRunSummaries, saveRunSnapshot } from '@/db/repo';
```

- [ ] **Step 4: Show the "Uploaded" chip in the run list**

In `app/page.tsx`, add `source` to the `RunListItem` interface (after `matched: number | null;`):

```ts
  source: 'db' | 'upload';
```

Then in the Store cell, render a chip after the store name when the run is an upload. Replace the Store `<td>` (currently lines 116–123) with:

```tsx
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/runs/${encodeURIComponent(r.runId)}`}
                        className="block after:absolute after:inset-0"
                      >
                        {r.storeName || r.storeId}
                      </Link>
                      {r.source === 'upload' && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-ai/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ai ring-1 ring-inset ring-ai/20">
                          Uploaded
                        </span>
                      )}
                    </td>
```

Also update the list heading/description so it no longer reads DMS-only. Replace the header `<div>` block (currently lines 62–67) with:

```tsx
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Runs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Service-line batches from the DMS and uploaded CSVs. Click a row to review op-code matches.
        </p>
      </div>
```

- [ ] **Step 5: Typecheck**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add db/repo.ts app/api/runs/route.ts app/api/runs/[runId]/route.ts app/page.tsx
git commit -m "feat: uploaded runs appear in the run list and read op-lines from opcode_uploaded_lines"
```

---

### Task 5: Upload page + nav link

**Files:**
- Create: `app/upload/page.tsx`
- Modify: `components/shell/nav.tsx:7-10` (add the Upload nav item)

**Interfaces:**
- Consumes: `dealerNameFromFilename`, `pickUploadColumns`, `extractRows` (Task 1); `POST /api/uploads` (Task 3); `PageShell` (`components/shell/page-shell.tsx`).

- [ ] **Step 1: Add the nav link**

In `components/shell/nav.tsx`, change the `NAV` array to:

```ts
const NAV = [
  { href: "/", label: "Runs" },
  { href: "/upload", label: "Upload" },
  { href: "/stats", label: "Stats" },
];
```

- [ ] **Step 2: Create the upload page**

Create `app/upload/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { PageShell } from '@/components/shell/page-shell';
import { dealerNameFromFilename, pickUploadColumns, extractRows, type UploadRow } from '@/lib/upload';

export default function UploadPage() {
  const router = useRouter();
  const [dealer, setDealer] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data as string[][];
        const headers = data[0] ?? [];
        const cols = pickUploadColumns(headers);
        if (!cols) {
          setError('Could not find an "Op Code" column in this CSV.');
          return;
        }
        const extracted = extractRows(data.slice(1), cols);
        if (extracted.length === 0) {
          setError('No usable rows (every row was missing an op code).');
          return;
        }
        setRows(extracted);
        setDealer(dealerNameFromFilename(file.name));
      },
      error: () => setError('Could not read that file.'),
    });
  }

  async function onRun() {
    setError('');
    if (!dealer.trim()) {
      setError('Enter a dealer name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealerName: dealer.trim(), rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Upload failed.');
      router.push('/runs/' + encodeURIComponent(d.runId));
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const opCodeCount = new Set(rows.map((r) => r.opCode)).size;

  return (
    <PageShell>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Upload a CSV</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a dealer&apos;s raw-data CSV. It&apos;s parsed in your browser — only op code,
            description, labor, and hours are sent. It becomes a run you can review like any other.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <label className="flex flex-col gap-2 text-sm font-medium">
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
          />
        </label>

        {rows.length > 0 && (
          <>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Dealer name
              <input
                type="text"
                value={dealer}
                onChange={(e) => setDealer(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{rows.length.toLocaleString()}</span> rows,{' '}
              <span className="font-medium text-foreground">{opCodeCount}</span> op codes from{' '}
              <span className="font-mono text-xs">{fileName}</span>
            </div>
            <button
              type="button"
              onClick={onRun}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? 'Creating run…' : 'Run'}
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

Run: `PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/next/dist/bin/next build`
Expected: build succeeds; `/upload` and `/api/uploads` appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/upload/page.tsx components/shell/nav.tsx
git commit -m "feat: /upload page (browser CSV parse, editable dealer, run) + nav link"
```

---

### Task 6: Vercel end-to-end verification

**Files:** none (verification only).

This task has no code. It confirms the feature works against the real shared DB with the real file. If the migration hasn't been re-run since Task 2 shipped, `opcode_uploaded_lines` won't exist yet.

- [ ] **Step 1: Push and let Vercel deploy**

```bash
git push
```

Wait for the deployment to go green.

- [ ] **Step 2: Run the migration to create `opcode_uploaded_lines`**

`POST /api/admin/setup` with the admin secret (same mechanism used previously). Expected: `{ ok: true, tables: 12 }` (10 prior statements + the 2 new ones).

- [ ] **Step 3: Upload the real file**

In the app: **Upload** → pick `data/singing_river_cdjr_raw_data_2026_06_01_to_2026_06_30.csv`. Confirm the dealer name pre-fills as "Singing River Cdjr" (edit to taste), the preview shows ~1,514 rows and ~59 op codes, then click **Run**.
Expected: redirect to `/runs/SINGING-RIVER-CDJR|<uuid>`, the review table populates (AI suggestions fill the buckets).

- [ ] **Step 4: Confirm the run list + stats**

Go to **Runs**: the Singing River run appears with an **"Uploaded"** chip. Confirm a few decisions in the run, then open **Stats** and confirm the decisions are reflected.

- [ ] **Step 5: Confirm the PII boundary**

Spot-check in Neon (or via a read query) that `opcode_uploaded_lines` holds only `store_id, store_name, batch_id, op_code, op_description, labor_sale, tech_hours, uploaded_at` — no VIN, customer, or advisor/tech columns.

---

## Self-Review

**Spec coverage:**
- `lib/upload.ts` (dealerNameFromFilename, storeIdFromDealer, pickUploadColumns, extractRows) → Task 1. ✅
- `opcode_uploaded_lines` DDL + index via `/setup` → Task 2 (Step 3a) + Task 6 (Step 2). ✅
- Repo `insertUploadedLines`, `loadUploadedOpLines`, `listUploadedRuns`, `loadStoreName` fallback → Task 2. ✅
- `POST /api/uploads` (validation, slug, UUID, bulk insert, 10k cap) → Task 3. ✅
- Run-detail op-lines fallback → Task 4 (Step 2). ✅
- `GET /api/runs` union + `source` tag → Task 4 (Step 3). ✅
- "Uploaded" chip in run list → Task 4 (Step 4). ✅
- `app/upload/page.tsx` + nav link → Task 5. ✅
- PII boundary (browser parse, 4 fields only) → Task 1 `extractRows` + Task 5 page + Task 2 test asserts no PII columns + Task 6 Step 5. ✅
- Error/edge handling (empty CSV, no op-code column, zero rows, empty dealerName, row cap, re-upload same dealer) → Task 3 (route 400s) + Task 5 (client errors). ✅
- Vercel e2e with Singing River file → Task 6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `UploadRow`/`UploadColumns` defined in Task 1, consumed by Tasks 3 & 5; repo accepts the same four field names inline in Task 2. `listUploadedRuns` returns the same columns as `listServiceLineRuns` (incl. `ingested_at` as text) so `mk()` in Task 4 is uniform. `loadUploadedOpLines` returns the `service_lines` op-line shape so `serviceLinesToItems` is unchanged. `run_id = makeRunId(storeId, batchId)` consistent across Task 3 and Task 4. ✅
