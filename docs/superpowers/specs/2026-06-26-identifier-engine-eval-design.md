# Identifier Engine + Eval Harness — Design (Sub-project A)

**Date:** 2026-06-26
**Status:** Approved (design); spec pending user review
**Parent playbook:** `opcode-classifier-playbook.md`
**Predecessor:** `opcode_classifier.html` (v1 prototype — domain knowledge harvested, architecture replaced)

---

## Context & goal

We are rebuilding the dealership service **identifier** (formerly "classifier"). It takes a
dealer's service-line data — an **op code** (dealer-specific shorthand like `A4`, `WBF`,
`WATF`) plus an **operation description** (`"4 WHEEL ALIGNMENT"`, `"BRAKE FLUID EXCHANGE"`)
— and identifies each distinct op code as one of a fixed list of canonical **menu items**
(Alignment, Brake Fluid, Transmission, …) or `none`. Uncertain ones go to a human review
queue (later sub-project); confirmed ones are remembered and auto-identify next time.

**Op codes are fingerprints**: unique within a store and different across stores (`A4` /
`ALIGN` / `FS02` can all be Alignment). The **operation description is the primary signal
(~80%)**; the op code is dealer shorthand (~20%, useful only once learned). **Labor sale and
tech-hours consistency** are a *supporting* signal.

This document specifies **sub-project A only**: a pure, network-free engine plus an eval
harness that proves accuracy before any DB, UI, or live AI is wired. This is the playbook's
mandated first milestone (§10.2): *engine + eval first, hit the accuracy bar, then build out.*

### Why a rebuild (v1 findings)
- v1 had **no ground-truth set and no automated eval** — it could never prove correctness.
- v1 was **hand-tuned bag-of-words token coverage** with unvalidated magic numbers; new
  dealers meant new regexes/branches (heuristic death spiral; the ALIGN short-description
  bug is a symptom).
- v1's testable logic was **trapped in a 2184-line HTML file** with no module boundary.
- v1's learned KB was **volatile** (in-memory only) and learning could **poison** future
  dealers with no quality gate.

v1 ideas worth keeping (carried into this design): description-first weighting; matching the
**dominant** normalized description cluster (ignore stray minority rows); exclusion-first
ordering; auditable `reason` strings per decision.

---

## Scope

**In scope (A):** a pure TypeScript engine library + eval CLI.
**Out of scope (later sub-projects):** Neon/Postgres, Next.js, live Anthropic calls,
token/`max_tokens` tuning and dynamic batch sizing, review UI, ingest API, notifications,
preview/prod infra.

Stack: TypeScript (strict) + Vitest, npm. No web framework — the engine is a plain module the
future app wraps.

---

## Module layout

```
engine/
  types.ts          Item, Verdict, MenuItem, MatchType, Confidence
  catalog.ts        menu_items (harvested from v1 + Service Name vocabulary)
  normalize.ts      description normalization + tokenization (refined from v1)
  stats.ts          labor/hours CV + confidence modifier
  adjudicator.ts    Adjudicator interface + RecordedAdjudicator
  passes/
    exact.ts        learned (dealerKey, opCode) -> menuItem
    block.ts        block list -> UNMATCHED (terminal)
    deterministic.ts required ^ requiredAlso ^ !disqualify -> RULE; tire qty extraction
    preAiFilter.ts  repair/replacement/labor-only guard -> UNMATCHED (no AI)
    reclassify.ts   near-miss -> AI/LOW "possible new menu item"
  identify.ts       orchestrator: earliest-wins passes, owns batching/chunking
eval/
  ground-truth/     labeled fixtures (e.g. deacon_jones.json)
  metrics.ts        identification / review / false-positive
  harness.ts        run identify over fixtures, gate on accuracy bar
scripts/
  build-ground-truth.ts   dealer CSV -> fixture using the Service Name column
data/                raw dealer CSVs (gitignored; one sample kept)
```

Each unit is small, single-purpose, and independently testable.

