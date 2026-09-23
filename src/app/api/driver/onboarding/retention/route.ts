import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phase6Auth } from "@/lib/drivers/phase6Server";
export async function POST(req: Request) {
  const user = await phase6Auth(req);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirmText !== "DELETE" || !/^[0-9a-f-]{36}$/i.test(body.key ?? "") || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.length > 2000) return NextResponse.json({ error: "Confirm DELETE and enter a reason." }, { status: 400 });
  const result = await supabaseAdmin.rpc("phase6_retention_command", { p_actor: user.id, p_key: body.key, p_action: "REQUESTED", p_reason: body.reason.trim() });
  if (result.error) return NextResponse.json({ error: "Your request could not be recorded safely." }, { status: 409 });
  return NextResponse.json({ request: result.data, message: "Deletion request recorded for a controlled review. Your account and records have not been erased." }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
