# CSV Upload as a Real Run — Design (Sub-project 4)

**Date:** 2026-07-01
**Status:** Approved (design); spec pending user review
**Parents:** `docs/superpowers/specs/2026-06-29-review-app-design.md` (the run model), the engine + AI adjudicator.
**Builds on:** the Next.js review app on Vercel + shared Neon DB.

---

## Goal

Add a second entry point: upload a dealer's raw-data **CSV** and have it become a **real run** —
same review loop (Yes/No/resolve), AI adjudicator, learned-mappings compounding, and stats as a
DB-fed run. The DB `service_lines` feed and ad-hoc file upload then work identically downstream.

## Scope

**In:** CSV upload → a persisted run under a chosen dealer; client-side parsing (PII-free); a new
`opcode_`-owned op-lines table; run-list + run-detail read from it; an upload page + nav link.

**Out:** `.xlsx` (CSV only — decided); an accuracy gate for uploads (they carry no ground-truth
labels — the identifier + human review *produce* the labels); automated ingest (that's the DB path).

**Decisions locked:** CSV only; **dealer name derived from the filename, editable**; parse in the
browser so raw PII never leaves the machine.

---

## The one architectural constraint

We **must not write to `service_lines`** (owned by the parts tool). Uploaded op-lines go into a new
`opcode_`-prefixed table, and the run pipeline reads op-lines from **either** `service_lines` **or**
`opcode_uploaded_lines`. Uploaded runs stay first-class: they recompute on each open (picking up
newly-learned mappings) exactly like DB runs.

## Data model

- New table (created by `/setup`, `create table if not exists`):
  ```sql
  create table if not exists opcode_uploaded_lines (
    id bigserial primary key,
    store_id text not null, store_name text, batch_id text not null,
    op_code text not null, op_description text default '',
    labor_sale text, tech_hours text,
    uploaded_at timestamptz not null default now()
  );
  create index if not exists opcode_uploaded_lines_run_idx on opcode_uploaded_lines (store_id, batch_id);
  ```
  **PII-free** — only the four fields the engine needs (op code, description, labor, hours), plus the
  run keys. Matches the `service_lines` op-line shape so `serviceLinesToItems` works unchanged.
- A run = `(store_id, batch_id)`, `run_id = "${store_id}|${batch_id}"` (unchanged). Uploads:
  **`store_id` = slug of the (edited) dealer name** (`"Singing River CDJR" → SINGING-RIVER-CDJR`) so
  re-uploading the same dealer reuses its `opcode_learned_mappings`; **`batch_id` = a generated id**
  (`crypto.randomUUID()`) so run-ids never collide with each other or with DB runs. Neither contains
  `|` (safe for `parseRunId`).

## Components & flow

1. **`lib/upload.ts`** (pure, tested):
   - `dealerNameFromFilename(name)`: strip extension, strip a trailing `_raw_data_...` export suffix,
     replace `_`/`-` with spaces, title-case → `"Singing River Cdjr"` (editable, so casing is fine).
   - `storeIdFromDealer(name)`: uppercase, non-alphanumerics → single `-`, trim → `"SINGING-RIVER-CDJR"`.
   - `pickUploadColumns(headers)`: detect the op-code / description / labor-sale / tech-hours columns by
     known header names (`Op Code`, `Operations Description`, `Labor Sale`, `Tech Hours`) with a
     case-insensitive/substring fallback; returns the mapping.
   - `extractRows(rows, cols)`: map each parsed row → `{ opCode, opDescription, laborSale, techHours }`,
     dropping blanks and any row without an op code. **This is the PII boundary** — nothing else is kept.
2. **`app/upload/page.tsx`** (+ an "Upload" link in the shell): a `'use client'` page — file picker →
   **papaparse the File in the browser** (papaparse is already a dependency) → `pickUploadColumns` +
   `extractRows` → show the dealer name pre-filled from `dealerNameFromFilename(file.name)`, editable →
   a preview count (e.g. "1,514 rows, 59 op codes") → **Run** button. On submit, `POST /api/uploads`
   with only `{ dealerName, rows }`, then `router.push('/runs/' + encodeURIComponent(runId))`.
3. **`POST /api/uploads`** (`app/api/uploads/route.ts`, `runtime=nodejs`): body `{ dealerName, rows }`.
   Reject empty dealerName / empty rows. Compute `storeId = storeIdFromDealer(dealerName)`,
   `batchId = crypto.randomUUID()`, `storeName = dealerName`. Bulk-insert via a single `unnest` query
   (`insert ... select ${storeId}, ${storeName}, ${batchId}, * from unnest(${opCodes}::text[], ...)`),
   cap at ~10k rows. Return `{ runId: storeId+'|'+batchId, storeId, batchId }`.
4. **Run pipeline reads uploaded lines** (`db/repo.ts` + `app/api/runs/*`):
   - `loadUploadedOpLines(sql, storeId, batchId)` — same select shape as `loadRunOpLines`.
   - Run-detail route: `let rows = await loadRunOpLines(...); if (rows.length === 0) rows = await loadUploadedOpLines(...)`; `loadStoreName` gets an analogous fallback to `opcode_uploaded_lines`.
   - `GET /api/runs`: union `listServiceLineRuns` with `listUploadedRuns` (group `opcode_uploaded_lines`
     by `(store_id, batch_id)`), tagging each run `source: 'db' | 'upload'`; the run list shows an
     **"Uploaded"** chip for upload runs.
5. **`/setup`**: add the `opcode_uploaded_lines` DDL + index to `migrationStatements()`.

Everything after the redirect — identify, the AI adjudicator, the review table, decisions,
learned-mappings, snapshot, stats — is the **existing** code, unchanged.

## Data flow

```
pick CSV → browser papaparse → pickUploadColumns + extractRows (PII stripped, 4 fields)
  → dealerName (from filename, editable)
  → POST /api/uploads { dealerName, rows }
       storeId = slug(dealerName); batchId = randomUUID
       insert opcode_uploaded_lines; return runId
  → redirect /runs/[runId]
       loadRunOpLines empty → loadUploadedOpLines → serviceLinesToItems → identify (+AI) → review → stats
Runs list unions DB batches + uploaded batches (Uploaded chip).
```

## Error handling & edges

- Empty/invalid CSV, no detectable op-code column, or zero extracted rows → the upload page shows an
  error and doesn't POST.
- `POST /api/uploads` rejects empty dealerName or empty rows (400).
- Row cap ~10k (this file is 1,514) — over the cap, reject with a clear message.
- Re-uploading the same dealer creates a **new** run (new `batch_id`) but under the **same** `store_id`,
  so its learned mappings carry over and auto-resolve known op codes.
- No ground-truth labels on uploads → no accuracy gate; the review loop provides the labels.

## PII

Only op code, op description, labor sale, tech hours are sent to the server and stored — the same
fields the DB path already holds in `service_lines`. VIN, customer number, advisor/tech names, etc.
(dedicated columns) are parsed in the browser and **never sent**. Raw CSVs remain gitignored under
`data/`.

## Testing

Pure Vitest (no DB/browser): `dealerNameFromFilename`, `storeIdFromDealer`, `pickUploadColumns`
(against the real 50-column header set), `extractRows` (maps the 50-col row → 4 fields, drops
PII/blank/op-code-less rows), and the run-id round-trip. DB repo + the upload route + the upload page
are verified on Vercel by uploading the Singing River CDJR file → the run appears in the list with an
Uploaded chip → open it → AI suggestions fill the review buckets → confirm a few → Stats updates.

## Build order

1. `lib/upload.ts` (pure) + tests.
2. `/setup` `opcode_uploaded_lines` DDL; `db/repo.ts` (`insertUploadedLines`, `loadUploadedOpLines`,
   `listUploadedRuns`, `loadStoreName`/run-list fallbacks).
3. `POST /api/uploads` route.
4. Run route + `GET /api/runs` union + Uploaded chip in the run list.
5. `app/upload/page.tsx` + nav link.
6. Vercel end-to-end with the Singing River file.
