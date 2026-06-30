'use client';

import { useMemo, useState } from 'react';
import { MatchTypeChip } from '@/components/ui/chip';
import { cn } from '@/lib/ui';
import { bucketOf, type Bucket } from '@/lib/stats';
import { businessLabel } from '@/engine/catalog';

// ── Inline SVG icons (no lucide-react dep in this project) ──────────────────

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ResultRow {
  opCode: string;
  topDescription: string;
  matchType: string | null;
  confidence: string | null;
  menuItemId: string | null;
  quantity?: number;
  reason: string;
  rowCount: number;
  repetition: number | null;
  laborMean: number | null;
  hoursMean: number | null;
}

export interface MenuOption {
  id: string;
  name: string;
}

// ── Pure helpers (exported for tests + page) ─────────────────────────────────

export function seedDecisions(d: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d ?? {})) if (v === 'approve' || v === 'reject' || v === 'correct') out[k] = v;
  return out;
}

export function bucketFilter(row: {
  matchType: string | null;
  confidence: string | null;
}): Bucket {
  return bucketOf(row);
}

// ── Decision buttons (presentational) ────────────────────────────────────────

function DecisionButtons({
  decision,
  saving,
  error,
  onApprove,
  onReject,
}: {
  decision: string | undefined;
  saving: boolean;
  error: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (saving)
    return <IconLoader className="h-4 w-4 text-muted-foreground" />;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onApprove}
        aria-pressed={decision === 'approve'}
        aria-label="Correct match"
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset transition-colors',
          decision === 'approve'
            ? 'bg-exact text-white ring-exact'
            : 'bg-card text-muted-foreground ring-border hover:bg-exact/10 hover:text-exact',
        )}
      >
        <IconCheck className="h-3.5 w-3.5" /> Yes
      </button>
      <button
        type="button"
        onClick={onReject}
        aria-pressed={decision === 'reject'}
        aria-label="Wrong match"
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset transition-colors',
          decision === 'reject'
            ? 'bg-destructive text-white ring-destructive'
            : 'bg-card text-muted-foreground ring-border hover:bg-destructive/10 hover:text-destructive',
        )}
      >
        <IconX className="h-3.5 w-3.5" /> No
      </button>
      {error && <span className="text-xs text-destructive">retry</span>}
    </span>
  );
}

// ── ResolveSelect (for review/unmatched rows) ────────────────────────────────

function ResolveSelect({
  menuOptions,
  onResolve,
}: {
  menuOptions: MenuOption[];
  onResolve: (menuItemId: string) => void;
}) {
  return (
    <select
      className="h-7 rounded-md border bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) onResolve(e.target.value);
      }}
    >
      <option value="" disabled>
        Resolve…
      </option>
      {menuOptions.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | Bucket;

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'review', label: 'Review' },
  { key: 'unmatched', label: 'Unmatched' },
];

// ── Main table component ──────────────────────────────────────────────────────

