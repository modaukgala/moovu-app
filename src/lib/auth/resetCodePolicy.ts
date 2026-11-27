import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const RESET_CODE_MINUTES = 15;
export const RESET_CODE_MAX_TRIES = 5;

export type StoredResetCode = { hash: string; expiresAt: string; tries: number };

const hashCode = (userId: string, code: string) =>
  createHash("sha256").update(`${userId}:${code}`).digest("hex");

export function newResetCode(userId: string, now = Date.now()) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const stored: StoredResetCode = {
    hash: hashCode(userId, code),
    expiresAt: new Date(now + RESET_CODE_MINUTES * 60_000).toISOString(),
    tries: 0,
  };
  return { code, stored };
}

/** "ok" | "wrong" | "expired" | "locked" | "none" */
export function checkResetCode(userId: string, code: string, stored: StoredResetCode | null | undefined, now = Date.now()) {
  if (!stored?.hash) return "none" as const;
  if (new Date(stored.expiresAt).getTime() < now) return "expired" as const;
  if ((stored.tries ?? 0) >= RESET_CODE_MAX_TRIES) return "locked" as const;
  const a = Buffer.from(hashCode(userId, code.replace(/\D/g, "")));
  const b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b) ? ("ok" as const) : ("wrong" as const);
}
