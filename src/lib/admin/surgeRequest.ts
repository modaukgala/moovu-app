import type { SurgeMode } from "../domain/fare";

export async function requestSurge<T>(getToken: () => Promise<string>, signal: AbortSignal, mode?: SurgeMode, request = fetch, timeoutMs = 15000) {
  const limit = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, limit]);
  const run = async () => {
    const token = await getToken();
    combined.throwIfAborted();
    if (!token) throw new Error("Admin session required to manage surge.");
    const response = await request("/api/admin/pricing/surge", {
      method: mode ? "POST" : "GET", cache: "no-store", signal: combined,
      headers: { Authorization: `Bearer ${token}`, ...(mode ? { "Content-Type": "application/json" } : {}) },
      body: mode ? JSON.stringify({ mode }) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true || !["configured","absent","malformed","failed"].includes(data.state) ||
        typeof data.surge?.multiplier !== "number" || !Number.isFinite(data.surge.multiplier) ||
        typeof data.surge?.label !== "string" || typeof data.surge?.mode !== "string" ||
        (mode && (data.state !== "configured" || data.surge.mode !== mode))) {
      throw new Error(data?.error || "Surge response unavailable.");
    }
    return data as T;
  };
  combined.throwIfAborted();
  let rejectAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error(limit.aborted ? "Surge request timed out." : "Surge request cancelled."));
    combined.addEventListener("abort", rejectAbort, { once: true });
  });
  try { return await Promise.race([run(), stopped]); }
  finally { combined.removeEventListener("abort", rejectAbort); }
}
