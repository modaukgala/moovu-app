import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  return NextResponse.json({ ok: false, error: "Driver subscription expiry processing is retired. Historical records remain available." }, { status: 410 });
}
