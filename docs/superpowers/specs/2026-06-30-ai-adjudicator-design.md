# AI Adjudicator — Design (Sub-project 3)

**Date:** 2026-06-30
**Status:** Approved (design); spec pending user review
**Parents:** `opcode-classifier-playbook.md` §5, `docs/superpowers/specs/2026-06-26-identifier-engine-eval-design.md`
**Mirrors:** the sibling parts-matcher AI adjudicator (`~/Projects/moc-part-matcher/engine/anthropicAdjudicator.ts`; map: scratchpad `sibling-ai-map.md`)
**Builds on:** the engine (`engine/`) and the review app (Next.js on Vercel, shared Neon DB).

---

## Goal

Fill the review queue with smart AI suggestions for the op codes the deterministic passes can't
settle. Today the run-detail compute uses a no-op `RecordedAdjudicator`, so ambiguous op codes fall
to Unmatched; this wires a live **`AnthropicAdjudicator`** (Claude) into the engine's `Adjudicator`
seam so those become AI/HIGH|MEDIUM (matched) or AI/LOW (review) verdicts — each confirmed decision
still feeds the learned-mappings loop, so accuracy compounds per dealer.

## Scope

**In:** a live `AnthropicAdjudicator` + a `CachingAdjudicator` decorator + the prompt builder; a DB
verdict cache; run-detail route wiring; graceful degradation when no key is set.

**Out (deferred):** token-budget / dynamic batch sizing beyond fixed `batchSize: 30` + `max_tokens: 4000`;
background precompute; the Sonnet-5 model A/B (env-flip later — see `reminder-revisit-adjudicator-model`).

**Stack:** TypeScript, calls the Anthropic Messages API via **injected `fetch`** (mirrors the sibling; keeps
`engine/` pure and unit-testable — no `@anthropic-ai/sdk` dependency). Vitest for pure-logic tests.

---

## Model & config

- Model from **`ANTHROPIC_MODEL`**, default **`claude-sonnet-4-6`** (matches the sibling). Flipping to a
  newer model later is an env change + an A/B against the eval harness — no code change.
- **`ANTHROPIC_API_KEY`** set in Vercel (Production). Never committed (`.env*` gitignored). The literal
  value is not needed to build — code reads `process.env`.
- `max_tokens: 4000`. No thinking/effort config (short structured classification).

---

## Components

