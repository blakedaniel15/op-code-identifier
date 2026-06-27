# Op-Code → Menu-Item Classifier — Build Playbook

> **How to use this doc:** Drop it into a new Claude project as knowledge. It is
> self-contained — it describes a proven classifier architecture (battle-tested on
> a sibling "parts matcher" tool) and how to apply it to **service op codes**. Start
> by having Claude run a **brainstorm → spec → plan** pass using §13, then build
> **engine + eval first** (§10). Don't wire UI or network until the engine proves
> out against a ground-truth set.

---

## 0. What you're building

A tool that takes a dealer's service-line data — an **op code** (a dealer-defined
service code like `BR01`, `9PSF`, `MROIL`) and an **operation description** (the
human label, e.g. `"BRAKE FLUID EXCHANGE"`) — and classifies each one as one of a
fixed list of **canonical menu items** (Brake Flush, Power Steering Flush, Coolant
Flush, Transmission Flush, Fuel/Induction Service, …) or **none**. Uncertain ones
go to a human review queue; confirmed ones are remembered so they auto-classify
next time. It reports how well it identifies menu items and notifies a team when a
dealer has new, unmapped services.

This is the same shape as a parts-matching tool, with **one critical difference:
the signal lives in the description, not the code** (see §2).

---

## 1. The reference architecture (copy this skeleton)

These patterns are domain-agnostic. Reuse them as-is.

- **Pure, injected matching engine.** All classification logic lives in an
  `/engine` module with **zero** network/DB calls. The AI step sits behind an
  interface so the engine stays pure and testable:

  ```ts
  // The seam that makes everything testable + eval-able.
  interface Adjudicator {
    adjudicate(items: Item[]): Promise<Verdict[]>;
  }
  // RecordedAdjudicator  -> replays fixed verdicts (tests + eval harness, no network)
  // AnthropicAdjudicator -> calls the model in production
  ```

  This single decision is what lets you prove accuracy in CI without hitting an API.

- **Ordered passes, earliest-wins.** Each item flows through passes; a match in an
  early pass never reaches later ones, so most volume resolves before any AI spend:

  ```
  exact → block → deterministic-match → pre-AI filter → AI adjudicator → reclassify
  ```

- **Two axes, kept separate.** A *prior signal* (how strong the evidence looks)
  vs the *outcome* (`matchType` ∈ {EXACT, RULE, AI, UNMATCHED} × `confidence` ∈
  {EXACT, HIGH, MEDIUM, LOW}). Never collapse them into one label.

- **Human-in-the-loop that compounds.** Auto-approve confident matches; queue the
  rest. Every decision persists immediately and feeds back as a **learned mapping +
  alias + few-shot example**, so accuracy climbs per dealer over time.

- **Eval harness + 3 metrics in CI** (see §7).

- **Standard infra** (see §8): Next.js + Neon Postgres + Vercel, a `/setup`
  migration endpoint, prompt-cached catalog context, a DB-backed verdict cache, an
  authenticated ingest API, a notification on new items, and an isolated
  preview/production split.

---

## 2. The one thing that's different: the signal flips

In a parts tool the **number is ~70%** of the evidence. For op codes, the **operation
description is ~80%**, and the **op code itself is ~20%** — it's dealer-specific
shorthand that's only useful *once learned*.

| | Parts tool | **Op-code tool** |
|---|---|---|
| Catalog | products keyed by part # | **menu items**, each with *required* + *disqualifying* keywords |
| Primary signal | part number (70%) | **operation description (80%)** |
| Secondary signal | item name (30%) | op code (20%, a *learned per-dealer alias*) |
| Exact match | approved SKU → product | **(dealer, opCode) → menu item** — learn once, exact forever for that dealer |
| Rule/fuzzy pass | numeric tricks (zero-pad, etc.) | **keyword/synonym rules** on the description |

**Implication:** the learned per-dealer exact pass is your workhorse (op codes are
stable within a dealer), and the deterministic pass is keyword-based, not numeric.

---

## 3. Data model

- **`menu_items`** (the catalog / "archetypes"): the fixed canonical services.
  Each carries keyword rules so the deterministic pass is precise:

  ```jsonc
  {
    "id": "brake_flush",
    "name": "Brake Fluid Flush",
    "required":     ["BRAKE", "BRK"],            // at least one
    "requiredAlso": ["FLUSH", "FLUID", "EXCHANGE", "BLEED"], // at least one
    "disqualify":   ["PAD", "ROTOR", "CALIPER", "REPLACE", "JOB"] // none may appear
  }
  ```

  Seed examples: Brake Flush, Power Steering Flush, Coolant/Antifreeze Flush,
  Transmission Flush, Fuel/Induction Service, Differential Service, A/C Service,
  Battery Service, Engine Oil Service. (Confirm the real list during brainstorm.)

