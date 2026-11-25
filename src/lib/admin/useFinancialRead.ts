"use client";

import { useCallback, useEffect, useState } from "react";
import { createCommissionHistoryRequest } from "./commissionHistoryRequest";

export function useFinancialRead<T>(key: string, read: (key: string, signal: AbortSignal) => Promise<T>) {
  const [request] = useState(() => createCommissionHistoryRequest<string, T>());
  const [saved, setSaved] = useState<{ key: string; result: T }>();
  const [state, setState] = useState<{ key: string; loading: boolean; error?: string }>();
  const run = useCallback((input: string) => request.run(input, read, (next) => {
    setState({ key: input, loading: next.loading, error: next.error });
    if (next.result !== undefined) setSaved({ key: input, result: next.result });
  }), [read, request]);
  const reload = useCallback(() => run(key), [key, run]);
  useEffect(() => {
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => { clearTimeout(timer); request.invalidate(); };
  }, [reload, request]);
  return {
    data: saved?.key === key ? saved.result : undefined,
    loading: state?.key !== key || state.loading,
    error: state?.key === key ? state.error : undefined,
    reload,
    retry: () => {
      const failed = request.failedRequest();
      if (failed === key) void run(failed);
    },
  };
}

export async function readFinancialJson<T>(url: string, token: string | null, signal: AbortSignal, valid: (body: Record<string, unknown>) => boolean) {
  if (!token) throw new Error("Sign in to load financial records.");
  const res = await fetch(url, { cache: "no-store", signal, headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true || !valid(body)) throw new Error(body?.error || "Financial records unavailable.");
  return body as T;
}