export function ResultsTable({
  results,
  storeId,
  runId,
  initialDecisions,
  menuOptions,
  onDecidedChange,
}: {
  results: ResultRow[];
  storeId: string;
  runId: string;
  initialDecisions: Record<string, string>;
  menuOptions: MenuOption[];
  onDecidedChange?: (count: number) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');

  // Decision state lifted to table so highlights survive re-renders.
  const [decided, setDecided] = useState<Record<string, string>>(() =>
    seedDecisions(initialDecisions),
  );
  const [savingOpCode, setSavingOpCode] = useState<string | null>(null);
  const [errorOpCode, setErrorOpCode] = useState<string | null>(null);

  const applyDecision = (opCode: string, outcome: string) => {
    const next = { ...decided, [opCode]: outcome };
    setDecided(next);
    onDecidedChange?.(Object.keys(next).length);
  };

  const decide = async (row: ResultRow, outcome: 'approve' | 'reject') => {
    setSavingOpCode(row.opCode);
    setErrorOpCode(null);
    try {
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, runId, outcome, row }),
      });
      if (!res.ok) throw new Error();
      applyDecision(row.opCode, outcome);
    } catch {
      setErrorOpCode(row.opCode);
    } finally {
      setSavingOpCode((s) => (s === row.opCode ? null : s));
    }
  };

  const resolve = async (row: ResultRow, chosenMenuItemId: string) => {
    setSavingOpCode(row.opCode);
    setErrorOpCode(null);
    try {
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, runId, outcome: 'correct', row, chosenMenuItemId }),
      });
      if (!res.ok) throw new Error();
      applyDecision(row.opCode, 'correct');
    } catch {
      setErrorOpCode(row.opCode);
    } finally {
      setSavingOpCode((s) => (s === row.opCode ? null : s));
    }
  };

  const counts = useMemo(
    () => ({
      all: results.length,
      matched: results.filter((r) => bucketFilter(r) === 'matched').length,
      review: results.filter((r) => bucketFilter(r) === 'review').length,
      unmatched: results.filter((r) => bucketFilter(r) === 'unmatched').length,
    }),
    [results],
  );

  const rows = useMemo(
    () =>
      filter === 'all' ? results : results.filter((r) => bucketFilter(r) === filter),
    [results, filter],
  );

  const fmt = (n: number | null) =>
    n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-4">
      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === t.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted/60',
            )}
          >
            {t.label}{' '}
            <span className="tnum opacity-70">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Op Code</th>
                <th className="px-4 py-2.5 text-left font-medium">Description</th>
                <th className="px-4 py-2.5 text-left font-medium">Match</th>
                <th className="px-4 py-2.5 text-left font-medium">Resolved To</th>
                <th className="px-4 py-2.5 text-right font-medium">Rows</th>
                <th className="px-4 py-2.5 text-right font-medium">Labor $</th>
                <th className="px-4 py-2.5 text-right font-medium">Hours</th>
                <th className="px-4 py-2.5 text-left font-medium">Reason</th>
                <th className="px-4 py-2.5 text-left font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const bucket = bucketFilter(r);
                const dec = decided[r.opCode];
                const isSaving = savingOpCode === r.opCode;
                const isError = errorOpCode === r.opCode;

                const resolvedLabel = r.menuItemId
                  ? businessLabel(r.menuItemId, r.quantity)
                  : null;

                return (
                  <tr key={r.opCode} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                      {r.opCode}
                    </td>
                    <td
                      className="max-w-xs truncate px-4 py-2.5"
                      title={r.topDescription}
                    >
                      {r.topDescription || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <MatchTypeChip matchType={r.matchType ?? 'UNMATCHED'} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {resolvedLabel || '—'}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{r.rowCount}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmt(r.laborMean)}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmt(r.hoursMean)}</td>
                    <td
                      className="max-w-xs truncate px-4 py-2.5 text-xs text-muted-foreground"
                      title={r.reason}
                    >
                      {r.reason || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {dec === 'correct' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-exact/10 px-2 py-0.5 text-xs font-medium text-exact ring-1 ring-inset ring-exact/20">
                          <IconCheck className="h-3.5 w-3.5" /> Resolved
                        </span>
                      ) : r.menuItemId ? (
                        <span className="inline-flex flex-col gap-1">
                          <DecisionButtons
                            decision={dec}
                            saving={isSaving}
                            error={isError}
                            onApprove={() => decide(r, 'approve')}
                            onReject={() => decide(r, 'reject')}
                          />
                          {(bucket === 'review' || bucket === 'unmatched') && !dec && (
                            <ResolveSelect
                              menuOptions={menuOptions}
                              onResolve={(id) => resolve(r, id)}
                            />
                          )}
                        </span>
                      ) : (
                        <ResolveSelect
                          menuOptions={menuOptions}
                          onResolve={(id) => resolve(r, id)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No op-codes in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
