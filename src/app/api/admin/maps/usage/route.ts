import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getLocalMapsCostSnapshot } from "@/lib/server/mapsCostControl";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const snapshot = getLocalMapsCostSnapshot();
  const summary = new URL(req.url).searchParams.get("summary") === "1";
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const local = summary ? {
    generatedAt: snapshot.generatedAt,
    operations: Object.fromEntries(Object.entries(snapshot.operations).map(([operation, row]) => [operation, {
      providerSuccesses: row.providerSuccesses, providerFailures: row.providerFailures,
      providerCallsLastMinute: row.providerCallsLastMinute,
    }])),
  } : snapshot;
  const { data, error } = await auth.supabaseAdmin.rpc("google_maps_usage_summary", {
    p_since: since,
  }).then(result => result, () => ({ data: null, error: true }));

  const shared = error || !Array.isArray(data) ? null : summary ? data.every(row => row &&
    Object.hasOwn(snapshot.operations, row.operation) && ["in_flight", "success", "failure", "blocked"].includes(row.status) &&
    Number.isSafeInteger(row.request_count) && row.request_count >= 0)
    ? data.map(row => ({ operation: row.operation, status: row.status, request_count: row.request_count }))
    : null : data;
  return NextResponse.json({
    ok: true,
    local,
    shared,
    sharedTelemetryAvailable: shared !== null,
    ...(summary ? { sharedSince: since } : {}),
  });
}
