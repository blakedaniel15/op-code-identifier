# AI Adjudicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a live Claude `AnthropicAdjudicator` into the engine's `Adjudicator` seam so the ambiguous op codes the deterministic passes can't settle get AI match suggestions in the review queue, with a DB verdict cache and graceful no-key degradation.

**Architecture:** A pure `AnthropicAdjudicator` (Anthropic Messages API via injected `fetch`, tool-use `classify`) is wrapped by a pure `CachingAdjudicator` decorator (verdict cache backend injected as async functions). The run-detail route builds them from env + catalog + few-shot examples and passes them into the existing `identify` pipeline; with no `ANTHROPIC_API_KEY` it falls back to `RecordedAdjudicator`.

**Tech Stack:** TypeScript, Anthropic Messages API (raw `fetch`, no SDK — mirrors the sibling), Vitest, Neon (tagged-template).

## Global Constraints

- `engine/` stays pure — no DB/network imports; the adjudicator takes `fetch`/cache backends as injected deps (unit-testable with fakes).
- Model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`); key from `ANTHROPIC_API_KEY`; never committed.
- Tool-use with forced `tool_choice: { type: "tool", name: "classify" }`; per-item verdict `{ index, matched, menuItemId, confidence, quantity?, reason }`; `max_tokens: 4000`.
- System prompt carries `cache_control: { type: "ephemeral" }`.
- `matched:false`, missing verdict, or a `menuItemId` not in the catalog → UNMATCHED. API error after retries → whole batch UNMATCHED (never break a run).
- Verdict cache key = `SHA-256("${opCode}|${dominantNormalizedDescription}|${catalogVersion}")`, `catalogVersion = "v" + MENU_ITEMS.length`; cache get/set are best-effort.
- `batchSize: 30` when running with the live adjudicator.
- No live API calls in tests (inject a fake `fetch`).

### Toolchain (npm broken; node at $NB)
- `export NB=/private/tmp/node-v20.11.1-darwin-arm64/bin` (reinstall deps first if `node_modules` was wiped: `PATH=$NB:$PATH node /private/tmp/package/bin/npm-cli.js install`)
- Test: `PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run <file>`
- Typecheck: `PATH=$NB:$PATH node node_modules/typescript/bin/tsc --noEmit`
- Next build (best-effort): `PATH=$NB:$PATH node node_modules/next/dist/bin/next build`. Runtime verified on Vercel.

---

## File Structure

```
engine/prompt.ts              buildSystemPrompt, buildUserBatch        Task 1
engine/anthropicAdjudicator.ts AnthropicAdjudicator + classify tool    Task 2
engine/cachingAdjudicator.ts   verdictCacheKey, CachingAdjudicator     Task 3
db/repo.ts (modify)            getAiVerdicts, putAiVerdict, buildExamples  Task 4
db/migrate.ts (modify)         add model/catalog_version columns        Task 4
lib/identify-run.ts (modify)   accept an injected adjudicator + batchSize  Task 5
app/api/runs/[runId]/route.ts (modify)  build + inject the adjudicator  Task 5
```

---

### Task 1: Prompt builder

**Files:** Create `engine/prompt.ts`, `engine/prompt.test.ts`.

**Interfaces:**
- Consumes: `MenuItem` from `engine/types`, `Item` from `engine/types`, `dominantCluster` from `engine/normalize`.
- Produces: `buildSystemPrompt(catalog: MenuItem[], examples: {description:string;menuItemId:string}[]): string`; `buildUserBatch(items: Item[]): string`.

- [ ] **Step 1: Write the failing test `engine/prompt.test.ts`**

```ts
import { buildSystemPrompt, buildUserBatch } from './prompt';
import { MENU_ITEMS } from './catalog';
import type { Item } from './types';

test('system prompt carries policy, every catalog id, and the examples', () => {
  const p = buildSystemPrompt(MENU_ITEMS, [{ description: 'BRAKE FLUID EXCHANGE', menuItemId: 'brake_fluid' }]);
  expect(p).toMatch(/primary signal/i);
  expect(p).toMatch(/repair or replacement/i);
  expect(p).toContain('alignment');
  expect(p).toContain('brake_fluid');
  expect(p).toContain('"BRAKE FLUID EXCHANGE" → brake_fluid');
});

