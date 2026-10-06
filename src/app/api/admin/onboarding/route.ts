import { NextResponse } from "next/server";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { onboardingDriverName } from "@/lib/drivers/onboardingTransition";
export async function GET(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const result = await supabaseAdmin.from("phase6_applications").select("id,driver_id,status,cycle,version,revision,created_at,updated_at,draft").order("updated_at", { ascending: false }).limit(200);
    if (result.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
    const driverIds = [...new Set((result.data ?? []).map(item => item.driver_id))];
    const [drivers, enrollments] = driverIds.length ? await Promise.all([
      supabaseAdmin.from("drivers").select("id,first_name,last_name").in("id", driverIds),
      supabaseAdmin.from("phase6_enrollments").select("driver_id,existing_driver").in("driver_id", driverIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (drivers.error || enrollments.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
    const applications = (result.data ?? []).map(({ draft, ...item }) => ({ ...item,
      driverName: onboardingDriverName(draft, drivers.data?.find(driver => driver.id === item.driver_id)),
      existingDriver: item.cycle > 1 || enrollments.data?.find(enrollment => enrollment.driver_id === item.driver_id)?.existing_driver === true,
    }));
    return NextResponse.json({ applications }, { headers: { "Cache-Control": "no-store" } });
  }
  const [application, versions, reviews, uploads] = await Promise.all([
    supabaseAdmin.from("phase6_applications").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("phase6_versions").select("*").eq("application_id", id).order("version"),
    supabaseAdmin.from("phase6_reviews").select("*").eq("application_id", id).order("created_at"),
    supabaseAdmin.from("phase6_uploads").select("id,section,state,source,width,height,bytes,created_at").eq("application_id", id),
  ]);
  if (!application.data || application.error || versions.error || reviews.error || uploads.error) return NextResponse.json({ error: "Application unavailable." }, { status: 404 });
  const [driver, enrollment] = await Promise.all([
    supabaseAdmin.from("drivers").select("first_name,last_name").eq("id", application.data.driver_id).maybeSingle(),
    supabaseAdmin.from("phase6_enrollments").select("existing_driver").eq("driver_id", application.data.driver_id).maybeSingle(),
  ]);
  if (driver.error || enrollment.error) return NextResponse.json({ error: "Application identity unavailable." }, { status: 503 });
  return NextResponse.json({ application: application.data, driverName: onboardingDriverName(application.data.draft, driver.data), existingDriver: application.data.cycle > 1 || enrollment.data?.existing_driver === true, versions: versions.data, reviews: reviews.data, uploads: uploads.data }, { headers: { "Cache-Control": "no-store" } });
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
