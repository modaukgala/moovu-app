import { NextResponse } from "next/server";
import { deleteDriverAccount } from "@/lib/account-deletion/service";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";

export async function POST(req: Request) {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  const user = await getUserFromBearer(req);

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  }

  const driverId = await getDriverIdForUser(user.id);
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    password?: unknown;
    confirmText?: unknown;
    reason?: unknown;
  } | null;

  const result = await deleteDriverAccount({
    supabase: supabaseAdmin,
    user: {
      id: user.id,
      email: user.email,
    },
    driverId,
    password: typeof body?.password === "string" ? body.password : "",
    confirmText: typeof body?.confirmText === "string" ? body.confirmText : "",
    reason: typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) || null : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    message:
      "Your account has been successfully deleted. Any legally required records have been retained in accordance with applicable regulations.",
  });
}
