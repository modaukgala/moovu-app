import { NextResponse } from "next/server";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reviewCompletion } from "@/lib/drivers/phase6ReviewPresentation";
import { PHASE6_EVIDENCE_LABELS } from "@/lib/drivers/phase6ReviewPresentation";
import { PHASE6_REQUIRED, type Phase6Section } from "@/lib/drivers/phase6Policy";
const correctionCategories = new Set(["Image is blurry", "Document or photo is cut off", "Information cannot be read", "Wrong document or photo", "Document has expired", "Incorrect angle or view", "Other"]);
export async function GET(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const result = await supabaseAdmin.from("phase6_applications").select("id,driver_id,status,cycle,version,revision,draft,created_at,updated_at").order("updated_at", { ascending: false }).limit(200);
    if (result.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
    const driverIds = [...new Set((result.data ?? []).map(item => item.driver_id))];
    const applicationIds = (result.data ?? []).map(item => item.id);
    const [drivers, enrollments] = driverIds.length ? await Promise.all([
      supabaseAdmin.from("drivers").select("id,first_name,last_name").in("id", driverIds),
      supabaseAdmin.from("phase6_enrollments").select("driver_id,existing_driver").in("driver_id", driverIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (drivers.error || enrollments.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
    const validatedUploads: { id: string; application_id: string; section: string; state: string }[] = [];
    if (applicationIds.length) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        const page = await supabaseAdmin.from("phase6_uploads").select("id,application_id,section,state").in("application_id", applicationIds).eq("state", "VALIDATED").order("id").range(offset, offset + 999);
        if (page.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
        validatedUploads.push(...(page.data ?? []));
        if ((page.data?.length ?? 0) < 1000) break;
        if (offset === 9000) return NextResponse.json({ error: "Review queue is too large to summarize safely." }, { status: 503 });
      }
    }
    const applications = (result.data ?? []).map(item => ({
      id: item.id, driver_id: item.driver_id, status: item.status, cycle: item.cycle, version: item.version, revision: item.revision, created_at: item.created_at, updated_at: item.updated_at,
      driverName: [drivers.data?.find(driver => driver.id === item.driver_id)?.first_name, drivers.data?.find(driver => driver.id === item.driver_id)?.last_name].filter(Boolean).join(" "),
      existingDriver: item.cycle > 1 || enrollments.data?.find(enrollment => enrollment.driver_id === item.driver_id)?.existing_driver === true,
      completion: reviewCompletion(item.draft, validatedUploads.filter(upload => upload.application_id === item.id)),
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
  const reviewIds = (reviews.data ?? []).map(review => review.id);
  const targets = reviewIds.length ? await supabaseAdmin.from("phase6_correction_targets").select("review_id,requirement,reason_category").in("review_id", reviewIds) : { data: [], error: null };
  if (targets.error && !["PGRST205", "42P01"].includes(targets.error.code ?? "")) return NextResponse.json({ error: "Correction details unavailable." }, { status: 503 });
  const annotatedReviews = (reviews.data ?? []).map(review => ({ ...review, target: targets.data?.find(target => target.review_id === review.id) ?? null }));
  return NextResponse.json({ application: application.data, driverName: [driver.data?.first_name, driver.data?.last_name].filter(Boolean).join(" "), existingDriver: application.data.cycle > 1 || enrollment.data?.existing_driver === true, versions: versions.data, reviews: annotatedReviews, uploads: uploads.data }, { headers: { "Cache-Control": "no-store" } });
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
  if (["CORRECTION_REQUESTED", "APPROVED", "REJECTED"].includes(body.action)) {
    const requirement = typeof body.requirement === "string" ? body.requirement : null;
    const category = typeof body.category === "string" ? body.category : null;
    const section = requirement === "id_document" ? "personal" : ["drivers_license", "pdp"].includes(requirement ?? "") ? "driving" : ["vehicle_license_disc", "insurance"].includes(requirement ?? "") ? "vehicle" : "scanner";
    const validRequirement = requirement && PHASE6_EVIDENCE_LABELS[requirement] && ([...PHASE6_REQUIRED[section as Phase6Section], ...(section === "driving" ? ["pdp"] : section === "vehicle" ? ["insurance"] : [])] as string[]).includes(requirement);
    if (body.action === "CORRECTION_REQUESTED" && (!validRequirement || !category || !correctionCategories.has(category) || body.sections?.length !== 1 || body.sections[0] !== section)) return NextResponse.json({ error: "Choose a valid evidence item and reason." }, { status: 400 });
    if (body.action !== "CORRECTION_REQUESTED" && (requirement || category || body.sections?.length)) return NextResponse.json({ error: "Unexpected evidence target." }, { status: 400 });
    const { data, error } = await supabaseAdmin.rpc("phase6_admin_review", {
      p_actor: user.id, p_key: body.key, p_action: body.action, p_application: body.application,
      p_revision: body.revision, p_reason: body.reason.trim(), p_requirement: requirement, p_category: category,
    });
    if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Review and notification could not be recorded together." }, { status: error.code === "P0001" ? 409 : 503 });
    return NextResponse.json({ application: data }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await supabaseAdmin.rpc("phase6_command", { p_actor: user.id, p_key: body.key, p_action: body.action, p_application: body.application, p_revision: body.revision, p_payload: { reason: body.reason, sections: body.sections ?? [] } });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Review could not be recorded safely." }, { status: error.code === "P0001" ? 409 : 503 });
  return NextResponse.json({ application: data }, { headers: { "Cache-Control": "no-store" } });
}
