import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getLocalMapsCostSnapshot } from "@/lib/server/mapsCostControl";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const local = getLocalMapsCostSnapshot();
  const { data, error } = await auth.supabaseAdmin.rpc("google_maps_usage_summary", {
    p_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });

  return NextResponse.json({
    ok: true,
    local,
    shared: error ? null : data,
    sharedTelemetryAvailable: !error,
  });
}
