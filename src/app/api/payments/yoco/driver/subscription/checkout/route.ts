import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";

export async function POST(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  return NextResponse.json({ ok: false, error: "Driver subscriptions are retired. No purchase is required to drive." }, { status: 410 });
}
