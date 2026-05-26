import { NextResponse } from "next/server";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const surge = await getActiveManualSurge();
  return NextResponse.json(
    { ok: true, surge },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}