- **`learned_mappings`** (the compounding asset): `(dealerKey, opCode) → menuItemId`,
  written on every human approval. Pass-1 input.
- **`aliases`**: `menuItemId → [description phrases seen for it]`, per dealer +
  global. Feeds the AI prompt as few-shot context.
- **`blocked`**: `(dealerKey, opCode|descriptionPattern)` a human marked "not a menu
  service" (e.g. `SHOP SUPPLIES`, `DIAGNOSIS`, `MULTIPOINT INSPECTION`).
- **`decisions`**, **`run_snapshots`**, **`ai_verdict_cache`**: same as the parts
  tool — decisions drive metrics; snapshots persist each run (with `status`
  in_progress|reviewed); the verdict cache makes re-runs free.

---

## 4. The matching pipeline (pass by pass)

1. **Exact — learned, per-dealer.** `(dealer, opCode)` already approved →
   menu item, `EXACT`. Most of a known dealer's volume resolves here, no AI.
2. **Block.** Op code / description on the block list → `UNMATCHED`, never re-asked.
3. **Deterministic keyword match (the "fuzzy" analog).** Description satisfies a
   menu item's `required ∧ requiredAlso ∧ ¬disqualify` → `RULE`. A clean,
   unambiguous hit is HIGH; a partial hit is MEDIUM.
4. **Pre-AI filter.** Descriptions that name a system but are clearly a
   **repair/replacement, not a fluid service**, or are pure labor/diagnosis →
   `UNMATCHED` without spending an AI call. (The direct analog of a parts
   false-positive guard.)
5. **AI adjudicator.** The ambiguous middle only (see §5).
6. **Reclassification.** Near-misses → `AI`/LOW "possible new menu item" for review.

**The load-bearing guard:** every menu item needs **disqualifiers**, not just
required keywords. Without them, `"REPLACE BRAKE PADS"` false-matches *Brake Flush*
on the word "BRAKE" alone. This single rule prevents the most common and most
damaging error class.

---

## 5. The AI adjudicator

- **Batched** model calls (e.g. 30/items) returning **structured tool-use** output:
  `{ index, matched, menuItemId, confidence (HIGH|MEDIUM|LOW), reason }`.
- **Cached prompt prefix** (`cache_control: ephemeral`) holds the menu-item catalog
  + aliases + few-shot examples, so the big context is billed ~10% after the first
  call. A **DB verdict cache** keyed by a content hash makes identical re-runs free.
- **Prompt policy (load-bearing):**
  - The **operation description is the primary signal (~80%)**; the **op code is
    dealer shorthand (~20%)** — rely on the provided learned aliases to read it.
  - A service that mentions a system but is a **repair/replacement** (pads, pump,
    hose, rack, "replace") is **NOT** the flush/service menu item.
  - Prefer **none** over a low-confidence guess.
- Parse defensively; on any API/parse error, the whole batch falls back to
  `UNMATCHED` (never crash a run).

---

## 6. Human-in-the-loop & the feedback loop

- **Auto-approve:** `EXACT` (learned) and clean `RULE` HIGH. **Always queue:** AI
  results and ambiguous rule hits.
- On **approve**, write three things: the `learned_mapping` `(dealer,opCode)→item`,
  a description **alias**, and (optionally) a few-shot **example**. This is why
  accuracy compounds — next week that dealer's same code is instant + exact.
- On **reject-forever**, add to `blocked`.
- Persist each decision **immediately** (not batched on "Done"), and persist the run
  snapshot the moment a run completes (status `in_progress`) so a half-done review
  is never lost on navigation.

---

## 7. Metrics & eval harness

Build the eval harness **before** the UI. Maintain a ground-truth set of real
`(opCode, opDescription) → menuItemId | none` rows and run it in CI.

Three metrics (define denominators deliberately — getting this wrong is a classic trap):

- **Identification rate (recall):** of all real menu services, how many the system
  auto-identified = `hits / (hits + rescued)`.
- **Review rate (load):** share of items the system flagged for review =
  `flagged / total` (a match-output metric — independent of whether a human acted).
- **False-positive rate:** `falsePositives / (hits + falsePositives)`.

Targets to aim for (tune to your data): ≥90% identification, ≤2% false positives.

---

## 8. Tech stack & infra

