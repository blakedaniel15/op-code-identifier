# Review UI + Stats — Implementation Handoff

> **Companion to the classifier playbook.** Drop this into the op-code project too.
> It documents — with working code — the **human review UI** and the **accuracy
> stats**, both of which transfer 1:1 from the sibling parts tool. The stats are the
> part that's subtly easy to get wrong; the exact formulas and the *two data
> sources* are spelled out below. Build the review UI and stats as described.

**Terminology map (parts tool → op-code tool):** `SKU` → **op code** (the per-item
key); `MOC part / archetype` → **menu item**; the buckets **matched / review /
unmatched** are identical. Everywhere below, "item key" = the op code (scoped per
dealer where relevant).

---

## 0. The loop this implements

```
match a file/batch ─▶ persist run immediately (status: in_progress)
        │
        ▼
human reviews each row: Yes / No / (resolve to a menu item)
        │  └─ every click writes to the `decisions` table IMMEDIATELY (with run_id)
        ▼
"Done" ─▶ run status: reviewed
        │
        ▼
Stats read `decisions` (identification + false-positive rates)
      + `run_snapshots` (review load)  ─▶  3 KPIs, overall + per file
```

Two non-obvious truths that make it correct:
1. **Decisions persist on each click, not on "Done"** — so nothing is lost.
2. **Stats come from TWO sources**: human *decisions* drive identification &
   false-positive rates; the *match output* (run snapshot counts) drives the
   review-load rate. Mixing them correctly is the whole game (see §4).

---

## 1. Data model (exact)

```sql
-- one row per human verdict, written immediately on click
create table decisions (
  id bigserial primary key,
  sku text not null,             -- the item key (op code)
  part_name text not null default '',  -- the description
  match_type text null,          -- EXACT | RULE | AI | UNMATCHED  (the system's call)
  confidence text null,          -- EXACT | HIGH | MEDIUM | LOW
  outcome text not null,         -- approve | reject | correct
  bare_part_number text null,    -- the resolved menu item id (on approve/correct)
  run_id text,                   -- ties the decision to one run/file  ← REQUIRED for per-file stats
  dealer text,
  ts timestamptz not null default now()
);

-- one row per run/file; written the moment matching finishes, updated on Done
create table run_snapshots (
  run_id text primary key,
  dealer text,
  file_name text,
  total integer not null default 0,      -- items in the run
  matched integer not null default 0,    -- matched-bucket count (match output)
  review integer not null default 0,     -- review-bucket count  ← drives review-load rate
  unmatched integer not null default 0,
  snapshot jsonb,                        -- the full results array, to reopen the run
  status text not null default 'reviewed', -- 'in_progress' | 'reviewed'
  ran_at timestamptz not null default now()
);
```

`learned_mappings` / `aliases` (the feedback loop) are covered in the main
playbook; the review UI writes to them on approve/correct.

**Migration discipline:** add `status` (and any later column) with
`add column if not exists`, default it to the *backfill-correct* value
(`'reviewed'` for pre-existing rows), and make reads tolerant of the column not
existing yet (try the new query, fall back to the old one) so a deploy before the
migration doesn't break the page.

---

## 2. The decision API (persist immediately)

`POST /api/decision` with `{ dealer, runId, outcome, row, chosenBare?, chosenName? }`.
Each click calls it; it writes one `decisions` row **and** updates the feedback
stores:

```ts
// outcome: "approve" (system match is right) | "reject" (wrong) | "correct" (pick a different menu item)
const targetBare = outcome === "approve" ? row.matchedPartNumber
                 : outcome === "correct" ? chosenBare : null;

await recordDecision(sql, {
  sku: row.sku, partName: row.partName ?? "",
  matchType: row.matchType ?? null, confidence: row.confidence ?? null,
  outcome, barePartNumber: targetBare ?? null,
  runId: runId ?? null, dealer: dealer ?? null,   // run_id is what makes per-file stats work
});

if ((outcome === "approve" || outcome === "correct") && targetBare) {
  await upsertLearnedMapping(sql, { dealer, opCode: row.sku, menuItemId: targetBare, ... });
} else if (outcome === "reject") {
  await addBlock(sql, dealer, row.sku);
}
```