test('user batch numbers each line 1-based with op code + description', () => {
  const items: Item[] = [
    { dealerKey: 'd', opCode: 'A4', descriptions: [{ text: '4 WHEEL ALIGNMENT', count: 2 }], laborValues: [], hoursValues: [], rowCount: 2 },
  ];
  const b = buildUserBatch(items);
  expect(b).toContain('1. op_code=A4');
  expect(b).toContain('4 WHEEL ALIGNMENT');
});
```

- [ ] **Step 2: Run test → FAIL** (`PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run engine/prompt.test.ts`).

- [ ] **Step 3: Write `engine/prompt.ts`**

```ts
import type { Item, MenuItem } from './types';
import { dominantCluster } from './normalize';

export function buildSystemPrompt(catalog: MenuItem[], examples: { description: string; menuItemId: string }[]): string {
  const cat = catalog.map((m) => `${m.id} | ${m.name} | ${[...m.required, ...m.requiredAlso].join(', ')}`).join('\n');
  const ex = examples.map((e) => `"${e.description}" → ${e.menuItemId}`).join('\n');
  return [
    'You classify automotive dealership repair-order op codes into a fixed list of service menu items, or none.',
    '',
    'POLICY:',
    '- The operation DESCRIPTION is the primary signal (~80%). The op code is dealer-specific shorthand (~20%) — read it via the learned examples below.',
    '- A description that is a REPAIR or REPLACEMENT of a component (replace pump, rack, compressor, brake pads, hose) is NOT the fluid/service menu item. Prefer none.',
    '- Tire operations: return the tire menu item and the tire QUANTITY (1-4) when the count is present.',
    '- Labor-sale and tech-hours consistency is a SUPPORTING signal only: use it to LOWER confidence on a scattered code. NEVER raise confidence based on it.',
    '- Prefer null over a low-confidence guess. Use LOW confidence for a plausible-but-unsure match (it routes to human review).',
    '- Return menuItemId as an EXACT id from the catalog below, or null. Never invent an id.',
    '',
    'MENU ITEMS (id | name | keywords):',
    cat,
    ...(examples.length ? ['', 'EXAMPLES (confirmed by reviewers):', ex] : []),
  ].join('\n');
}

export function buildUserBatch(items: Item[]): string {
  const lines = items.map((it, i) => {
    const desc = dominantCluster(it.descriptions).raw || '(no description)';
    return `${i + 1}. op_code=${it.opCode} | description="${desc}" | rows=${it.rowCount}`;
  });
  return 'Classify each op-code line. Call the classify tool with one verdict per line, addressed by its 1-based index.\n\n' + lines.join('\n');
}
```

- [ ] **Step 4: Run test → PASS** (2). Then `tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add engine/prompt.ts engine/prompt.test.ts && git commit -m "feat: AI adjudicator prompt builder (system + user batch)"`

---

### Task 2: AnthropicAdjudicator

**Files:** Create `engine/anthropicAdjudicator.ts`, `engine/anthropicAdjudicator.test.ts`.

**Interfaces:**
- Consumes: `Adjudicator` from `engine/adjudicator`; `Item`, `Verdict`, `Confidence` from `engine/types`.
- Produces: `class AnthropicAdjudicator implements Adjudicator`; `type FetchLike`; `interface AnthropicAdjudicatorDeps { fetchImpl: FetchLike; apiKey: string; model: string; systemPrompt: string; menuItemIds: Set<string>; buildUserBatch: (items: Item[]) => string; maxTokens?: number; maxRetries?: number; delayMs?: number }`.

- [ ] **Step 1: Write the failing test `engine/anthropicAdjudicator.test.ts`**

```ts
import { AnthropicAdjudicator, type FetchLike } from './anthropicAdjudicator';
import type { Item } from './types';

