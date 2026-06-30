'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/shell/page-shell';
import { ResultsTable, bucketFilter, type ResultRow } from '@/components/review/results-table';
import { MENU_ITEMS } from '@/engine/catalog';

const MENU_OPTIONS = MENU_ITEMS.map((m) => ({ id: m.id, name: m.name }));

// ── Client component ──────────────────────────────────────────────────────────

interface RunData {
  runId: string;
  storeId: string;
  storeName: string;
  batchId: string;
  results: ResultRow[];
  decisions: Record<string, string>;
}

function RunReview({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decidedCount, setDecidedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const snapshotted = useRef(false);

  useEffect(() => {
    // The route param may arrive percent-encoded (the run id contains '|' → '%7C').
    // Normalize to the raw id, then encode exactly once so we don't double-encode.
    let rawRunId = runId;
    try { rawRunId = decodeURIComponent(runId); } catch { /* already decoded */ }
    fetch('/api/runs/' + encodeURIComponent(rawRunId))
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed to load run.');
        return d as RunData;
      })
      .then(async (d) => {
        setRun(d);

        // Persist snapshot as in_progress (once per mount).
        if (!snapshotted.current) {
          snapshotted.current = true;
          const results = d.results ?? [];
          const matched = results.filter((r) => bucketFilter(r) === 'matched').length;
          const review = results.filter((r) => bucketFilter(r) === 'review').length;
          const unmatched = results.filter((r) => bucketFilter(r) === 'unmatched').length;
          try {
            await fetch('/api/runs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                runId: d.runId,
                storeId: d.storeId,
                storeName: d.storeName,
                batchId: d.batchId,
                total: results.length,
                matched,
                review,
                unmatched,
                snapshot: results,
                status: 'in_progress',
              }),
            });
          } catch {
            /* best-effort */
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  const done = async () => {
    if (!run) return;
    setSaving(true);
    try {
      const results = run.results ?? [];
      const matched = results.filter((r) => bucketFilter(r) === 'matched').length;
      const review = results.filter((r) => bucketFilter(r) === 'review').length;
      const unmatched = results.filter((r) => bucketFilter(r) === 'unmatched').length;
      await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: run.runId,
          storeId: run.storeId,
          storeName: run.storeName,
          batchId: run.batchId,
          total: results.length,
          matched,
          review,
          unmatched,
          snapshot: results,
          status: 'reviewed',
        }),
      });
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
    router.push('/');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!run) return null;

  const total = run.results.length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {run.storeName || run.storeId}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tnum">{decidedCount}</span> of{' '}
            <span className="tnum">{total}</span> reviewed · decisions save automatically
          </p>
        </div>
        <button
          type="button"
          onClick={done}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {saving ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : null}
          Done
        </button>
      </div>

      {/* Results table */}
      <ResultsTable
        key={runId}
        results={run.results}
        storeId={run.storeId}
        runId={run.runId}
        initialDecisions={run.decisions}
        menuOptions={MENU_OPTIONS}
        onDecidedChange={setDecidedCount}
      />
    </div>
  );
}

// ── Server page wrapper ───────────────────────────────────────────────────────

export default function RunPage({ params }: { params: { runId: string } }) {
  return (
    <PageShell>
      <RunReview runId={params.runId} />
    </PageShell>
  );
}