**Critical:** always send `runId`. Decisions without a `run_id` can't be grouped
per file and land in an "Earlier reviews" bucket (see §4).

---

## 3. The review UI

### 3a. Run lifecycle (never lose work)

When matching finishes (manual upload *or* ingest), **immediately** persist the
run as `in_progress` before navigating — don't wait for "Done":

```ts
const isMatched = (r) => r.matchType === "EXACT" || r.matchType === "RULE"
  || (r.matchType === "AI" && (r.confidence === "HIGH" || r.confidence === "MEDIUM"));
const isReview  = (r) => r.matchType === "AI" && r.confidence === "LOW";

await fetch("/api/runs", { method: "POST", headers: {"content-type":"application/json"},
  body: JSON.stringify({
    runId, dealer, fileName,
    total: results.length,
    matched: results.filter(isMatched).length,
    review:  results.filter(isReview).length,
    unmatched: results.filter(r => r.matchType === "UNMATCHED").length,
    snapshot: results, status: "in_progress",
  }) });
```

`saveRunSnapshot` upserts on `run_id` and takes a `status` (default
`'in_progress'`); the **Done** button re-POSTs the same run with
`status: "reviewed"`. Ingested runs are also created `in_progress` so the team
picks them up in the same review list.

### 3b. Results page = active run + run history

- If there's an active run (in sessionStorage, set at match time): show the review
  table.
- Otherwise: show **run history** (from `GET /api/runs`) — a list with a
  **status chip** (In progress / Reviewed) and an **"N of M reviewed"** progress
  count. Clicking a row reopens it.

History rows come from `loadRunSummaries`, which returns `status` and a `decided`
count (distinct decided items for that run):

```sql
select rs.run_id, rs.dealer, rs.file_name, rs.total, rs.matched, rs.review,
       rs.unmatched, rs.status, rs.ran_at,
       (select count(distinct d.sku) from decisions d where d.run_id = rs.run_id) as decided
from run_snapshots rs order by rs.ran_at desc limit 200;
```

### 3c. ResultsTable — the component (and its two hard-won lessons)

```ts
function ResultsTable({ results, dealer, runId, initialDecisions, onDecisionsChange }) {
  // LESSON 1: decision state is owned by the TABLE, keyed by item key — never by the
  // cell. (Putting it in the cell loses the Yes/No highlight on every re-render.)
  const [decided, setDecided] = useState(() => pickYesNo(initialDecisions)); // {opCode: "approve"|"reject"}
  const [savingSku, setSavingSku] = useState(null);

  const decide = async (row, outcome) => {        // "approve" | "reject"
    setSavingSku(row.sku);
    try {
      const res = await fetch("/api/decision", { method: "POST",
        headers: {"content-type":"application/json"},
        body: JSON.stringify({ dealer, runId, outcome, row }) });
      if (!res.ok) throw new Error();
      const next = { ...decided, [row.sku]: outcome };   // optimistic update only on success
      setDecided(next); onDecisionsChange?.(next);
    } catch { /* mark row as retry-able */ }
    finally { setSavingSku(s => s === row.sku ? null : s); }
  };
  // rows: Yes/No buttons when there's a candidate match; "resolve to menu item"
  // (pick existing / add new) when unmatched. Resolving fires outcome "correct".
}

// LESSON 2: on reopen, restore prior decisions so the reviewer resumes, not restarts.
function pickYesNo(d) {                 // keep only the toggle-able outcomes
  const out = {};
  for (const [k, outcome] of Object.entries(d ?? {}))
    if (outcome === "approve" || outcome === "reject") out[k] = outcome;
  return out;
}
```

- Render the table with `key={runId}` so reopening a different run remounts it and
  `initialDecisions` re-seeds.
- `GET /api/runs/[runId]` returns `{ ...snapshot, decisions }`, where `decisions`
  is the latest outcome per item for that run:
  `select distinct on (sku) sku, outcome from decisions where run_id = $1 order by sku, ts desc`.

### 3d. Status chip

```tsx
const inProgress = status === "in_progress";
<span className={inProgress ? "amber chip" : "green chip"}>
  {inProgress ? <Clock/> : <Check/>} {inProgress ? "In progress" : "Reviewed"}
</span>
```

