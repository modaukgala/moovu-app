/** Batching may bound work in flight, never the number of eligible recipients. */
export function broadcastCandidates<T extends { driverId: string }>(rows: readonly T[], preferred?: string | null) {
  const seen = new Set<string>();
  return rows.filter(row => {
    if ((preferred && row.driverId !== preferred) || seen.has(row.driverId)) return false;
    seen.add(row.driverId);
    return true;
  });
}

export async function boundedMap<T, R>(rows: readonly T[], concurrency: number, task: (row: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(rows.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await task(rows[index]);
    }
  }));
  return results;
}
