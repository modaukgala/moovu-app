export type BoundedPage<T> = { rows: T[]; complete: boolean };

export async function collectBoundedPages<T>(input: {
  pageSize: number;
  maxRows: number;
  load: (from: number, to: number) => Promise<T[]>;
}): Promise<BoundedPage<T>> {
  const rows: T[] = [];
  while (rows.length < input.maxRows) {
    const take = Math.min(input.pageSize, input.maxRows - rows.length);
    const page = await input.load(rows.length, rows.length + take - 1);
    rows.push(...page.slice(0, take));
    if (page.length < take) return { rows, complete: true };
  }
  const probe = await input.load(input.maxRows, input.maxRows);
  return { rows, complete: probe.length === 0 };
}

export function boundedCount(count: number, complete: boolean) {
  return complete ? { total: count, totalIsLowerBound: false } : { total: null, totalIsLowerBound: true };
}

export function chunkValues<T>(values: T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Chunk size must be positive.");
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

