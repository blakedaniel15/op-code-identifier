# Identifier Engine + Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, network-free TypeScript identifier engine plus an eval harness that proves accuracy (≥90% identification / ≤2% false-positive) against a real dealer's labeled data before any DB, UI, or live AI is wired.

**Architecture:** A distinct op code (aggregated across its rows) flows through ordered earliest-wins passes — exact → block → deterministic keyword → pre-AI filter → adjudicator → reclassify. The description is the primary signal; labor/hours consistency (CV) is a supporting-only confidence modifier; the AI step sits behind an `Adjudicator` interface (a no-network `RecordedAdjudicator` in this sub-project) and the orchestrator owns batching.

**Tech Stack:** TypeScript (strict), Vitest, npm, papaparse (CSV parsing in scripts only).

## Global Constraints

- TypeScript strict mode; no `any` in exported signatures.
- Network-free: no HTTP, no DB, no live model calls anywhere in `engine/` or `eval/`.
- No live token-budget / `max_tokens` / dynamic-batch logic (deferred to a later sub-project).
- Menu-item `name` values MUST equal the dealer business `Service Name` strings exactly (eval scores by exact equality).
- Two separate axes on every `Verdict`: `matchType ∈ {EXACT,RULE,AI,UNMATCHED}` and `confidence ∈ {EXACT,HIGH,MEDIUM,LOW}` — never collapsed.
- Every menu item carries `disqualify` keywords (the primary false-positive guard).
- Accuracy bar (CI gate): ≥90% identification, ≤2% false-positive on eval tier-1 (Deacon Jones).
- Description matching always uses the **dominant** normalized description cluster, never minority rows.
- **Commits are deferred** until after Task 1 establishes the skeleton: Task 1's final step runs `git init` and the first commit; every task after commits normally. GitHub remote creation is out of scope here (the user will create the repo).

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts   Task 1
engine/types.ts        Item, Verdict, MenuItem, MatchType, Confidence, etc.   Task 1
engine/normalize.ts    normalizeForComparison, tokenize, dominantCluster      Task 2
engine/matching.ts     evaluateMenuItem, detectTireQuantity, containsKeyword  Task 3
engine/catalog.ts      MENU_ITEMS, getMenuItem, businessLabel                 Task 4
engine/stats.ts        coefficientOfVariation, applyStatsModifier             Task 5
engine/aggregate.ts    aggregateRows                                          Task 6
engine/passes/exact.ts        exactPass                                       Task 7
engine/passes/block.ts        blockPass, BLOCK_PATTERNS                       Task 8
engine/passes/deterministic.ts deterministicPass                             Task 9
engine/passes/preAiFilter.ts  preAiFilterPass, REPAIR_PATTERNS               Task 10
engine/passes/reclassify.ts   reclassifyPass                                  Task 11
engine/adjudicator.ts  Adjudicator, RecordedAdjudicator                       Task 12
engine/identify.ts     identify (orchestrator + batching)                     Task 13
eval/metrics.ts        computeMetrics                                         Task 14
eval/harness.ts        runEval                                                Task 15
scripts/build-ground-truth.ts  CSV -> fixture                                 Task 15
eval/ground-truth/deacon_jones.json   generated fixture                       Task 15
```

All tests live next to their module as `*.test.ts`.

---

### Task 1: Project scaffold + types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `engine/types.ts`
- Test: `engine/types.test.ts`

**Interfaces:**
- Produces: all shared types (below), imported by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "op-code-identifier",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "eval": "tsx eval/harness.ts",
    "build:ground-truth": "tsx scripts/build-ground-truth.ts"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "tsx": "^4.7.0",
    "papaparse": "^5.4.1",
    "@types/papaparse": "^5.3.14"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["engine", "eval", "scripts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, include: ['**/*.test.ts'] } });
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
data/*.csv
!data/.gitkeep
```

- [ ] **Step 5: Create `engine/types.ts`**

```ts
export type MatchType = 'EXACT' | 'RULE' | 'AI' | 'UNMATCHED';
export type Confidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DescriptionCount { text: string; count: number; }

export interface Item {
  dealerKey: string;
  opCode: string;
  descriptions: DescriptionCount[];
  laborValues: number[];
  hoursValues: number[];
  rowCount: number;
}

export interface MenuItem {
  id: string;
  name: string;            // == business Service Name string
  required: string[];      // at least one must appear
  requiredAlso: string[];  // at least one must appear (empty = no second gate)
  disqualify: string[];    // none may appear
  isTire?: boolean;        // tire item carries a quantity
}

export interface StatsEffect {
  laborCv: number | null;
  hoursCv: number | null;
  effect: 'bumped' | 'capped' | 'none';
}

export interface Verdict {
  menuItemId: string | null;
  matchType: MatchType;
  confidence: Confidence;
  quantity?: number;
  reason: string;
  supportingStats?: StatsEffect;
}

export function itemKey(item: Pick<Item, 'dealerKey' | 'opCode'>): string {
  return `${item.dealerKey}::${item.opCode}`;
}
```

- [ ] **Step 6: Write the failing test `engine/types.test.ts`**

```ts
import { itemKey } from './types';
test('itemKey joins dealer and op code', () => {
  expect(itemKey({ dealerKey: 'deacon', opCode: 'A4' })).toBe('deacon::A4');
});
```

- [ ] **Step 7: Install deps and run test to verify it passes**

Run: `npm install && npx vitest run engine/types.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Initialize git and make the first commit**

```bash
git init
git add -A
git commit -m "chore: scaffold identifier engine project + shared types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Description normalization

**Files:**
- Create: `engine/normalize.ts`
- Test: `engine/normalize.test.ts`

**Interfaces:**
- Consumes: `DescriptionCount` from `engine/types.ts`.
- Produces:
  - `normalizeForComparison(desc: string): string` — lowercased, brand/acronym-expanded, numbers/punctuation stripped, single-spaced.
  - `tokenize(desc: string): string[]` — normalized, stopword-filtered, synonym-mapped content tokens.
  - `dominantCluster(descriptions: DescriptionCount[]): { raw: string; normalized: string; count: number; uniqueNormalized: number }`.

- [ ] **Step 1: Write the failing test `engine/normalize.test.ts`**

```ts
import { normalizeForComparison, tokenize, dominantCluster } from './normalize';

test('expands a/c and strips numbers/punctuation', () => {
  expect(normalizeForComparison('Recharge A/C $69.95')).toBe('recharge ac');
  expect(normalizeForComparison('4 WHEEL ALIGNMENT')).toBe('wheel alignment');
});

test('tokenize drops stopwords and applies synonyms', () => {
  // "replace" is a stopword; "injection" -> "injector"
  expect(tokenize('REPLACE FUEL INJECTION SERVICE')).toEqual(['fuel', 'injector']);
});

test('dominantCluster picks the most repeated normalized description', () => {
  const d = dominantCluster([
    { text: 'REPLACE CABIN FILTER = $69.95', count: 3 },
    { text: 'REPLACE CABIN FILTER = $55.00', count: 2 },
    { text: 'CONFIRM FRAME VIN', count: 1 },
  ]);
  expect(d.normalized).toBe('replace cabin filter');
  expect(d.count).toBe(5); // two price variants collapse to one cluster
  expect(d.uniqueNormalized).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/normalize.test.ts`
Expected: FAIL ("Failed to resolve import './normalize'").

- [ ] **Step 3: Write `engine/normalize.ts`**