const items: Item[] = [
  { dealerKey: 'd', opCode: 'A4', descriptions: [{ text: '4 WHEEL ALIGNMENT', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 },
  { dealerKey: 'd', opCode: 'ZZ', descriptions: [{ text: 'MYSTERY', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 },
];
const menuItemIds = new Set(['alignment', 'coolant']);
const mk = (fetchImpl: FetchLike) => new AnthropicAdjudicator({
  fetchImpl, apiKey: 'k', model: 'claude-sonnet-4-6', systemPrompt: 'SYS',
  menuItemIds, buildUserBatch: () => 'BATCH', delayMs: 0,
});

function respond(verdicts: unknown[]): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'classify', input: { verdicts } }] }) });
}

test('maps matched verdicts by 1-based index; unmatched/invalid → UNMATCHED', async () => {
  const out = await mk(respond([
    { index: 1, matched: true, menuItemId: 'alignment', confidence: 'HIGH', reason: 'ok' },
    { index: 2, matched: true, menuItemId: 'not_a_real_id', confidence: 'HIGH', reason: 'x' },
  ])).adjudicate(items);
  expect(out[0]).toMatchObject({ menuItemId: 'alignment', matchType: 'AI', confidence: 'HIGH' });
  expect(out[1]).toMatchObject({ menuItemId: null, matchType: 'UNMATCHED' }); // hallucinated id
});

test('a missing per-item verdict → UNMATCHED', async () => {
  const out = await mk(respond([{ index: 1, matched: true, menuItemId: 'alignment', confidence: 'MEDIUM', reason: 'ok' }])).adjudicate(items);
  expect(out[1].matchType).toBe('UNMATCHED');
});

test('matched:false → UNMATCHED', async () => {
  const out = await mk(respond([{ index: 1, matched: false, menuItemId: null, confidence: null, reason: 'no' }])).adjudicate([items[0]!]);
  expect(out[0].matchType).toBe('UNMATCHED');
});

test('fetch failing every attempt → whole batch UNMATCHED (no throw)', async () => {
  const out = await mk(async () => { throw new Error('network'); }).adjudicate(items);
  expect(out.map((v) => v.matchType)).toEqual(['UNMATCHED', 'UNMATCHED']);
});

test('request body carries cached system block + forced tool_choice', async () => {
  let body: any;
  const fetchImpl: FetchLike = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'classify', input: { verdicts: [] } }] }) };
  };
  await mk(fetchImpl).adjudicate([items[0]!]);
  expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(body.tool_choice).toEqual({ type: 'tool', name: 'classify' });
  expect(body.model).toBe('claude-sonnet-4-6');
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `engine/anthropicAdjudicator.ts`**

```ts
import type { Adjudicator } from './adjudicator';
import type { Confidence, Item, Verdict } from './types';

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface AnthropicAdjudicatorDeps {
  fetchImpl: FetchLike;
  apiKey: string;
  model: string;
  systemPrompt: string;
  menuItemIds: Set<string>;
  buildUserBatch: (items: Item[]) => string;
  maxTokens?: number;
  maxRetries?: number;
  delayMs?: number;
}

const CLASSIFY_TOOL = {
  name: 'classify',
  description: 'Return one verdict per op-code line, addressed by its 1-based index.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            matched: { type: 'boolean' },
            menuItemId: { type: ['string', 'null'] },
            confidence: { type: ['string', 'null'], enum: ['HIGH', 'MEDIUM', 'LOW', null] },
            quantity: { type: ['integer', 'null'] },
            reason: { type: 'string' },
          },
          required: ['index', 'matched', 'menuItemId', 'confidence', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

function unmatched(reason: string): Verdict {
  return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason };
}
function normConfidence(c: unknown): Confidence {
  return c === 'HIGH' || c === 'MEDIUM' || c === 'LOW' ? c : 'LOW';
}

export class AnthropicAdjudicator implements Adjudicator {
  constructor(private readonly deps: AnthropicAdjudicatorDeps) {}

  async adjudicate(items: Item[]): Promise<Verdict[]> {
    if (items.length === 0) return [];
    try {
      return this.map(items, await this.call(items));
    } catch {
      return items.map(() => unmatched('AI adjudication failed; defaulted to UNMATCHED.'));
    }
  }

  private async call(items: Item[]): Promise<any[]> {
    const body = {
      model: this.deps.model,
      max_tokens: this.deps.maxTokens ?? 4000,
      system: [{ type: 'text', text: this.deps.systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'classify' },
      messages: [{ role: 'user', content: this.deps.buildUserBatch(items) }],
    };
    const retries = this.deps.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await this.deps.fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': this.deps.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const data = await res.json();
        const block = (data.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === 'classify');
        if (!block || !Array.isArray(block.input?.verdicts)) throw new Error('no classify tool_use');
        return block.input.verdicts;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, (this.deps.delayMs ?? 200) * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  private map(items: Item[], verdicts: any[]): Verdict[] {
    const byIndex = new Map<number, any>();
    for (const v of verdicts) if (typeof v?.index === 'number') byIndex.set(v.index, v);
    return items.map((_, i) => {
      const v = byIndex.get(i + 1);
      if (!v || v.matched !== true || typeof v.menuItemId !== 'string' || !this.deps.menuItemIds.has(v.menuItemId)) {
        return unmatched(typeof v?.reason === 'string' ? v.reason : 'No AI match.');
      }
      const verdict: Verdict = { menuItemId: v.menuItemId, matchType: 'AI', confidence: normConfidence(v.confidence), reason: typeof v.reason === 'string' ? v.reason : '' };
      if (typeof v.quantity === 'number' && v.quantity >= 1 && v.quantity <= 4) verdict.quantity = v.quantity;
      return verdict;
    });
  }
}
```

