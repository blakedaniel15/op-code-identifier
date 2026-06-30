'use client';

import { useEffect, useState } from 'react';
import { PageShell } from '@/components/shell/page-shell';
import { cn } from '@/lib/ui';
import type { Tally } from '@/lib/stats';

// ── Types ────────────────────────────────────────────────────────────────────

interface RunStat extends Tally {
  runId: string;
  dealer: string;
  ranAt: string | null;
}

interface StatsData {
  overall: Tally;
  runs: RunStat[];
}

// ── Rate helpers (verbatim from brief) ───────────────────────────────────────

const idRate = (t: Tally) => (t.denominator ? t.hits / t.denominator : 0);
const reviewRate = (t: Tally) => (t.parts ? t.reviewFlagged / t.parts : 0);
const fpRate = (t: Tally) =>
  t.hits + t.falsePositives ? t.falsePositives / (t.hits + t.falsePositives) : 0;
const pct = (x: number) => (x * 100).toFixed(1) + '%';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ── Sub-components ────────────────────────────────────────────────────────────

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

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'bad-when-high';
}) {
  const color =
    tone === 'good'
      ? 'text-accent'
      : tone === 'warn'
        ? 'text-fuzzy'
        : value === '0.0%'
          ? 'text-exact'
          : 'text-destructive';
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-1 py-5 px-5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cn('tnum text-3xl font-bold tracking-tight', color)}>{value}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-1 py-4 px-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="tnum text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

// ── Stats client component ────────────────────────────────────────────────────

function StatsView() {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed to load stats.');
        return d;
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Accuracy &amp; stats</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How well the engine identifies service-line op-codes — measured against your review decisions.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : !data || data.overall.decided === 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-semibold">No decisions yet — review a run to see accuracy</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Open a batch, review the op-code matches (Yes / No / Resolve), and your stats will appear here.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Across {data.runs.length} {data.runs.length === 1 ? 'run' : 'runs'} ·{' '}
            {data.overall.denominator} confirmed menu items
          </p>

          {/* 3 KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi
              label="Identification rate"
              value={data.overall.denominator ? pct(idRate(data.overall)) : '—'}
              sub={`${data.overall.hits} / ${data.overall.denominator} auto-matched`}
              tone="good"
            />
            <Kpi
              label="Review rate"
              value={data.overall.parts ? pct(reviewRate(data.overall)) : '—'}
              sub={`${data.overall.reviewFlagged} of ${data.overall.parts} flagged for review`}
              tone="warn"
            />
            <Kpi
              label="False-positive rate"
              value={
                data.overall.hits + data.overall.falsePositives
                  ? pct(fpRate(data.overall))
                  : '—'
              }
              sub={`${data.overall.falsePositives} of ${data.overall.hits + data.overall.falsePositives} matches wrong`}
              tone="bad-when-high"
            />
          </div>

          {/* Secondary stat cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Auto-matched"
              value={String(data.overall.hits)}
              sub="confirmed correct"
            />
            <Stat
              label="Rescued · review"
              value={String(data.overall.rescuedReview)}
              sub="low-confidence, approved"
            />
            <Stat
              label="Rescued · unmatched"
              value={String(data.overall.rescuedUnmatched)}
              sub="engine missed"
            />
            <Stat
              label="False positives"
              value={String(data.overall.falsePositives)}
              sub="matched, you said no"
            />
          </div>

          {/* By-run table */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="px-5 py-4 border-b">
              <h3 className="text-sm font-semibold">By run</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Identification · review · false-positive rate per batch.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Dealer</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Identify</th>
                    <th className="px-4 py-2.5 text-right font-medium">Review</th>
                    <th className="px-4 py-2.5 text-right font-medium">False+</th>
                    <th className="px-4 py-2.5 text-right font-medium">Menu items</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.runs.map((r) => (
                    <tr key={r.runId} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">{r.dealer}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {fmtDate(r.ranAt)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right font-medium text-accent">
                        {r.denominator ? pct(idRate(r)) : '—'}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-fuzzy">
                        {r.parts ? pct(reviewRate(r)) : '—'}
                      </td>
                      <td
                        className={cn(
                          'tnum px-4 py-2.5 text-right',
                          r.falsePositives ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {r.hits + r.falsePositives ? pct(fpRate(r)) : '—'}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-muted-foreground">
                        {r.denominator}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  return (
    <PageShell>
      <StatsView />
    </PageShell>
  );
}