```ts
import type { DescriptionCount } from './types';

const STOPWORDS = new Set([
  'a','an','the','and','or','of','to','in','on','for','per','with','without','at','by','from','up','as',
  'is','are','was','were','be','been','being','perform','performed','performing','complete','completed',
  'replace','replaced','replacing','install','installed','installing','new','done','all','this','that',
  'these','those','change','changed','changing','customer','vehicle','work','order','also','full','every',
  'each','only','will','need','needs','part','parts',
]);

const SYNONYMS: Record<string, string> = {
  injection: 'injector', injections: 'injector', injectors: 'injector', inject: 'injector',
  transmisssion: 'transmission', tranmission: 'transmission', tranny: 'transmission',
  differentials: 'differential', diffrential: 'differential', differenial: 'differential',
  filters: 'filter', flushed: 'flush', flushing: 'flush', align: 'alignment', alignments: 'alignment',
  coolants: 'coolant', antifreeze: 'coolant', tires: 'tire', maint: 'maintenance',
};

export function normalizeForComparison(desc: string): string {
  if (!desc) return '';
  let d = String(desc).toLowerCase();
  d = d.replace(/\ba\s*\/\s*c\b/g, 'ac');
  d = d.replace(/\bair[\s-]+conditioning\b/g, 'ac');
  d = d.replace(/\bfrigi[\s-]*fresh\b/g, 'frigifresh');
  d = d.replace(/\bmicro[\s-]+filters?\b/g, 'microfilter');
  return d
    .replace(/\$[\d,.]+/g, ' ')
    .replace(/\d+\s*(?:\/\s*\d+)?/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(desc: string): string[] {
  return normalizeForComparison(desc)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => SYNONYMS[t] ?? t);
}

export function dominantCluster(descriptions: DescriptionCount[]): {
  raw: string; normalized: string; count: number; uniqueNormalized: number;
} {
  const clusters = new Map<string, { raw: string; count: number }>();
  for (const { text, count } of descriptions) {
    const n = normalizeForComparison(text);
    if (!n) continue;
    const existing = clusters.get(n);
    if (existing) existing.count += count;
    else clusters.set(n, { raw: text, count });
  }
  if (clusters.size === 0) return { raw: '', normalized: '', count: 0, uniqueNormalized: 0 };
  let best: { raw: string; count: number } | null = null;
  let bestNorm = '';
  for (const [norm, c] of clusters) {
    if (!best || c.count > best.count) { best = c; bestNorm = norm; }
  }
  return { raw: best!.raw, normalized: bestNorm, count: best!.count, uniqueNormalized: clusters.size };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/normalize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/normalize.ts engine/normalize.test.ts
git commit -m "feat: description normalization, tokenization, dominant cluster"
```

---

### Task 3: Keyword matching primitives

**Files:**
- Create: `engine/matching.ts`
- Test: `engine/matching.test.ts`

**Interfaces:**
- Consumes: `MenuItem` from `engine/types.ts`; `normalizeForComparison` from `engine/normalize.ts`.
- Produces:
  - `containsKeyword(normDesc: string, keyword: string): boolean` — case-insensitive substring match on a normalized description.
  - `evaluateMenuItem(rawDesc: string, item: MenuItem): 'match' | 'partial' | 'disqualified' | 'none'`.
  - `detectTireQuantity(rawDesc: string): number | null` — 1–4 from raw text, else null.

- [ ] **Step 1: Write the failing test `engine/matching.test.ts`**

```ts
import { evaluateMenuItem, detectTireQuantity } from './matching';
import type { MenuItem } from './types';

const brakeFluid: MenuItem = {
  id: 'brake_fluid', name: 'Brake Fluid',
  required: ['BRAKE'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE'],
  disqualify: ['PAD', 'ROTOR', 'CALIPER'],
};

test('full keyword match', () => {
  expect(evaluateMenuItem('BRAKE FLUID EXCHANGE', brakeFluid)).toBe('match');
});
test('disqualifier blocks a pad job even though BRAKE is present', () => {
  expect(evaluateMenuItem('REPLACE BRAKE PADS', brakeFluid)).toBe('disqualified');
});
test('only one gate satisfied is partial', () => {
  expect(evaluateMenuItem('BRAKE INSPECTION', brakeFluid)).toBe('partial');
});
test('no signal is none', () => {
  expect(evaluateMenuItem('ROTATE TIRES', brakeFluid)).toBe('none');
});
test('detectTireQuantity reads count from raw text', () => {
  expect(detectTireQuantity('MOUNT AND BALANCE 4 TIRES')).toBe(4);
  expect(detectTireQuantity('MOUNT ONE TIRE')).toBe(1);
  expect(detectTireQuantity('TIRE ROTATION')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/matching.test.ts`
Expected: FAIL ("Failed to resolve import './matching'").

- [ ] **Step 3: Write `engine/matching.ts`**

```ts
import type { MenuItem } from './types';
import { normalizeForComparison } from './normalize';

export function containsKeyword(normDesc: string, keyword: string): boolean {
  return normDesc.includes(keyword.toLowerCase());
}

export function evaluateMenuItem(
  rawDesc: string,
  item: MenuItem,
): 'match' | 'partial' | 'disqualified' | 'none' {
  const norm = normalizeForComparison(rawDesc);
  if (item.disqualify.some((k) => containsKeyword(norm, k))) return 'disqualified';
  const req = item.required.some((k) => containsKeyword(norm, k));
  const also = item.requiredAlso.length === 0 ? req : item.requiredAlso.some((k) => containsKeyword(norm, k));
  if (req && also) return 'match';
  if (req || (item.requiredAlso.length > 0 && also)) return 'partial';
  return 'none';
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, single: 1 };

export function detectTireQuantity(rawDesc: string): number | null {
  const d = rawDesc.toLowerCase();
  let m = d.match(/(\d+)\s*\b(?:tires?|wheels?)\b/);
  if (m && m[1]) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 4) return n; }
  for (const [w, n] of Object.entries(WORD_NUM)) {
    if (new RegExp(`\\b${w}\\s+tires?\\b`).test(d)) return n;
  }
  if (/\b(?:all|set\s+of)\s+four\b/.test(d)) return 4;
  return null;
}
```

Note: disqualifiers are checked against the normalized description, so `required` keywords like `BRAKE` still match while `PAD` (kept by `normalizeForComparison`) disqualifies. Substring matching is intentional so `ALIGN` matches `alignment`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/matching.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/matching.ts engine/matching.test.ts
git commit -m "feat: keyword match evaluation + tire quantity detection"
```

---

### Task 4: Menu-item catalog

**Files:**
- Create: `engine/catalog.ts`
- Test: `engine/catalog.test.ts`

**Interfaces:**
- Consumes: `MenuItem` from `engine/types.ts`.
- Produces:
  - `MENU_ITEMS: MenuItem[]` — the seeded catalog (names == business Service Name strings).
  - `getMenuItem(id: string): MenuItem | undefined`.
  - `businessLabel(menuItemId: string, quantity?: number): string` — renders tire labels `"{n} Tire(s)"`, else the item `name`.

- [ ] **Step 1: Write the failing test `engine/catalog.test.ts`**

```ts
import { MENU_ITEMS, getMenuItem, businessLabel } from './catalog';