- [ ] **Step 4: Run test → PASS** (5). `tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add engine/anthropicAdjudicator.ts engine/anthropicAdjudicator.test.ts && git commit -m "feat: AnthropicAdjudicator (tool-use, cached prefix, UNMATCHED fallback)"`

---

### Task 3: CachingAdjudicator

**Files:** Create `engine/cachingAdjudicator.ts`, `engine/cachingAdjudicator.test.ts`.

**Interfaces:**
- Consumes: `Adjudicator` from `engine/adjudicator`; `Item`, `Verdict` from `engine/types`; `dominantCluster` from `engine/normalize`; `node:crypto`.
- Produces: `verdictCacheKey(item: Item, catalogVersion: string): string`; `class CachingAdjudicator implements Adjudicator`; `interface CachingAdjudicatorDeps { inner: Adjudicator; getCached: (hashes: string[]) => Promise<Map<string, Verdict>>; setCached: (entries: { hash: string; verdict: Verdict }[]) => Promise<void>; catalogVersion: string }`.

- [ ] **Step 1: Write the failing test `engine/cachingAdjudicator.test.ts`**

```ts
import { CachingAdjudicator, verdictCacheKey } from './cachingAdjudicator';
import type { Adjudicator, Item, Verdict } from './types';

const item = (op: string): Item => ({ dealerKey: 'd', opCode: op, descriptions: [{ text: op + ' DESC', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 });

test('cache hit skips inner; miss calls inner and is written; order preserved', async () => {
  const A = item('A'), B = item('B');
  const keyA = verdictCacheKey(A, 'v16'), keyB = verdictCacheKey(B, 'v16');
  const innerCalls: string[][] = [];
  const inner: Adjudicator = { async adjudicate(items) { innerCalls.push(items.map((i) => i.opCode)); return items.map(() => ({ menuItemId: 'coolant', matchType: 'AI', confidence: 'MEDIUM', reason: 'inner' } as Verdict)); } };
  const cachedA: Verdict = { menuItemId: 'alignment', matchType: 'AI', confidence: 'HIGH', reason: 'cached' };
  const writes: { hash: string; verdict: Verdict }[] = [];
  const adj = new CachingAdjudicator({ inner, catalogVersion: 'v16', getCached: async () => new Map([[keyA, cachedA]]), setCached: async (e) => { writes.push(...e); } });
  const out = await adj.adjudicate([A, B]);
  expect(innerCalls).toEqual([['B']]);
  expect(out[0]).toEqual(cachedA);
  expect(out[1]!.reason).toBe('inner');
  expect(writes.map((w) => w.hash)).toEqual([keyB]);
});

test('cache backend errors are swallowed (still returns verdicts)', async () => {
  const inner: Adjudicator = { async adjudicate(items) { return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: 'x' } as Verdict)); } };
  const adj = new CachingAdjudicator({ inner, catalogVersion: 'v16', getCached: async () => { throw new Error('db'); }, setCached: async () => { throw new Error('db'); } });
  const out = await adj.adjudicate([item('A')]);
  expect(out).toHaveLength(1);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Write `engine/cachingAdjudicator.ts`**

```ts
import { createHash } from 'node:crypto';
import type { Adjudicator } from './adjudicator';
import type { Item, Verdict } from './types';
import { dominantCluster } from './normalize';

