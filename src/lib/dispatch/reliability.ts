export const MAX_DISPATCH_ATTEMPTS = 5;

export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= MAX_DISPATCH_ATTEMPTS) return null;
  return [10_000, 30_000, 60_000, 120_000][attempt - 1];
}

/** Input is already filtered and ranked by dispatch eligibility. */
export function cappedCandidates<T extends { driverId: string }>(rows: T[], cap: number, preferred?: string | null) {
  return (preferred ? rows.filter((row) => row.driverId === preferred) : rows).slice(0, Math.max(0, cap));
}

export async function settledPool<T>(rows: readonly T[], concurrency: number, task: (row: T) => Promise<void>) {
  let cursor = 0;
  let failed = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      try { await task(rows[index]); } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(rows.length, Math.max(1, Math.floor(concurrency))) }, worker));
  return { attempted: rows.length, failed };
}