test('ids and names are unique', () => {
  expect(new Set(MENU_ITEMS.map((m) => m.id)).size).toBe(MENU_ITEMS.length);
  expect(new Set(MENU_ITEMS.map((m) => m.name)).size).toBe(MENU_ITEMS.length);
});
test('every menu item has at least one disqualifier OR is intentionally open', () => {
  // brake fluid must guard against pad jobs
  expect(getMenuItem('brake_fluid')!.disqualify).toContain('PAD');
});
test('businessLabel renders tire quantity', () => {
  expect(businessLabel('tire', 1)).toBe('1 Tire');
  expect(businessLabel('tire', 4)).toBe('4 Tires');
  expect(businessLabel('alignment')).toBe('Alignment');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/catalog.test.ts`
Expected: FAIL ("Failed to resolve import './catalog'").

- [ ] **Step 3: Write `engine/catalog.ts`**

```ts
import type { MenuItem } from './types';

export const MENU_ITEMS: MenuItem[] = [
  { id: 'alignment', name: 'Alignment', required: ['ALIGN'], requiredAlso: [], disqualify: ['SENSOR', 'CAMERA'] },
  { id: 'air_filter', name: 'Air Filter', required: ['ENGINE FILTER', 'AIR FILTER', 'ENGINE AIR'], requiredAlso: [], disqualify: ['CABIN'] },
  { id: 'cabin_filter', name: 'Cabin Filter', required: ['CABIN', 'MICROFILTER'], requiredAlso: [], disqualify: ['ENGINE'] },
  { id: 'brake_fluid', name: 'Brake Fluid', required: ['BRAKE', 'BRK'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE', 'BLEED'], disqualify: ['PAD', 'ROTOR', 'CALIPER', 'SHOE', 'HARDWARE'] },
  { id: 'transmission', name: 'Transmission', required: ['TRANSMISSION', 'ATF', 'CVT'], requiredAlso: ['FLUID', 'EXCHANGE', 'FLUSH', 'SERVICE', 'DRAIN'], disqualify: ['REBUILD', 'OVERHAUL', 'MOUNT', 'SOLENOID'] },
  { id: 'coolant', name: 'Coolant', required: ['COOLANT', 'COOLING', 'RADIATOR'], requiredAlso: ['FLUSH', 'EXCHANGE', 'SERVICE', 'FILL', 'DRAIN'], disqualify: ['HOSE', 'PUMP', 'LEAK', 'THERMOSTAT'] },
  { id: 'fuel_service', name: 'Fuel Service', required: ['FUEL', 'INDUCTION', 'INJECTOR', 'GDI'], requiredAlso: ['SERVICE', 'CLEAN', 'FLUSH', 'INDUCTION'], disqualify: ['PUMP', 'FILTER', 'TANK', 'SENDER', 'LINE'] },
  { id: 'rear_diff', name: 'Rear Differential', required: ['REAR DIFF'], requiredAlso: [], disqualify: ['FRONT'] },
  { id: 'front_diff', name: 'Front Differential', required: ['FRONT DIFF'], requiredAlso: [], disqualify: ['REAR'] },
  { id: 'transfer_case', name: 'Transfer Case', required: ['TRANSFER CASE', 'TRANSFER', 'TCASE'], requiredAlso: ['FLUID', 'SERVICE', 'FLUSH', 'EXCHANGE', 'DRAIN'], disqualify: ['REBUILD'] },
  { id: 'power_steering', name: 'Power Steering', required: ['POWER STEERING', 'PSF'], requiredAlso: ['FLUID', 'FLUSH', 'EXCHANGE', 'SERVICE'], disqualify: ['PUMP', 'RACK', 'HOSE', 'PINION', 'LEAK'] },
  { id: 'awd', name: 'All Wheel Drive', required: ['ALL WHEEL DRIVE', 'AWD', 'DRIVELINE', 'FOUR WHEEL DRIVE'], requiredAlso: ['SERVICE', 'FLUID'], disqualify: ['REBUILD'] },
  { id: 'ac_service', name: 'AC Service', required: ['FRIGIFRESH', 'AC REFRESH', 'AC RECHARGE', 'EVAPORATOR', 'REFRIGERANT'], requiredAlso: [], disqualify: ['COMPRESSOR', 'CONDENSER', 'LINE', 'REPAIR', 'DIAGNOSE'] },
  { id: 'tire', name: 'Tire Service', required: ['TIRE'], requiredAlso: ['MOUNT', 'BALANCE', 'INSTALL'], disqualify: ['ROTATE', 'ROTATION', 'TPMS', 'PRESSURE', 'REPAIR', 'PATCH', 'FLAT', 'SPARE', 'NITROGEN', 'STEM'], isTire: true },
  { id: 'service_packages', name: 'Service Packages', required: ['SCHEDULED MAINTENANCE', 'FACTORY SCHEDULED', 'MAINTENANCE PACKAGE', 'SERVICE PACKAGE', 'MAINTENANCE MINDER', 'MINDER'], requiredAlso: [], disqualify: [] },
];

const TIRE_PLURAL: Record<number, string> = { 1: '1 Tire', 2: '2 Tires', 3: '3 Tires', 4: '4 Tires' };

export function getMenuItem(id: string): MenuItem | undefined {
  return MENU_ITEMS.find((m) => m.id === id);
}

export function businessLabel(menuItemId: string, quantity?: number): string {
  const item = getMenuItem(menuItemId);
  if (item?.isTire && quantity && TIRE_PLURAL[quantity]) return TIRE_PLURAL[quantity];
  return item?.name ?? menuItemId;
}
```

Note: keyword lists are seeds, refined against eval output in Task 15. The `name` strings match the Deacon Jones `Service Name` vocabulary; tire labels are rendered via `businessLabel`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/catalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/catalog.ts engine/catalog.test.ts
git commit -m "feat: seed menu-item catalog with disqualifiers + business labels"
```

---

### Task 5: Stats-consistency modifier

**Files:**
- Create: `engine/stats.ts`
- Test: `engine/stats.test.ts`

**Interfaces:**
- Consumes: `Confidence`, `StatsEffect`, `Item` from `engine/types.ts`.
- Produces:
  - `coefficientOfVariation(values: number[]): number | null`.
  - `applyStatsModifier(confidence: Confidence, item: Item): { confidence: Confidence; stats: StatsEffect }` — bumps on tight CV, caps on scattered CV; never changes the menu item.

- [ ] **Step 1: Write the failing test `engine/stats.test.ts`**

```ts
import { coefficientOfVariation, applyStatsModifier } from './stats';
import type { Item } from './types';

const base = (labor: number[], hours: number[]): Item => ({
  dealerKey: 'd', opCode: 'X', descriptions: [], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('cv is 0 for identical values, null for empty', () => {
  expect(coefficientOfVariation([5, 5, 5])).toBe(0);
  expect(coefficientOfVariation([])).toBeNull();
});
test('tight stats bump MEDIUM to HIGH', () => {
  const r = applyStatsModifier('MEDIUM', base([160, 160, 159], [1, 1, 1]));
  expect(r.confidence).toBe('HIGH');
  expect(r.stats.effect).toBe('bumped');
});
test('scattered stats cap HIGH to MEDIUM', () => {
  const r = applyStatsModifier('HIGH', base([10, 200, 90, 400], [0.2, 3, 1, 5]));
  expect(r.confidence).toBe('MEDIUM');
  expect(r.stats.effect).toBe('capped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/stats.test.ts`
Expected: FAIL ("Failed to resolve import './stats'").

- [ ] **Step 3: Write `engine/stats.ts`**

```ts
import type { Confidence, Item, StatsEffect } from './types';

const TIGHT = 0.15;
const SCATTERED = 0.35;
const ORDER: Confidence[] = ['LOW', 'MEDIUM', 'HIGH'];

export function coefficientOfVariation(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length === 0) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  if (mean === 0) return null;
  const variance = clean.reduce((a, v) => a + (v - mean) ** 2, 0) / clean.length;
  return Math.sqrt(variance) / mean;
}

function bump(c: Confidence): Confidence {
  const i = ORDER.indexOf(c);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : c;
}
function cap(c: Confidence): Confidence {
  const i = ORDER.indexOf(c);
  return i > 0 ? ORDER[i - 1]! : c;
}

export function applyStatsModifier(
  confidence: Confidence,
  item: Item,
): { confidence: Confidence; stats: StatsEffect } {
  if (confidence === 'EXACT') {
    return { confidence, stats: { laborCv: null, hoursCv: null, effect: 'none' } };
  }
  const laborCv = coefficientOfVariation(item.laborValues);
  const hoursCv = coefficientOfVariation(item.hoursValues);
  const cvs = [laborCv, hoursCv].filter((v): v is number => v !== null);
  let effect: StatsEffect['effect'] = 'none';
  let out = confidence;
  if (cvs.length > 0) {
    const tightest = Math.min(...cvs);
    const loosest = Math.max(...cvs);
    if (tightest < TIGHT) { out = bump(confidence); effect = out !== confidence ? 'bumped' : 'none'; }
    else if (loosest > SCATTERED) { out = cap(confidence); effect = out !== confidence ? 'capped' : 'none'; }
  }
  return { confidence: out, stats: { laborCv, hoursCv, effect } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/stats.ts engine/stats.test.ts
git commit -m "feat: supporting-only stats-consistency confidence modifier"
```

---

### Task 6: Row aggregation

**Files:**
- Create: `engine/aggregate.ts`
- Test: `engine/aggregate.test.ts`

**Interfaces:**
- Consumes: `Item`, `DescriptionCount` from `engine/types.ts`.
- Produces: `aggregateRows(rows: RawRow[], dealerKey: string): Item[]` where
  `RawRow = { opCode: string; description: string; laborSale?: string | number; techHours?: string | number }`.

- [ ] **Step 1: Write the failing test `engine/aggregate.test.ts`**

```ts
import { aggregateRows } from './aggregate';

test('aggregates rows by op code with description counts and numeric values', () => {
  const items = aggregateRows([
    { opCode: 'A4', description: '4 WHEEL ALIGNMENT', laborSale: '$159.95', techHours: '1.0' },
    { opCode: 'A4', description: '4 WHEEL ALIGNMENT', laborSale: '159.95', techHours: '1.0' },
    { opCode: 'WBF', description: 'BRAKE FLUID EXCHANGE', laborSale: '122.00', techHours: '1.0' },
  ], 'deacon');
  const a4 = items.find((i) => i.opCode === 'A4')!;
  expect(a4.rowCount).toBe(2);
  expect(a4.descriptions).toEqual([{ text: '4 WHEEL ALIGNMENT', count: 2 }]);
  expect(a4.laborValues).toEqual([159.95, 159.95]);
  expect(a4.dealerKey).toBe('deacon');
  expect(items).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/aggregate.test.ts`
Expected: FAIL ("Failed to resolve import './aggregate'").

- [ ] **Step 3: Write `engine/aggregate.ts`**

```ts
import type { Item } from './types';

export interface RawRow {
  opCode: string;
  description: string;
  laborSale?: string | number;
  techHours?: string | number;
}

function toNumber(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function aggregateRows(rows: RawRow[], dealerKey: string): Item[] {
  const map = new Map<string, Item & { _descCounts: Map<string, number> }>();
  for (const row of rows) {
    const opCode = String(row.opCode ?? '').trim().toUpperCase();
    if (!opCode) continue;
    let agg = map.get(opCode);
    if (!agg) {
      agg = { dealerKey, opCode, descriptions: [], laborValues: [], hoursValues: [], rowCount: 0, _descCounts: new Map() };
      map.set(opCode, agg);
    }
    agg.rowCount++;
    const desc = String(row.description ?? '').trim().replace(/\s+/g, ' ');
    if (desc) agg._descCounts.set(desc, (agg._descCounts.get(desc) ?? 0) + 1);
    const labor = toNumber(row.laborSale);
    if (labor !== null) agg.laborValues.push(labor);
    const hours = toNumber(row.techHours);
    if (hours !== null) agg.hoursValues.push(hours);
  }
  const items: Item[] = [];
  for (const agg of map.values()) {
    const { _descCounts, ...rest } = agg;
    rest.descriptions = [..._descCounts.entries()].map(([text, count]) => ({ text, count }));
    items.push(rest);
  }
  return items.sort((a, b) => b.rowCount - a.rowCount);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/aggregate.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add engine/aggregate.ts engine/aggregate.test.ts
git commit -m "feat: aggregate raw rows into per-op-code items"
```

---

### Task 7: Exact pass

**Files:**
- Create: `engine/passes/exact.ts`
- Test: `engine/passes/exact.test.ts`

**Interfaces:**
- Consumes: `Item`, `Verdict`, `itemKey` from `engine/types.ts`.
- Produces: `exactPass(item: Item, learned: Map<string, string>): Verdict | null` where `learned` maps `itemKey` → `menuItemId`.

- [ ] **Step 1: Write the failing test `engine/passes/exact.test.ts`**

```ts
import { exactPass } from './exact';
import type { Item } from '../types';

const item: Item = { dealerKey: 'deacon', opCode: 'WBF', descriptions: [], laborValues: [], hoursValues: [], rowCount: 3 };

test('returns EXACT verdict for a learned mapping', () => {
  const v = exactPass(item, new Map([['deacon::WBF', 'brake_fluid']]));
  expect(v).toMatchObject({ menuItemId: 'brake_fluid', matchType: 'EXACT', confidence: 'EXACT' });
});
test('returns null when not learned', () => {
  expect(exactPass(item, new Map())).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/passes/exact.test.ts`
Expected: FAIL ("Failed to resolve import './exact'").

- [ ] **Step 3: Write `engine/passes/exact.ts`**

```ts
import type { Item, Verdict } from '../types';
import { itemKey } from '../types';

export function exactPass(item: Item, learned: Map<string, string>): Verdict | null {
  const menuItemId = learned.get(itemKey(item));
  if (!menuItemId) return null;
  return {
    menuItemId, matchType: 'EXACT', confidence: 'EXACT',
    reason: `Learned mapping for ${item.dealerKey} op code ${item.opCode}.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/passes/exact.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/passes/exact.ts engine/passes/exact.test.ts
git commit -m "feat: exact pass for learned per-dealer mappings"
```

---

### Task 8: Block pass

**Files:**
- Create: `engine/passes/block.ts`
- Test: `engine/passes/block.test.ts`

**Interfaces:**
- Consumes: `Item`, `Verdict` from `engine/types.ts`; `dominantCluster` from `engine/normalize.ts`.
- Produces: `blockPass(item: Item): Verdict | null` — `UNMATCHED` when the dominant description is a hard non-service.

- [ ] **Step 1: Write the failing test `engine/passes/block.test.ts`**

```ts
import { blockPass } from './block';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 5 }], laborValues: [], hoursValues: [], rowCount: 5 });

