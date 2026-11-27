import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { newResetCode, RESET_CODE_MINUTES } from "@/lib/auth/resetCodePolicy";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Admin creates a one-time password reset code for a customer or driver, to send on WhatsApp. */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Only the owner or an admin can create reset codes." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { customerId?: string; driverId?: string } | null;
  const db = auth.supabaseAdmin;
  let userId: string | null = null;
  let phone: string | null = null;
  let name = "";
  if (body?.customerId) {
    const { data } = await db.from("customers").select("auth_user_id,phone,first_name").eq("id", body.customerId).maybeSingle();
    userId = data?.auth_user_id ?? null; phone = data?.phone ?? null; name = data?.first_name ?? "";
  } else if (body?.driverId) {
    const [{ data: account }, { data: driver }] = await Promise.all([
      db.from("driver_accounts").select("user_id").eq("driver_id", body.driverId).maybeSingle(),
      db.from("drivers").select("phone,first_name").eq("id", body.driverId).maybeSingle(),
    ]);
    userId = account?.user_id ?? null; phone = driver?.phone ?? null; name = driver?.first_name ?? "";
  }
  if (!userId) return NextResponse.json({ ok: false, error: "This person has no login yet, so there's nothing to reset." }, { status: 404, headers: NO_STORE });

  const { data: found } = await db.auth.admin.getUserById(userId);
  if (!found.user) return NextResponse.json({ ok: false, error: "Login not found." }, { status: 404, headers: NO_STORE });
  const { code, stored } = newResetCode(userId);
  const { error } = await db.auth.admin.updateUserById(userId, {
    app_metadata: { ...(found.user.app_metadata ?? {}), moovu_reset: stored },
  });
  if (error) return NextResponse.json({ ok: false, error: "Could not create the code. Try again." }, { status: 500, headers: NO_STORE });
  console.info("[reset-code] created", { by: auth.user.id, for: userId });

  const loginId = String(found.user.email ?? "").endsWith(".local") ? phone : (found.user.email ?? phone);
  const message = `Hi ${name || "there"}, your MOOVU reset code is ${code}. It works once and expires in ${RESET_CODE_MINUTES} minutes. Open MOOVU, tap "Forgot password" then "I have a code", and enter ${loginId ?? "your phone number"} with this code. Never share this code with anyone else.`;
  return NextResponse.json({ ok: true, code, phone, message, expiresMinutes: RESET_CODE_MINUTES }, { headers: NO_STORE });
}
