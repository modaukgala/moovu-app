import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phase6Auth, phase6Owned } from "@/lib/drivers/phase6Server";
import { validSaIdentity, phase6DraftShape, type Phase6Draft } from "@/lib/drivers/phase6Policy";
import { isValidSaMobile, isValidVin, isValidEngineNumber, isValidVehicleRegistration, isValidVehicleYear, isValidSeatingCapacity } from "@/lib/driver-validation";

export async function GET(req: Request) {
  const user = await phase6Auth(req);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const mapping = await supabaseAdmin.from("driver_accounts").select("driver_id").eq("user_id", user.id).maybeSingle();
  if (!mapping.data?.driver_id) return NextResponse.json({ application: null }, { headers: { "Cache-Control": "no-store" } });
  const result = await supabaseAdmin.from("phase6_applications").select("*").eq("driver_id", mapping.data.driver_id).order("cycle", { ascending: false }).limit(1).maybeSingle();
  if (result.error) return NextResponse.json({ error: "Onboarding is unavailable." }, { status: 503 });
  const application = result.data;
  if (application && !(await phase6Owned(req, application.id))) return NextResponse.json({ error: "Driver enrollment required." }, { status: 403 });
  const reviews = application ? await supabaseAdmin.from("phase6_reviews").select("action,reason,sections,source_version,created_at").eq("application_id", application.id).order("created_at") : null;
  return NextResponse.json({ application, reviews: reviews?.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  const user = await phase6Auth(req);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["ENROLL", "SAVE", "SUBMIT"].includes(body.action) || !/^[0-9a-f-]{36}$/i.test(body.key ?? "")) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.action !== "ENROLL" && !(await phase6Owned(req, String(body.application ?? "")))) return NextResponse.json({ error: "Application unavailable." }, { status: 403 });
  if (body.action === "SAVE") {
    if (!phase6DraftShape(body.payload)) return NextResponse.json({ error: "Invalid draft fields or evidence references." }, { status: 400 });
    const payload: Phase6Draft = body.payload;
    const ids = Object.values(payload).flatMap(section => Object.values(section?.evidence as Record<string, string> ?? {}));
    if (ids.length) {
      const uploads = await supabaseAdmin.from("phase6_uploads").select("id,section").eq("application_id", body.application).eq("state", "VALIDATED").in("id", ids);
      if (uploads.error || ids.some(id => !uploads.data?.some(upload => upload.id === id))) return NextResponse.json({ error: "Evidence must belong to this application." }, { status: 403 });
    }
  }
  if (body.action === "SUBMIT") {
    const owned = await phase6Owned(req, body.application);
    const draft = owned?.application.draft as Phase6Draft;
    if (!draft || !validSaIdentity(draft.personal?.id_number)) return NextResponse.json({ error: "Enter a valid South African ID number." }, { status: 400 });
    if (!isValidSaMobile(draft.personal?.phone) || !isValidSaMobile(draft.personal?.emergency_contact_phone) || !isValidVin(draft.vehicle?.vehicle_vin) || !isValidEngineNumber(draft.vehicle?.vehicle_engine_number) || !isValidVehicleRegistration(draft.vehicle?.vehicle_registration) || !isValidVehicleYear(draft.vehicle?.vehicle_year) || !isValidSeatingCapacity(draft.vehicle?.seating_capacity)) return NextResponse.json({ error: "Check phone numbers, VIN, engine number, registration, year and seats." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.rpc("phase6_command", { p_actor: user.id, p_key: body.key, p_action: body.action, p_application: body.application ?? null, p_revision: body.revision ?? null, p_payload: body.payload ?? {} });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "The operation could not be completed safely." }, { status: error.code === "P0001" ? 409 : 503 });
  return NextResponse.json({ application: data }, { headers: { "Cache-Control": "no-store" } });
}
