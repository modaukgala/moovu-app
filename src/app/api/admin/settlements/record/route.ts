import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    return NextResponse.json({ ok: false, error: "Manual settlements are retired. Review driver payment requests instead." }, { status: 410 });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
