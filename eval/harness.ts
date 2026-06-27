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
