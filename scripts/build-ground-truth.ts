import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';

// Usage: tsx scripts/build-ground-truth.ts <csvPath> <dealerKey> <outPath>
const [csvPath, dealerKey, outPath] = process.argv.slice(2);
if (!csvPath || !dealerKey || !outPath) { throw new Error('args: <csvPath> <dealerKey> <outPath>'); }

const csv = readFileSync(csvPath, 'utf8');
const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

const byOp = new Map<string, string | null>();
for (const row of data) {
  const opCode = String(row['Op Code'] ?? '').trim().toUpperCase();
  if (!opCode) continue;
  const sn = String(row['Service Name'] ?? '').trim();
  const expected = !sn || sn.toLowerCase() === 'no services' ? null : sn;
  if (!byOp.has(opCode) || (expected !== null && byOp.get(opCode) === null)) byOp.set(opCode, expected);
}

const fixture = [...byOp.entries()].map(([opCode, expected]) => ({ dealerKey, opCode, expected }));
writeFileSync(outPath, JSON.stringify(fixture, null, 2));
console.log(`Wrote ${fixture.length} labeled op codes to ${outPath}`);
