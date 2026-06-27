import type { Item } from './types';

export interface RawRow {
  opCode: string;
  description: string;
  laborSale?: string | number;
  techHours?: string | number;
}

function toNumber(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function aggregateRows(rows: RawRow[], dealerKey: string): Item[] {
  const map = new Map<string, Item & { _descCounts: Map<string, number> }>();
  for (const row of rows) {
    const opCode = String(row.opCode ?? '').trim().toUpperCase();
    if (!opCode) continue;
    let agg = map.get(opCode);
    if (!agg) {
      agg = { dealerKey, opCode, descriptions: [], laborValues: [], hoursValues: [], rowCount: 0, _descCounts: new Map() };
      map.set(opCode, agg);
    }
    agg.rowCount++;
    const desc = String(row.description ?? '').trim().replace(/\s+/g, ' ');
    if (desc) agg._descCounts.set(desc, (agg._descCounts.get(desc) ?? 0) + 1);
    const labor = toNumber(row.laborSale);
    if (labor !== null) agg.laborValues.push(labor);
    const hours = toNumber(row.techHours);
    if (hours !== null) agg.hoursValues.push(hours);
  }
  const items: Item[] = [];
  for (const agg of map.values()) {
    const { _descCounts, ...rest } = agg;
    rest.descriptions = [..._descCounts.entries()].map(([text, count]) => ({ text, count }));
    items.push(rest);
  }
  return items.sort((a, b) => b.rowCount - a.rowCount);
}