---

## Data model

The identifier operates on a **distinct op code aggregated across its rows**, not per row.

```ts
type MatchType  = 'EXACT' | 'RULE' | 'AI' | 'UNMATCHED';
type Confidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Item {
  dealerKey: string;
  opCode: string;
  descriptions: { text: string; count: number }[]; // raw, pre-normalization
  laborValues: number[];
  hoursValues: number[];
  rowCount: number;
}

interface MenuItem {
  id: string;            // stable id, e.g. "brake_fluid"
  name: string;          // == business Service Name string, e.g. "Brake Fluid"
  required: string[];    // at least one must appear
  requiredAlso: string[];// at least one must appear
  disqualify: string[];  // none may appear (e.g. PAD/ROTOR/REPLACE for Brake Fluid)
}

interface Verdict {
  menuItemId: string | null;
  matchType: MatchType;
  confidence: Confidence;
  quantity?: number;          // tire count, when applicable
  reason: string;             // human-auditable explanation
  supportingStats?: {         // from the stats modifier, for transparency
    laborCv: number | null;
    hoursCv: number | null;
    effect: 'bumped' | 'capped' | 'none';
  };
}
```

`matchType` (how it was matched) and `confidence` (how strong) are **separate axes** and never
collapsed into one label.

---

## The pipeline (earliest-wins passes)

An item flows through passes in order; a match in an early pass never reaches later ones, so
most volume resolves before any AI is needed.

1. **exact** — learned `(dealerKey, opCode) → menuItem` ⇒ `EXACT`. In A the learned map is
   passed into `identify`; in production it comes from the DB.
2. **block** — op code or description pattern on the block list ⇒ `UNMATCHED`, terminal,
   never re-asked.
3. **deterministic keyword** — the **dominant** normalized description satisfies a menu item's
   `required ∧ requiredAlso ∧ ¬disqualify` ⇒ `RULE`. A clean unambiguous hit is HIGH; a
   partial hit is MEDIUM. **Tire quantity** is extracted here from the raw description
   (numbers survive only because this reads raw text, not normalized tokens); the business
   label is rendered `"{n} Tire(s)"`.
4. **pre-AI filter** — the dominant description is clearly a repair/replacement (pads, pump,
   rack, hose, "replace") or pure labor/diagnosis ⇒ `UNMATCHED` without spending an AI call.
5. **adjudicator** — the ambiguous middle only ⇒ AI verdict. In A this is the
   `RecordedAdjudicator` (no network).
6. **reclassify** — a near-miss ⇒ `AI`/LOW "possible new menu item" surfaced for review.

**Dominant-cluster rule:** all description matching uses the single most-repeated normalized
description, not any minority row (prevents a stray row from flipping a verdict).

**Load-bearing guard:** every menu item must carry **disqualifiers**, not just required
keywords — this is the single biggest false-positive preventer (e.g. "BRAKE" present but it's
a pad job, not a flush).

---

## Stats-consistency modifier (supporting-only)

`stats.ts` computes the coefficient of variation (CV) of `laborValues` and `hoursValues`
across the op code's rows. Applied **after** a pass produces a candidate:

- **Tight** (cv < ~0.15): bump confidence one notch (e.g. MEDIUM → HIGH).
- **Mid** (~0.15–0.35): no change.
- **Scattered** (cv > ~0.35): cap confidence / nudge toward review.

Hard rules: the modifier **never creates a match** and **never changes which menu item** is
chosen. Rationale: undesired jobs like brake pads are *also* very consistent in labor/hours,
so consistency alone must not imply "service" — the description + disqualifiers decide *what*
it is; stats only corroborate that it behaves like one stable service. Thresholds are tunable
and their effect is tracked in eval output.

---

## Adjudicator seam + batching contract

```ts
interface Adjudicator {
  adjudicate(items: Item[]): Promise<Verdict[]>;
}
```

- `RecordedAdjudicator(fixture)` replays fixed verdicts keyed by item; **no network**. Used by
  tests and the eval harness.
