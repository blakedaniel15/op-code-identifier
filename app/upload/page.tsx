'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { PageShell } from '@/components/shell/page-shell';
import { dealerNameFromFilename, pickUploadColumns, extractRows, type UploadRow } from '@/lib/upload';

export default function UploadPage() {
  const router = useRouter();
  const [dealer, setDealer] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data as string[][];
        const headers = data[0] ?? [];
        const cols = pickUploadColumns(headers);
        if (!cols) {
          setError('Could not find an "Op Code" column in this CSV.');
          return;
        }
        const extracted = extractRows(data.slice(1), cols);
        if (extracted.length === 0) {
          setError('No usable rows (every row was missing an op code).');
          return;
        }
        setRows(extracted);
        setDealer(dealerNameFromFilename(file.name));
      },
      error: () => setError('Could not read that file.'),
    });
  }

  async function onRun() {
    setError('');
    if (!dealer.trim()) {
      setError('Enter a dealer name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealerName: dealer.trim(), rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Upload failed.');
      router.push('/runs/' + encodeURIComponent(d.runId));
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const opCodeCount = new Set(rows.map((r) => r.opCode)).size;

  return (
    <PageShell>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Upload a CSV</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a dealer&apos;s raw-data CSV. It&apos;s parsed in your browser — only op code,
            description, labor, and hours are sent. It becomes a run you can review like any other.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <label className="flex flex-col gap-2 text-sm font-medium">
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
          />
        </label>

        {rows.length > 0 && (
          <>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Dealer name
              <input
                type="text"
                value={dealer}
                onChange={(e) => setDealer(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{rows.length.toLocaleString()}</span> rows,{' '}
              <span className="font-medium text-foreground">{opCodeCount}</span> op codes from{' '}
              <span className="font-mono text-xs">{fileName}</span>
            </div>
            <button
              type="button"
              onClick={onRun}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? 'Creating run…' : 'Run'}
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
