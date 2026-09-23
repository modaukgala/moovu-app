import { NextResponse } from "next/server";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { supabaseAdmin } from "@/lib/supabase/admin";
export async function GET(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const result = await supabaseAdmin.from("phase6_applications").select("id,driver_id,status,cycle,version,revision,created_at,updated_at").order("updated_at", { ascending: false }).limit(200);
    return NextResponse.json({ applications: result.data ?? [], error: result.error ? "Review queue unavailable." : undefined }, { status: result.error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  }
  const [application, versions, reviews, uploads] = await Promise.all([
    supabaseAdmin.from("phase6_applications").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("phase6_versions").select("*").eq("application_id", id).order("version"),
    supabaseAdmin.from("phase6_reviews").select("*").eq("application_id", id).order("created_at"),
    supabaseAdmin.from("phase6_uploads").select("id,section,state,source,width,height,bytes,created_at").eq("application_id", id),
  ]);
  if (!application.data || application.error || versions.error || reviews.error || uploads.error) return NextResponse.json({ error: "Application unavailable." }, { status: 404 });
  return NextResponse.json({ application: application.data, versions: versions.data, reviews: reviews.data, uploads: uploads.data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["UNDER_REVIEW", "APPROVED", "REJECTED", "CORRECTION_REQUESTED", "REAPPLICATION_AUTHORIZED", "REINSPECTION_AUTHORIZED"].includes(body.action) || !/^[0-9a-f-]{36}$/i.test(body.key ?? "") || !Number.isSafeInteger(body.revision) || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.length > 2000 || !Array.isArray(body.sections ?? [])) return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  if (body.action === "REINSPECTION_AUTHORIZED") {
    const { data, error } = await supabaseAdmin.rpc("phase6_reinspection", { p_actor: user.id, p_application: body.application, p_revision: body.revision, p_key: body.key, p_reason: body.reason });
    return NextResponse.json(error ? { error: "Reinspection authorization could not be recorded safely." } : { application: data }, { status: error ? 409 : 200, headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await supabaseAdmin.rpc("phase6_command", { p_actor: user.id, p_key: body.key, p_action: body.action, p_application: body.application, p_revision: body.revision, p_payload: { reason: body.reason, sections: body.sections ?? [] } });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Review could not be recorded safely." }, { status: error.code === "P0001" ? 409 : 503 });
  return NextResponse.json({ application: data }, { headers: { "Cache-Control": "no-store" } });
}
