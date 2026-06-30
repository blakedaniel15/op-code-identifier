'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageShell } from '@/components/shell/page-shell';
import { StatusChip } from '@/components/ui/chip';
import { cn } from '@/lib/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface RunListItem {
  runId: string;
  storeId: string;
  storeName: string;
  batchId: string;
  total: number;
  opCodes: number;
  status: 'new' | 'in_progress' | 'reviewed';
  decided: number;
  review: number | null;
  matched: number | null;
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ── Run list client component ─────────────────────────────────────────────────

function RunList() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/runs')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed to load runs.');
        return d;
      })
      .then((d) => setRuns(Array.isArray(d.runs) ? d.runs : []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Service-line batches</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Batches imported from the DMS. Click a row to open it and review op-code matches.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {runs === null && !error ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : runs !== null && runs.length === 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-semibold">No service-line batches yet</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Batches are created when the DMS pushes service-line data. Check back soon.
              </p>
            </div>
          </div>
        </div>
      ) : runs !== null && runs.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Store</th>
                  <th className="px-4 py-2.5 text-left font-medium">Batch</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Op Codes</th>
                  <th className="px-4 py-2.5 text-right font-medium">Lines</th>
                  <th className="px-4 py-2.5 text-right font-medium">Reviewed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => (
                  <tr
                    key={r.runId}
                    className={cn('relative hover:bg-muted/30', 'cursor-pointer')}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/runs/${encodeURIComponent(r.runId)}`}
                        className="block after:absolute after:inset-0"
                      >
                        {r.storeName || r.storeId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.batchId}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusChip status={r.status} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{r.opCodes}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted-foreground">
                      {r.total}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-muted-foreground">
                      <span
                        className={
                          r.decided >= r.opCodes && r.opCodes > 0
                            ? 'text-exact'
                            : undefined
                        }
                      >
                        {r.decided}
                      </span>{' '}
                      / {r.opCodes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <PageShell>
      <RunList />
    </PageShell>
  );
}