export function verdictCacheKey(item: Item, catalogVersion: string): string {
  const dom = dominantCluster(item.descriptions).normalized;
  return createHash('sha256').update(`${item.opCode}|${dom}|${catalogVersion}`).digest('hex');
}

export interface CachingAdjudicatorDeps {
  inner: Adjudicator;
  getCached: (hashes: string[]) => Promise<Map<string, Verdict>>;
  setCached: (entries: { hash: string; verdict: Verdict }[]) => Promise<void>;
  catalogVersion: string;
}

export class CachingAdjudicator implements Adjudicator {
  constructor(private readonly deps: CachingAdjudicatorDeps) {}

  async adjudicate(items: Item[]): Promise<Verdict[]> {
    if (items.length === 0) return [];
    const keys = items.map((it) => verdictCacheKey(it, this.deps.catalogVersion));
    let cached = new Map<string, Verdict>();
    try { cached = await this.deps.getCached([...new Set(keys)]); } catch { /* best-effort */ }

    const missIdx: number[] = [];
    for (let i = 0; i < items.length; i++) if (!cached.has(keys[i]!)) missIdx.push(i);

    const freshByKey = new Map<string, Verdict>();
    if (missIdx.length) {
      const fresh = await this.deps.inner.adjudicate(missIdx.map((i) => items[i]!));
      missIdx.forEach((i, j) => { const v = fresh[j]; if (v) freshByKey.set(keys[i]!, v); });
      try {
        const writes = [...freshByKey.entries()].map(([hash, verdict]) => ({ hash, verdict }));
        if (writes.length) await this.deps.setCached(writes);
      } catch { /* best-effort */ }
    }

    return items.map((_, i) =>
      cached.get(keys[i]!) ?? freshByKey.get(keys[i]!) ?? { menuItemId: null, matchType: 'UNMATCHED' as const, confidence: 'LOW' as const, reason: 'No verdict.' },
    );
  }
}
```

- [ ] **Step 4: Run test → PASS** (2). `tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add engine/cachingAdjudicator.ts engine/cachingAdjudicator.test.ts && git commit -m "feat: CachingAdjudicator decorator + verdict cache key"`

---

### Task 4: Verdict-cache repo + /setup columns

**Files:** Modify `db/repo.ts`, `db/migrate.ts`. (tsc + existing `db/migrate.test.ts` stay green.)

**Interfaces:**
- Produces: `getAiVerdicts(sql, hashes: string[]): Promise<Map<string, any>>`, `putAiVerdict(sql, e: { hash; verdict; model; catalogVersion }): Promise<void>`, `buildExamples(sql, storeId): Promise<{ description: string; menuItemId: string }[]>`.

- [ ] **Step 1: Add repo functions to `db/repo.ts`**

```ts
export async function getAiVerdicts(sql: Sql, hashes: string[]): Promise<Map<string, any>> {
  if (hashes.length === 0) return new Map();
  const rows = await sql`select hash, verdict from opcode_ai_verdict_cache where hash = any(${hashes})`;
  return new Map(rows.map((r: any) => [r.hash, r.verdict]));
}

export async function putAiVerdict(sql: Sql, e: { hash: string; verdict: unknown; model: string; catalogVersion: string }) {
  await sql`insert into opcode_ai_verdict_cache (hash, verdict, model, catalog_version)
    values (${e.hash}, ${JSON.stringify(e.verdict)}, ${e.model}, ${e.catalogVersion})
    on conflict (hash) do nothing`;
}

