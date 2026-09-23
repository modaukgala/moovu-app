import { NextResponse } from "next/server";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { supabaseAdmin } from "@/lib/supabase/admin";
export async function GET(req: Request) {
  if (!(await phase6Auth(req, true))) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const requests = await supabaseAdmin.from("phase6_retention_requests").select("*").order("created_at", { ascending: false }).limit(200);
  const events = await supabaseAdmin.from("phase6_retention_events").select("*").order("created_at", { ascending: false }).limit(500);
  if (requests.error || events.error) return NextResponse.json({ error: "Retention queue unavailable." }, { status: 503 });
  return NextResponse.json({ requests: requests.data, events: events.data, automaticDeletionEnabled: false }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["HELD", "RELEASED", "AUTHORIZED", "DECLINED"].includes(body.action) || !/^[0-9a-f-]{36}$/i.test(body.key ?? "") || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.length > 2000 || body.basis != null && (typeof body.basis !== "string" || body.basis.length > 2000)) return NextResponse.json({ error: "Invalid retention decision." }, { status: 400 });
  const result = await supabaseAdmin.rpc("phase6_retention_command", { p_actor: user.id, p_key: body.key, p_action: body.action, p_reason: body.reason, p_request: body.request, p_basis: body.basis ?? null });
  return NextResponse.json(result.error ? { error: "Decision could not be recorded safely; check holds and qualified basis." } : { request: result.data, message: "Decision recorded. No automatic deletion was executed." }, { status: result.error ? 409 : 200, headers: { "Cache-Control": "no-store" } });
}
