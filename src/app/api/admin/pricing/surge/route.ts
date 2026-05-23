import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getActiveManualSurge, setActiveManualSurge } from "@/lib/pricing/manualSurgeServer";
import { SURGE_MODES, validateSurgeMode } from "@/lib/domain/fare";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const surge = await getActiveManualSurge();
  return NextResponse.json({ ok: true, surge, modes: Object.values(SURGE_MODES) });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = validateSurgeMode(body?.mode);
  const result = await setActiveManualSurge(mode, auth.user.id);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.missingMigration
          ? "Manual surge storage is not ready. Run docs/manual-surge-migration.sql first."
          : "Could not update manual surge mode.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, surge: result.surge, modes: Object.values(SURGE_MODES) });
}