export async function buildExamples(sql: Sql, storeId: string): Promise<{ description: string; menuItemId: string }[]> {
  const rows = await sql`select op_description as description, menu_item_id as "menuItemId"
    from opcode_learned_mappings
    where store_id = ${storeId} and op_description <> ''
    order by created_at desc limit 14`;
  return rows.map((r: any) => ({ description: r.description, menuItemId: r.menuItemId }));
}
```

- [ ] **Step 2: Add the two columns to `db/migrate.ts` `migrationStatements()`** — append these entries to the returned array (after the `opcode_known` create):

```ts
    `alter table opcode_ai_verdict_cache add column if not exists model text`,
    `alter table opcode_ai_verdict_cache add column if not exists catalog_version text`,
```

- [ ] **Step 3: Verify** — `PATH=$NB:$PATH node node_modules/vitest/vitest.mjs run db/migrate.test.ts` (still passes — the existing tests assert opcode_ prefixing and single-DDL-per-statement, both hold for the alter lines). Then `tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git add db/repo.ts db/migrate.ts && git commit -m "feat: verdict-cache repo (get/put) + examples; /setup ai-cache columns"`

---

### Task 5: Wire the adjudicator into the run route

**Files:** Modify `lib/identify-run.ts` (accept an injected adjudicator), `app/api/runs/[runId]/route.ts`. Test: extend `lib/identify-run.test.ts`. (tsc-gated; runtime on Vercel.)

**Interfaces:**
- `identifyRun(items: Item[], learned: Map<string,string>, adjudicator?: Adjudicator, batchSize?: number): Promise<ResultRow[]>` — defaults to `new RecordedAdjudicator(new Map())` + `batchSize 30`.

- [ ] **Step 1: Modify `lib/identify-run.ts`** — accept the adjudicator + batchSize (keep the default so existing callers/tests work):

```ts
import { identify } from '@/engine/identify';
import { RecordedAdjudicator } from '@/engine/adjudicator';
import type { Adjudicator } from '@/engine/adjudicator';
import { MENU_ITEMS } from '@/engine/catalog';
import { dominantCluster } from '@/engine/normalize';
import { itemKey, type Item } from '@/engine/types';

// ... ResultRow interface + mean() unchanged ...

export async function identifyRun(
  items: Item[],
  learned: Map<string, string>,
  adjudicator: Adjudicator = new RecordedAdjudicator(new Map()),
  batchSize = 30,
): Promise<ResultRow[]> {
  const verdicts = await identify(items, { learned, adjudicator, catalog: MENU_ITEMS, batchSize });
  // ... existing mapping to ResultRow unchanged ...
}
```

- [ ] **Step 2: Add a test to `lib/identify-run.test.ts`** confirming an injected adjudicator is used for unknown op codes:

```ts
import type { Adjudicator } from '@/engine/adjudicator';
test('an injected adjudicator classifies the unresolved op codes', async () => {
  const adj: Adjudicator = { async adjudicate(items) { return items.map(() => ({ menuItemId: 'coolant', matchType: 'AI' as const, confidence: 'MEDIUM' as const, reason: 'ai' })); } };
  const rows = await identifyRun([mk('ZZ', 'MYSTERY CODE')], new Map(), adj);
  const zz = rows.find((r) => r.opCode === 'ZZ')!;
  expect(zz).toMatchObject({ matchType: 'AI', menuItemId: 'coolant', confidence: 'MEDIUM' });
});
```

- [ ] **Step 3: Run the identify-run test → PASS** (new + existing).

- [ ] **Step 4: Wire `app/api/runs/[runId]/route.ts`** — build the adjudicator from env and pass it in. Add imports and replace the `identifyRun(serviceLinesToItems(rows), learned)` call:

```ts
import { MENU_ITEMS } from '@/engine/catalog';
import { buildSystemPrompt, buildUserBatch } from '@/engine/prompt';
import { AnthropicAdjudicator } from '@/engine/anthropicAdjudicator';
import { CachingAdjudicator } from '@/engine/cachingAdjudicator';
import { RecordedAdjudicator, type Adjudicator } from '@/engine/adjudicator';
import { getAiVerdicts, putAiVerdict, buildExamples } from '@/db/repo';
import type { Verdict } from '@/engine/types';

