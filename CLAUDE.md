# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single self-contained file — `opcode_classifier.html` — that classifies automotive dealership repair-order "OP codes" into the fixed **EZ Wins service taxonomy** (`CATEGORY_LIST`: AC Service, Air Filter, Alignment, Coolant, Transmission, the tire categories, etc.). A dealer uploads a repair-order-level CSV; the app aggregates rows by op code, scores each against a knowledge base of known service patterns, and buckets results into Auto-mapped / Review / Excluded. Output is exported as a mapping CSV, a review CSV, an updated KB JSON, or a branded client PDF.

## Running / developing

There is **no build, no install, no test suite, no package manager**. Open `opcode_classifier.html` directly in a browser (or serve the directory and visit the file). Everything loads from CDNs at runtime:

- React 18 + ReactDOM (UMD) and **Babel Standalone** — JSX is transpiled in the browser via `<script type="text/babel">`. This means edits to the file take effect on plain page reload, but the page is dead without internet.
- PapaParse (CSV parsing), jsPDF + jspdf-autotable (PDF export).

Because there's no test harness, verify changes by reloading the page and running a CSV through the full flow (upload → map columns → results → export).

## Architecture: the classification pipeline

The whole app is one `<script>`. Data flows: **CSV rows → aggregate by op code → classify each → bucket → render/export.** The classifier is intentionally **description-first**: the repeated operation *description* is the primary signal; the op code itself is only a tiebreaker, because op codes vary wildly between dealers while descriptions converge on standard service language. Keep this principle when editing scoring.

`classifyOpCode(agg, kb)` is the heart of it and runs these stages in order — changing one stage's output shape ripples to the rest:

1. **Exclusion** (`checkExclusion`) — drops non-services (oil changes, MPI, recalls, washes, etc.) by `DESC_EXCLUSION_PATTERNS` (majority-of-rows match) and a narrow `OP_EXCLUSION_PATTERNS`. **Service packages bypass exclusion first** (`isPackageDescription`) so campaign-code patterns don't kill scheduled-maintenance bundles.
2. **Repetition** (`repetitionScore`) — fraction of rows sharing the dominant *normalized* description. Scattered descriptions ⇒ likely a complaint/diagnostic code, not a defined service.
3. **KB match** (`matchAgainstKB` → `bestDescSim`/`descSimilarity` + `opSimilarity`) — weighted token-coverage similarity (`combined = 0.80*descSim + 0.20*opSim`), then top-K weighted category voting.
4. **Disambiguation** (`applyDisambiguation`) — hard overrides that beat raw KB voting: service-package language wins outright; tire ops route by detected count (see below); front/rear differential, bundled engine+cabin filters, and fuel-injector phrasings get special handling.
5. **Decision/confidence** — a long if/else ladder combines description-match strength and repetition into AUTO/REVIEW + HIGH/MEDIUM/LOW. Tire ops are exempted from the "scattered description" penalty because tire rows legitimately vary (size/brand/position).

### Things that are easy to get wrong

- **Match against the *dominant* description, not any row.** Several functions (`dominantDescription`, `bestDescSim`, `isPackageDescription`) deliberately use only the most-repeated normalized description so a minority of stray rows can't flip a classification. Preserve this when touching them.
- **Tire counts can't come from the KB.** `normalizeForComparison` strips all digits, so 1-vs-4-tire is decided separately by `isTireOperation` + `detectTireCount` reading the raw description. Tire categories require a mount/R&R/install verb — balance-only and TPMS/valve-stem/spare/repair work is rejected.
- **Token pipeline order matters.** `normalizeForComparison` expands brand/acronym forms (`a/c`→`ac`, `air conditioning`→`ac`, `micro filter`→`microfilter`) *before* stripping punctuation/numbers; then `tokenize` removes `STOPWORDS` and applies `TOKEN_SYNONYMS`. `CONTENT_BOOST` tokens are weighted 2× in similarity. Note `service`/`package`/`maintenance` are intentionally *not* stopwords — they're category signals.

## Knowledge base

`SEED_KB` is an inline array of `{opCode, description, category, source}` entries. The KB is **self-growing**: when a user overrides a category in the results UI, that op code's dominant description is appended to the KB tagged `source: 'override'` with the dealer name, so it matches future dealers. KB can be exported/imported as JSON to persist learning between sessions (there is no server or storage — state lives only in React memory until exported).

## Column mapping

`COLUMN_ALIASES` + `detectColumns` auto-detect the CSV's op-code / description / correction / labor-sale / tech-hours columns (exact alias match, then substring fallback). Only op code and description are required; the user confirms/corrects the mapping in `ColumnMapper` before classification runs.

## Exports & the sandboxed-iframe constraint

Exports assume the page may run inside a **sandboxed iframe** where blob URLs and direct downloads are unreliable. Hence: `downloadText` uses `data:` URLs (not blobs); the `PreviewModal` always offers copy-to-clipboard / open-in-new-tab fallbacks; and `generatePdf` opens the PDF via `dataurlnewwindow` with a download fallback. Don't "simplify" these back to blob downloads — the redundancy is deliberate.