- `AnthropicAdjudicator` is **not built in A** (later sub-project).
- **`identify` owns chunking:** it splits the candidate set into batches of a configurable
  size `N` (default ~25) and calls `adjudicate` once per batch, concatenating results. This is
  the architectural fix for the sibling tool's confirmed defect (entire gap sent in one call,
  `max_tokens: 4000`, no batching) — no adjudicator can ever receive the whole gap. **Live
  token-budget handling and dynamic sizing are deferred** until the live adjudicator + UI exist.

Contract test: 100 candidates with `N=25` ⇒ `adjudicate` called 4×, each batch ≤ 25.

---

## Catalog seed

Menu items are harvested from v1's `SEED_KB` plus the dealer `Service Name` vocabulary, each
authored with `required` / `requiredAlso` / `disqualify`. **Names equal the business Service
Name strings** so eval scoring is exact-equality. Tire is modeled as one internal `Tire
Service` item plus an extracted quantity, rendered to the business labels `"1 Tire"` /
`"2 Tires"` / `"3 Tires"` / `"4 Tires"`. "Service Packages" is retained as a genuine menu item.

Initial coverage targets the services confirmed in real data — Alignment, Brake Fluid,
Transmission, Air Filter, Cabin Filter, Coolant, Fuel Service, Rear Differential, Tires — plus
the remaining v1 categories (Power Steering, Front Differential, Transfer Case, All Wheel
Drive, AC Service, Service Packages). The exact final list is finalized in the implementation
plan against the catalog file.

---

## Ground truth & eval harness

**Source of truth:** the dealer CSV's `Service Name` column is an existing clean label
(verified 1:1 with op code, zero ambiguity on the Deacon Jones file). `build-ground-truth.ts`
parses a CSV, aggregates by op code, and emits a fixture: `{ dealerKey, opCode,
expected: menuItemId | null }`, with `"No services"` → `null` (the ignore class).

**Production source (later):** the UI yes/no loop appends confirmed answers to the same eval
set — bootstrap fixture and production data are the same dataset at two life stages.

**Metrics** (playbook §7 — denominators chosen deliberately):
- **Identification rate (recall)** = `hits / (hits + missed)` — of all real menu services, how
  many were auto-identified.
- **Review rate (load)** = `flagged / total` — share flagged for human review (a match-output
  metric, independent of whether a human acted).
- **False-positive rate** = `falsePositives / (hits + falsePositives)`.

**CI gate:** the Deacon Jones fixture is **eval tier-1 and must stay green** at **≥90%
identification, ≤2% false-positive** (expected ~100% on this clean set). The harness runs both
**cold** (no learned mappings, tests deterministic + adjudicator paths) and **warm** (with
learned mappings, tests the exact pass). Output includes a per-menu-item breakdown.

**Honesty caveat:** one clean dealer (one description per op code, tight stats) is an easy
smoke test, not proof the engine generalizes. Real difficulty (scattered descriptions,
look-alikes, disqualifier edge cases) appears across messier dealers, which we add as further
eval tiers over time. A green tier-1 run must not be read as "works everywhere."

---

## Testing approach (TDD)

- `normalize`, `stats`, and each pass: pure functions, unit-tested with small fixtures.
- `identify`: integration-tested against `RecordedAdjudicator`, including the batching contract.
- Eval harness: asserts tier-1 metrics meet the accuracy bar.
- Flow: write the failing test, watch it fail, implement minimally, watch it pass, commit.
  Small frequent commits.

---

## Accuracy bar

≥90% identification, ≤2% false-positive on eval tier-1 (Deacon Jones), enforced in CI.

---

## Explicitly out of scope for A

DB/Neon, Next.js, live Anthropic calls, token/`max_tokens` tuning and dynamic batch sizing,
review UI, ingest API, notifications, preview/prod infrastructure. Each is its own
spec → plan → build cycle after A proves out.
