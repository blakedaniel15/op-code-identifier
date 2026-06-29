# Review App (UI + Stats + Data Layer) — Design (Sub-project 2)

**Date:** 2026-06-29
**Status:** Approved (design); spec pending user review
**Parents:** `opcode-classifier-playbook.md`, `docs/review-ui-and-stats-handoff.md`
**Mirrors:** the sibling parts-matcher at `~/Projects/moc-part-matcher` (map: scratchpad `sibling-map.md`)
**Builds on:** sub-project A (the pure `engine/`), which is reused unchanged.

---

## Goal

A Next.js app that lets the team review the op-code identifier's output: pick a pending run
(one store's batch of service lines from the shared DB), see auto-mapped / review / unmatched
buckets, confirm or correct each op code with Yes/No, and watch accuracy stats — every decision
feeding the learned-mappings loop so the next batch needs less review. It mirrors the
parts-matcher tool 1:1 in stack, DB patterns, and visual identity.

## Scope

**In:** Next.js 14 App Router app added to this repo; reads the shared Neon DB (`service_lines`,
read-only); writes only `opcode_`-prefixed tables; `/setup` migration; engine wired in-process;
review UI + 3-KPI stats; Vercel deployment protection.

**Out (later sub-projects):** live `AnthropicAdjudicator` + token/batch tuning; automated
`service_lines` polling + new-batch notification; in-app per-user auth; the parts `/api/v1/sales`
ingest endpoint (owned by the parts tool — we only read what it writes).

**Stack:** Next.js 14 (App Router) + TypeScript strict + Tailwind + Vitest. Neon serverless
Postgres via tagged-template client (no Prisma/Drizzle, no shadcn/Radix — custom primitives,
matching the sibling). Node runtime on all routes.

---

## Hard constraints (from the shared-DB owner)

- **Shared Neon DB with the parts-matcher.** No new integration/DB. App reads env vars copied
  from the parts Vercel project via a **tolerant resolver** (see §DB layer).
- **`service_lines`, `service_parts`, `dealers` are owned by the parts tool — read-only, never
  migrated.** `/setup` creates ONLY `opcode_`-prefixed tables.
- **Dealer key = `service_lines.store_id`.** Do NOT join the shared `dealers` table
  (`store_id ≠ dealers.key`). Read the dealer **display name** from `service_lines.store_name`
  (a live column). All `opcode_` tables are scoped by `store_id`; `opcode_learned_mappings` is
  keyed `(store_id, op_code)`.
- **Entry point = read `service_lines`** (no CSV upload). A **run = `(store_id, batch_id)`**.
- **Preview branch for dev:** `PREVIEW_DATABASE_URL` (a Neon preview branch), preferred when
  `VERCEL_ENV=preview`, so test writes never hit production.

---

## Architecture & data flow

```
service_lines (shared, read-only)
   │  group by (store_id, batch_id)
   ▼
RUN = one store's batch ─ reviewer picks a pending run from the list
   │  aggregate that batch's rows by op_code -> engine Item[]
   │     (descriptions+counts, laborValues, hoursValues, rowCount; dealerKey = store_id)
   ▼
GAP SPLIT:
   op codes in opcode_learned_mappings(store_id) -> auto-resolve EXACT (via engine exactPass)
   the rest -> identify(items, { learned, adjudicator: RecordedAdjudicator(∅), catalog })
   ▼
buckets via bucketOf(verdict): matched (EXACT|RULE, or AI HIGH/MEDIUM) / review (AI LOW) / unmatched
   │  snapshot persisted immediately as run_snapshot status='in_progress' (PII-free results only)
   ▼
reviewer Yes / No / resolve-to-menu-item  ──(each click)──▶ POST /api/decision
   │     writes opcode_decisions row + upserts opcode_learned_mappings (approve/correct)
   │     or opcode_blocked (reject)
   ▼
"Done" -> run_snapshot status='reviewed'
   ▼
Stats: opcode_decisions (id + false-positive) + opcode_run_snapshots (review load) -> 3 KPIs
```

Two correctness invariants carried from the handoff: **decisions persist per click** (never on
"Done"), and **review-rate comes from snapshots, id/FP from decisions** (different denominators
on purpose).

---

## Engine integration

The built `engine/` is reused unchanged and stays pure (no DB imports). API routes:
1. Query `service_lines` for `(store_id, batch_id)`, aggregate rows by `op_code` into `Item[]`
   (reuse `engine/aggregate.ts` shape: `descriptions[{text,count}]`, `laborValues`, `hoursValues`,
   `rowCount`, `dealerKey = store_id`).
2. Load `opcode_learned_mappings` for the store into a `Map<itemKey, menuItemId>`.
3. `identify(items, { learned, adjudicator: new RecordedAdjudicator(new Map()), catalog: MENU_ITEMS })`.
   Live AI stays deferred — the `RecordedAdjudicator` returns UNMATCHED, so "AI" rows are only the
   engine's AI/LOW reclassify output. `catalog.ts` (`MENU_ITEMS`) remains the matching source of
   truth; `opcode_menu_items` is just the id+name registry for the resolve dropdown and FK.

---

## Data model

**Read-only shared (never created/migrated here):**
- `service_lines`: PK `op_line_id = "${store_id}|${ro}|${line}"`; cols incl. `store_id`,
  `store_name`, `op_code`, `op_description`, `correction`, `pay_type`, `labor_sale`, `tech_hours`,
  `batch_id`, `sale_date`, `ingested_at`.

**Created by `/setup` (all `opcode_`-prefixed, scoped by `store_id`):**
- `opcode_menu_items` (`id` PK, `name`) — seeded from `engine/catalog.ts` `MENU_ITEMS`.
- `opcode_learned_mappings` (`store_id, op_code, menu_item_id, ...`; PK `(store_id, op_code)`).
- `opcode_aliases` (`menu_item_id, phrase, store_id`).
- `opcode_decisions` (`id bigserial`, `op_code`, `op_description`, `match_type`, `confidence`,
  `outcome` ∈ approve|reject|correct, `menu_item_id`, `run_id`, `store_id`, `ts`). **Domain
  column names** (not the sibling's `sku`/`part_name`/`bare_part_number`).
- `opcode_run_snapshots` (`run_id` PK = `"${store_id}|${batch_id}"`, `store_id`, `store_name`,
  `batch_id`, `total`, `matched`, `review`, `unmatched`, `snapshot jsonb` (PII-free results
  array), `status` ∈ in_progress|reviewed, `ran_at`).
- `opcode_ai_verdict_cache`, `opcode_blocked` (`store_id, op_code`), `opcode_known` — present
  for parity/future; only the first six are exercised this cycle.

**Migration discipline:** `runMigration(sql)` applies each DDL as a separate tagged-template call;
new columns use `ADD COLUMN IF NOT EXISTS` with backfill-correct defaults (`status` → `'reviewed'`);
reads tolerate a not-yet-added column; re-run `/setup` after each schema-adding deploy.

**PII:** `snapshot` stores ONLY the aggregated, PII-free results (op_code, dominant op_description,
verdict, stats) — never raw `service_lines` rows (no RO numbers, VINs, customer data).

---

## DB layer & API routes (mirror the sibling)

- `lib/config.ts` — `dbUrl()`: if `VERCEL_ENV==="preview"` use `PREVIEW_DATABASE_URL`; else
  `DATABASE_URL → POSTGRES_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL_UNPOOLED → POSTGRES_URL_NO_SSL`.
- `db/client.ts` — lazy Neon singleton, tagged-template only (`const sql = db()`; `await sql\`...\``).
- `db/repo.ts` — `recordDecision`, `saveRunSnapshot(status)`, `loadRunSummaries`, `loadDecisions`
  (ordered `ts asc`), `loadRunDecisions(runId)`, `upsertLearnedMapping`, `addBlock`,
  `loadLearnedMappings(storeId)`, `listServiceLineRuns()` (distinct `(store_id, store_name, batch_id)`
  + counts), `loadRunOpLines(storeId, batchId)`.
- `POST /api/admin/setup` — secret-gated (`{secret}` vs `ADMIN_SECRET`); creates `opcode_` tables.
- `GET /api/runs` — pending + recent runs (service_lines batches joined with snapshots; status chip
  + decided count); `GET /api/runs/[runId]` — snapshot + restored decisions
  (`distinct on (op_code) ... order by op_code, ts desc`); `POST /api/runs` — upsert snapshot.
- `POST /api/decision` — write `opcode_decisions` + feedback stores (always include `run_id`).
- `GET /api/stats` — `loadDecisions` + `loadRunSummaries` → `computeStats`.

All routes: `export const runtime = "nodejs"`; data routes add `export const dynamic = "force-dynamic"`.

---

## Stats engine (port verbatim, unit-test first)

`lib/stats.ts` — `bucketOf` / `tally` / `computeStats` ported **verbatim** from the handoff/sibling.
Its `DecisionRow.sku` is a **generic item-key field**; we map `op_code → sku` ONLY at the
`loadDecisions` boundary so the engine stays unchanged. Rules preserved: review-rate from
**snapshots** (`reviewFlagged/parts`), id/FP from **decisions**, dedup to the **latest** decision
per `(run, item)`. Targets: ≥90% identification, ≤2% false-positive.

Seed unit tests (from handoff §5): (a) 10 EXACT-approve + 1 AI/LOW-approve + 1 unmatched-correct →
id rate 10/12; (b) approve-then-reject same item → hits 0, falsePositives 1; (c) snapshot
`review:2,total:15` with **zero decisions** → `reviewFlagged 2, parts 15` (the review-rate-from-
snapshots regression).

---

## Review UI + Stats pages (match the look exactly)

**Fonts (next/font/google):** Plus Jakarta Sans → `--font-sans`, JetBrains Mono → `--font-mono`;
`<body className="font-sans antialiased">`.

**`app/globals.css` `:root`** (RGB channels, space-separated so `bg-accent/10` works) — use these
EXACT values:
```
--background:248 250 252; --foreground:2 6 23; --card:255 255 255;
--primary:15 23 42; --primary-foreground:255 255 255;
--accent:3 105 161; --accent-foreground:255 255 255;
--muted:232 236 241; --muted-foreground:100 116 139;
--border:226 232 240; --ring:15 23 42;
--destructive:220 38 38; --destructive-foreground:255 255 255;
--exact:5 150 105; --fuzzy:217 119 6; --ai:124 58 237; --unmatched:100 116 139;
*{border-color:rgb(var(--border));}
body{background:rgb(var(--background));color:rgb(var(--foreground));}
.tnum{font-variant-numeric:tabular-nums;}
```

**`tailwind.config.ts`** — `const c=(v)=>\`rgb(var(${v}) / <alpha-value>)\``; map `background,
foreground, card, primary{DEFAULT,foreground}, accent{...}, muted{...}, border, ring,
destructive{...}, exact, fuzzy, ai, unmatched`; `fontFamily.sans=['var(--font-sans)',...]`,
`fontFamily.mono=['var(--font-mono)',...]`; `borderRadius {lg:'0.75rem', md:'0.5rem', sm:'0.375rem'}`.

**Match-type chip (signature element):** `rounded-full px-2 py-0.5 text-[11px] font-semibold
uppercase tracking-wide ring-1 ring-inset`, per type `bg-{t}/10 text-{t} ring-{t}/20`. **Bucket →
color:** `EXACT → exact` (emerald), `RULE → fuzzy` (amber), `AI → ai` (violet),
`UNMATCHED → unmatched` (slate).

**Components (mirror the sibling):** page shell/header; run list + history with **StatusChip**
(amber ring `in_progress`, emerald `reviewed`) and "N of M reviewed"; **`ResultsTable`** with
decision state lifted to the table keyed by `op_code`, seeded from `initialDecisions`, optimistic
update only after the POST succeeds, `key={runId}` remount on reopen, filter tabs (All/Matched/
Review/Unmatched) active = `bg-primary text-primary-foreground`, rows `hover:bg-muted/30`,
`thead bg-muted/50`; **stats page** = 3 KPI cards (identification, review, false-positive) + per-run
table, empty state when nothing decided.

---

## Dev, preview & seeding

Develop against a **Neon preview branch** via `PREVIEW_DATABASE_URL`. Seed `service_lines` by
POSTing sample nested op-line JSON to the **live parts `/api/v1/sales`** (Bearer `INGEST_API_KEY`;
payload `{ store:{id,name?}, period:{start,end}, opLines:[{ro,line,opCode,opDescription?,correction?,
payType?,laborSale?,techHours?,saleDate?,parts:[...]}] }`) — our tool only reads the result. Tests
do not touch the DB (pure-logic fixtures only); DB repo + UI are verified manually on preview.

**Env vars to copy from the parts Vercel project** (provided as a walkthrough at build kickoff):
`DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL_UNPOOLED`,
`POSTGRES_URL_NO_SSL` (whichever the parts project has); set fresh `ADMIN_SECRET`; set
`PREVIEW_DATABASE_URL` to the Neon preview-branch connection string.

---

## Testing

Pure logic is unit-tested with Vitest fixtures (co-located `*.test.ts`), no DB:
- `lib/stats.ts` — the three seed tests above (the gate for stats correctness).
- The `service_lines`→`Item[]` aggregation + run-id (`"${store_id}|${batch_id}"`) + gap split
  (learned vs to-classify) — fixture-driven.
- `bucketOf` mapping for every matchType/confidence combination.
DB repo functions and the UI are verified manually against the preview branch (curl + browser).

---

## Build order (handoff §5, adapted)

1. Next.js scaffold + Tailwind/tokens/fonts + `lib/config.ts` resolver + `db/client.ts`.
2. `/api/admin/setup` + `opcode_` table DDL (migration discipline) + seed `opcode_menu_items`.
3. `service_lines` reader + aggregation + gap split + engine wiring (`GET /api/runs`, run compute).
4. `POST /api/decision` (immediate write + learned/blocked) + snapshot lifecycle (`in_progress`→`reviewed`).
5. **Stats engine** (`bucketOf`/`tally`/`computeStats`) — unit-tested first — + `GET /api/stats`.
6. `ResultsTable` (lifted state, initialDecisions, reopen) + run list/history + StatusChip.
7. Stats page (3 KPIs + per-run table) + final polish to match the sibling.
