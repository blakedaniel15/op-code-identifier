export interface UploadColumns {
  opCode: number;
  opDescription: number;
  laborSale: number;
  techHours: number;
}

export interface UploadRow {
  opCode: string;
  opDescription: string;
  laborSale: string;
  techHours: string;
}

export function dealerNameFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');           // strip extension
  const noSuffix = base.replace(/_raw_data_.*$/i, '');  // strip a trailing export suffix
  const spaced = noSuffix.replace(/[_-]+/g, ' ').trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function storeIdFromDealer(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Exact header match first, then an all-tokens-present substring fallback.
function findCol(headers: string[], exact: string[], contains: string[][]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const e of exact) {
    const i = norm.indexOf(e);
    if (i >= 0) return i;
  }
  for (let i = 0; i < norm.length; i++) {
    const normI = norm[i];
    if (normI) {
      for (const group of contains) if (group.every((t) => normI.includes(t))) return i;
    }
  }
  return -1;
}

export function pickUploadColumns(headers: string[]): UploadColumns | null {
  const opCode = findCol(headers, ['op code'], [['op', 'code']]);
  if (opCode < 0) return null;
  return {
    opCode,
    opDescription: findCol(headers, ['operations description', 'op description'], [['description']]),
    laborSale: findCol(headers, ['labor sale'], [['labor', 'sale']]),
    techHours: findCol(headers, ['tech hours'], [['tech', 'hour']]),
  };
}

export function extractRows(rows: string[][], cols: UploadColumns): UploadRow[] {
  const at = (row: string[], i: number): string => (i >= 0 ? ((row[i] as string | undefined) ?? '').trim() : '');
  const out: UploadRow[] = [];
  for (const row of rows) {
    const opCode = at(row, cols.opCode);
    if (!opCode) continue;
    out.push({
      opCode,
      opDescription: at(row, cols.opDescription),
      laborSale: at(row, cols.laborSale),
      techHours: at(row, cols.techHours),
    });
  }
  return out;
}