- **`engine/anthropicAdjudicator.ts`** — `class AnthropicAdjudicator implements Adjudicator`.
  Deps injected: `{ fetchImpl, apiKey, model, systemPrompt, maxTokens }`. `adjudicate(items: Item[])`
  processes **one already-bounded batch** (the engine's `identify` owns chunking) → **one** Claude
  Messages call using **tool-use**: a `classify` tool with `tool_choice: { type: "tool", name: "classify" }`,
  input schema an array of `{ index, matched, menuItemId (string|null), confidence ("HIGH"|"MEDIUM"|"LOW"|null), reason }`.
  Maps results by 1-based `index` back to items → `Verdict[]` with `matchType: "AI"`; `matched:false` →
  UNMATCHED. **Validates `menuItemId` against the catalog id set** (hallucinated id → UNMATCHED).
- **`engine/prompt.ts`** — `buildSystemPrompt(catalog, examples)` returns the cached system string
  (policy + catalog block + few-shots — see Prompt policy). `buildUserBatch(items)` renders the batch
  (per item: 1-based index, op code, dominant description, rowCount, and labor/hours means as
  supporting context).
- **`engine/cachingAdjudicator.ts`** — `class CachingAdjudicator implements Adjudicator` decorator:
  `{ inner, getCached, setCached, catalogVersion }`. Computes each item's cache key, reads cached
  verdicts, sends only misses to `inner`, writes fresh verdicts back, merges in input order. Keeps
  caching out of the pure engine (cache backend is injected async functions, not direct DB).
- **`db/repo.ts`** — `getAiVerdicts(sql, hashes: string[])` (batch read), `putAiVerdict(sql, {hash,
  verdict, model, catalogVersion})` (write, `on conflict do nothing`), `buildExamples(sql, storeId)`
  → few-shot pairs from `opcode_learned_mappings` + `opcode_aliases` (dealer-scoped first, then global,
  capped ~14).
- **`app/api/runs/[runId]/route.ts`** — construct the adjudicator: if `ANTHROPIC_API_KEY` is set,
  `new CachingAdjudicator({ inner: new AnthropicAdjudicator({...}), getCached, setCached, catalogVersion })`,
  else `new RecordedAdjudicator(new Map())` (AI disabled, deterministic-only). Pass to
  `identify(items, { learned, adjudicator, catalog: MENU_ITEMS, batchSize: 30 })`.

---

## Data flow

```
run open → GET /api/runs/[runId] → aggregate service_lines → items
  → identify(items, { learned, adjudicator, batchSize: 30 })
       exact / block / deterministic / preAiFilter  → resolve most
       unresolved → chunk(30) → CachingAdjudicator.adjudicate(batch):
            key = sha256(opCode | dominantDescription | catalogVersion)
            cache hit → use stored verdict
            miss      → AnthropicAdjudicator → Claude tool-use → verdict → write cache
       reclassify near-misses
  → results (ResultRow[])
```

`bucketOf` (unchanged) routes **AI + HIGH|MEDIUM → matched**, **AI + LOW → review**, so the review UI
populates automatically — the violet AI chip and Review bucket are already wired. No UI change required.

## Verdict cache

`opcode_ai_verdict_cache` (created by `/setup`; columns `hash PK, verdict jsonb, created_at`, plus
`model`/`catalog_version` added via `add column if not exists`). Key =
`SHA-256("${opCode}|${dominantDescription}|${catalogVersion}")`, `catalogVersion = "v" + MENU_ITEMS.length`.
Read-before-batch, write-after, **best-effort** (get/set errors swallowed — a cache failure must never
break a run). Makes re-opens free and dedupes identical op codes across dealers.

## Prompt policy (op-code adapted, cached prefix)

The system prompt carries `cache_control: { type: "ephemeral" }` so the big catalog/examples block is
billed at ~10% after the first call. Policy:
- **The operation description is the primary signal (~80%); the op code is dealer shorthand (~20%)** —
  read it via the provided learned aliases.
- A description that is a **repair/replacement** (replace pump / rack / compressor / pads / hose) is
  **NOT** the fluid/service menu item — prefer null.
- **Tire operations** return the Tire Service item with the tire **quantity** when the count is present.
- **Labor/tech-hours consistency is a supporting signal only** — use it to *lower* confidence on a
  scattered code; never *raise* confidence based on it.
- **Prefer null over a low-confidence guess.** LOW confidence routes to human review.
- Return `menuItemId` as an exact id from the catalog, or null.

Catalog block: each menu item `id | name | keywords`. Few-shots: `"description" → menuItemId` from
confirmed mappings (dealer-scoped first).

## Errors & edge cases

- **No `ANTHROPIC_API_KEY`** → route uses `RecordedAdjudicator` (AI off; app fully works, deterministic-only).
- **API/parse error** → 3 retries with exponential backoff; on final failure the **whole batch → UNMATCHED**
  (the playbook's safe fallback — a flaky API never breaks a run; differs from the sibling, which 500s).
- **Missing per-item verdict** (API ok, item absent) → UNMATCHED.
- **Invalid/hallucinated `menuItemId`** (not in catalog) → UNMATCHED.
- Verdict-cache get/set failures are swallowed (best-effort).

## Testing

Pure Vitest, **no live API** (inject a fake `fetchImpl`):
- `AnthropicAdjudicator`: canned tool_use response → index→item mapping, `matched:true` → menuItemId +
  confidence, `matched:false` → UNMATCHED, missing-item → UNMATCHED, invalid menuItemId → UNMATCHED;
  `fetchImpl` throws on every attempt → whole batch UNMATCHED (after retries); the request body carries
  `cache_control` on the system block and forced `tool_choice`.
- `buildSystemPrompt` → contains the policy lines, every catalog id, and the example pairs.
- `CachingAdjudicator` with injected get/set maps → cache hit skips `inner`; miss calls `inner` and writes;
  merge preserves input order.

DB repo functions + the route are verified on Vercel: set `ANTHROPIC_API_KEY`, open a run → AI rows fill
the Review bucket, `opcode_ai_verdict_cache` populates, a re-open is instant (cache hit), and confirming
an AI suggestion writes an `opcode_learned_mappings` row so it auto-resolves next time.

## Build order

1. `engine/prompt.ts` (`buildSystemPrompt` + `buildUserBatch`) — pure, tested.
2. `engine/anthropicAdjudicator.ts` — pure (injected `fetch`), tested with a fake.
3. `engine/cachingAdjudicator.ts` — pure (injected cache backend), tested.
4. `db/repo.ts` — `getAiVerdicts` / `putAiVerdict` / `buildExamples`; `/setup` `add column if not exists`
   for `model` / `catalog_version` on `opcode_ai_verdict_cache`.
5. Route wiring in `app/api/runs/[runId]/route.ts` (with the no-key `RecordedAdjudicator` fallback).
6. Vercel verification (key set) — end-to-end.