### UI lessons, condensed
1. **Decision state lives in the table, keyed by item key** — not in the cell.
2. **Persist the run on creation** (`in_progress`), not on "Done" — navigation/tab
   close must never lose a review.
3. **Reopen restores prior decisions** from the `decisions` table; key the table by
   `runId` so it remounts.
4. **Optimistic UI only after the POST succeeds** (show a saving spinner; allow retry).

---

## 4. The stats — get this exactly right

### 4a. The three metrics (precise)

| KPI | Formula | Source | Question it answers |
|---|---|---|---|
| **Identification rate** (recall) | `hits / (hits + rescuedReview + rescuedUnmatched)` | decisions | of all real menu items, how many did the system auto-identify |
| **Review rate** (load) | `reviewFlagged / parts` | **run snapshots** | how often the system punts to a human (independent of decisions) |
| **False-positive rate** | `falsePositives / (hits + falsePositives)` | decisions | of confident matches, how many were wrong |

The trap we hit and fixed: **review rate must come from the match output (snapshot
`review`/`total`), NOT from decisions.** If you compute it as
`rescuedReview / denominator` it reads 0% for any file whose review items the human
hasn't approved yet — wrong, and confusing. Source it from snapshots so it reflects
what the system *flagged*, regardless of whether a human acted.

Targets to aim for: **≥90% identification, ≤2% false positives.**

### 4b. The engine — port this verbatim (domain-agnostic)

```ts
export type Bucket = "matched" | "review" | "unmatched";

// the system's call, bucketed
export function bucketOf(d: { matchType: string|null; confidence: string|null }): Bucket {
  const mt = d.matchType;
  if (mt === "EXACT" || mt === "RULE") return "matched";          // deterministic matches
  if (mt === "AI") return d.confidence === "HIGH" || d.confidence === "MEDIUM" ? "matched" : "review";
  return "unmatched";
}

export interface Tally {
  hits: number;             // matched-bucket items the human approved  (numerator)
  rescuedReview: number;    // review-bucket items the human approved
  rescuedUnmatched: number; // unmatched-bucket items the human resolved
  falsePositives: number;   // matched-bucket items the human REJECTED
  denominator: number;      // hits + rescuedReview + rescuedUnmatched  (all real menu items)
  rate: number;             // hits / denominator
  decided: number;          // items with any verdict
  reviewFlagged: number;    // from snapshots (set in computeStats, not here)
  parts: number;            // from snapshots
}

function tally(decisions: DecisionRow[]): Tally {
  // dedupe to the LATEST decision per (run, item) — input ordered by ts ascending
  const latest = new Map<string, DecisionRow>();
  for (const d of decisions) latest.set((d.runId ?? "") + "|" + d.sku, d);

  let hits=0, rescuedReview=0, rescuedUnmatched=0, falsePositives=0, decided=0;
  for (const d of latest.values()) {
    const b = bucketOf(d);
    if (d.outcome === "approve" || d.outcome === "correct") {
      decided++;
      if (b === "matched") hits++;
      else if (b === "review") rescuedReview++;
      else rescuedUnmatched++;
    } else if (d.outcome === "reject") {
      decided++;
      if (b === "matched") falsePositives++;   // confident match the human killed
    }
  }
  const denominator = hits + rescuedReview + rescuedUnmatched;
  return { hits, rescuedReview, rescuedUnmatched, falsePositives, denominator,
           rate: denominator ? hits/denominator : 0, decided, reviewFlagged: 0, parts: 0 };
}

export interface RunSummaryInput { runId: string; dealer: string; review: number; total: number; ranAt: string|null; }

export function computeStats(decisions: DecisionRow[], runSummaries: RunSummaryInput[] = []) {
  // overall: decisions drive id/fp; snapshots drive review load
  const overall: Tally = {
    ...tally(decisions),
    reviewFlagged: runSummaries.reduce((a, s) => a + (s.review || 0), 0),
    parts:         runSummaries.reduce((a, s) => a + (s.total  || 0), 0),
  };

  const EARLIER = "__earlier__";                 // decisions with no run_id
  const byRun = new Map<string, DecisionRow[]>();
  for (const d of decisions) (byRun.get(d.runId || EARLIER) ?? byRun.set(d.runId || EARLIER, []).get(d.runId || EARLIER))!.push(d);
  const summaryByRun = new Map(runSummaries.map(s => [s.runId, s]));

  // a run shows if it has decisions OR a snapshot
  const runIds = new Set<string>([...summaryByRun.keys(), ...byRun.keys()]);
  const runs = [...runIds].map(runId => {
    const ds = byRun.get(runId) ?? [];
    const s = summaryByRun.get(runId);
    return {
      runId,
      dealer: runId === EARLIER ? "Earlier reviews" : (s?.dealer || ds.find(d=>d.dealer)?.dealer || "unknown"),
      ranAt: s?.ranAt ?? ds[ds.length-1]?.ts ?? null,
      ...tally(ds),
      reviewFlagged: s?.review ?? 0,
      parts: s?.total ?? 0,
    };
  }).sort((a,b) => (b.ranAt ?? "").localeCompare(a.ranAt ?? ""));

  return { overall, runs };
}
```

