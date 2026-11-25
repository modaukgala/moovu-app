import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { readManualSurge, setActiveManualSurge } from "@/lib/pricing/manualSurgeServer";
import { SURGE_MODES } from "@/lib/domain/fare";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const setting = await readManualSurge();
  return NextResponse.json(
    { ok: true, ...setting, modes: Object.values(SURGE_MODES) },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (typeof mode !== "string" || !Object.hasOwn(SURGE_MODES, mode)) {
    return NextResponse.json({ ok: false, error: "Choose a supported surge mode." }, { status: 400 });
  }
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

  return NextResponse.json(
    { ok: true, surge: result.surge, state: "configured", updatedAt: result.updatedAt, updatedBy: result.updatedBy, modes: Object.values(SURGE_MODES) },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}