- **Next.js (App Router) + TypeScript strict + Vitest.** Pure logic in `/engine`
  and `/lib`, unit-tested in CI. Routes are thin.
- **Neon serverless Postgres.** The HTTP client is tagged-template **only** — run
  DDL one statement at a time in a `/api/admin/setup` migration endpoint (secret-
  gated). Make reads/writes **tolerant of a not-yet-added column** so a deploy
  before the migration doesn't break the app; **re-run `/setup` after each deploy**
  that adds schema.
- **Anthropic Messages API**, server-side only, structured tool-use + prompt caching.
- **Vercel deploy** with a clean **production domain** on `main`, and a **preview**
  on a dev branch. Give preview its **own database** (a Neon branch via a
  `PREVIEW_DATABASE_URL` the app prefers when `VERCEL_ENV=preview`) so testing never
  touches production. Preview deployments sit behind Vercel auth — use a
  **Protection Bypass token** to curl-test them.
- **Config via env** with a tolerant DB-URL resolver (accept `DATABASE_URL` /
  `POSTGRES_URL` / `*_NON_POOLING`, etc.).

---

## 9. Free leverage: share the ingest feed

A dealer's service feed already carries **both** `opCode` **and** `opDescription`
per line (the parts tool ingests them today). So this tool does **not** need its own
data feed — it's the **same payload, a second classifier**. Two options:

- **Sibling endpoint** that runs op-code classification on the same posted batch, or
- **One ingest that fans out** to both the parts classifier and the op-code classifier.

Either way the integrator builds **one** thing. Mirror the proven ingest contract:
`POST` with **Bearer auth**, an **Idempotency-Key**, validation, **dedup to distinct
items**, **gap detection** (which op codes for this dealer aren't mapped yet), and a
**notification** (e.g. a ClickUp task) when a dealer has new unmapped services.

---

## 10. Build sequence (milestones, in order)

1. **Brainstorm → spec → plan.** Don't skip; it's why the sibling tool went smoothly.
2. **Engine + eval first** — pure passes, `RecordedAdjudicator`, a real ground-truth
   set. Hit your identification / false-positive targets **before** wiring anything.
3. **Data layer + AI adjudicator** — Neon, `/setup`, prompt + verdict caches.
4. **Thin review UI** — Yes/No, persist-immediately, in-progress runs, run history.
5. **Stats** — the 3 metrics + a per-menu-item breakdown.
6. **Ingest + notify** — shared/sibling feed, gap detection, new-item notification.
7. **Preview/prod hardening** — separate preview DB, promote-when-ready.

---

## 11. Guardrails (hard-won — treat as rules)

- **Disqualifier keywords on every menu item** — the single biggest false-positive
  preventer ("BRAKE" present but it's a pad job, not a flush).
- **Description-first weighting** — never let a familiar code override a contradicting
  description.
- **Invest in the learned `(dealer,opCode)` loop** — that's where accuracy compounds.
- **Define metric denominators deliberately** (identification rate vs review load are
  different questions with different bases).
- **Migration-tolerant DB code** + re-run `/setup` after deploy (deploy-before-migrate
  is a real trap).
- **Persist work-in-progress immediately** so reviews are never lost.
- **Isolated preview DB + promote-when-ready + bypass token** for safe testing.
- **AI never crashes a run** — any API/parse error → the batch falls back to UNMATCHED.

---

## 12. Working agreement (process)

- **Flow:** brainstorm (one question at a time, get design approval) → write a spec
  doc → write an implementation plan (bite-sized TDD steps) → execute → verify.
- **TDD:** write the failing test, watch it fail, implement minimally, watch it pass,
  commit. Frequent small commits.
- **Git:** develop on a branch that maps to the preview deploy; **promote to the
  production branch only when the human approves**. Production never moves silently.
- **Honesty:** report real test/build output; if something's skipped or failing,
  say so.

---

## 13. First decisions to resolve in the brainstorm

Have Claude ask these before writing the spec:

1. **The menu-item list** — the exact canonical services you care about (and which
   you don't, e.g. is "oil change" in scope?).
2. **Keyword rules per item** — the required + disqualifying terms (seed from real
   descriptions; refine against the ground-truth set).
3. **Ingest: shared vs sibling** — fan out from the existing parts feed, or a
   separate endpoint?
4. **Decision home** — reviewed in-tool now, moving to your platform later? (Affects
   whether "known/mapped" is delivered or tracked in-tool.)
5. **Notification target** — where do "new unmapped service" alerts go?
6. **Accuracy bar** — the identification / false-positive targets that get your team
   on board.