> Note: the one-liner `byRun` insert above is terse — in real code write it as a
> normal "get-or-create then push". Logic is what matters: group decisions by
> `run_id`, with null grouped under `__earlier__`.

### 4c. The stats route (load BOTH sources)

```ts
const [decisions, runs] = await Promise.all([loadDecisions(sql), loadRunSummaries(sql)]);
const summaries = runs.map(r => ({ runId: r.runId, dealer: r.dealer, review: r.review, total: r.total, ranAt: r.ranAt }));
return Response.json(computeStats(decisions, summaries));
```

`loadDecisions` returns rows ordered by `ts asc` (the dedupe relies on it).

### 4d. The stats page (3 KPIs + per-file table)

```ts
const idRate     = t => t.denominator ? t.hits / t.denominator : 0;
const reviewRate = t => t.parts ? t.reviewFlagged / t.parts : 0;   // ← snapshot-sourced
const fpRate     = t => (t.hits + t.falsePositives) ? t.falsePositives / (t.hits + t.falsePositives) : 0;
```

- Three KPI cards: Identification (good/green), Review rate (warn), False-positive
  (bad-when-high — green at 0%).
- "By file" table: one row per run — Identify% (`idRate`, gated on `denominator`),
  Review% (`reviewRate`, gated on `parts`), False+% (`fpRate`), and the menu-item
  count (`denominator`).
- Empty state when `overall.decided === 0`.

### 4e. Stats pitfalls (all real, all hit)
- **Review rate from snapshots, not decisions** (§4a) — the big one.
- **Every decision needs `run_id`** or per-file stats collapse into "Earlier reviews."
- **Dedup to the latest decision per (run, item)** — a reviewer who changes their
  mind (approve → reject) must flip the bucket, not double-count.
- **Define denominators deliberately:** id rate is over *confirmed menu items*;
  review load is over *all items in the file*. They're different bases on purpose.
- **A run with a snapshot but no decisions still appears** (review load shows;
  identify shows "—"). That's intended — review load is a match-output property.

---

## 5. Build order for this slice

1. `decisions` + `run_snapshots` tables (with `status`) + the migration discipline.
2. `POST /api/decision` (immediate write + feedback stores).
3. `saveRunSnapshot` (status param) + persist-on-creation in the match flow.
4. ResultsTable with lifted decision state + `initialDecisions` + reopen restore.
5. Run history (status chip + decided count) + reopen route returning `decisions`.
6. **Stats engine** (`bucketOf` / `tally` / `computeStats`) — **unit-test it first**
   with the exact cases below.
7. Stats route (load both sources) + stats page (3 KPIs + by-file).

**Seed unit tests (port these):**
- 10 EXACT-approve + 1 AI/LOW-approve (rescued review) + 1 unmatched-correct → id
  rate = 10/12.
- approve then reject the same item (later wins) → hits 0, falsePositives 1.
- snapshot with `review: 2, total: 15`, **zero decisions** → `reviewFlagged 2,
  parts 15` (review load shows even with nothing decided). This is the regression
  test for the §4a trap.
