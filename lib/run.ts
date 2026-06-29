import { aggregateRows, type RawRow } from '@/engine/aggregate';
import type { Item } from '@/engine/types';
export interface ServiceLineRow {
  store_id: string; op_code: string; op_description: string;
  labor_sale?: string | number | null; tech_hours?: string | number | null;
}
export function runId(storeId: string, batchId: string): string { return `${storeId}|${batchId}`; }
export function parseRunId(id: string): { storeId: string; batchId: string } {
  const i = id.indexOf('|');
  return { storeId: i >= 0 ? id.slice(0, i) : id, batchId: i >= 0 ? id.slice(i + 1) : '' };
}
export function serviceLinesToItems(rows: ServiceLineRow[]): Item[] {
  const storeId = rows[0]?.store_id ?? 'unknown';
  const raw: RawRow[] = rows.map((r) => ({
    opCode: r.op_code, description: r.op_description ?? '',
    laborSale: r.labor_sale ?? undefined, techHours: r.tech_hours ?? undefined,
  }));
  return aggregateRows(raw, storeId);
}
