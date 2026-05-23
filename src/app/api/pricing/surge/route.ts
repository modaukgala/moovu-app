import { NextResponse } from "next/server";
import { getActiveManualSurge } from "@/lib/pricing/manualSurgeServer";

export async function GET() {
  const surge = await getActiveManualSurge();
  return NextResponse.json({ ok: true, surge });
}
