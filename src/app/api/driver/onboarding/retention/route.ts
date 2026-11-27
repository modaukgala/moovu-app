import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { executeDriverDeletion } from "@/lib/account-deletion/service";

/** Driver deletes their own account (Apple 5.1.1(v)): it happens now, not as a request. */
export async function POST(req: Request) {
  const user = await phase6Auth(req);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirmText !== "DELETE" || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 2000) {
    return NextResponse.json({ error: "Type DELETE and tell us briefly why you're leaving." }, { status: 400 });
  }
  const { data: account } = await supabaseAdmin.from("driver_accounts").select("driver_id").eq("user_id", user.id).maybeSingle();
  if (!account?.driver_id) return NextResponse.json({ error: "No driver account is linked to this login." }, { status: 404 });
  const result = await executeDriverDeletion({ supabase: supabaseAdmin, actorId: user.id, driverId: account.driver_id, reason: body.reason.trim(), byDriver: true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true, message: "Your driver account has been deleted." }, { headers: { "Cache-Control": "no-store" } });
}