test('blocks oil change', () => {
  expect(blockPass(mk('LUBE OIL FILTER'))?.matchType).toBe('UNMATCHED');
});
test('blocks multipoint inspection', () => {
  expect(blockPass(mk('MULTIPOINT INSPECTION'))?.matchType).toBe('UNMATCHED');
});
test('does not block a real service', () => {
  expect(blockPass(mk('BRAKE FLUID EXCHANGE'))).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/passes/block.test.ts`
Expected: FAIL ("Failed to resolve import './block'").

- [ ] **Step 3: Write `engine/passes/block.ts`**

```ts
import type { Item, Verdict } from '../types';
import { dominantCluster } from '../normalize';

export const BLOCK_PATTERNS: RegExp[] = [
  /oil change/, /oil and filter/, /lube oil filter/, /\blof\b/,
  /multi ?point (?:inspection|vehicle)/, /multipoint/, /\bmpvi?\b/,
  /tire rotation/, /rotate tires/, /rotate and balance/,
  /state inspection/, /safety inspection/, /emissions test/, /\brecall\b/,
  /shop supplies/, /loaner/, /rental/, /wash vehicle/, /\bdetail\b/,
  /diagnos/, /inspect only/,
];

export function blockPass(item: Item): Verdict | null {
  const norm = dominantCluster(item.descriptions).normalized;
  if (norm && BLOCK_PATTERNS.some((p) => p.test(norm))) {
    return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: 'Dominant description is a blocked non-service (oil/MPI/rotation/recall/etc.).' };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/passes/block.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/passes/block.ts engine/passes/block.test.ts
git commit -m "feat: block pass for hard non-service descriptions"
```

---

### Task 9: Deterministic keyword pass

**Files:**
- Create: `engine/passes/deterministic.ts`
- Test: `engine/passes/deterministic.test.ts`

**Interfaces:**
- Consumes: `Item`, `Verdict`, `MenuItem` from `engine/types.ts`; `dominantCluster` from `engine/normalize.ts`; `evaluateMenuItem`, `detectTireQuantity` from `engine/matching.ts`; `applyStatsModifier` from `engine/stats.ts`.
- Produces: `deterministicPass(item: Item, catalog: MenuItem[]): Verdict | null` — `RULE`/HIGH on a single full match (stats may adjust), null on zero or conflicting matches.

- [ ] **Step 1: Write the failing test `engine/passes/deterministic.test.ts`**

```ts
import { deterministicPass } from './deterministic';
import { MENU_ITEMS } from '../catalog';
import type { Item } from '../types';

const mk = (desc: string, labor: number[] = [160, 160], hours: number[] = [1, 1]): Item => ({
  dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('alignment matches RULE and tight stats keep it HIGH', () => {
  const v = deterministicPass(mk('4 WHEEL ALIGNMENT'), MENU_ITEMS)!;
  expect(v).toMatchObject({ menuItemId: 'alignment', matchType: 'RULE', confidence: 'HIGH' });
});
test('tire match carries quantity', () => {
  const v = deterministicPass(mk('MOUNT AND BALANCE 4 TIRES'), MENU_ITEMS)!;
  expect(v.menuItemId).toBe('tire');
  expect(v.quantity).toBe(4);
});
test('brake pad job does not match brake fluid', () => {
  expect(deterministicPass(mk('REPLACE BRAKE PADS'), MENU_ITEMS)).toBeNull();
});
test('scattered stats cap an alignment match to MEDIUM', () => {
  const v = deterministicPass(mk('4 WHEEL ALIGNMENT', [10, 400, 90], [0.2, 5, 1]), MENU_ITEMS)!;
  expect(v.confidence).toBe('MEDIUM');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/passes/deterministic.test.ts`
Expected: FAIL ("Failed to resolve import './deterministic'").

- [ ] **Step 3: Write `engine/passes/deterministic.ts`**

```ts
import type { Item, MenuItem, Verdict } from '../types';
import { dominantCluster } from '../normalize';
import { evaluateMenuItem, detectTireQuantity } from '../matching';
import { applyStatsModifier } from '../stats';

export function deterministicPass(item: Item, catalog: MenuItem[]): Verdict | null {
  const dom = dominantCluster(item.descriptions);
  if (!dom.raw) return null;
  const matches = catalog.filter((m) => evaluateMenuItem(dom.raw, m) === 'match');
  if (matches.length !== 1) return null; // zero or conflicting -> let later passes handle
  const matched = matches[0]!;
  const { confidence, stats } = applyStatsModifier('HIGH', item);
  const verdict: Verdict = {
    menuItemId: matched.id, matchType: 'RULE', confidence,
    reason: `Dominant description "${dom.raw}" matches ${matched.name} keyword rules.`,
    supportingStats: stats,
  };
  if (matched.isTire) {
    const qty = detectTireQuantity(dom.raw);
    if (qty !== null) verdict.quantity = qty;
  }
  return verdict;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/passes/deterministic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/passes/deterministic.ts engine/passes/deterministic.test.ts
git commit -m "feat: deterministic keyword pass with stats modifier + tire qty"
```

---

### Task 10: Pre-AI filter pass

**Files:**
- Create: `engine/passes/preAiFilter.ts`
- Test: `engine/passes/preAiFilter.test.ts`

**Interfaces:**
- Consumes: `Item`, `Verdict` from `engine/types.ts`; `dominantCluster` from `engine/normalize.ts`.
- Produces: `preAiFilterPass(item: Item): Verdict | null` — `UNMATCHED` for clear repair/replacement or pure labor/diagnosis, so no AI call is spent.

- [ ] **Step 1: Write the failing test `engine/passes/preAiFilter.test.ts`**

```ts
import { preAiFilterPass } from './preAiFilter';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 4 }], laborValues: [], hoursValues: [], rowCount: 4 });

test('filters a component replacement', () => {
  expect(preAiFilterPass(mk('REPLACE WATER PUMP'))?.matchType).toBe('UNMATCHED');
});
test('filters pure labor', () => {
  expect(preAiFilterPass(mk('SHOP LABOR CHARGE'))?.matchType).toBe('UNMATCHED');
});
test('leaves an ambiguous fluid description for the adjudicator', () => {
  expect(preAiFilterPass(mk('SYSTEM FLUSH SERVICE'))).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/passes/preAiFilter.test.ts`
Expected: FAIL ("Failed to resolve import './preAiFilter'").

- [ ] **Step 3: Write `engine/passes/preAiFilter.ts`**

```ts
import type { Item, Verdict } from '../types';
import { dominantCluster } from '../normalize';

const COMPONENT = /(pump|rack|hose|compressor|condenser|caliper|rotor|\bpad\b|solenoid|sensor|actuator|valve|gasket|seal|bearing|belt|alternator|starter)/;
const REPAIR = /(replace|replacement|rebuild|overhaul|\br and r\b|remove and replace|install new)/;
export const REPAIR_PATTERNS: RegExp[] = [
  /shop labor/, /labor charge/, /\bdiagnos/, /tech time/, /sublet/,
];

export function preAiFilterPass(item: Item): Verdict | null {
  const norm = dominantCluster(item.descriptions).normalized;
  if (!norm) return null;
  const isRepair = REPAIR.test(norm) && COMPONENT.test(norm);
  const isLabor = REPAIR_PATTERNS.some((p) => p.test(norm));
  if (isRepair || isLabor) {
    return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: isRepair ? 'Dominant description is a component repair/replacement, not a fluid/menu service.' : 'Dominant description is pure labor/diagnosis.' };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/passes/preAiFilter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/passes/preAiFilter.ts engine/passes/preAiFilter.test.ts
git commit -m "feat: pre-AI filter for repair/replacement and labor-only codes"
```

---

### Task 11: Reclassify pass

**Files:**
- Create: `engine/passes/reclassify.ts`
- Test: `engine/passes/reclassify.test.ts`

**Interfaces:**
- Consumes: `Item`, `MenuItem`, `Verdict` from `engine/types.ts`; `dominantCluster` from `engine/normalize.ts`; `evaluateMenuItem` from `engine/matching.ts`.
- Produces: `reclassifyPass(item: Item, catalog: MenuItem[]): Verdict | null` — `AI`/LOW "possible new menu item" when a partial signal exists.

- [ ] **Step 1: Write the failing test `engine/passes/reclassify.test.ts`**

```ts
import { reclassifyPass } from './reclassify';
import { MENU_ITEMS } from '../catalog';
import type { Item } from '../types';

const mk = (desc: string): Item => ({ dealerKey: 'd', opCode: 'X', descriptions: [{ text: desc, count: 2 }], laborValues: [], hoursValues: [], rowCount: 2 });

test('partial brake signal surfaces as AI/LOW review', () => {
  const v = reclassifyPass(mk('BRAKE CONCERN CHECK'), MENU_ITEMS)!;
  expect(v).toMatchObject({ matchType: 'AI', confidence: 'LOW' });
  expect(v.menuItemId).toBe('brake_fluid');
});
test('no signal returns null', () => {
  expect(reclassifyPass(mk('CONFIRM FRAME VIN'), MENU_ITEMS)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/passes/reclassify.test.ts`
Expected: FAIL ("Failed to resolve import './reclassify'").

- [ ] **Step 3: Write `engine/passes/reclassify.ts`**

```ts
import type { Item, MenuItem, Verdict } from '../types';
import { dominantCluster } from '../normalize';
import { evaluateMenuItem } from '../matching';

export function reclassifyPass(item: Item, catalog: MenuItem[]): Verdict | null {
  const dom = dominantCluster(item.descriptions);
  if (!dom.raw) return null;
  const partial = catalog.find((m) => evaluateMenuItem(dom.raw, m) === 'partial');
  if (!partial) return null;
  return {
    menuItemId: partial.id, matchType: 'AI', confidence: 'LOW',
    reason: `Partial signal for ${partial.name} in "${dom.raw}" — possible new menu item, needs review.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/passes/reclassify.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/passes/reclassify.ts engine/passes/reclassify.test.ts
git commit -m "feat: reclassify pass for partial-signal review candidates"
```

---

### Task 12: Adjudicator interface + RecordedAdjudicator

**Files:**
- Create: `engine/adjudicator.ts`
- Test: `engine/adjudicator.test.ts`

**Interfaces:**
- Consumes: `Item`, `Verdict`, `itemKey` from `engine/types.ts`.
- Produces:
  - `interface Adjudicator { adjudicate(items: Item[]): Promise<Verdict[]> }`.
  - `class RecordedAdjudicator implements Adjudicator` — constructed with `Map<itemKey, Verdict>`; returns the recorded verdict per item or an `UNMATCHED` default; never touches the network.

- [ ] **Step 1: Write the failing test `engine/adjudicator.test.ts`**

```ts
import { RecordedAdjudicator } from './adjudicator';
import type { Item } from './types';

const item = (op: string): Item => ({ dealerKey: 'd', opCode: op, descriptions: [], laborValues: [], hoursValues: [], rowCount: 1 });

test('returns recorded verdicts in input order, UNMATCHED when missing', async () => {
  const adj = new RecordedAdjudicator(new Map([
    ['d::A', { menuItemId: 'coolant', matchType: 'AI', confidence: 'MEDIUM', reason: 'recorded' }],
  ]));
  const out = await adj.adjudicate([item('A'), item('B')]);
  expect(out[0]!.menuItemId).toBe('coolant');
  expect(out[1]!.matchType).toBe('UNMATCHED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/adjudicator.test.ts`
Expected: FAIL ("Failed to resolve import './adjudicator'").

- [ ] **Step 3: Write `engine/adjudicator.ts`**

```ts
import type { Item, Verdict } from './types';
import { itemKey } from './types';

export interface Adjudicator {
  adjudicate(items: Item[]): Promise<Verdict[]>;
}

export class RecordedAdjudicator implements Adjudicator {
  constructor(private readonly recorded: Map<string, Verdict>) {}
  async adjudicate(items: Item[]): Promise<Verdict[]> {
    return items.map((item) =>
      this.recorded.get(itemKey(item)) ?? {
        menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW',
        reason: 'No recorded adjudication; defaulted to UNMATCHED.',
      });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/adjudicator.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add engine/adjudicator.ts engine/adjudicator.test.ts
git commit -m "feat: Adjudicator seam + no-network RecordedAdjudicator"
```

---

### Task 13: Orchestrator + batching contract

**Files:**
- Create: `engine/identify.ts`
- Test: `engine/identify.test.ts`

**Interfaces:**
- Consumes: every pass, `Adjudicator`, `MENU_ITEMS`, `Item`, `Verdict`, `itemKey`.
- Produces:
  ```ts
  interface IdentifyOptions {
    catalog?: MenuItem[];        // default MENU_ITEMS
    learned?: Map<string, string>; // default empty
    adjudicator: Adjudicator;
    batchSize?: number;          // default 25
  }
  identify(items: Item[], opts: IdentifyOptions): Promise<Map<string, Verdict>>  // keyed by itemKey
  ```

- [ ] **Step 1: Write the failing test `engine/identify.test.ts`**

```ts
import { identify } from './identify';
import { RecordedAdjudicator } from './adjudicator';
import type { Adjudicator } from './adjudicator';
import type { Item, Verdict } from './types';
import { itemKey } from './types';

const mk = (op: string, desc: string, labor: number[] = [160, 160], hours: number[] = [1, 1]): Item => ({
  dealerKey: 'd', opCode: op, descriptions: [{ text: desc, count: labor.length }], laborValues: labor, hoursValues: hours, rowCount: labor.length,
});

test('deterministic match resolves before the adjudicator is consulted', async () => {
  const spy = { calls: 0, async adjudicate(items: Item[]) { this.calls++; return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: '' } as Verdict)); } };
  const out = await identify([mk('A4', '4 WHEEL ALIGNMENT')], { adjudicator: spy as Adjudicator });
  expect(out.get('d::A4')!.menuItemId).toBe('alignment');
  expect(spy.calls).toBe(0);
});

test('learned mapping wins via exact pass', async () => {
  const out = await identify([mk('ZZ', 'MYSTERY CODE')], {
    learned: new Map([['d::ZZ', 'coolant']]),
    adjudicator: new RecordedAdjudicator(new Map()),
  });
  expect(out.get('d::ZZ')!).toMatchObject({ menuItemId: 'coolant', matchType: 'EXACT' });
});

test('batching: 60 unresolved items at batchSize 25 -> 3 bounded batches', async () => {
  const sizes: number[] = [];
  const adj: Adjudicator = { async adjudicate(items) { sizes.push(items.length); return items.map(() => ({ menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason: '' })); } };
  const items = Array.from({ length: 60 }, (_, i) => mk(`OP${i}`, 'CONFIRM FRAME VIN'));
  await identify(items, { adjudicator: adj, batchSize: 25 });
  expect(sizes).toEqual([25, 25, 10]);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(25);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run engine/identify.test.ts`
Expected: FAIL ("Failed to resolve import './identify'").

- [ ] **Step 3: Write `engine/identify.ts`**

```ts
import type { Adjudicator } from './adjudicator';
import type { Item, MenuItem, Verdict } from './types';
import { itemKey } from './types';
import { MENU_ITEMS } from './catalog';
import { exactPass } from './passes/exact';
import { blockPass } from './passes/block';
import { deterministicPass } from './passes/deterministic';
import { preAiFilterPass } from './passes/preAiFilter';
import { reclassifyPass } from './passes/reclassify';

export interface IdentifyOptions {
  catalog?: MenuItem[];
  learned?: Map<string, string>;
  adjudicator: Adjudicator;
  batchSize?: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function identify(items: Item[], opts: IdentifyOptions): Promise<Map<string, Verdict>> {
  const catalog = opts.catalog ?? MENU_ITEMS;
  const learned = opts.learned ?? new Map<string, string>();
  const batchSize = opts.batchSize ?? 25;
  const verdicts = new Map<string, Verdict>();
  const unresolved: Item[] = [];

  for (const item of items) {
    const v = exactPass(item, learned) ?? blockPass(item) ?? deterministicPass(item, catalog) ?? preAiFilterPass(item);
    if (v) verdicts.set(itemKey(item), v);
    else unresolved.push(item);
  }

  for (const batch of chunk(unresolved, batchSize)) {
    const out = await opts.adjudicator.adjudicate(batch);
    batch.forEach((item, i) => {
      const v = out[i] ?? { menuItemId: null, matchType: 'UNMATCHED' as const, confidence: 'LOW' as const, reason: 'Adjudicator returned no verdict.' };
      verdicts.set(itemKey(item), v.matchType === 'UNMATCHED' ? (reclassifyPass(item, catalog) ?? v) : v);
    });
  }
  return verdicts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run engine/identify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/identify.ts engine/identify.test.ts
git commit -m "feat: identify orchestrator with earliest-wins passes + bounded batching"
```

---

### Task 14: Metrics

**Files:**
- Create: `eval/metrics.ts`
- Test: `eval/metrics.test.ts`

**Interfaces:**
- Consumes: `Verdict` from `engine/types.ts`; `businessLabel` from `engine/catalog.ts`.
- Produces:
  - `type Outcome = 'hit' | 'miss' | 'falsePositive' | 'trueNegative'`.
  - `classifyOutcome(verdict: Verdict, expected: string | null): Outcome` — `expected` is a business Service Name or `null`. An auto-identification = `matchType ∈ {EXACT,RULE}` (AI/LOW review and UNMATCHED are NOT auto-identifications).
  - `computeMetrics(pairs: { verdict: Verdict; expected: string | null }[]): { identification: number; reviewRate: number; falsePositive: number; counts: Record<Outcome, number>; flagged: number; total: number }`.

- [ ] **Step 1: Write the failing test `eval/metrics.test.ts`**

```ts
import { classifyOutcome, computeMetrics } from './metrics';
import type { Verdict } from '../engine/types';

const v = (menuItemId: string | null, matchType: Verdict['matchType'], quantity?: number): Verdict =>
  ({ menuItemId, matchType, confidence: 'HIGH', reason: '', quantity });

test('auto RULE match to correct label is a hit', () => {
  expect(classifyOutcome(v('alignment', 'RULE'), 'Alignment')).toBe('hit');
});
test('auto match to wrong label is a false positive', () => {
  expect(classifyOutcome(v('coolant', 'RULE'), 'Alignment')).toBe('falsePositive');
});
test('real service left UNMATCHED is a miss', () => {
  expect(classifyOutcome(v(null, 'UNMATCHED'), 'Alignment')).toBe('miss');
});
test('non-service correctly not auto-identified is a true negative', () => {
  expect(classifyOutcome(v(null, 'UNMATCHED'), null)).toBe('trueNegative');
});
test('tire quantity must match the expected label', () => {
  expect(classifyOutcome(v('tire', 'RULE', 4), '4 Tires')).toBe('hit');
  expect(classifyOutcome(v('tire', 'RULE', 2), '4 Tires')).toBe('falsePositive');
});
test('metrics compute identification and false-positive rates', () => {
  const m = computeMetrics([
    { verdict: v('alignment', 'RULE'), expected: 'Alignment' },   // hit
    { verdict: v(null, 'UNMATCHED'), expected: 'Coolant' },        // miss
    { verdict: v('coolant', 'RULE'), expected: 'Brake Fluid' },    // falsePositive
    { verdict: v(null, 'UNMATCHED'), expected: null },             // trueNegative
  ]);
  expect(m.identification).toBeCloseTo(1 / 2); // hits/(hits+miss)
  expect(m.falsePositive).toBeCloseTo(1 / 2);  // fp/(hits+fp)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run eval/metrics.test.ts`
Expected: FAIL ("Failed to resolve import './metrics'").

- [ ] **Step 3: Write `eval/metrics.ts`**

```ts
import type { Verdict } from '../engine/types';
import { businessLabel } from '../engine/catalog';

export type Outcome = 'hit' | 'miss' | 'falsePositive' | 'trueNegative';

function isAutoIdentified(v: Verdict): boolean {
  return v.matchType === 'EXACT' || v.matchType === 'RULE';
}

export function classifyOutcome(verdict: Verdict, expected: string | null): Outcome {
  const auto = isAutoIdentified(verdict) && verdict.menuItemId !== null;
  const predicted = auto ? businessLabel(verdict.menuItemId!, verdict.quantity) : null;
  if (expected === null) return auto ? 'falsePositive' : 'trueNegative';
  if (!auto) return 'miss';
  return predicted === expected ? 'hit' : 'falsePositive';
}

export function computeMetrics(pairs: { verdict: Verdict; expected: string | null }[]) {
  const counts: Record<Outcome, number> = { hit: 0, miss: 0, falsePositive: 0, trueNegative: 0 };
  let flagged = 0;
  for (const { verdict, expected } of pairs) {
    counts[classifyOutcome(verdict, expected)]++;
    if (verdict.matchType === 'AI' && verdict.confidence === 'LOW') flagged++;
  }
  const idDen = counts.hit + counts.miss;
  const fpDen = counts.hit + counts.falsePositive;
  return {
    identification: idDen > 0 ? counts.hit / idDen : 1,
    reviewRate: pairs.length > 0 ? flagged / pairs.length : 0,
    falsePositive: fpDen > 0 ? counts.falsePositive / fpDen : 0,
    counts, flagged, total: pairs.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run eval/metrics.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add eval/metrics.ts eval/metrics.test.ts
git commit -m "feat: eval outcome classification + 3 metrics"
```

---

### Task 15: Ground-truth builder + harness + tier-1 gate

**Files:**
- Create: `scripts/build-ground-truth.ts`
- Create: `eval/harness.ts`
- Create: `eval/ground-truth/deacon_jones.json` (generated)
- Create: `data/.gitkeep`
- Test: `eval/harness.test.ts`

**Interfaces:**
- Consumes: `aggregateRows` (Task 6), `identify` (Task 13), `RecordedAdjudicator` (Task 12), `computeMetrics` (Task 14), `MENU_ITEMS`/`businessLabel` (Task 4).
- Produces:
  - `serviceNameToExpected(serviceName: string): string | null` — maps a raw `Service Name` to a canonical business label (`"No services"`/blank → null; `"Fuel Service"`, `"4 Tires"`, etc. → themselves; trims/normalizes case).
  - `runEval(opts: { csvPath: string; fixturePath: string }): Promise<ReturnType<typeof computeMetrics>>` — aggregates the CSV, runs `identify` cold (no learned map) with a `RecordedAdjudicator(empty)`, scores each op code against the fixture's expected label, returns metrics.

- [ ] **Step 1: Write `scripts/build-ground-truth.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';

// Usage: tsx scripts/build-ground-truth.ts <csvPath> <dealerKey> <outPath>
const [csvPath, dealerKey, outPath] = process.argv.slice(2);
if (!csvPath || !dealerKey || !outPath) { throw new Error('args: <csvPath> <dealerKey> <outPath>'); }

const csv = readFileSync(csvPath, 'utf8');
const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

// One expected label per op code (Service Name is verified 1:1 in this dataset).
const byOp = new Map<string, string | null>();
for (const row of data) {
  const opCode = String(row['Op Code'] ?? '').trim().toUpperCase();
  if (!opCode) continue;
  const sn = String(row['Service Name'] ?? '').trim();
  const expected = !sn || sn.toLowerCase() === 'no services' ? null : sn;
  if (!byOp.has(opCode) || (expected !== null && byOp.get(opCode) === null)) byOp.set(opCode, expected);
}

const fixture = [...byOp.entries()].map(([opCode, expected]) => ({ dealerKey, opCode, expected }));
writeFileSync(outPath, JSON.stringify(fixture, null, 2));
console.log(`Wrote ${fixture.length} labeled op codes to ${outPath}`);
```

- [ ] **Step 2: Generate the fixture from the real CSV**

Run (the committed PII-free fixture `eval/fixtures/deacon_jones.csv` is the input — the raw CSV with VINs/customer data is gitignored under `data/` and never enters the repo):
```bash
mkdir -p eval/ground-truth
PATH=/private/tmp/node-v20.11.1-darwin-arm64/bin:$PATH node node_modules/tsx/dist/cli.mjs scripts/build-ground-truth.ts eval/fixtures/deacon_jones.csv deacon eval/ground-truth/deacon_jones.json
```
Expected: "Wrote 59 labeled op codes to eval/ground-truth/deacon_jones.json".
Verify with `cat eval/ground-truth/deacon_jones.json` that labeled entries include `{ "opCode": "A4", "expected": "Alignment" }`, `"WBF" -> "Brake Fluid"`, `"MB4" -> "4 Tires"`, and most are `"expected": null`.

- [ ] **Step 3: Write `eval/harness.ts`**

```ts
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { aggregateRows, type RawRow } from '../engine/aggregate';
import { identify } from '../engine/identify';
import { RecordedAdjudicator } from '../engine/adjudicator';
import { itemKey } from '../engine/types';
import { computeMetrics } from './metrics';

export function serviceNameToExpected(serviceName: string): string | null {
  const sn = (serviceName ?? '').trim();
  if (!sn || sn.toLowerCase() === 'no services') return null;
  return sn;
}

interface FixtureEntry { dealerKey: string; opCode: string; expected: string | null; }

export async function runEval(opts: { csvPath: string; fixturePath: string }) {
  const csv = readFileSync(opts.csvPath, 'utf8');
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const fixture: FixtureEntry[] = JSON.parse(readFileSync(opts.fixturePath, 'utf8'));
  const dealerKey = fixture[0]?.dealerKey ?? 'dealer';

  const rows: RawRow[] = data.map((r) => ({
    opCode: r['Op Code'] ?? '', description: r['Operations Description'] ?? '',
    laborSale: r['Labor Sale'], techHours: r['Tech Hours'],
  }));
  const items = aggregateRows(rows, dealerKey);
  const verdicts = await identify(items, { adjudicator: new RecordedAdjudicator(new Map()) });

  const expectedByKey = new Map(fixture.map((f) => [`${f.dealerKey}::${f.opCode}`, f.expected]));
  const pairs = items.map((item) => ({
    verdict: verdicts.get(itemKey(item))!,
    expected: expectedByKey.get(itemKey(item)) ?? null,
  }));
  return computeMetrics(pairs);
}

// CLI entry: tsx eval/harness.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  runEval({
    csvPath: 'eval/fixtures/deacon_jones.csv',
    fixturePath: 'eval/ground-truth/deacon_jones.json',
  }).then((m) => {
    console.log('Identification:', (m.identification * 100).toFixed(1) + '%');
    console.log('False positive:', (m.falsePositive * 100).toFixed(1) + '%');
    console.log('Review rate:   ', (m.reviewRate * 100).toFixed(1) + '%');
    console.log('Counts:', m.counts);
  });
}
```

- [ ] **Step 4: Write the failing test `eval/harness.test.ts`**

```ts
import { runEval, serviceNameToExpected } from './harness';

test('serviceNameToExpected maps no-service to null and passes real names through', () => {
  expect(serviceNameToExpected('No services')).toBeNull();
  expect(serviceNameToExpected('  ')).toBeNull();
  expect(serviceNameToExpected('Fuel Service')).toBe('Fuel Service');
});

test('tier-1 (Deacon Jones) meets the accuracy bar', async () => {
  const m = await runEval({
    csvPath: 'eval/fixtures/deacon_jones.csv',
    fixturePath: 'eval/ground-truth/deacon_jones.json',
  });
  expect(m.identification).toBeGreaterThanOrEqual(0.9);
  expect(m.falsePositive).toBeLessThanOrEqual(0.02);
});
```

- [ ] **Step 5: Run the harness test**

Run: `npx vitest run eval/harness.test.ts`
Expected: PASS. If identification < 0.9 or false-positive > 0.02, inspect failures with `npx tsx eval/harness.ts` (prints counts), then **tune `engine/catalog.ts` keyword/disqualify lists** (this is the intended tuning loop — adjust catalog, never the metrics) and re-run until green.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add eval/ scripts/ data/.gitkeep
git commit -m "feat: ground-truth builder, eval harness, tier-1 accuracy gate"
```

---

## Self-Review

**1. Spec coverage:**
- Pure network-free engine → Tasks 2–13 (no HTTP/DB/model). ✓
- Module layout (engine/eval/scripts) → matches §"File Structure". ✓
- Data model (Item/MenuItem/Verdict, two axes) → Task 1. ✓
- Ordered earliest-wins passes → Tasks 7–11 + orchestrator Task 13. ✓
- Dominant-cluster matching → Task 2 (`dominantCluster`), used by passes. ✓
- Disqualifiers / brake-pad guard → Task 3 + Task 4 + tested in Tasks 3, 9. ✓
- Tire = one item + quantity → Tasks 3, 4, 9, label in 4, scored in 14. ✓
- Stats supporting-only (bump/cap, never decides) → Task 5, integrated Task 9. ✓
- Adjudicator seam + RecordedAdjudicator → Task 12. ✓
- Batching contract (engine owns chunking, bounded) → Task 13 test. ✓
- Catalog names == Service Name strings → Task 4 + Task 15 mapping. ✓
- Ground truth from Service Name column → Task 15 builder. ✓
- 3 metrics with deliberate denominators → Task 14. ✓
- CI gate ≥90% / ≤2% on tier-1 → Task 15 test. ✓
- Cold run (no learned map) exercised → Task 15 `runEval`; warm/exact path covered by Task 7 + Task 13 unit tests. ✓
- Deferred (no live AI/token/DB/UI) → nothing in plan adds them. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. The catalog keyword lists are explicitly "seeds tuned in Task 15," which is a real tuning loop, not a placeholder. ✓

**3. Type consistency:** `Item`, `Verdict`, `MenuItem`, `itemKey`, `Adjudicator` signatures are defined in Tasks 1/12 and consumed with the same shapes throughout; `identify` returns `Map<string, Verdict>` keyed by `itemKey`, consumed that way in Task 15. ✓