const CATALOG_VERSION = 'v' + MENU_ITEMS.length;
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

async function buildAdjudicator(sql: any, storeId: string): Promise<Adjudicator> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new RecordedAdjudicator(new Map());
  const examples = await buildExamples(sql, storeId);
  const inner = new AnthropicAdjudicator({
    fetchImpl: (u, i) => fetch(u, i),
    apiKey, model: MODEL,
    systemPrompt: buildSystemPrompt(MENU_ITEMS, examples),
    menuItemIds: new Set(MENU_ITEMS.map((m) => m.id)),
    buildUserBatch,
  });
  return new CachingAdjudicator({
    inner, catalogVersion: CATALOG_VERSION,
    getCached: (hashes) => getAiVerdicts(sql, hashes) as Promise<Map<string, Verdict>>,
    setCached: async (entries) => { for (const e of entries) await putAiVerdict(sql, { hash: e.hash, verdict: e.verdict, model: MODEL, catalogVersion: CATALOG_VERSION }); },
  });
}
```

Then in the `GET` handler, after `storeId`/`rows`/`learned` are loaded, replace the results line with:

```ts
  const adjudicator = await buildAdjudicator(sql, storeId);
  const results = await identifyRun(serviceLinesToItems(rows), learned, adjudicator);
```

- [ ] **Step 5: Verify** — `tsc --noEmit` clean; full suite green; best-effort `next build`.

- [ ] **Step 6: Commit** — `git add lib/identify-run.ts lib/identify-run.test.ts app/api/runs/[runId]/route.ts && git commit -m "feat: inject the live AI adjudicator into the run route (key-gated)"`

---

### Task 6: Vercel end-to-end verification

**Files:** none (ops). The app gate.

- [ ] **Step 1:** Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) in the Vercel project env vars; redeploy.
- [ ] **Step 2:** Re-run `POST /api/admin/setup` (adds the `model`/`catalog_version` columns to `opcode_ai_verdict_cache`; safe to re-run).
- [ ] **Step 3:** Open a run with previously-Unmatched op codes → confirm some now show as **AI** matches (violet chip) in the Review/Matched buckets with a reason; verify `opcode_ai_verdict_cache` rows appear (query the DB).
- [ ] **Step 4:** Re-open the same run → confirm it's instant (verdict-cache hit, no new API call).
- [ ] **Step 5:** Approve an AI suggestion → confirm an `opcode_learned_mappings` row is written so it auto-resolves (EXACT) on the next batch. Fix anything that misbehaves.

---

## Self-Review

**1. Spec coverage:**
- `AnthropicAdjudicator` (tool-use, injected fetch, model/max_tokens, index mapping, id validation) → Task 2. ✓
- Prompt policy + cached prefix + catalog + few-shots → Task 1 (+ cache_control asserted in Task 2). ✓
- `CachingAdjudicator` + verdict cache key + best-effort → Task 3. ✓
- Verdict-cache table (columns) + repo get/put + examples → Task 4. ✓
- Route wiring + no-key `RecordedAdjudicator` fallback + batchSize 30 → Task 5. ✓
- Errors: retries→batch UNMATCHED, missing/invalid→UNMATCHED, cache best-effort → Tasks 2, 3. ✓
- Env `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` → Task 5. ✓
- bucketOf routes AI verdicts (no UI change) → inherent; verified Task 6. ✓
- Deferred (token budget, precompute, model A/B) → nothing adds them. ✓

**2. Placeholder scan:** every code step is complete; the route task shows the exact new imports, helper, and the two changed lines (existing `identifyRun` mapping body is unchanged, so it's referenced, not re-pasted). ✓

**3. Type consistency:** `Adjudicator`/`Item`/`Verdict`/`Confidence` from the engine; `FetchLike` and the deps interfaces defined in Task 2 and consumed in Task 5; `verdictCacheKey`/`CachingAdjudicator` defined Task 3, consumed Task 5; `getAiVerdicts`/`putAiVerdict`/`buildExamples` defined Task 4, consumed Task 5; `identifyRun` new signature (Task 5) is backward-compatible with its existing callers. ✓
